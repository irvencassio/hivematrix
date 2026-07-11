import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("daemon exposes the four /lane-apps routes wired to the lane-apps module", () => {
  const server = read("src/daemon/server.ts");

  // GET /lane-apps — list install state for the lane app(s).
  assert.match(server, /urlPath === "\/lane-apps"/);
  assert.match(server, /getAllLaneAppStates/);

  // POST sub-routes with an id-constrained matcher (browser-lane).
  // Matched against the exact escaped regex literals used in server.ts.
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane)\\/install$"), "install route matcher");
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane)\\/launch$"), "launch route matcher");
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane)\\/verify$"), "verify route matcher");
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane)\\/reveal$"), "reveal route matcher");
  assert.doesNotMatch(server, /terminal-lane/);

  // Lazy import from the pure module.
  assert.match(server, /@\/lib\/lane-apps/);

  // Install + verify + launch handlers reference the module helpers.
  assert.match(server, /installLaneAppById/);
  assert.match(server, /verifyLaneAppById/);
  assert.match(server, /activePathFor/);
});

test("daemon exposes a typed repair-applications route + install reports active path", () => {
  const server = read("src/daemon/server.ts");
  // Repair is id-constrained (no arbitrary path, no shell).
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane)\\/repair-applications$"), "repair route matcher");
  assert.match(server, /repairApplicationsCopy/);
  // Install result surfaces the active path + shadow warning honestly.
  assert.match(server, /activePath/);
  assert.match(server, /shadowed|warning/);
});

test("daemon exposes POST /lane-apps/update-all wired to the update-all helper", () => {
  const server = read("src/daemon/server.ts");
  assert.match(server, /urlPath === "\/lane-apps\/update-all"/);
  assert.match(server, /updateAllStaleLaneApps/);
});
