# Athena Privacy Policy

Last updated: 2026-05-15

Athena is a Chrome extension that helps students in Tamil Nadu find and apply for government scholarships. Privacy is a core design principle.

## What we collect: nothing

Athena does not collect, transmit, or share any personal data. There is no telemetry, no analytics, no third-party trackers.

## Where your data lives

All data stays on your device, in Chrome's local storage areas:

- **chrome.storage.local** — Your student profile (name, caste category, income, course, district, language preference), tracked scholarship applications, and the last DOM snapshot of any supported scholarship portal you have visited while the extension is enabled.
- **IndexedDB** (origin: `chrome-extension://[extension-id]`) — The pre-seeded list of 50+ scholarship schemes shipped with the extension, refreshed daily from the local snapshot, never from a remote server.

Uninstalling the extension or clearing browser data removes everything.

## Network requests

Athena makes network requests only to:

- **`http://localhost:11434`** — If you have installed Ollama on your own machine, Athena uses it as a fallback when WebGPU is unavailable. The request never leaves your computer.
- **WebLLM model weights** — On first chat, the WebLLM library downloads Gemma 2 2B model weights from `huggingface.co` and `raw.githubusercontent.com`. Model files are then cached in your browser and reused offline. Your data is never sent to those domains; only the public model files are downloaded.

There are no other network endpoints.

## Permissions

Athena requests the minimum permissions required:

| Permission | Why |
|---|---|
| `storage` | Save your profile and tracked applications on your device |
| `activeTab` | Fill scholarship application forms in the tab you are currently viewing, only when you ask Athena to |
| `alarms` | Refresh the local scholarship list once per day |
| `sidePanel` | Render the Athena interface in Chrome's side panel |
| `host_permissions: http://localhost:11434/*` | Call Ollama if you have it installed locally |

Content scripts run **only** on these four government scholarship portals:

- `scholarships.gov.in`
- `tnscholarship.net`
- `egrantz.tn.gov.in`
- `buddy4study.com`

They do not run on any other website.

## Contact

Open an issue at the project's GitHub repository.
