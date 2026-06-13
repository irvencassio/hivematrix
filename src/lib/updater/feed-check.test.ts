import test from "node:test";
import assert from "node:assert/strict";

import { compareVersions, getUpdateStatus, applyUpdateViaRelaunch } from "./feed-check";

test("compareVersions orders dotted versions numerically", () => {
  assert.ok(compareVersions("0.1.4", "0.1.3") > 0);
  assert.ok(compareVersions("0.1.3", "0.1.4") < 0);
  assert.equal(compareVersions("0.1.4", "0.1.4"), 0);
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0, "minor beats patch");
  assert.ok(compareVersions("1.0.0", "0.9.9") > 0, "major beats minor");
  assert.ok(compareVersions("0.1.10", "0.1.9") > 0, "numeric, not lexical");
});

test("getUpdateStatus flags an update when the feed is newer", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "99.0.0" }) }) as unknown as Response;
  const s = await getUpdateStatus({ force: true, fetchImpl });
  assert.equal(s.latest, "99.0.0");
  assert.equal(s.updateAvailable, true);
});

test("getUpdateStatus reports no update when the feed is not newer", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "0.0.1" }) }) as unknown as Response;
  const s = await getUpdateStatus({ force: true, fetchImpl });
  assert.equal(s.updateAvailable, false);
});

test("getUpdateStatus degrades gracefully when the feed is unreachable", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  const s = await getUpdateStatus({ force: true, fetchImpl });
  assert.equal(s.updateAvailable, false);
  assert.equal(s.latest, null);
  assert.match(s.error ?? "", /network down/);
});

test("applyUpdateViaRelaunch spawns a detached relauncher and never throws", () => {
  const calls: Array<{ cmd: string; args: string[]; opts: unknown }> = [];
  const fakeSpawn = ((cmd: string, args: string[], opts: unknown) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  }) as unknown as typeof import("child_process").spawn;
  const r = applyUpdateViaRelaunch(fakeSpawn);
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "sh");
  assert.match(calls[0].args.join(" "), /pkill .*HiveMatrix\.app\/Contents\/MacOS\/app/);
  assert.match(calls[0].args.join(" "), /open -a HiveMatrix/);
});
