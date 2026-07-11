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

test("POST /tasks/enhance returns { enhanced, rationale, title } and soft-falls-back when the Claude CLI call fails", async (t) => {
  const originalHome = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "hm-server-enhance-"));
  process.env.HOME = tmp;
  t.after(() => {
    if (originalHome) process.env.HOME = originalHome; else delete process.env.HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  // The route calls enhancePrompt() with no injected chatComplete, so it falls
  // through to the real default: haikuChatComplete() over the subscription-OAuth
  // claude CLI. That CLI is genuinely installed on dev/CI machines running this
  // suite (see chat-client.ts), so without stubbing execFile this test would spawn
  // a real `claude -p ...` subprocess and hit the operator's live Anthropic usage.
  // Force the CLI call to fail instead — enhancePrompt() treats ANY chatComplete
  // failure as a soft-fallback (passthrough), which is exactly the behavior this
  // test verifies.
  const { _setExecFileForTests } = await import("@/lib/models/chat-client");
  _setExecFileForTests((async () => {
    throw new Error("stubbed: claude CLI must not be invoked for real in this test");
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);
  t.after(() => _setExecFileForTests(null));

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
  const body = await res.json() as { enhanced: string; rationale: string; title: string; agentType: string };
  // Claude CLI call fails → enhancePrompt() passes through unchanged.
  assert.equal(body.enhanced, "fix the login bug");
  assert.equal(body.rationale, "");
  assert.equal(body.title, "");
  assert.equal(body.agentType, "auto", "passthrough always suggests auto — the wizard never invents a role it couldn't classify");
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

test("local-engine settings routes no longer exist (Claude-native cutover Phase 4 — the Local Model UI was removed)", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const getRoutes = ["/local-engine", "/local-engine/provision", "/local-model/status"];
  for (const path of getRoutes) {
    const res = await fetch(`${base}${path}`, { headers });
    assert.notEqual(res.status, 200, `${path} must no longer serve the local-engine UI`);
  }

  const postRoutes = ["/local-engine/enabled", "/local-engine/selection", "/local-engine/tuning", "/local-engine/sampling", "/local-engine/provision"];
  for (const path of postRoutes) {
    const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify({}) });
    assert.notEqual(res.status, 200, `POST ${path} must no longer serve the local-engine UI`);
  }
});

test("POST /onboarding/local-model no longer exists (Claude-native cutover Phase 5 — local-Qwen deleted)", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/onboarding/local-model`, {
    method: "POST", headers, body: JSON.stringify({ mode: "cloud-only" }),
  });
  assert.notEqual(res.status, 200, "the onboarding local-model provisioning route was deleted with qwen-profile.ts");
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

test("/observability/series end-to-end: 1h window, per-model breakdown, cache 5m/1h split all round-trip over real HTTP", async (t) => {
  withTempHome(t);
  const { recordRun } = await import("@/lib/observability/store");

  recordRun({
    taskId: "e2e-claude", runIndex: 0, model: "claude-opus-4-8", status: "done",
    inputTokens: 500, outputTokens: 100, cacheReadTokens: 1000,
    cacheCreationTokens: 300, cacheCreate5mTokens: 200, cacheCreate1hTokens: 100,
    costUsd: 0.05, project: "demo", startedAtMs: 0, completedAtMs: 1000,
  });
  recordRun({
    taskId: "e2e-local-fast", runIndex: 0, model: "qwen3.6-35b-4bit", status: "done",
    inputTokens: 200, outputTokens: 80, project: "demo", startedAtMs: 0, completedAtMs: 500,
  });
  recordRun({
    taskId: "e2e-local-coding", runIndex: 0, model: "qwen3.6-27b-4bit", status: "done",
    inputTokens: 150, outputTokens: 60, project: "demo", startedAtMs: 0, completedAtMs: 500,
  });

  const { base, headers } = await startServer(t);

  // 1h window: previously whitelisted only 24h/30d, defaulting anything else
  // (including a bare "1h") to 7d — a regression here would silently widen
  // the window instead of erroring.
  const res = await fetch(`${base}/observability/series?window=1h`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as {
    window: string; unit: string; points: Array<{ t: string }>;
    models: Array<{ model: string; provider: string; runs: number }>;
    cache: Array<{ provider: string; cacheCreate5mTokens: number | null; cacheCreate1hTokens: number | null; netBenefitTokens: number | null }>;
  };
  assert.equal(body.window, "1h");
  assert.equal(body.unit, "minute");
  assert.equal(body.points.length, 12, "1h window buckets into 12 five-minute points");

  // Per-model breakdown: two distinct local models under the same provider,
  // not collapsed into one "local model" row.
  const byModel = Object.fromEntries(body.models.map((m) => [m.model, m]));
  assert.ok(byModel["qwen3.6-35b-4bit"], "fast tier is its own model row");
  assert.ok(byModel["qwen3.6-27b-4bit"], "coding tier is its own model row");
  assert.equal(byModel["qwen3.6-35b-4bit"].provider, "local-qwen");
  assert.equal(byModel["claude-opus-4-8"].provider, "anthropic");

  // Cache 5m/1h split + net benefit round-trip through the real HTTP response.
  const anthropicCache = body.cache.find((c) => c.provider === "anthropic")!;
  assert.equal(anthropicCache.cacheCreate5mTokens, 200);
  assert.equal(anthropicCache.cacheCreate1hTokens, 100);
  assert.ok(anthropicCache.netBenefitTokens != null, "known split → a real (non-null) net benefit number");
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

test("GET /brain/projects, /brain/docs, /brain/doc — Phase-1 checkpoint (brief/ctx/stale/orphan + raw content)", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write, utimesSync } = await import("node:fs");
  const brainRoot = join(process.env.HOME!, "brain");
  const proj = join(brainRoot, "projects", "hive");
  mkdir(join(proj, "lanes"), { recursive: true });
  mkdir(join(process.env.HOME!, ".hivematrix"), { recursive: true });
  write(join(process.env.HOME!, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: brainRoot } }));

  write(join(proj, "agent-brief.md"), "# Hive Agent Brief\n");
  write(join(proj, "known-issues.md"), "# Known Issues\n");
  write(join(proj, "current-state.md"), "# Current State\n");
  write(join(proj, "lanes", "manager.md"), "# Manager Lane\n");
  write(join(proj, "scratch.md"), "# scratch\ntodo\n");
  const old = new Date(Date.now() - 200 * 86_400_000);
  utimesSync(join(proj, "current-state.md"), old, old);

  const { base, headers } = await startServer(t);

  const projectsRes = await fetch(`${base}/brain/projects`, { headers });
  assert.equal(projectsRes.status, 200);
  const projectsBody = await projectsRes.json() as { projects: Array<{ slug: string; docCount: number }> };
  const hive = projectsBody.projects.find((p) => p.slug === "hive");
  assert.ok(hive, "hive project listed");
  assert.equal(hive!.docCount, 5);

  const docsRes = await fetch(`${base}/brain/docs?project=hive`, { headers });
  assert.equal(docsRes.status, 200);
  const docsBody = await docsRes.json() as { docs: Array<{ file: string; status: string }> };
  const byFile = new Map(docsBody.docs.map((d) => [d.file, d.status]));
  assert.equal(byFile.get("agent-brief.md"), "brief");
  assert.equal(byFile.get("known-issues.md"), "ctx");
  assert.equal(byFile.get("lanes/manager.md"), "ctx");
  assert.equal(byFile.get("current-state.md"), "stale");
  assert.equal(byFile.get("scratch.md"), "orphan", "not loaded, not indexed, not stale");

  const docRes = await fetch(`${base}/brain/doc?project=hive&file=${encodeURIComponent("agent-brief.md")}`, { headers });
  assert.equal(docRes.status, 200);
  const docBody = await docRes.json() as { content: string };
  assert.match(docBody.content, /Hive Agent Brief/);

  const missingRes = await fetch(`${base}/brain/doc?project=hive&file=nope.md`, { headers });
  assert.equal(missingRes.status, 404);

  const traversalRes = await fetch(`${base}/brain/doc?project=hive&file=${encodeURIComponent("../../../etc/passwd")}`, { headers });
  assert.equal(traversalRes.status, 404, "path traversal outside the project dir is rejected, not served");
});

test("POST /brain/doc/exclude toggles the exclusion flag and GET /brain/docs reflects it (reversible)", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write } = await import("node:fs");
  const brainRoot = join(process.env.HOME!, "brain");
  const proj = join(brainRoot, "projects", "hive");
  mkdir(proj, { recursive: true });
  mkdir(join(process.env.HOME!, ".hivematrix"), { recursive: true });
  write(join(process.env.HOME!, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: brainRoot } }));
  write(join(proj, "known-issues.md"), "# Known Issues\n");

  const { base, headers } = await startServer(t);

  const before = await fetch(`${base}/brain/docs?project=hive`, { headers });
  const beforeBody = await before.json() as { docs: Array<{ file: string; status: string; excluded: boolean }> };
  assert.equal(beforeBody.docs.find((d) => d.file === "known-issues.md")?.status, "ctx");

  const excludeRes = await fetch(`${base}/brain/doc/exclude`, {
    method: "POST", headers, body: JSON.stringify({ project: "hive", files: ["known-issues.md"], excluded: true }),
  });
  assert.equal(excludeRes.status, 200);
  const excludeBody = await excludeRes.json() as { ok: boolean; excluded: boolean };
  assert.deepEqual(excludeBody, { ok: true, project: "hive", files: ["known-issues.md"], excluded: true });

  const after = await fetch(`${base}/brain/docs?project=hive`, { headers });
  const afterBody = await after.json() as { docs: Array<{ file: string; status: string; excluded: boolean }> };
  const excludedDoc = afterBody.docs.find((d) => d.file === "known-issues.md");
  assert.equal(excludedDoc?.status, "excluded", "excluded overrides ctx in the precedence order");
  assert.equal(excludedDoc?.excluded, true);

  const restoreRes = await fetch(`${base}/brain/doc/exclude`, {
    method: "POST", headers, body: JSON.stringify({ project: "hive", files: ["known-issues.md"], excluded: false }),
  });
  assert.equal(restoreRes.status, 200);
  const restored = await fetch(`${base}/brain/docs?project=hive`, { headers });
  const restoredBody = await restored.json() as { docs: Array<{ file: string; status: string }> };
  assert.equal(restoredBody.docs.find((d) => d.file === "known-issues.md")?.status, "ctx", "un-excluding restores the underlying status");
});

test("POST /brain/doc/archive moves a doc out of the active set (and search); POST /brain/doc/restore reverses it", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write, existsSync } = await import("node:fs");
  const brainRoot = join(process.env.HOME!, "brain");
  const proj = join(brainRoot, "projects", "hive");
  mkdir(proj, { recursive: true });
  mkdir(join(process.env.HOME!, ".hivematrix"), { recursive: true });
  write(join(process.env.HOME!, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: brainRoot } }));
  write(join(proj, "agent-brief.md"), "# Hive Agent Brief — unique-archive-marker\n");

  const { base, headers } = await startServer(t);

  // Findable via search before archiving.
  const searchBefore = await fetch(`${base}/brain/search?q=unique-archive-marker`, { headers });
  const searchBeforeBody = await searchBefore.json() as { results?: unknown[]; hits?: unknown[] };
  const beforeHits = (searchBeforeBody.results ?? searchBeforeBody.hits ?? []) as unknown[];
  assert.ok(beforeHits.length > 0, "doc is keyword-searchable before archiving");

  const archiveRes = await fetch(`${base}/brain/doc/archive`, {
    method: "POST", headers, body: JSON.stringify({ project: "hive", files: ["agent-brief.md"] }),
  });
  assert.equal(archiveRes.status, 200);
  const archiveBody = await archiveRes.json() as { ok: boolean; results: Array<{ file: string; ok: boolean }> };
  assert.deepEqual(archiveBody, { ok: true, project: "hive", results: [{ file: "agent-brief.md", ok: true }] });
  assert.ok(!existsSync(join(proj, "agent-brief.md")));
  assert.ok(existsSync(join(proj, "_archived", "agent-brief.md")), "moved, not deleted");

  const docsAfterArchive = await fetch(`${base}/brain/docs?project=hive`, { headers });
  const docsAfterArchiveBody = await docsAfterArchive.json() as { docs: Array<{ file: string; archived: boolean }> };
  const briefRow = docsAfterArchiveBody.docs.find((d) => d.file === "agent-brief.md");
  assert.equal(briefRow?.archived, true);

  // No longer keyword-searchable once archived (unlike a mere exclude).
  const searchAfter = await fetch(`${base}/brain/search?q=unique-archive-marker`, { headers });
  const searchAfterBody = await searchAfter.json() as { results?: unknown[]; hits?: unknown[] };
  const afterHits = (searchAfterBody.results ?? searchAfterBody.hits ?? []) as unknown[];
  assert.equal(afterHits.length, 0, "archived doc drops out of search too");

  const restoreRes = await fetch(`${base}/brain/doc/restore`, {
    method: "POST", headers, body: JSON.stringify({ project: "hive", files: ["agent-brief.md"] }),
  });
  assert.equal(restoreRes.status, 200);
  assert.ok(existsSync(join(proj, "agent-brief.md")));
  assert.ok(!existsSync(join(proj, "_archived", "agent-brief.md")));

  const docsAfterRestore = await fetch(`${base}/brain/docs?project=hive`, { headers });
  const docsAfterRestoreBody = await docsAfterRestore.json() as { docs: Array<{ file: string; archived: boolean; status: string }> };
  const restoredRow = docsAfterRestoreBody.docs.find((d) => d.file === "agent-brief.md");
  assert.equal(restoredRow?.archived, false);
  assert.equal(restoredRow?.status, "brief");
});

test("POST /brain/doc/delete permanently removes an archived doc, but refuses to touch an active one", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write, existsSync } = await import("node:fs");
  const brainRoot = join(process.env.HOME!, "brain");
  const proj = join(brainRoot, "projects", "hive");
  mkdir(proj, { recursive: true });
  mkdir(join(process.env.HOME!, ".hivematrix"), { recursive: true });
  write(join(process.env.HOME!, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: brainRoot } }));
  write(join(proj, "known-issues.md"), "# Known Issues\n");

  const { base, headers } = await startServer(t);

  // Deleting a still-active (never-archived) doc must fail and leave it in place.
  const deleteActiveRes = await fetch(`${base}/brain/doc/delete`, {
    method: "POST", headers, body: JSON.stringify({ project: "hive", files: ["known-issues.md"] }),
  });
  const deleteActiveBody = await deleteActiveRes.json() as { ok: boolean };
  assert.equal(deleteActiveBody.ok, false);
  assert.ok(existsSync(join(proj, "known-issues.md")), "active doc survives an errant delete call");

  await fetch(`${base}/brain/doc/archive`, {
    method: "POST", headers, body: JSON.stringify({ project: "hive", files: ["known-issues.md"] }),
  });
  assert.ok(existsSync(join(proj, "_archived", "known-issues.md")));

  const deleteRes = await fetch(`${base}/brain/doc/delete`, {
    method: "POST", headers, body: JSON.stringify({ project: "hive", files: ["known-issues.md"] }),
  });
  assert.equal(deleteRes.status, 200);
  const deleteBody = await deleteRes.json() as { ok: boolean; results: Array<{ file: string; ok: boolean }> };
  assert.deepEqual(deleteBody, { ok: true, project: "hive", results: [{ file: "known-issues.md", ok: true }] });
  assert.ok(!existsSync(join(proj, "_archived", "known-issues.md")), "permanently gone");

  const docsAfter = await fetch(`${base}/brain/docs?project=hive`, { headers });
  const docsAfterBody = await docsAfter.json() as { docs: Array<{ file: string }> };
  assert.ok(!docsAfterBody.docs.some((d) => d.file === "known-issues.md"), "no longer listed at all");
});

test("Pinned 'Always loaded' pseudo-project: listed first, surfaces real CLAUDE.md content, and refuses mutation", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write } = await import("node:fs");
  mkdir(join(process.env.HOME!, ".claude"), { recursive: true });
  write(join(process.env.HOME!, ".claude", "CLAUDE.md"), "# Instructions\nBe concise.");

  const { base, headers } = await startServer(t);

  const projectsRes = await fetch(`${base}/brain/projects`, { headers });
  const projectsBody = await projectsRes.json() as { projects: Array<{ slug: string; label: string; docCount: number }> };
  assert.equal(projectsBody.projects[0].slug, "__pinned__", "pinned is always listed first");
  assert.equal(projectsBody.projects[0].docCount, 1);

  const docsRes = await fetch(`${base}/brain/docs?project=__pinned__`, { headers });
  const docsBody = await docsRes.json() as { docs: Array<{ file: string; status: string; badge: string }> };
  assert.equal(docsBody.docs.length, 1);
  assert.equal(docsBody.docs[0].file, "CLAUDE.md");
  assert.equal(docsBody.docs[0].status, "brief");

  const docRes = await fetch(`${base}/brain/doc?project=__pinned__&file=CLAUDE.md`, { headers });
  const docBody = await docRes.json() as { content: string };
  assert.match(docBody.content, /Be concise/);

  for (const path of ["/brain/doc/exclude", "/brain/doc/archive", "/brain/doc/restore", "/brain/doc/delete"]) {
    const r = await fetch(`${base}${path}`, {
      method: "POST", headers, body: JSON.stringify({ project: "__pinned__", files: ["CLAUDE.md"] }),
    });
    assert.equal(r.status, 400, `${path} must refuse the pinned pseudo-project`);
  }
});

test("A Brain project's docs include its matching code project's Claude Code config files (CLAUDE.md/settings.json/.mcp.json), read-only", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write } = await import("node:fs");
  const home = process.env.HOME!;
  const brainRoot = join(home, "brain");
  const proj = join(brainRoot, "projects", "hive");
  mkdir(proj, { recursive: true });
  mkdir(join(home, ".hivematrix"), { recursive: true });
  write(join(home, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: brainRoot } }));
  write(join(proj, "agent-brief.md"), "# Hive Agent Brief\n");

  // A matching code project named "hive" (git repo) with the three core files.
  const codeProj = join(home, "hive");
  mkdir(join(codeProj, ".git"), { recursive: true });
  write(join(codeProj, ".git", "HEAD"), "ref: refs/heads/main");
  write(join(codeProj, "package.json"), JSON.stringify({ name: "hive" }));
  write(join(codeProj, "CLAUDE.md"), "# Hive project instructions\nUnique marker text.");
  mkdir(join(codeProj, ".claude"), { recursive: true });
  write(join(codeProj, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
  write(join(codeProj, ".mcp.json"), JSON.stringify({ mcpServers: { canopy: { command: "canopy-mcp" } } }));

  const { discoverProjectsFresh } = await import("@/lib/routing/project-discovery");
  discoverProjectsFresh();

  const { base, headers } = await startServer(t);

  const docsRes = await fetch(`${base}/brain/docs?project=hive`, { headers });
  assert.equal(docsRes.status, 200);
  const docsBody = await docsRes.json() as { docs: Array<{ file: string; configFile?: boolean; status: string }> };
  const configDocs = docsBody.docs.filter((d) => d.configFile);
  assert.deepEqual(configDocs.map((d) => d.file).sort(), ["claude-code/.mcp.json", "claude-code/CLAUDE.md", "claude-code/settings.json"]);
  assert.ok(docsBody.docs.some((d) => d.file === "agent-brief.md"), "the project's own brain docs are still present");
  for (const d of configDocs) assert.equal(d.status, "brief");

  const claudeDocRes = await fetch(`${base}/brain/doc?project=hive&file=${encodeURIComponent("claude-code/CLAUDE.md")}`, { headers });
  assert.equal(claudeDocRes.status, 200);
  const claudeDocBody = await claudeDocRes.json() as { content: string };
  assert.match(claudeDocBody.content, /Unique marker text/);

  const mcpDocRes = await fetch(`${base}/brain/doc?project=hive&file=${encodeURIComponent("claude-code/.mcp.json")}`, { headers });
  const mcpDocBody = await mcpDocRes.json() as { content: string };
  assert.match(mcpDocBody.content, /canopy/);

  for (const path of ["/brain/doc/exclude", "/brain/doc/archive", "/brain/doc/restore", "/brain/doc/delete"]) {
    const r = await fetch(`${base}${path}`, {
      method: "POST", headers, body: JSON.stringify({ project: "hive", files: ["claude-code/CLAUDE.md"] }),
    });
    assert.equal(r.status, 400, `${path} must refuse a Claude Code config file`);
  }
});

test("GET /agents/profiles lists the roster without leaking systemPrompt", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/agents/profiles`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { profiles: Array<Record<string, unknown>> };
  assert.ok(Array.isArray(body.profiles) && body.profiles.length > 0);
  for (const p of body.profiles) {
    assert.equal(p.systemPrompt, undefined, `${p.id} must not leak systemPrompt over the list route`);
    assert.equal(typeof p.id, "string");
    assert.equal(typeof p.name, "string");
    assert.equal(typeof p.promptLines, "number");
    assert.equal(typeof p.isCustom, "boolean");
    assert.ok(["core", "coordinator", "domain"].includes(p.tier as string), `${p.id} has an unexpected tier: ${p.tier}`);
  }
  const developer = body.profiles.find((p) => p.id === "developer");
  assert.equal(developer?.modelRole, "coding");
  assert.equal(developer?.isCustom, false);
  assert.equal(developer?.tier, "core");

  // Phase 4 (roster reduction) + Spec 3 Phase 4 (coo promoted to core once
  // it can read back its own delegated children's results): the wire shape
  // the New Task role picker's Domain optgroup depends on.
  assert.equal(body.profiles.length, 9, "14 → 9 after cutting ceo/cto/cfo/analyst/inventor");
  assert.equal(body.profiles.filter((p) => p.tier === "core").length, 8);
  assert.equal(body.profiles.filter((p) => p.tier === "coordinator").length, 0);
  assert.equal(body.profiles.filter((p) => p.tier === "domain").length, 1);
  assert.equal(body.profiles.find((p) => p.id === "coo")?.tier, "core");
  assert.equal(body.profiles.find((p) => p.id === "trader")?.tier, "domain");
  assert.equal(body.profiles.find((p) => p.id === "cto"), undefined, "cut ids must not appear in the live roster");
});

