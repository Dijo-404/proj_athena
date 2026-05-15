# Athena: A Tamil-First, Offline Scholarship Agent for First-Generation Students

**Track:** Digital Equity & Inclusivity  
**Special Technology:** Ollama  
**Model:** Gemma 4 E2B via Ollama (local inference)

---

## The Problem

Every year, an estimated ₹3,000 crore in government scholarship funds go unclaimed across India. The students who need this money the most — first-generation college students from rural Tamil Nadu, from BC, MBC, SC, and ST communities — are precisely the ones least likely to successfully navigate the application process.

The barrier is not eligibility. Millions of students qualify. The barrier is access. Government portals like the National Scholarship Portal (NSP) and Tamil Nadu's e-Grantz system are English-only, riddled with bureaucratic terminology, and require reliable internet connectivity to use. A student in a village near Madurai with a 2G connection and no English literacy is effectively locked out of financial support that is legally entitled to her.

Cloud-based AI tools could theoretically help, but they introduce new barriers: subscription costs, data privacy risks, and the fundamental requirement of a stable internet connection. For the 80 million Tamil speakers in Tamil Nadu — many of whom are the first in their families to attend college — these tools are as inaccessible as the portals they are meant to navigate.

Athena addresses this gap directly.

---

## The Solution

Athena is an offline-first Chrome extension powered by Gemma 4 running locally via Ollama. It acts as a fully autonomous scholarship agent: it finds schemes that match a student's profile, explains eligibility in spoken Tamil, and automatically fills government application forms — all without an internet connection, all without any data leaving the student's device.

A student opens Athena, speaks in Tamil: *"என்னுடைய படிப்புக்கு என்ன scholarship கிடைக்கும்?"* ("What scholarships can I get for my studies?"). Within seconds, Gemma 4 has matched her profile against a local database of 50+ schemes and returned a ranked list in Tamil with amounts, deadlines, and a plain-language explanation of why she qualifies. She taps "Apply." The agent navigates to the NSP portal and fills the entire form — name, caste certificate number, bank account, course details — field by field, in under a minute. The internet is optional. The agent works in airplane mode once the scholarship database is seeded.

---

## How Gemma 4 Powers Athena

The technical architecture is built specifically around four capabilities unique to Gemma 4. This is not a generic chatbot wrapped around a model — each Gemma 4 feature is load-bearing.

### Native Function Calling

The autonomous form-fill capability is built entirely on Gemma 4's native structured output. The model receives the student's profile and the page's DOM context, then outputs JSON tool calls: `match_scholarships()`, `check_eligibility()`, `fill_field()`, and `get_deadline()`. These tool calls are executed by a content script injected into the scholarship portal, which manipulates the DOM directly.

This is architecturally distinct from prompt-based approaches. The model does not describe what to do — it specifies the exact field label, the exact value, and the exact interaction type (`type`, `select`, `click`). Multi-step form completion is handled by a loop: Gemma 4 calls a tool, receives the result, and decides the next action without human intervention. A complete NSP application form — 24 fields across three pages — is completed in a single agentic loop.

### Multilingual Tamil Reasoning

Gemma 4's 140+ language training base handles Tamil natively. There is no translation pipeline, no external API, no latency penalty. The system prompt instructs Gemma 4 to reason and respond in Tamil when the student's profile specifies `language: "ta"`. Voice input is handled by the Web Speech API with the `ta-IN` locale, converting spoken Tamil to text before sending to Gemma 4.

The Tamil interface is not cosmetic. The model reasons about eligibility criteria in Tamil, explains complex bureaucratic terms in plain conversational language ("உங்கள் குடும்ப வருமானம் ₹2.5 லட்சத்திற்கும் குறைவாக இருப்பதால் தகுதியானீர்கள்"), and generates follow-up reminders in Tamil. This is what makes the tool genuinely usable by its intended users — not just technically accessible, but cognitively accessible.

### Thinking Mode for Explainable Eligibility

