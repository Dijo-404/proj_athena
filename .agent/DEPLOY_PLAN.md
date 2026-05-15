# Athena — Deployment-Readiness Plan

**Status:** Drafted 2026-05-15. Source of truth for fixing all issues before shipping to Chrome Web Store / GitHub Release.

**Scope:** Bring Athena (Tamil-first Scholarship Agent, Chrome MV3 extension) from current `0.1.0` pre-release state to a publishable, robust extension. Keep the dual-inference architecture (WebLLM primary, Ollama fallback). Do **not** rewrite anything that already works.

---

## Phase 0: Discovery (COMPLETE — embedded below)

### Project shape (verified against disk)

```
proj_athena/
├── manifest.json             MV3, ver 0.1.0, perms: storage/unlimitedStorage/activeTab/scripting/alarms/tabs/sidePanel
├── package.json              type=module, dep: @mlc-ai/web-llm@^0.2.0, devDep: esbuild@^0.28.0
├── background.js             service_worker, importScripts data/db.js + agent/matcher.js + agent/tracker.js
├── content.js                content script, MutationObserver → DOM_UPDATED
├── sidepanel.html            UI, 306 lines, loads data/db.js + agent/matcher.js + sidepanel.js (module)
├── sidepanel.js              UI controller, WebLLM-primary + Ollama-fallback, voice input
├── agent/{matcher,filler,tracker}.js
├── data/{db.js,schemes.json,portals.json}
├── locales/{en,ta}.json      43 keys each, 100% parity
├── styles/sidepanel.css      Apple design system, 898 lines
├── icons/{icon48,icon128}.png
├── scripts/{build,package,bundle-webllm,generate-icons}.mjs
└── .github/workflows/{ci,release}.yml   Node 20, ubuntu, zip-based packaging
```

### Allowed APIs / Patterns (verified)

| API / Pattern | Status | Source |
|---|---|---|
| `import(chrome.runtime.getURL("webllm.js"))` from sidepanel | **Allowed in MV3** — chrome-extension:// URLs are first-party | [sidepanel.js:375-376] |
| `importScripts(...)` in service worker | **Allowed in MV3** — only `eval()`/external script is blocked | [background.js:3] |
| `'wasm-unsafe-eval'` CSP | **Required** for WebLLM/WebGPU | [manifest.json:22] |
| `chrome.storage.local.set(...).then(...)` | Promise-based form available; prefer over callbacks | Chrome docs |
| `chrome.runtime.sendMessage` async | Returning `true` from listener keeps `sendResponse` valid | Chrome docs |

### Anti-patterns to avoid

