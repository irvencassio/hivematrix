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
  // Counts are CAPABILITIES only (the policy is excluded — it is a rule, not a
  // working capability). Offline: works = desktop, coo-router, mail, message,
  // memory — the four lanes that drive local apps/indexes, plus local routing.
  assert.equal(r.counts.works, 5);
  assert.equal(r.counts.degraded, 1);                       // image → mflux fallback
  assert.equal(r.counts.queued, 4);                         // frontier, browser read+workflow, review
  assert.equal(r.counts.works + r.counts.degraded + r.counts.queued,
    r.capabilities.filter((c) => c.category !== "policy").length);
});

test("offline WITH an opt-in local model: the Local model capability appears and works", () => {
  const r = describeLocalPosture("offline", true);
  const local = r.capabilities.find((c) => c.id === "local")!;
  assert.ok(local, "local capability should be present when a local model is configured");
  assert.equal(local.disposition, "works");
  assert.equal(local.label, "Local model");
  assert.doesNotMatch(local.note, /qwen/i);
  assert.equal(r.counts.works, 6); // the five offline-capable ones + the local model
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

test("counts describe capabilities only — a policy is not a working capability", () => {
  // The summary says "All capabilities available … (N works)". Counting the
  // policy made N one higher than the number of capabilities, so the panel
  // contradicted its own sentence.
  for (const mode of ["cloud-ok", "local-only", "offline"] as const) {
    const r = describeLocalPosture(mode);
    const caps = r.capabilities.filter((c) => c.category !== "policy");
    const total = r.counts.works + r.counts.degraded + r.counts.queued;
    assert.equal(total, caps.length, `${mode}: counts must sum to the capability count, not every entry`);
    assert.ok(r.capabilities.length > caps.length, "there is at least one policy, so this test is meaningful");
  }
});

test("every canonical lane has a posture entry — no running lane is silently undescribed", async () => {
  // The panel's promise is "nothing silently fails". Four lanes (mail, message,
  // review, memory) were running with no entry at all, so there was no way to
  // tell from here whether mail survives going offline.
  const { LANE_IDS } = await import("@/lib/lanes/contracts");
  const covered = new Set(
    describeLocalPosture("cloud-ok").capabilities.map((c) => c.lane).filter(Boolean),
  );
  const missing = LANE_IDS.filter((id) => !covered.has(id));
  assert.deepEqual(missing, [], `lanes with no posture entry: ${missing.join(", ")}`);
});

test("lanes that run locally keep working offline; only model-dependent work queues", () => {
  const off = describeLocalPosture("offline");
  const by = (id: string) => off.capabilities.find((c) => c.id === id)!;

  // These drive local macOS apps / local indexes — no network in their own path.
  for (const id of ["mailbee", "messagebee", "brainbee", "desktopbee"]) {
    assert.equal(by(id).disposition, "works", `${id} runs locally and must not claim to need the cloud`);
  }
  // Review needs a text model, and after the Claude-native cutover every text
  // role is unavailable without cloud.
  assert.equal(by("review").disposition, "queued");
  assert.equal(by("review").action, "wait_for_cloud");
});
