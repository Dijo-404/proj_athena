# Athena Implementation Plan

## Project Overview
**Athena** — Tamil-first Scholarship Agent (Chrome Extension)
- Chrome extension powered by Gemma 4 via Ollama
- Finds, explains, and auto-fills government scholarship applications
- Offline-first, Tamil language support
- Zero data leaves the device

---

## Phase 0: Documentation Discovery [COMPLETE]

### What exists
- `README.md` — Project overview, quick start, roadmap
- `ARCHITECTURE.md` — Technical deep-dive, API patterns, code examples
- `KAGGLE_WRITEUP.md` — Competition submission writeup

### What's missing (actual implementation)
- No Chrome extension source files exist
- No manifest.json, background.js, content.js, sidepanel.js
- No agent modules (matcher.js, filler.js, tracker.js)
- No data files (schemes.json, portals.json)
- No localization files

### References from ARCHITECTURE.md
1. Ollama API call pattern — lines 51-69
2. Function schema for tool calling — lines 97-187
3. Agent execution loop — lines 194-227
4. System prompt builder — lines 239-268
5. Voice input init — lines 275-290
6. IndexedDB wrapper — lines 349-368
7. DOM reading via content script — lines 424-457
8. Fill field executor — lines 464-497

---

## Phase 1: Chrome Extension Foundation

### 1.1 manifest.json (Manifest V3)
```json
{
  "manifest_version": 3,
  "name": "Athena",
  "version": "1.0.0",
  "description": "Tamil-first Scholarship Agent",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["http://localhost:11434/*"],
  "side_panel": { "default_path": "sidepanel.html" },
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"]
  }],
  "icons": { "48": "icons/icon48.png" }
}
```
**Reference:** ARCHITECTURE.md system diagram (lines 11-39)

### 1.2 background.js — Service Worker
- Initialize Ollama connection on install
- Message routing between sidepanel and content scripts
- Manage state (student profile, active scholarship)
- Periodic sync alarm for scholarship database
- Warm up Gemma 4 model on install

**Reference:** ARCHITECTURE.md lines 399-414, 544-551

**Verification:**
- [ ] `chrome.runtime.onInstalled` logs to console
- [ ] Message passing works between panels

### 1.3 sidepanel.html — Main UI
- Student profile form (name, caste, income, course, district)
- Chat interface (message history, input field)
- Voice input button (Web Speech API)
- Scholarship list display
- Application tracker

**Reference:** README.md lines 88-91 (user flow)

### 1.4 sidepanel.js — UI Logic
- Initialize voice input with `ta-IN` locale
- Build student profile from form
- Send messages to Gemma 4 via background.js
- Render scholarship matches
- Track application status

**Reference:** ARCHITECTURE.md lines 275-290 (voice), lines 239-268 (system prompt)

**Verification:**
- [ ] Sidepanel loads without errors
- [ ] Voice input initializes

---

## Phase 2: Gemma 4 Integration (Core Engine)

### 2.1 Ollama API Client
```javascript
// background.js
async function queryGemma(messages, tools) {
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma3:4b',
      messages: messages,
      tools: tools,
      stream: false,
      options: { temperature: 0.1, num_ctx: 8192 }
    })
  });
  return response.json();
}
```
**Reference:** ARCHITECTURE.md lines 51-69

### 2.2 Function Calling Schema
Define tools for Gemma 4:
- `match_scholarships` — Find matching scholarships
- `fill_field` — Fill form fields
- `check_eligibility` — Verify eligibility
- `get_deadline` — Get deadline info

**Reference:** ARCHITECTURE.md lines 97-187 (full schema)

### 2.3 Agent Execution Loop
```javascript
// Loop that handles tool calls iteratively
while (continueLoop) {
  const response = await queryGemma(messages, tools);
  if (response.message.tool_calls) {
    // Execute each tool and feed results back
    for (const toolCall of response.message.tool_calls) {
      const result = await executeTool(toolCall.function.name, args);
      messages.push({ role: "tool", content: JSON.stringify(result) });
    }
  } else {
    continueLoop = false; // Done
  }
}
```
**Reference:** ARCHITECTURE.md lines 194-227

### 2.4 System Prompt Builder
Build prompts that:
- Instruct Gemma 4 to respond in Tamil
- Include student profile context
- Enable thinking mode (`<|think|>`)
- Guide step-by-step form filling

**Reference:** ARCHITECTURE.md lines 239-268

**Verification:**
- [ ] Ollama responds at localhost:11434
- [ ] Function calls are detected and executed
- [ ] Tamil response works

---

## Phase 3: Agent Modules

### 3.1 agent/matcher.js — Scholarship Matching
- Load schemes from IndexedDB
- Filter by caste, income, course level, district
- Rank by eligibility match and amount
- Return JSON list with eligibility reasoning

**Reference:** ARCHITECTURE.md lines 349-393 (IndexedDB), function schema lines 97-130

### 3.2 agent/filler.js — Form Fill Executor
- Find fields by label (fuzzy match for Tamil/English)
- Execute type/select/click actions
- Dispatch input/change events
- Handle React/Angular dynamic DOM

**Reference:** ARCHITECTURE.md lines 464-497

### 3.3 agent/tracker.js — Application Status
- Store applications in IndexedDB
- Track deadline status (pending, submitted, approved, rejected)
- Calculate days remaining
- Persist in chrome.storage.local

