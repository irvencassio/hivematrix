import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("../src/daemon/server.ts", import.meta.url), "utf8");

test("POST /tasks routes explicit Terminal Lane requests to the lane, not the generic agent", () => {
  // Detection + structured routing are imported in the task-creation path.
  assert.match(server, /isTerminalLaneRequest/);
  assert.match(server, /routeTerminalLaneRequest/);
  assert.match(server, /@\/lib\/terminal-lane\/intent/);
  assert.match(server, /@\/lib\/terminal-lane\/route/);

  // The created task uses a non-agent executor so the scheduler never spawns the
  // generic frontier agent (which is what fell into the Canopy discovery loop).
  assert.match(server, /executor:\s*"terminal-lane"/);

  // It is gated like the video route (skip if already a terminal-lane task).
  assert.match(server, /body\.executor !== "terminal-lane" && isTerminalLaneRequest/);

  // The structured route is carried so the transcript shows the route, and the
  // profiles come from the real store (profileId-only, no secrets).
  assert.match(server, /listTerminalProfileSummaries/);
  assert.match(server, /terminalRoute|transcript/);

  // The routing path must not steer toward Canopy.
  const taskBlock = server.slice(server.indexOf('urlPath === "/tasks"'), server.indexOf('urlPath === "/tasks"') + 4000);
  assert.doesNotMatch(taskBlock, /canopy/i);
});
