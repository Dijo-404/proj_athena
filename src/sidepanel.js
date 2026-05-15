// ============================================================================
// Athena side panel controller
// ES module — imports from ./lib, ./data, ./agent.
// Single-file UI controller: status, i18n, profile, chat, matches, applications,
// voice, WebLLM inference, approval gate.
// ============================================================================

import { MSG } from "./lib/messages.js";
import { TOOL_SCHEMA } from "./lib/tools.js";
import { buildSystemPrompt } from "./lib/prompt.js";
import {
  LANGUAGE_SPEECH,
  normalizeLanguageList,
  getPrimaryLanguage,
  safeString,
  toNumber,
} from "./lib/profile.js";
import { runAgentLoop } from "./lib/agent-loop.js";
import { isPortalUrl } from "./lib/portals.js";

import { initDB, seedSchemesIfEmpty } from "./data/db.js";
import {
  matchScholarships,
  checkEligibility,
  getDeadline,
} from "./agent/matcher.js";

// ============================================================================
// Configuration
// ============================================================================
const USE_LOCAL_MODEL = true;
const ALLOW_OLLAMA_FALLBACK = true;
const LOCAL_MODEL_IMPORT_URL = "webllm.js";
const LOCAL_MODEL_ID = "gemma-2-2b-it-q4f16_1-MLC";
const LOCAL_MODEL_LABEL = "Gemma 2 2B";
const APPROVAL_TIMEOUT_MS = 120000;

// ============================================================================
// DOM references
// ============================================================================
const statusEl = document.getElementById("status");
const profileForm = document.getElementById("profile-form");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const messagesEl = document.getElementById("messages");
const matchesList = document.getElementById("matches-list");
const matchesEmpty = document.getElementById("matches-empty");
const applicationsList = document.getElementById("applications-list");
const applicationsEmpty = document.getElementById("applications-empty");
const refreshAppsBtn = document.getElementById("refresh-apps-btn");
const matchBtn = document.getElementById("match-btn");
const saveBtn = document.getElementById("save-btn");
const voiceBtn = document.getElementById("voice-btn");
const languageInputs = document.querySelectorAll('input[name="languages"]');

// ============================================================================
// State
// ============================================================================
let activeStrings = {};
let cachedMatches = [];
let cachedApplications = [];
let localEnginePromise = null;
let localDbPromise = null;
let loadLocaleVersion = 0;

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// ============================================================================
// Bootstrap
// ============================================================================
setStatus("Ready", "idle");
loadProfile();
loadLocale();
refreshApplications();
detectInferenceCapability();

chatForm.addEventListener("submit", onChatSubmit);
matchBtn.addEventListener("click", onMatchClick);
saveBtn.addEventListener("click", onSaveClick);
refreshAppsBtn.addEventListener("click", refreshApplications);
languageInputs.forEach((input) =>
  input.addEventListener("change", () => {
    const languages = ensureLanguagesSelected();
    loadLocale(getPrimaryLanguage(languages));
  }),
);

// Listen for approval requests from the background (Ollama path).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MSG.REQUEST_APPROVAL) return;
  requestUserApproval(message.payload || {}).then(sendResponse);
  return true;
});

initVoiceInput();

// ============================================================================
// Chat flow — WebLLM primary, Ollama fallback, surfaces clear errors
// ============================================================================
async function onChatSubmit(event) {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  const profile = readProfileFromForm();
  saveProfile(profile);
  addMessage("user", message);
  chatInput.value = "";

  setStatus("Thinking…", "busy");

  let response = null;

  if (USE_LOCAL_MODEL) {
    response = await tryWebLLM(message, profile);
    if (!response.ok && ALLOW_OLLAMA_FALLBACK) {
      setStatus(getString("status_using_ollama", "Using Ollama…"), "busy");
      response = await sendBg(MSG.CHAT_REQUEST, { message, profile });
    }
  } else {
    response = await sendBg(MSG.CHAT_REQUEST, { message, profile });
  }

  if (!response || !response.ok) {
    const friendly = getString("error_no_inference", "");
    addMessage("assistant", friendly || response?.error || "Request failed.");
    setStatus(response?.error || "Request failed", "error");
    return;
  }

  setStatus("Ready", "idle");
  if (response.text) addMessage("assistant", response.text);
  if (response.matches) renderMatches(response.matches);
}

