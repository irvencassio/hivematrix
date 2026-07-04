import test from "node:test";
import assert from "node:assert/strict";

import {
  ds4AgentConfig,
  ds4AgentEligible,
  parseSavedSessionSha,
  isValidSessionSha,
  buildDs4AgentTurns,
} from "./ds4-agent";

test("ds4AgentConfig is off by default and merges the operator block", () => {
  assert.deepEqual(ds4AgentConfig({}), { enabled: false, binary: null, idleMs: 4000 });
  assert.deepEqual(
    ds4AgentConfig({ ds4Agent: { enabled: true, binary: "/opt/ds4/ds4-agent", idleMs: 2000 } }),
    { enabled: true, binary: "/opt/ds4/ds4-agent", idleMs: 2000 },
  );
  // Junk values fall back to defaults.
  assert.deepEqual(ds4AgentConfig({ ds4Agent: { enabled: "yes", binary: 5, idleMs: -1 } }), {
    enabled: false, binary: null, idleMs: 4000,
  });
});

test("ds4AgentEligible: DeepSeek + coding profile + no lane tools + opt-in", () => {
  const base = { enabled: true, providerName: "dwarfstar", agentType: "developer", laneToolsRequired: false };
  assert.equal(ds4AgentEligible(base), true);
  assert.equal(ds4AgentEligible({ ...base, agentType: "auto" }), true);
  assert.equal(ds4AgentEligible({ ...base, agentType: undefined }), true, "unset profile defaults to coding");

  // Disqualifiers — each falls through to the existing HTTP/subprocess paths.
  assert.equal(ds4AgentEligible({ ...base, enabled: false }), false, "off by default");
  assert.equal(ds4AgentEligible({ ...base, providerName: "qwen" }), false, "Qwen keeps its own path");
  assert.equal(ds4AgentEligible({ ...base, providerName: "dwarfstar", laneToolsRequired: true }), false, "lane work stays on HTTP");
  assert.equal(ds4AgentEligible({ ...base, agentType: "browser" }), false, "non-coding profile");
});

test("isValidSessionSha accepts 8–40 hex, rejects other ids", () => {
  assert.equal(isValidSessionSha("a1b2c3d4"), true);
  assert.equal(isValidSessionSha("a".repeat(40)), true);
  assert.equal(isValidSessionSha("short"), false);
  assert.equal(isValidSessionSha("claude-session-uuid-xyz"), false);
  assert.equal(isValidSessionSha(undefined), false);
  assert.equal(isValidSessionSha(null), false);
});

test("parseSavedSessionSha extracts the KV session hash from /save output", () => {
  assert.equal(parseSavedSessionSha("Saved session 3f9a1c2b4d5e6f70"), "3f9a1c2b4d5e6f70");
  assert.equal(parseSavedSessionSha("wrote ~/.ds4/kvcache/deadbeefcafe1234.kv"), "deadbeefcafe1234");
  assert.equal(parseSavedSessionSha("nothing to see here"), null);
  // Case-insensitive → normalized to lowercase.
  assert.equal(parseSavedSessionSha("session ABCDEF12"), "abcdef12");
});

test("buildDs4AgentTurns replays /switch only for a valid resume sha", () => {
  assert.deepEqual(buildDs4AgentTurns("fix the bug"), ["fix the bug"]);
  assert.deepEqual(buildDs4AgentTurns("continue", "a1b2c3d4e5"), ["/switch a1b2c3d4e5", "continue"]);
  // A non-sha resume id (e.g. a Claude session uuid) is ignored → fresh session.
  assert.deepEqual(buildDs4AgentTurns("go", "not-a-sha"), ["go"]);
});
