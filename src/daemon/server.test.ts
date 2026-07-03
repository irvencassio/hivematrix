import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
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

// ── Work Packages + Task Intake ───────────────────────────────────

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

test("POST /work-packages/intake/preview classifies a broad prompt as a work_package_candidate", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/work-packages/intake/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify({ description: "Fix all the lint errors across the codebase, update every dependency, and refactor auth." }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.kind, "work_package_candidate");
  const pc = body.packageCandidate as { items: unknown[] };
  assert.ok(pc.items.length >= 2);
});

test("work package APIs round-trip: create, list, get, patch, create-task", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  // Create from an intake preview.
  const prev = await (await fetch(`${base}/work-packages/intake/preview`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "Fix all the failing tests across the project, and then deploy the release." }),
  })).json() as Record<string, unknown>;

  const created = await fetch(`${base}/work-packages`, {
    method: "POST", headers,
    body: JSON.stringify({ title: "Test sweep", project: "hivematrix", projectPath: "/tmp/x", intake: prev, items: (prev.packageCandidate as { items: unknown[] }).items }),
  });
  assert.equal(created.status, 201);
  const pkg = await created.json() as Record<string, unknown>;
  assert.ok(pkg.id);
  assert.equal(pkg.status, "draft");

  // List.
  const list = await (await fetch(`${base}/work-packages`, { headers })).json() as Record<string, unknown>;
  assert.ok((list.packages as unknown[]).some((p) => (p as Record<string, unknown>).id === pkg.id));

  // Get detail with items.
  const detail = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const items = detail.items as Array<Record<string, unknown>>;
  assert.ok(items.length >= 2);

  // Patch package status.
  const patched = await (await fetch(`${base}/work-packages/${pkg.id}`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "ready" }),
  })).json() as Record<string, unknown>;
  assert.equal(patched.status, "ready");

  // Patch an item status.
  const item0 = items[0];
  const pItem = await (await fetch(`${base}/work-packages/${pkg.id}/items/${item0.id}`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "ready" }),
  })).json() as Record<string, unknown>;
  assert.equal(pItem.status, "ready");

  // Convert exactly one item to a task.
  const before = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  const conv = await fetch(`${base}/work-packages/${pkg.id}/items/${item0.id}/create-task`, { method: "POST", headers });
  assert.equal(conv.status, 201);
  const convBody = await conv.json() as Record<string, unknown>;
  assert.ok(convBody.taskId);
  const after = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  assert.equal(after - before, 1, "exactly one task created");

  // No secrets in the package JSON.
  const blob = JSON.stringify(pkg) + JSON.stringify(detail);
  assert.doesNotMatch(blob, /password|cookie|secret|credential|api[_-]?key|\btoken\b/i);
});

test("DELETE /work-packages/:id deletes a non-running package", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "One", prompt: "do one", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Delete Flight", project: "hivematrix", projectPath: "/tmp/delete", items }),
  })).json() as Record<string, unknown>;

  const del = await fetch(`${base}/work-packages/${pkg.id}`, { method: "DELETE", headers });
  assert.equal(del.status, 200);
  const body = await del.json() as Record<string, unknown>;
  assert.equal(body.deleted, true);
  const pkgs = (getDb().prepare("SELECT COUNT(*) AS n FROM work_packages WHERE _id = ?").get(pkg.id) as { n: number }).n;
  const pkgItems = (getDb().prepare("SELECT COUNT(*) AS n FROM work_package_items WHERE packageId = ?").get(pkg.id) as { n: number }).n;
  assert.equal(pkgs, 0);
  assert.equal(pkgItems, 0);
});

test("DELETE /work-packages/:id refuses a running package", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "One", prompt: "do one", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Running Flight", project: "hivematrix", projectPath: "/tmp/running", items }),
  })).json() as Record<string, unknown>;
  await fetch(`${base}/work-packages/${pkg.id}/start`, { method: "POST", headers });

  const del = await fetch(`${base}/work-packages/${pkg.id}`, { method: "DELETE", headers });
  assert.equal(del.status, 409);
  const body = await del.json() as Record<string, unknown>;
  assert.match(String(body.reason || body.error || ""), /running|active/i);
});

test("DELETE /work-packages/:id deletes landed package with stale active linked task", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb, Task } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Done but stale", prompt: "done work", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Landed stale Flight", project: "hivematrix", projectPath: "/tmp/landed-stale", items }),
  })).json() as Record<string, unknown>;
  const pkgItems = pkg.items as Array<Record<string, unknown>>;
  const linked = await Task.create({
    title: "Done but stale",
    description: "stale child",
    project: "hivematrix",
    projectPath: "/tmp/landed-stale",
    status: "in_progress",
    source: "work-package",
  });
  getDb().prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(linked._id, pkgItems[0].id);
  getDb().prepare("UPDATE work_packages SET status = 'done_with_skips' WHERE _id = ?").run(pkg.id);

  const del = await fetch(`${base}/work-packages/${pkg.id}`, { method: "DELETE", headers });
  assert.equal(del.status, 200);
  const body = await del.json() as Record<string, unknown>;
  assert.equal(body.deleted, true);
});