test("GET /agents/profiles/:id returns the full profile INCLUDING systemPrompt (the roles screen's prompt viewer)", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/agents/profiles/designer`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.id, "designer");
  assert.equal(typeof body.systemPrompt, "string");
  assert.ok((body.systemPrompt as string).length > 500, "designer's real 58-line prompt, not a stub");
  assert.equal(body.tier, "core");
  assert.equal(body.isCustom, false);
});

test("GET /agents/profiles/:id resolves a legacy/cut id through its alias (e.g. cto → developer), same as the scheduler", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/agents/profiles/cto`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.id, "developer", "cto is cut and aliases to developer — getAgentProfile resolves it, not a 404");
});

test("GET /agents/profiles/:id rejects a malformed id (path-injection defense-in-depth ahead of Phase 2's file-writing routes)", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  for (const bad of ["../../etc/passwd", "..%2f..%2fetc", "UPPERCASE", "has spaces", "semi;colon"]) {
    const res = await fetch(`${base}/agents/profiles/${encodeURIComponent(bad)}`, { headers });
    assert.equal(res.status, 400, `"${bad}" should be rejected`);
  }
});

test("GET /agents/profiles/:id/stats returns real, honest zeros for a role that has never run", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/agents/profiles/designer/stats`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.totalRuns, 0);
  assert.equal(body.successRate, null);
  assert.equal(body.lastRunAt, null);
});

test("GET /agents/profiles/:id/stats reflects real task history for that role", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, Task } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  await Task.create({ title: "t1", description: "d", project: "p", projectPath: "/tmp/p", status: "archived", agentType: "qa" });
  await Task.create({ title: "t2", description: "d", project: "p", projectPath: "/tmp/p", status: "review", agentType: "qa" });
  await Task.create({ title: "t3", description: "d", project: "p", projectPath: "/tmp/p", status: "archived", agentType: "developer" });

  const res = await fetch(`${base}/agents/profiles/qa/stats`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.totalRuns, 2, "only qa-agentType tasks are counted, not developer's");
});

test("GET /agents/profiles/:id/skills is honest when no skills exist yet", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/agents/profiles/qa/skills`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { skills: unknown[] };
  assert.deepEqual(body.skills, []);
});

