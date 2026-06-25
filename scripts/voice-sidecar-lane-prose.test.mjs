import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("voice sidecar comments use lane names", () => {
  const server = read("src/daemon/server.ts");
  const llm = read("voice-sidecar/llm.py");

  assert.match(server, /POST \/voice\/session — the Voice Lane sidecar/);
  assert.doesNotMatch(server, /VoiceBee sidecar/);

  assert.match(llm, /surface Mail Lane uses/);
  assert.match(llm, /daemon's Mail Lane/);
  assert.doesNotMatch(llm, /surface MailBee uses|daemon's MailBee/);
});
