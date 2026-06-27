import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntake } from "./classify";

test("a small, single-step prompt stays a normal_task and runs now", () => {
  const r = classifyIntake({ description: "Fix the typo in the README header." });
  assert.equal(r.kind, "normal_task");
  assert.equal(r.suggestedMode, "run_now");
  assert.equal(r.risk, "low");
  assert.equal(r.packageCandidate, undefined);
});

test("a broad 'fix all' prompt becomes a work_package_candidate with >=2 items", () => {
  const r = classifyIntake({
    description:
      "Fix all the lint errors across the codebase, update every outdated dependency, and refactor the auth module.",
  });
  assert.equal(r.kind, "work_package_candidate");
  assert.equal(r.suggestedMode, "split");
  assert.ok(r.packageCandidate, "carries a package candidate");
  assert.ok(r.packageCandidate!.items.length >= 2, "decomposes into >=2 items");
  assert.ok(r.reasons.length > 0);
});

test("an explicit multi-step build+deploy prompt becomes a work_package_candidate", () => {
  const r = classifyIntake({
    description: "1. Run the test suite. 2. Build the daemon. 3. Deploy and publish the release.",
  });
  assert.equal(r.kind, "work_package_candidate");
  assert.ok(r.packageCandidate!.items.length >= 2);
});

test("release/deploy wording produces a final-gated (held) item, ordered last", () => {
  const r = classifyIntake({
    description: "Fix all the failing tests and then deploy the release to production.",
  });
  assert.equal(r.kind, "work_package_candidate");
  const items = r.packageCandidate!.items;
  const deployItem = items.find((i) => /deploy|release|publish/i.test(i.title + " " + i.prompt));
  assert.ok(deployItem, "has a deploy/release item");
  assert.equal(deployItem!.executionMode, "hold");
  assert.equal(deployItem!.risk, "high");
  // final-gated: the held release item depends on the earlier items.
  assert.ok(deployItem!.dependsOn.length >= 1, "release item is sequenced after prior items");
});

test("an active same-project task triggers a hold/collision recommendation for a writer", () => {
  const r = classifyIntake({
    description: "Refactor the database layer and rename the columns.",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
    activeSameProject: [{ taskId: "t1", title: "Other active edit", worktreeName: null }],
  });
  assert.ok(r.projectCollision, "reports a collision");
  assert.equal(r.projectCollision!.active, true);
  assert.deepEqual(r.projectCollision!.activeTaskIds, ["t1"]);
  assert.equal(r.projectCollision!.recommendation, "hold");
  assert.equal(r.suggestedMode, "hold");
});

test("worktree-backed wording with an active same-project task allows worktree_parallel", () => {
  const r = classifyIntake({
    description: "In a fresh worktree, update the changelog for this project.",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
    activeSameProject: [{ taskId: "t1", title: "Other active edit", worktreeName: null }],
  });
  assert.ok(r.projectCollision);
  assert.equal(r.projectCollision!.recommendation, "worktree_parallel");
  assert.equal(r.suggestedMode, "worktree_parallel");
});

test("a read-only/safe prompt with an active same-project task allows safe_parallel", () => {
  const r = classifyIntake({
    description: "Review and summarize the current auth code; produce a report.",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
    activeSameProject: [{ taskId: "t1", title: "Other active edit", worktreeName: null }],
  });
  assert.ok(r.projectCollision);
  assert.equal(r.projectCollision!.recommendation, "safe_parallel");
  assert.equal(r.suggestedMode, "safe_parallel");
});

test("a prompt already routed to a lane/workflow executor is not promoted", () => {
  const r = classifyIntake({
    description: "Fix all the things and deploy everything across the codebase.",
    executor: "workflow",
  });
  assert.equal(r.kind, "workflow");
  assert.equal(r.packageCandidate, undefined);
});

test("a single broad-sounding step does not become a package (needs >=2 items)", () => {
  const r = classifyIntake({ description: "Refactor the whole auth module." });
  assert.equal(r.kind, "normal_task");
});

// ── proposedItemsFromFragments + classifyIntakeAsync (model-advised) ──

import { proposedItemsFromFragments, classifyIntakeAsync, _setIntakeDecomposeDepsForTests } from "./classify";

test("proposedItemsFromFragments stamps a release fragment as held/high regardless of source", () => {
  const items = proposedItemsFromFragments(["update the docs", "deploy the release to prod"]);
  assert.equal(items.length, 2);
  const rel = items[1];
  assert.equal(rel.risk, "high");
  assert.equal(rel.executionMode, "hold");
  assert.ok(rel.dependsOn.length >= 1, "held release depends on prior items");
});

test("classifyIntakeAsync replaces items with model fragments and notes the reason", async () => {
  const r = await classifyIntakeAsync(
    { description: "Fix all the things across the codebase and tidy up everything." },
    { client: async () => '["Refactor the parser", "Add tests for the parser", "Update the changelog"]', connectivityMode: "local-only" },
  );
  assert.equal(r.kind, "work_package_candidate");
  assert.deepEqual(r.packageCandidate!.items.map((i) => i.prompt), ["Refactor the parser", "Add tests for the parser", "Update the changelog"]);
  assert.ok(r.reasons.includes("model-advised decomposition"));
});

test("classifyIntakeAsync keeps the held gate when the model proposes a release step", async () => {
  const r = await classifyIntakeAsync(
    { description: "Fix all the things and deploy everything." },
    { client: async () => '["Fix the failing tests", "Deploy the release to production"]', connectivityMode: "cloud-ok" },
  );
  const rel = r.packageCandidate!.items.find((i) => /deploy|release/i.test(i.prompt))!;
  assert.equal(rel.executionMode, "hold");
  assert.equal(rel.risk, "high");
});

test("classifyIntakeAsync falls back to the deterministic split when the model fails", async () => {
  const det = classifyIntake({ description: "Fix all the lint, update every dep, and refactor auth." });
  const r = await classifyIntakeAsync(
    { description: "Fix all the lint, update every dep, and refactor auth." },
    { client: async () => { throw new Error("model down"); }, connectivityMode: "cloud-ok" },
  );
  assert.equal(r.kind, "work_package_candidate");
  assert.deepEqual(r.packageCandidate!.items.map((i) => i.prompt), det.packageCandidate!.items.map((i) => i.prompt));
  assert.ok(!r.reasons.includes("model-advised decomposition"));
});

test("classifyIntakeAsync never calls a model for a small/normal task", async () => {
  let called = false;
  const r = await classifyIntakeAsync(
    { description: "Fix the typo in the footer." },
    { client: async () => { called = true; return '["a","b"]'; }, connectivityMode: "cloud-ok" },
  );
  assert.equal(r.kind, "normal_task");
  assert.equal(called, false, "no model call on the common path");
});

test("classifyIntakeAsync with no deps + flag off behaves like the deterministic classifier", async () => {
  _setIntakeDecomposeDepsForTests(null);
  const r = await classifyIntakeAsync({ description: "Fix all the lint, update every dep, and refactor auth." });
  // Flag defaults off → identical to deterministic split, no model reason.
  assert.equal(r.kind, "work_package_candidate");
  assert.ok(!r.reasons.includes("model-advised decomposition"));
});
