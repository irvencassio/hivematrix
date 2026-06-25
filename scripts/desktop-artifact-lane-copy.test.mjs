import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("desktop artifact and helper guidance use lane wording", () => {
  const trace = read("src/lib/desktopbee/trace.ts");
  const launchd = read("desktopbee-helper/launchd/com.hivematrix.desktopbee.helper.plist.template");
  const mainSwift = read("desktopbee-helper/Sources/DesktopBeeHelper/main.swift");
  const permissionsSwift = read("desktopbee-helper/Sources/DesktopBeeHelper/Permissions.swift");

  assert.match(trace, /Desktop Lane action trace/);
  assert.match(trace, /desktopbee-trace/);
  assert.doesNotMatch(trace, /DesktopBee action trace/);

  assert.match(launchd, /Desktop Lane helper launchd agent/);
  assert.match(launchd, /DesktopBeeHelper\.app/);
  assert.match(launchd, /DESKTOPBEE_PORT/);
  assert.doesNotMatch(launchd, /DesktopBee helper launchd agent/);

  assert.match(mainSwift, /Desktop Lane helper daemon/);
  assert.match(mainSwift, /Desktop Lane action contract/);
  assert.match(mainSwift, /DESKTOPBEE_SCRIPT_ALLOWLIST/);
  assert.doesNotMatch(mainSwift, /DesktopBee helper daemon|structured DesktopBee action contract/);

  assert.match(permissionsSwift, /Desktop Lane needs permission/);
  assert.doesNotMatch(permissionsSwift, /DesktopBee needs permission/);
});
