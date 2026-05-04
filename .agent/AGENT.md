# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Athena is a Chrome extension (Manifest V3) that helps first-generation Tamil Nadu students find and auto-fill government scholarship applications. Powered by Gemma 4 running locally via Ollama — no cloud, works offline.

## Architecture

```
Chrome Extension (sidepanel + content script)
        |
        v
background.js (service worker)
        |
        v
Ollama API (localhost:11434)
        |
        v
Gemma 4 (gemma3:4b) with function calling
```

**Core agent loop**: Gemma 4 outputs structured JSON tool calls that drive autonomous actions. The agent loop continues until no more tool calls are returned.

```
match_scholarships(profile) -> Ranked JSON list
check_eligibility(scheme_id) -> Eligibility reasoning (Tamil)
fill_field(selector, value) -> DOM action on portal
get_deadline(scheme_id) -> Application deadline
```

**Tamil reasoning**: System prompt instructs Gemma 4 to respond in Tamil directly — no translation layer. Uses `<|think|>` token for explainable eligibility decisions.

**Offline-first**: Scholarship database pre-seeded in IndexedDB, all data stays on device.

## Documentation

- `ARCHITECTURE.md` — Technical deep-dive: Ollama API calls, function schemas, agent loop, IndexedDB, form executor, engineering challenges
- `README.md` — Project overview, quick start, supported portals

## Development

This project currently has only documentation files — no source code exists yet. The `.claude/PLAN.md` contains a phased implementation plan.

### Prerequisites
- Chrome browser
- [Ollama](https://ollama.com) installed and running
- Pull model: `ollama pull gemma3:4b`

### Running
1. Open Chrome → `chrome://extensions`
2. Enable Developer Mode
3. Click Load unpacked → select project folder

### CORS for Ollama
```bash
# macOS
launchctl setenv OLLAMA_ORIGINS "*"

# Linux
sudo systemctl edit ollama  # Add Environment="OLLAMA_ORIGINS=*"
```

### Extension structure
- `manifest.json` — Extension config (Manifest V3)
- `background.js` — Service worker, routes messages between content script and Ollama
- `content.js` — Injected into scholarship portals, reads DOM and executes fill_field calls
- `sidepanel.html/js` — Main UI with Tamil voice input (Web Speech API)
- `agent/` — matcher.js, filler.js, tracker.js for scholarship operations
- `data/` — Pre-seeded scholarship database (schemes.json), portal selectors (portals.json)

## Key Constraints

- All inference runs at `localhost:11434` — never touches the internet
- Data stored in `chrome.storage.local` and IndexedDB (local only)
- No telemetry, no analytics, no external APIs
- Must use Manifest V3 (service workers, not background pages)

## Code Standards

- No emojis in code or comments — keep it clean and professional
- Write minimal, clean code — no unnecessary abstractions or boilerplate
- No unwanted comments — only explain non-obvious decisions
- Never run `git push` — ask the user before pushing
- Never run `git commit` — ask the user before committing
- After any commit, review the diff to verify changes are correct
- Always run prettier and ruff after generating code to ensure formatting and linting standards are met