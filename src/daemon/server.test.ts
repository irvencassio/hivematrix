import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { CONSOLE_HTML } from "./console";
import { consoleHtmlHeaders, createDaemonServer, normalizeHomeProjectPath } from "./server";
import { DAEMON_TOKEN_FILE, getOrCreateToken } from "@/lib/auth/token";

test("console HTML routes are served with update-safe cache headers", () => {
  assert.deepEqual(consoleHtmlHeaders(), {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
});

test("Mermaid browser asset is served same-origin without a token", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/assets/mermaid.min.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/javascript/);
  assert.match(await res.text(), /mermaid/i);
});

test("GET /mailbee is passive when Mail Lane is disabled", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-mail-passive-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMailbeeStatusDepsForTests } = await import("@/lib/mailbee/status");
  _resetDbForTests();
  let probeCalls = 0;
  _setMailbeeStatusDepsForTests({
    canControlMail: async () => {
      probeCalls++;
      throw new Error("passive /mailbee must not probe Mail.app");
    },
  });

  t.after(() => {
    _setMailbeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/mailbee`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.enabled, false);
  assert.equal(body.mailControllable, false);
  assert.equal(body.mailProbeSkipped, true);
  assert.equal(body.mailProbeReason, "channel_disabled");
  assert.equal(probeCalls, 0);
});

test("GET /onboarding is passive when Mail Lane is disabled", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-onboarding-mail-passive-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMailbeeStatusDepsForTests } = await import("@/lib/mailbee/status");
  _resetDbForTests();
  let probeCalls = 0;
  _setMailbeeStatusDepsForTests({
    canControlMail: async () => {
      probeCalls++;
      throw new Error("passive /onboarding must not probe Mail.app");
    },
  });

  t.after(() => {
    _setMailbeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/onboarding`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { steps: Array<{ id: string; detail: string }> };
  const mail = body.steps.find((step) => step.id === "mailbee");
  assert.ok(mail);
  assert.match(mail.detail, /disabled/i);
  assert.equal(probeCalls, 0);
});

test("POST /mailbee/probe is an explicit Mail.app probe", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-mail-probe-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMailbeeStatusDepsForTests } = await import("@/lib/mailbee/status");
  _resetDbForTests();
  let probeCalls = 0;
  _setMailbeeStatusDepsForTests({
    canControlMail: async () => {
      probeCalls++;
      return true;
    },
  });

  t.after(() => {
    _setMailbeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/mailbee/probe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.mailControllable, true);
  assert.equal(body.mailProbeSkipped, false);
  assert.equal(probeCalls, 1);
});

test("GET /messagebee is passive when Message Lane is disabled", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-message-passive-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMessagebeeStatusDepsForTests } = await import("@/lib/messagebee/status");
  _resetDbForTests();
  let probeCalls = 0;
  _setMessagebeeStatusDepsForTests({
    probeChatDbAccess: () => {
      probeCalls++;
      throw new Error("passive /messagebee must not probe chat.db");
    },
  });

  t.after(() => {
    _setMessagebeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/messagebee`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.enabled, false);
  assert.equal(body.chatDbReadable, false);
  assert.equal(body.chatDbProbeSkipped, true);
  assert.equal(body.chatDbProbeReason, "channel_disabled");
  assert.equal(probeCalls, 0);
});

test("GET /onboarding is passive for Message Lane when disabled", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-onboarding-message-passive-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMessagebeeStatusDepsForTests } = await import("@/lib/messagebee/status");
  _resetDbForTests();
  let probeCalls = 0;
  _setMessagebeeStatusDepsForTests({
    probeChatDbAccess: () => {
      probeCalls++;
      throw new Error("passive /onboarding must not probe chat.db");
    },
  });

  t.after(() => {
    _setMessagebeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/onboarding`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { steps: Array<{ id: string; detail: string }> };
  const message = body.steps.find((step) => step.id === "messagebee");
  assert.ok(message);
  assert.match(message.detail, /disabled/i);
  assert.equal(probeCalls, 0);
});

test("POST /messagebee/probe is an explicit chat.db probe", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-message-probe-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMessagebeeStatusDepsForTests } = await import("@/lib/messagebee/status");
  _resetDbForTests();
  let probeCalls = 0;
  _setMessagebeeStatusDepsForTests({
    probeChatDbAccess: () => {
      probeCalls++;
      return { ok: true, detail: "Messages database readable" };
    },
  });

  t.after(() => {
    _setMessagebeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/messagebee/probe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.chatDbReadable, true);
  assert.equal(body.chatDbProbeSkipped, false);
  assert.equal(probeCalls, 1);
});

