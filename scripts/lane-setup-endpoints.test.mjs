import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("daemon exposes a read-only GET /lane-setup wired to the lane-setup model", () => {
  const server = read("src/daemon/server.ts");
  assert.match(server, /urlPath === "\/lane-setup"/, "GET /lane-setup route present");
  assert.match(server, /getLaneSetup/, "handler calls getLaneSetup");
  assert.match(server, /@\/lib\/lane-setup/, "lazy import from the pure lane-setup module");
});

test("the Verify handler records the verification so /lane-setup sees signing/launch truth", () => {
  const server = read("src/daemon/server.ts");
  assert.match(server, /recordLaneVerification/, "verify handler records the result for the unified model");
});

test("no arbitrary shell/exec endpoint is introduced for lanes", () => {
  const server = read("src/daemon/server.ts");
  // Repair actions are the existing typed, id-constrained routes — never a shell.
  assert.doesNotMatch(server, /urlPath === "\/lane-setup\/exec"/);
  assert.doesNotMatch(server, /\/lane-apps\/[^"']*\/(exec|shell|run-command)/);
});

test("existing typed, id-constrained lane action routes remain intact", () => {
  const server = read("src/daemon/server.ts");
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane|terminal-lane)\\/install$"));
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane|terminal-lane)\\/verify$"));
  assert.ok(server.includes("^\\/lane-apps\\/(browser-lane|terminal-lane)\\/launch$"));
  assert.match(server, /urlPath === "\/browser-lane\/readiness\/run"/);
  assert.match(server, /urlPath === "\/terminal-lane\/readiness\/run"/);
});
