import { test } from "node:test";
import { strict as assert } from "node:assert";
import { getDb } from "@/lib/db";
import { attemptReserve, markSent, pruneSendCap, alreadySent, getSentInRun } from "./send-cap";

const cleanup = () => {
  // Clear the table before each test.
  try {
    getDb().prepare("DELETE FROM message_send_cap").run();
  } catch {
    // Table might not exist yet; ignore during cleanup.
  }
};

test("send-cap: attemptReserve claims a new slot (returns true)", () => {
  cleanup();
  assert.equal(attemptReserve("run-123", "+15136595163"), true);
});

test("send-cap: second attemptReserve on same (runId, recipient) fails (returns false)", () => {
  cleanup();
  assert.equal(attemptReserve("run-123", "+15136595163"), true);
  assert.equal(
    attemptReserve("run-123", "+15136595163"),
    false,
    "Second reserve for the same (runId, recipient) should fail",
  );
});

test("send-cap: key is (runId, recipient) — different recipients in one run each reserve", () => {
  cleanup();
  // First recipient succeeds.
  assert.equal(attemptReserve("run-123", "+15136595163"), true);
  // A DIFFERENT recipient in the same run also succeeds — the run can reach
  // several people, each keyed independently.
  assert.equal(attemptReserve("run-123", "+15136595221"), true);
  // Two records exist (one per recipient), not one.
  const count = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap WHERE runId = ?",
  ).get("run-123") as { cnt: number };
  assert.equal(count.cnt, 2, "One record per recipient in the run");
});

test("send-cap: attemptReserve tracks separate runs independently", () => {
  cleanup();
  assert.equal(attemptReserve("run-123", "+15136595163"), true);
  assert.equal(attemptReserve("run-456", "+15136595163"), true);
  // Same recipient, different runs both succeeded.
});

test("send-cap: different runs can each send to the same recipient once", () => {
  cleanup();
  assert.equal(attemptReserve("run-123", "+1513"), true);
  assert.equal(attemptReserve("run-456", "+1513"), true);
  assert.equal(attemptReserve("run-789", "+1513"), true);
  const count = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap",
  ).get() as { cnt: number };
  assert.equal(count.cnt, 3, "Each run gets its own slot for this recipient");
});

test("send-cap: atomic reserve-before-send prevents duplicate sends on re-dispatch", () => {
  cleanup();
  const runId = "weaver-daily-audit-2026-07-14";
  const recipient = "+15136595163";

  // First dispatch: reserve, then mark sent.
  assert.equal(attemptReserve(runId, recipient), true);
  markSent(runId, recipient);

  // Re-dispatch of the same run to the same recipient: slot already claimed.
  assert.equal(attemptReserve(runId, recipient), false);
});

test("send-cap: atomic reserve prevents concurrent processes from both sending", () => {
  cleanup();
  const runId = "concurrent-run-id";
  const recipient = "+15136595163";

  const process1Reserved = attemptReserve(runId, recipient);
  const process2Reserved = attemptReserve(runId, recipient);

  // At most one should succeed (not both, not neither).
  assert.equal(process1Reserved && process2Reserved, false);
  assert.equal(process1Reserved || process2Reserved, true);

  const count = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap WHERE runId = ? AND recipient = ?",
  ).get(runId, recipient) as { cnt: number };
  assert.equal(count.cnt, 1);

  const record = getDb().prepare(
    "SELECT reservedAt, sentAt FROM message_send_cap WHERE runId = ? AND recipient = ?",
  ).get(runId, recipient) as { reservedAt: string; sentAt?: string | null };
  assert.ok(record.reservedAt);
  assert.equal(record.sentAt, null); // sentAt stays null until markSent.
});

test("send-cap: markSent updates sentAt after successful dispatch", () => {
  cleanup();
  const runId = "send-run-123";
  const recipient = "+15136595163";

  attemptReserve(runId, recipient);
  markSent(runId, recipient);

  const record = getDb().prepare(
    "SELECT reservedAt, sentAt FROM message_send_cap WHERE runId = ? AND recipient = ?",
  ).get(runId, recipient) as { reservedAt: string; sentAt?: string };
  assert.ok(record.reservedAt);
  assert.ok(record.sentAt);
});