Scholarship eligibility decisions are high-stakes and often complex. A student denied an application she was entitled to loses real money. We use Gemma 4's `<|think|>` token to require the model to reason step-by-step before every eligibility verdict: checking income limits, caste category mappings (MBC falls under OBC for central schemes), percentage cutoffs, and mutual exclusivity rules between state and central schemes.

The visible reasoning trace is not just a technical feature — it is a trust feature. A student can see *why* she was matched to a scheme. A community organization reviewing applications can audit the decisions. This explainability is what separates Athena from a black-box recommendation engine.

### Local-First via Ollama

All inference runs at `localhost:11434` via Ollama. The Gemma 4 E2B model runs on the student's own hardware. No query, no profile, no personal data ever leaves the device. The entire pipeline — voice input, eligibility reasoning, form filling, application tracking — operates offline after the one-time model download.

This is demonstrated in the video by switching the device to airplane mode mid-session and completing a full application flow. The offline capability is not a fallback — it is the core design principle. Rural students with intermittent connectivity should not be penalized for infrastructure gaps that are not their fault.

---

## Architecture

The system has four components. The Chrome extension (Manifest V3) hosts a side panel UI that handles voice input, the chat interface, and the application dashboard. A background service worker manages communication between the UI and Ollama. A content script, injected into scholarship portals, reads the DOM and executes the tool calls returned by Gemma 4. An offline IndexedDB database, pre-seeded with 50+ real schemes from NSP, TN e-Grantz, and Tamil Nadu state portals, enables all matching and eligibility checks without internet.

The student profile is stored in `chrome.storage.local`. All scholarship data lives in IndexedDB. Nothing is sent to any server.

---

## Engineering Challenges

Three problems required non-trivial solutions.

**Tamil character encoding in legacy portals.** Several Tamil Nadu state portals use TSCII or TAB encoding rather than Unicode. We built a normalization layer that detects legacy-encoded Tamil in DOM text and converts it before sending to Gemma 4, then reverses the conversion when filling Tamil-language fields.

**Dynamic DOM on React-based portals.** The NSP portal renders with React — fields appear and disappear as the user progresses through sections. A MutationObserver in the content script detects DOM changes and re-reads the form context before each `fill_field()` call, ensuring Gemma 4 always operates on the current state of the page.

**Gemma 4 cold start latency.** The first query after Ollama initializes incurs a 3–5 second model load penalty. We send a lightweight warm-up query at extension install time and cache the result, so the model is ready when the student first opens Athena.

---

## Impact

Tamil Nadu has approximately 3.2 million students enrolled in higher education. A majority come from BC, MBC, SC, or ST communities and meet the income criteria for at least one government scheme. Current application rates for NSP Post-Matric scholarships in Tamil Nadu are estimated at under 40% of eligible students — a gap worth hundreds of crore annually.

Athena is designed to close this gap. It requires no English literacy, no reliable internet, no technical knowledge, and no money. It works on any laptop or Android device that can run Ollama. A school teacher, an NGO worker, or a student herself can use it without training.

The immediate roadmap includes a mobile-native version via Gemma 4 E2B deployed with LiteRT, support for 10 additional Indian languages, and DigiLocker integration for automatic document attachment. The long-term vision is a pan-India scholarship agent that makes the ₹3,000 crore unclaimed problem a historical artifact.

---

## Why Gemma 4

A cloud model could have been used for this application. It was deliberately not. A student in a village with a 2G connection and a ₹8,000 phone should not depend on OpenAI's servers to apply for a scholarship. Gemma 4's efficiency — 2.3 billion active parameters achieving reasoning quality competitive with models ten times its size — makes truly local, truly private, truly accessible AI possible for the first time. Athena exists because Gemma 4 does.

---

**Repository:** [github.com/YOUR_USERNAME/athena](https://github.com)  
**Live Demo:** [huggingface.co/spaces/YOUR_SPACE](https://huggingface.co)  
**Video:** [youtube.com/YOUR_LINK](https://youtube.com)

*Word count: ~1,180 words — within the 1,500-word limit*
