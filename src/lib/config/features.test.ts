import test from "node:test";
import assert from "node:assert/strict";
import { KNOWN_FEATURES, parseFeatures, shouldShowFeature } from "./features";

test("the model-decomposition flag is a known feature and defaults off", () => {
  assert.ok(KNOWN_FEATURES.some((f) => f.key === "taskIntakeModelDecomposition"));
  const parsed = parseFeatures({});
  assert.equal(parsed.taskIntakeModelDecomposition, false);
});

test("parseFeatures reflects an explicitly enabled model-decomposition flag", () => {
  const parsed = parseFeatures({ features: { taskIntakeModelDecomposition: true } });
  assert.equal(parsed.taskIntakeModelDecomposition, true);
});

test("OpenClaw Chat is hidden when OpenClaw is not installed", () => {
  assert.equal(shouldShowFeature("openclaw.chatDock", { openclawInstalled: false }), false);
  assert.equal(shouldShowFeature("openclaw.chatDock", { openclawInstalled: true }), true);
  assert.equal(shouldShowFeature("voice", { openclawInstalled: false }), true);
});
