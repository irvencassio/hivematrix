import test from "node:test";
import assert from "node:assert/strict";
import { buildAvailableModels, buildRoleModelOptions, CLAUDE_OPUS_ID, CLAUDE_SONNET_ID, CODEX_NEWEST_ID } from "./available";
import { DEEPSEEK_FLASH_API_MODEL_ID, QWEN36_35B_API_MODEL_ID } from "./local-presets";
import type { BackendStatus } from "./backends";

function backends(local: boolean, claude: boolean, codex: boolean): BackendStatus[] {
  return [
    { id: "local", name: "Local", configured: local, detail: "", modelId: local ? "qwen/qwen3.6-27b" : undefined },
    { id: "claude", name: "Claude Code", configured: claude, detail: "" },
    { id: "codex", name: "Codex", configured: codex, detail: "" },
  ];
}
const ids = (b: BackendStatus[]) => buildAvailableModels(b).map((m) => m.id);

test("only configured backends produce models", () => {
  assert.deepEqual(ids(backends(true, false, false)), ["local", "local-fast", "local-coding", "dwarfstar-deepseek-flash", "rapid-mlx-qwen36-35b"]);
  assert.deepEqual(ids(backends(false, false, false)), []);
});

test("local model carries the concrete configured id", () => {
  const m = buildAvailableModels(backends(true, false, false)).find((x) => x.id === "local");
  assert.ok(m);
  assert.equal(m.modelId, "qwen/qwen3.6-27b");
  assert.match(m!.name, /qwen\/qwen3\.6-27b/);
});

test("Settings exposes the supported DeepSeek Flash local model preset", () => {
  const ms = buildAvailableModels(backends(true, false, false));
  const deepseek = ms.find((m) => m.modelId === DEEPSEEK_FLASH_API_MODEL_ID);
  assert.ok(deepseek);
  assert.equal(deepseek.backend, "local");
  assert.match(deepseek.name, /Dwarf Star DeepSeek/);
});

test("claude backend yields Opus + Sonnet with pinned ids", () => {
  const ms = buildAvailableModels(backends(false, true, false));
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
    DEEPSEEK_FLASH_API_MODEL_ID,
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
    DEEPSEEK_FLASH_API_MODEL_ID,
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
    DEEPSEEK_FLASH_API_MODEL_ID,
    QWEN36_35B_API_MODEL_ID,
    "codex:gpt-5.3-codex-spark",
    "sonnet",
  ]);
});
