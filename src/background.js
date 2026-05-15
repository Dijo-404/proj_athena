import { MSG } from "./lib/messages.js";
import { TOOL_SCHEMA } from "./lib/tools.js";
import { buildSystemPrompt } from "./lib/prompt.js";
import { normalizeProfile, safeString } from "./lib/profile.js";
import { runAgentLoop } from "./lib/agent-loop.js";
import { isPortalUrl } from "./lib/portals.js";

import { initDB, seedSchemesIfEmpty } from "./data/db.js";
import {
  matchScholarships,
  checkEligibility,
  getDeadline,
} from "./agent/matcher.js";
import { listApplications, upsertApplication } from "./agent/tracker.js";

// ============================================================================
// Constants
// ============================================================================
const OLLAMA_URL = "http://localhost:11434/api/chat";
const OLLAMA_TAGS = "http://localhost:11434/api/tags";
const MODEL_NAME = "gemma3:4b";

// ============================================================================
// Lifecycle
// ============================================================================
chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }
  try {
    await initDB();
    await seedSchemesIfEmpty();
    chrome.alarms.create("syncSchemes", { periodInMinutes: 1440 });
  } catch (err) {
    console.error("Athena onInstalled failed", err);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "syncSchemes") return;
  try {
    await seedSchemesIfEmpty();
  } catch (err) {
    console.error("Athena alarm sync failed", err);
  }
});

// ============================================================================
// Message dispatcher
// ============================================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;
  const route = ROUTES[message.type];
  if (!route) return;

  Promise.resolve(route(message.payload))
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ ok: false, error: err?.message || "Internal error" }),
    );
  return true;
});

const ROUTES = {
  [MSG.CHAT_REQUEST]: handleChatRequest,
  [MSG.LOCAL_MATCH]: handleLocalMatch,
  [MSG.LIST_APPLICATIONS]: () => listApplications(),
  [MSG.SAVE_APPLICATION]: (payload) => upsertApplication(payload),
  [MSG.PING_OLLAMA]: async () => ({ ok: true, connected: await checkOllama() }),
  [MSG.DOM_UPDATED]: handleDomUpdated,
};

// ============================================================================
// Handlers
// ============================================================================
async function handleChatRequest(payload) {
  await initDB();
  await seedSchemesIfEmpty();

  const profile = normalizeProfile(payload?.profile || {});
  const userMessage = safeString(payload?.message);
  if (!userMessage) return { ok: false, error: "Message is empty." };

  try {
    const result = await runAgentLoop({
      query: queryOllama,
      executeTool: ollamaToolExecutor,
      tools: TOOL_SCHEMA,
      systemPrompt: buildSystemPrompt(profile, { supportsThinking: true }),
      userMessage,
    });

    if (result.error) return { ok: false, error: result.error };
    return {
      ok: true,
      text: result.text || "",
      ...(result.matches ? { matches: result.matches } : {}),
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Ollama request failed" };
  }
}

async function handleLocalMatch(payload) {
  await initDB();
  await seedSchemesIfEmpty();
  const profile = normalizeProfile(payload?.profile || {});
  const result = await matchScholarships(profile);
  if (!result || result.ok === false) {
    return { ok: false, error: result?.error || "Match failed." };
  }
  return { ok: true, matches: result.matches || [] };
}

async function handleDomUpdated(payload) {
  const snapshot = { ...(payload || {}), updated_at: new Date().toISOString() };
  return new Promise((resolve) => {
    chrome.storage.local.set({ lastDomContext: snapshot }, () => {
      const err = chrome.runtime.lastError;
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });
}

// ============================================================================
// Ollama backend
// ============================================================================
async function queryOllama(messages, tools) {
  const connected = await checkOllama();
  if (!connected) {
    throw new Error("Ollama is not running on localhost:11434.");
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
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  return response.json();
}

async function checkOllama() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(OLLAMA_TAGS, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Tool dispatcher (Ollama path) — fill_field is gated by side panel approval
// ============================================================================
async function ollamaToolExecutor(name, args) {
  switch (name) {
    case "match_scholarships":
      return matchScholarships(args);
    case "check_eligibility":
      return checkEligibility(args?.scheme_id, args?.student_profile);
    case "get_deadline":
      return getDeadline(args?.scheme_id);
    case "fill_field": {
      const approval = await requestPanelApproval(args);
      if (!approval?.approved) {
        if (approval?.panel_closed) {
          return {
            ok: false,
            error:
              "Side panel is closed. Ask the user to open the Athena side panel to approve form actions.",
            panel_closed: true,
          };
        }
        return { ok: false, error: "User skipped this action.", skipped: true };
      }
      return sendFillField(args);
    }
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

function requestPanelApproval(payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: MSG.REQUEST_APPROVAL, payload },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ approved: false, panel_closed: true });
            return;
          }
          resolve(response || { approved: false, panel_closed: true });
        },
      );
    } catch {
      resolve({ approved: false, panel_closed: true });
    }
  });
}

async function sendFillField(args) {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, error: "No active tab to fill." };
  }
  if (!isPortalUrl(tab.url)) {
    return {
      ok: false,
      error:
        "The active tab is not a supported scholarship portal. Open scholarships.gov.in, tnscholarship.net, egrantz.tn.gov.in, or buddy4study.com.",
    };
  }
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tab.id,
      { type: MSG.FILL_FIELD, payload: args },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "No response from content script." });
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
