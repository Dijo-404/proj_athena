# Athena — Tamil-first Scholarship Agent

> **Built for the Google Gemma 4 Impact Challenge**  
> An offline-first, Tamil-language browser agent that finds and auto-fills government scholarship applications for first-generation students — powered entirely by Gemma 4 running locally via Ollama.

---

## The Problem

**₹3,000 crore in government scholarships go unclaimed every year in India.**

Not because students don't qualify — but because:
- Portals are English-only in a country with 22 official languages
- Eligibility criteria are buried in bureaucratic language
- Rural students have no reliable internet to navigate cloud-based tools
- First-generation students have no one to guide them through the process

In Tamil Nadu alone, schemes like the BC/MBC Scholarship, NSP Post-Matric Award, and Tamil Nadu e-Grantz serve millions — yet application rates remain devastatingly low.

---

## The Solution

Athena is a Chrome extension powered by **Gemma 4 running locally via Ollama**. It:

1. **Finds** scholarships that match a student's profile (caste, income, marks, course, district)
2. **Explains** eligibility in plain Tamil — spoken or typed
3. **Fills** application forms automatically across government portals
4. **Tracks** deadlines and application status in a local dashboard
5. **Works offline** — once seeded, no internet required

Everything runs on the student's own device. No cloud. No subscription. No data shared.

---

## Demo

[![Watch the demo](https://img.shields.io/badge/Watch-Demo%20Video-red?style=for-the-badge&logo=youtube)](https://youtube.com/YOUR_LINK_HERE)

[![Live Demo](https://img.shields.io/badge/Try-Live%20Demo-blue?style=for-the-badge)](https://huggingface.co/spaces/YOUR_SPACE_HERE)

---

## How Gemma 4 Powers This

| Feature | How Athena uses it |
|---|---|
| **Native function calling** | Gemma 4 outputs structured JSON tool calls (`match_scholarships`, `fill_field`, `check_eligibility`) to drive autonomous multi-step form filling |
| **Multilingual Tamil reasoning** | System prompt instructs Gemma 4 to reason and respond in Tamil — no translation layer needed |
| **Thinking mode** (`<\|think\|>`) | Eligibility decisions show step-by-step reasoning — explainable AI for high-stakes outcomes |
| **Local via Ollama** | All inference runs at `localhost:11434` — zero data leaves the device, works in airplane mode |

---

## Quick Start

### Prerequisites
- Chrome browser (Manifest V3 support)
- [Ollama](https://ollama.com) installed and running
- 8GB RAM minimum

### 1. Install Ollama and pull Gemma 4
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the model
ollama pull gemma3:4b

# Allow Chrome extension to connect
launchctl setenv OLLAMA_ORIGINS "*"   # macOS
# or
sudo systemctl edit ollama            # Linux — add Environment="OLLAMA_ORIGINS=*"
```

### 2. Load the extension
```bash
git clone https://github.com/YOUR_USERNAME/athena
cd athena
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select the `athena/` folder

### 3. Run it
1. Click the Athena icon in your toolbar
2. Fill in your student profile (takes 2 minutes)
3. Open any scholarship portal (try [scholarships.gov.in](https://scholarships.gov.in))
4. Ask Athena: *"என்னுடைய படிப்புக்கு என்ன scholarship கிடைக்கும்?"*

---

## Build & Packaging

Requires Node.js 18+ and the `zip` CLI (or replace with 7z).

```bash
# Generate minimal icons (only needed if you change them)
npm run icons

# Build into dist/athena for Chrome loading or packaging
npm run build

# Package as dist/athena.zip for Chrome Web Store
npm run package
```

## Project Structure

```
athena/
├── manifest.json          # Chrome extension config (Manifest V3)
├── background.js          # Service worker — Ollama communication
├── content.js             # DOM reader + form executor
├── sidepanel.html         # Main UI
├── sidepanel.js           # UI logic + Gemma 4 chat interface
├── agent/
│   ├── matcher.js         # Scholarship matching via function calling
│   ├── filler.js          # Form fill executor
│   └── tracker.js         # Application status tracker
├── data/
│   ├── schemes.json       # Pre-seeded scholarship database (50+ schemes)
│   └── portals.json       # Portal-specific DOM selectors
├── locales/
│   ├── ta.json            # Tamil UI strings
│   └── en.json            # English UI strings
├── ARCHITECTURE.md        # Deep technical documentation
└── KAGGLE_WRITEUP.md      # Competition submission writeup
```

---

## Supported Scholarship Portals

| Portal | Schemes covered | Auto-fill support |
|---|---|---|
| [scholarships.gov.in](https://scholarships.gov.in) (NSP) | 15+ central schemes | Yes |
| [tnscholarship.net](https://tnscholarship.net) | TN BC/MBC/SC/ST schemes | Yes |
| [Tamil Nadu e-Grantz](https://egrantz.tn.gov.in) | State welfare schemes | Partial |
| [Buddy4Study](https://buddy4study.com) | Private scholarships | Read-only matching |

---

## Architecture Overview

```mermaid
flowchart TD
  A[Student speaks Tamil] --> B[Web Speech API (ta-IN)]
  B --> C[Gemma 4 via Ollama\nFunction calling + Tamil reasoning]
  C --> D[match_scholarships(profile)\nRanked JSON list]
  C --> E[check_eligibility(scheme_id)\nEligibility reasoning]
  C --> F[fill_field(selector, value)\nDOM action]
  D --> G[Content script executes on portal]
  E --> G
  F --> G
  G --> H[Application submitted]
  H --> I[Status saved to chrome.storage.local]
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full technical details.

---

## Prize Track Eligibility

- **Digital Equity & Inclusivity** — Tamil language, offline access, first-gen students
- **Ollama Special Prize** — Core runtime, airplane mode demo
- **Future of Education** — Scholarship access as educational enabler
- **Main Track** — Vision + technical depth + real-world impact

---

## Roadmap

- [ ] Mobile app via LiteRT (Gemma 4 E2B on Android)
- [ ] Support for 10 more Indian languages (Hindi, Telugu, Kannada, Malayalam...)
- [ ] DigiLocker integration for automatic document attachment
- [ ] Reminder agent — proactive deadline notifications via local scheduler
- [ ] Offline PDF generation for postal submissions

---

## License

MIT License — free to use, fork, and build on.

---

## Built With

- [Gemma 4](https://ai.google.dev/gemma) by Google DeepMind
- [Ollama](https://ollama.com) for local model serving
- Chrome Extensions API (Manifest V3)
- Web Speech API for Tamil voice input
- IndexedDB for offline scholarship database

---

*Built for the Google Gemma 4 Impact Challenge · May 2026*
