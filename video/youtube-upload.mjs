#!/usr/bin/env node
/**
 * Compatibility wrapper for the setup guide's `youtube-upload.mjs` command.
 * Delegates to the existing publish.mjs implementation so uploads are logged
 * for analytics and share the same OAuth cache.
 */
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_DIR = dirname(fileURLToPath(import.meta.url));

export function buildPublishArgs(argv) {
  const args = ["publish.mjs", ...argv];
  if (!argv.includes("--kind")) args.push("--kind", "avatar");
  return args;
}

async function main() {
  const args = buildPublishArgs(process.argv.slice(2));
  execFileSync(process.execPath, args, { cwd: VIDEO_DIR, stdio: "inherit" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}
