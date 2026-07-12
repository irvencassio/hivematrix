import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-capgap-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { recordFeedback, listFeedback, setFeedbackStatus } = await import("./feedback");
const {
  CAPABILITY_PROPOSAL_SOURCE,
  isCapabilityGap,
  classifyRemedy,
  remedyIsSelfServiceable,
  proposalFromGap,
  runCapabilityGapDetection,
} = await import("./capability-gaps");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

/** Resolve every still-open/triaged item so it stops re-clustering into later
 * tests — the DB is shared across this whole file (see TMP above). */
function resolveAllOpen() {
  for (const f of listFeedback()) {
    if (f.status === "open" || f.status === "triaged") setFeedbackStatus(f._id, "done");
  }
}

const cluster = (exemplarTitle: string, count = 2) => ({
  normalizedTitle: exemplarTitle.toLowerCase(),
  count,
  exemplarTitle,
  kind: "enhancement" as const,
  ids: ["a", "b"],
});

test("isCapabilityGap distinguishes missing-capability friction from ordinary bugs", () => {
  assert.equal(isCapabilityGap(cluster("Couldn't send a calendar invite — no way to do it")), true);
  assert.equal(isCapabilityGap(cluster("Unable to access the CRM")), true);
  assert.equal(isCapabilityGap(cluster("Button color is wrong on the board")), false);
});

test("classifyRemedy routes lane/pack/skill/unknown", () => {
  assert.equal(classifyRemedy(cluster("couldn't send email — mail not connected")), "lane");
  assert.equal(classifyRemedy(cluster("no way to open the browser session")), "lane");
  assert.equal(classifyRemedy(cluster("missing Stripe integration to install")), "pack");
  assert.equal(classifyRemedy(cluster("couldn't follow the steps to rotate keys")), "skill");
  assert.equal(classifyRemedy(cluster("unable to do the thing")), "unknown");
});

test("only skills are self-serviceable; lanes/packs/unknown stay gated (ClawHavoc line)", () => {
  assert.equal(remedyIsSelfServiceable("skill"), true);
  assert.equal(remedyIsSelfServiceable("lane"), false);
  assert.equal(remedyIsSelfServiceable("pack"), false);
  assert.equal(remedyIsSelfServiceable("unknown"), false);
});

test("proposalFromGap labels gating honestly", () => {
  const lane = proposalFromGap(cluster("couldn't send email — mail not connected", 4));
  assert.equal(lane.remedy, "lane");
  assert.equal(lane.gated, true);
  assert.match(lane.detail, /ACQUIRING stays gated/);
  assert.match(lane.title, /^Capability gap:/);

  const skill = proposalFromGap(cluster("couldn't follow the steps to deploy", 3));
  assert.equal(skill.remedy, "skill");
  assert.equal(skill.gated, false);
  assert.match(skill.detail, /Self-serviceable/);
});

test("runCapabilityGapDetection files deduped proposals and never acquires anything (non-autonomous)", async () => {
  // Two chronic capability gaps + one ordinary bug that must be ignored.
  for (let i = 0; i < 2; i++) recordFeedback({ kind: "enhancement", title: "Couldn't send an SMS — messages not connected", source: "distill" });
  for (let i = 0; i < 2; i++) recordFeedback({ kind: "enhancement", title: "No way to follow the steps to close the books", source: "distill" });
  recordFeedback({ kind: "bug", title: "Board sort order is off", source: "distill" });
  recordFeedback({ kind: "bug", title: "Board sort order is off", source: "distill" });

  const result = await runCapabilityGapDetection(2, { autonomyLevel: "standard" });
  assert.equal(result.gaps, 2);
  assert.equal(result.proposalsFiled, 2);
  assert.equal(result.gated, 1);          // the SMS/lane one
  assert.equal(result.selfServiceable, 1); // the steps/skill one
  assert.equal(result.acquired, 0);

  const proposals = listFeedback().filter((f) => f.source === CAPABILITY_PROPOSAL_SOURCE);
  assert.equal(proposals.length, 2);
  assert.ok(proposals.every((p) => p.title.startsWith("Capability gap:")));

  // Idempotent: a second pass files no duplicates.
  assert.equal((await runCapabilityGapDetection(2, { autonomyLevel: "standard" })).proposalsFiled, 0);
});