test("GET /onboarding/setup is passive for disabled lane probes", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-onboarding-setup-passive-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMessagebeeStatusDepsForTests } = await import("@/lib/messagebee/status");
  const { _setMailbeeStatusDepsForTests } = await import("@/lib/mailbee/status");
  _resetDbForTests();
  let messageProbeCalls = 0;
  let mailProbeCalls = 0;
  _setMessagebeeStatusDepsForTests({
    probeChatDbAccess: () => {
      messageProbeCalls++;
      throw new Error("passive setup must not probe chat.db");
    },
  });
  _setMailbeeStatusDepsForTests({
    canControlMail: async () => {
      mailProbeCalls++;
      throw new Error("passive setup must not probe Mail.app");
    },
  });

  t.after(() => {
    _setMessagebeeStatusDepsForTests(null);
    _setMailbeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/onboarding/setup`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { permissions: Array<{ id: string; state: string }> };
  assert.ok(body.permissions.find((p) => p.id === "fullDiskAccess"));
  assert.ok(body.permissions.find((p) => p.id === "mailAutomation"));
  assert.equal(messageProbeCalls, 0);
  assert.equal(mailProbeCalls, 0);
});

test("POST /onboarding/setup/full-disk-access/probe checks chat.db even when Message Lane is disabled", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-onboarding-fda-probe-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMessagebeeStatusDepsForTests } = await import("@/lib/messagebee/status");
  _resetDbForTests();
  let probeCalls = 0;
  _setMessagebeeStatusDepsForTests({
    probeChatDbAccess: () => {
      probeCalls++;
      return { ok: true, detail: "Messages database readable" };
    },
  });

  t.after(() => {
    _setMessagebeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/onboarding/setup/full-disk-access/probe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { permissions: Array<{ id: string; state: string; detail: string }> };
  const row = body.permissions.find((p) => p.id === "fullDiskAccess");
  assert.equal(row?.state, "granted");
  assert.match(row?.detail ?? "", /Messages database readable/);
  assert.equal(probeCalls, 1);
});

test("POST /onboarding/setup/mail-automation/probe checks Apple Mail Automation explicitly", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-onboarding-mail-probe-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  const { _setMailbeeStatusDepsForTests } = await import("@/lib/mailbee/status");
  _resetDbForTests();
  let probeCalls = 0;
  _setMailbeeStatusDepsForTests({
    canControlMail: async () => {
      probeCalls++;
      return true;
    },
  });

  t.after(() => {
    _setMailbeeStatusDepsForTests(null);
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/onboarding/setup/mail-automation/probe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { permissions: Array<{ id: string; state: string }> };
  assert.equal(body.permissions.find((p) => p.id === "mailAutomation")?.state, "granted");
  assert.equal(probeCalls, 1);
});

test("POST /onboarding/setup/desktop-permissions/request asks helper to prompt for permissions", async (t) => {
  const originalFetch = globalThis.fetch;
  const helperRequests: unknown[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (!url.startsWith("http://127.0.0.1:3748/")) {
      return originalFetch(input, init);
    }
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true, version: "test" }), { status: 200 });
    }
    if (url.endsWith("/action")) {
      helperRequests.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({
        ok: true,
        action: "desktop.permissions",
        data: { accessibility: true, screenRecording: true },
      }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/onboarding/setup/desktop-permissions/request`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { permissions: Array<{ id: string; state: string }> };
  assert.equal(body.permissions.find((p) => p.id === "desktopControl")?.state, "granted");
  assert.equal((helperRequests[0] as { params?: { prompt?: boolean } }).params?.prompt, true);
});

