/**
 * Phase 1 gate integration test: connectivity policy + daemon behavior.
 *
 * Simulates the "pull the network cable" scenario using the ConnectivityPolicy
 * API (mock layer — no actual network sockets opened).
 *
 * Scenarios:
 *  1. Daemon starts cloud-ok; frontier work routes to frontier tier.
 *  2. Usage window exhausted → local-only; queued frontier-class work stays pending.
 *  3. Probe failures accumulate → offline; all network capabilities blocked.
 *  4. Probe restored → cloud-ok; previously blocked capabilities recover.
 *  5. Manual override keeps mode fixed regardless of probe/usage events.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ConnectivityPolicy } from "@/lib/connectivity/policy";
import { routeByRole } from "@/lib/routing/router";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allCapabilities(policy: ConnectivityPolicy) {
  return {
    frontier:   policy.getCapability("frontier"),
    local:      policy.getCapability("local"),
    webbee:     policy.getCapability("webbee"),
    browserbee: policy.getCapability("browserbee"),
    desktopbee: policy.getCapability("desktopbee"),
    image:      policy.getCapability("image"),
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: Normal cloud-ok operation
// ---------------------------------------------------------------------------

test("scenario 1: cloud-ok — frontier and all network capabilities available", () => {
  const policy = new ConnectivityPolicy();
  assert.equal(policy.mode, "cloud-ok");

  const caps = allCapabilities(policy);
  assert.equal(caps.frontier.available, true);
  assert.equal(caps.webbee.available, true);
  assert.equal(caps.browserbee.available, true);
  assert.equal(caps.local.available, true);
  assert.equal(caps.desktopbee.available, true);
  assert.equal(caps.image.available, true);

  // Work routes to frontier
  const thinkRoute = routeByRole("think", policy);
  assert.equal(thinkRoute.tier, "frontier-premium");
  assert.equal(thinkRoute.frontierReviewDebt, false);
  assert.equal(routeByRole("code-critical", policy).tier, "frontier");
});

// ---------------------------------------------------------------------------
// Scenario 2: Usage window exhausted → local-only; queued tasks stay pending
// ---------------------------------------------------------------------------

test("scenario 2: usage exhaustion → local-only — frontier blocked, local available", () => {
  const policy = new ConnectivityPolicy();

  // Simulate usage window exhausted for Claude
  policy.onUsageWindowExhausted("claude");
  assert.equal(policy.mode, "local-only");

  const caps = allCapabilities(policy);
  assert.equal(caps.frontier.available, false);
  assert.equal(caps.local.available, true);
  assert.equal(caps.desktopbee.available, true);
  assert.equal(caps.webbee.available, false, "Browser Lane read capability disabled in local-only");
  assert.equal(caps.image.available, false, "Image requires cloud");

  // "Queued frontier work stays pending" — code-critical accrues debt
  const route = routeByRole("code-critical", policy);
  assert.equal(route.tier, "local-primary");
  assert.equal(route.frontierReviewDebt, true, "Debt accrued for later frontier review");

  // execute still goes to local (same as cloud-ok — it's always local)
  assert.equal(routeByRole("execute", policy).tier, "local-secondary");
});

test("scenario 2b: usage window restored → cloud-ok recovers", () => {
  const policy = new ConnectivityPolicy();
  policy.onUsageWindowExhausted("claude");
  assert.equal(policy.mode, "local-only");

  policy.onUsageWindowRestored("claude");
  assert.equal(policy.mode, "cloud-ok");

  // All capabilities restored
  assert.equal(policy.getCapability("frontier").available, true);
  assert.equal(policy.getCapability("webbee").available, true);
  assert.equal(routeByRole("code-critical", policy).frontierReviewDebt, false);
});

// ---------------------------------------------------------------------------
// Scenario 3: Probe failures → offline
// ---------------------------------------------------------------------------

test("scenario 3: probe failures accumulate → offline, all network blocked", () => {
  const policy = new ConnectivityPolicy();

  for (let i = 0; i < ConnectivityPolicy.OFFLINE_PROBE_THRESHOLD; i++) {
    assert.notEqual(policy.mode, "offline", "Should not be offline before threshold");
    policy.onProbeFailure();
  }
  assert.equal(policy.mode, "offline");

  const caps = allCapabilities(policy);
  assert.equal(caps.frontier.available, false);
  assert.equal(caps.webbee.available, false);
  assert.equal(caps.browserbee.available, false);
  assert.equal(caps.image.available, false);
  // Local and desktopbee still work
  assert.equal(caps.local.available, true);
  assert.equal(caps.desktopbee.available, true);
});

// ---------------------------------------------------------------------------
// Scenario 4: Network restored → probe clears failures
// ---------------------------------------------------------------------------

test("scenario 4: probe success clears failures and restores connectivity", () => {
  const policy = new ConnectivityPolicy();
  for (let i = 0; i < ConnectivityPolicy.OFFLINE_PROBE_THRESHOLD; i++) {
    policy.onProbeFailure();
  }
  assert.equal(policy.mode, "offline");

  // Network cable plugged back in
  policy.onProbeSuccess();
  assert.equal(policy.mode, "cloud-ok");
  assert.equal(policy.getCapability("frontier").available, true);
  assert.equal(policy.getCapability("webbee").available, true);
  assert.equal(routeByRole("code-critical", policy).frontierReviewDebt, false);
});

// ---------------------------------------------------------------------------
// Scenario 5: Manual override locks mode regardless of probe/usage events
// ---------------------------------------------------------------------------

test("scenario 5: manual override — blocks mode changes from probe/usage", () => {
  const policy = new ConnectivityPolicy();
  policy.setManualOverride("local-only", "testing local mode");
  assert.equal(policy.mode, "local-only");

  // Usage exhaustion shouldn't change mode (already local-only)
  policy.onUsageWindowExhausted("claude");
  assert.equal(policy.mode, "local-only");

  // Probe failures should not override the manual setting to offline
  for (let i = 0; i < 10; i++) policy.onProbeFailure();
  assert.equal(policy.mode, "local-only", "Manual override wins over probe failures");

  // Clear override — derived mode kicks in (probe failures → offline)
  policy.setManualOverride(null);
  assert.equal(policy.mode, "offline", "Without override: probe failures drive offline");
});

// ---------------------------------------------------------------------------
// Scenario 6: modeChange events fire for console SSE
// ---------------------------------------------------------------------------

test("scenario 6: modeChange events fire correctly for SSE broadcast", (t, done) => {
  const policy = new ConnectivityPolicy();
  const events: string[] = [];

  policy.on("modeChange", ({ prev, current }) => {
    events.push(`${prev}→${current}`);
    if (events.length === 2) {
      assert.deepEqual(events, ["cloud-ok→local-only", "local-only→cloud-ok"]);
      done();
    }
  });

  policy.onUsageWindowExhausted("claude");
  policy.onUsageWindowRestored("claude");
});

// ---------------------------------------------------------------------------
// Scenario 7: role routing across all modes (routing table completeness)
// ---------------------------------------------------------------------------

test("scenario 7: routing table covers all roles in all modes", () => {
  const modes = ["cloud-ok", "local-only", "offline"] as const;
  const roles = ["think", "execute", "code-critical", "image", "cheap-web"] as const;

  for (const modeStr of modes) {
    const policy = new ConnectivityPolicy();
    policy.setManualOverride(modeStr === "cloud-ok" ? null : modeStr);
    for (const role of roles) {
      const result = routeByRole(role, policy);
      assert.ok(result.tier, `tier missing for role=${role} mode=${modeStr}`);
      assert.ok(result.reason.length > 0, `reason missing for role=${role} mode=${modeStr}`);
    }
  }
});
