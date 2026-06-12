import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveImageBackend, buildMfluxCommand, generateViaNanai } from "./image-gen";

// Isolate artifact + config writes under a temp HOME.
const home = mkdtempSync(join(tmpdir(), "imggen-"));
mkdirSync(join(home, ".hivematrix"), { recursive: true });
process.env.HOME = home;

test("resolveImageBackend: nanai when cloud-ok, mflux otherwise", () => {
  assert.equal(resolveImageBackend("cloud-ok"), "nanai");
  assert.equal(resolveImageBackend("local-only"), "mflux");
  assert.equal(resolveImageBackend("offline"), "mflux");
});

test("buildMfluxCommand renders the CLI invocation", () => {
  const { cmd, args } = buildMfluxCommand("a cat", "/tmp/out.png");
  assert.equal(cmd, "mflux-generate");
  assert.deepEqual(args, ["--model", "schnell", "--prompt", "a cat", "--output", "/tmp/out.png", "--steps", "4"]);
});

test("generateViaNanai writes a PNG from a b64 image response", async () => {
  // Configure a cloud image endpoint + key.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({ image: { endpoint: "http://img.local", apiKeyEnv: "TEST_IMG_KEY" } }));
  process.env.TEST_IMG_KEY = "k";

  const onePxPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ data: [{ b64_json: onePxPng }] }) } as Response;
  }) as unknown as typeof fetch;

  const out = join(home, "out.png");
  const r = await generateViaNanai("a thumbnail", out, fakeFetch);
  assert.equal(r.ok, true);
  assert.equal(calls[0], "http://img.local/v1/images/generations");
  assert.ok(existsSync(out));
  // PNG magic bytes
  assert.deepEqual([...readFileSync(out).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("generateViaNanai reports when unconfigured", async (t) => {
  t.after(() => rmSync(home, { recursive: true, force: true }));
  delete process.env.TEST_IMG_KEY; delete process.env.NANAI_API_KEY; delete process.env.OPENAI_API_KEY;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({}));
  const r = await generateViaNanai("x", join(home, "n.png"));
  assert.equal(r.ok, false);
  assert.match(r.detail, /not configured/);
});
