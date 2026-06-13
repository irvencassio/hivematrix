import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-content-render-test-"));
process.env.HOME = TMP;

const { renderViaCompletion } = await import("./render");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

test("renderViaCompletion reports not-configured when no endpoint is set", async () => {
  const r = await renderViaCompletion("write something");
  assert.equal(r.ok, false);
  assert.match(r.detail, /not configured/);
});

test("renderViaCompletion posts to an OpenAI-chat-compatible endpoint and returns content", async () => {
  mkdirSync(join(TMP, ".hivematrix"), { recursive: true });
  writeFileSync(
    join(TMP, ".hivematrix", "config.json"),
    JSON.stringify({ content: { endpoint: "https://api.example.com/v1", model: "gpt-4o-mini", apiKeyEnv: "TEST_KEY" } }),
  );
  process.env.TEST_KEY = "secret";

  let calledUrl = "";
  const fakeFetch = (async (url: string) => {
    calledUrl = String(url);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "  Finished post.  " } }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const r = await renderViaCompletion("write a post", fakeFetch);
  assert.equal(r.ok, true);
  assert.equal(r.text, "Finished post.");
  assert.equal(calledUrl, "https://api.example.com/v1/chat/completions");

  delete process.env.TEST_KEY;
});
