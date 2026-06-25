import test from "node:test";
import assert from "node:assert/strict";

import { getBeeDefinition } from "./catalog";

test("architecture reset keeps Browser Lane read/workflow as embedded Hive capabilities", () => {
  const browserBee = getBeeDefinition("browserbee");
  const webBee = getBeeDefinition("webbee");

  assert.equal(browserBee?.standalone, false);
  assert.equal(browserBee?.name, "Browser Lane Workflow");
  assert.match(browserBee?.summary ?? "", /Browser Lane/i);

  assert.equal(webBee?.standalone, false);
  assert.equal(webBee?.name, "Browser Lane Read");
  assert.match(webBee?.summary ?? "", /Browser Lane/i);

  // AuthBee and TubeBee are removed from HiveMatrix v1
  assert.equal(getBeeDefinition("authbee"), null);
  assert.equal(getBeeDefinition("tubebee"), null);
});