test("POST /messagebee/send refuses while Message Lane is disabled", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-message-send-disabled-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  t.after(() => {
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/messagebee/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ to: "+15555550123", text: "hello" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.match(String(body.message), /Message Lane is disabled/i);
});

test("POST /messagebee/test-send refuses while Message Lane is disabled", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-message-test-send-disabled-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  t.after(() => {
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/messagebee/test-send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ handle: "+15555550123", text: "hello" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.match(String(body.error), /Message Lane is disabled/i);
});

test("POST /messagebee/self-handles stores normalized loop-guard identities", async (t) => {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-message-self-handles-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "hivematrix.db");

  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  t.after(() => {
    _resetDbForTests();
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/messagebee/self-handles`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ handles: ["+1 (555) 000-1111", "Me@icloud.com"] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { selfHandles: string[] };
  assert.deepEqual(body.selfHandles, ["+15550001111", "me@icloud.com"]);

  const statusRes = await fetch(`http://127.0.0.1:${port}/messagebee`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const status = await statusRes.json() as { selfHandles: string[] };
  assert.deepEqual(status.selfHandles, ["+15550001111", "me@icloud.com"]);
});

test("command project paths resolve from the current user home", () => {
  assert.equal(
    normalizeHomeProjectPath("~/hivematrix", "/Users/example"),
    "/Users/example/hivematrix",
  );
  assert.equal(
    normalizeHomeProjectPath("$HOME/hivematrix", "/Users/example"),
    "/Users/example/hivematrix",
  );
});

test("command project paths reject root and paths outside home", () => {
  assert.throws(
    () => normalizeHomeProjectPath("/", "/Users/example"),
    /cannot be root/,
  );
  assert.throws(
    () => normalizeHomeProjectPath("/tmp/hivematrix", "/Users/example"),
    /must be under/,
  );
});

test("command launcher sends its own visible project path", () => {
  assert.match(CONSOLE_HTML, /id="commandPath"/);
  assert.match(CONSOLE_HTML, /getElementById\('commandPath'\)/);
  assert.match(CONSOLE_HTML, /const projectPath = \(\(document\.getElementById\('commandPath'\) \|\| \{\}\)\.value \|\| '\$HOME'\)\.trim\(\) \|\| '\$HOME';/);
  // The command runner uses its own project path field, never the New Task path.
  const runCommand = CONSOLE_HTML.match(/async function runSelectedCommand\(\) \{[\s\S]*?\n\}/);
  assert.ok(runCommand, "runSelectedCommand block should be present");
  assert.doesNotMatch(runCommand![0], /t_path/);
  assert.match(CONSOLE_HTML, /projectPath:\s*projectPath/);
});

test("voice auto-approval settings persist through daemon API", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-auto-approval-"));
  process.env.HOME = tmp;
  t.after(() => {
    if (originalHome) process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${token}` };
  let res = await fetch(`${base}/settings/voice/auto-approval`, { headers });
  assert.equal(res.status, 200);
  const initial = await res.json() as { policy: Record<string, boolean> };
  assert.deepEqual(initial.policy, { enabled: false, allowCheckpoints: false, allowLowRiskTools: false });

  res = await fetch(`${base}/settings/voice/auto-approval`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, allowCheckpoints: true, allowLowRiskTools: true }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json() as { policy: Record<string, boolean> };
  assert.deepEqual(updated.policy, { enabled: true, allowCheckpoints: true, allowLowRiskTools: true });
});

test("voice logic diagnostic endpoint runs canned scenarios without audio", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-voice-logic-"));
  process.env.HOME = tmp;
  t.after(() => {
    if (originalHome) process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/settings/voice/test-scenarios`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; failed: number; scenarios: Array<{ audioBytes: number; actual: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.failed, 0);
  assert.ok(body.scenarios.length >= 50);
  assert.ok(body.scenarios.some((s) => s.actual === "command:weather"));
  assert.ok(body.scenarios.every((s) => s.audioBytes === 0));
});

test("POST /tasks/enhance returns { enhanced, rationale, title } and soft-falls-back with no local model configured", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-enhance-"));
  process.env.HOME = tmp;
  t.after(() => {
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/tasks/enhance`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ description: "fix the login bug" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { enhanced: string; rationale: string; title: string };
  // No ~/.hivematrix/config.json in this fresh temp HOME → no Qwen profile →
  // hasLocalCompletionModel() is false → enhancePrompt() passes through.
  assert.equal(body.enhanced, "fix the login bug");
  assert.equal(body.rationale, "");
  assert.equal(body.title, "");
});

test("POST /tasks routes the exact failed YouTube prompt to content.youtube_summary, not a generic Codex agent", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-youtube-"));
  process.env.HOME = tmp;

  // Deterministic, no network: inject fake transcript/title/summarizer.
  const { _setYoutubeSummaryDepsForTests } = await import("@/lib/workflows/youtube-summary");
  _setYoutubeSummaryDepsForTests({
    fetchTranscript: async () => "This is the captured transcript for the failed-prompt video.",
    fetchTitle: async () => "The Failed Prompt Video",
    summarize: async () => ({ summary: "A concise generated summary.", keyPoints: ["Point one", "Point two"] }),
  });

  t.after(() => {
    _setYoutubeSummaryDepsForTests(null);
    if (originalHome) process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const res = await fetch(`${base}/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      description: "can you run the YouTube thing that summarizes for: https://www.youtube.com/watch?v=9PUaEj0pMYE",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;

  // Routed to the deterministic workflow, with run + task pointers for the board.
  assert.equal(body.routed, "workflow");
  assert.equal(body.workflowId, "content.youtube_summary");
  assert.ok(typeof body.runId === "string" && body.runId, "response carries a runId");
  assert.ok(typeof body.taskId === "string" && body.taskId, "response carries a taskId");

  const { getDb } = await import("@/lib/db");
  const db = getDb();

  // The created task is NOT a generic Codex agent task, and none exists.
  const created = db.prepare("SELECT executor, source FROM tasks WHERE _id = ?").get(body.taskId) as { executor: string; source: string };
  assert.notEqual(created.executor, "agent");
  const agentCount = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE executor = 'agent'").get() as { n: number };
  assert.equal(agentCount.n, 0, "no generic agent task may be created for a matched YouTube-summary request");

  // Public YouTube URL → Browser Lane is never required/created.
  const browserCount = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE source = 'browser-lane'").get() as { n: number };
  assert.equal(browserCount.n, 0);

  // The run is linked back to the task so the operator sees it from the board.
  const { getWorkflowRun } = await import("@/lib/workflows/runs");
  const run = getWorkflowRun(body.runId as string);
  assert.ok(run);
  assert.equal(run!.workflowId, "content.youtube_summary");
  assert.equal(run!.parentTaskId, body.taskId);

  // No secrets anywhere in the response or persisted task/run output.
  const taskRow = db.prepare("SELECT output FROM tasks WHERE _id = ?").get(body.taskId) as { output: string };
  const blob = JSON.stringify(body) + taskRow.output + JSON.stringify(run);
  assert.doesNotMatch(blob, /password|cookie|secret|credential|api[_-]?key|\btoken\b/i);
});

// ── Task Intake + lane routing ─────────────────────────────────────

async function startServer(t: import("node:test").TestContext) {
  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
}

function withTempHome(t: import("node:test").TestContext) {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-wp-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "test.db");
  t.after(async () => {
    const { _resetDbForTests } = await import("@/lib/db");
    _resetDbForTests();
    delete process.env.HIVEMATRIX_DB_PATH;
    if (originalHome) process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });
}

test("POST /tasks dispatches a broad prompt as ONE self-planning 'work' task (no work_package routing)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "Fix all the broken imports across the codebase, update every config, and refactor the router." }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  // A broad auto prompt is a single self-planning task; the frontier harness plans
  // its own subtasks. Nothing is routed to a Work Package.
  assert.notEqual(body.routed, "work_package");
  assert.ok(body._id, "broad auto prompt should create a normal task");
  assert.equal(body.workflow, "work", "broad auto prompt dispatches as a single work-workflow task");
});

test("POST /tasks still creates a normal task for a small prompt (intake passthrough)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "Fix the typo in the footer.", project: "hivematrix", projectPath: "/tmp/x" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.notEqual(body.routed, "work_package");
  assert.ok(body._id, "a normal task is returned");
  // A small prompt is NOT promoted to the self-planning "work" workflow.
  assert.notEqual(body.workflow, "work");
  const agentCount = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE executor = 'agent'").get() as { n: number }).n;
  assert.equal(agentCount, 1);
});

test("POST /tasks expands a '~' projectPath (Inbox project) to an absolute home path", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "Fix the typo in the footer.", project: "inbox", projectPath: "~" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  const stored = getDb().prepare("SELECT projectPath FROM tasks WHERE _id = ?").get(body._id as string) as { projectPath: string };
  assert.equal(stored.projectPath, process.env.HOME, "stored path is the expanded absolute home dir, not the literal '~'");
});

test("POST /tasks expands a '~/sub' projectPath prefix, leaves other absolute paths untouched", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const r1 = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "task one", project: "inbox", projectPath: "~/notes" }),
  });
  const b1 = await r1.json() as Record<string, unknown>;
  const s1 = getDb().prepare("SELECT projectPath FROM tasks WHERE _id = ?").get(b1._id as string) as { projectPath: string };
  assert.equal(s1.projectPath, `${process.env.HOME}/notes`);

  const r2 = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "task two", project: "hivematrix", projectPath: "/tmp/some-repo" }),
  });
  const b2 = await r2.json() as Record<string, unknown>;
  const s2 = getDb().prepare("SELECT projectPath FROM tasks WHERE _id = ?").get(b2._id as string) as { projectPath: string };
  assert.equal(s2.projectPath, "/tmp/some-repo", "a normal absolute path outside $HOME is left as-is");
});

test("POST /tasks still routes an explicit Terminal Lane request to the lane (regression)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "Use Terminal Lane to run uptime on the build server.", project: "hivematrix", projectPath: "/tmp/x" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "terminal-lane");
});

