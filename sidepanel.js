const statusEl = document.getElementById("status");
const profileForm = document.getElementById("profile-form");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const messagesEl = document.getElementById("messages");
const matchesList = document.getElementById("matches-list");
const matchesEmpty = document.getElementById("matches-empty");
const matchBtn = document.getElementById("match-btn");
const saveBtn = document.getElementById("save-btn");
const voiceBtn = document.getElementById("voice-btn");

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

setStatus("Ready", "idle");
loadProfile();
loadLocale();

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  const profile = readProfileFromForm();
  saveProfile(profile);

  addMessage("user", message);
  chatInput.value = "";

  setStatus("Thinking...", "busy");
  const response = await sendMessageToBackground("CHAT_REQUEST", {
    message,
    profile,
  });

  if (!response || !response.ok) {
    setStatus(response?.error || "Request failed", "error");
    addMessage("assistant", response?.error || "Request failed.");
    return;
  }

  setStatus("Ready", "idle");
  if (response.text) {
    addMessage("assistant", response.text);
  }

  if (response.matches) {
    renderMatches(response.matches);
  }
});

matchBtn.addEventListener("click", async () => {
  const profile = readProfileFromForm();
  saveProfile(profile);

  setStatus("Matching...", "busy");
  const response = await sendMessageToBackground("LOCAL_MATCH", { profile });

  if (!response || !response.ok) {
    setStatus(response?.error || "Match failed", "error");
    return;
  }

  renderMatches(response.matches || []);
  setStatus("Ready", "idle");
});

saveBtn.addEventListener("click", () => {
  saveProfile(readProfileFromForm());
  setStatus("Profile saved", "idle");
});

initVoiceInput();

profileForm.elements.language.addEventListener("change", (event) => {
  loadLocale(event.target.value);
});

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

async function loadLocale(languageOverride) {
  const language = normalizeString(languageOverride) || inferBrowserLanguage();
  document.documentElement.lang = language;

  try {
    const response = await fetch(
      chrome.runtime.getURL(`locales/${language}.json`),
    );
    if (!response.ok) {
      return;
    }
    const strings = await response.json();
    applyLocale(strings);
  } catch (error) {
    // Ignore locale load failures
  }
}

function applyLocale(strings) {
  if (!strings) {
    return;
  }

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (strings[key]) {
      element.textContent = strings[key];
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (strings[key]) {
      element.setAttribute("placeholder", strings[key]);
    }
  });
}

function readProfileFromForm() {
  const formData = new FormData(profileForm);
  return {
    name: normalizeString(formData.get("name")),
    caste_category: normalizeString(formData.get("caste_category")),
    annual_income: toNumber(formData.get("annual_income")),
    course_level: normalizeString(formData.get("course_level")),
    course: normalizeString(formData.get("course")),
    percentage: toNumber(formData.get("percentage")),
    district: normalizeString(formData.get("district")),
    language: normalizeString(formData.get("language")) || "ta",
  };
}

function fillProfileForm(profile) {
  if (!profile) {
    return;
  }

  profileForm.elements.name.value = profile.name || "";
  profileForm.elements.caste_category.value = profile.caste_category || "";
  profileForm.elements.annual_income.value = profile.annual_income ?? "";
  profileForm.elements.course_level.value = profile.course_level || "";
  profileForm.elements.course.value = profile.course || "";
  profileForm.elements.percentage.value = profile.percentage ?? "";
  profileForm.elements.district.value = profile.district || "";
  profileForm.elements.language.value = profile.language || "ta";
  loadLocale(profile.language);
}

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
  matchesList.innerHTML = "";

  if (!matches || matches.length === 0) {
    matchesEmpty.style.display = "block";
    return;
  }

  matchesEmpty.style.display = "none";

  matches.forEach((match) => {
    const item = document.createElement("li");
    item.className = "match";

    const title = document.createElement("h3");
    title.textContent = match.name_ta || match.name || "Scholarship";

    const meta = document.createElement("p");
    const amountText = match.amount
      ? currencyFormatter.format(match.amount)
      : "Amount varies";
    const deadlineText = match.deadline
      ? `Deadline: ${match.deadline}`
      : "Deadline unknown";
    meta.textContent = `${amountText} · ${deadlineText}`;

    const reason = document.createElement("p");
    reason.className = "match-reason";
    reason.textContent =
      match.reasons?.[0] || "Eligible based on your profile.";

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(reason);
    matchesList.appendChild(item);
  });
}

function initVoiceInput() {
  const SpeechRecognition = window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceBtn.title = "Voice input not supported";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "ta-IN";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    chatInput.value = transcript;
    chatForm.requestSubmit();
  };

  recognition.onerror = () => {
    setStatus("Voice input failed", "error");
  };

  recognition.onend = () => {
    if (statusEl.dataset.tone === "recording") {
      setStatus("Ready", "idle");
    }
  };

  voiceBtn.addEventListener("click", () => {
    const selectedLang =
      normalizeString(profileForm.elements.language.value) || "ta";
    recognition.lang = selectedLang === "ta" ? "ta-IN" : "en-IN";
    setStatus("Listening...", "recording");
    recognition.start();
  });
}

function sendMessageToBackground(type, payload) {
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

function saveProfile(profile) {
  chrome.storage.local.set({ studentProfile: profile });
}

function loadProfile() {
  chrome.storage.local.get("studentProfile", (result) => {
    if (result && result.studentProfile) {
      fillProfileForm(result.studentProfile);
    }
  });
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function inferBrowserLanguage() {
  const language = (navigator.language || "en").toLowerCase();
  return language.startsWith("ta") ? "ta" : "en";
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
