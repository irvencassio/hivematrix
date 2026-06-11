import test from "node:test";
import assert from "node:assert/strict";

import {
  CODEX_COMPUTER_USE_FALLBACK_OPTION,
  CODEX_COMPUTER_USE_PROJECT,
  getEffectiveModelOption,
  normalizeTaskProjectForModel,
  shouldRequireComputerUseConsent,
} from "./computer-use";
import { CODEX_COMPUTER_USE_MODEL_ID } from "./catalog";

test("Computer Use requires one-time consent before selection", () => {
  assert.equal(shouldRequireComputerUseConsent("codex-computer-use", false), true);
  assert.equal(shouldRequireComputerUseConsent("codex-computer-use", true), false);
  assert.equal(shouldRequireComputerUseConsent("chatgpt", false), false);
});

test("unsafe default Computer Use selections fall back until consent is granted", () => {
  assert.equal(
    getEffectiveModelOption("codex-computer-use", false),
    CODEX_COMPUTER_USE_FALLBACK_OPTION,
  );
  assert.equal(getEffectiveModelOption("codex-computer-use", true), "codex-computer-use");
  assert.equal(getEffectiveModelOption("sonnet", false), "sonnet");
});

test("Computer Use tasks are normalized onto the ops project", () => {
  assert.equal(
    normalizeTaskProjectForModel("frontend", CODEX_COMPUTER_USE_MODEL_ID),
    CODEX_COMPUTER_USE_PROJECT,
  );
  assert.equal(normalizeTaskProjectForModel("frontend", "codex:gpt-5.4"), "frontend");
  assert.equal(normalizeTaskProjectForModel("frontend", null), "frontend");
});
