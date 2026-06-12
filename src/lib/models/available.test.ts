import test from "node:test";
import assert from "node:assert/strict";
import { buildAvailableModels, CLAUDE_OPUS_ID, CLAUDE_FABLE_ID, CODEX_NEWEST_ID } from "./available";
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
  assert.deepEqual(ids(backends(true, false, false)), ["local"]);
  assert.deepEqual(ids(backends(false, false, false)), []);
});

test("local model carries the concrete configured id", () => {
  const m = buildAvailableModels(backends(true, false, false))[0];
  assert.equal(m.modelId, "qwen/qwen3.6-27b");
  assert.match(m.name, /qwen\/qwen3\.6-27b/);
});

test("claude backend yields Opus + Fable with pinned ids", () => {
  const ms = buildAvailableModels(backends(false, true, false));
  const byId = Object.fromEntries(ms.map((m) => [m.id, m.modelId]));
  assert.equal(byId["claude-opus"], CLAUDE_OPUS_ID);
  assert.equal(byId["claude-fable"], CLAUDE_FABLE_ID);
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
