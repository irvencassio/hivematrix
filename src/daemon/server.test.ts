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