**Reference:** ARCHITECTURE.md lines 363-364 (applications store)

**Verification:**
- [ ] Scholarship matching returns relevant results
- [ ] Form fields can be filled programmatically
- [ ] Status persists across sessions

---

## Phase 4: Data Layer

### 4.1 data/schemes.json — Scholarship Database
Pre-seeded with 50+ schemes including:
- NSP Post-Matric (OBC, SC, ST)
- TN BC/MBC Scholarship
- Tamil Nadu e-Grantz
- Prime Minister Scholarship

Each scheme includes:
- id, name, name_ta, amount, frequency
- portal URL
- eligibility (caste, max_income, course_level, min_percentage)
- deadline, documents_required

**Reference:** ARCHITECTURE.md lines 372-393 (sample scheme)

### 4.2 data/portals.json — Portal Selectors
Per-portal DOM selectors for:
- Field mappings (label → CSS selector)
- Form sections
- Submit buttons
- Navigation patterns

**Reference:** README.md lines 122-127 (supported portals)

### 4.3 data/db.js — IndexedDB Wrapper
```javascript
async function initDB() {
  const request = indexedDB.open('AthenaDB', 1);
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    db.createObjectStore('schemes', { keyPath: 'id' });
    db.createObjectStore('applications', { keyPath: 'scheme_id' });
  };
  return request;
}
```
**Reference:** ARCHITECTURE.md lines 349-368

**Verification:**
- [ ] Schemes load from JSON
- [ ] IndexedDB stores persist

---

## Phase 5: Localization

### 5.1 locales/ta.json — Tamil UI Strings
```json
{
  "app_name": "Athena",
  "welcome": "வணக்கம்! உங்கள் சாதி, வருமானம், படிப்பு ஆகியவற்றைக் கூடுங்கள்",
  "profile_title": "மாணவர் விவரங்கள்",
  "caste_label": "சாதி",
  "income_label": "குடும்ப வருமானம்",
  ...
}
```
**Reference:** README.md lines 112-113

### 5.2 locales/en.json — English UI Strings
Mirrored English translations

**Verification:**
- [ ] UI switches between Tamil and English
- [ ] All strings translate correctly

---

## Phase 6: Advanced Features

### 6.1 Voice Input (Web Speech API)
```javascript
const recognition = new webkitSpeechRecognition();
recognition.lang = 'ta-IN';
recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  sendMessage(transcript);
};
```
**Reference:** ARCHITECTURE.md lines 275-290

### 6.2 Thinking Mode Activation
Include `<|think|>` token in system prompt for explainable eligibility decisions

**Reference:** ARCHITECTURE.md lines 296-336

### 6.3 Offline Support
- Pre-load scholarship database on install
- Cache all eligibility documents locally
- Daily sync alarm when online

**Reference:** ARCHITECTURE.md lines 340-414

### 6.4 DOM Mutation Observer
Handle dynamic portal re-renders (React/Angular)

```javascript
const observer = new MutationObserver(() => {
  chrome.runtime.sendMessage({ type: 'DOM_UPDATED', context: readPageContext() });
});
observer.observe(document.body, { childList: true, subtree: true });
```
**Reference:** ARCHITECTURE.md lines 523-528

**Verification:**
- [ ] Voice input captures Tamil speech
- [ ] Thinking traces appear in eligibility output
- [ ] Works offline after initial seed

---

## Phase 7: Build & Distribution

### 7.1 Project Structure
```
athena/
├── manifest.json
├── background.js
├── content.js
├── sidepanel.html
├── sidepanel.js
├── agent/
│   ├── matcher.js
│   ├── filler.js
│   └── tracker.js
├── data/
│   ├── db.js
│   ├── schemes.json
│   └── portals.json
├── locales/
│   ├── ta.json
│   └── en.json
├── icons/
│   ├── icon48.png
│   └── icon128.png
└── styles/
    └── sidepanel.css
```

### 7.2 Build Commands
```bash
# Development
npm run dev

# Build for distribution
npm run build

# Package as .zip for Chrome Web Store
npm run package
```

### 7.3 Chrome Web Store Submission
- Create developer account
- Upload .zip bundle
- Submit for review

---

## Verification Checklist

### Core Functionality
- [ ] Extension loads in Chrome
- [ ] Sidepanel displays student profile form
- [ ] Voice input captures Tamil speech
- [ ] Ollama connection established (localhost:11434)
- [ ] Gemma 4 responds to queries
- [ ] Function calls execute correctly
- [ ] Scholarships match student profile
- [ ] Form fields auto-fill on portals

### Offline
- [ ] Works without internet
- [ ] Scholarship database loads locally
- [ ] Gemini inference works offline

### Localization
- [ ] Tamil UI strings display correctly
- [ ] English UI strings display correctly
- [ ] Voice input recognizes Tamil

---

## Anti-Pattern Guards

WARNING - DO NOT:
- Use cloud-based LLM APIs (violates offline-first principle)
- Add telemetry or analytics (violates privacy)
- Store data on external servers
- Use deprecated Manifest V2 APIs
- Skip CORS configuration for Ollama
- Hardcode API keys (there are none)

WARNING - MUST:
- Use `gemma3:4b` via Ollama (not cloud API)
- Store all data in chrome.storage.local or IndexedDB
- Configure `OLLAMA_ORIGINS` for Chrome extension
- Handle Tamil Unicode normalization
- Use Manifest V3 (service workers)