test("POST /tasks routes an explicit Browser Lane request to the lane (parity with voice)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "search the web for best solo founder CRMs", project: "ios", projectPath: "/tmp/x" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "browser-lane");
  assert.ok(body.taskId, "a browser-lane task id is returned");
  // The created task must carry the browser-lane source so the agent calls the
  // Browser Lane endpoint instead of Chrome MCP / WebSearch.
  const row = getDb().prepare("SELECT source FROM tasks WHERE _id = ?").get(body.taskId) as { source?: string } | undefined;
  assert.equal(row?.source, "browser-lane");
});

test("POST /tasks routes explicit logged-in Browser Lane workflows to Browser Lane", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({
      description: "use Browser Lane to sign into LinkedIn and see if I have any friend requests",
      project: "hivematrix",
      projectPath: "/tmp/x",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "browser-lane");
  assert.equal(body.mode, "workflow");
  assert.ok(body.taskId, "a browser-lane task id is returned");

  const row = getDb()
    .prepare("SELECT source, description, output FROM tasks WHERE _id = ?")
    .get(body.taskId) as { source?: string; description?: string; output?: string } | undefined;
  assert.equal(row?.source, "browser-lane");
  assert.match(row?.description ?? "", /Browser Lane workflow/);
  assert.match(row?.description ?? "", /Requires login: yes/);
  assert.match(row?.description ?? "", /\/lane\/browser/);
  assert.doesNotMatch(row?.description ?? "", /127\.0\.0\.1:3748\/lane\/browser/);

  const output = JSON.parse(row?.output ?? "{}") as {
    browserLaneVoice?: { args?: Record<string, unknown> };
  };
  assert.deepEqual(output.browserLaneVoice?.args, {
    mode: "workflow",
    objective: "Check LinkedIn friend requests",
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  });
});

test("POST /tasks routes LinkedIn connection-requests workflow prompt to Browser Lane with correct args", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({
      description: "open LinkedIn with Browser Lane and check connection requests",
      project: "hivematrix",
      projectPath: "/tmp/x",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "browser-lane");
  assert.equal(body.mode, "workflow");
  assert.ok(body.taskId, "a browser-lane task id is returned");

  const row = getDb()
    .prepare("SELECT source, output FROM tasks WHERE _id = ?")
    .get(body.taskId) as { source?: string; output?: string } | undefined;
  assert.equal(row?.source, "browser-lane");

  const output = JSON.parse(row?.output ?? "{}") as {
    browserLaneVoice?: { args?: Record<string, unknown> };
  };
  assert.deepEqual(output.browserLaneVoice?.args, {
    mode: "workflow",
    objective: "Check LinkedIn connection requests",
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  });
});

test("POST /tasks routes Gmail unread workflow prompt to Browser Lane with correct args", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({
      description: "use Browser Lane to sign into Gmail and check unread mail",
      project: "hivematrix",
      projectPath: "/tmp/x",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "browser-lane");
  assert.equal(body.mode, "workflow");
  assert.ok(body.taskId, "a browser-lane task id is returned");

  const row = getDb()
    .prepare("SELECT source, description, output FROM tasks WHERE _id = ?")
    .get(body.taskId) as { source?: string; description?: string; output?: string } | undefined;
  assert.equal(row?.source, "browser-lane");
  assert.match(row?.description ?? "", /Browser Lane workflow/);
  assert.match(row?.description ?? "", /Requires login: yes/);

  const output = JSON.parse(row?.output ?? "{}") as {
    browserLaneVoice?: { args?: Record<string, unknown> };
  };
  assert.deepEqual(output.browserLaneVoice?.args, {
    mode: "workflow",
    objective: "Check Gmail unread mail",
    startUrl: "https://mail.google.com/mail/u/0/#inbox",
    requiresLogin: true,
  });
});

test("POST /tasks routes HeyGen video-status workflow prompt to Browser Lane with correct args", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({
      description: "use Browser Lane to log into HeyGen and check video status",
      project: "hivematrix",
      projectPath: "/tmp/x",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "browser-lane");
  assert.equal(body.mode, "workflow");
  assert.ok(body.taskId, "a browser-lane task id is returned");

  const row = getDb()
    .prepare("SELECT source, description, output FROM tasks WHERE _id = ?")
    .get(body.taskId) as { source?: string; description?: string; output?: string } | undefined;
  assert.equal(row?.source, "browser-lane");
  assert.match(row?.description ?? "", /Browser Lane workflow/);
  assert.match(row?.description ?? "", /Requires login: yes/);

  const output = JSON.parse(row?.output ?? "{}") as {
    browserLaneVoice?: { args?: Record<string, unknown> };
  };
  assert.deepEqual(output.browserLaneVoice?.args, {
    mode: "workflow",
    objective: "Check HeyGen video status",
    startUrl: "https://app.heygen.com/home",
    requiresLogin: true,
  });
});

test("POST /tasks does not mis-route a plain 'search' dev task to Browser Lane (no false positive)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "search the codebase for the login bug and fix it", project: "hivematrix", projectPath: "/tmp/x" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.notEqual(body.routed, "browser-lane");
});

