import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-capgap-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { recordFeedback, listFeedback } = await import("./feedback");
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

test("runCapabilityGapDetection files deduped proposals and never acquires anything", () => {
  // Two chronic capability gaps + one ordinary bug that must be ignored.
  for (let i = 0; i < 2; i++) recordFeedback({ kind: "enhancement", title: "Couldn't send an SMS — messages not connected", source: "distill" });
  for (let i = 0; i < 2; i++) recordFeedback({ kind: "enhancement", title: "No way to follow the steps to close the books", source: "distill" });
  recordFeedback({ kind: "bug", title: "Board sort order is off", source: "distill" });
  recordFeedback({ kind: "bug", title: "Board sort order is off", source: "distill" });

  const result = runCapabilityGapDetection(2);
  assert.equal(result.gaps, 2);
  assert.equal(result.proposalsFiled, 2);
  assert.equal(result.gated, 1);          // the SMS/lane one
  assert.equal(result.selfServiceable, 1); // the steps/skill one

  const proposals = listFeedback().filter((f) => f.source === CAPABILITY_PROPOSAL_SOURCE);
  assert.equal(proposals.length, 2);
  assert.ok(proposals.every((p) => p.title.startsWith("Capability gap:")));

  // Idempotent: a second pass files no duplicates.
  assert.equal(runCapabilityGapDetection(2).proposalsFiled, 0);
});
