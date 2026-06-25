import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBrowserLaneReadinessConfig,
  readinessSweepDue,
  runReadinessSweepNow,
} from "./readiness-schedule";

test("parses + clamps the readiness maintenance config (defaults disabled)", () => {
  const def = parseBrowserLaneReadinessConfig(undefined);
  assert.equal(def.enabled, false);
  assert.equal(def.staleAfterHours, 24);
  assert.ok(def.hour >= 0 && def.hour <= 23);

  const c = parseBrowserLaneReadinessConfig({ enabled: true, hour: 99, staleAfterHours: -5 });
  assert.equal(c.enabled, true);
  assert.equal(c.hour, 23);          // clamped
  assert.equal(c.staleAfterHours, 1); // clamped to a sane minimum
});

test("readinessSweepDue fires once the target hour passes and not before / not twice", () => {
  const config = { enabled: true, hour: 7, staleAfterHours: 24 };
  const before = new Date("2026-06-25T06:30:00");
  const after = new Date("2026-06-25T07:30:00");
  assert.equal(readinessSweepDue(config, before), false);
  assert.equal(readinessSweepDue(config, after), true);
  // Already ran today after the target → not due again.
  assert.equal(readinessSweepDue({ ...config, lastRunAt: "2026-06-25T07:15:00" }, after), false);
  // Disabled → never due.
  assert.equal(readinessSweepDue({ ...config, enabled: false }, after), false);
});

test("runReadinessSweepNow stamps lastRunAt and summarizes the run (no secrets)", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const result = await runReadinessSweepNow({
    now: () => new Date("2026-06-25T07:30:00Z"),
    runReadiness: async () => ({
      ok: true, lane: "browser", siteId: "all", backendReady: false,
      runs: [
        { siteId: "heygen", probeId: "p1", status: "needs_reauth", color: "orange", traceRunId: "t1", failedAssertions: [] },
        { siteId: "vercel", probeId: "p2", status: "ready", color: "green", traceRunId: "t2", failedAssertions: [] },
      ],
    }),
    setConfig: (patch) => { patches.push(patch as Record<string, unknown>); return { enabled: true, hour: 7, staleAfterHours: 24, ...patch }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.runCount, 2);
  assert.equal(result.byColor.orange, 1);
  assert.equal(result.byColor.green, 1);
  assert.equal(result.ranAt, "2026-06-25T07:30:00.000Z");
  assert.equal(patches[0]?.lastRunAt, result.ranAt); // stamped with the run time
  // The summary must not carry secret material.
  assert.doesNotMatch(JSON.stringify(result), /password|cookie|secret|credentialRef/i);
});

test("runReadinessSweepNow reports honestly when no sites are configured", async () => {
  const result = await runReadinessSweepNow({
    now: () => new Date("2026-06-25T07:30:00"),
    runReadiness: async () => ({ ok: false, lane: "browser", siteId: "all", backendReady: false, runs: [], error: "No Browser Lane sites are configured." }),
    setConfig: () => ({ enabled: true, hour: 7, staleAfterHours: 24 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.runCount, 0);
  assert.match(result.error ?? "", /no browser lane sites/i);
});
