import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  const oldHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hm-intake-flags-"));
  try {
    process.env.HOME = tempHome;
    const r = await classifyIntakeAsync({ description: "Fix all the lint, update every dep, and refactor auth." });
    // Flag defaults off → identical to deterministic split, no model reason.
    assert.equal(r.kind, "work_package_candidate");
    assert.ok(!r.reasons.includes("model-advised decomposition"));
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});

// ── deterministicFragments + forceWorkPackage (explicit Work Package route) ──

import { deterministicFragments, forceWorkPackage } from "./classify";

test("deterministicFragments splits a comma list and always returns at least one", () => {
  assert.ok(deterministicFragments("do a, do b, and do c").length >= 3);
  assert.deepEqual(deterministicFragments("just one thing"), ["just one thing"]);
  assert.ok(deterministicFragments("   ").length >= 1); // never empty
});

test("forceWorkPackage returns >=1 item even for a non-broad prompt", async () => {
  const pc = await forceWorkPackage({ description: "Refactor the auth module." });
  assert.ok(pc.items.length >= 1);
  assert.ok(pc.title);
});

test("forceWorkPackage still stamps a release step as held (policy wins)", async () => {
  const pc = await forceWorkPackage({ description: "build the app, then deploy the release to prod" });
  const rel = pc.items.find((i) => /deploy|release/i.test(i.prompt));
  assert.ok(rel, "has a release item");
  assert.equal(rel!.executionMode, "hold");
  assert.equal(rel!.risk, "high");
});

// ── Goal Flight classifier ────────────────────────────────────────────────────

test("broad outcome-based prompt returns goalFlight metadata", () => {
  const r = classifyIntake({
    description: "Create a web site that lets users browse products, add to cart, and checkout with Stripe.",
  });
  assert.ok(r.goalFlight, "goalFlight metadata present");
  assert.equal(typeof r.goalFlight!.goal, "string", "goal is a string");
  assert.ok(r.goalFlight!.goal.length > 0, "goal is non-empty");
  assert.ok(Array.isArray(r.goalFlight!.successCriteria), "successCriteria is an array");
});

test("build a platform prompt triggers goalFlight", () => {
  const r = classifyIntake({
    description: "Build me a SaaS platform for managing team schedules, with user auth, calendar views, and Slack notifications.",
  });
  assert.ok(r.goalFlight, "goalFlight detected for broad platform prompt");
});

test("simple fix-a-bug prompt does not trigger goalFlight", () => {
  const r = classifyIntake({
    description: "Fix the null pointer in the login handler.",
  });
  assert.equal(r.goalFlight, undefined, "single-step bug fix is not a Goal Flight");
});

test("explicit multi-step refactor does not trigger goalFlight — it stays a checklist Work Package", () => {
  const r = classifyIntake({
    description: "1. Extract auth helpers. 2. Move to shared module. 3. Update all import paths.",
  });
  assert.equal(r.kind, "work_package_candidate");
  assert.equal(r.goalFlight, undefined, "explicit checklist does not become a Goal Flight");
});

// ── Goal Flight metadata determinism ─────────────────────────────────────────

test("classifyIntake: goal field equals provided title when title is given", () => {
  const r = classifyIntake({
    title: "My eShop",
    description: "Create a web site that lets users browse products and checkout with Stripe.",
  });
  assert.ok(r.goalFlight, "goalFlight present");
  assert.equal(r.goalFlight!.goal, "My eShop", "goal uses title, not auto-extracted sentence");
});

test("classifyIntake: successCriteria extracted deterministically from comma-separated features after 'with'", () => {
  const r = classifyIntake({
    description: "Build a marketplace platform with product listings, seller profiles, and Stripe payments.",
  });
  assert.ok(r.goalFlight, "goalFlight present");
  const sc = r.goalFlight!.successCriteria;
  assert.ok(sc.length >= 2, `expected >=2 criteria, got ${sc.length}: ${JSON.stringify(sc)}`);
  assert.ok(sc.some((s) => /product/i.test(s)), "successCriteria mentions product listings");
});

test("classifyIntake: successCriteria falls back to default when no criteria phrase found", () => {
  // Long enough to pass the >80 char gate but no with/that/including/featuring
  const desc = "Create a web application to help teams stay organized, focused, and effective all day long";
  const r = classifyIntake({ description: desc });
  assert.ok(r.goalFlight, "goalFlight present for a long goal prompt");
  assert.deepEqual(r.goalFlight!.successCriteria, ["Goal delivered as described"]);
});

test("classifyIntake: goal flight with active collision includes projectCollision and goalFlight together", () => {
  const r = classifyIntake({
    description: "Create a web site that lets users browse products and checkout with Stripe.",
    activeSameProject: [{ taskId: "t-active", title: "Other writer" }],
  });
  assert.ok(r.goalFlight, "goalFlight present");
  assert.ok(r.projectCollision, "projectCollision reported alongside goalFlight");
  assert.equal(r.projectCollision!.recommendation, "hold");
});

test("classifyIntakeAsync preserves goalFlight metadata when model provides better decomposition", async () => {
  const r = await classifyIntakeAsync(
    { description: "Create a web site that lets users browse products, add to cart, and checkout with Stripe." },
    { client: async () => '["Design product catalog", "Build shopping cart", "Integrate Stripe checkout"]', connectivityMode: "cloud-ok" },
  );
  assert.equal(r.kind, "work_package_candidate");
  assert.ok(r.reasons.includes("model-advised decomposition"), "confirms model was used");
  // goalFlight must survive — the base deterministic result had it and the model only improves items.
  assert.ok(r.goalFlight, "goalFlight metadata preserved after model-advised decomposition");
  assert.equal(typeof r.goalFlight!.goal, "string");
  assert.ok(r.goalFlight!.goal.length > 0, "goal is non-empty");
  assert.ok(Array.isArray(r.goalFlight!.successCriteria), "successCriteria array preserved");
});