test("GET /agents/profiles/:id/skills: an untagged skill is visible to every role, a roles:['qa'] skill only to qa", async (t) => {
  withTempHome(t);
  const { mkdirSync: mkdir, writeFileSync: write } = await import("node:fs");
  const brainRoot = join(process.env.HOME!, "brain");
  mkdir(join(brainRoot, "skills"), { recursive: true });
  mkdir(join(process.env.HOME!, ".hivematrix"), { recursive: true });
  write(join(process.env.HOME!, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: brainRoot } }));
  write(join(brainRoot, "skills", "universal-recipe.md"), "---\nname: universal-recipe\ndescription: applies everywhere\n---\n\nDo the thing.\n");
  write(join(brainRoot, "skills", "qa-regression.md"), "---\nname: qa-regression\ndescription: run before ship\nroles: qa\n---\n\nRun the suite.\n");

  const { base, headers } = await startServer(t);

  const qaRes = await fetch(`${base}/agents/profiles/qa/skills`, { headers });
  const qaBody = await qaRes.json() as { skills: Array<{ name: string }> };
  assert.ok(qaBody.skills.some((s) => s.name === "universal-recipe"));
  assert.ok(qaBody.skills.some((s) => s.name === "qa-regression"));

  const founderRes = await fetch(`${base}/agents/profiles/founder/skills`, { headers });
  const founderBody = await founderRes.json() as { skills: Array<{ name: string }> };
  assert.ok(founderBody.skills.some((s) => s.name === "universal-recipe"), "untagged skill visible to founder too");
  assert.ok(!founderBody.skills.some((s) => s.name === "qa-regression"), "qa-only skill hidden from founder");
});

