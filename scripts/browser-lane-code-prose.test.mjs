import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("browser-related source prose uses Browser Lane naming", () => {
  const router = read("src/lib/routing/router.ts");
  const connectivity = read("src/daemon/connectivity-integration.test.ts");
  const desktopActions = read("src/lib/desktopbee/actions.ts");
  const laneStatusTest = read("src/lib/lanes/status.test.ts");

  assert.match(router, /cheap-web\s+— Browser Lane summarization/);
  assert.doesNotMatch(router, /WebBee summarization/);

  assert.match(connectivity, /Browser Lane read capability disabled in local-only/);
  assert.doesNotMatch(connectivity, /WebBee disabled in local-only/);

  assert.match(desktopActions, /Browser Lane native-helper principle/);
  assert.doesNotMatch(desktopActions, /BrowserBee\/Canopy principle/);

  assert.match(laneStatusTest, /lane statuses collapse browser read and workflow capabilities into one Browser Lane/);
  assert.doesNotMatch(laneStatusTest, /collapse BrowserBee and WebBee/);
});