test("POST /tasks does not mis-route Browser Lane development work to Browser Lane", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  for (const description of [
    "search the codebase for Browser Lane bugs",
    "fix Browser Lane icon size",
    "add tests for browser lane routing",
    "update Browser Lane to use a darker icon",
    "Browser Lane icon is misaligned in dark mode",
    "debug Browser Lane session expiry logic",
    "refactor Browser Lane auth handler",
    "Browser Lane auth tests are failing on CI",
    "Browser Lane status badge color is wrong",
  ]) {
    const res = await fetch(`${base}/tasks`, {
      method: "POST", headers,
      body: JSON.stringify({ description, project: "hivematrix", projectPath: "/tmp/x" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assert.notEqual(body.routed, "browser-lane", description);
  }
});

test("POST /tasks does not mis-route dev tasks whose description begins 'Browser Lane <readSearch-verb>' to Browser Lane", async (t) => {
  // These descriptions trigger stripLeadIn (the string starts with "Browser Lane")
  // and then the readSearch branch of detectVoiceBrowserLaneIntent matches the
  // remainder (check/inspect/research/summarize), producing a false-positive
  // browser-lane route. The intent is unambiguously development work — none of
  // the descriptions include an explicit "use Browser Lane to …" framing.
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  for (const description of [
    "Browser Lane check icon rendering",
    "Browser Lane inspect the sidebar layout",
    "Browser Lane research the navigation bug",
    "Browser Lane summarize the icon issue",
  ]) {
    const res = await fetch(`${base}/tasks`, {
      method: "POST", headers,
      body: JSON.stringify({ description, project: "hivematrix", projectPath: "/tmp/x" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assert.notEqual(body.routed, "browser-lane", description);
  }
});

test("POST /tasks: a broad prompt that NAMES a lane is a single task, not hijacked into Terminal Lane", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  // A broad bug-list with a category tally that literally contains "Terminal Lane".
  const description = [
    "Fix all of these across the app, and clean everything up:",
    "BrowserLane starts at a small window size, the overview color coding is wrong,",
    "the icon resets to dark, and the wallpaper translucency is ignored.",
    "Bug tally by area:",
    "- Browser Lane: 5",
    "- Terminal Lane: 4",
    "- Email: 12",
  ].join("\n");

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description, project: "hivematrix", projectPath: "/tmp/x" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  // Broad auto → a single task (frontier self-plans), not an auto-Work-Package…
  assert.notEqual(body.routed, "work_package");
  assert.ok(body._id, "broad prompt naming a lane should create a normal task");
  // …and, critically, it must NOT be hijacked into a Terminal Lane task just because
  // the text mentions the lane name (the breadth guard still protects this).
  const tl = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE source = 'terminal-lane'").get() as { n: number }).n;
  assert.equal(tl, 0, "no Terminal Lane task may be created for a broad prompt that merely names the lane");
});

test("POST /tasks route=normal creates a plain task even for a broad prompt", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ route: "normal", description: "Fix all the lint, update every dep, and refactor auth across the codebase.", project: "hivematrix", projectPath: "/tmp/x" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(body._id, "a plain task is returned");
  assert.notEqual(body.routed, "work_package");
  // Explicit route=normal keeps the task a plain standalone task (not promoted to "work").
  assert.notEqual(body.workflow, "work");
});

test("POST /tasks route=terminal-lane forces the lane even without use-cue wording", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ route: "terminal-lane", description: "df -h on the build box", project: "hivematrix", projectPath: "/tmp/x" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "terminal-lane");
});

test("New Task form exposes a Route selector and createTask sends it", () => {
  assert.match(CONSOLE_HTML, /id="t_route"/);
  const block = CONSOLE_HTML.match(/async function createTask\(\) \{[\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block![0], /route/);
});

test("task screen does not expose internal fields (directiveId / completedBy / proverType)", () => {
  // selectTask renders the task detail view — it must not leak these internal identifiers
  // into the operator-facing UI.
  const block = CONSOLE_HTML.match(/async function selectTask\([\s\S]*?^\}/m);
  assert.ok(block, "selectTask block must be present");
  assert.doesNotMatch(block![0], /directiveId/);
  assert.doesNotMatch(block![0], /completedBy/);
  assert.doesNotMatch(block![0], /proverType/);
});

test("task detail does not render execution provenance panel", () => {
  // taskExecutionPanel removed — selectTask must not call it and no exec-panel markup in console.
  const block = CONSOLE_HTML.match(/async function selectTask\([\s\S]*?^\}/m);
  assert.ok(block, "selectTask block must be present");
  assert.doesNotMatch(block![0], /taskExecutionPanel/);
  assert.doesNotMatch(CONSOLE_HTML, /class="exec-panel"/);
});

test("task telemetry strip is placed inside a collapsed debug details block", () => {
  const block = CONSOLE_HTML.match(/function taskTelemetryStrip\([\s\S]*?^\}/m);
  assert.ok(block, "taskTelemetryStrip must be present");
  assert.match(block![0], /<details/);
  assert.match(block![0], /Debug info/);
});

test("board card does not show a directiveId badge", () => {
  // renderBoard builds the board card HTML — the directiveId badge was removed so
  // operators don't see internal directive IDs in the task list.
  const block = CONSOLE_HTML.match(/function renderBoard\([\s\S]*?^\}/m);
  assert.ok(block, "renderBoard must be present");
  assert.doesNotMatch(block![0], /directiveId/);
});

// ── Daemon port in generated lane instructions ───────────────────────────────
//
// These tests currently FAIL because buildVoiceBrowserLaneTask embeds the port
// as a shell variable `${HIVEMATRIX_PORT:-3747}` rather than resolving
// daemonPort() at task-creation time. The desired behaviour: instructions must
// contain the literal resolved port (e.g. 127.0.0.1:3747/lane/browser) so the
// agent receives an unambiguous URL. Shell-variable deferral is unsafe because
// the agent's harness sets HIVE_DAEMON_PORT (not HIVEMATRIX_PORT), so the
// fallback :3747 fires whenever the non-default port is in use.

test("Browser Lane workflow description uses the default daemon port 3747 when HIVEMATRIX_PORT is unset", async (t) => {
  withTempHome(t);
  const originalPort = process.env.HIVEMATRIX_PORT;
  delete process.env.HIVEMATRIX_PORT;
  t.after(() => {
    if (originalPort !== undefined) process.env.HIVEMATRIX_PORT = originalPort;
  });

  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({
      description: "use Browser Lane to check LinkedIn messages",
      project: "hivematrix",
      projectPath: "/tmp/x",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "browser-lane");

  const row = getDb()
    .prepare("SELECT description FROM tasks WHERE _id = ?")
    .get(body.taskId) as { description?: string } | undefined;

  // Must embed the resolved port 3747, not the shell variable form.
  assert.match(row?.description ?? "", /127\.0\.0\.1:3747\/lane\/browser/);
});

test("Browser Lane workflow description uses the HIVEMATRIX_PORT value when set to a non-default port", async (t) => {
  withTempHome(t);
  const originalPort = process.env.HIVEMATRIX_PORT;
  process.env.HIVEMATRIX_PORT = "3888";
  t.after(() => {
    if (originalPort !== undefined) process.env.HIVEMATRIX_PORT = originalPort;
    else delete process.env.HIVEMATRIX_PORT;
  });

  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({
      description: "use Browser Lane to check LinkedIn messages",
      project: "hivematrix",
      projectPath: "/tmp/x",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "browser-lane");

  const row = getDb()
    .prepare("SELECT description FROM tasks WHERE _id = ?")
    .get(body.taskId) as { description?: string } | undefined;

  // Description must embed the actual runtime port 3888, not the default 3747.
  assert.match(row?.description ?? "", /127\.0\.0\.1:3888\/lane\/browser/);
  assert.doesNotMatch(row?.description ?? "", /127\.0\.0\.1:3747/);
});

test("Browser Lane workflow description does not defer port resolution to shell variable expansion", async (t) => {
  // When the task description's curl URL contains ${HIVEMATRIX_PORT:-3747} the
  // port is resolved by the agent's shell at execution time. That is unreliable:
  // the subprocess harness exports HIVE_DAEMON_PORT, not HIVEMATRIX_PORT, so the
  // shell fallback (:3747) fires even on a daemon running on a different port.
  // The description must embed a literal resolved URL instead.
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({
      description: "use Browser Lane to search for the latest AI news",
      project: "hivematrix",
      projectPath: "/tmp/x",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "browser-lane");

  const row = getDb()
    .prepare("SELECT description FROM tasks WHERE _id = ?")
    .get(body.taskId) as { description?: string } | undefined;

  // The curl URL must not contain shell variable syntax for the port.
  assert.doesNotMatch(row?.description ?? "", /\$\{HIVEMATRIX_PORT/);
  // And the /lane/browser endpoint must still appear with a literal port.
  assert.match(row?.description ?? "", /127\.0\.0\.1:\d+\/lane\/browser/);
});

// ─── Morning Briefing retirement: /settings/briefing + /briefing/test guards ──

test("GET /settings/briefing returns 200 with disabled config", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-briefing-get-"));
  process.env.HOME = tmp;
  t.after(() => {
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/settings/briefing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.ok("briefing" in body, "response includes briefing config");
  assert.equal((body.briefing as Record<string, unknown>).enabled, false, "default config has briefing disabled");
});

test("POST /settings/briefing with enabled:true returns 410 (Morning Briefing retired)", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-briefing-enable-"));
  process.env.HOME = tmp;
  t.after(() => {
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/settings/briefing`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(res.status, 410, "re-enabling Morning Briefing is refused with 410 Gone");
  const body = await res.json() as Record<string, unknown>;
  assert.match(String(body.error), /retired/i, "error body mentions retirement");
});

test("POST /settings/briefing with enabled:false returns 200 (disabling is still accepted)", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-briefing-disable-"));
  process.env.HOME = tmp;
  t.after(() => {
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/settings/briefing`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(res.status, 200, "disabling briefing via POST is still accepted for backward compat");
  const body = await res.json() as Record<string, unknown>;
  assert.ok("briefing" in body, "response includes updated briefing config");
  assert.equal((body.briefing as Record<string, unknown>).enabled, false, "briefing remains disabled");
});

test("POST /briefing/test returns 410 Gone (deprecated endpoint retired)", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-briefing-test-"));
  process.env.HOME = tmp;
  t.after(() => {
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/briefing/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 410, "/briefing/test returns 410 Gone after Morning Briefing retirement");
  const body = await res.json() as Record<string, unknown>;
  assert.match(String(body.error), /retired/i, "error body mentions retirement");
});

// ── POST /commands/run — project identity ───────────────────────────────────────

test("POST /commands/run preserves explicit project; omitted project defaults to ops; invalid path returns 400", async (t) => {
  withTempHome(t);
  // Plant a local command so scanLocalCommands finds it under the temp HOME.
  const cmdDir = join(process.env.HOME!, ".claude", "commands");
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(join(cmdDir, "import-all.md"), "---\ndescription: Import everything\n---\nDo the import");

  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  // Case 1: explicit project is preserved on the created task.
  const r1 = await fetch(`${base}/commands/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "import-all", project: "digibot", projectPath: "$HOME/digibot" }),
  });
  assert.equal(r1.status, 201, "explicit project: 201 Created");
  const b1 = await r1.json() as { task: Record<string, unknown> };
  assert.equal(b1.task.project, "digibot", "explicit project name is stored on the task");
  assert.doesNotMatch(String(b1.task.projectPath), /\$HOME/, "projectPath has $HOME expanded to a real path");
  assert.match(String(b1.task.projectPath), /digibot$/, "normalized projectPath ends with the folder name");
  assert.equal(b1.task.source, "command", "task source is command");

  // Case 2: omitted project falls back to 'ops'.
  const r2 = await fetch(`${base}/commands/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "import-all", projectPath: "$HOME/work" }),
  });
  assert.equal(r2.status, 201, "no project field: 201 Created");
  const b2 = await r2.json() as { task: Record<string, unknown> };
  assert.equal(b2.task.project, "ops", "missing project falls back to ops");

  // Case 3: path outside HOME is rejected; no third task is created.
  const r3 = await fetch(`${base}/commands/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "import-all", projectPath: "/tmp/outside-home" }),
  });
  assert.equal(r3.status, 400, "path outside HOME is rejected with 400");
  const taskCount = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE source = 'command'").get() as { n: number }).n;
  assert.equal(taskCount, 2, "only the two valid requests created tasks");
});

test("oversized request bodies are rejected with 413, not buffered until OOM", async (t) => {
  const originalLimit = process.env.HIVEMATRIX_MAX_BODY_BYTES;
  process.env.HIVEMATRIX_MAX_BODY_BYTES = "1024";
  t.after(() => {
    if (originalLimit) process.env.HIVEMATRIX_MAX_BODY_BYTES = originalLimit;
    else delete process.env.HIVEMATRIX_MAX_BODY_BYTES;
  });

  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/settings/features`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key: "x".repeat(8_192) }),
  });
  assert.equal(res.status, 413);
  const body = await res.json() as { error?: string };
  assert.match(body.error ?? "", /too large/i);
});

test("daemon catch-all checks headersSent before writing a 500", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");
  const ix = src.indexOf('console.error("[daemon] Request error:');
  assert.notEqual(ix, -1, "catch-all error log must exist");
  // A route that throws after starting its response must not crash the daemon
  // with ERR_HTTP_HEADERS_SENT when the catch-all writes its JSON 500.
  assert.match(src.slice(ix, ix + 600), /headersSent/, "catch-all must check res.headersSent");
});

test("POST /flash/turn sends an immediate SSE keepalive before model work", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");
  const route = src.slice(src.indexOf('urlPath === "/flash/turn"'), src.indexOf("// GET /flash/sessions"));
  assert.match(route, /res\.write\(": keepalive\\n\\n"\)/, "flash turn route must write an immediate SSE keepalive");
  assert.ok(
    route.indexOf('res.write(": keepalive\\n\\n")') < route.indexOf("handleFlashTurn"),
    "keepalive must be written before importing/running the Flash turn handler",
  );
});

test("POST /flash/turn runs voice command overrides before Flash model work", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");
  const route = src.slice(src.indexOf('urlPath === "/flash/turn"'), src.indexOf("// GET /flash/sessions"));
  assert.match(route, /commandTurnOverride/, "voice flash turns should try deterministic command overrides");
  assert.ok(
    route.indexOf("commandTurnOverride") < route.indexOf("handleFlashTurn"),
    "voice command override must run before the Flash turn handler",
  );
});

test("POST /voice/turn returns synthesized audio bytes, not the generated file path", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");
  const route = src.slice(src.indexOf('urlPath === "/voice/turn"'), src.indexOf("// POST /voice/provision"));
  assert.match(route, /readFileSync\(audioPath\)\.toString\("base64"\)/, "voice turn must read the synthesized file as base64");
  // Turn-by-turn replies use the SAME live voice (Kokoro) as the streaming path
  // via synthesizeReplyVoice, which internally falls back to `say`. The route
  // itself must not re-implement a voiceRuntime()/synthesizeSpeech fallback.
  assert.match(route, /synthesizeReplyVoice\(reply,\s*lang\)/, "voice turn must speak in the unified live voice");
  assert.ok(
    route.indexOf("synthesizeReplyVoice") < route.indexOf('toString("base64")'),
    "voice turn should synthesize first, then serialize the file bytes",
  );
});

test("POST /voice/turn runs saved-location voice commands before the Flash model", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");
  const route = src.slice(src.indexOf('urlPath === "/voice/turn"'), src.indexOf("// POST /voice/provision"));
  assert.match(route, /commandTurnOverride/, "voice turn must try deterministic commands such as weather");
  assert.ok(
    route.indexOf("commandTurnOverride") < route.indexOf("runFlashTurnText"),
    "saved-location commands must run before the generic Flash text turn",
  );
});