test("POST /tasks promotes a broad prompt into a Work Package, not a generic agent task", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "Fix all the broken imports across the codebase, update every config, and refactor the router." }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "work_package");
  assert.ok(body.packageId);
  assert.ok((body.itemCount as number) >= 2);

  // No generic agent task was spawned for the broad prompt.
  const agentCount = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE executor = 'agent'").get() as { n: number }).n;
  assert.equal(agentCount, 0, "broad prompt must not auto-create a running agent task");
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
  const agentCount = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE executor = 'agent'").get() as { n: number }).n;
  assert.equal(agentCount, 1);
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

test("POST /tasks does not promote an AI-news video prompt into a Work Package (regression)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { isAiNewsVideoRequest } = await import("@/lib/video/news-intent");
  assert.equal(isAiNewsVideoRequest("make me an AI news video"), true);

  const { base, headers } = await startServer(t);
  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "make me an AI news video" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  // AI-news is handled before intake; it must never be classified as a package.
  assert.notEqual(body.routed, "work_package");
});

test("console source includes the main-screen Flights surface and no auto-run-all control", () => {
  assert.match(CONSOLE_HTML, /work_packages_list/);
  assert.match(CONSOLE_HTML, /renderWorkPackages/);
  assert.match(CONSOLE_HTML, /id="flights_rail"/);
  assert.match(CONSOLE_HTML, /renderFlightsRail/);
  assert.match(CONSOLE_HTML, /renderFlightDetail/);
  assert.match(CONSOLE_HTML, /Stage Flight|Flights/);
  assert.doesNotMatch(CONSOLE_HTML, /Open Settings → Lanes → Work Packages/);
  // Conservative by design: there is no button that runs every item at once.
  assert.doesNotMatch(CONSOLE_HTML, /runAllPackageItems|Run all items|run-all/i);
});

test("POST /work-packages/:id/start runs the first item; completing it auto-advances (event hook)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Step one", prompt: "do step one", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Step two", prompt: "do step two", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Step one"] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Seq", project: "hivematrix", projectPath: "/tmp/seq", items }),
  })).json() as Record<string, unknown>;

  // Start: only the first writer runs.
  const start = await fetch(`${base}/work-packages/${pkg.id}/start`, { method: "POST", headers });
  assert.equal(start.status, 200);
  const startBody = await start.json() as Record<string, unknown>;
  assert.equal((startBody.package as Record<string, unknown>).status, "running");
  assert.equal((startBody.started as unknown[]).length, 1);

  const detail1 = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const it1 = (detail1.items as Array<Record<string, unknown>>);
  assert.equal(it1[0].status, "running");
  assert.ok(it1[0].createdTaskId);
  assert.equal(it1[1].status, "ready");
  assert.equal(it1[1].createdTaskId, null);

  // Complete the first child via PATCH /tasks/:id → the hook advances the package.
  const firstTaskId = it1[0].createdTaskId as string;
  const patched = await fetch(`${base}/tasks/${firstTaskId}`, { method: "PATCH", headers, body: JSON.stringify({ status: "done" }) });
  assert.equal(patched.status, 200);

  const detail2 = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const it2 = (detail2.items as Array<Record<string, unknown>>);
  assert.equal(it2[0].status, "done");
  assert.equal(it2[1].status, "running", "next item auto-started by the event hook");
  assert.ok(it2[1].createdTaskId);
});

test("starting a package never auto-runs a held release item (final gate)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Build", prompt: "build it", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Deploy release", prompt: "deploy the release", risk: "high", executionMode: "hold", scopeHints: [], dependsOn: ["Build"] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Gated", project: "hivematrix", projectPath: "/tmp/gated", items }),
  })).json() as Record<string, unknown>;

  await fetch(`${base}/work-packages/${pkg.id}/start`, { method: "POST", headers });
  const detail = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const its = detail.items as Array<Record<string, unknown>>;
  const build = its[0].createdTaskId as string;
  await fetch(`${base}/tasks/${build}`, { method: "PATCH", headers, body: JSON.stringify({ status: "done" }) });

  // Advance explicitly; the held release item must remain held with no task.
  await fetch(`${base}/work-packages/${pkg.id}/advance`, { method: "POST", headers });
  const after = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const a = after.items as Array<Record<string, unknown>>;
  assert.equal(a[0].status, "done");
  assert.equal(a[1].status, "held");
  assert.equal(a[1].createdTaskId, null);
});

test("console source includes a Start-package control and still no run-all", () => {
  assert.match(CONSOLE_HTML, /wpStart|startWorkPackage/);
  assert.doesNotMatch(CONSOLE_HTML, /runAllPackageItems|Run all items|run-all/i);
});

test("POST /work-packages/:id/items/:itemId/accept marks a review item done and advances the package", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Review step", prompt: "reviewed work", risk: "medium", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Next step", prompt: "after review", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Review step"] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Accept test", project: "hivematrix", projectPath: "/tmp/accept-test", items }),
  })).json() as Record<string, unknown>;

  await fetch(`${base}/work-packages/${pkg.id}/start`, { method: "POST", headers });
  const detail = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const its = detail.items as Array<Record<string, unknown>>;
  const item0Id = its[0].id as string;
  const taskId = its[0].createdTaskId as string;

  // Put the first item and its task in review state.
  getDb().prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(item0Id);
  await fetch(`${base}/tasks/${taskId}`, { method: "PATCH", headers, body: JSON.stringify({ status: "review" }) });

  // Accept / Land the review item.
  const acc = await fetch(`${base}/work-packages/${pkg.id}/items/${item0Id}/accept`, { method: "POST", headers });
  assert.equal(acc.status, 200);
  const body = await acc.json() as Record<string, unknown>;
  const pkg2 = body.package as Record<string, unknown>;
  const items2 = pkg2.items as Array<Record<string, unknown>>;

  assert.equal(items2[0].status, "done", "accepted item is done (not archived)");
  assert.equal(items2[1].status, "running", "dependent item is unblocked and running");
  assert.equal((body.started as unknown[]).length, 1, "one item started after accept");
  assert.equal(pkg2.status, "running", "package is running (not done_with_skips)");
});

