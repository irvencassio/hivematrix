/**
 * Verify that the voice API accepts unlimited usage requests without triggering
 * budget errors.
 *
 * This proves the post-change state: no dollar/cost budget ceiling, no
 * per-session turn limit, no rate-throttle guard anywhere in the voice path.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBudgetUsd, hasBudgetCeiling, UNCAPPED_BUDGET_USD, DEFAULT_BUDGET_USD,
} from "@/lib/config/budget-policy";
import { deriveVoiceTitle, routeVoiceSession, parseVoiceSessionBody, type VoiceTurn } from "./session";

// ---------------------------------------------------------------------------
// 1. Global budget defaults to uncapped
// ---------------------------------------------------------------------------

test("default budget is uncapped (zero means no ceiling)", () => {
  assert.equal(UNCAPPED_BUDGET_USD, 0, "uncapped sentinel is 0");
  assert.equal(DEFAULT_BUDGET_USD, 0, "default budget is uncapped");
});

test("hasBudgetCeiling returns false for the default (uncapped) budget", () => {
  assert.equal(hasBudgetCeiling(DEFAULT_BUDGET_USD), false);
  assert.equal(hasBudgetCeiling(0), false);
  assert.equal(hasBudgetCeiling(undefined), false);
  assert.equal(hasBudgetCeiling(null), false);
  assert.equal(hasBudgetCeiling(-1), false);
});

test("normalizeBudgetUsd treats the default as uncapped", () => {
  assert.equal(normalizeBudgetUsd(DEFAULT_BUDGET_USD), 0);
  assert.equal(normalizeBudgetUsd(undefined), 0);
  assert.equal(normalizeBudgetUsd(null), 0);
});

// ---------------------------------------------------------------------------
// 2. Voice session routing — no budget guard
// ---------------------------------------------------------------------------

test("routeVoiceSession accepts a 20-turn session without rejection", () => {
  const turns: VoiceTurn[] = [];
  for (let i = 0; i < 20; i++) {
    turns.push({ role: "user" as const, text: `request number ${i + 1} do something meaningful here` });
    turns.push({ role: "assistant" as const, text: `handled request ${i + 1}` });
  }
  const result = routeVoiceSession({
    sessionId: "big-session",
    surface: "mac",
    startedAt: "2026-07-10T12:00:00Z",
    turns,
  });
  // With many substantive user turns this should produce a task, not a "budget exceeded" rejection.
  assert.equal(result.kind, "task", "large session routed to task, not rejected");
  if (result.kind === "task") {
    assert.match(result.description, /request number 1/, "transcript preserved");
    assert.match(result.description, /request number 20/, "all turns in transcript");
  }
});

test("routeVoiceSession accepts a 100-turn session without rejection", () => {
  const turns: VoiceTurn[] = [];
  for (let i = 0; i < 100; i++) {
    turns.push({ role: "user" as const, text: `task ${i + 1} please process this item for me` });
  }
  const result = routeVoiceSession({
    sessionId: "huge-session",
    surface: "ios",
    startedAt: "2026-07-10T12:00:00Z",
    turns,
  });
  assert.equal(result.kind, "task", "100-turn session routed without budget error");
  if (result.kind === "task") {
    assert.ok(result.title.startsWith("Voice:"), "title derived from first user turn");
  }
});

// ---------------------------------------------------------------------------
// 3. parseVoiceSessionBody — accepts sessions with many turns
// ---------------------------------------------------------------------------

test("parseVoiceSessionBody handles a session with 50 turns", () => {
  const turns = [];
  for (let i = 0; i < 25; i++) {
    turns.push({ role: "user", text: `turn ${i + 1}` });
    turns.push({ role: "assistant", text: `reply ${i + 1}` });
  }
  const result = parseVoiceSessionBody({
    sessionId: "s-multi",
    surface: "mac",
    escalated: false,
    turns,
  });
  assert.ok(!("error" in result), "no parse error for large session");
  if (!("error" in result)) {
    assert.equal(result.session.turns.length, 50, "all turns parsed");
  }
});

// ---------------------------------------------------------------------------
// 4. No usage counter or rate-limit surface exists in the voice modules
// ---------------------------------------------------------------------------

test("voice session module exports no budget or throttle functions", async () => {
  const mod = await import("./session");
  const budgetLike = Object.keys(mod).filter((k) =>
    /budget|quota|throttl|limit|maxturn|rate/i.test(k)
  );
  assert.deepEqual(budgetLike, [], "session module has no budget/throttle exports");
});

test("voice turn-server module exports no budget or throttle functions", async () => {
  const mod = await import("./turn-server");
  const budgetLike = Object.keys(mod).filter((k) =>
    /budget|quota|throttl|limit|maxturn|rate/i.test(k)
  );
  assert.deepEqual(budgetLike, [], "turn-server module has no budget/throttle exports");
});

test("voice runtime module exports no budget or throttle functions", async () => {
  const mod = await import("./runtime");
  const budgetLike = Object.keys(mod).filter((k) =>
    /budget|quota|throttl|limit|maxturn|rate/i.test(k)
  );
  assert.deepEqual(budgetLike, [], "runtime module has no budget/throttle exports");
});
