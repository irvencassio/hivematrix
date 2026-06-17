/**
 * build-daemon.mjs — bundle the HiveMatrix daemon into a self-contained runtime
 * that runs with ZERO system dependencies (no system Node, no tsx, no git checkout).
 *
 *   node scripts/build-daemon.mjs
 *
 * Output: dist/daemon/
 *   bin/node                         pinned Node (re-signed later in P5)
 *   daemon.cjs                       esbuild bundle of src/daemon/index.ts
 *   node_modules/better-sqlite3/...  pruned native module (lib + build/Release/*.node)
 *   node_modules/bindings, file-uri-to-path   better-sqlite3's runtime deps
 *   assets/mermaid.min.js            browser Mermaid renderer for console output
 *   build-info.json                  what was produced
 *
 * Tauri picks dist/daemon up as a bundle resource (see tauri.conf.json
 * bundle.resources) and copies it to HiveMatrix.app/Contents/Resources/daemon/.
 *
 * Native modules are externalized (esbuild can't inline a .node) and shipped on
 * disk so a normal require() resolves them. Everything else (chokidar, dotenv)
 * is inlined into daemon.cjs.
 *
 * Node is PINNED; native modules are installed in an isolated production
 * dependency tree using that same Node so the addon ABI always matches the
 * runtime shipped inside the app.
 */

import { build } from "esbuild";
import {
  rmSync, mkdirSync, cpSync, existsSync, chmodSync, writeFileSync, statSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "dist", "daemon");
const CACHE = join(ROOT, "dist", ".node-cache");
const NATIVE_BUILD = join(ROOT, "dist", ".native-daemon-build");

// Pinned Node for the self-contained daemon runtime.
const NODE_VERSION = "22.22.3";
const ARCH = "arm64"; // Apple Silicon only (locked decision)
const NODE_DIST = `node-v${NODE_VERSION}-darwin-${ARCH}`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.gz`;
const NODE_ROOT = join(CACHE, NODE_DIST);
const cachedNode = join(NODE_ROOT, "bin", "node");

// Pinned standalone CPython (python-build-standalone, install_only build) bundled
// for the voice/video runtime (#4c). It's only the BASE interpreter — on first
// enable, provision.ts builds a venv + pip-installs the MLX wheels from it into
// the writable ~/.hivematrix/voice-runtime. 3.14 matches the dev sidecar venv, so
// the same wheels resolve. The install_only tarball extracts to a `python/` dir.
const PY_RELEASE = "20260610";
const PY_VERSION = "3.14.6";
const PY_ASSET = `cpython-${PY_VERSION}+${PY_RELEASE}-aarch64-apple-darwin-install_only.tar.gz`;
const PY_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PY_RELEASE}/${PY_ASSET}`;
const PY_CACHE_ROOT = join(CACHE, `python-${PY_VERSION}+${PY_RELEASE}`);
const cachedPython = join(PY_CACHE_ROOT, "python", "bin", "python3");

const NATIVE_EXTERNALS = ["better-sqlite3", "fsevents"];

function log(msg) { console.log(`[build-daemon] ${msg}`); }
function human(bytes) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function dirSize(p) {
  try { return parseInt(execFileSync("du", ["-sk", p]).toString().split("\t")[0], 10) * 1024; }
  catch { return 0; }
}

function gitValue(args, fallback = null) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch { return fallback; }
}

function runPinnedNpm(args, cwd) {
  const npmCli = join(NODE_ROOT, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const binDir = join(NODE_ROOT, "bin");
  execFileSync(cachedNode, [npmCli, ...args], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      npm_config_arch: ARCH,
      npm_config_platform: "darwin",
      npm_config_runtime: "node",
      npm_config_target: NODE_VERSION,
    },
  });
}

function verifyNativeRuntime(workingDir) {
  const probe = `
const Database = require("better-sqlite3");
const db = new Database(":memory:");
db.prepare("select 1").get();
db.close();
`;
  execFileSync(cachedNode, ["-e", probe], { cwd: workingDir, stdio: "inherit" });
}

function prepareNativeModules() {
  log(`installing production native deps with Node ${NODE_VERSION}`);
  rmSync(NATIVE_BUILD, { recursive: true, force: true });
  mkdirSync(NATIVE_BUILD, { recursive: true });
  cpSync(join(ROOT, "package.json"), join(NATIVE_BUILD, "package.json"));
  cpSync(join(ROOT, "package-lock.json"), join(NATIVE_BUILD, "package-lock.json"));
  runPinnedNpm(["ci", "--omit=dev", "--no-audit", "--no-fund", "--foreground-scripts"], NATIVE_BUILD);
  verifyNativeRuntime(NATIVE_BUILD);
  return join(NATIVE_BUILD, "node_modules");
}

