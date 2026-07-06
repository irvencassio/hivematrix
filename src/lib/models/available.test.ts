import test from "node:test";
import assert from "node:assert/strict";
import { buildAvailableModels, buildRoleModelOptions, CLAUDE_OPUS_ID, CLAUDE_SONNET_ID, CODEX_NEWEST_ID } from "./available";
import { QWEN36_35B_API_MODEL_ID } from "./local-presets";
import type { BackendStatus } from "./backends";

function backends(local: boolean, claude: boolean, codex: boolean): BackendStatus[] {
  return [
    { id: "local", name: "Local", configured: local, detail: "", modelId: local ? "qwen/qwen3.6-27b" : undefined },
    { id: "claude", name: "Claude Code", configured: claude, detail: "" },
    { id: "codex", name: "Codex", configured: codex, detail: "" },
  ];
}
// Selectable (non-disabled) model ids — greyed "set up X" placeholders are
// asserted separately.
const ids = (b: BackendStatus[]) => buildAvailableModels(b).filter((m) => !m.disabled).map((m) => m.id);

test("only configured backends produce selectable models", () => {
  assert.deepEqual(ids(backends(true, false, false)), ["local", "local-fast", "local-coding", "rapid-mlx-qwen36-35b"]);
  assert.deepEqual(ids(backends(false, false, false)), []);
});

test("unconfigured frontier providers appear as greyed, unselectable placeholders", () => {
  const all = buildAvailableModels(backends(true, false, false)); // local only, no frontier
  const claudeSetup = all.find((m) => m.id === "claude-setup");
  const codexSetup = all.find((m) => m.id === "codex-setup");
  assert.ok(claudeSetup?.disabled, "Claude shown as a disabled setup entry");
  assert.ok(codexSetup?.disabled, "Codex shown as a disabled setup entry");
  assert.equal(claudeSetup!.backend, "claude"); // groups under "Cloud frontier"
  assert.equal(codexSetup!.backend, "codex");
  assert.match(claudeSetup!.note ?? "", /sign in|enable/i);
  // A configured frontier provider is NOT duplicated as a setup placeholder.
  const withClaude = buildAvailableModels(backends(true, true, false));
  assert.equal(withClaude.find((m) => m.id === "claude-setup"), undefined);
  assert.ok(withClaude.find((m) => m.id === "codex-setup")?.disabled, "codex still greyed when only claude is set up");
});

test("local model carries the concrete configured id", () => {
  const m = buildAvailableModels(backends(true, false, false)).find((x) => x.id === "local");
  assert.ok(m);
  assert.equal(m.modelId, "qwen/qwen3.6-27b");
  assert.match(m!.name, /qwen\/qwen3\.6-27b/);
});

test("claude backend yields Opus + Sonnet with pinned ids", () => {
  const ms = buildAvailableModels(backends(false, true, false)).filter((m) => !m.disabled);
  const byId = Object.fromEntries(ms.map((m) => [m.id, m.modelId]));
  assert.equal(byId["claude-opus"], CLAUDE_OPUS_ID);
  assert.equal(byId["claude-sonnet"], CLAUDE_SONNET_ID);
  assert.deepEqual(Object.keys(byId), ["claude-opus", "claude-sonnet", "cloud-only"]);
});

test("codex backend yields newest + fast variant on the same model id", () => {
  const ms = buildAvailableModels(backends(false, false, true));
  const codex = ms.find((m) => m.id === "codex");
  const fast = ms.find((m) => m.id === "codex-fast");
  assert.equal(codex?.modelId, CODEX_NEWEST_ID);
  assert.equal(fast?.modelId, CODEX_NEWEST_ID);
  assert.equal(fast?.fast, true);
  assert.equal(codex?.fast ?? false, false);
});

test("Mixed appears only with local AND a frontier backend", () => {
  assert.ok(!ids(backends(true, false, false)).includes("mixed"), "local only → no mixed");
  assert.ok(!ids(backends(false, true, false)).includes("mixed"), "frontier only → no mixed");
  assert.ok(ids(backends(true, true, false)).includes("mixed"), "local + claude → mixed");
  assert.ok(ids(backends(true, false, true)).includes("mixed"), "local + codex → mixed");
});

test("Cloud-only appears with any frontier backend, no local required", () => {
  assert.ok(!ids(backends(true, false, false)).includes("cloud-only"), "local only → no cloud-only");
  assert.ok(ids(backends(false, true, false)).includes("cloud-only"), "claude only → cloud-only");
  assert.ok(ids(backends(false, false, true)).includes("cloud-only"), "codex only → cloud-only");
  assert.ok(ids(backends(true, true, false)).includes("cloud-only"), "local + claude → cloud-only");
});

test("Cloud-only model id is the cloud-only sentinel", () => {
  const m = buildAvailableModels(backends(false, true, false)).find((x) => x.id === "cloud-only");
  assert.equal(m?.modelId, "cloud-only");
});

test("role options expose Coding choices across Claude, Codex, and local Qwen", () => {
  const options = buildRoleModelOptions(backends(true, true, true));
  const coding = options.coding.map((m) => m.modelId);
  assert.deepEqual(coding, [
    "opus",
    "sonnet",
    "codex:gpt-5.5",
    "codex:gpt-5.3-codex-spark",
    "qwen/qwen3.6-27b",
    "qwen3.6-35b-4bit",
    "qwen3.6-27b-4bit",
    QWEN36_35B_API_MODEL_ID,
  ]);
});

test("role options offer local for Thinking too, but keep frontier-premium first", () => {
  const options = buildRoleModelOptions(backends(true, true, true));
  const thinking = options.thinking.map((m) => m.modelId);
  // Frontier stays at the front so the default (empty → frontier-premium) is
  // unchanged; local is appended as an opt-in on-box choice.
  assert.deepEqual(thinking, [
    "opus",
    "sonnet",
    "codex:gpt-5.5",
    "codex:gpt-5.3-codex-spark",
    "qwen/qwen3.6-27b",
    "qwen3.6-35b-4bit",
    "qwen3.6-27b-4bit",
    QWEN36_35B_API_MODEL_ID,
  ]);
});

test("role options expose Operational escape hatches without making them the default", () => {
  const options = buildRoleModelOptions(backends(true, true, true));
  const operational = options.operational.map((m) => m.modelId);
  assert.deepEqual(operational, [
    "qwen/qwen3.6-27b",
    "qwen3.6-35b-4bit",
    "qwen3.6-27b-4bit",
    QWEN36_35B_API_MODEL_ID,
    "codex:gpt-5.3-codex-spark",
    "sonnet",
  ]);
});