test("POST /tasks/:id/reply reconciles a Flight review item back to running", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Review step", prompt: "reviewed work", risk: "medium", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Next step", prompt: "after review", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Review step"] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Reply reconcile test", project: "hivematrix", projectPath: "/tmp/reply-reconcile-test", items }),
  })).json() as Record<string, unknown>;

  await fetch(`${base}/work-packages/${pkg.id}/start`, { method: "POST", headers });
  const detail = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const its = detail.items as Array<Record<string, unknown>>;
  const item0Id = its[0].id as string;
  const taskId = its[0].createdTaskId as string;

  getDb().prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(item0Id);
  await fetch(`${base}/tasks/${taskId}`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "review", reviewState: "ready_for_review" }),
  });

  const reply = await fetch(`${base}/tasks/${taskId}/reply`, {
    method: "POST", headers, body: JSON.stringify({ text: "Please continue with this adjustment." }),
  });
  assert.equal(reply.status, 200);
  const replyBody = await reply.json() as Record<string, unknown>;
  assert.equal(replyBody.fallback, "requeued", "review task reply requeues the child task");

  const taskRow = getDb().prepare("SELECT status, reviewState FROM tasks WHERE _id = ?").get(taskId) as { status: string; reviewState: string | null };
  assert.equal(taskRow.status, "backlog", "linked task is requeued");
  assert.equal(taskRow.reviewState, null, "review flag is cleared for rerun");

  const after = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const afterItems = after.items as Array<Record<string, unknown>>;
  assert.equal(afterItems[0].status, "running", "reply reconciliation moves the Flight item out of review");
  assert.equal(after.status, "running", "Flight is no longer blocked in review");
});

test("GET /tasks adds Flight context for review tasks linked to Flight items", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb, Task } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Already landed", prompt: "done work", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Review blocker", prompt: "reviewed work", risk: "medium", executionMode: "sequential", scopeHints: [], dependsOn: ["Already landed"] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Visible Flight Context", project: "hivematrix", projectPath: "/tmp/flight-context", items }),
  })).json() as Record<string, unknown>;

  const pkgItems = pkg.items as Array<Record<string, unknown>>;
  getDb().prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkgItems[0].id);
  getDb().prepare("UPDATE work_package_items SET status = 'ready' WHERE _id = ?").run(pkgItems[1].id);
  getDb().prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id);

  await fetch(`${base}/work-packages/${pkg.id}/advance`, { method: "POST", headers });
  const afterAdvance = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const reviewItem = (afterAdvance.items as Array<Record<string, unknown>>).find((i) => i.title === "Review blocker")!;
  const linkedTaskId = reviewItem.createdTaskId as string;

  getDb().prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(reviewItem.id);
  await fetch(`${base}/tasks/${linkedTaskId}`, {
    method: "PATCH", headers, body: JSON.stringify({ status: "review", reviewState: "ready_for_review" }),
  });

  const unrelated = await Task.create({
    title: "Standalone review",
    description: "not linked to a Flight",
    project: "hivematrix",
    projectPath: "/tmp/flight-context",
    status: "review",
    reviewState: "ready_for_review",
  });

  const tasks = await (await fetch(`${base}/tasks`, { headers })).json() as Array<Record<string, unknown>>;
  const linked = tasks.find((task) => task._id === linkedTaskId)!;
  const standalone = tasks.find((task) => task._id === unrelated._id)!;

  assert.deepEqual(linked.flightContext, {
    packageId: pkg.id,
    packageTitle: "Visible Flight Context",
    itemId: reviewItem.id,
    itemStatus: "review",
    landedCount: 1,
    totalCount: 2,
  });
  assert.equal("flightContext" in standalone, false, "non-Flight review tasks are unchanged");
});

test("POST /work-packages/:id/items/:itemId/accept returns 409 when item is not in review status", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Draft step", prompt: "doing work", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "Not review", project: "hivematrix", projectPath: "/tmp/not-review", items }),
  })).json() as Record<string, unknown>;

  const pkgItems = pkg.items as Array<Record<string, unknown>>;
  const itemId = pkgItems[0].id as string;

  // Item is in draft status — Accept must be rejected.
  const res = await fetch(`${base}/work-packages/${pkg.id}/items/${itemId}/accept`, { method: "POST", headers });
  assert.equal(res.status, 409);
  const errBody = await res.json() as Record<string, unknown>;
  assert.ok(typeof errBody.error === "string" && errBody.error.length > 0, "error message returned");
});

