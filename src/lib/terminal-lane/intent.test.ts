import assert from "node:assert/strict";
import test from "node:test";

import { isTerminalLaneRequest, detectTerminalHostHint } from "./intent";

test("isTerminalLaneRequest detects explicit Terminal Lane phrasing", () => {
  for (const t of [
    "use TerminalLane and check the OS version of aiserver",
    "use Terminal Lane to check disk usage",
    "Terminal Lane: run df -h on prod",
    "route this through terminal lane",
  ]) {
    assert.equal(isTerminalLaneRequest(t), true, t);
  }
});

test("isTerminalLaneRequest is false for unrelated requests", () => {
  for (const t of [
    "make me an AI news video",
    "send an email to the team",
    "what's the weather",
    "open the terminal app on my mac", // 'terminal app', not the lane
    "",
  ]) {
    assert.equal(isTerminalLaneRequest(t), false, t);
  }
});

test("detectTerminalHostHint extracts a host token from host-targeted phrasing", () => {
  assert.equal(detectTerminalHostHint("use TerminalLane and check the OS version of aiserver"), "aiserver");
  assert.equal(detectTerminalHostHint("check disk usage on prod-db"), "prod-db");
  assert.equal(detectTerminalHostHint("ssh to staging1 and run uptime"), "staging1");
  assert.equal(detectTerminalHostHint("run uptime @aiserver"), "aiserver");
  assert.equal(detectTerminalHostHint("just run a local command"), null);
});
