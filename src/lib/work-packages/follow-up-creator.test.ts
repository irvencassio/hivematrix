import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-followup-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { _resetDbForTests, getDb } = await import("@/lib/db");
const { createWorkPackage, getWorkPackage } = await import("./store");
const { resolveFollowUpStatus, createFollowUpItems, createGateFollowUpItems } = await import("./follow-up-creator");

test.before(() => { _resetDbForTests(); getDb(); });
test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function makePackage() {
  return createWorkPackage({
    title: "Test package",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
}

// --- resolveFollowUpStatus pure function ---

test("resolveFollowUpStatus: high risk always returns held", () => {
  assert.equal(resolveFollowUpStatus("high", false), "held");
  assert.equal(resolveFollowUpStatus("high", true), "held");
});

test("resolveFollowUpStatus: low risk + autoReadySafeItems=true returns ready", () => {
  assert.equal(resolveFollowUpStatus("low", true), "ready");
});

test("resolveFollowUpStatus: low risk + autoReadySafeItems=false returns draft", () => {
  assert.equal(resolveFollowUpStatus("low", false), "draft");
});

test("resolveFollowUpStatus: medium risk returns draft regardless of autoReadySafeItems", () => {
  assert.equal(resolveFollowUpStatus("medium", false), "draft");
  assert.equal(resolveFollowUpStatus("medium", true), "draft");
});

// --- createFollowUpItems DB integration ---

test("createFollowUpItems: empty sources returns empty array and writes nothing", () => {
  const pkg = makePackage();
  const result = createFollowUpItems({
    packageId: pkg.id,
    sources: [],
    startPosition: 10,
    autoReadySafeItems: false,
  });
  assert.deepEqual(result, []);
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.items.length, 1, "no extra items written");
});

test("createFollowUpItems: creates draft item for low-risk failed source", () => {
  const pkg = makePackage();
  const created = createFollowUpItems({
    packageId: pkg.id,
    sources: [{ id: "x", title: "Build step", status: "failed", risk: "low", blocker: "exit 1", taskOutput: null }],
    startPosition: 5,
    autoReadySafeItems: false,
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].status, "draft");
  assert.equal(created[0].risk, "low");
  assert.ok(created[0].title.includes("Re-examine"), "title prefixed with Re-examine");

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.ok(item, "item persisted");
  assert.equal(item.status, "draft");
  assert.equal(item.position, 5);
  assert.ok(item.prompt.includes("exit 1"), "blocker in prompt");
  assert.ok(item.prompt.includes("Investigate and fix"), "failed prompt wording");
});

test("createFollowUpItems: creates held item for high-risk failed source", () => {
  const pkg = makePackage();
  const created = createFollowUpItems({
    packageId: pkg.id,
    sources: [{ id: "x", title: "Deploy to prod", status: "failed", risk: "high", blocker: null, taskOutput: null }],
    startPosition: 2,
    autoReadySafeItems: false,
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].status, "held");

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.equal(item.status, "held");
  assert.equal(item.risk, "high");
});

test("createFollowUpItems: creates ready item for low-risk source when autoReadySafeItems=true", () => {
  const pkg = makePackage();
  const created = createFollowUpItems({
    packageId: pkg.id,
    sources: [{ id: "x", title: "Lint check", status: "review", risk: "low", blocker: null, taskOutput: null }],
    startPosition: 3,
    autoReadySafeItems: true,
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].status, "ready");

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.equal(item.status, "ready");
});

test("createFollowUpItems: medium risk stays draft even with autoReadySafeItems=true", () => {
  const pkg = makePackage();
  const created = createFollowUpItems({
    packageId: pkg.id,
    sources: [{ id: "x", title: "Run tests", status: "review", risk: "medium", blocker: null, taskOutput: null }],
    startPosition: 4,
    autoReadySafeItems: true,
  });

  assert.equal(created[0].status, "draft");
});

test("createFollowUpItems: review source uses inspect prompt wording", () => {
  const pkg = makePackage();
  const created = createFollowUpItems({
    packageId: pkg.id,
    sources: [{ id: "x", title: "QA check", status: "review", risk: "low", blocker: null, taskOutput: "looks off" }],
    startPosition: 6,
    autoReadySafeItems: false,
  });

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.ok(item.prompt.includes("Inspect and resolve"), "review prompt wording");
  assert.ok(item.prompt.includes("looks off"), "taskOutput included in prompt");
});

test("createFollowUpItems: positions increment across multiple sources", () => {
  const pkg = makePackage();
  const sources = [
    { id: "a", title: "Step A", status: "failed" as const, risk: "low" as const, blocker: null, taskOutput: null },
    { id: "b", title: "Step B", status: "review" as const, risk: "medium" as const, blocker: null, taskOutput: null },
    { id: "c", title: "Step C", status: "failed" as const, risk: "high" as const, blocker: "crash", taskOutput: null },
  ];
  const created = createFollowUpItems({ packageId: pkg.id, sources, startPosition: 10, autoReadySafeItems: false });

  assert.equal(created.length, 3);
  const detail = getWorkPackage(pkg.id)!;
  const positions = created.map((c) => detail.items.find((i) => i.id === c.id)!.position);
  assert.deepEqual(positions, [10, 11, 12]);
});

test("createFollowUpItems: mixed risk batch produces correct statuses", () => {
  const pkg = makePackage();
  const sources = [
    { id: "a", title: "Low risk item", status: "failed" as const, risk: "low" as const, blocker: null, taskOutput: null },
    { id: "b", title: "High risk item", status: "failed" as const, risk: "high" as const, blocker: null, taskOutput: null },
    { id: "c", title: "Medium risk item", status: "review" as const, risk: "medium" as const, blocker: null, taskOutput: null },
  ];
  const created = createFollowUpItems({ packageId: pkg.id, sources, startPosition: 20, autoReadySafeItems: true });

  const statuses = created.map((c) => c.status);
  assert.deepEqual(statuses, ["ready", "held", "draft"]);
});

test("createFollowUpItems: scrubs secrets from title and prompt", () => {
  const pkg = makePackage();
  const created = createFollowUpItems({
    packageId: pkg.id,
    sources: [{
      id: "x",
      title: "Step with secret-token info",
      status: "failed",
      risk: "low",
      blocker: "api-key=abc123 failed",
      taskOutput: null,
    }],
    startPosition: 30,
    autoReadySafeItems: false,
  });

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.ok(!item.title.includes("abc123"), "secret scrubbed from title");
  assert.ok(!item.prompt.includes("abc123"), "secret scrubbed from prompt");
});

// --- createGateFollowUpItems ---

test("createGateFollowUpItems: empty failedGates returns empty array", () => {
  const pkg = makePackage();
  const result = createGateFollowUpItems({
    packageId: pkg.id,
    failedGates: [],
    startPosition: 10,
    autoReadySafeItems: false,
  });
  assert.deepEqual(result, []);
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.items.length, 1, "no extra items written");
});

