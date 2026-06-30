/**
 * T2 — Review Lane status shape tests.
 *
 * shapeLaneServiceStatuses must:
 *   - Accept kind: "review" directly (pass-through after catalog update).
 *   - Keep mapping kind: "managerbee" → { kind: "review", name: "Review Lane" } (compat).
 *
 * Some assertions pass on the current codebase; all must remain GREEN after Tasks 5–7.
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { LaneWorkerStatus } from "@/lib/lanes/service-manager";
import { shapeLaneServiceStatuses } from "./status";

function makeStatus(kind: string, name: string, overrides: Partial<LaneWorkerStatus> = {}): LaneWorkerStatus {
  return {
    kind,
    name,
    role: "meta",
    phase: 1,
    summary: "control-plane",
    runtimeMode: "embedded",
    manageable: false,
    available: true,
    autoStart: true,
    running: true,
    loaded: true,
    healthy: true,
    pid: null,
    repoPath: null,
    plistLabel: null,
    plistPath: null,
    healthcheckUrl: null,
    statusDetail: null,
    ...overrides,
  };
}

test("kind 'review' passes through as kind: 'review'", () => {
  const result = shapeLaneServiceStatuses([makeStatus("review", "Review Lane")]);
  assert.equal(result[0]?.kind, "review");
});

test("kind 'review' preserves name 'Review Lane'", () => {
  const result = shapeLaneServiceStatuses([makeStatus("review", "Review Lane")]);
  assert.equal(result[0]?.name, "Review Lane");
});

test("kind 'managerbee' maps to kind: 'review' (compat)", () => {
  const result = shapeLaneServiceStatuses([makeStatus("managerbee", "ManagerBee")]);
  assert.equal(result[0]?.kind, "review");
});

test("kind 'managerbee' maps to name: 'Review Lane' (compat)", () => {
  const result = shapeLaneServiceStatuses([makeStatus("managerbee", "ManagerBee")]);
  assert.equal(result[0]?.name, "Review Lane");
});

test("'review' and 'managerbee' collapse into a single 'review' entry", () => {
  const result = shapeLaneServiceStatuses([
    makeStatus("review", "Review Lane", { summary: "canonical" }),
    makeStatus("managerbee", "ManagerBee", { summary: "compat" }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "review");
});
