import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AUTONOMY_LEVELS,
  autonomyAutoLandsReviews,
  autonomyAutoStartsFlights,
  getAutonomyLevel,
  parseAutonomyLevel,
  setAutonomyLevel,
} from "./autonomy";

const TMP = mkdtempSync(join(tmpdir(), "hm-autonomy-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("parseAutonomyLevel: valid levels pass through; anything else → standard", () => {
  assert.equal(parseAutonomyLevel("manual"), "manual");
  assert.equal(parseAutonomyLevel("standard"), "standard");
  assert.equal(parseAutonomyLevel("autonomous"), "autonomous");
  assert.equal(parseAutonomyLevel("bogus"), "standard");
  assert.equal(parseAutonomyLevel(undefined), "standard");
  assert.equal(parseAutonomyLevel(3), "standard");
});

test("getAutonomyLevel defaults to standard before anything is written", () => {
  assert.equal(getAutonomyLevel(), "standard");
});

test("setAutonomyLevel persists and round-trips", () => {
  assert.equal(setAutonomyLevel("autonomous"), "autonomous");
  assert.equal(getAutonomyLevel(), "autonomous");
  assert.equal(setAutonomyLevel("manual"), "manual");
  assert.equal(getAutonomyLevel(), "manual");
});

test("setAutonomyLevel coerces an invalid value to the default rather than storing junk", () => {
  assert.equal(setAutonomyLevel("nonsense"), "standard");
  assert.equal(getAutonomyLevel(), "standard");
});

test("autonomyAutoStartsFlights: only autonomous starts Flights without a click", () => {
  assert.equal(autonomyAutoStartsFlights("manual"), false);
  assert.equal(autonomyAutoStartsFlights("standard"), false);
  assert.equal(autonomyAutoStartsFlights("autonomous"), true);
});

test("autonomyAutoLandsReviews: everything except manual auto-lands clean low-risk work", () => {
  assert.equal(autonomyAutoLandsReviews("manual"), false);
  assert.equal(autonomyAutoLandsReviews("standard"), true);
  assert.equal(autonomyAutoLandsReviews("autonomous"), true);
});

test("AUTONOMY_LEVELS lists the three levels in gated→autonomous order", () => {
  assert.deepEqual(AUTONOMY_LEVELS.map((l) => l.key), ["manual", "standard", "autonomous"]);
  for (const l of AUTONOMY_LEVELS) {
    assert.ok(l.label.length > 0 && l.description.length > 0, `${l.key} has label + description`);
  }
});

test("setAutonomyLevel preserves other config keys (merge, not overwrite)", async () => {
  const { writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  const cfgPath = join(dir, "config.json");
  writeFileSync(cfgPath, JSON.stringify({ theme: "matrix", autonomy: "standard" }));
  setAutonomyLevel("autonomous");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
  assert.equal(cfg.theme, "matrix", "unrelated keys are preserved");
  assert.equal(cfg.autonomy, "autonomous");
});
