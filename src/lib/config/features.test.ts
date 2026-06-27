import test from "node:test";
import assert from "node:assert/strict";
import { KNOWN_FEATURES, parseFeatures } from "./features";

test("the model-decomposition flag is a known feature and defaults off", () => {
  assert.ok(KNOWN_FEATURES.some((f) => f.key === "taskIntakeModelDecomposition"));
  const parsed = parseFeatures({});
  assert.equal(parsed.taskIntakeModelDecomposition, false);
});

test("parseFeatures reflects an explicitly enabled model-decomposition flag", () => {
  const parsed = parseFeatures({ features: { taskIntakeModelDecomposition: true } });
  assert.equal(parsed.taskIntakeModelDecomposition, true);
});