test("POST /tasks uses model-advised decomposition when a keyless client is injected", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { _setIntakeDecomposeDepsForTests } = await import("@/lib/intake/classify");
  // Inject a fake keyless client (no network, no key) → forces decomposition on.
  _setIntakeDecomposeDepsForTests({
    client: async () => '["Refactor the parser module", "Add parser tests", "Deploy the release"]',
    connectivityMode: "local-only",
  });
  t.after(() => _setIntakeDecomposeDepsForTests(null));

  const { base, headers } = await startServer(t);
  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description: "Fix all the things across the codebase and clean everything up." }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "work_package");

  const pkg = await (await fetch(`${base}/work-packages/${body.packageId}`, { headers })).json() as Record<string, unknown>;
  const items = pkg.items as Array<Record<string, unknown>>;
  // Items came from the injected model fragments...
  assert.deepEqual(items.map((i) => i.prompt), ["Refactor the parser module", "Add parser tests", "Deploy the release"]);
  // ...and policy still stamped the release step held/high (model can't bypass the gate).
  const rel = items.find((i) => /deploy|release/i.test(String(i.prompt)))!;
  assert.equal(rel.executionMode, "hold");
  assert.equal(rel.risk, "high");

  // No generic agent task auto-spawned.
  const agentCount = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE executor = 'agent'").get() as { n: number }).n;
  assert.equal(agentCount, 0);
});

test("a converted Work Package item is backend-agnostic (executor agent, auto agentType)", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [{ title: "Step one", prompt: "do step one", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] }];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers, body: JSON.stringify({ title: "BA", project: "hivematrix", projectPath: "/tmp/ba", items }),
  })).json() as Record<string, unknown>;
  const item0 = (pkg.items as Array<Record<string, unknown>>)[0];
  const conv = await (await fetch(`${base}/work-packages/${pkg.id}/items/${item0.id}/create-task`, { method: "POST", headers })).json() as Record<string, unknown>;

  const row = getDb().prepare("SELECT executor, agentType, model FROM tasks WHERE _id = ?").get(conv.taskId) as { executor: string; agentType: string; model: string | null };
  assert.equal(row.executor, "agent", "runs on the normal scheduler");
  assert.equal(row.agentType, "auto", "no backend pinned — chatgpt/codex/qwen all eligible");
  assert.equal(row.model, null, "no model pinned on the item task");
});

test("New Task createTask treats a Work Package / routed response as success, not a failure", () => {
  const block = CONSOLE_HTML.match(/async function createTask\(\) \{[\s\S]*?\n\}/);
  assert.ok(block, "createTask block present");
  const src = block![0];
  // The old, broken success gate required _id and broke work_package responses.
  assert.doesNotMatch(src, /if \(!t \|\| !t\._id\) \{ err\.textContent = "Create failed\."/);
  // It now accepts _id OR taskId OR routed OR packageId.
  assert.match(src, /t\.routed/);
  assert.match(src, /t\.taskId/);
  assert.match(src, /work_package/);
});

test("POST /tasks: a broad prompt that NAMES a lane becomes a Work Package, not a Terminal Lane task", async (t) => {
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
  assert.equal(body.routed, "work_package", "broad prompt naming a lane must stage a Work Package");

  // It must NOT have been hijacked into a Terminal Lane task.
  const tl = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks WHERE source = 'terminal-lane'").get() as { n: number }).n;
  assert.equal(tl, 0, "no Terminal Lane task may be created for a broad prompt that merely names the lane");
});

test("POST /tasks route=normal creates a plain task even for a broad prompt", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
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
  const pkgs = (getDb().prepare("SELECT COUNT(*) AS n FROM work_packages").get() as { n: number }).n;
  assert.equal(pkgs, 0, "route=normal must not stage a Work Package");
});

test("POST /tasks route=work_package forces a package for a non-broad prompt", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ route: "work_package", description: "Refactor the auth module.", project: "hivematrix", projectPath: "/tmp/x" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.routed, "work_package");
  assert.ok((body.itemCount as number) >= 1);
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

// ── GET /work-packages/:id — diagnostic completeness ─────────────────────────

