import assert from "node:assert/strict";
import test from "node:test";

import { createUnavailableBrowserLaneAdapter, normalizeBrowserAction } from "./adapter";

test("normalizes browser actions to typed refs", () => {
  const action = normalizeBrowserAction({ type: "click", ref: "button_create_video" });
  assert.equal(action.type, "click");
  assert.equal(action.ref, "button_create_video");
});

test("unavailable adapter reports backend not wired", async () => {
  const adapter = createUnavailableBrowserLaneAdapter("agent_browser");
  const result = await adapter.open({ siteId: "heygen", url: "https://app.heygen.com" });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not wired/);
});
