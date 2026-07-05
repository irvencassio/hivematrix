import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  const s = await getUpdateStatus({ force: true, fetchImpl, forceFlagPath: join(tmpdir(), "hm-unused-force") });
  assert.equal(s.latest, "99.0.0");
  assert.equal(s.updateAvailable, true);
});

test("getUpdateStatus reports no update when the feed is not newer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-feed-check-"));
  const forceFlagPath = join(dir, ".force-update");
  const updateInProgressPath = join(dir, ".update-in-progress.json");
  writeFileSync(forceFlagPath, "1");
  writeFileSync(updateInProgressPath, JSON.stringify({ version: "0.0.1", startedAt: Date.now() }));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "0.0.1" }) }) as unknown as Response;
  try {
    const s = await getUpdateStatus({ force: true, fetchImpl, forceFlagPath, updateInProgressPath });
    assert.equal(s.updateAvailable, false);
    assert.equal(existsSync(forceFlagPath), false);
    assert.equal(existsSync(updateInProgressPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getUpdateStatus degrades gracefully when the feed is unreachable", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  const s = await getUpdateStatus({ force: true, fetchImpl, forceFlagPath: join(tmpdir(), "hm-unused-force") });
  assert.equal(s.updateAvailable, false);
  assert.equal(s.latest, null);
  assert.match(s.error ?? "", /network down/);
});

test("getUpdateStatus reports an in-progress update for the same latest version", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-feed-check-"));
  const updateInProgressPath = join(dir, ".update-in-progress.json");
  writeFileSync(updateInProgressPath, JSON.stringify({ version: "99.0.0", startedAt: Date.now() }));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "99.0.0" }) }) as unknown as Response;
  try {
    const s = await getUpdateStatus({ force: true, fetchImpl, updateInProgressPath, forceFlagPath: join(dir, ".force-update") });
    assert.equal(s.updateAvailable, true);
    assert.equal(s.applying, true);
    assert.equal(s.applyingVersion, "99.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getUpdateStatus reports stale apply markers as daemon restart needed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-feed-check-"));
  const updateInProgressPath = join(dir, ".update-in-progress.json");
  const startedAt = 1_000;
  writeFileSync(updateInProgressPath, JSON.stringify({ version: "99.0.0", startedAt }));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "99.0.0" }) }) as unknown as Response;
  try {
    const s = await getUpdateStatus({
      force: true,
      fetchImpl,
      updateInProgressPath,
      forceFlagPath: join(dir, ".force-update"),
      nowMs: startedAt + 10 * 60 * 1000,
    });
    assert.equal(s.updateAvailable, true);
    assert.equal(s.applying, false);
    assert.equal(s.needsDaemonRestart, true);
    assert.match(s.detail ?? "", /daemon/i);
    assert.match(s.detail ?? "", /restart/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyUpdateViaRelaunch spawns a detached relauncher and marks update state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-feed-check-"));
  const calls: Array<{ cmd: string; args: string[]; opts: unknown }> = [];
  const fakeSpawn = ((cmd: string, args: string[], opts: unknown) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  }) as unknown as typeof import("child_process").spawn;
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "99.0.0" }) }) as unknown as Response;
  const forceFlagPath = join(dir, ".force-update");
  const updateInProgressPath = join(dir, ".update-in-progress.json");
  try {
    const r = await applyUpdateViaRelaunch(fakeSpawn, { fetchImpl, forceFlagPath, updateInProgressPath });
    assert.equal(r.ok, true);
    assert.equal(r.version, "99.0.0");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, "sh");
    assert.match(calls[0].args.join(" "), /pkill .*HiveMatrix\.app\/Contents\/MacOS\/app/);
    assert.match(calls[0].args.join(" "), /open -a HiveMatrix/);
    assert.equal(readFileSync(forceFlagPath, "utf-8"), "1");
    assert.match(readFileSync(updateInProgressPath, "utf-8"), /99\.0\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyUpdateViaRelaunch refuses to relaunch when already current", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-feed-check-"));
  const calls: unknown[] = [];
  const fakeSpawn = ((cmd: string, args: string[], opts: unknown) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  }) as unknown as typeof import("child_process").spawn;
  const forceFlagPath = join(dir, ".force-update");
  const updateInProgressPath = join(dir, ".update-in-progress.json");
  writeFileSync(forceFlagPath, "1");
  writeFileSync(updateInProgressPath, JSON.stringify({ version: "0.0.1", startedAt: Date.now() }));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ version: "0.0.1" }) }) as unknown as Response;
  try {
    const r = await applyUpdateViaRelaunch(fakeSpawn, { fetchImpl, forceFlagPath, updateInProgressPath });
    assert.equal(r.ok, false);
    assert.match(r.detail, /already up to date/);
    assert.equal(calls.length, 0);
    assert.equal(existsSync(forceFlagPath), false);
    assert.equal(existsSync(updateInProgressPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