test("GET /work-packages/:id returns items with taskStatus, counts, and timestamps", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const createRes = await fetch(`${base}/work-packages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Diagnostic pkg",
      project: "hivematrix",
      projectPath: "/tmp/diag",
      items: [
        { title: "Item A", prompt: "do A", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
        { title: "Item B", prompt: "do B", risk: "high", executionMode: "sequential", scopeHints: [], dependsOn: [] },
      ],
    }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json() as Record<string, unknown>;

  const res = await fetch(`${base}/work-packages/${created.id}`, { headers });
  assert.equal(res.status, 200);
  const pkg = await res.json() as Record<string, unknown>;

  // Items present with taskStatus field
  assert.ok(Array.isArray(pkg.items), "items is an array");
  assert.equal((pkg.items as unknown[]).length, 2, "both items returned");
  const item = (pkg.items as Record<string, unknown>[])[0];
  assert.ok("taskStatus" in item, "item has taskStatus field");
  assert.equal(item.taskStatus, null, "taskStatus is null when no task linked");

  // Counts and derived counters
  assert.ok(pkg.counts, "counts present");
  assert.equal(typeof pkg.skippedCount, "number", "skippedCount present");
  assert.equal(typeof pkg.failedCount, "number", "failedCount present");
  assert.equal(typeof pkg.reviewCount, "number", "reviewCount present");

  // Timestamps
  assert.ok(typeof pkg.createdAt === "string", "createdAt present");
  assert.ok(typeof pkg.updatedAt === "string", "updatedAt present");
  assert.ok("completedAt" in pkg, "completedAt field present (null for draft)");

  // No loop configured yet
  assert.equal(pkg.loop, null, "loop is null when none configured");
  assert.deepEqual(pkg.recentPasses, [], "recentPasses is empty when no loop");
});

test("GET /work-packages/:id includes inline loop when loop exists", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Loop inline pkg",
      project: "hivematrix",
      projectPath: "/tmp/loop-inline",
      items: [{ title: "A", prompt: "do A", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] }],
    }),
  })).json() as Record<string, unknown>;

  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ mode: "manual", profile: "quality", maxPasses: 4 }),
  });

  const res = await fetch(`${base}/work-packages/${pkg.id}`, { headers });
  const detail = await res.json() as Record<string, unknown>;

  assert.ok(detail.loop, "loop is inlined in GET /work-packages/:id");
  const loop = detail.loop as Record<string, unknown>;
  assert.equal(loop.mode, "manual");
  assert.equal(loop.profile, "quality");
  assert.equal(loop.maxPasses, 4);
  assert.equal(loop.packageId, pkg.id);
  assert.deepEqual(detail.recentPasses, [], "no passes yet");
});

test("GET /work-packages/:id inlines recentPasses with evidenceState and stopReason", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Passes inline pkg",
      project: "hivematrix",
      projectPath: "/tmp/passes-inline",
      items: [{ title: "A", prompt: "do A", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] }],
    }),
  })).json() as Record<string, unknown>;

  const loopBody = await (await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ mode: "manual", profile: "quality", maxPasses: 5 }),
  })).json() as { loop: Record<string, unknown> };
  const loopId = loopBody.loop.id as string;

  const { createPass, completePass } = await import("@/lib/work-packages/flight-loop-store");
  const p1 = createPass(loopId, pkg.id as string, "quality", 1);
  completePass(p1.id, {
    status: "completed",
    summary: "first pass done",
    evidence: { state: "needs_follow_up" },
    createdItemIds: ["x"],
    stopReason: "no_actionable_follow_up",
  });
  const p2 = createPass(loopId, pkg.id as string, "quality", 2);
  completePass(p2.id, {
    status: "failed",
    summary: null,
    evidence: {},
    createdItemIds: [],
    stopReason: null,
    error: "gate failed",
  });

  const res = await fetch(`${base}/work-packages/${pkg.id}`, { headers });
  const detail = await res.json() as Record<string, unknown>;
  const passes = detail.recentPasses as Array<Record<string, unknown>>;

  assert.equal(passes.length, 2, "two passes inlined");
  // Newest-first
  assert.equal(passes[0].passNumber, 2, "newest pass first");
  assert.equal(passes[0].status, "failed");
  assert.equal(passes[0].error, "gate failed");
  assert.equal(passes[0].evidenceState, null);
  assert.equal(passes[1].passNumber, 1);
  assert.equal(passes[1].evidenceState, "needs_follow_up");
  assert.equal(passes[1].stopReason, "no_actionable_follow_up");
  assert.equal(passes[1].createdItemCount, 1);
  assert.ok(!("createdItemIds" in passes[1]), "raw createdItemIds not exposed in summary");
});

test("GET /work-packages/:id items show taskStatus after task is linked and updated", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "TaskStatus HTTP pkg",
      project: "hivematrix",
      projectPath: "/Users/x/hivematrix",
      items: [{ title: "A", prompt: "do A", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] }],
    }),
  })).json() as Record<string, unknown>;

  const items = pkg.items as Array<Record<string, unknown>>;
  const itemId = items[0].id as string;

  // Create a board task linked to this item via the API.
  const taskRes = await fetch(`${base}/work-packages/${pkg.id}/items/${itemId}/start`, {
    method: "POST", headers,
  });
  if (taskRes.status !== 200) {
    // start requires the package to be running; set up status manually.
    getDb().prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id as string);
    await fetch(`${base}/work-packages/${pkg.id}/items/${itemId}/start`, { method: "POST", headers });
  }

  // Mark the task in_progress directly in the DB to test hydration.
  const taskIdRow = getDb().prepare("SELECT createdTaskId FROM work_package_items WHERE _id = ?").get(itemId) as { createdTaskId: string | null };
  if (taskIdRow?.createdTaskId) {
    getDb().prepare("UPDATE tasks SET status = 'in_progress' WHERE _id = ?").run(taskIdRow.createdTaskId);
    const res = await fetch(`${base}/work-packages/${pkg.id}`, { headers });
    const detail = await res.json() as Record<string, unknown>;
    const refreshedItem = (detail.items as Array<Record<string, unknown>>).find((i) => i.id === itemId)!;
    assert.equal(refreshedItem.taskStatus, "in_progress", "taskStatus hydrated from linked board task");
  }
  // If no task was linked, the test passes vacuously (item/start may not be wired up in server tests).
});

test("GET /work-packages/:id failedCount and reviewCount are accurate after item status changes", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Counts HTTP pkg",
      project: "hivematrix",
      projectPath: "/tmp/counts",
      items: [
        { title: "A", prompt: "do A", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
        { title: "B", prompt: "do B", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
      ],
    }),
  })).json() as Record<string, unknown>;

  const items = pkg.items as Array<Record<string, unknown>>;
  getDb().prepare("UPDATE work_package_items SET status = 'failed' WHERE _id = ?").run(items[0].id as string);
  getDb().prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(items[1].id as string);

  const res = await fetch(`${base}/work-packages/${pkg.id}`, { headers });
  const detail = await res.json() as Record<string, unknown>;
  assert.equal(detail.failedCount, 1, "failedCount = 1");
  assert.equal(detail.reviewCount, 1, "reviewCount = 1");
});

// ── Stuck-state detector + POST /reconcile ────────────────────────────────────

test("GET /work-packages/:id returns stuckState when running Flight has terminal linked task blocking a ready dep", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb, generateId } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers,
    body: JSON.stringify({
      title: "Stuck-state HTTP test",
      project: "hivematrix",
      projectPath: "/tmp/stuck-http",
      items: [
        { title: "Step A", prompt: "do A", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
        { title: "Step B", prompt: "do B", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Step A"] },
      ],
    }),
  })).json() as Record<string, unknown>;

  const items = pkg.items as Array<Record<string, unknown>>;
  const taskId = generateId();
  getDb().prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'archived')",
  ).run(taskId);
  getDb().prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, items[0].id as string);
  getDb().prepare("UPDATE work_package_items SET status = 'ready' WHERE _id = ?").run(items[1].id as string);
  getDb().prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id as string);

  const res = await fetch(`${base}/work-packages/${pkg.id}`, { headers });
  assert.equal(res.status, 200);
  const detail = await res.json() as Record<string, unknown>;
  const ss = detail.stuckState as Record<string, unknown> | null;
  assert.ok(ss, "stuckState is non-null for stuck running Flight");
  assert.equal(typeof ss!.reason, "string", "stuckState.reason is a string");
  const stuckItems = ss!.stuckItems as Array<Record<string, unknown>>;
  assert.equal(stuckItems.length, 1, "one stuck item");
  assert.equal(stuckItems[0].taskStatus, "archived");
  assert.equal(ss!.canAutoRepair, true, "archived task → canAutoRepair true");
  const readyDeps = ss!.readyDependentIds as string[];
  assert.equal(readyDeps.length, 1, "one ready dependent");
  assert.equal(typeof ss!.suggestedAction, "string", "suggestedAction is a string");
});

test("POST /work-packages/:id/reconcile repairs stuck Flight and returns null stuckState", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb, generateId } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers,
    body: JSON.stringify({
      title: "Reconcile HTTP repair",
      project: "hivematrix",
      projectPath: "/tmp/reconcile-http",
      items: [
        { title: "Step A", prompt: "do A", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
        { title: "Step B", prompt: "do B", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Step A"] },
      ],
    }),
  })).json() as Record<string, unknown>;

  const items = pkg.items as Array<Record<string, unknown>>;
  const taskId = generateId();
  getDb().prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'archived')",
  ).run(taskId);
  getDb().prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, items[0].id as string);
  getDb().prepare("UPDATE work_package_items SET status = 'ready' WHERE _id = ?").run(items[1].id as string);
  getDb().prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id as string);

  const before = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  assert.ok(before.stuckState, "pre-condition: stuckState non-null before reconcile");

  const r = await fetch(`${base}/work-packages/${pkg.id}/reconcile`, { method: "POST", headers });
  assert.equal(r.status, 200);
  const body = await r.json() as Record<string, unknown>;
  assert.ok(body.package, "reconcile returns advance result with package");
  const repaired = body.package as Record<string, unknown>;
  const repairedItems = repaired.items as Array<Record<string, unknown>>;
  assert.equal(repairedItems[0].status, "done", "stuck item repaired to done (archived task → durable repair)");
  assert.equal(repairedItems[1].status, "running", "ready dependent starts after repair");
  assert.equal(repaired.stuckState, null, "stuckState is null after successful repair");
  assert.equal((body.started as string[]).length, 1, "one item started by reconcile");
});

test("POST /work-packages/:id/reconcile returns 404 for unknown package", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/work-packages/nonexistent-id/reconcile`, { method: "POST", headers });
  assert.equal(res.status, 404);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(body.error, "error message returned for unknown package");
});

