import assert from "node:assert/strict";
import test from "node:test";

import { describeLocalPosture, describeAllPostures } from "./posture";

test("cloud-ok: everything works", () => {
  const r = describeLocalPosture("cloud-ok");
  assert.ok(r.capabilities.every((c) => c.disposition === "works"));
  assert.equal(r.allHonest, true);
});

test("no local model configured (default): the Local model capability is absent", () => {
  // Post-Claude-native cutover there is no built-in local model, so the row
  // must not appear (and must never claim "works") unless one is configured.
  const r = describeLocalPosture("offline");
  assert.equal(r.capabilities.find((c) => c.id === "local"), undefined);
});

test("offline: local workhorses work, image degrades, cloud work queues — nothing silent", () => {
  const r = describeLocalPosture("offline");
  const by = (id: string) => r.capabilities.find((c) => c.id === id)!;
  assert.equal(by("desktopbee").disposition, "works");
  // Renamed: it is Desktop Lane's capability, not the lane itself. It now
  // renders nested under a "Desktop Lane" heading as "Control".
  assert.equal(by("desktopbee").label, "Desktop control");
  assert.equal(by("desktopbee").shortLabel, "Control");
  assert.equal(by("desktopbee").lane, "desktop");
  assert.equal(by("image").disposition, "degraded");        // mflux fallback
  assert.equal(by("frontier").disposition, "queued");
  assert.equal(by("webbee").disposition, "queued");
  assert.equal(by("browserbee").disposition, "queued");
  assert.equal(by("code-review-debt").disposition, "queued");
  // The honesty guarantee: no disposition is a silent failure.
  assert.ok(r.capabilities.every((c) => ["works", "degraded", "queued"].includes(c.disposition)));
  assert.equal(r.allHonest, true);
  assert.match(r.summary, /Nothing silently fails/);
  assert.equal(by("coo-router").disposition, "works"); // routing is local; only execution waits
  // No local model configured → works = desktopbee + coo-router.
  assert.equal(r.counts.works, 2);
  assert.equal(r.counts.degraded, 1);
  assert.equal(r.counts.queued, 4);
});

test("offline WITH an opt-in local model: the Local model capability appears and works", () => {
  const r = describeLocalPosture("offline", true);
  const local = r.capabilities.find((c) => c.id === "local")!;
  assert.ok(local, "local capability should be present when a local model is configured");
  assert.equal(local.disposition, "works");
  assert.equal(local.label, "Local model");
  assert.doesNotMatch(local.note, /qwen/i);
  assert.equal(r.counts.works, 3); // + local
});

test("local-only mirrors offline for cloud-needing capabilities", () => {
  const r = describeLocalPosture("local-only");
  assert.equal(r.capabilities.find((c) => c.id === "webbee")!.disposition, "queued");
  assert.equal(r.capabilities.find((c) => c.id === "image")!.disposition, "degraded");
});

test("all-mode report exposes every posture for console and mobile clients", () => {
  const report = describeAllPostures("local-only");
  assert.equal(report.current.mode, "local-only");
  assert.deepEqual(Object.keys(report.modes), ["cloud-ok", "local-only", "offline"]);
  assert.equal(report.modes["cloud-ok"].counts.queued, 0);
  assert.equal(report.modes["local-only"].capabilities.find((c) => c.id === "frontier")!.action, "wait_for_cloud");
  assert.equal(report.modes.offline.capabilities.find((c) => c.id === "image")!.action, "use_local_fallback");
});

test("every posture entry declares what KIND of thing it is", () => {
  // The panel groups by category; an entry without one would render in the
  // wrong group or silently vanish from the list.
  for (const mode of ["cloud-ok", "local-only", "offline"] as const) {
    for (const c of describeLocalPosture(mode).capabilities) {
      assert.ok(["capability", "policy"].includes(c.category), `${c.id} needs a category`);
    }
  }
});

test("lane-owned capabilities carry their lane and a short name; policies own neither", () => {
  const caps = describeLocalPosture("cloud-ok").capabilities;
  const by = (id: string) => caps.find((c) => c.id === id)!;

  // Browser Lane has TWO capabilities that degrade independently — that is the
  // real distinction the flat list was hiding behind "Browser Lane Read"
  // looking like a sibling of "Browser Lane".
  for (const id of ["webbee", "browserbee"]) {
    assert.equal(by(id).lane, "browser", `${id} is a capability OF Browser Lane`);
    assert.ok(by(id).shortLabel, `${id} needs a short name for nested rendering`);
    assert.equal(by(id).category, "capability");
  }
  assert.notEqual(by("webbee").shortLabel, by("browserbee").shortLabel);

  // Frontier review debt is a RULE. Nothing to start, nothing to be up — which
  // is precisely why it never belonged in the Agents list.
  assert.equal(by("code-review-debt").category, "policy");
  assert.equal(by("code-review-debt").lane, undefined);
  assert.equal(by("code-review-debt").shortLabel, undefined);
});

test("every declared lane owner is a real lane id", async () => {
  const { LANE_IDS } = await import("@/lib/lanes/contracts");
  for (const c of describeLocalPosture("cloud-ok").capabilities) {
    if (!c.lane) continue;
    assert.ok((LANE_IDS as readonly string[]).includes(c.lane), `${c.id} claims lane "${c.lane}", which is not a lane id`);
  }
});