test("PUT /agents/profiles/:id creates a custom override that GET immediately reflects — no daemon restart", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const put = await fetch(`${base}/agents/profiles/founder`, {
    method: "PUT", headers,
    body: JSON.stringify({ systemPrompt: "A custom founder prompt.", tools: ["bash", "read_file"] }),
  });
  assert.equal(put.status, 200);

  const get = await fetch(`${base}/agents/profiles/founder`, { headers });
  const body = await get.json() as Record<string, unknown>;
  assert.equal(body.systemPrompt, "A custom founder prompt.");
  assert.equal(body.isCustom, true);

  const list = await fetch(`${base}/agents/profiles`, { headers });
  const listBody = await list.json() as { profiles: Array<{ id: string; isCustom: boolean }> };
  assert.equal(listBody.profiles.find((p) => p.id === "founder")?.isCustom, true);
});

test("PUT /agents/profiles/:id rejects an unknown tool name — a typo must fail loudly at save, not silently disarm the agent", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/agents/profiles/founder`, {
    method: "PUT", headers,
    body: JSON.stringify({ systemPrompt: "x", tools: ["bash", "read_fiel"] }), // typo
  });
  assert.equal(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assert.match(body.error as string, /read_fiel/);
});

test("PUT /agents/profiles/:id rejects an empty systemPrompt and a malformed id", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const emptyPrompt = await fetch(`${base}/agents/profiles/founder`, {
    method: "PUT", headers, body: JSON.stringify({ systemPrompt: "   " }),
  });
  assert.equal(emptyPrompt.status, 400);

  const badId = await fetch(`${base}/agents/profiles/${encodeURIComponent("../escape")}`, {
    method: "PUT", headers, body: JSON.stringify({ systemPrompt: "x" }),
  });
  assert.equal(badId.status, 400);
});

test("DELETE /agents/profiles/:id removes a custom override and reverts GET to the real built-in", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  await fetch(`${base}/agents/profiles/qa`, { method: "PUT", headers, body: JSON.stringify({ systemPrompt: "Custom QA." }) });
  let get = await fetch(`${base}/agents/profiles/qa`, { headers });
  assert.equal((await get.json() as Record<string, unknown>).systemPrompt, "Custom QA.");

  const del = await fetch(`${base}/agents/profiles/qa`, { method: "DELETE", headers });
  assert.equal(del.status, 200);

  get = await fetch(`${base}/agents/profiles/qa`, { headers });
  const body = await get.json() as Record<string, unknown>;
  assert.notEqual(body.systemPrompt, "Custom QA.");
  assert.equal(body.isCustom, false);
});

test("DELETE /agents/profiles/:id returns 404 when there is no custom override to remove", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/agents/profiles/developer`, { method: "DELETE", headers });
  assert.equal(res.status, 404);
});

