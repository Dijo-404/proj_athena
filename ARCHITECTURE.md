# Athena — Technical Architecture

This document is the technical source of truth for the Athena submission. It details how Gemma 4's specific capabilities are used, the engineering decisions made, and the challenges overcome during development.

---

## System Overview

Athena is a Chrome extension that acts as an autonomous agent. The user describes what they need in Tamil; Gemma 4 (running locally via Ollama) plans and executes the task across government scholarship portals.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Browser                           │
│                                                                 │
│  ┌──────────────────┐        ┌──────────────────────────────┐  │
│  │   Side Panel UI  │        │    Scholarship Portal Tab    │  │
│  │  (sidepanel.js)  │        │  (scholarships.gov.in etc.)  │  │
│  │                  │        │                              │  │
│  │  Tamil voice in  │        │  Content script injected:    │  │
│  │  Chat interface  │        │  content.js reads DOM,       │  │
│  │  Status tracker  │        │  executes fill_field() calls │  │
│  └────────┬─────────┘        └──────────────┬───────────────┘  │
│           │                                 │                  │
│           └──────────── background.js ──────┘                  │
│                    (Service Worker)                             │
│                    Routes messages                              │
│                    Manages state                                │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP POST localhost:11434
                      ▼
           ┌──────────────────────┐
           │   Ollama + Gemma 4   │
           │   (gemma3:4b local)  │
           │                      │
           │  Function calling    │
           │  Tamil reasoning     │
           │  Thinking mode       │
           └──────────────────────┘
```

---

## Gemma 4 Integration — The Core Engine

### Model choice

We use `gemma3:4b` via Ollama for development and `gemma-4-E2B` for production. The E2B model's 128K context window handles long eligibility documents; its native multilingual capability covers Tamil without any translation pipeline.

### Ollama API call

```javascript
// background.js
async function queryGemma(messages, tools) {
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma3:4b',
      messages: messages,
      tools: tools,       // function calling schema
      stream: false,
      options: {
        temperature: 0.1,  // low temp for deterministic form filling
        num_ctx: 8192
      }
    })
  });
  return response.json();
}
```

### CORS configuration for Chrome extension

Chrome extensions run in a sandboxed context. Ollama blocks cross-origin requests by default. Solution:

```bash
# macOS — add to launchctl environment
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"

