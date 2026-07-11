import test from "node:test";
import assert from "node:assert/strict";
import { buildAvailableModels, buildRoleModelOptions, CLAUDE_OPUS_ID, CLAUDE_SONNET_ID, CODEX_NEWEST_ID } from "./available";
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
  assert.deepEqual(Object.keys(byId), ["claude-opus", "claude-sonnet", "mixed", "cloud-only"]);
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

test("Mixed and Cloud-only appear with any frontier backend configured (no local backend anymore)", () => {
  assert.ok(!ids(backends(false, false)).includes("mixed"), "no frontier → no mixed");
  assert.ok(ids(backends(true, false)).includes("mixed"), "claude → mixed");
  assert.ok(ids(backends(false, true)).includes("mixed"), "codex → mixed");
  assert.ok(!ids(backends(false, false)).includes("cloud-only"), "no frontier → no cloud-only");
  assert.ok(ids(backends(true, false)).includes("cloud-only"), "claude → cloud-only");
  assert.ok(ids(backends(false, true)).includes("cloud-only"), "codex → cloud-only");
});

test("Cloud-only model id is the cloud-only sentinel", () => {
  const m = buildAvailableModels(backends(true, false)).find((x) => x.id === "cloud-only");
  assert.equal(m?.modelId, "cloud-only");
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