test("POST /tasks persists an explicit agentType (the New Task role picker's contract)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "Design the new pricing page layout.", agentType: "designer", route: "normal", project: "hivematrix", projectPath: "/tmp/hivematrix" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.agentType, "designer");
});

test("GET /tasks enriches coordinator rows with distinct childAgentTypes — one grouped query, plural role pills on the board", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, Task } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const parent = await Task.create({ title: "Coordinate the launch", description: "d", project: "p", projectPath: "/tmp/p", status: "backlog", agentType: "coo" });
  await Task.create({ title: "child 1", description: "d", project: "p", projectPath: "/tmp/p", status: "review", agentType: "designer", parentTaskId: parent._id });
  await Task.create({ title: "child 2 (archived)", description: "d", project: "p", projectPath: "/tmp/p", status: "archived", agentType: "qa", parentTaskId: parent._id });
  await Task.create({ title: "child 3 (auto, ignored)", description: "d", project: "p", projectPath: "/tmp/p", status: "backlog", agentType: "auto", parentTaskId: parent._id });
  await Task.create({ title: "unrelated top-level", description: "d", project: "p", projectPath: "/tmp/p", status: "backlog", agentType: "developer" });

  const res = await fetch(`${base}/tasks`, { headers });
  const rows = await res.json() as Array<Record<string, unknown>>;
  const parentRow = rows.find((r) => r._id === parent._id);
  assert.ok(parentRow);
  assert.deepEqual(new Set(parentRow!.childAgentTypes as string[]), new Set(["designer", "qa"]), "includes the archived child; excludes the auto one");

  const unrelated = rows.find((r) => r.title === "unrelated top-level");
  assert.equal(unrelated!.childAgentTypes, undefined, "a task with no children carries no childAgentTypes field");
});