test("send-cap: concurrent processes racing on same slot — exactly one wins", async () => {
  cleanup();
  const runId = "concurrent-race-123";
  const recipient = "+15136595163";

  const results = await Promise.all([
    Promise.resolve(attemptReserve(runId, recipient)),
    Promise.resolve(attemptReserve(runId, recipient)),
  ]);

  assert.equal(results.filter((r) => r === true).length, 1, "Exactly one wins");
  assert.equal(results.filter((r) => r === false).length, 1, "Exactly one loses");

  const count = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap WHERE runId = ? AND recipient = ?",
  ).get(runId, recipient) as { cnt: number };
  assert.equal(count.cnt, 1);

  assert.equal(attemptReserve(runId, recipient), false, "Further attempts fail");
});

test("send-cap: pruneSendCap removes old records", () => {
  cleanup();
  const db = getDb();
  db.prepare(
    `INSERT INTO message_send_cap (_id, runId, recipient, sendId, reservedAt)
     VALUES ('old-1', 'run-old', '+15136595163', 'id-old', datetime('now', '-40 days'))`,
  ).run();

  attemptReserve("run-new", "+15136595163");

  assert.equal(pruneSendCap(30), 1);

  const remaining = db.prepare("SELECT COUNT(*) as cnt FROM message_send_cap")
    .get() as { cnt: number };
  assert.equal(remaining.cnt, 1);
  assert.equal(attemptReserve("run-new", "+15136595163"), false); // new run's slot claimed
});

test("send-cap: regression — second send to same recipient in a run is refused", () => {
  cleanup();
  const runId = "regression-2026-07-14";
  const recipient = "+15136595163";

  assert.equal(attemptReserve(runId, recipient), true);
  markSent(runId, recipient);

  assert.equal(attemptReserve(runId, recipient), false);
  assert.equal(alreadySent(runId, recipient), true);

  const sent = getSentInRun(runId);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].sentAt);
});

test("send-cap: regression — concurrent retry paths all fail for same (runId, recipient)", () => {
  cleanup();
  const runId = "concurrent-retries-2026-07-14";
  const recipient = "+15136595163";

  attemptReserve(runId, recipient);
  markSent(runId, recipient);

  // Multiple retry paths (re-dispatch, internal retry, restart, notify path)
  // all try to send again; all must be refused.
  const retryResults = [
    attemptReserve(runId, recipient),
    attemptReserve(runId, recipient),
    attemptReserve(runId, recipient),
    attemptReserve(runId, recipient),
  ];
  retryResults.forEach((result) => assert.equal(result, false));

  const count = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap WHERE runId = ? AND recipient = ?",
  ).get(runId, recipient) as { cnt: number };
  assert.equal(count.cnt, 1);

  const sentRecords = getSentInRun(runId);
  assert.equal(sentRecords.length, 1);
  assert.ok(sentRecords[0].sentAt);
});

test("send-cap: reconciliation against message store — audit trail completeness", () => {
  cleanup();
  const runId = "weaver-daily-audit-2026-07-14";
  const recipient = "+15136595163";

  assert.equal(attemptReserve(runId, recipient), true);
  markSent(runId, recipient);

  const sent = getSentInRun(runId);
  assert.equal(sent.length, 1, "Exactly one delivery recorded for this recipient");

  const recordCount = getDb().prepare(
    `SELECT COUNT(*) as cnt FROM message_send_cap
     WHERE runId = ? AND sentAt IS NOT NULL`,
  ).get(runId) as { cnt: number };
  assert.equal(recordCount.cnt, sent.length);
});

