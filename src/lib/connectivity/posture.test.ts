import assert from "node:assert/strict";
import test from "node:test";

import { describeLocalPosture, describeAllPostures } from "./posture";

test("cloud-ok: everything works", () => {
  const r = describeLocalPosture("cloud-ok");
  assert.ok(r.capabilities.every((c) => c.disposition === "works"));
  assert.equal(r.allHonest, true);
});

test("offline: local workhorses work, image degrades, cloud work queues — nothing silent", () => {
  const r = describeLocalPosture("offline");
  const by = (id: string) => r.capabilities.find((c) => c.id === id)!;
  assert.equal(by("local").disposition, "works");
  assert.equal(by("local").label, "Local model");
  assert.doesNotMatch(by("local").note, /qwen/i);
  assert.equal(by("termbee").disposition, "works");
  assert.equal(by("termbee").label, "Terminal Lane");
  assert.equal(by("desktopbee").disposition, "works");
  assert.equal(by("desktopbee").label, "Desktop Lane");
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
  assert.equal(r.counts.works, 4);
  assert.equal(r.counts.degraded, 1);
  assert.equal(r.counts.queued, 4);
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
