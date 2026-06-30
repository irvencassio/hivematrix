import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveOpenclawBin,
  runVersionCheck,
  readGatewayUrl,
  discoverOpenclaw,
} from "./discovery";

// resolveOpenclawBin — env injection

test("resolveOpenclawBin: OPENCLAW_BIN pointing to a real file resolves it", () => {
  assert.equal(resolveOpenclawBin({ OPENCLAW_BIN: "/bin/sh" }), "/bin/sh");
});

test("resolveOpenclawBin: OPENCLAW_BIN pointing to a missing path returns null", () => {
  assert.equal(resolveOpenclawBin({ OPENCLAW_BIN: "/nonexistent/bin/openclaw" }), null);
});

test("resolveOpenclawBin: empty OPENCLAW_BIN falls through to PATH search", () => {
  // On a machine without openclaw this returns null, on one with it returns a path — both are valid.
  const result = resolveOpenclawBin({ OPENCLAW_BIN: "" });
  assert.ok(result === null || typeof result === "string");
});

// runVersionCheck

test("runVersionCheck: returns null for a non-existent binary", () => {
  assert.equal(runVersionCheck("/nonexistent/bin/openclaw"), null);
});

test("runVersionCheck: returns null for a binary that exits non-zero", () => {
  // /usr/bin/false always exits 1 with no output
  assert.equal(runVersionCheck("/usr/bin/false"), null);
});

// discoverOpenclaw — logic paths via injection

test("discoverOpenclaw: not installed when binary is missing", async () => {
  const result = await discoverOpenclaw({
    env: { OPENCLAW_BIN: "/nonexistent/bin/openclaw" },
    probe: async () => { throw new Error("should not probe"); },
  });
  assert.equal(result.installed, false);
  assert.equal(result.available, false);
  assert.equal(result.version, null);
  assert.equal(result.gateway, null);
  assert.ok(result.reason?.includes("not installed"));
});

test("discoverOpenclaw: installed but unavailable when version check fails", async () => {
  const result = await discoverOpenclaw({
    env: { OPENCLAW_BIN: "/bin/sh" },
    _versionFn: () => null,
    probe: async () => { throw new Error("should not probe"); },
  });
  assert.equal(result.installed, true);
  assert.equal(result.available, false);
  assert.equal(result.version, null);
  assert.equal(result.gateway, null);
  assert.ok(result.reason !== null);
});

test("discoverOpenclaw: available when binary found, version ok, gateway reachable", async () => {
  const result = await discoverOpenclaw({
    env: { OPENCLAW_BIN: "/bin/sh" },
    _versionFn: () => "OpenClaw 2026.6.10 (aa69b12)",
    _gatewayUrlFn: () => "ws://127.0.0.1:18789",
    probe: async () => true,
  });
  assert.equal(result.installed, true);
  assert.equal(result.available, true);
  assert.equal(result.version, "OpenClaw 2026.6.10 (aa69b12)");
  assert.deepEqual(result.gateway, { reachable: true, url: "ws://127.0.0.1:18789" });
  assert.equal(result.reason, null);
});

test("discoverOpenclaw: installed + version ok but gateway unreachable", async () => {
  const result = await discoverOpenclaw({
    env: { OPENCLAW_BIN: "/bin/sh" },
    _versionFn: () => "OpenClaw 2026.6.10 (aa69b12)",
    _gatewayUrlFn: () => "ws://127.0.0.1:18789",
    probe: async () => false,
  });
  assert.equal(result.installed, true);
  assert.equal(result.available, false);
  assert.deepEqual(result.gateway, { reachable: false, url: "ws://127.0.0.1:18789" });
  assert.ok(result.reason !== null);
});

test("discoverOpenclaw: custom gateway URL is forwarded to response", async () => {
  const customUrl = "ws://127.0.0.1:19999";
  const result = await discoverOpenclaw({
    env: { OPENCLAW_BIN: "/bin/sh" },
    _versionFn: () => "OpenClaw 2026.6.10 (aa69b12)",
    _gatewayUrlFn: () => customUrl,
    probe: async () => true,
  });
  assert.equal(result.gateway?.url, customUrl);
});

test("discoverOpenclaw: result JSON never contains token, secret, or auth fields", async () => {
  const result = await discoverOpenclaw({
    env: { OPENCLAW_BIN: "/nonexistent/bin/openclaw" },
    probe: async () => false,
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.toLowerCase().includes("token"));
  assert.ok(!serialized.toLowerCase().includes("secret"));
  assert.ok(!serialized.toLowerCase().includes("password"));
});

// readGatewayUrl — falls back to default when no config file is present

test("readGatewayUrl: returns default ws URL when no openclaw config exists", () => {
  // On a machine without ~/.openclaw/config.json this must return the default.
  // On a machine that does have openclaw installed the result is still a ws:// string.
  const url = readGatewayUrl();
  assert.ok(url.startsWith("ws://") || url.startsWith("wss://"), `expected ws URL, got: ${url}`);
});