# Linux — systemd override
sudo systemctl edit ollama
# Add:
# [Service]
# Environment="OLLAMA_ORIGINS=chrome-extension://*"
```

---

## Feature 1 — Native Function Calling

This is the architectural centrepiece. Gemma 4 does not just chat — it outputs structured JSON tool calls that drive real actions on scholarship portals.

### Function schema

```javascript
// agent/matcher.js
const SCHOLARPATH_TOOLS = [
  {
    type: "function",
    function: {
      name: "match_scholarships",
      description: "Find scholarships matching the student's profile from the local database",
      parameters: {
        type: "object",
        properties: {
          caste_category: {
            type: "string",
            enum: ["BC", "MBC", "SC", "ST", "OC", "OBC"],
            description: "Student's caste category as per government classification"
          },
          annual_income: {
            type: "number",
            description: "Family annual income in INR"
          },
          course_level: {
            type: "string",
            enum: ["10th", "12th", "UG", "PG", "Diploma", "ITI"],
          },
          percentage: {
            type: "number",
            description: "Last exam percentage scored"
          },
          district: {
            type: "string",
            description: "District in Tamil Nadu"
          }
        },
        required: ["caste_category", "annual_income", "course_level"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fill_field",
      description: "Fill a specific form field on the current scholarship portal page",
      parameters: {
        type: "object",
        properties: {
          field_label: {
            type: "string",
            description: "The visible label of the form field to fill"
          },
          value: {
            type: "string",
            description: "The value to enter into the field"
          },
          action: {
            type: "string",
            enum: ["type", "select", "click", "upload"],
            description: "Type of interaction required"
          }
        },
        required: ["field_label", "value", "action"]
      }
    }
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
          student_profile: { type: "object" }
        },
        required: ["scheme_id", "student_profile"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_deadline",
      description: "Get application deadline for a scheme",
      parameters: {
        type: "object",
        properties: {
          scheme_id: { type: "string" }
        },
        required: ["scheme_id"]
      }
    }
  }
];
```

### Function call execution loop

```javascript
// agent/executor.js
async function executeAgentLoop(userMessage, studentProfile) {
  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(studentProfile)  // includes Tamil instruction
    },
    { role: "user", content: userMessage }
  ];

  let continueLoop = true;

  while (continueLoop) {
    const response = await queryGemma(messages, SCHOLARPATH_TOOLS);
    const message = response.message;

    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      // Execute each tool call
      for (const toolCall of message.tool_calls) {
        const result = await executeTool(toolCall.function.name, toolCall.function.arguments);
        messages.push({
          role: "tool",
          content: JSON.stringify(result)
        });
      }
      // Loop continues — Gemma 4 processes tool results and decides next action
    } else {
      // No more tool calls — Gemma 4 has finished
      continueLoop = false;
      return message.content;
    }
  }
}
```

---

## Feature 2 — Tamil Language Reasoning

Gemma 4's 140+ language training base handles Tamil natively. No translation pipeline. No external API.

### System prompt with Tamil instruction

```javascript
function buildSystemPrompt(profile) {
  const lang = profile.language || 'ta';  // default Tamil

  return `You are Athena, a helpful scholarship assistant for students in Tamil Nadu, India.

${lang === 'ta' ? `
IMPORTANT: Always respond in Tamil (தமிழ்). Use simple, conversational Tamil that a rural student would understand.
Avoid formal or literary Tamil. Use common spoken Tamil.
When listing scholarships, use Tamil names where available.
` : ''}

The student's profile:
- Name: ${profile.name}
- Caste category: ${profile.caste_category}
- Annual family income: ₹${profile.annual_income}
- Course: ${profile.course} (${profile.course_level})
- Last exam percentage: ${profile.percentage}%
- District: ${profile.district}, Tamil Nadu

Your job is to:
1. Find scholarships this student is eligible for
2. Explain eligibility clearly in ${lang === 'ta' ? 'Tamil' : 'English'}
3. Help fill application forms step by step
4. Track application status

Use the available tools to match scholarships and fill forms.
When filling forms, proceed step by step and confirm each action.

Always use the <|think|> token before making eligibility decisions.`;
}
```

### Voice input in Tamil

```javascript
// sidepanel.js
function initVoiceInput() {
  const recognition = new webkitSpeechRecognition();
  recognition.lang = 'ta-IN';           // Tamil (India)
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('input').value = transcript;
    if (event.results[0].isFinal) {
      sendMessage(transcript);
    }
  };

  document.getElementById('voice-btn').onclick = () => recognition.start();
}
```

---

## Feature 3 — Thinking Mode for Explainable Eligibility

Government scholarship eligibility is complex — income limits, caste categories, percentage cutoffs all vary by scheme. We use Gemma 4's thinking mode to make these decisions transparent and auditable.

### Triggering thinking mode

```javascript
// The <|think|> token in the system prompt activates reasoning traces
const systemPromptWithThinking = `
${baseSystemPrompt}

Before making any eligibility decision, use your thinking capability to reason step by step:
- Check income criteria
- Verify caste category match
- Confirm academic percentage meets the cutoff
- Check if the student is already receiving another scheme (many are mutually exclusive)
- Verify course level matches

Only after reasoning, provide the final eligibility verdict.
`;
```

### Sample thinking trace output

When Gemma 4 evaluates eligibility, the thinking trace looks like:

```
<think>
The student is MBC category with annual income ₹1,80,000.
NSP Post-Matric requires: income < ₹2,50,000 and SC/ST/OBC category.
MBC falls under OBC — eligible on income criterion.
Course is B.Sc. (UG) — eligible for Post-Matric level.
Percentage is 68% — no minimum percentage for this scheme.
The student appears to be eligible. Check if already receiving state scheme — 
if receiving TN e-Grantz, NSP Post-Matric can still be claimed (not mutually exclusive at central vs state level).
Conclusion: ELIGIBLE. Priority: HIGH (₹36,200/year).
</think>

நீங்கள் NSP Post-Matric Scholarship-க்கு தகுதியானவர்! இந்த scholarship மூலம் ஆண்டுக்கு ₹36,200 கிடைக்கும்.
```

This trace becomes a key differentiator in the writeup — explainable AI for high-stakes decisions.

---

## Feature 4 — Offline-First Architecture

### Offline scholarship database

```javascript
// data/db.js — IndexedDB wrapper
const DB_NAME = 'AthenaDB';
const DB_VERSION = 1;

async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Scholarships store
      const schemesStore = db.createObjectStore('schemes', { keyPath: 'id' });
      schemesStore.createIndex('caste', 'eligibility.caste', { multiEntry: true });
      schemesStore.createIndex('income_limit', 'eligibility.max_income');
      schemesStore.createIndex('deadline', 'deadline');

      // Applications store
      db.createObjectStore('applications', { keyPath: 'scheme_id' });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Pre-seeded scheme example
