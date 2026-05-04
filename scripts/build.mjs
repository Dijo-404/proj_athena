import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "./bundle-webllm.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist");
const distDir = path.join(distRoot, "athena");

const include = [
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "sidepanel.js",
  "styles",
  "agent",
  "data",
  "locales",
  "icons",
];

export async function build() {
  await fs.rm(distRoot, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  for (const entry of include) {
    const src = path.join(root, entry);
    const dest = path.join(distDir, entry);
    await copyEntry(src, dest);
  }

  await bundle();
}

async function copyEntry(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const entry of entries) {
      await copyEntry(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  await fs.copyFile(src, dest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