test("Flash realtime voice pipeline emits VAD frames before segmented STT", () => {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const src = readFileSync(join(root, "voice-sidecar", "flash_pipeline.py"), "utf8");
  const pipeline = src.slice(src.indexOf("pipeline = Pipeline(["), src.indexOf("])", src.indexOf("pipeline = Pipeline([")));

  assert.match(src, /from pipecat\.processors\.audio\.vad_processor import VADProcessor/);
  assert.match(pipeline, /VADProcessor|vad/);
  assert.ok(
    pipeline.indexOf("vad") < pipeline.indexOf("stt"),
    "VAD processor must run before WhisperCppSTT so SegmentedSTTService receives speech boundaries",
  );
});

test("realtime STT adapters write Pipecat WAV segments directly", () => {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  for (const file of ["voice-sidecar/whisper_stt.py", "voice-sidecar/realtime.py"]) {
    const src = readFileSync(join(root, file), "utf8");
    const runStt = src.slice(src.indexOf("async def run_stt"), src.indexOf("try:", src.indexOf("async def run_stt")));

    assert.match(runStt, /open\(.*,\s*"wb"\)/, `${file} must write the provided WAV segment bytes`);
    assert.doesNotMatch(runStt, /wave\.open\(.*,\s*"wb"\)/, `${file} must not wrap an already-encoded WAV segment`);
    assert.doesNotMatch(runStt, /writeframes\(audio\)/, `${file} must not treat Pipecat's segment bytes as raw PCM`);
  }
});

