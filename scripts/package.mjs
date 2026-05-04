import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { build } from "./build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist");
const zipPath = path.join(distRoot, "athena.zip");

await build();
await fs.rm(zipPath, { force: true });

const result = spawnSync("zip", ["-r", "athena.zip", "athena"], {
  cwd: distRoot,
  stdio: "inherit",
});

if (result.error && result.error.code === "ENOENT") {
  console.error(
    "zip CLI not found. Install zip or use 7z to create athena.zip.",
  );
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
