import test from "node:test";
import assert from "node:assert/strict";

import { assertReleaseNoteGateClaims, claimedPhases, phaseGateStatuses } from "./gates-check.mjs";

const gates = `
| Phase | Milestone | Gate Definition | Status | Evidence Link | Date Passed | Commit |
|---|---|---|---|---|---|---|
| Phase 1 | M1 | definition | UNMET | pending | - | - |
| Phase 2 | M2 | definition | PASSED | proof | 2026-07-03 | abc123 |
| Phase 3 | M3 | definition | UNMET | pending | - | - |
| Phase 4 | M4 | definition | UNMET | pending | - | - |
`;

test("claimedPhases detects Phase N and MN milestone notes", () => {
  assert.deepEqual(claimedPhases("Phase 1 parity work and M3 packaging"), ["Phase 1", "Phase 3"]);
});

test("phaseGateStatuses parses docs/GATES.md table rows", () => {
  const statuses = phaseGateStatuses(gates);
  assert.equal(statuses.get("Phase 1"), "UNMET");
  assert.equal(statuses.get("Phase 2"), "PASSED");
});

test("release note without a phase claim is allowed", () => {
  assert.doesNotThrow(() => assertReleaseNoteGateClaims("ship outcome pack card rendering", gates));
});

test("release note claiming a passed phase is allowed", () => {
  assert.doesNotThrow(() => assertReleaseNoteGateClaims("M2 trust gate", gates));
});

test("release note claiming an unmet phase is blocked", () => {
  assert.throws(
    () => assertReleaseNoteGateClaims("Phase 1 complete", gates),
    /Phase 1/,
  );
});