async function tryWebLLM(message, profile) {
  try {
    await ensureLocalDb();
    const result = await runAgentLoop({
      query: queryWebLLM,
      executeTool: webllmToolExecutor,
      tools: TOOL_SCHEMA,
      systemPrompt: buildSystemPrompt(profile, { supportsThinking: false }),
      userMessage: message,
    });
    if (result.error) return { ok: false, error: result.error };
    return {
      ok: true,
      text: result.text || "",
      ...(result.matches ? { matches: result.matches } : {}),
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Local model failed." };
  }
}

// ============================================================================
// WebLLM inference backend
// ============================================================================
async function ensureLocalDb() {
  if (localDbPromise) return localDbPromise;
  localDbPromise = (async () => {
    try {
      await initDB();
      await seedSchemesIfEmpty();
    } catch (err) {
      localDbPromise = null;
      throw err;
    }
  })();
  return localDbPromise;
}

async function ensureLocalEngine() {
  if (localEnginePromise) return localEnginePromise;
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this browser.");
  }

  localEnginePromise = (async () => {
    try {
      setStatus(`Loading ${LOCAL_MODEL_LABEL}…`, "busy");
      const moduleUrl = chrome.runtime.getURL(LOCAL_MODEL_IMPORT_URL);
      const webllm = await import(/* @vite-ignore */ moduleUrl);
      const engine = await webllm.CreateMLCEngine(LOCAL_MODEL_ID, {
        initProgressCallback: (report) => {
          if (typeof report?.progress === "number") {
            const pct = Math.round(report.progress * 100);
            setStatus(`Loading ${LOCAL_MODEL_LABEL} ${pct}%`, "busy");
            return;
          }
          if (report?.text) setStatus(report.text, "busy");
        },
      });
      return engine;
    } catch (err) {
      localEnginePromise = null;
      throw err;
    }
  })();

  return localEnginePromise;
}

async function queryWebLLM(messages, tools) {
  const engine = await ensureLocalEngine();
  const response = await engine.chat.completions.create({
    messages,
    tools,
    temperature: 0.1,
    max_tokens: 512,
  });
  return { message: response?.choices?.[0]?.message };
}

