self.window = self;

importScripts("data/db.js", "agent/matcher.js", "agent/tracker.js");

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL_NAME = "gemma3:4b";
const MAX_TOOL_STEPS = 6;
const LANGUAGE_ORDER = ["ta", "en"];
const LANGUAGE_LABELS = {
  ta: "Tamil",
  en: "English",
};

const TOOL_SCHEMA = [
  {
    type: "function",
    function: {
      name: "match_scholarships",
      description:
        "Find scholarships matching the student's profile from the local database",
      parameters: {
        type: "object",
        properties: {
          caste_category: {
            type: "string",
            enum: ["BC", "MBC", "SC", "ST", "OC", "OBC"],
            description: "Student's caste category",
          },
          annual_income: {
            type: "number",
            description: "Family annual income in INR",
          },
          course_level: {
            type: "string",
            enum: ["10th", "12th", "UG", "PG", "Diploma", "ITI"],
            description: "Current course level",
          },
          percentage: {
            type: "number",
            description: "Last exam percentage",
          },
          district: {
            type: "string",
            description: "District in Tamil Nadu",
          },
        },
        required: ["caste_category", "annual_income", "course_level"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fill_field",
      description:
        "Fill a specific form field on the current scholarship portal page",
      parameters: {
        type: "object",
        properties: {
          field_label: {
            type: "string",
            description: "Visible label of the form field",
          },
          value: {
            type: "string",
            description: "Value to enter",
          },
          action: {
            type: "string",
            enum: ["type", "select", "click", "upload"],
            description: "Interaction type",
          },
        },
        required: ["field_label", "value", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_eligibility",
      description: "Verify if the student is eligible for a specific scheme",
      parameters: {
        type: "object",
        properties: {
          scheme_id: { type: "string" },
          student_profile: { type: "object" },
        },
        required: ["scheme_id", "student_profile"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_deadline",
      description: "Get application deadline for a scheme",
      parameters: {
        type: "object",
        properties: {
          scheme_id: { type: "string" },
        },
        required: ["scheme_id"],
      },
    },
  },
];

chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error(error));
  }
  await AthenaDB.initDB();
  await AthenaDB.seedSchemesIfEmpty();
  chrome.alarms.create("syncSchemes", { periodInMinutes: 1440 });
  warmupModel();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "syncSchemes") {
    return;
  }
  await AthenaDB.seedSchemesIfEmpty();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "CHAT_REQUEST") {
    handleChatRequest(message.payload)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Request failed" }),
      );
    return true;
  }

  if (message.type === "LOCAL_MATCH") {
    handleLocalMatch(message.payload)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Match failed" }),
      );
    return true;
  }

  if (message.type === "LIST_APPLICATIONS") {
    AthenaTracker.listApplications()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "List failed" }),
      );
    return true;
  }

  if (message.type === "SAVE_APPLICATION") {
    AthenaTracker.upsertApplication(message.payload)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Save failed" }),
      );
    return true;
  }

  if (message.type === "PING_OLLAMA") {
    checkOllamaConnection().then((connected) =>
      sendResponse({ ok: true, connected }),
    );
    return true;
  }

  if (message.type === "DOM_UPDATED") {
    const snapshot = {
      ...(message.payload || {}),
      updated_at: new Date().toISOString(),
    };
    chrome.storage.local.set({ lastDomContext: snapshot }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        sendResponse({ ok: false, error: err.message });
      } else {
        sendResponse({ ok: true });
      }
    });
    return true;
  }
});

async function handleChatRequest(payload) {
  await AthenaDB.initDB();
  await AthenaDB.seedSchemesIfEmpty();

  const profile = normalizeProfile(payload?.profile || {});
  const userMessage = safeString(payload?.message);

  if (!userMessage) {
    return { ok: false, error: "Message is empty." };
  }

  try {
    const result = await executeAgentLoop(userMessage, profile);
    if (result.error) {
      return { ok: false, error: result.error };
    }
    return { ok: true, text: result.text || "" };
  } catch (error) {
    return { ok: false, error: error?.message || "Ollama request failed" };
  }
}

async function handleLocalMatch(payload) {
  await AthenaDB.initDB();
  await AthenaDB.seedSchemesIfEmpty();

  const profile = normalizeProfile(payload?.profile || {});
  const result = await matchScholarships(profile);

  if (!result || result.ok === false) {
    return { ok: false, error: result?.error || "Match failed." };
  }

  return { ok: true, matches: result.matches || [] };
}

async function executeAgentLoop(userMessage, profile) {
  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(profile),
    },
    {
      role: "user",
      content: userMessage,
    },
  ];

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const response = await queryGemma(messages, TOOL_SCHEMA);

    if (!response || !response.message) {
      return { error: "Ollama response missing." };
    }

    const message = response.message;
    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function?.name || "";
        const toolArgs = parseToolArguments(toolCall.function?.arguments);
        const result = await executeTool(toolName, toolArgs);
        messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        });
      }
      continue;
    }

    return { text: message.content || "" };
  }

  return {
    text: "I need more steps to finish this request. Please provide more details.",
  };
}

