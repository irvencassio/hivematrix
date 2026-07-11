import assert from "node:assert/strict";
import test from "node:test";

import {
  isRepeatingTail,
  collapseRepetition,
  REPEAT_LIMIT,
  isRepeatingWordTail,
  collapseWordRepetition,
  WORD_REPEAT_LIMIT,
  isOverReplyCap,
  isRepeatingUnitCycle,
  collapseUnitCycle,
} from "./loop";

const S = "Let me check the latest financial news and market data for yesterday.";

test("isRepeatingTail: flags a sentence repeated REPEAT_LIMIT+ times at the tail", () => {
  assert.equal(isRepeatingTail(Array(REPEAT_LIMIT).fill(S).join(" ")), true);
  assert.equal(isRepeatingTail(Array(REPEAT_LIMIT + 6).fill(S).join(" ")), true);
  // Below the limit → not yet a loop.
  assert.equal(isRepeatingTail(Array(REPEAT_LIMIT - 1).fill(S).join(" ")), false);
});

test("isRepeatingTail: does not flag varied text or short interjections", () => {
  assert.equal(isRepeatingTail("First point. Second point. Third point. Fourth point."), false);
  // Short repeated units (e.g. "ok.") are ignored — only substantive lines count.
  assert.equal(isRepeatingTail("ok. ok. ok. ok. ok. ok."), false);
  // A repeated line NOT at the tail (recovered afterward) is fine.
  assert.equal(isRepeatingTail(`${S} ${S} ${S} ${S} Actually, here is the recap for you.`), false);
});

test("collapseRepetition: keeps exactly one copy of a degenerate tail", () => {
  const collapsed = collapseRepetition(Array(10).fill(S).join(" "));
  assert.equal(collapsed, S);
  // Preserves the lead-in, collapses only the repeated tail.
  const withLead = collapseRepetition(`Sure — one moment. ${Array(8).fill(S).join(" ")}`);
  assert.equal(withLead, `Sure — one moment. ${S}`);
  // Non-degenerate text is returned unchanged.
  const varied = "One. Two. Three.";
  assert.equal(collapseRepetition(varied), varied);
});

test("isRepeatingWordTail: flags a single word looped WORD_REPEAT_LIMIT+ times", () => {
  // The exact failure mode from the field: "submarines submarines submarines ..."
  assert.equal(isRepeatingWordTail(Array(WORD_REPEAT_LIMIT).fill("submarines").join(" ")), true);
  assert.equal(isRepeatingWordTail("cars trucks buses " + Array(20).fill("submarines").join(" ")), true);
  // Below the limit → not yet a loop.
  assert.equal(isRepeatingWordTail(Array(WORD_REPEAT_LIMIT - 1).fill("submarines").join(" ")), false);
});

test("isRepeatingWordTail: flags short word-cycles, not varied lists", () => {
  // A genuine 2-word cycle repeated enough times.
  assert.equal(isRepeatingWordTail(Array(WORD_REPEAT_LIMIT).fill("ping pong").join(" ")), true);
  // A long but varied word list (the model rambling, not looping) is NOT flagged.
  assert.equal(
    isRepeatingWordTail("databases schemas tables columns rows cells fields records entries items objects"),
    false,
  );
});

test("collapseWordRepetition: keeps one instance of a degenerate word tail", () => {
  assert.equal(
    collapseWordRepetition("cars trucks buses " + Array(20).fill("submarines").join(" ")),
    "cars trucks buses submarines",
  );
  // A genuine 2-word cycle collapses to a single instance of the cycle.
  assert.equal(collapseWordRepetition("go " + Array(8).fill("ping pong").join(" ")), "go ping pong");
  // Varied text is returned unchanged.
  const varied = "planes ships boats trains";
  assert.equal(collapseWordRepetition(varied), varied);
});

test("isRepeatingUnitCycle: catches repetition-with-drift (case/spacing mutation)", () => {
  // The real field failure: a 2-line cycle that loops while its case & spacing mutate.
  const clean = "First step : look up the contact.\nNext step : send the message.\n";
  const drift =
    "First step : look up the contact.\nNext step : send the message.\n" +
    "First step : look up the contact.\nNext step : send the message.\n" +
    "Firststep：lookupthecontact.\nNextstep：sendthemessage.\n" +
    "fIrStStEp：LoOkUpThEcOnTaCt.\nNeXtStEp：SeNdThEmEsSaGe.\n";
  assert.equal(isRepeatingTail(drift), false); // exact-match guard is blind to the drift
  assert.equal(isRepeatingUnitCycle(drift), true); // normalized cycle detector catches it
  // A single occurrence of a "First/Next" structure is fine — not a loop.
  assert.equal(isRepeatingUnitCycle(clean), false);
  // Varied step-by-step instructions are NOT flagged.
  assert.equal(isRepeatingUnitCycle("First, open the file. Then edit line 3. Finally, save it."), false);
});

test("collapseUnitCycle: keeps one instance of a drift-loop for storage", () => {
  const looped =
    "Here is the plan for you.\n" +
    "Look up the contact first.\nLook up the contact first.\n" +
    "LookUpTheContactFirst.\nlookupthecontactfirst.\n";
  const collapsed = collapseUnitCycle(looped);
  // The lead-in survives; the repeated tail is reduced.
  assert.ok(collapsed.includes("Here is the plan"));
  assert.ok(collapsed.length < looped.length);
});

test("isOverReplyCap: catches varied runaway that the repetition guards miss", () => {
  // The screenshot failure mode: a long reply of all-DISTINCT words — no repeated
  // sentence, no repeated word-cycle, so only the length cap can stop it.
  const rambling = "Nation Building State-Building Institution-Building Capacity-Building Rule-Law Governance Accountability Transparency Cooperation Development Sustainability".repeat(30);
  assert.equal(isRepeatingTail(rambling), false); // repetition guards are blind to it
  assert.equal(isRepeatingWordTail(rambling), false);
  assert.equal(isOverReplyCap(rambling, 3000), true); // length cap catches it
  // Under the cap → allowed.
  assert.equal(isOverReplyCap("A normal, concise reply.", 3000), false);
  // cap <= 0 disables the guard (never fires, even on huge text).
  assert.equal(isOverReplyCap(rambling, 0), false);
});