// ============================================================================
// Tool dispatcher (WebLLM path) — fill_field gated by inline approval UI
// ============================================================================
async function webllmToolExecutor(name, args) {
  switch (name) {
    case "match_scholarships":
      return matchScholarships(args);
    case "check_eligibility":
      return checkEligibility(args?.scheme_id, args?.student_profile);
    case "get_deadline":
      return getDeadline(args?.scheme_id);
    case "fill_field": {
      const approval = await requestUserApproval(args);
      if (!approval.approved) {
        return { ok: false, error: "User skipped this action.", skipped: true };
      }
      return sendFillFieldFromPanel(args);
    }
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

async function sendFillFieldFromPanel(args) {
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

// ============================================================================
// Find Matches button — pure data path, no LLM involved
// ============================================================================
async function onMatchClick() {
  const profile = readProfileFromForm();
  saveProfile(profile);
  setStatus("Matching…", "busy");
  const response = await sendBg(MSG.LOCAL_MATCH, { profile });
  if (!response || !response.ok) {
    setStatus(response?.error || "Match failed", "error");
    return;
  }
  renderMatches(response.matches || []);
  setStatus("Ready", "idle");
}

// ============================================================================
// Save profile
// ============================================================================
async function onSaveClick() {
  try {
    await saveProfile(readProfileFromForm());
    setStatus("Profile saved", "idle");
    setTimeout(() => {
      if (statusEl.textContent === "Profile saved") setStatus("Ready", "idle");
    }, 2000);
  } catch {
    setStatus("Save failed", "error");
  }
}

function saveProfile(profile) {
  return chrome.storage.local.set({ studentProfile: profile }).catch((err) => {
    console.warn("saveProfile failed", err);
    throw err;
  });
}

function loadProfile() {
  chrome.storage.local.get("studentProfile").then(
    (result) => {
      if (result?.studentProfile) fillProfileForm(result.studentProfile);
    },
    (err) => console.warn("loadProfile failed", err),
  );
}

// ============================================================================
// Applications
// ============================================================================
async function refreshApplications() {
  setStatus(getString("applications_loading", "Loading applications…"), "busy");
  const response = await sendBg(MSG.LIST_APPLICATIONS);
  if (!response || !response.ok) {
    setStatus(response?.error || "List failed", "error");
    return;
  }
  renderApplications(response.applications || []);
  setStatus("Ready", "idle");
}

async function trackMatch(match) {
  if (!match?.id) return;
  setStatus(getString("track_status", "Tracking…"), "busy");
  const response = await sendBg(MSG.SAVE_APPLICATION, {
    scheme_id: match.id,
    status: "pending",
  });
  if (!response || !response.ok) {
    setStatus(response?.error || "Track failed", "error");
    return;
  }
  setStatus(getString("track_success", "Tracked"), "idle");
  refreshApplications();
}

// ============================================================================
// Inference capability detection
// ============================================================================
async function detectInferenceCapability() {
  const hasWebGPU = "gpu" in navigator;
  let hasOllama = false;
  try {
    const resp = await sendBg(MSG.PING_OLLAMA);
    hasOllama = !!(resp?.ok && resp.connected);
  } catch {
    /* swallow */
  }
  if (!hasWebGPU && !hasOllama) {
    setStatus(
      getString("status_offline", "Local match only (no LLM)"),
      "error",
    );
  }
}

// ============================================================================
// Background message bridge
// ============================================================================
function sendBg(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response" });
    });
  });
}

// ============================================================================
// Status pill
// ============================================================================
function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

// ============================================================================
// i18n
// ============================================================================
async function loadLocale(languageOverride) {
  const language = getPrimaryLanguage(languageOverride);
  document.documentElement.lang = language;
  const version = ++loadLocaleVersion;

  try {
    const response = await fetch(
      chrome.runtime.getURL(`locales/${language}.json`),
    );
    if (!response.ok) return;
    const strings = await response.json();
    if (version !== loadLocaleVersion) return;
    applyLocale(strings);
  } catch (err) {
    console.warn(`Locale ${language} failed to load`, err);
  }
}

function applyLocale(strings) {
  if (!strings) return;
  activeStrings = strings;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (strings[key]) el.textContent = strings[key];
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (strings[key]) el.setAttribute("placeholder", strings[key]);
  });

  if (cachedMatches.length > 0) renderMatches(cachedMatches);
  if (cachedApplications.length > 0) renderApplications(cachedApplications);
}

function getString(key, fallback) {
  return activeStrings?.[key] || fallback || "";
}

function getStatusLabel(status) {
  if (!status) return "";
  const key = `status_${status}`;
  if (activeStrings?.[key]) return activeStrings[key];
  return status.replace(/_/g, " ");
}

// ============================================================================
// Profile form
// ============================================================================
function readProfileFromForm() {
  const formData = new FormData(profileForm);
  const languages = ensureLanguagesSelected();
  return {
    name: safeString(formData.get("name")),
    caste_category: safeString(formData.get("caste_category")),
    annual_income: toNumber(formData.get("annual_income")),
    course_level: safeString(formData.get("course_level")),
    course: safeString(formData.get("course")),
    percentage: toNumber(formData.get("percentage")),
    district: safeString(formData.get("district")),
    languages,
    language: getPrimaryLanguage(languages),
  };
}