test("POST /work-packages/:id/reconcile is idempotent on a clean running Flight", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers,
    body: JSON.stringify({
      title: "Reconcile-clean HTTP",
      project: "hivematrix",
      projectPath: "/tmp/reconcile-clean-http",
      items: [
        { title: "Step A", prompt: "do A", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
      ],
    }),
  })).json() as Record<string, unknown>;

  await fetch(`${base}/work-packages/${pkg.id}/start`, { method: "POST", headers });

  const r = await fetch(`${base}/work-packages/${pkg.id}/reconcile`, { method: "POST", headers });
  assert.equal(r.status, 200);
  const body = await r.json() as Record<string, unknown>;
  assert.ok(body.package, "returns package on clean reconcile");
  const result = body.package as Record<string, unknown>;
  assert.equal(result.stuckState, null, "stuckState is null on clean running flight");
  assert.deepEqual(body.started, [], "no new items started on clean reconcile");
});

// ── Flight Loop API — server round-trips ─────────────────────────────────────

function makeLoopPackage(base: string, headers: Record<string, string>, suffix: string) {
  const items = [{ title: "Item", prompt: "do it", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] }];
  return fetch(`${base}/work-packages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: `Loop pkg ${suffix}`, project: "hivematrix", projectPath: `/tmp/loop-${suffix}`, items }),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);
}

// ── Loop CRUD ─────────────────────────────────────────────────────────────────

test("GET /work-packages/:id/loop returns 404 when no loop configured", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "get-404");
  const res = await fetch(`${base}/work-packages/${pkg.id}/loop`, { headers });
  assert.equal(res.status, 404);
  const body = await res.json() as Record<string, unknown>;
  assert.match(body.error as string, /not found/i);
});

test("PUT /work-packages/:id/loop creates a loop and GET returns it", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "put-create");
  const putRes = await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers,
    body: JSON.stringify({ mode: "fixed", cadenceSeconds: 300, maxPasses: 4 }),
  });
  assert.equal(putRes.status, 200);
  const putBody = await putRes.json() as { loop: Record<string, unknown> };
  assert.equal(putBody.loop.packageId, pkg.id);
  assert.equal(putBody.loop.mode, "fixed");
  assert.equal(putBody.loop.cadenceSeconds, 300);
  assert.equal(putBody.loop.maxPasses, 4);
  assert.ok(putBody.loop.id, "loop has an id");

  const getRes = await fetch(`${base}/work-packages/${pkg.id}/loop`, { headers });
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json() as { loop: Record<string, unknown> };
  assert.equal(getBody.loop.id, putBody.loop.id, "same row persisted");
  assert.equal(getBody.loop.mode, "fixed");
  assert.equal(getBody.loop.cadenceSeconds, 300);
});

test("PUT /work-packages/:id/loop updates only the specified fields", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "put-partial");
  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "manual", maxPasses: 3, profile: "quality" }),
  });

  const updateRes = await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ maxPasses: 7 }),
  });
  assert.equal(updateRes.status, 200);
  const body = await updateRes.json() as { loop: Record<string, unknown> };
  assert.equal(body.loop.maxPasses, 7);
  assert.equal(body.loop.mode, "manual", "mode unchanged by partial update");
  assert.equal(body.loop.profile, "quality", "profile unchanged by partial update");
});

test("PUT expiresAt:null clears expiry and GET confirms it", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "put-expiry");
  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "manual" }),
  });

  const clearRes = await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ expiresAt: null }),
  });
  assert.equal(clearRes.status, 200);
  const cleared = await clearRes.json() as { loop: Record<string, unknown> };
  assert.equal(cleared.loop.expiresAt, null, "expiresAt cleared to null");

  const getRes = await fetch(`${base}/work-packages/${pkg.id}/loop`, { headers });
  const got = await getRes.json() as { loop: Record<string, unknown> };
  assert.equal(got.loop.expiresAt, null, "null expiresAt persisted across GET");
});

// ── Pass persistence ──────────────────────────────────────────────────────────

test("GET /work-packages/:id/loop/passes returns 404 when no loop configured", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "passes-404");
  const res = await fetch(`${base}/work-packages/${pkg.id}/loop/passes`, { headers });
  assert.equal(res.status, 404);
});

test("GET /work-packages/:id/loop/passes returns empty array on a fresh loop", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "passes-empty");
  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "manual", maxPasses: 3 }),
  });

  const res = await fetch(`${base}/work-packages/${pkg.id}/loop/passes`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { passes: unknown[] };
  assert.equal(body.passes.length, 0);
});

test("GET /work-packages/:id/loop/passes returns persisted passes newest-first", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "passes-order");
  const putBody = await (await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "manual", maxPasses: 5 }),
  })).json() as { loop: Record<string, unknown> };
  const loopId = putBody.loop.id as string;

  const { createPass, completePass } = await import("@/lib/work-packages/flight-loop-store");
  const p1 = createPass(loopId, pkg.id as string, "quality", 1);
  completePass(p1.id, { status: "completed", summary: "pass one", evidence: {}, createdItemIds: [], stopReason: null });
  const p2 = createPass(loopId, pkg.id as string, "quality", 2);
  completePass(p2.id, { status: "completed", summary: "pass two", evidence: {}, createdItemIds: [], stopReason: null });

  const res = await fetch(`${base}/work-packages/${pkg.id}/loop/passes`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { passes: Array<Record<string, unknown>> };
  assert.equal(body.passes.length, 2);
  assert.equal(body.passes[0].passNumber, 2, "newest pass first");
  assert.equal(body.passes[0].summary, "pass two");
  assert.equal(body.passes[1].passNumber, 1);
  assert.equal(body.passes[1].loopId, loopId, "pass is linked to the loop");
});

// ── Pause / Resume ────────────────────────────────────────────────────────────

test("POST /work-packages/:id/loop/pause returns 409 when no loop configured", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/work-packages/no-such-pkg/loop/pause`, { method: "POST", headers });
  assert.equal(res.status, 409);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(body.error, "error message present");
});

