import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("daemon exposes the four /lane-apps routes wired to the lane-apps module", () => {
  const server = read("src/daemon/server.ts");

  // GET /lane-apps — list install state for both lane apps.
  assert.match(server, /urlPath === "\/lane-apps"/);
  assert.match(server, /getAllLaneAppStates/);

  // POST sub-routes with an id-constrained matcher (browser-lane | terminal-lane).
  // Matched against the exact escaped regex literals used in server.ts.
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane|terminal-lane)\\/install$"), "install route matcher");
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane|terminal-lane)\\/launch$"), "launch route matcher");
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane|terminal-lane)\\/verify$"), "verify route matcher");
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane|terminal-lane)\\/reveal$"), "reveal route matcher");

  // Lazy import from the pure module.
  assert.match(server, /@\/lib\/lane-apps/);

  // Install + verify + launch handlers reference the module helpers.
  assert.match(server, /installLaneAppById/);
  assert.match(server, /verifyLaneAppById/);
  assert.match(server, /activePathFor/);
});
