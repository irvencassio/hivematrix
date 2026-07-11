import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAvailableModels, buildRoleModelOptions, getDefaultModel, CLAUDE_OPUS_ID, CLAUDE_SONNET_ID, CODEX_NEWEST_ID } from "./available";
import type { BackendStatus } from "./backends";

function backends(claude: boolean, codex: boolean): BackendStatus[] {
  return [
    { id: "claude", name: "Claude Code", configured: claude, installed: claude, enabled: claude, detail: "" },
    { id: "codex", name: "Codex", configured: codex, installed: codex, enabled: codex, detail: "" },
  ];
}
// Selectable (non-disabled) model ids — greyed "set up X" placeholders are
// asserted separately.
const ids = (b: BackendStatus[]) => buildAvailableModels(b).filter((m) => !m.disabled).map((m) => m.id);

test("no backends configured -> no selectable models", () => {
  assert.deepEqual(ids(backends(false, false)), []);
});

test("unconfigured frontier providers appear as greyed, unselectable placeholders", () => {
  const all = buildAvailableModels(backends(false, false));
  const claudeSetup = all.find((m) => m.id === "claude-setup");
  const codexSetup = all.find((m) => m.id === "codex-setup");
  assert.ok(claudeSetup?.disabled, "Claude shown as a disabled setup entry");
  assert.ok(codexSetup?.disabled, "Codex shown as a disabled setup entry");
  assert.equal(claudeSetup!.backend, "claude");
  assert.equal(codexSetup!.backend, "codex");
  assert.match(claudeSetup!.note ?? "", /sign in|enable/i);
  // A configured frontier provider is NOT duplicated as a setup placeholder.
  const withClaude = buildAvailableModels(backends(true, false));
  assert.equal(withClaude.find((m) => m.id === "claude-setup"), undefined);
  assert.ok(withClaude.find((m) => m.id === "codex-setup")?.disabled, "codex still greyed when only claude is set up");
});

test("claude backend yields Opus + Sonnet with pinned ids", () => {
  const ms = buildAvailableModels(backends(true, false)).filter((m) => !m.disabled);
  const byId = Object.fromEntries(ms.map((m) => [m.id, m.modelId]));
  assert.equal(byId["claude-opus"], CLAUDE_OPUS_ID);
  assert.equal(byId["claude-sonnet"], CLAUDE_SONNET_ID);
  // "cloud-only" was a distinct pin-everything-to-frontier UI option; removed
  // in the Claude-native cutover's console cleanup (Mixed already covers the
  // recommended role-routed posture; CLOUD_ONLY_ID stays defined for the
  // directive-engine's historical noLocal check, just no longer offered here).
  assert.deepEqual(Object.keys(byId), ["claude-opus", "claude-sonnet", "mixed"]);
});

test("codex backend yields newest + fast variant on the same model id", () => {
  const ms = buildAvailableModels(backends(false, true));
  const codex = ms.find((m) => m.id === "codex");
  const fast = ms.find((m) => m.id === "codex-fast");
  assert.equal(codex?.modelId, CODEX_NEWEST_ID);
  assert.equal(fast?.modelId, CODEX_NEWEST_ID);
  assert.equal(fast?.fast, true);
  assert.equal(codex?.fast ?? false, false);
});

test("Mixed appears with any frontier backend configured (no local backend anymore)", () => {
  assert.ok(!ids(backends(false, false)).includes("mixed"), "no frontier → no mixed");
  assert.ok(ids(backends(true, false)).includes("mixed"), "claude → mixed");
  assert.ok(ids(backends(false, true)).includes("mixed"), "codex → mixed");
  // "cloud-only" is no longer offered as a selectable option (see the
  // "cloud-only sentinel removed" test above).
  assert.ok(!ids(backends(true, false)).includes("cloud-only"), "claude → no cloud-only option");
  assert.ok(!ids(backends(false, true)).includes("cloud-only"), "codex → no cloud-only option");
});

test("getDefaultModel prefers Claude Sonnet when unset, not Opus", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hm-available-test-"));
  const prevHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    const available = buildAvailableModels(backends(true, false));
    assert.equal(getDefaultModel(available), CLAUDE_SONNET_ID);
  } finally {
    process.env.HOME = prevHome;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("getDefaultModel falls back to the first selectable model when Sonnet isn't configured", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hm-available-test-"));
  const prevHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    const available = buildAvailableModels(backends(false, true));
    assert.equal(getDefaultModel(available), CODEX_NEWEST_ID);
  } finally {
    process.env.HOME = prevHome;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("role options expose Coding choices across Claude and Codex, with Haiku as a last resort — no local options (Claude-native cutover)", () => {
  const options = buildRoleModelOptions(backends(true, true));
  const coding = options.coding.map((m) => m.modelId);
  assert.deepEqual(coding, [
    "opus",
    "sonnet",
    "codex:gpt-5.5",
    "codex:gpt-5.3-codex-spark",
    "haiku",
  ]);
});

test("role options keep frontier-premium first for Thinking — no local escape hatch anymore", () => {
  const options = buildRoleModelOptions(backends(true, true));
  const thinking = options.thinking.map((m) => m.modelId);
  // Frontier stays at the front so the default (empty → frontier-premium) is
  // unchanged; Haiku is appended as an opt-in escape hatch.
  assert.deepEqual(thinking, [
    "opus",
    "sonnet",
    "codex:gpt-5.5",
    "codex:gpt-5.3-codex-spark",
    "haiku",
  ]);
});

test("role options put Operational Claude-first (Haiku default) — no local fallback anymore", () => {
  const options = buildRoleModelOptions(backends(true, true));
  const operational = options.operational.map((m) => m.modelId);
  assert.deepEqual(operational, [
    "haiku",
    "sonnet",
    "codex:gpt-5.3-codex-spark",
    "opus",
  ]);
});