async function executeTool(name, args) {
  if (name === "match_scholarships") {
    return matchScholarships(args);
  }

  if (name === "check_eligibility") {
    return checkEligibility(args?.scheme_id, args?.student_profile);
  }

  if (name === "get_deadline") {
    return getDeadline(args?.scheme_id);
  }

  if (name === "fill_field") {
    return sendFillField(args);
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

async function sendFillField(args) {
  const tab = await getActiveTab();

  if (!tab || typeof tab.id !== "number") {
    return { ok: false, error: "No active tab to fill." };
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tab.id,
      { type: "FILL_FIELD", payload: args },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(
          response || { ok: false, error: "No response from content script." },
        );
      },
    );
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs.length > 0 ? tabs[0] : null);
    });
  });
}

async function checkOllamaConnection() {
  try {
    const response = await fetch(OLLAMA_URL.replace("/api/chat", "/api/tags"), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function queryGemma(messages, tools) {
  // Check if Ollama is running
  const isConnected = await checkOllamaConnection();
  if (!isConnected) {
    throw new Error("Ollama is not running. Please start Ollama on localhost:11434");
  }

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages,
      tools,
      stream: false,
      options: { temperature: 0.1, num_ctx: 8192 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }

  return response.json();
}

function parseToolArguments(rawArgs) {
  if (!rawArgs) {
    return {};
  }

  if (typeof rawArgs === "string") {
    try {
      return JSON.parse(rawArgs);
    } catch (error) {
      return {};
    }
  }

  return rawArgs;
}

function normalizeLanguageList(value) {
  const rawList = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = rawList
    .map((item) => safeString(item))
    .filter(Boolean);

  const ordered = [];
  LANGUAGE_ORDER.forEach((language) => {
    if (normalized.includes(language)) {
      ordered.push(language);
    }
  });

  return ordered;
}

function getPrimaryLanguage(languages) {
  const normalized = normalizeLanguageList(languages);
  return normalized[0] || "ta";
}

function getLanguageLabel(language) {
  return LANGUAGE_LABELS[language] || "English";
}

function buildSystemPrompt(profile) {
  const preferredLanguages = normalizeLanguageList(
    profile.languages || profile.language,
  );
  const primaryLanguage = getPrimaryLanguage(preferredLanguages);
  const primaryLabel = getLanguageLabel(primaryLanguage);
  const secondaryLanguage = preferredLanguages[1];
  const secondaryLabel = secondaryLanguage
    ? getLanguageLabel(secondaryLanguage)
    : "";
  const languageList = preferredLanguages.length
    ? preferredLanguages.map(getLanguageLabel).join(", ")
    : primaryLabel;
  const tamilInstructions =
    "IMPORTANT: Always respond in Tamil (தமிழ்). Use simple, conversational Tamil. " +
    "Avoid formal or literary Tamil. When listing scholarships, use Tamil names where available.";
  const secondaryInstruction = secondaryLanguage
    ? `If helpful, add a short ${secondaryLabel} summary after the main response.`
    : "";

  return `You are Athena, a helpful scholarship assistant for students in Tamil Nadu, India.

${primaryLanguage === "ta" ? tamilInstructions : ""}
Preferred response languages: ${languageList}.
Primary language: ${primaryLabel}.
${secondaryInstruction}

The student's profile:
- Name: ${profile.name || ""}
- Caste category: ${profile.caste_category || ""}
- Annual family income: ₹${profile.annual_income ?? ""}
- Course: ${profile.course || ""} (${profile.course_level || ""})
- Last exam percentage: ${profile.percentage ?? ""}%
- District: ${profile.district || ""}, Tamil Nadu

Your job is to:
1. Find scholarships this student is eligible for
2. Explain eligibility clearly in ${primaryLabel}
3. Help fill application forms step by step
4. Track application status

Use the available tools to match scholarships and fill forms.
When filling forms, proceed step by step and confirm each action.

Always use the <|think|> token before making eligibility decisions.`;
}

function normalizeProfile(input) {
  const languages = normalizeLanguageList(input?.languages ?? input?.language);
  const primaryLanguage = getPrimaryLanguage(languages);
  return {
    name: safeString(input?.name),
    caste_category: safeString(input?.caste_category),
    annual_income: toNumber(input?.annual_income),
    course_level: safeString(input?.course_level),
    course: safeString(input?.course),
    percentage: toNumber(input?.percentage),
    district: safeString(input?.district),
    languages,
    language: primaryLanguage,
  };
}

function safeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function warmupModel() {
  try {
    const isConnected = await checkOllamaConnection();
    if (!isConnected) {
      return;
    }
    await queryGemma([{ role: "user", content: "hello" }], []);
  } catch (error) {
    // Ignore warmup failures
  }
}
