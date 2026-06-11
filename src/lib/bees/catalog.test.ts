import test from "node:test";
import assert from "node:assert/strict";

import { getBeeDefinition } from "./catalog";

test("architecture reset keeps browser and web as embedded Hive capabilities", () => {
  const browserBee = getBeeDefinition("browserbee");
  const webBee = getBeeDefinition("webbee");

  assert.equal(browserBee?.standalone, false);
  assert.match(browserBee?.summary ?? "", /embedded hive/i);

  assert.equal(webBee?.standalone, false);
  assert.match(webBee?.summary ?? "", /embedded hive/i);

  // AuthBee and TubeBee are removed from HiveMatrix v1
  assert.equal(getBeeDefinition("authbee"), null);
  assert.equal(getBeeDefinition("tubebee"), null);
});