test("GET /tasks?parentTaskId=X includes archived children (a subtask auto-archives on success) unlike the board's default archived exclusion", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, Task } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const parent = await Task.create({ title: "parent", description: "d", project: "p", projectPath: "/tmp/p", status: "backlog" });
  await Task.create({ title: "archived child", description: "d", project: "p", projectPath: "/tmp/p", status: "archived", parentTaskId: parent._id });

  const res = await fetch(`${base}/tasks?parentTaskId=${parent._id}`, { headers });
  const rows = await res.json() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "archived");
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

// --- POST /remote/tailscale/enabled, POST /remote/cloudflare/enabled ---
//
// The route handlers shell out to real `tailscale`/`cloudflared` binaries.
// Status reads (`tailscale status --json`, `tailscale serve status --json`)
// are read-only and safe to let run for real even in CI. But START/STOP calls
// mutate real system state (or, for cloudflared, open a real network
// connection to Cloudflare) — those are swapped for stubs via the modules'
// test-only DI seams (_setTailscaleServeDepsForTests / _setCloudflaredDepsForTests),
// the same pattern as _setMailbeeStatusDepsForTests.

test("POST /remote/tailscale/enabled: a failed serve start returns 500 and does NOT persist tailscaleEnabled", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  const { _setTailscaleServeDepsForTests } = await import("@/lib/tunnel/tailscale");
  const { readRemoteAccessSettings } = await import("@/lib/tunnel/remote-access-settings");
  _setTailscaleServeDepsForTests({ start: () => ({ ok: false, error: "tailnet HTTPS certs not enabled" }) });
  t.after(() => _setTailscaleServeDepsForTests(null));

  const res = await fetch(`${base}/remote/tailscale/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(res.status, 500);
  const body = await res.json() as Record<string, unknown>;
  assert.match(String(body.error), /tailnet HTTPS certs not enabled/);

  // A switch that reports ON while serve failed would be a lie — the failure
  // must not persist.
  assert.notEqual(readRemoteAccessSettings().tailscaleEnabled, true);
});

test("POST /remote/tailscale/enabled: a successful serve start persists tailscaleEnabled and returns tailscale status", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  const { _setTailscaleServeDepsForTests } = await import("@/lib/tunnel/tailscale");
  const { readRemoteAccessSettings } = await import("@/lib/tunnel/remote-access-settings");
  let startCalledWithPort: number | null = null;
  _setTailscaleServeDepsForTests({ start: (port: number) => { startCalledWithPort = port; return { ok: true }; } });
  t.after(() => _setTailscaleServeDepsForTests(null));

  const res = await fetch(`${base}/remote/tailscale/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(body.tailscale, "response includes a tailscale status object");
  assert.equal(startCalledWithPort, 3747);
  assert.equal(readRemoteAccessSettings().tailscaleEnabled, true);
});