test("Flash realtime processor honors SSE event lines for token and done payloads", () => {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const src = readFileSync(join(root, "voice-sidecar", "flash_llm.py"), "utf8");
  const loop = src.slice(src.indexOf("while True:"), src.indexOf("# tool_start / tool_result"));

  assert.match(loop, /sse_event\s*=\s*""/, "processor must track the current SSE event name");
  assert.match(loop, /line\.startswith\("event:"\)/, "processor must read standard SSE event lines");
  assert.match(loop, /etype\s*=\s*event\.get\("type"\)\s+or\s+event\.get\("event"\)\s+or\s+sse_event/, "JSON-less SSE event names must drive token/done handling");
  assert.match(loop, /sse_event\s*=\s*""/, "event name must be cleared after its data payload");
});

test("realtime TTS frames include the Pipecat audio context id", () => {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const src = readFileSync(join(root, "voice-sidecar", "realtime.py"), "utf8");
  const runTts = src.slice(src.indexOf("async def run_tts"), src.indexOf("def make_vad"));

  assert.match(runTts, /async def run_tts\(self,\s*text:\s*str,\s*context_id:\s*str\)/);
  assert.match(
    runTts,
    /TTSAudioRawFrame\([^)]*context_id\s*=\s*context_id/s,
    "Pipecat 1.3 requires raw TTS frames to carry the active audio context id",
  );
});

