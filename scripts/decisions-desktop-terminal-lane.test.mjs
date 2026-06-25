import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const decisions = readFileSync(new URL("../DECISIONS.md", import.meta.url), "utf8");

test("DECISIONS.md describes Desktop and Terminal decisions with lane names", () => {
  assert.match(decisions, /## Q1 — Desktop Lane naming/);
  assert.match(decisions, /\*\*Decision:\*\* Desktop Lane is the public capability name/);
  assert.match(decisions, /`src\/lib\/desktopbee\/` remains the compatibility module/);
  assert.match(decisions, /## Terminal Lane \+ Desktop Lane showed "planned · No runtime registered"/);
  assert.match(decisions, /Both are real, working lanes \(Terminal Lane in-process; Desktop Lane = the Swift helper on :3748\)/);
  assert.match(decisions, /retired ComputerBee compatibility name/);
  assert.match(decisions, /`GET \/desktopbee\/health` pings the Desktop Lane helper/);

  assert.doesNotMatch(decisions, /## Q1 — DesktopBee naming/);
  assert.doesNotMatch(decisions, /\*\*Decision:\*\* DesktopBee\. ComputerBee name is retired everywhere\./);
  assert.doesNotMatch(decisions, /## TermBee \+ DesktopBee showed "planned · No runtime registered"/);
  assert.doesNotMatch(decisions, /TermBee in-process; DesktopBee = the Swift helper/);
  assert.doesNotMatch(decisions, /retired DesktopBee name/);
});