test("POST /remote/tailscale/enabled: disabling calls stop and persists tailscaleEnabled: false", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  const { _setTailscaleServeDepsForTests } = await import("@/lib/tunnel/tailscale");
  const { mergeRemoteAccessSettings, readRemoteAccessSettings } = await import("@/lib/tunnel/remote-access-settings");
  mergeRemoteAccessSettings({ tailscaleEnabled: true });
  let stopCalled = false;
  _setTailscaleServeDepsForTests({ stop: () => { stopCalled = true; return { ok: true }; } });
  t.after(() => _setTailscaleServeDepsForTests(null));

  const res = await fetch(`${base}/remote/tailscale/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: false }),
  });
  assert.equal(res.status, 200);
  assert.equal(stopCalled, true);
  // `false` must survive the persistence layer's truthiness trap.
  assert.equal(readRemoteAccessSettings().tailscaleEnabled, false);
});

test("POST /remote/cloudflare/enabled: enabling without a saved hostname is rejected", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/remote/cloudflare/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assert.match(String(body.error), /hostname/i);
});

test("POST /remote/cloudflare/enabled: with a hostname and no connector token, adopts an external connector", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  await fetch(`${base}/tunnel/configure-named`, {
    method: "POST", headers, body: JSON.stringify({ hostname: "hivey.cassio.io" }),
  });

  const res = await fetch(`${base}/remote/cloudflare/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.mode, "named");
  assert.equal(body.owner, "configured");
  assert.equal(body.running, true);
  assert.equal(body.cloudflareEnabled, true);
});

