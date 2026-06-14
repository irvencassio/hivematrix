import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate HOME so ~/.codex/sessions is a fresh temp tree.
const TMP = mkdtempSync(join(tmpdir(), "hm-codex-tok-"));
process.env.HOME = TMP;
const sessionsDir = join(TMP, ".codex", "sessions", "2026", "06", "14");
mkdirSync(sessionsDir, { recursive: true });

const { readLatestCodexTokenUsage } = await import("./codex");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

test("recovers per-run token usage from a Codex session token_count event", () => {
  // A realistic Codex session line: a token_count event carrying cumulative usage.
  const line = JSON.stringify({
    timestamp: "2026-06-14T15:00:00Z",
    payload: {
      type: "token_count",
      rate_limits: { primary: { used_percent: 12 } },
      info: {
        total_token_usage: {
          input_tokens: 8000,
          cached_input_tokens: 2000,
          output_tokens: 1200,
          reasoning_output_tokens: 400,
          total_tokens: 9200,
        },
      },
    },
  });
  // Include an earlier, smaller token_count to prove we take the LATEST.
  const earlier = JSON.stringify({
    payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } },
  });
  writeFileSync(join(sessionsDir, "rollout-test.jsonl"), earlier + "\n" + line + "\n");

  const usage = readLatestCodexTokenUsage(0);
  assert.ok(usage, "should recover usage");
  assert.equal(usage!.inputTokens, 8000);
  assert.equal(usage!.outputTokens, 1200);
  assert.equal(usage!.cachedInputTokens, 2000);
  assert.equal(usage!.reasoningTokens, 400);
  assert.equal(usage!.totalTokens, 9200);
});

test("returns null when no fresh session exists in the window", () => {
  // sinceMs far in the future → the file is older than the window.
  const usage = readLatestCodexTokenUsage(Date.now() + 60_000);
  assert.equal(usage, null);
});
