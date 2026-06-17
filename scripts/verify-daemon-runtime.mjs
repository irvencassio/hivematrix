#!/usr/bin/env node
/**
 * Verifies the self-contained daemon bundle can load its native runtime deps
 * with the exact Node binary shipped inside dist/daemon.
 */

import { existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const repo = process.cwd();
const daemonDir = join(repo, "dist", "daemon");
const nodeBin = join(daemonDir, "bin", "node");
const daemonCjs = join(daemonDir, "daemon.cjs");

function die(message) {
  console.error(`\nX verify-daemon-runtime: ${message}\n`);
  process.exit(1);
}

if (!existsSync(nodeBin)) die(`missing bundled node at ${nodeBin}; run npm run build:daemon first`);
if (!existsSync(daemonCjs)) die(`missing daemon bundle at ${daemonCjs}; run npm run build:daemon first`);

const probe = `
console.log(JSON.stringify({ node: process.version, modules: process.versions.modules }));
const Database = require("better-sqlite3");
const db = new Database(":memory:");
db.prepare("select 1").get();
db.close();
`;

const result = spawnSync(nodeBin, ["-e", probe], {
  cwd: daemonDir,
  encoding: "utf8",
});

if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  die(`bundled daemon runtime probe failed with exit code ${result.status}`);
}

process.stdout.write(result.stdout);

// #4c: the bundled standalone Python + sidecar scripts must be present and the
// interpreter must run, so a fresh Mac can provision the voice runtime offline.
const pythonBin = join(daemonDir, "python", "bin", "python3");
const sidecarEntry = join(daemonDir, "voice-sidecar", "synth_cli.py");
if (!existsSync(pythonBin)) die(`missing bundled python at ${pythonBin}; run npm run build:daemon first`);
if (!existsSync(sidecarEntry)) die(`missing bundled sidecar at ${sidecarEntry}; run npm run build:daemon first`);
const py = spawnSync(pythonBin, ["--version"], { encoding: "utf8" });
if (py.status !== 0) {
  if (py.stderr) process.stderr.write(py.stderr);
  die(`bundled python probe failed with exit code ${py.status}`);
}
process.stdout.write(py.stdout || py.stderr);

console.log("verify-daemon-runtime: ok");
