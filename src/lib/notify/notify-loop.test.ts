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

import { startNotifyLoop, stopNotifyLoop } from "./notify-loop";

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
