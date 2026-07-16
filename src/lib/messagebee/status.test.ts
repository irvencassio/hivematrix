import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getMessagebeeStatus, _setMessagebeeStatusDepsForTests } from "./status";
import type { ChatDbAccessProbe } from "./imessage";

// getMessagebeeStatus() -> isChannelEnabled() reaches getDb(); isolate before
// the test calls it — see docs/superpowers/specs/2026-07-15-goals-data-loss-design.md
// §2.1 (this file was a transitive-caller gap the prod-DB guard surfaced).
const TMP = mkdtempSync(join(tmpdir(), "hm-mbstatus-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

test.after(async () => {
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("getMessagebeeStatus re-probes on each call (no caching)", () => {
  // Regression: ensure that getMessagebeeStatus doesn't cache a stale
  // {chatDbReadable: false} result from an earlier FDA-denied probe. Each
  // call should re-probe live so the status auto-recovers after the daemon
  // gets FDA + is restarted.
  let probeCallCount = 0;
  let probeResult: ChatDbAccessProbe = { ok: false, reason: "open_failed", detail: "denied" };

  const testProbe = () => {
    probeCallCount++;
    return probeResult;
  };

  _setMessagebeeStatusDepsForTests({ probeChatDbAccess: testProbe });

  try {
    // Initial probe: denied.
    let status = getMessagebeeStatus({ probe: true });
    assert.equal(status.chatDbReadable, false);
    assert.equal(probeCallCount, 1, "probe was called once");

    // Simulate daemon getting FDA + restart: change the probe result.
    probeResult = { ok: true, detail: "Messages database readable" };

    // Probe again: should see the new result, not the cached stale one.
    status = getMessagebeeStatus({ probe: true });
    assert.equal(status.chatDbReadable, true, "status reflects the new probe result");
    assert.equal(probeCallCount, 2, "probe was called again, not cached");

    // Third call: should probe again (fresh each time).
    status = getMessagebeeStatus({ probe: true });
    assert.equal(status.chatDbReadable, true);
    assert.equal(probeCallCount, 3, "each call to getMessagebeeStatus re-probes");
  } finally {
    _setMessagebeeStatusDepsForTests(null);
  }
});