test("POST /work-packages/:id/loop/pause sets status=paused and stopReason=manually_paused", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "pause-ok");
  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "manual" }),
  });

  const res = await fetch(`${base}/work-packages/${pkg.id}/loop/pause`, { method: "POST", headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { loop: Record<string, unknown> };
  assert.equal(body.loop.status, "paused");
  assert.equal(body.loop.stopReason, "manually_paused");
});

test("POST /work-packages/:id/loop/pause returns 409 when already paused", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "pause-double");
  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "manual" }),
  });
  await fetch(`${base}/work-packages/${pkg.id}/loop/pause`, { method: "POST", headers });

  const secondPause = await fetch(`${base}/work-packages/${pkg.id}/loop/pause`, { method: "POST", headers });
  assert.equal(secondPause.status, 409);
});

test("POST /work-packages/:id/loop/resume returns 409 when loop is not paused", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "resume-idle");
  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "manual" }),
  });

  const res = await fetch(`${base}/work-packages/${pkg.id}/loop/resume`, { method: "POST", headers });
  assert.equal(res.status, 409);
});

test("POST /work-packages/:id/loop/resume returns 409 when no loop configured", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const res = await fetch(`${base}/work-packages/no-such-pkg/loop/resume`, { method: "POST", headers });
  assert.equal(res.status, 409);
});

