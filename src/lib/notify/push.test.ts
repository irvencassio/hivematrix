import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sendPush } from "./push";

const TMP = mkdtempSync(join(tmpdir(), "hm-push-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("sendPush fans out to both transports and reports unconfigured when neither is set up", async () => {
  const result = await sendPush({ title: "T", body: "B" });
  assert.equal(result.configured, false);
  assert.equal(result.sent, 0);
  assert.deepEqual(result.apns, { configured: false, sent: 0, results: [] });
  assert.deepEqual(result.fcm, { configured: false, sent: 0, results: [] });
});

test("sendPush aggregates sent as the sum across transports (both zero here — no devices registered)", async () => {
  const result = await sendPush({ title: "T", body: "B", data: { kind: "test" } });
  assert.equal(result.sent, result.apns.sent + result.fcm.sent);
  assert.equal(result.sent, 0);
});