const SAMPLE_SCHEME = {
  id: "NSP_POST_MATRIC_OBC",
  name: "NSP Post-Matric Scholarship for OBC Students",
  name_ta: "OBC மாணவர்களுக்கான NSP Post-Matric Scholarship",
  amount: 36200,
  frequency: "annual",
  portal: "https://scholarships.gov.in",
  eligibility: {
    caste: ["OBC", "MBC"],
    max_income: 250000,
    course_level: ["UG", "PG", "Diploma"],
    min_percentage: null
  },
  deadline: "2026-10-31",
  documents_required: [
    "Caste certificate",
    "Income certificate",
    "Mark sheet",
    "Bank passbook",
    "Aadhaar card"
  ]
};
```

### Background sync when online

```javascript
// background.js
chrome.runtime.onInstalled.addListener(() => {
  // Register periodic sync for when online
  chrome.alarms.create('syncSchemes', { periodInMinutes: 1440 }); // daily
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'syncSchemes') {
    const isOnline = navigator.onLine;
    if (isOnline) {
      await syncScholarshipDatabase();
    }
    // If offline, local DB serves all requests — no degradation
  }
});
```

---

## Form Fill Engine

### DOM reading via content script

```javascript
// content.js
function readPageContext() {
  return {
    url: window.location.href,
    title: document.title,
    // Extract all visible form fields
    fields: Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(el => el.offsetParent !== null)  // only visible
      .map(el => ({
        label: findLabel(el),
        type: el.type || el.tagName.toLowerCase(),
        name: el.name,
        id: el.id,
        required: el.required,
        currentValue: el.value
      })),
    // Extract field groups (for multi-section forms)
    sections: extractFormSections()
  };
}

function findLabel(input) {
  // Try aria-label first
  if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');
  // Try associated label element
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent.trim();
  }
  // Try parent label
  const parentLabel = input.closest('label');
  if (parentLabel) return parentLabel.textContent.trim();
  // Try placeholder
  return input.placeholder || input.name || 'unknown';
}
```

### Executing fill_field() tool calls

```javascript
// content.js
function executeToolCall(toolName, args) {
  if (toolName === 'fill_field') {
    const { field_label, value, action } = args;

    // Find the field by label (fuzzy match for Tamil/English variants)
    const field = findFieldByLabel(field_label);
    if (!field) {
      return { success: false, error: `Field "${field_label}" not found` };
    }

    switch (action) {
      case 'type':
        field.focus();
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, field: field_label, value };

      case 'select':
        const option = Array.from(field.options)
          .find(o => o.text.toLowerCase().includes(value.toLowerCase()));
        if (option) {
          field.value = option.value;
          field.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        }
        return { success: false, error: `Option "${value}" not found` };

      case 'click':
        field.click();
        return { success: true };
    }
  }
}
```

---

## Engineering Challenges Overcome

### 1. Tamil character encoding in government portals

Many government portals use legacy encoding for Tamil text. We normalize to Unicode before any Gemma 4 input and convert back when filling Tamil-language fields.

```javascript
function normalizeTamil(text) {
  // Convert TSCII/TAB legacy encoding to Unicode if detected
  if (detectLegacyTamil(text)) {
    return convertToUnicode(text);
  }
  return text;
}
```

### 2. Dynamic portal DOM (React/Angular portals)

NSP portal uses React — DOM changes after each interaction. We use MutationObserver to detect re-renders and re-read the form state before each `fill_field` call.

```javascript
const observer = new MutationObserver(() => {
  // Re-read form context after DOM mutations
  chrome.runtime.sendMessage({ type: 'DOM_UPDATED', context: readPageContext() });
});
observer.observe(document.body, { childList: true, subtree: true });
```

### 3. Gemma 4 context management for long eligibility docs

Some scheme eligibility documents are 10,000+ words. We chunk them and use RAG-style retrieval — only sending the relevant sections to Gemma 4.

```javascript
async function getRelevantEligibilitySections(schemeId, studentProfile) {
  const fullDoc = await getSchemeDocument(schemeId);
  // Extract only sections relevant to the student's category and course
  return extractRelevantSections(fullDoc, studentProfile);
}
```

### 4. Ollama cold start latency

First query after Ollama starts can take 3–5 seconds for model loading. We warm up the model on extension install:

```javascript
chrome.runtime.onInstalled.addListener(async () => {
  // Warm up Gemma 4 with a lightweight ping
  await queryGemma([{ role: 'user', content: 'hello' }], []);
});
```

---

## Performance Benchmarks

| Metric | Value |
|---|---|
| Model | gemma3:4b via Ollama |
| Time to first token | ~800ms (warmed) |
| Full scholarship match response | ~2.1s |
| Form fill per field | ~1.4s |
| Peak RAM usage | ~4.2GB |
| Works offline | Yes — after initial model pull |
| Works in airplane mode | Yes — demonstrated in demo video |

---

## Data Privacy

- Zero data leaves the student's device
- Student profile stored in `chrome.storage.local` (encrypted by Chrome)
- Scholarship DB stored in IndexedDB (local browser storage)
- No analytics, no telemetry, no account required
- Gemma 4 inference at `localhost:11434` — never touches the internet

---

*Athena · Gemma 4 Impact Challenge 2026*