function fillProfileForm(profile) {
  if (!profile) return;
  profileForm.elements.name.value = profile.name || "";
  profileForm.elements.caste_category.value = profile.caste_category || "";
  profileForm.elements.annual_income.value = profile.annual_income ?? "";
  profileForm.elements.course_level.value = profile.course_level || "";
  profileForm.elements.course.value = profile.course || "";
  profileForm.elements.percentage.value = profile.percentage ?? "";
  profileForm.elements.district.value = profile.district || "";
  const languages = normalizeLanguageList(
    profile.languages || profile.language,
  );
  setLanguageSelections(languages);
  loadLocale(getPrimaryLanguage(languages));
}

function getSelectedLanguages() {
  const selected = Array.from(languageInputs)
    .filter((i) => i.checked)
    .map((i) => safeString(i.value))
    .filter(Boolean);
  return normalizeLanguageList(selected);
}

function setLanguageSelections(languages) {
  const normalized = normalizeLanguageList(languages);
  languageInputs.forEach((i) => (i.checked = normalized.includes(i.value)));
  if (normalized.length === 0 && languageInputs.length > 0) {
    const fallback = inferBrowserLanguage();
    const el = profileForm.querySelector(
      `input[name="languages"][value="${fallback}"]`,
    );
    if (el) el.checked = true;
  }
}

function ensureLanguagesSelected() {
  let selected = getSelectedLanguages();
  if (selected.length === 0) {
    const fallback = inferBrowserLanguage();
    const el = profileForm.querySelector(
      `input[name="languages"][value="${fallback}"]`,
    );
    if (el) el.checked = true;
    selected = [fallback];
  }
  return selected;
}

function inferBrowserLanguage() {
  const lang = (navigator.language || "en").toLowerCase();
  return lang.startsWith("ta") ? "ta" : "en";
}

