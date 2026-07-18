import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate config/DB reads under a temp HOME before the loop module loads.
const home = mkdtempSync(join(tmpdir(), "notify-loop-"));
mkdirSync(join(home, ".hivematrix"), { recursive: true });
process.env.HOME = home;
process.env.HIVEMATRIX_DB_PATH = join(home, "hivematrix.db");

import { startNotifyLoop, stopNotifyLoop, escalationTick } from "./notify-loop";

test("notify loop logs tick failures and keeps ticking", async (t) => {
  const errors: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args.join(" ")); });
  t.after(() => stopNotifyLoop());

  let escCalls = 0;
  let tgCalls = 0;
  startNotifyLoop(20, {
    escalation: async () => { escCalls += 1; if (escCalls === 1) throw new Error("notify channel down"); },
    telegram: async () => { tgCalls += 1; if (tgCalls === 1) throw new Error("telegram getUpdates failed"); },
  });

  const end = Date.now() + 2_000;
  while ((escCalls < 2 || tgCalls < 2) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));

  assert.ok(escCalls >= 2, `escalation tick keeps running after a failure (calls=${escCalls})`);
  assert.ok(tgCalls >= 2, `telegram tick keeps running after a failure (calls=${tgCalls})`);
  assert.ok(errors.some((e) => e.includes("[notify]") && e.includes("notify channel down")), "escalation failure is logged, not swallowed");
  assert.ok(errors.some((e) => e.includes("[notify]") && e.includes("telegram getUpdates failed")), "telegram failure is logged, not swallowed");
});

test("escalationTick fans a new pending approval out to native push with a deep-link payload", async () => {
  const pushes: Array<{ title: string; body: string; data?: Record<string, unknown> }> = [];
  const notifies: string[] = [];
  // Unique ids so the module-level dedup set never suppresses this run.
  const taskId = `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  await escalationTick({
    getPendingStuck: () => [],
    getPendingApprovals: () => [
      { taskId, timestamp: "ts1", tool: "mcp__mail__send", command: "Email Carolin", context: "" },
    ],
    notify: (async (text: string) => { notifies.push(text); return { anySent: true }; }) as never,
    sendPush: async (o) => { pushes.push(o); return { sent: 1 }; },
    notifyFailures: async () => {},
  });

  assert.equal(pushes.length, 1, "exactly one native push for the pending approval");
  assert.equal(pushes[0].title, "Approval needed");
  assert.match(pushes[0].body, /mcp__mail__send/);
  assert.equal(pushes[0].data?.kind, "approval");
  assert.equal(pushes[0].data?.taskId, taskId);
  assert.equal(pushes[0].data?.timestamp, "ts1");
  // The Telegram/iMessage/email path still fired too — push is additive.
  assert.equal(notifies.length, 1);
});

test("escalationTick: a push transport failure never breaks the Telegram/iMessage escalation", async () => {
  const notifies: string[] = [];
  const taskId = `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  // sendPush throws — escalationTick must still resolve and must still have
  // called notify() for the item.
  await escalationTick({
    getPendingStuck: () => [],
    getPendingApprovals: () => [
      { taskId, timestamp: "ts1", tool: "mcp__x__y", command: "do a thing", context: "" },
    ],
    notify: (async (text: string) => { notifies.push(text); return { anySent: true }; }) as never,
    sendPush: async () => { throw new Error("apns down"); },
    notifyFailures: async () => {},
  });

  assert.equal(notifies.length, 1, "notify() still fired despite the push failure");
});
