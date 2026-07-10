import test from "node:test";
import assert from "node:assert/strict";
import { validateDag, getEligibleTasks, isMissionComplete, getTerminalFailures } from "./dag-engine";

test("validateDag: an empty graph and a graph with no deps are both acyclic", () => {
  assert.deepEqual(validateDag([]), { valid: true });
  assert.deepEqual(
    validateDag([{ _id: "a", status: "backlog", dependsOn: [] }, { _id: "b", status: "backlog", dependsOn: [] }]),
    { valid: true },
  );
});

test("validateDag: a linear chain (a -> b -> c) is acyclic", () => {
  const r = validateDag([
    { _id: "a", status: "backlog", dependsOn: [] },
    { _id: "b", status: "backlog", dependsOn: ["a"] },
    { _id: "c", status: "backlog", dependsOn: ["b"] },
  ]);
  assert.equal(r.valid, true);
});

test("validateDag: a direct two-node cycle (a <-> b) is rejected", () => {
  const r = validateDag([
    { _id: "a", status: "backlog", dependsOn: ["b"] },
    { _id: "b", status: "backlog", dependsOn: ["a"] },
  ]);
  assert.equal(r.valid, false);
  assert.ok(r.cycle?.includes("a"));
  assert.ok(r.cycle?.includes("b"));
});

test("validateDag: a longer cycle (a -> b -> c -> a) is rejected", () => {
  const r = validateDag([
    { _id: "a", status: "backlog", dependsOn: ["c"] },
    { _id: "b", status: "backlog", dependsOn: ["a"] },
    { _id: "c", status: "backlog", dependsOn: ["b"] },
  ]);
  assert.equal(r.valid, false);
  assert.equal(r.cycle?.length, 3);
});

test("validateDag: a dependency on an id outside the given task list is ignored, not treated as unmet or cyclic", () => {
  const r = validateDag([{ _id: "a", status: "backlog", dependsOn: ["nonexistent"] }]);
  assert.equal(r.valid, true);
});

test("getEligibleTasks: root tasks (no deps) are eligible; a dependent task is not until its dep is done", () => {
  const tasks = [
    { _id: "a", status: "pending_mission", dependsOn: [] },
    { _id: "b", status: "pending_mission", dependsOn: ["a"] },
  ];
  assert.deepEqual(getEligibleTasks(tasks), ["a"]);
  const afterADone = [
    { _id: "a", status: "done", dependsOn: [] },
    { _id: "b", status: "pending_mission", dependsOn: ["a"] },
  ];
  assert.deepEqual(getEligibleTasks(afterADone), ["b"]);
});

test("isMissionComplete and getTerminalFailures reflect real per-task status, never fabricated", () => {
  assert.equal(isMissionComplete([]), false, "an empty set is not a completed mission");
  assert.equal(isMissionComplete([{ _id: "a", status: "done", dependsOn: [] }]), true);
  assert.equal(isMissionComplete([{ _id: "a", status: "done", dependsOn: [] }, { _id: "b", status: "backlog", dependsOn: [] }]), false);
  assert.deepEqual(
    getTerminalFailures([{ _id: "a", status: "failed", dependsOn: [] }, { _id: "b", status: "done", dependsOn: [] }]),
    ["a"],
  );
});
