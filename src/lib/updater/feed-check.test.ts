import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { compareVersions, getUpdateStatus, applyUpdateViaRelaunch } from "./feed-check";
import { BETA_FEED_URL, STABLE_FEED_URL } from "./channel";

test("compareVersions orders dotted versions numerically", () => {
  assert.ok(compareVersions("0.1.4", "0.1.3") > 0);
  assert.ok(compareVersions("0.1.3", "0.1.4") < 0);
  assert.equal(compareVersions("0.1.4", "0.1.4"), 0);
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0, "minor beats patch");
  assert.ok(compareVersions("1.0.0", "0.9.9") > 0, "major beats minor");
  assert.ok(compareVersions("0.1.10", "0.1.9") > 0, "numeric, not lexical");
});

/**
 * Regression 2026-07-19: minutes after v0.1.229 was published and marked
 * Latest, the daemon still reported "already up to date" and refused to update.
 * The tag URL served 0.1.229 while releases/latest/download served 0.1.228 from
 * a GitHub CDN edge (`x-cache: MISS, HIT`, `age: 1551`). A stale cache reading
 * as a working updater is the failure mode worth pinning down.
 */
test("getUpdateStatus defeats the GitHub CDN edge cache when fetching the feed", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fetchImpl = async (url: unknown, init?: unknown) => {
    seenUrl = String(url);
    seenInit = init as RequestInit;
    return { ok: true, json: async () => ({ version: "99.0.0" }) } as unknown as Response;
  };
  await getUpdateStatus({
    force: true,
    channel: "stable",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    forceFlagPath: join(tmpdir(), "hm-unused-force"),
  });
  // The query string is what actually defeats the edge — verified against the
  // live CDN, where the un-busted URL returned the previous release and the
  // busted one returned the new one immediately.
  assert.match(seenUrl, /hivematrix-core\.json\?t=\d+/, "feed URL must carry a cache-busting query string");
  const headers = (seenInit?.headers ?? {}) as Record<string, string>;
  assert.equal(headers["Cache-Control"], "no-cache", "must also ask intermediaries not to serve a cached copy");
});

test("getUpdateStatus polls the feed for the selected channel and reports which one answered", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: unknown) => {
    seen.push(String(url).split("?")[0]);
    return { ok: true, json: async () => ({ version: "99.0.0" }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const forceFlagPath = join(tmpdir(), "hm-unused-force");

  const stable = await getUpdateStatus({ force: true, channel: "stable", fetchImpl, forceFlagPath });
  const beta = await getUpdateStatus({ force: true, channel: "beta", fetchImpl, forceFlagPath });

  assert.deepEqual(seen, [STABLE_FEED_URL, BETA_FEED_URL]);
  // The console labels the pill from this, so a beta answer must never be able
  // to render as if it came from stable.
  assert.equal(stable.channel, "stable");
  assert.equal(beta.channel, "beta");
});

test("switching channel is not answered from the other channel's cached result", async () => {
  // Regression guard for the cache being keyed by time alone: flipping the
  // setting in Settings has to take effect on the next poll, not up to a minute
  // later, or the operator sees "no update" on a channel they just joined.
  const seen: string[] = [];
  const fetchImpl = (async (url: unknown) => {
    seen.push(String(url).split("?")[0]);
    return { ok: true, json: async () => ({ version: "99.0.0" }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const forceFlagPath = join(tmpdir(), "hm-unused-force");
  const t0 = Date.now() + 20_000_000;

  await getUpdateStatus({ force: true, channel: "stable", fetchImpl, forceFlagPath, nowMs: t0 });
  // Same instant, no force: the STABLE answer is cached and must be reused.
  await getUpdateStatus({ channel: "stable", fetchImpl, forceFlagPath, nowMs: t0 + 1_000 });
  assert.deepEqual(seen, [STABLE_FEED_URL], "a same-channel poll inside the TTL is served from cache");

  // Same instant, different channel: must refetch rather than reuse.
  const beta = await getUpdateStatus({ channel: "beta", fetchImpl, forceFlagPath, nowMs: t0 + 2_000 });
  assert.deepEqual(seen, [STABLE_FEED_URL, BETA_FEED_URL]);
  assert.equal(beta.channel, "beta");
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

test("a failed update check expires fast instead of pinning the indicator dark", async () => {
  // Regression 2026-07-18: 0.1.220 was live on the feed but the console showed
  // no update. A transient fetch timeout had been cached exactly like a success,
  // so `updateAvailable:false` persisted for the full 60s TTL on every poll.
  let calls = 0;
  const failing: typeof fetch = async () => { calls += 1; throw new Error("The operation was aborted due to timeout"); };
  const ok: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ version: "99.0.0" }), { status: 200 });
  };

  // Anchor past the real clock: this module caches at module scope, so earlier
  // tests in this file have already populated it with Date.now()-based stamps.
  const t0 = Date.now() + 10_000_000;
  const bad = await getUpdateStatus({ fetchImpl: failing, nowMs: t0, force: true });
  assert.equal(bad.updateAvailable, false);
  assert.ok(bad.error, "first check failed");
  const callsAfterFail = calls;

  // Still inside the ERROR ttl: served from cache, no refetch.
  await getUpdateStatus({ fetchImpl: ok, nowMs: t0 + 2_000 });
  assert.equal(calls, callsAfterFail, "within error-ttl the cached failure is reused");

  // Past the SHORT error ttl but well inside the 60s success ttl: must refetch,
  // and the real update must surface.
  const good = await getUpdateStatus({ fetchImpl: ok, nowMs: t0 + 10_000 });
  assert.equal(calls, callsAfterFail + 1, "a stale failure must be retried, not held for the full TTL");
  assert.equal(good.latest, "99.0.0");
  assert.equal(good.updateAvailable, true);
});
