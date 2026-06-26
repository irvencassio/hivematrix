import test from "node:test";
import assert from "node:assert/strict";

import { verifyLaneApp, type LaneAppCommandRunner } from "./verify";

const APP = "/Applications/Browser Lane.app";
const EXEC = "BrowserLane";

// Build a runner that returns canned results keyed by the command file.
function runnerFor(map: Record<string, { exitCode: number | null; stdout?: string; stderr?: string }>): LaneAppCommandRunner {
  return async (file) => {
    const r = map[file] ?? { exitCode: 0 };
    return { exitCode: r.exitCode, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

test("all checks pass → signature + gatekeeper ok, launch ok when probed", async () => {
  const result = await verifyLaneApp({
    appPath: APP,
    executable: EXEC,
    launchProbe: true,
    run: runnerFor({
      codesign: { exitCode: 0 },
      spctl: { exitCode: 0, stderr: "accepted" },
      open: { exitCode: 0 },
      pgrep: { exitCode: 0, stdout: "12345\n" },
      pkill: { exitCode: 0 },
    }),
  });
  assert.equal(result.codesignOk, true);
  assert.equal(result.gatekeeperOk, true);
  assert.equal(result.signatureOk, true);
  assert.equal(result.launchOk, true);
});

test("codesign failure → signatureOk false", async () => {
  const result = await verifyLaneApp({
    appPath: APP,
    executable: EXEC,
    run: runnerFor({
      codesign: { exitCode: 1, stderr: "code object is not signed at all" },
      spctl: { exitCode: 0 },
    }),
  });
  assert.equal(result.codesignOk, false);
  assert.equal(result.signatureOk, false);
});

test("spctl rejection → signatureOk false even if codesign passes", async () => {
  const result = await verifyLaneApp({
    appPath: APP,
    executable: EXEC,
    run: runnerFor({
      codesign: { exitCode: 0 },
      spctl: { exitCode: 3, stderr: "rejected" },
    }),
  });
  assert.equal(result.codesignOk, true);
  assert.equal(result.gatekeeperOk, false);
  assert.equal(result.signatureOk, false);
});

// The crux of the LaunchServices lesson: a perfectly signed, Gatekeeper-accepted
// bundle can still fail to launch. launchOk is independent of signatureOk.
test("launch probe failure is independent of a valid signature", async () => {
  const result = await verifyLaneApp({
    appPath: APP,
    executable: EXEC,
    launchProbe: true,
    run: runnerFor({
      codesign: { exitCode: 0 },
      spctl: { exitCode: 0 },
      open: { exitCode: 0 },
      pgrep: { exitCode: 1, stdout: "" }, // process never showed up
    }),
  });
  assert.equal(result.signatureOk, true);
  assert.equal(result.launchOk, false);
});

test("launchOk is null when the launch probe is not requested", async () => {
  const result = await verifyLaneApp({
    appPath: APP,
    executable: EXEC,
    run: runnerFor({ codesign: { exitCode: 0 }, spctl: { exitCode: 0 } }),
  });
  assert.equal(result.launchOk, null);
});
