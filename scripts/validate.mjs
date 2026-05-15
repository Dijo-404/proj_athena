import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const errors = [];

const manifestPath = path.join(srcDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
if (!manifest.name) errors.push("manifest.name missing");
if (!manifest.version) errors.push("manifest.version missing");
if (!manifest.description) errors.push("manifest.description missing");
if (!manifest.background?.service_worker)
  errors.push("background.service_worker missing");
if (!manifest.icons?.["48"] || !manifest.icons?.["128"])
  errors.push("icons 48/128 missing");
if (!manifest.side_panel?.default_path)
  errors.push("side_panel.default_path missing");

const html = await fs.readFile(path.join(srcDir, "sidepanel.html"), "utf8");
const i18nKeys = new Set();
for (const m of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
  i18nKeys.add(m[1]);
}

const en = JSON.parse(
  await fs.readFile(path.join(srcDir, "locales/en.json"), "utf8"),
);
const ta = JSON.parse(
  await fs.readFile(path.join(srcDir, "locales/ta.json"), "utf8"),
);

for (const key of i18nKeys) {
  if (!(key in en)) errors.push(`Missing in en.json: ${key}`);
  if (!(key in ta)) errors.push(`Missing in ta.json: ${key}`);
}

const enKeys = new Set(Object.keys(en));
const taKeys = new Set(Object.keys(ta));
for (const k of enKeys) {
  if (!taKeys.has(k)) errors.push(`ta.json missing key present in en.json: ${k}`);
}
for (const k of taKeys) {
  if (!enKeys.has(k)) errors.push(`en.json missing key present in ta.json: ${k}`);
}

const fileRefs = [];
for (const m of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
  const ref = m[1];
  if (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("data:") ||
    ref.startsWith("//")
  )
    continue;
  fileRefs.push(ref);
}
for (const ref of fileRefs) {
  try {
    await fs.access(path.join(srcDir, ref));
  } catch (_) {
    errors.push(`File referenced in sidepanel.html not found: ${ref}`);
  }
}

for (const iconRef of Object.values(manifest.icons || {})) {
  try {
    await fs.access(path.join(srcDir, iconRef));
  } catch (_) {
    errors.push(`Icon file not found: ${iconRef}`);
  }
}

const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
if (manifest.version !== pkg.version) {
  errors.push("manifest.json version does not match package.json version");
}

const REQUIRED_MODULES = [
  "background.js",
  "sidepanel.js",
  "content.js",
  "lib/messages.js",
  "lib/portals.js",
  "lib/profile.js",
  "lib/prompt.js",
  "lib/tools.js",
  "lib/parse.js",
  "lib/agent-loop.js",
  "data/db.js",
  "data/schemes.json",
  "agent/matcher.js",
  "agent/tracker.js",
  "agent/filler.js",
];
for (const mod of REQUIRED_MODULES) {
  try {
    await fs.access(path.join(srcDir, mod));
  } catch {
    errors.push(`Required module missing: src/${mod}`);
  }
}

if (manifest.background?.service_worker && manifest.background.type !== "module") {
  errors.push(
    'manifest.background.type must be "module" (background uses ES imports)',
  );
}

if (errors.length) {
  console.error("Validation failed:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log("Validation passed.");