test("createGateFollowUpItems: creates draft item for failing gate by default", () => {
  const pkg = makePackage();
  const created = createGateFollowUpItems({
    packageId: pkg.id,
    failedGates: [{ name: "typecheck", exitCode: 1, output: "TS2322: type mismatch" }],
    startPosition: 5,
    autoReadySafeItems: false,
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].status, "draft");
  assert.equal(created[0].risk, "low");
  assert.ok(created[0].title.includes("typecheck"), "title includes gate name");

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.ok(item, "item persisted");
  assert.equal(item.status, "draft");
  assert.equal(item.position, 5);
  assert.ok(item.prompt.includes("typecheck"), "gate name in prompt");
  assert.ok(item.prompt.includes("exit 1"), "exit code in prompt");
  assert.ok(item.prompt.includes("TS2322"), "gate output snippet in prompt");
});

test("createGateFollowUpItems: creates ready item when autoReadySafeItems=true", () => {
  const pkg = makePackage();
  const created = createGateFollowUpItems({
    packageId: pkg.id,
    failedGates: [{ name: "scope-wall", exitCode: 1, output: "violation found" }],
    startPosition: 2,
    autoReadySafeItems: true,
  });

  assert.equal(created[0].status, "ready");
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.items.find((i) => i.id === created[0].id)!.status, "ready");
});

test("createGateFollowUpItems: positions increment across multiple gates", () => {
  const pkg = makePackage();
  const created = createGateFollowUpItems({
    packageId: pkg.id,
    failedGates: [
      { name: "typecheck", exitCode: 1, output: "error A" },
      { name: "tests", exitCode: 1, output: "2 failing" },
    ],
    startPosition: 10,
    autoReadySafeItems: false,
  });

  assert.equal(created.length, 2);
  const detail = getWorkPackage(pkg.id)!;
  const pos = created.map((c) => detail.items.find((i) => i.id === c.id)!.position);
  assert.deepEqual(pos, [10, 11]);
});

test("createGateFollowUpItems: null exitCode shows 'unknown' in prompt", () => {
  const pkg = makePackage();
  const created = createGateFollowUpItems({
    packageId: pkg.id,
    failedGates: [{ name: "tests", exitCode: null, output: "timed out" }],
    startPosition: 1,
    autoReadySafeItems: false,
  });

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.ok(item.prompt.includes("unknown"), "null exitCode renders as unknown");
});

// --- Item creation: prompt construction edge cases ---

test("createFollowUpItems: failed source with no blocker omits 'with error' from prompt", () => {
  const pkg = makePackage();
  const created = createFollowUpItems({
    packageId: pkg.id,
    sources: [{ id: "x", title: "Build step", status: "failed", risk: "low", blocker: null, taskOutput: null }],
    startPosition: 40,
    autoReadySafeItems: false,
  });

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.ok(!item.prompt.includes("with error"), "no blocker → 'with error' absent from prompt");
  assert.ok(item.prompt.includes("Item failed"), "prompt still says 'Item failed'");
  assert.ok(item.prompt.includes("Investigate and fix"), "investigation wording present");
});

test("createFollowUpItems: null taskOutput omits 'Output:' from prompt", () => {
  const pkg = makePackage();
  const created = createFollowUpItems({
    packageId: pkg.id,
    sources: [{ id: "x", title: "Review target", status: "review", risk: "low", blocker: null, taskOutput: null }],
    startPosition: 50,
    autoReadySafeItems: false,
  });

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.ok(!item.prompt.includes("Output:"), "null taskOutput → 'Output:' absent from prompt");
});

test("createGateFollowUpItems: empty gate output omits 'Output:' from prompt", () => {
  const pkg = makePackage();
  const created = createGateFollowUpItems({
    packageId: pkg.id,
    failedGates: [{ name: "scope-wall", exitCode: 1, output: "" }],
    startPosition: 60,
    autoReadySafeItems: false,
  });

  const detail = getWorkPackage(pkg.id)!;
  const item = detail.items.find((i) => i.id === created[0].id)!;
  assert.ok(!item.prompt.includes("Output:"), "empty gate output → 'Output:' absent from prompt");
  assert.ok(item.prompt.includes("scope-wall"), "gate name still in prompt");
});