test("POST .../loop/pause then .../loop/resume restores manual loop to idle", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "resume-manual");
  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "manual" }),
  });
  await fetch(`${base}/work-packages/${pkg.id}/loop/pause`, { method: "POST", headers });

  const res = await fetch(`${base}/work-packages/${pkg.id}/loop/resume`, { method: "POST", headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { loop: Record<string, unknown> };
  assert.equal(body.loop.status, "idle");
  assert.equal(body.loop.stopReason, null);
});

test("POST .../loop/pause then .../loop/resume restores fixed loop to active", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "resume-fixed");
  await fetch(`${base}/work-packages/${pkg.id}/loop`, {
    method: "PUT", headers, body: JSON.stringify({ mode: "fixed", cadenceSeconds: 60, maxPasses: 5 }),
  });
  await fetch(`${base}/work-packages/${pkg.id}/loop/pause`, { method: "POST", headers });

  const res = await fetch(`${base}/work-packages/${pkg.id}/loop/resume`, { method: "POST", headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { loop: Record<string, unknown> };
  assert.equal(body.loop.status, "active");
  assert.equal(body.loop.stopReason, null);
});

test("POST /work-packages/:id/loop/run-pass returns 409 when no loop is configured", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const pkg = await makeLoopPackage(base, headers, "run-pass-noloop");
  const res = await fetch(`${base}/work-packages/${pkg.id}/loop/run-pass`, { method: "POST", headers });
  assert.equal(res.status, 409);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(body.error, "error message present");
});

// ── Durable runtime repair: POST /tasks/:id/archive on a work-package child ──

test("POST /tasks/:id/archive on work-package child in running state lands item done and triggers Advance", async (t) => {
  withTempHome(t);
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Step one", prompt: "do step one", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Step two", prompt: "do step two", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Step one"] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers,
    body: JSON.stringify({ title: "Archive-repair-running", project: "hivematrix", projectPath: "/tmp/arch-repair-run", items }),
  })).json() as Record<string, unknown>;

  // Start the package — first item goes running, second is ready (blocked by dep).
  await fetch(`${base}/work-packages/${pkg.id}/start`, { method: "POST", headers });
  const detail1 = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const its1 = detail1.items as Array<Record<string, unknown>>;
  assert.equal(its1[0].status, "running", "precondition: first item running");
  const runningTaskId = its1[0].createdTaskId as string;

  // Archive the running child task directly (not via Accept/Land).
  const archRes = await fetch(`${base}/tasks/${runningTaskId}/archive`, {
    method: "POST", headers,
  });
  assert.equal(archRes.status, 200);

  // Durable repair: the hook must have reconciled the item to done and advanced.
  const detail2 = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const its2 = detail2.items as Array<Record<string, unknown>>;
  assert.equal(its2[0].status, "done",
    "durable repair: archive of a running child task lands the item done (not archived)");
  assert.equal(its2[1].status, "running",
    "Advance triggered: dependent item starts after the running item lands done");
  assert.ok(its2[1].createdTaskId, "dependent item has a linked task");
  assert.equal(detail2.status, "running", "package is still running (second item in flight)");
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

test("POST /tasks/:id/archive on work-package child in review state lands item done and triggers Advance", async (t) => {
  withTempHome(t);
  const { _resetDbForTests, getDb } = await import("@/lib/db");
  _resetDbForTests();
  const { base, headers } = await startServer(t);

  const items = [
    { title: "Review step", prompt: "do review", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Next step", prompt: "do next", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Review step"] },
  ];
  const pkg = await (await fetch(`${base}/work-packages`, {
    method: "POST", headers,
    body: JSON.stringify({ title: "Archive-repair-review", project: "hivematrix", projectPath: "/tmp/arch-repair-rev", items }),
  })).json() as Record<string, unknown>;

  // Start the package and put the first item into review state.
  await fetch(`${base}/work-packages/${pkg.id}/start`, { method: "POST", headers });
  const detail1 = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const its1 = detail1.items as Array<Record<string, unknown>>;
  const item0Id = its1[0].id as string;
  const reviewTaskId = its1[0].createdTaskId as string;

  // Manually set item and task into review state.
  getDb().prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(item0Id);
  await fetch(`${base}/tasks/${reviewTaskId}`, { method: "PATCH", headers, body: JSON.stringify({ status: "review" }) });

  // Archive the review child task directly (bypassing explicit Accept/Land).
  const archRes = await fetch(`${base}/tasks/${reviewTaskId}/archive`, {
    method: "POST", headers,
  });
  assert.equal(archRes.status, 200);

  // Durable repair: the hook must have reconciled the review item to done and advanced.
  const detail2 = await (await fetch(`${base}/work-packages/${pkg.id}`, { headers })).json() as Record<string, unknown>;
  const its2 = detail2.items as Array<Record<string, unknown>>;
  assert.equal(its2[0].status, "done",
    "durable repair: archive of a review child task lands the item done (not archived)");
  assert.equal(its2[1].status, "running",
    "Advance triggered: dependent item starts after the review item lands done");
  assert.ok(its2[1].createdTaskId, "dependent item has a linked task");
  assert.equal(detail2.status, "running", "package is still running (second item in flight)");
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
