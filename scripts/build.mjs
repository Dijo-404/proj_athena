import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "./bundle-webllm.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const distRoot = path.join(root, "dist");
const distDir = path.join(distRoot, "athena");

export async function build() {
  await fs.rm(distRoot, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  const entries = await fs.readdir(srcDir);
  for (const entry of entries) {
    await copyEntry(path.join(srcDir, entry), path.join(distDir, entry));
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