test("pack download fetch is bounded by an abort timeout", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");
  // A stalled remote server must not hang the /packs install route forever.
  assert.match(src, /fetch\(body\.url\.trim\(\),\s*\{\s*signal:\s*AbortSignal\.timeout\(/, "pack download fetch must pass AbortSignal.timeout");
});

test("GET /providers returns installed/enabled/authPresent for claude and codex", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/providers`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { providers: Array<{ id: string; installed: boolean; enabled: boolean; authPresent: boolean }> };
  assert.equal(body.providers.length, 2);
  assert.deepEqual(body.providers.map((p) => p.id).sort(), ["claude", "codex"]);
  for (const p of body.providers) {
    assert.equal(typeof p.installed, "boolean");
    assert.equal(typeof p.enabled, "boolean");
    assert.equal(typeof p.authPresent, "boolean");
  }
});

test("POST /providers/:id/enabled persists the toggle and GET /providers reflects it", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const off = await fetch(`${base}/providers/codex/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: false }),
  });
  assert.equal(off.status, 200);
  const offBody = await off.json() as { ok: boolean; id: string; enabled: boolean };
  assert.deepEqual(offBody, { ok: true, id: "codex", enabled: false });

  const list = await fetch(`${base}/providers`, { headers });
  const listBody = await list.json() as { providers: Array<{ id: string; enabled: boolean }> };
  assert.equal(listBody.providers.find((p) => p.id === "codex")?.enabled, false);

  const on = await fetch(`${base}/providers/codex/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true }),
  });
  const onBody = await on.json() as { enabled: boolean };
  assert.equal(onBody.enabled, true);
});

test("POST /claude/auth/login no longer exists — renamed to /providers/:id/setup with no back-compat alias", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/claude/auth/login`, { method: "POST", headers });
  assert.notEqual(res.status, 200);
});

test("disabling a provider removes it from /usage's subscription reads", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write } = await import("node:fs");
  mkdir(join(process.env.HOME!, ".hivematrix"), { recursive: true });
  write(join(process.env.HOME!, ".hivematrix", "config.json"), JSON.stringify({
    providers: { claude: { enabled: false }, codex: { enabled: false } },
  }));
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/usage`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { subscription: unknown; subscriptionStatus: { state: string }; codexSubscription: unknown };
  assert.equal(body.subscription, null);
  assert.equal(body.subscriptionStatus.state, "disabled");
  assert.equal(body.codexSubscription, null);
});

test("disabling a provider excludes its rows from /observability and /observability/series (history retained, view filtered)", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write } = await import("node:fs");
  mkdir(join(process.env.HOME!, ".hivematrix"), { recursive: true });
  write(join(process.env.HOME!, ".hivematrix", "config.json"), JSON.stringify({
    providers: { claude: { enabled: true }, codex: { enabled: false } },
  }));

  const { recordRun } = await import("@/lib/observability/store");
  recordRun({
    taskId: "obs-claude", runIndex: 0, model: "claude-opus-4-8", status: "done",
    inputTokens: 100, outputTokens: 50, costUsd: 0.01, project: "demo",
    startedAtMs: 0, completedAtMs: 1000,
  });
  recordRun({
    taskId: "obs-codex", runIndex: 0, model: "codex:gpt-5.5-codex", status: "done",
    inputTokens: 100, outputTokens: 50, costUsd: 0.01, project: "demo",
    startedAtMs: 0, completedAtMs: 1000,
  });

  const { base, headers } = await startServer(t);

  const obsRes = await fetch(`${base}/observability`, { headers });
  assert.equal(obsRes.status, 200);
  const obsBody = await obsRes.json() as {
    recent: Array<{ provider: string }>;
    scorecard: Array<{ route: string }>;
  };
  assert.ok(obsBody.recent.some((r) => r.provider === "anthropic"), "claude (enabled) row present");
  assert.ok(!obsBody.recent.some((r) => r.provider === "openai-codex"), "codex (disabled) row excluded from the view");
  assert.ok(!obsBody.scorecard.some((r) => r.route === "openai-codex"), "codex excluded from the route scorecard");

  const seriesRes = await fetch(`${base}/observability/series?window=7d`, { headers });
  assert.equal(seriesRes.status, 200);
  const seriesBody = await seriesRes.json() as {
    providers: string[];
    points: Array<{ byProvider: Record<string, unknown> }>;
    totals: { byProvider: Array<{ key: string }> };
  };
  assert.ok(!seriesBody.providers.includes("openai-codex"), "codex excluded from series provider list");
  assert.ok(!seriesBody.totals.byProvider.some((p) => p.key === "openai-codex"), "codex excluded from series totals");
  for (const pt of seriesBody.points) assert.ok(!("openai-codex" in pt.byProvider), "codex excluded from every series point");

  // History is retained on disk, not deleted — re-enable and confirm it reappears.
  write(join(process.env.HOME!, ".hivematrix", "config.json"), JSON.stringify({
    providers: { claude: { enabled: true }, codex: { enabled: true } },
  }));
  const obsRes2 = await fetch(`${base}/observability`, { headers });
  const obsBody2 = await obsRes2.json() as { recent: Array<{ provider: string }> };
  assert.ok(obsBody2.recent.some((r) => r.provider === "openai-codex"), "codex row reappears once re-enabled");
});

test("disabling the current primary frontier provider corrects it to the remaining enabled provider", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  // Make Claude the primary, both enabled.
  await fetch(`${base}/settings`, { method: "POST", headers, body: JSON.stringify({ frontierProvider: "claude" }) });
  await fetch(`${base}/providers/claude/enabled`, { method: "POST", headers, body: JSON.stringify({ enabled: true }) });
  await fetch(`${base}/providers/codex/enabled`, { method: "POST", headers, body: JSON.stringify({ enabled: true }) });

  // Disable the primary (claude) — codex is still enabled, so primary should flip to codex.
  const res = await fetch(`${base}/providers/claude/enabled`, { method: "POST", headers, body: JSON.stringify({ enabled: false }) });
  assert.equal(res.status, 200);

  const settings = await fetch(`${base}/models`, { headers });
  const settingsBody = await settings.json() as { frontierProvider?: string };
  assert.equal(settingsBody.frontierProvider, "codex", "primary corrected off the now-disabled provider");
});

test("every SSE stream registers a response error handler (an unhandled stream 'error' event would crash the daemon)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "server.ts"), "utf8");
  const sites = [...src.matchAll(/text\/event-stream/g)];
  assert.ok(sites.length >= 3, `expected at least 3 SSE endpoints, found ${sites.length}`);
  for (const m of sites) {
    const window = src.slice(m.index!, m.index! + 1500);
    assert.match(
      window,
      /res\.on\("error"/,
      `SSE endpoint near offset ${m.index} must attach res.on("error", ...) — the daemon exits on uncaughtException`,
    );
  }
});
