import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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

test("console source includes the Work Packages panel and no auto-run-all control", () => {
  assert.match(CONSOLE_HTML, /work_packages_list/);
  assert.match(CONSOLE_HTML, /renderWorkPackages/);
  assert.match(CONSOLE_HTML, /Work Packages/);
  // Conservative by design: there is no button that runs every item at once.
  assert.doesNotMatch(CONSOLE_HTML, /runAllPackageItems|Run all items|run-all/i);
});
