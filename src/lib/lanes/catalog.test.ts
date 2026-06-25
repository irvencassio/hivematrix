import test from "node:test";
import assert from "node:assert/strict";

import { getLaneDefinition } from "./catalog";

test("architecture reset keeps Browser Lane read/workflow as embedded Hive capabilities", () => {
  const browserLane = getLaneDefinition("browserbee");
  const webLane = getLaneDefinition("webbee");

  assert.equal(browserLane?.standalone, false);
  assert.equal(browserLane?.name, "Browser Lane Workflow");
  assert.match(browserLane?.summary ?? "", /Browser Lane/i);

  assert.equal(webLane?.standalone, false);
  assert.equal(webLane?.name, "Browser Lane Read");
  assert.match(webLane?.summary ?? "", /Browser Lane/i);

  // AuthBee and TubeBee are removed from HiveMatrix v1
  assert.equal(getLaneDefinition("authbee"), null);
  assert.equal(getLaneDefinition("tubebee"), null);
});

test("catalog display names follow the lane naming strategy", () => {
  assert.equal(getLaneDefinition("messagebee")?.name, "Message Lane");
  assert.equal(getLaneDefinition("mailbee")?.name, "Mail Lane");
  assert.equal(getLaneDefinition("managerbee")?.name, "Review Lane");
  assert.equal(getLaneDefinition("brainbee")?.name, "Memory Lane");
  assert.equal(getLaneDefinition("termbee")?.name, "Terminal Lane");
  assert.equal(getLaneDefinition("desktopbee")?.name, "Desktop Lane");
});