// ── 1. Clean output ─────────────────────────────────────────────────────────
log(`output: ${OUT}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── 2. esbuild bundle ────────────────────────────────────────────────────────
// esbuild resolves the `@/*` -> `./src/*` alias natively from tsconfig.json.
log("bundling src/daemon/index.ts -> daemon.cjs");
await build({
  entryPoints: [join(SRC, "daemon", "index.ts")],
  outfile: join(OUT, "daemon.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: NATIVE_EXTERNALS,
  tsconfig: join(ROOT, "tsconfig.json"),
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
  banner: { js: "// HiveMatrix bundled daemon — generated by scripts/build-daemon.mjs. Do not edit." },
});
log(`daemon.cjs: ${human(statSync(join(OUT, "daemon.cjs")).size)}`);

// ── 3. Stage the pinned Node binary (download + cache) ────────────────────────
if (!existsSync(cachedNode)) {
  log(`downloading Node ${NODE_VERSION} (${ARCH})…`);
  mkdirSync(CACHE, { recursive: true });
  const tarball = join(CACHE, `${NODE_DIST}.tar.gz`);
  execFileSync("curl", ["-fSL", "-o", tarball, NODE_URL], { stdio: "inherit" });
  execFileSync("tar", ["-xzf", tarball, "-C", CACHE], { stdio: "inherit" });
  if (!existsSync(cachedNode)) { console.error(`✗ ${cachedNode} not found after extract`); process.exit(1); }
}
const nodeAbi = execFileSync(cachedNode, ["-p", "process.versions.modules"], { encoding: "utf8" }).trim();
log(`staging bin/node (Node ${NODE_VERSION}, ABI ${nodeAbi})`);
mkdirSync(join(OUT, "bin"), { recursive: true });
cpSync(cachedNode, join(OUT, "bin", "node"));
chmodSync(join(OUT, "bin", "node"), 0o755);

// ── 3b. Stage standalone Python + voice sidecar scripts (#4c) ─────────────────
// The signed app ships a base Python so a fresh Mac can provision the voice
// runtime offline (no runtime download). The sidecar .py scripts are bundled
// read-only alongside the daemon; provision.ts builds the venv from this Python.
if (!existsSync(cachedPython)) {
  log(`downloading CPython ${PY_VERSION} (aarch64)…`);
  mkdirSync(PY_CACHE_ROOT, { recursive: true });
  const tarball = join(PY_CACHE_ROOT, PY_ASSET);
  execFileSync("curl", ["-fSL", "-o", tarball, PY_URL], { stdio: "inherit" });
  execFileSync("tar", ["-xzf", tarball, "-C", PY_CACHE_ROOT], { stdio: "inherit" });
  if (!existsSync(cachedPython)) { console.error(`✗ ${cachedPython} not found after extract`); process.exit(1); }
}
const pyVersionOut = execFileSync(cachedPython, ["--version"], { encoding: "utf8" }).trim();
log(`staging python/ (${pyVersionOut})`);
cpSync(join(PY_CACHE_ROOT, "python"), join(OUT, "python"), { recursive: true });
chmodSync(join(OUT, "python", "bin", "python3"), 0o755);

// Bundle the sidecar source: every *.py + requirements.txt (NOT the dev .venv,
// recorded profile, or downloaded models — those are per-machine/provisioned).
log("staging voice-sidecar scripts");
const sidecarSrc = join(ROOT, "voice-sidecar");
const sidecarOut = join(OUT, "voice-sidecar");
mkdirSync(sidecarOut, { recursive: true });
cpSync(sidecarSrc, sidecarOut, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(sidecarSrc.length + 1);
    if (!rel) return true;
    const top = rel.split("/")[0];
    return !["..venv", ".venv", "__pycache__", "models", ".DS_Store"].includes(top) && top !== "profile.wav";
  },
});

// ── 4. Stage native modules (externalized — resolved on disk at runtime) ──────
const nativeNM = prepareNativeModules();
const stagedNM = join(OUT, "node_modules");

// better-sqlite3: prune the heavy deps/ + src/ + build intermediates; keep only
// what's needed at runtime: package.json, lib/, build/Release/better_sqlite3.node.
log("staging better-sqlite3 (pruned)");
const bs3Out = join(stagedNM, "better-sqlite3");
mkdirSync(join(bs3Out, "build", "Release"), { recursive: true });
cpSync(join(nativeNM, "better-sqlite3", "package.json"), join(bs3Out, "package.json"));
cpSync(join(nativeNM, "better-sqlite3", "lib"), join(bs3Out, "lib"), { recursive: true });
const addon = join(nativeNM, "better-sqlite3", "build", "Release", "better_sqlite3.node");
if (!existsSync(addon)) {
  console.error(`✗ ${addon} not found after pinned Node install.`);
  process.exit(1);
}
cpSync(addon, join(bs3Out, "build", "Release", "better_sqlite3.node"));

// better-sqlite3's runtime deps (tiny): bindings -> file-uri-to-path.
for (const dep of ["bindings", "file-uri-to-path"]) {
  const from = join(nativeNM, dep);
  if (!existsSync(from)) { console.error(`✗ pinned native dependency ${dep} missing`); process.exit(1); }
  log(`staging ${dep}`);
  cpSync(from, join(stagedNM, dep), { recursive: true });
}

// Browser-side Mermaid renderer for RESULT markdown diagrams.
log("staging mermaid browser asset");
const mermaidAsset = join(nativeNM, "mermaid", "dist", "mermaid.min.js");
if (!existsSync(mermaidAsset)) {
  console.error(`✗ ${mermaidAsset} not found after pinned production install.`);
  process.exit(1);
}
mkdirSync(join(OUT, "assets"), { recursive: true });
cpSync(mermaidAsset, join(OUT, "assets", "mermaid.min.js"));

// ── 5. Build info ─────────────────────────────────────────────────────────────
const info = {
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  sourceCommit: gitValue(["rev-parse", "HEAD"]),
  sourceDirty: !!gitValue(["status", "--porcelain"], ""),
  nodeVersion: NODE_VERSION,
  nodeAbi,
  pythonVersion: PY_VERSION,
  pythonRelease: PY_RELEASE,
  arch: ARCH,
  externals: NATIVE_EXTERNALS,
  totalSize: human(dirSize(OUT)),
};
writeFileSync(join(OUT, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
log(`done. total: ${info.totalSize}`);
log(`run: HIVEMATRIX_NODE_BIN=${join(OUT, "bin", "node")} ${join(OUT, "bin", "node")} ${join(OUT, "daemon.cjs")}`);
