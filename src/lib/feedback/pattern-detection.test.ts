import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-pattern-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { recordFeedback, listFeedback, setFeedbackStatus } = await import("./feedback");
const {
  PATTERN_PROPOSAL_SOURCE,
  clusterFeedback,
  proposalFromCluster,
  runPatternDetection,
} = await import("./pattern-detection");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

const mk = (title: string, kind: "bug" | "enhancement" = "bug", source = "test") =>
  recordFeedback({ kind, title, source });

test("clusterFeedback groups by normalized title above the threshold, sorted by count", () => {
  const items = [
    { _id: "1", kind: "bug", title: "Browser auth failed", status: "open", source: "t", detail: "", createdAt: "", updatedAt: "" },
    { _id: "2", kind: "bug", title: "browser AUTH failed!", status: "open", source: "t", detail: "", createdAt: "", updatedAt: "" },
    { _id: "3", kind: "bug", title: "Browser auth failed.", status: "triaged", source: "t", detail: "", createdAt: "", updatedAt: "" },
    { _id: "4", kind: "enhancement", title: "Add dark mode", status: "open", source: "t", detail: "", createdAt: "", updatedAt: "" },
  ] as const;
  const clusters = clusterFeedback(items as never, 3);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 3);
  assert.equal(clusters[0].ids.length, 3);
  assert.match(clusters[0].exemplarTitle, /Browser auth failed/);
});

test("clusterFeedback ignores closed items and its own prior proposals", () => {
  const items = [
    { _id: "1", kind: "bug", title: "Flaky probe", status: "done", source: "t", detail: "", createdAt: "", updatedAt: "" },
    { _id: "2", kind: "bug", title: "Flaky probe", status: "wontfix", source: "t", detail: "", createdAt: "", updatedAt: "" },
    { _id: "3", kind: "bug", title: "Flaky probe", status: "open", source: "t", detail: "", createdAt: "", updatedAt: "" },
    { _id: "4", kind: "enhancement", title: "Recurring: Flaky probe", status: "open", source: PATTERN_PROPOSAL_SOURCE, detail: "", createdAt: "", updatedAt: "" },
  ] as const;
  // Only one still-open non-proposal item → below the min of 3 → no cluster.
  assert.equal(clusterFeedback(items as never, 3).length, 0);
});

test("proposalFromCluster renders an enhancement tagged with the detector source", () => {
  const p = proposalFromCluster({
    normalizedTitle: "browser auth failed",
    count: 4,
    exemplarTitle: "Browser auth failed",
    kind: "bug",
    ids: ["1", "2", "3", "4"],
  });
  assert.equal(p.kind, "enhancement");
  assert.equal(p.source, PATTERN_PROPOSAL_SOURCE);
  assert.match(p.title, /^Recurring: Browser auth failed/);
  assert.match(p.detail, /4 open\/triaged items/);
  assert.match(p.detail, /keeps failing/);
});

test("runPatternDetection files one deduped proposal per chronic cluster and is idempotent", () => {
  for (let i = 0; i < 3; i++) mk("Terminal session dropped");
  mk("One-off glitch"); // below threshold — no proposal

  const first = runPatternDetection(3);
  assert.equal(first.clusters, 1);
  assert.equal(first.proposalsFiled, 1);

  const proposals = listFeedback().filter((f) => f.source === PATTERN_PROPOSAL_SOURCE);
  assert.equal(proposals.length, 1);
  assert.match(proposals[0].title, /Recurring: Terminal session dropped/);

  // Running again must not file a duplicate while the proposal is still open.
  const second = runPatternDetection(3);
  assert.equal(second.proposalsFiled, 0);
  assert.equal(listFeedback().filter((f) => f.source === PATTERN_PROPOSAL_SOURCE).length, 1);
});

test("a resolved proposal can be re-filed if the pattern is still chronic", () => {
  const proposal = listFeedback().find((f) => f.source === PATTERN_PROPOSAL_SOURCE)!;
  setFeedbackStatus(proposal._id, "done"); // operator addressed it
  const again = runPatternDetection(3);
  assert.equal(again.proposalsFiled, 1); // pattern persists → new proposal
});
