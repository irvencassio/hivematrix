import test from "node:test";
import assert from "node:assert/strict";
import { KNOWN_FEATURES, parseFeatures, shouldShowFeature } from "./features";

test("known features default off when no config is present", () => {
  assert.ok(KNOWN_FEATURES.length > 0);
  const parsed = parseFeatures({});
  for (const f of KNOWN_FEATURES) assert.equal(parsed[f.key], false);
});

test("parseFeatures reflects an explicitly enabled flag", () => {
  const parsed = parseFeatures({ features: { ado: true } });
  assert.equal(parsed.ado, true);
});

test("OpenClaw Chat is hidden when OpenClaw is not installed", () => {
  assert.equal(shouldShowFeature("openclaw.chatDock", { openclawInstalled: false }), false);
  assert.equal(shouldShowFeature("openclaw.chatDock", { openclawInstalled: true }), true);
  assert.equal(shouldShowFeature("voice", { openclawInstalled: false }), true);
});