- Inventing `chrome.storage.sync` use (this extension uses `local` deliberately for offline; don't switch)
- Removing `'wasm-unsafe-eval'` (breaks WebLLM)
- Switching localhost:11434 to remote URL (breaks the "zero data leaves device" claim)
- Adding new runtime dependencies (build deliberately bundles a single dep — `@mlc-ai/web-llm`)
- Removing the `<|think|>` Gemma 3+ thinking token from system prompt without verifying the chosen model supports it

### Known false positives from initial audit (DO NOT "fix")

1. `import(chrome.runtime.getURL(...))` is **NOT** an MV3 violation — chrome-extension:// scheme is first-party.
2. `importScripts()` in service worker is **NOT** an MV3 violation — only `eval()`/remote code is blocked.
3. Missing `web_accessible_resources` is correct — nothing here is loaded by a web page; everything stays inside the extension.
4. i18n parity is already 100% en↔ta — no work needed there.

---

## Phase 1: Correctness Fixes (BLOCKING)

**Goal:** Eliminate the actual bugs flagged in audit. Each task is a small, surgical edit.

### Task 1.1 — Voice input crash on empty result
- **File:** [sidepanel.js:820-823](sidepanel.js#L820-L823)
- **Bug:** `event.results[0][0].transcript` throws if `results` is empty.
- **Fix:** Guard with `event.results?.[0]?.[0]?.transcript`; if missing, log to status and return early. Do NOT submit form on empty transcript.
- **Verify:** Open side panel, click voice button, immediately stop without speaking → no console exception, status returns to "Ready".

### Task 1.2 — `saveProfile` silently drops errors and shows no confirmation
- **File:** [sidepanel.js:868-870](sidepanel.js#L868-L870)
- **Bug:** No callback, no toast/status update — user has no signal of success/failure.
- **Fix:** Use Promise form: `chrome.storage.local.set({ studentProfile: profile }).then(() => setStatus("Profile saved","ready")).catch(err => setStatus("Save failed","error"))`. Reset status to "Ready" after 2s on success.
- **Verify:** Click Save Profile → status pill flashes "Profile saved" → reverts to "Ready".

### Task 1.3 — `loadProfile` silent failure
- **File:** [sidepanel.js:872-878](sidepanel.js#L872-L878)
- **Fix:** Convert to Promise form, add `.catch(err => console.warn("loadProfile failed", err))`. Keep behavior: empty form on missing profile is acceptable; the issue is silent corruption.
- **Verify:** Manually corrupt the storage key in DevTools → reload panel → console shows the warn, form stays empty.

### Task 1.4 — `DOM_UPDATED` handler can hang `sendResponse`
- **File:** [background.js:169-178](background.js#L169-L178)
- **Bug:** If `chrome.storage.local.set` fails, `sendResponse` is never called.
- **Fix:** Check `chrome.runtime.lastError` inside callback; always call `sendResponse({ok, error?})`.
- **Verify:** Force a quota error (write 10MB to storage in DevTools first) → background still responds.

### Task 1.5 — Race on `ensureLocalDb` and `ensureLocalModel`
- **File:** [sidepanel.js:349-361](sidepanel.js#L349-L361), [sidepanel.js:363-397](sidepanel.js#L363-L397)
- **Bug:** Two parallel `await ensureLocalDb()` calls both pass the `if (localDbReady) return` check before the init promise resolves.
- **Fix:** Pattern already used correctly for `ensureLocalModel` (cache the in-flight promise). Apply the same to `ensureLocalDb`: store an `localDbPromise` and return it if set.
- **Verify:** In DevTools, run `Promise.all([ensureLocalDb(), ensureLocalDb()])` → only one IndexedDB open observed in the Application tab.

### Task 1.6 — Tool return shape inconsistency
- **Files:** [agent/matcher.js:1-186](agent/matcher.js#L1), [sidepanel.js:458-485](sidepanel.js#L458-L485)
- **Bug:** `matchScholarships` returns either an array (success) or `{error}` (failure). Callers must check both shapes.
- **Fix:** Wrap `matchScholarships` return as `{ok: true, matches: [...]}` on success and `{ok: false, error}` on failure. Update both callers (sidepanel.js `executeLocalTool` and background.js's tool dispatcher) to read `result.matches` on success.
- **Verify:** `grep -n "matchScholarships" sidepanel.js background.js` → all call sites use the new shape; agent loop still runs end-to-end.

### Task 1.7 — Mutation observer never disconnected
- **File:** [content.js:20-31](content.js#L20-L31)
- **Fix:** Store the observer in module scope. Add `window.addEventListener("pagehide", () => observer.disconnect())` to clean up on navigation. This is defensive — Chrome usually GCs on context destroy.
- **Verify:** Navigate between two pages in same tab → only one observer reported in `chrome://discards` per page lifetime.

### Verification checklist for Phase 1
- [ ] `npm run build` succeeds with no warnings
- [ ] Load `dist/athena` unpacked, open side panel, no console errors
- [ ] Save Profile shows confirmation
- [ ] Voice button with no speech does not throw
- [ ] Chat message with WebLLM disabled (DevTools: `delete navigator.gpu`) gracefully falls back to Ollama or shows clear error

---

## Phase 2: Production Hardening

**Goal:** Make failure modes survivable. Don't change architecture — add guardrails.

### Task 2.1 — Status pill must reflect Ollama / WebLLM / offline state distinctly
- **Files:** [sidepanel.js](sidepanel.js), [background.js:checkOllamaConnection](background.js)
- **Spec:**
  - "Ready" (green) — WebLLM loaded OR Ollama reachable
  - "Loading model 42%" — WebLLM init
  - "Using Ollama" — fell back to localhost
  - "Offline mode" (amber) — neither available, only local matching tools work
- **Fix:** Add a `inferenceStatus` state machine in sidepanel.js. Drive it from `ensureLocalModel` progress callback and from a one-shot `checkOllamaConnection` ping at startup (already exists in background.js, expose via message).
- **Verify:** Disable WebGPU in Chrome flags → status reads "Using Ollama" or "Offline mode" depending on Ollama.

### Task 2.2 — Friendly error UI when both inference paths are unavailable
- **File:** [sidepanel.js](sidepanel.js) (the chat send handler)
- **Fix:** On chat submit with neither WebLLM ready nor Ollama reachable, render an assistant bubble explaining the situation in TA + EN, with link instructions to install Ollama or enable WebGPU. Reuse i18n keys; add 2 new keys `error_no_inference_ta` / `error_no_inference_en` if needed and update both locale files.
- **Verify:** Force both off → bubble appears; both locale files contain the new key.

### Task 2.3 — Remove debug `console.log` from production paths
- **Files:** [background.js:474](background.js#L474), any other `console.log` in non-error paths
- **Fix:** Replace with no-op or guard with `if (DEBUG)` constant defined at top of file. Keep `console.error` for genuine failures.
- **Verify:** `grep -rn "console.log" *.js agent/ data/` returns only intentional uses (none in production paths).

### Task 2.4 — Bump version to a real release tag
- **Files:** [manifest.json:4](manifest.json#L4), [package.json](package.json)
- **Fix:** Set both to `1.0.0`. Match exactly.
- **Verify:** `npm run build` then check `dist/athena/manifest.json` reads `1.0.0`.

### Verification checklist for Phase 2
- [ ] Three status states reachable manually
- [ ] Both locale files have any new keys
- [ ] No stray `console.log` in shipped code
- [ ] manifest.json and package.json versions match

---

## Phase 3: Security & Permissions Hardening

**Goal:** Pass Chrome Web Store review. Web Store rejects overly broad permissions and loose CSP.

### Task 3.1 — Tighten content_scripts matches
- **File:** [manifest.json:11-16](manifest.json#L11-L16)
- **Current:** `"matches": ["<all_urls>"]` — runs on every site the user visits.
- **Fix:** Limit to the four supported portals enumerated in README and `data/portals.json`:
  ```json
  "matches": [
    "https://scholarships.gov.in/*",
    "https://*.tnscholarship.net/*",
    "https://egrantz.tn.gov.in/*",
    "https://www.buddy4study.com/*"
  ]
  ```
- **Why:** `<all_urls>` triggers "this extension can read and change all your data on all websites" warning at install — major adoption blocker.
- **Verify:** `chrome://extensions` shows narrowed permission warning after reload.

### Task 3.2 — Tighten CSP `connect-src`
- **File:** [manifest.json:21-23](manifest.json#L21-L23)
- **Current:** `connect-src 'self' http://localhost:11434 https://* wss://* data: blob: chrome-extension://*` — `https://*` lets the agent contact any HTTPS host.
- **Fix:** Drop `https://*` and `wss://*` unless a specific cloud endpoint is actually used. Final policy:
  ```
  script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' http://localhost:11434 data: blob:; worker-src 'self'
  ```
- **Verify:** Manual test of full chat flow with WebLLM → no CSP violations in console. Ollama fallback still works.

### Task 3.3 — Drop unused permissions
- **File:** [manifest.json:6](manifest.json#L6)
- **Audit:**
  - `tabs` — used? Check `chrome.tabs.*` in code. If only `activeTab` semantics are needed, drop `tabs`.
  - `unlimitedStorage` — needed only if IndexedDB might exceed ~5MB. Scholarship DB is small; drop unless evidence shows otherwise.
  - `alarms` — used by `chrome.alarms.create` for daily sync, keep.
  - `scripting` — used by content scripts implicit injection; check if `chrome.scripting.executeScript` is called. If not, drop.
- **Fix:** Audit each by `grep`, drop unused, keep used.
- **Verify:** Reload extension, exercise all flows, no permission errors.

### Task 3.4 — Add privacy policy file
- **New file:** `PRIVACY.md` at repo root.
- **Content:** State plainly: all data stays on device (chrome.storage.local + IndexedDB), no analytics, no telemetry, no third-party requests except optional Ollama on user's own machine. List exactly what is stored.
- **Why:** Chrome Web Store listing requires a privacy policy URL.
- **Verify:** File exists, accurate.

### Verification checklist for Phase 3
- [ ] Reduced permission list; installer warning is minimal
- [ ] CSP no longer contains `https://*`
- [ ] Extension still works end-to-end on the four supported portals
- [ ] PRIVACY.md exists and is accurate

---

## Phase 4: Build & Release Pipeline

**Goal:** One command should produce a publishable artifact. CI should fail loudly on regressions.

### Task 4.1 — Cross-platform packaging
- **File:** [scripts/package.mjs](scripts/package.mjs)
- **Bug:** Spawns `zip` CLI — not present on stock Windows.
- **Fix:** Replace with `archiver` npm package, or use Node's built-in approach via `node:zlib` + manual ZIP writer. Cleanest: add `archiver` as devDep and rewrite package.mjs to use it. Keep the same output path `dist/athena.zip`.
- **Verify:** `npm run package` runs on Windows and Linux, producing identical zip structure.

### Task 4.2 — Add a `validate` script
- **File:** [package.json](package.json) `scripts` section
- **Fix:** Add `"validate": "node scripts/validate.mjs"` that:
  - Confirms manifest.json passes a minimal MV3 schema check
  - Confirms all `data-i18n` keys in sidepanel.html exist in both locale files
  - Confirms all script src/link href in HTML resolve to files on disk
- **Verify:** `npm run validate` exits 0 on clean repo, exits 1 if a locale key is missing.

### Task 4.3 — Wire validate into CI
- **File:** [.github/workflows/ci.yml](.github/workflows/ci.yml)
- **Fix:** Insert `npm run validate` step between `npm ci` and `npm run build`.
- **Verify:** Push a branch with a missing locale key → CI red.

### Task 4.4 — Add Chrome Web Store listing assets
- **New folder:** `store-assets/`
- **Contents:** Three screenshots (1280×800), one small promo tile (440×280), description text in EN and TA. Capture in DevTools device emulation at 1280×800 with the side panel open.
- **Verify:** Folder exists, files present.

### Verification checklist for Phase 4
- [ ] `npm run package` succeeds on Windows without external `zip`
- [ ] `npm run validate` catches a synthetic missing-i18n-key
- [ ] CI runs validate step
- [ ] store-assets/ populated

---

## Phase 5: Final Verification

Run before tagging a release.

1. `npm ci && npm run validate && npm run build && npm run package`
2. Load `dist/athena/` unpacked, exercise:
   - First-run profile save → reload → profile restored
   - "Find Matches" → results appear, ranked
   - Chat with WebLLM (any browser with WebGPU)
   - Chat with WebLLM disabled (delete navigator.gpu) → Ollama fallback if running, otherwise friendly offline error
   - Voice input in Tamil locale → transcript appears
   - "Track" button on a match → appears in Applications panel after refresh
3. Confirm `chrome://extensions` shows the narrowed permission warning
4. Confirm DevTools console has zero red entries on cold-load
5. Run on the four supported portals → content script injects, DOM_UPDATED fires
6. Tag `v1.0.0` → release workflow produces `athena.zip` artifact on GitHub Releases

### Anti-patterns guard (grep before tagging)
- `grep -rn "console.log" *.js agent/ data/` → only intentional matches
- `grep -rn "TODO\|FIXME\|XXX" *.js agent/ data/` → none, or each documented
- `grep -n "<all_urls>" manifest.json` → no match
- `grep -n "https://\*" manifest.json` → no match
- `grep -n "0\.1\.0" manifest.json package.json` → no match (version bumped)

---

## Out of scope (explicitly NOT in this plan)

- Adding a test suite (no test runner exists; not a Web Store gating requirement)
- Migrating to TypeScript
- Adding cloud LLM fallback (would invalidate "zero data leaves device" claim)
- Refactoring Apple design system CSS (just shipped, working)
- Adding more scholarship schemes to schemes.json (data work, separate task)