test("autonomous: a skill-remedy gap goes straight to acquisition, not a duplicate proposal", async () => {
  resolveAllOpen(); // isolate from earlier tests' leftover open clusters (shared DB)
  for (let i = 0; i < 2; i++) {
    recordFeedback({ kind: "enhancement", title: "Couldn't follow the steps to rotate keys", source: "distill" });
  }
  const acquireCalls: Array<{ goal: string; whyNeeded: string }> = [];
  const result = await runCapabilityGapDetection(2, {
    autonomyLevel: "autonomous",
    acquire: async (opts) => {
      acquireCalls.push({ goal: opts.goal, whyNeeded: opts.whyNeeded });
      return { outcome: "registered", reason: "learned it", skillName: "rotate-keys" };
    },
  });
  assert.equal(acquireCalls.length, 1);
  assert.match(acquireCalls[0].goal, /rotate keys/i);
  assert.match(acquireCalls[0].whyNeeded, /recurring capability gap/i);
  assert.ok(result.acquired >= 1);

  const dupe = listFeedback().filter(
    (f) => f.source === CAPABILITY_PROPOSAL_SOURCE && f.title.includes("rotate keys"),
  );
  assert.equal(dupe.length, 0); // no double-surfacing for a gap we attempted to acquire
});

test("standard: a skill-remedy gap does NOT acquire; the filed proposal is marked one-tap learnable", async () => {
  resolveAllOpen();
  for (let i = 0; i < 2; i++) {
    recordFeedback({ kind: "enhancement", title: "No way to follow the steps to reindex search", source: "distill" });
  }
  let acquireCalled = false;
  const result = await runCapabilityGapDetection(2, {
    autonomyLevel: "standard",
    acquire: async () => {
      acquireCalled = true;
      return { outcome: "registered", reason: "" };
    },
  });
  assert.equal(acquireCalled, false);
  assert.equal(result.acquired, 0);

  const proposal = listFeedback().find(
    (f) => f.source === CAPABILITY_PROPOSAL_SOURCE && f.title.includes("reindex search"),
  );
  assert.ok(proposal);
  assert.match(proposal!.detail, /\[learnable\]/);
});

test("ClawHavoc line: a lane-remedy gap under autonomous NEVER acquires, only proposes", async () => {
  resolveAllOpen();
  for (let i = 0; i < 2; i++) {
    recordFeedback({ kind: "enhancement", title: "Couldn't send email — mail not connected here", source: "distill" });
  }
  let acquireCalled = false;
  const result = await runCapabilityGapDetection(2, {
    autonomyLevel: "autonomous",
    acquire: async () => {
      acquireCalled = true;
      return { outcome: "registered", reason: "" };
    },
  });
  assert.equal(acquireCalled, false);
  assert.equal(result.acquired, 0);
  assert.ok(result.gated >= 1);

  const proposal = listFeedback().find(
    (f) => f.source === CAPABILITY_PROPOSAL_SOURCE && f.title.includes("mail not connected here"),
  );
  assert.ok(proposal);
});

test("autonomous: acquire throwing is best-effort — the pass never throws and still returns a result", async () => {
  resolveAllOpen();
  for (let i = 0; i < 2; i++) {
    recordFeedback({ kind: "enhancement", title: "Couldn't follow the steps to purge the cache", source: "distill" });
  }
  const result = await runCapabilityGapDetection(2, {
    autonomyLevel: "autonomous",
    acquire: async () => {
      throw new Error("boom");
    },
  });
  assert.ok(result.gaps >= 1);
  assert.ok(result.acquired >= 1);
});
