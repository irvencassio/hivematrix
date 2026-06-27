import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const approval = readFileSync(
  new URL("../src/lib/orchestrator/approval.ts", import.meta.url),
  "utf8"
);

test("approval.ts generateHookScript includes mcp__ccd_session__* allowlist", () => {
  assert.ok(
    approval.includes("mcp__ccd_session__*"),
    "generateHookScript must contain mcp__ccd_session__* case pattern"
  );
});

test("approval.ts CCD allowlist appears before catch-all MCP block", () => {
  const ccdIdx = approval.indexOf("mcp__ccd_session__*");
  const catchAllIdx = approval.indexOf("# MCP tools — always require approval");
  assert.ok(ccdIdx > -1, "must contain mcp__ccd_session__* allowlist");
  assert.ok(catchAllIdx > -1, "must still contain catch-all MCP block");
  assert.ok(ccdIdx < catchAllIdx, "CCD allowlist must come before catch-all block");
});

test("approval.ts CCD allowlist includes mcp__superpowers__* tools", () => {
  assert.ok(
    approval.includes("mcp__superpowers__*"),
    "generateHookScript must allowlist mcp__superpowers__* tools"
  );
});