// ============================================================================
// Approval UI — stamped-document card
// ============================================================================
function requestUserApproval(args) {
  return new Promise((resolve) => {
    let settled = false;
    const card = document.createElement("div");
    card.className = "message approval";
    card.dataset.state = "pending";

    const isSubmit =
      args?.action === "click" &&
      /submit|apply|send|பதிவு|சமர்ப்பி/i.test(String(args?.field_label || ""));
    if (isSubmit) card.dataset.kind = "submit";

    const header = document.createElement("p");
    header.className = "approval-header";
    header.textContent = isSubmit
      ? getString("approval_submit_prompt", "Confirm submission:")
      : getString("approval_prompt", "Athena wants to:");

    const actionLine = document.createElement("p");
    actionLine.className = "approval-action";
    const actionWord = getString(
      `action_${args?.action || "type"}`,
      args?.action || "type",
    );
    const labelText = args?.field_label || "(no label)";
    const valueText =
      args?.value !== undefined && args?.value !== null && args?.value !== ""
        ? ` → ${args.value}`
        : "";
    actionLine.textContent = `${actionWord}: ${labelText}${valueText}`;

    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "btn btn-primary approval-approve";
    approveBtn.textContent = isSubmit
      ? getString("approval_submit_button", "Submit")
      : getString("approve_button", "Approve");
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "btn btn-utility approval-skip";
    skipBtn.textContent = getString("skip_button", "Skip");
    actions.appendChild(approveBtn);
    actions.appendChild(skipBtn);

    const timer = setTimeout(() => {
      if (!settled) finish(false, true);
    }, APPROVAL_TIMEOUT_MS);

    function finish(approved, timedOut = false) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      approveBtn.disabled = true;
      skipBtn.disabled = true;
      card.dataset.state = approved ? "approved" : "skipped";
      resolve({ approved, ...(timedOut ? { timed_out: true } : {}) });
    }

    approveBtn.addEventListener("click", () => finish(true));
    skipBtn.addEventListener("click", () => finish(false));

    card.appendChild(header);
    card.appendChild(actionLine);
    card.appendChild(actions);
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// ============================================================================
// Render helpers
// ============================================================================
function addMessage(role, text) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  const label = document.createElement("span");
  label.className = "message-role";
  label.textContent = role === "user" ? "You" : "Athena";
  const body = document.createElement("p");
  body.textContent = text;
  message.appendChild(label);
  message.appendChild(body);
  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMatches(matches) {
  cachedMatches = Array.isArray(matches) ? matches : [];
  matchesList.innerHTML = "";

  if (!matches || matches.length === 0) {
    matchesEmpty.style.display = "block";
    return;
  }
  matchesEmpty.style.display = "none";

  for (const match of matches) {
    const item = document.createElement("li");
    item.className = "match";

    const title = document.createElement("h3");
    title.textContent = match.name_ta || match.name || "Scholarship";

    const meta = document.createElement("p");
    const amount = match.amount
      ? currencyFormatter.format(match.amount)
      : "Amount varies";
    const deadline = match.deadline
      ? `Deadline: ${match.deadline}`
      : "Deadline unknown";
    meta.textContent = `${amount} · ${deadline}`;

    const reason = document.createElement("p");
    reason.className = "match-reason";
    reason.textContent =
      match.reasons?.[0] || "Eligible based on your profile.";

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(reason);

    if (match.id) {
      const actions = document.createElement("div");
      actions.className = "match-actions";
      const trackBtn = document.createElement("button");
      trackBtn.type = "button";
      trackBtn.className = "track-btn";
      trackBtn.textContent = getString("track_button", "Track");
      trackBtn.addEventListener("click", () => trackMatch(match));
      actions.appendChild(trackBtn);
      item.appendChild(actions);
    }

    matchesList.appendChild(item);
  }
}

function renderApplications(applications) {
  cachedApplications = Array.isArray(applications) ? applications : [];
  applicationsList.innerHTML = "";

  if (!applications || applications.length === 0) {
    applicationsEmpty.style.display = "block";
    return;
  }
  applicationsEmpty.style.display = "none";

  for (const application of applications) {
    const item = document.createElement("li");
    item.className = "application";

    const title = document.createElement("h3");
    title.textContent =
      application.name_ta || application.name || application.scheme_id;

    const meta = document.createElement("p");
    meta.className = "application-meta";
    const parts = [];
    const statusText = getStatusLabel(application.status);
    if (statusText) parts.push(`${getString("status_label", "Status")}: ${statusText}`);
    if (application.deadline)
      parts.push(`${getString("deadline_label", "Deadline")}: ${application.deadline}`);
    if (application.days_remaining !== null && application.days_remaining !== undefined) {
      parts.push(
        `${application.days_remaining} ${getString("days_remaining_suffix", "days left")}`,
      );
    }
    meta.textContent = parts.join(" · ");

    item.appendChild(title);
    item.appendChild(meta);
    applicationsList.appendChild(item);
  }
}

// ============================================================================
// Voice input
// ============================================================================
function initVoiceInput() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceBtn.title = "Voice input not supported";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "ta-IN";
  recognition.continuous = false;
  recognition.interimResults = false;

  let currentStream = null;
  let isListening = false;

  function stopStream() {
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }
  }

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript;
    if (!transcript) {
      setStatus("Ready", "idle");
      return;
    }
    chatInput.value = transcript;
    chatForm.requestSubmit();
  };

  recognition.onerror = () => {
    isListening = false;
    stopStream();
    setStatus("Voice input failed", "error");
  };

  recognition.onend = () => {
    isListening = false;
    stopStream();
    if (statusEl.dataset.tone === "recording") setStatus("Ready", "idle");
  };

  voiceBtn.addEventListener("click", async () => {
    if (isListening) {
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("Mic access denied", "error");
      return;
    }
    const languages = ensureLanguagesSelected();
    const primary = getPrimaryLanguage(languages);
    recognition.lang = LANGUAGE_SPEECH[primary] || LANGUAGE_SPEECH.en;
    setStatus("Listening…", "recording");
    try {
      recognition.start();
      isListening = true;
    } catch {
      stopStream();
      setStatus("Voice input error", "error");
    }
  });
}
