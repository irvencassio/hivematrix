/**
 * Server-level tests for /openclaw/* routes.
 *
 * Covers: auth requirements, discovery gating, structured error responses
 * (no bare 500s), feature-flag enforcement, and create-hivematrix-task metadata.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDaemonServer } from "./server";
import { DAEMON_TOKEN_FILE, getOrCreateToken } from "@/lib/auth/token";
import { _setOpenclawDiscoveryForTests } from "@/lib/openclaw/discovery";
import type { OpenclawDiscovery } from "@/lib/openclaw/discovery";

// ── Shared stubs ─────────────────────────────────────────────────────────────

const DISCOVERY_AVAILABLE: OpenclawDiscovery = {
  installed: true,
  available: true,
  version: "OpenClaw 2026.6.10 (aa69b12)",
  gateway: { reachable: true, url: "ws://127.0.0.1:18789" },
  reason: null,
};

const DISCOVERY_MISSING: OpenclawDiscovery = {
  installed: false,
  available: false,
  version: null,
  gateway: null,
  reason: "OpenClaw is not installed.",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupTmp(label: string): { tmp: string; hmDir: string; dbPath: string } {
  const tmp = mkdtempSync(join(tmpdir(), `hm-openclaw-${label}-`));
  const hmDir = join(tmp, ".hivematrix");
  const dbPath = join(tmp, "hivematrix.db");
  return { tmp, hmDir, dbPath };
}

function enableChatDock(hmDir: string): void {
  mkdirSync(hmDir, { recursive: true });
  writeFileSync(join(hmDir, "config.json"), JSON.stringify({
    features: { "openclaw.chatDock": true },
  }));
}

// ── Auth: every /openclaw/* route requires a valid HiveMatrix bearer token ───

const AUTH_ROUTES: Array<[string, string]> = [
  ["GET", "/openclaw/status"],
  ["GET", "/openclaw/chat/history"],
  ["POST", "/openclaw/chat/send"],
  ["POST", "/openclaw/chat/inject"],
  ["POST", "/openclaw/chat/create-hivematrix-task"],
];

for (const [method, path] of AUTH_ROUTES) {
  test(`${method} ${path} returns 401 without auth`, async (t) => {
    const { tmp, dbPath } = setupTmp("auth");
    const origHome = process.env.HOME;
    const origDb = process.env.HIVEMATRIX_DB_PATH;
    process.env.HOME = tmp;
    process.env.HIVEMATRIX_DB_PATH = dbPath;
    const { _resetDbForTests } = await import("@/lib/db");
    _resetDbForTests();

    t.after(() => {
      _resetDbForTests();
      if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
      if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
      rmSync(tmp, { recursive: true, force: true });
    });

    const server = createDaemonServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    assert.equal(res.status, 401);
  });

  test(`${method} ${path} returns 401 with wrong token`, async (t) => {
    const { tmp, dbPath } = setupTmp("badtoken");
    const origHome = process.env.HOME;
    const origDb = process.env.HIVEMATRIX_DB_PATH;
    process.env.HOME = tmp;
    process.env.HIVEMATRIX_DB_PATH = dbPath;
    const { _resetDbForTests } = await import("@/lib/db");
    _resetDbForTests();

    t.after(() => {
      _resetDbForTests();
      if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
      if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
      rmSync(tmp, { recursive: true, force: true });
    });

    const server = createDaemonServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: "Bearer wrong-token-value" },
    });
    assert.equal(res.status, 401);
  });
}

// ── /openclaw/status ─────────────────────────────────────────────────────────

test("GET /openclaw/status: installed:false when OpenClaw binary is missing", async (t) => {
  const { tmp, dbPath } = setupTmp("status-missing");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  const origBin = process.env.OPENCLAW_BIN;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  process.env.OPENCLAW_BIN = "/nonexistent/bin/openclaw";
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    if (origBin !== undefined) process.env.OPENCLAW_BIN = origBin; else delete process.env.OPENCLAW_BIN;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.installed, false);
  assert.equal(body.enabled, false);
  assert.equal(body.available, false);
  assert.equal(body.version, null);
  assert.equal(body.gateway, null);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

test("GET /openclaw/status: enabled forced to false when openclaw.chatDock flag is on but binary is missing", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("status-flag-missing");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  const origBin = process.env.OPENCLAW_BIN;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  process.env.OPENCLAW_BIN = "/nonexistent/bin/openclaw";
  enableChatDock(hmDir);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    if (origBin !== undefined) process.env.OPENCLAW_BIN = origBin; else delete process.env.OPENCLAW_BIN;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  // Flag was stored as true but binary is missing — must be forced off.
  assert.equal(body.installed, false);
  assert.equal(body.enabled, false);
  // flagEnabled reflects the raw flag so the client can distinguish "flag off" from "not installed".
  assert.equal(body.flagEnabled, true, "flagEnabled is true even when binary is missing");
});

test("GET /openclaw/status: response never contains token, secret, or password fields", async (t) => {
  const { tmp, dbPath } = setupTmp("status-secrets");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_MISSING);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  assert.ok(!text.toLowerCase().includes("token"), "response must not contain 'token'");
  assert.ok(!text.toLowerCase().includes("secret"), "response must not contain 'secret'");
  assert.ok(!text.toLowerCase().includes("password"), "response must not contain 'password'");
});

// ── /openclaw/chat/history ───────────────────────────────────────────────────

test("GET /openclaw/chat/history: structured unavailable when feature is disabled", async (t) => {
  const { tmp, dbPath } = setupTmp("history-disabled");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/history?sessionKey=agent:main:main`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Must be a structured 200, not a 500.
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.available, false);
  assert.deepEqual(body.messages, []);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

test("GET /openclaw/chat/history: structured unavailable when OpenClaw is not installed", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("history-missing");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_MISSING);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.available, false);
  assert.deepEqual(body.messages, []);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

// ── /openclaw/chat/send ──────────────────────────────────────────────────────

test("POST /openclaw/chat/send: 400 when message is empty", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("send-empty");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_AVAILABLE);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey: "agent:main:main", message: "" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
});

test("POST /openclaw/chat/send: structured unavailable when feature is disabled", async (t) => {
  const { tmp, dbPath } = setupTmp("send-disabled");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey: "agent:main:main", message: "Hello" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.available, false);
  assert.equal(body.runId, null);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

test("POST /openclaw/chat/send: structured unavailable when OpenClaw is not installed", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("send-missing");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_MISSING);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey: "agent:main:main", message: "Hello OpenClaw" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.available, false);
  assert.equal(body.runId, null);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

// ── /openclaw/chat/inject ────────────────────────────────────────────────────

test("POST /openclaw/chat/inject: 400 when text is empty", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("inject-empty");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_AVAILABLE);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/inject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey: "agent:main:main", text: "" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
});

test("POST /openclaw/chat/inject: structured unavailable when feature is disabled", async (t) => {
  const { tmp, dbPath } = setupTmp("inject-disabled");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/inject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey: "agent:main:main", text: "Context note" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.available, false);
  assert.equal(body.messageId, null);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

// ── /openclaw/chat/create-hivematrix-task ────────────────────────────────────

test("POST /openclaw/chat/create-hivematrix-task: 400 when text is empty", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("create-empty");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_AVAILABLE);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/create-hivematrix-task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey: "agent:main:main", text: "" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.taskId, null);
});

test("POST /openclaw/chat/create-hivematrix-task: structured unavailable when feature is disabled", async (t) => {
  const { tmp, dbPath } = setupTmp("create-disabled");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/create-hivematrix-task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Turn this into a task", sessionKey: "agent:main:main" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.taskId, null);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

test("POST /openclaw/chat/create-hivematrix-task: structured unavailable when OpenClaw is not installed", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("create-missing");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_MISSING);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/create-hivematrix-task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Turn this into a task", sessionKey: "agent:main:main" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.taskId, null);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

test("POST /openclaw/chat/create-hivematrix-task: creates task with source:openclaw-chat and origin metadata", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("create-task");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_AVAILABLE);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const payload = {
    sessionKey: "agent:main:hivematrix",
    messageId: "msg-abc-123",
    text: "Review the failing tests in the CI pipeline and fix them.",
    projectPath: "/Users/irvencassio/hivematrix",
  };

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/create-hivematrix-task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.ok(typeof body.taskId === "string" && body.taskId.length > 0);

  const task = body.task as Record<string, unknown>;
  // Required source and executor fields
  assert.equal(task.source, "openclaw-chat");
  assert.equal(task.executor, "agent");
  assert.equal(task.status, "backlog");
  assert.equal(task.description, payload.text);
  assert.equal(task.projectPath, payload.projectPath);

  // Origin metadata in output
  const output = task.output as Record<string, unknown>;
  assert.equal(output.origin, "openclaw");
  assert.equal(output.sessionKey, payload.sessionKey);
  assert.equal(output.messageId, payload.messageId);
});

test("POST /openclaw/chat/create-hivematrix-task: response never contains token, secret, or password", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("create-secrets");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_AVAILABLE);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/chat/create-hivematrix-task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Do the thing.", sessionKey: "agent:main:main" }),
  });
  const text = await res.text();
  assert.ok(!text.toLowerCase().includes("secret"), "response must not contain 'secret'");
  assert.ok(!text.toLowerCase().includes("password"), "response must not contain 'password'");
});

// ── /openclaw/status — enabled/flagEnabled distinction ───────────────────────
// The dock visibility logic depends on two separate fields:
//   flagEnabled — the raw feature flag value (controls whether the dock shows at all)
//   enabled     — flagEnabled AND gateway is reachable (controls available vs unavailable panel)
// These tests verify both paths so a future regression is caught at the server level.

const DISCOVERY_UNREACHABLE: OpenclawDiscovery = {
  installed: true,
  available: false,
  version: "OpenClaw 2026.7.01 (test)",
  gateway: { reachable: false, url: "ws://127.0.0.1:18789" },
  reason: "OpenClaw Gateway is not reachable.",
};

test("GET /openclaw/status: enabled:true when flag is on and OpenClaw gateway is reachable", async (t) => {
  const { tmp, hmDir, dbPath } = setupTmp("status-fully-available");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_AVAILABLE);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.enabled, true, "enabled must be true when flag on and gateway reachable");
  assert.equal(body.flagEnabled, true, "flagEnabled must be true");
  assert.equal(body.installed, true, "installed must be true");
  assert.equal(body.available, true, "available must be true");
  assert.ok(body.gateway && (body.gateway as Record<string, unknown>).reachable === true, "gateway.reachable must be true");
  assert.equal(body.reason, null, "reason must be null on success");
});

test("GET /openclaw/status: enabled:true but available:false when gateway is not reachable", async (t) => {
  // 'Installed but gateway down' state: the flag is on, the binary exists, but the gateway
  // is not running. The dock init logic reads:
  //   enabled:true  → binary exists, don't show "not installed" panel
  //   available:false → gateway down, show "gateway unreachable" warn panel
  // Neither value should be absent — the dock needs both to pick the right panel.
  const { tmp, hmDir, dbPath } = setupTmp("status-unreachable");
  const origHome = process.env.HOME;
  const origDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = dbPath;
  enableChatDock(hmDir);
  _setOpenclawDiscoveryForTests(async () => DISCOVERY_UNREACHABLE);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();

  t.after(() => {
    _setOpenclawDiscoveryForTests(null);
    _resetDbForTests();
    if (origHome) process.env.HOME = origHome; else delete process.env.HOME;
    if (origDb) process.env.HIVEMATRIX_DB_PATH = origDb; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/openclaw/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  // enabled = installed AND flagEnabled — binary exists and flag is on, so enabled is true.
  // The dock uses enabled to distinguish "not installed" from "installed, gateway down".
  assert.equal(body.flagEnabled, true, "flagEnabled must be true — flag is on, so dock should show");
  assert.equal(body.enabled, true, "enabled must be true — binary exists and flag is on");
  assert.equal(body.installed, true, "installed must be true — binary exists");
  // available:false is the signal the dock uses to show the 'gateway unreachable' warn panel.
  assert.equal(body.available, false, "available must be false — gateway is down");
  assert.ok(typeof body.reason === "string" && body.reason.length > 0, "reason explains the unavailability");
  // Gateway field present but reachable:false — dock shows unavailable panel, not a hidden dock.
  const gw = body.gateway as Record<string, unknown> | null;
  assert.ok(gw !== null, "gateway field must be present");
  assert.equal(gw?.reachable, false, "gateway.reachable must be false");
});
