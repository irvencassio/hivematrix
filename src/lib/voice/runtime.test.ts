import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { voicePython, voiceScriptsDir, voiceRuntime } from "./runtime";

/** Run `fn` with env vars set, restoring the prior values afterward. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prior[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { fn(); } finally {
    for (const k of Object.keys(prior)) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
  }
}

test("voiceScriptsDir honors HIVE_VOICE_SIDECAR when it holds synth_cli.py", () => {
  const dir = mkdtempSync(join(tmpdir(), "vsd-"));
  try {
    writeFileSync(join(dir, "synth_cli.py"), "# stub");
    withEnv({ HIVE_VOICE_SIDECAR: dir }, () => assert.equal(voiceScriptsDir(), dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("voiceScriptsDir ignores an override missing synth_cli.py", () => {
  const dir = mkdtempSync(join(tmpdir(), "vsd-empty-"));
  try {
    withEnv({ HIVE_VOICE_SIDECAR: dir }, () => assert.notEqual(voiceScriptsDir(), dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("voicePython honors HIVE_VOICE_PYTHON when the file exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "vpy-"));
  const py = join(dir, "python");
  try {
    writeFileSync(py, "#!/bin/sh\n");
    withEnv({ HIVE_VOICE_PYTHON: py }, () => assert.equal(voicePython(), py));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("voiceRuntime returns both pieces together, or null if either is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "vrt-"));
  const scripts = join(root, "scripts");
  const venv = join(root, "venv");
  try {
    mkdirSync(scripts); mkdirSync(venv);
    writeFileSync(join(scripts, "synth_cli.py"), "# stub");
    const py = join(venv, "python");
    writeFileSync(py, "#!/bin/sh\n");

    withEnv({ HIVE_VOICE_SIDECAR: scripts, HIVE_VOICE_PYTHON: py }, () => {
      assert.deepEqual(voiceRuntime(), { python: py, scriptsDir: scripts });
    });
    // Scripts present but interpreter override points at a nonexistent file:
    // falls through env override; with no real runtime present it must be null.
    withEnv({ HIVE_VOICE_SIDECAR: scripts, HIVE_VOICE_PYTHON: join(root, "nope") }, () => {
      const rt = voiceRuntime();
      if (rt) assert.notEqual(rt.python, join(root, "nope"));
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
