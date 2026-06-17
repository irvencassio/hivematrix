import test from "node:test";
import assert from "node:assert/strict";
import { provisioningPython, sidecarSourceDir, voiceRuntimeDir, provisionStatus } from "./provision";

test("provisioningPython falls back to system python3 in dev", () => {
  const p = provisioningPython();
  assert.ok(p === "python3" || p.endsWith("/python3"), p);
});

test("voiceRuntimeDir lives under ~/.hivematrix (writable, survives updates)", () => {
  assert.match(voiceRuntimeDir(), /\.hivematrix\/voice-runtime$/);
});

test("sidecarSourceDir locates the source by requirements.txt (or null)", () => {
  const d = sidecarSourceDir();
  if (d) assert.match(d, /voice-sidecar$/);
});

test("provisionStatus exposes a state + log", () => {
  const s = provisionStatus();
  assert.ok(["idle", "running", "ready", "error"].includes(s.state));
  assert.ok(Array.isArray(s.log));
});