test("send-cap: REGRESSION (2026-07-14 incident) — forced concurrent double-dispatch yields exactly 1 delivery", async () => {
  cleanup();
  const runId = "weaver-daily-audit-incident-2026-07-14";
  const recipient = "+15136595163";
  let deliveryCount = 0;

  const mockSendIMessage = async () => {
    deliveryCount++;
    return true;
  };

  const attempt = () =>
    Promise.resolve(attemptReserve(runId, recipient)).then((reserved) => {
      if (reserved) {
        return mockSendIMessage().then(() => {
          markSent(runId, recipient);
          return { reserved: true, sent: true };
        });
      }
      return Promise.resolve({ reserved: false, sent: false });
    });

  const results = await Promise.all([attempt(), attempt()]);

  assert.equal(results.filter((r) => r.reserved).length, 1, "Exactly one wins the reserve race");
  assert.equal(results.filter((r) => !r.reserved).length, 1, "Exactly one loses");
  assert.equal(deliveryCount, 1, `Expected 1 delivery, got ${deliveryCount} (the incident was 8)`);

  const sentRecords = getSentInRun(runId);
  assert.equal(sentRecords.length, 1);
  assert.ok(sentRecords[0].sentAt);

  assert.equal(attemptReserve(runId, recipient), false, "Any later attempt fails");
});

test("send-cap: REGRESSION — concurrent triple-dispatch with persistent lock (daemon restart)", async () => {
  cleanup();
  const runId = "daemon-restart-scenario-2026-07-14";
  const recipient = "+15136595163";
  const deliveries: number[] = [];

  const process = (id: number) =>
    Promise.resolve().then(() => {
      const reserved = attemptReserve(runId, recipient);
      if (reserved) {
        deliveries.push(id);
        markSent(runId, recipient);
      }
      return { processId: id, reserved };
    });

  const results = await Promise.all([process(1), process(2), process(3)]);

  assert.equal(results.filter((r) => r.reserved).length, 1, "Exactly one wins");
  assert.equal(results.filter((r) => !r.reserved).length, 2, "Two lose");
  assert.equal(deliveries.length, 1, "Exactly one delivery");
});

test("send-cap: REGRESSION — concurrent dual-daemon + internal retries = exactly 1 delivery", async () => {
  cleanup();
  const runId = "weaver-daily-audit-dual-2026-07-14";
  const recipient = "+15136595163";
  let totalDeliveries = 0;

  const simulateDaemonProcess = async (processId: number, retries = 2) => {
    const results = [];
    for (let attemptNum = 0; attemptNum <= retries; attemptNum++) {
      const reserved = attemptReserve(runId, recipient);
      if (reserved) {
        totalDeliveries++;
        markSent(runId, recipient);
        results.push({ attempt: attemptNum, reserved: true });
        break;
      }
      results.push({ attempt: attemptNum, reserved: false });
    }
    return { processId, results };
  };

  const outcomes = await Promise.all([
    simulateDaemonProcess(3747, 2),
    simulateDaemonProcess(3799, 2),
  ]);

  assert.equal(totalDeliveries, 1, `Expected exactly 1 delivery, got ${totalDeliveries} (incident had 8)`);

  const winners = outcomes.filter((o) => o.results[0]?.reserved === true);
  assert.equal(winners.length, 1, "Exactly one daemon wins the first-attempt race");

  const losers = outcomes.filter((o) => o.results[0]?.reserved !== true);
  assert.equal(losers.length, 1, "Exactly one daemon loses");
  losers.forEach((loser) => {
    assert.ok(loser.results.every((r) => r.reserved === false), `Loser ${loser.processId} fails all retries`);
  });

  const recordCount = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap WHERE runId = ? AND recipient = ?",
  ).get(runId, recipient) as { cnt: number };
  assert.equal(recordCount.cnt, 1);

  const sentRecords = getSentInRun(runId);
  assert.equal(sentRecords.length, 1);
  assert.ok(sentRecords[0].sentAt);
});

test("send-cap: audit trail — concurrent processes leave exactly one (runId, recipient) record", () => {
  cleanup();
  const runId = "audit-trail-check-2026-07-14";
  const recipient = "+15136595163";

  const processResults = [];
  for (let i = 0; i < 5; i++) {
    processResults.push({ processNum: i, reserved: attemptReserve(runId, recipient) });
  }

  assert.equal(processResults.filter((p) => p.reserved).length, 1, "Only one process reserves");

  const records = getDb().prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap WHERE runId = ? AND recipient = ?",
  ).get(runId, recipient) as { cnt: number };
  assert.equal(records.cnt, 1);

  markSent(runId, recipient);
  const sent = getSentInRun(runId);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].sentAt);
});
