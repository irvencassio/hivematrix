/**
 * T3 + T5 — Review Lane HTTP route tests.
 *
 * Canonical routes (RED until Task 11):
 *   GET /review-lane/status       → 200, no top-level "bee" field
 *   GET /api/review-lane/health   → 200, { lane: "review", name: "Review Lane" }
 *
 * Compatibility routes (should stay GREEN):
 *   GET /managerbee/status        → 200
 *   GET /api/managerbee/health    → 200, { bee: "managerbee" }
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-review-lane-routes-test-"));
const originalHome = process.env.HOME;
const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
process.env.HOME = TMP;
process.env.HIVEMATRIX_DB_PATH = join(TMP, "hivematrix.db");

const { _resetDbForTests } = await import("@/lib/db");
_resetDbForTests();

import { DAEMON_TOKEN_FILE, getOrCreateToken } from "@/lib/auth/token";
import { createDaemonServer } from "./server";

const TOKEN = getOrCreateToken(DAEMON_TOKEN_FILE);

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

test.after(() => {
  _resetDbForTests();
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalDbPath !== undefined) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

// ── Canonical routes (RED until Task 11) ──────────────────────────────────────

test("GET /review-lane/status returns 200", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/review-lane/status`, { headers: authHeaders() });
  assert.equal(res.status, 200);
});

test("GET /review-lane/status response has no top-level 'bee' field", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/review-lane/status`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal("bee" in body, false, "response must not contain a top-level 'bee' field");
});

test("GET /api/review-lane/health returns 200", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/api/review-lane/health`, { headers: authHeaders() });
  assert.equal(res.status, 200);
});

test("GET /api/review-lane/health response has lane: 'review'", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/api/review-lane/health`, { headers: authHeaders() });
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.lane, "review");
});

test("GET /api/review-lane/health response has name: 'Review Lane'", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/api/review-lane/health`, { headers: authHeaders() });
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.name, "Review Lane");
});

test("GET /api/review-lane/health response has no top-level 'bee' field", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/api/review-lane/health`, { headers: authHeaders() });
  assert.equal(res.status, 200, "route must exist (200) before checking payload shape");
  const body = await res.json() as Record<string, unknown>;
  assert.equal("bee" in body, false, "canonical health route must not contain a 'bee' field");
});

// ── Compatibility routes (must stay GREEN) ────────────────────────────────────

test("GET /managerbee/status returns 200 (compat)", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/managerbee/status`, { headers: authHeaders() });
  assert.equal(res.status, 200);
});

test("GET /api/managerbee/health returns bee: 'managerbee' (deprecated shape preserved)", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/api/managerbee/health`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.bee, "managerbee");
});