test("POST /remote/cloudflare/enabled: with a connector token, starts the named tunnel and saves the token", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  const { _setCloudflaredDepsForTests } = await import("@/lib/tunnel/cloudflared");
  let calledWith: { token: string; hostname: string } | null = null;
  _setCloudflaredDepsForTests({
    startNamedTunnel: async (connectorToken: string, hostname: string) => {
      calledWith = { token: connectorToken, hostname };
      return hostname;
    },
  });
  t.after(() => _setCloudflaredDepsForTests(null));

  await fetch(`${base}/tunnel/configure-named`, {
    method: "POST", headers, body: JSON.stringify({ hostname: "hivey.cassio.io" }),
  });
  const res = await fetch(`${base}/remote/cloudflare/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true, connectorToken: "connector-token-abc" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.cloudflareEnabled, true);
  assert.equal(body.connectorTokenSaved, true);
  const called = calledWith as { token: string; hostname: string } | null;
  assert.ok(called, "startNamedTunnel must be called");
  assert.equal(called!.token, "connector-token-abc");
  assert.equal(called!.hostname, "https://hivey.cassio.io");
});

test("POST /remote/cloudflare/enabled: a failed connector start returns 500 and does NOT persist cloudflareEnabled", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  const { _setCloudflaredDepsForTests } = await import("@/lib/tunnel/cloudflared");
  const { readRemoteAccessSettings } = await import("@/lib/tunnel/remote-access-settings");
  _setCloudflaredDepsForTests({
    startNamedTunnel: async () => { throw new Error("connector auth rejected"); },
  });
  t.after(() => _setCloudflaredDepsForTests(null));

  await fetch(`${base}/tunnel/configure-named`, {
    method: "POST", headers, body: JSON.stringify({ hostname: "hivey.cassio.io" }),
  });
  const res = await fetch(`${base}/remote/cloudflare/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true, connectorToken: "bad-token" }),
  });
  assert.equal(res.status, 500);
  const body = await res.json() as Record<string, unknown>;
  assert.match(String(body.error), /connector auth rejected/);
  assert.notEqual(readRemoteAccessSettings().cloudflareEnabled, true);
});

test("POST /remote/cloudflare/enabled: disabling an externally-adopted (not-owned) tunnel leaves it configured, not torn down", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  await fetch(`${base}/tunnel/configure-named`, {
    method: "POST", headers, body: JSON.stringify({ hostname: "hivey.cassio.io" }),
  });
  await fetch(`${base}/remote/cloudflare/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true }),
  });
  const before = await (await fetch(`${base}/tunnel`, { headers })).json() as Record<string, unknown>;
  assert.equal(before.canStop, false, "an adopted, not-HiveMatrix-owned connector must not be stoppable");

  const res = await fetch(`${base}/remote/cloudflare/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: false }),
  });
  assert.equal(res.status, 200);
  const after = await res.json() as Record<string, unknown>;
  assert.equal(after.cloudflareEnabled, false);
  assert.equal(after.running, false);
  // The external connector's own config survives — HiveMatrix never touched
  // it (canStop was false), only its own "am I using this" flag flipped.
  assert.equal(after.mode, "named");
  assert.equal(after.owner, "configured");
  assert.equal(after.url, "https://hivey.cassio.io");
});

test("POST /remote/cloudflare/enabled: an empty connectorToken clears a previously-saved one", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  const { _setCloudflaredDepsForTests } = await import("@/lib/tunnel/cloudflared");
  _setCloudflaredDepsForTests({ startNamedTunnel: async (_token: string, hostname: string) => hostname });
  t.after(() => _setCloudflaredDepsForTests(null));

  await fetch(`${base}/tunnel/configure-named`, {
    method: "POST", headers, body: JSON.stringify({ hostname: "hivey.cassio.io" }),
  });
  await fetch(`${base}/remote/cloudflare/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: true, connectorToken: "some-token" }),
  });
  const midway = await (await fetch(`${base}/tunnel`, { headers })).json() as Record<string, unknown>;
  assert.equal(midway.connectorTokenSaved, true);

  await fetch(`${base}/remote/cloudflare/enabled`, {
    method: "POST", headers, body: JSON.stringify({ enabled: false, connectorToken: "" }),
  });
  const after = await (await fetch(`${base}/tunnel`, { headers })).json() as Record<string, unknown>;
  assert.equal(after.connectorTokenSaved, false);
});

test("POST /tunnel/start-named (deprecated shim) still works for pre-2026-07-09 iOS builds", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  const { _setCloudflaredDepsForTests } = await import("@/lib/tunnel/cloudflared");
  _setCloudflaredDepsForTests({ startNamedTunnel: async (_token: string, hostname: string) => hostname });
  t.after(() => _setCloudflaredDepsForTests(null));

  const res = await fetch(`${base}/tunnel/start-named`, {
    method: "POST", headers, body: JSON.stringify({ connectorToken: "tok", hostname: "hivey.cassio.io" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.mode, "named");
  assert.equal(body.cloudflareEnabled, true);
});

test("GET /tunnel/start is gone — the quick tunnel route no longer exists", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  const res = await fetch(`${base}/tunnel/start`, { method: "POST", headers });
  assert.equal(res.status, 404);
});

test("GET /tunnel/qr: the companion_pairing license gate still runs first (unchanged by the Tailscale switch)", async (t) => {
  withTempHome(t);
  const { base, headers } = await startServer(t);
  // A fresh temp HOME has no license.json → Free tier → the Pro gate blocks
  // before the route ever reads Tailscale state. This proves the gate check
  // still comes first; the Tailscale-enabled/serving guard behind it is
  // covered at the unit level (parseServeStatusJSON / parseTailscaleStatusJSON
  // in tailscale.test.ts) since exercising it here would require a signed Pro
  // license fixture.
  const res = await fetch(`${base}/tunnel/qr`, { headers });
  assert.equal(res.status, 403);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.upgradeRequired, true);
});
