import * as esbuild from "esbuild";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist", "athena");

export async function bundle() {
  await esbuild.build({
    entryPoints: [path.join(root, "node_modules/@mlc-ai/web-llm/lib/index.js")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    outfile: path.join(distRoot, "webllm.js"),
    minify: true,
    sourcemap: false,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    alias: {
      url: "url",
    },
    external: [],
    logLevel: "info",
  });
  console.log("Bundled web-llm to webllm.js");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bundle().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}