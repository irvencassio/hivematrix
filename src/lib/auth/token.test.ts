import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-token-test-"));
const ORIG_HOME = process.env.HOME;
process.env.HOME = TMP;

const { getOrCreateToken, readToken, tokenEquals } = await import("./token");

test.after(() => { process.env.HOME = ORIG_HOME; rmSync(TMP, { recursive: true, force: true }); });

test("getOrCreateToken creates a 64-hex-char token, mode 600, and is stable", () => {
  const t1 = getOrCreateToken("auth-token");
  assert.match(t1, /^[a-f0-9]{64}$/);
  const mode = statSync(join(TMP, ".hivematrix", "auth-token")).mode & 0o777;
  assert.equal(mode, 0o600);
  const t2 = getOrCreateToken("auth-token");
  assert.equal(t2, t1, "second call returns the same token");
});

test("readToken returns the token, or null when absent", () => {
  assert.equal(readToken("nope-token"), null);
  const t = getOrCreateToken("desktopbee-token");
  assert.equal(readToken("desktopbee-token"), t);
});

test("tokenEquals is exact and length-safe", () => {
  assert.equal(tokenEquals("abc", "abc"), true);
  assert.equal(tokenEquals("abc", "abd"), false);
  assert.equal(tokenEquals("abc", "abcd"), false);
  assert.equal(tokenEquals("", "abc"), false);
  assert.equal(tokenEquals(null, "abc"), false);
  assert.equal(tokenEquals("abc", undefined), false);
});
