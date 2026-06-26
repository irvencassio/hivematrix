import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const server = readFileSync(new URL("../src/daemon/server.ts", import.meta.url), "utf8");

test("daemon declares Terminal Lane maintenance endpoints", () => {
  for (const route of [
    "/terminal-lane/profiles",
    "/terminal-lane/dashboard",
    "/terminal-lane/probes",
    "/terminal-lane/readiness/run",
    "/terminal-lane/traces",
  ]) {
    assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("daemon declares typed delete + profileID-only open routes", () => {
  // Delete is id-constrained (no arbitrary path); open takes a profileId only.
  assert.ok(server.includes("^\\/terminal-lane\\/profiles\\/([a-z0-9._:-]+)$"), "id-constrained delete matcher");
  assert.match(server, /deleteTerminalProfile/);
  assert.match(server, /urlPath === "\/terminal-lane\/open"/);
  assert.match(server, /resolveTerminalOpenRequest/);
  // The open handler rejects inline secrets (profileId-only contract).
  assert.match(server, /rejectInlineSecrets/);
  // No arbitrary shell/exec route for terminal lane.
  assert.doesNotMatch(server, /\/terminal-lane\/(exec|shell|run-command)/);
});
