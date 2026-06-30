/**
 * T1 — Review Lane catalog kind tests.
 *
 * RED until Task 5 (catalog.ts update): getLaneDefinition("review") is null in
 * the current catalog because the entry still uses kind: "managerbee".
 */

import test from "node:test";
import assert from "node:assert/strict";

import { getLaneDefinition, listLaneDefinitions } from "./catalog";

test("getLaneDefinition('review') is non-null", () => {
  assert.notEqual(getLaneDefinition("review"), null);
});

test("getLaneDefinition('review').kind is 'review'", () => {
  const def = getLaneDefinition("review");
  assert.equal(def?.kind, "review");
});

test("getLaneDefinition('managerbee') is non-null (compat alias)", () => {
  assert.notEqual(getLaneDefinition("managerbee"), null);
});

test("getLaneDefinition('managerbee').name is 'Review Lane' (compat alias resolves to canonical)", () => {
  assert.equal(getLaneDefinition("managerbee")?.name, "Review Lane");
});

test("listLaneDefinitions() contains no entry with kind === 'managerbee'", () => {
  const all = listLaneDefinitions();
  const managerBeeEntries = all.filter((d) => d.kind === "managerbee");
  assert.equal(managerBeeEntries.length, 0, `Found ${managerBeeEntries.length} entry/entries with kind === "managerbee"; expected 0`);
});

test("getLaneDefinition('review').name is 'Review Lane'", () => {
  assert.equal(getLaneDefinition("review")?.name, "Review Lane");
});
