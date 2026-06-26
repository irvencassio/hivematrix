import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { _resetDbForTests, Task, getDb } from "@/lib/db";
import { getSystemReadinessReport } from "./index";

const TMP = mkdtempSync(join(tmpdir(), "hm-system-readiness-"));

beforeEach(() => {
  process.env.HIVEMATRIX_DB_PATH = join(TMP, `test-${Date.now()}-${Math.random()}.db`);
  _resetDbForTests();
});

after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

const browserOk = {
  totals: {
    sites: 1,
    byColor: { green: 1, yellow: 0, orange: 0, red: 0, gray: 0 },
    needsAttention: 0,
    stale: 0,
  },
  sites: [],
};

const emptyInbox = {
  counts: {
    needs_review: 0,
    changes_requested: 0,
    proposed_actions_ready: 0,
    proposed_actions_blocked: 0,
    failed_or_attention: 0,
    running_or_pending: 0,
    recently_completed: 0,
  },
  groups: {
    needs_review: [],
    changes_requested: [],
    proposed_actions_ready: [],
    proposed_actions_blocked: [],
    failed_or_attention: [],
    running_or_pending: [],
    recently_completed: [],
  },
};

function baseDeps() {
  return {
    now: () => new Date("2026-06-26T12:00:00Z"),
    getBrowserDashboard: () => browserOk,
    getLaneApps: async () => [
      { id: "browser-lane", displayName: "Browser Lane", status: "installed", installed: { short: "0.1.86", build: "2" }, expected: { short: "0.1.86", build: "2" } },
      { id: "terminal-lane", displayName: "Terminal Lane", status: "installed", installed: { short: "0.1.1", build: "2" }, expected: { short: "0.1.1", build: "2" } },
    ],
    getWorkflowInbox: () => emptyInbox,
    readLocalModelHealth: () => ({ ready: true, qwenReady: true, provider: "mlx", modelName: "qwen", endpoint: "http://127.0.0.1:8000/v1", checkedAt: "2026-06-26T11:59:00Z", message: "ready" }),
    connectivity: () => "cloud-ok",
    version: () => "0.1.87",
  };
}

test("reports empty COO routing rules as a warning", async () => {
  const report = await getSystemReadinessReport(baseDeps());
  const coo = report.checks.find((c) => c.id === "coo-routing-rules");
  assert.equal(coo?.severity, "warn");
  assert.match(coo?.summary ?? "", /No COO routing rules/i);
  assert.equal(report.ok, false);
  assert.equal(report.counts.warn >= 1, true);
});

test("reports Browser Lane attention and stale readiness", async () => {
  const report = await getSystemReadinessReport({
    ...baseDeps(),
    getBrowserDashboard: () => ({
      totals: {
        sites: 2,
        byColor: { green: 0, yellow: 0, orange: 1, red: 0, gray: 1 },
        needsAttention: 2,
        stale: 1,
      },
      sites: [
        { id: "heygen", displayName: "HeyGen", readiness: { status: "needs_reauth", color: "orange", stale: true } },
      ],
    }),
  });
  const browser = report.checks.find((c) => c.id === "browser-lane-readiness");
  assert.equal(browser?.severity, "warn");
  assert.match(browser?.summary ?? "", /2.*attention/i);
  assert.match(browser?.summary ?? "", /1 stale/i);
});

test("reports lane app install/update/broken states", async () => {
  const report = await getSystemReadinessReport({
    ...baseDeps(),
    getLaneApps: async () => [
      { id: "browser-lane", displayName: "Browser Lane", status: "missing", installed: null, expected: { short: "0.1.86", build: "2" } },
      { id: "terminal-lane", displayName: "Terminal Lane", status: "launch_failed", installed: { short: "0.1.1", build: "2" }, expected: { short: "0.1.1", build: "2" } },
    ],
  });
  const apps = report.checks.find((c) => c.id === "lane-apps");
  assert.equal(apps?.severity, "critical");
  assert.match(apps?.summary ?? "", /launch failed/i);
  assert.match(apps?.summary ?? "", /missing/i);
});

test("reports legacy video review tasks and recent failed tasks with redacted snippets", async () => {
  await Task.create({
    _id: "legacy-video",
    title: "Review video script: AI News",
    description: "Review this AI-news video script before it renders (HeyGen costs ~$0.05/sec)",
    project: "hivematrix",
    projectPath: "/Users/tester",
    status: "review",
    reviewState: "needs_input",
    source: "video",
    executor: "video-review",
    error: "Render failed: Command failed: make-avatar.mjs token=SECRET123",
  });
  await Task.create({
    _id: "failed-task",
    title: "Broken task",
    description: "x",
    project: "hivematrix",
    projectPath: "/Users/tester",
    status: "failed",
    source: "dashboard",
    error: "Exited with password=hunter2",
  });

  // Add one rule so this test focuses on task checks.
  getDb().prepare(`
    INSERT INTO coo_routing_rules (_id, name, priority, enabled, intent, lane, capability)
    VALUES ('r1', 'Browser default', 10, 1, 'browser', 'browser', 'browser.navigate')
  `).run();

  const report = await getSystemReadinessReport(baseDeps());
  const legacy = report.checks.find((c) => c.id === "legacy-video-review-tasks");
  const failed = report.checks.find((c) => c.id === "recent-failed-tasks");
  assert.equal(legacy?.severity, "warn");
  assert.match(legacy?.summary ?? "", /legacy video/i);
  assert.equal(failed?.severity, "warn");
  assert.match(failed?.summary ?? "", /1 failed/i);
  assert.doesNotMatch(JSON.stringify(report), /hunter2|SECRET123/);
  assert.match(JSON.stringify(report), /\[redacted\]/);
});
