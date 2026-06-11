/**
 * HiveMatrix Daemon HTTP server.
 *
 * Exposes a REST + SSE API consumed by the console (Next.js or Tauri).
 * Uses Node's built-in http module — no framework dependency.
 *
 * Routes:
 *   GET  /health                     — daemon health snapshot
 *   GET  /connectivity               — current connectivity state
 *   POST /connectivity/mode          — manual override { mode: 'cloud-ok'|'local-only'|'offline'|null }
 *   GET  /tasks                      — list tasks (query: status, profile, project)
 *   GET  /tasks/:id                  — get task
 *   POST /tasks                      — create task
 *   PATCH /tasks/:id                 — update task fields
 *   DELETE /tasks/:id                — cancel/delete task
 *   GET  /events                     — SSE stream (tasks:*, connectivity:*)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { getDb } from "@/lib/db";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import type { ConnectivityMode } from "@/lib/connectivity/policy";
import { setBroadcastFn } from "@/lib/ws/broadcaster";
import { CONSOLE_HTML } from "./console";

// SSE client registry
const sseClients = new Set<ServerResponse>();

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function parseQueryString(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(url.slice(idx + 1))) {
    params[k] = v;
  }
  return params;
}

export function createDaemonServer() {
  const policy = getConnectivityPolicy();

  // Wire the internal broadcaster so scheduler/recovery can emit SSE events
  setBroadcastFn((payload) => broadcast("hive:event", payload));

  // Broadcast mode changes over SSE
  policy.on("modeChange", (state) => {
    broadcast("connectivity:change", state);
  });

  const server = createServer(async (req, res) => {
    // CORS for console dev server
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlPath = (req.url ?? "/").split("?")[0];

    try {
      // GET / or /console — the operator console (centered shell)
      if (req.method === "GET" && (urlPath === "/" || urlPath === "/console")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(CONSOLE_HTML);
        return;
      }

      // GET /health
      if (req.method === "GET" && urlPath === "/health") {
        const db = getDb();
        const taskCount = (db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status IN ('backlog','assigned','in_progress')").get() as { n: number }).n;
        json(res, 200, {
          status: "ok",
          version: "0.1.0",
          connectivity: policy.mode,
          activeTasks: taskCount,
          uptime: process.uptime(),
        });
        return;
      }

      // GET /metrics — soak/operational metrics for unattended monitoring
      if (req.method === "GET" && urlPath === "/metrics") {
        const db = getDb();
        const byStatus = db.prepare("SELECT status, COUNT(*) as n FROM tasks GROUP BY status").all() as { status: string; n: number }[];
        const taskByStatus: Record<string, number> = {};
        for (const r of byStatus) taskByStatus[r.status] = r.n;
        const dirByStatus = db.prepare("SELECT status, COUNT(*) as n FROM directives GROUP BY status").all() as { status: string; n: number }[];
        const directiveByStatus: Record<string, number> = {};
        for (const r of dirByStatus) directiveByStatus[r.status] = r.n;
        const runsTotal = (db.prepare("SELECT COUNT(*) as n FROM runs").get() as { n: number }).n;
        const runsDone = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE phase='done'").get() as { n: number }).n;
        const runsFailed = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE phase='failed'").get() as { n: number }).n;
        const recentFailures = db.prepare(
          "SELECT _id, error FROM tasks WHERE status='failed' ORDER BY updatedAt DESC LIMIT 5"
        ).all() as { _id: string; error: string | null }[];
        json(res, 200, {
          uptimeSeconds: Math.round(process.uptime()),
          connectivity: policy.mode,
          tasksByStatus: taskByStatus,
          directivesByStatus: directiveByStatus,
          runs: { total: runsTotal, done: runsDone, failed: runsFailed },
          recentFailures,
          memoryRssMb: Math.round(process.memoryUsage().rss / 1048576),
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      // GET /onboarding — first-run / readiness checklist
      if (req.method === "GET" && urlPath === "/onboarding") {
        const { getOnboardingStatus } = await import("@/lib/onboarding/onboarding");
        const { probeDesktopBeeHelper, dispatchDesktopBeeAction } = await import("@/lib/desktopbee/client");
        // Live-probe the DesktopBee helper for build + permission state.
        let helperBuilt = false;
        let desktopPermissions: { accessibility: boolean; screenRecording: boolean } | null = null;
        const health = await probeDesktopBeeHelper().catch(() => null);
        if (health) {
          helperBuilt = true;
          const r = await dispatchDesktopBeeAction(
            { action: "desktop.permissions", params: { prompt: false } }
          ).catch(() => null);
          const d = r?.data as { accessibility?: boolean; screenRecording?: boolean } | undefined;
          if (d) desktopPermissions = { accessibility: !!d.accessibility, screenRecording: !!d.screenRecording };
        }
        json(res, 200, getOnboardingStatus({ helperBuilt, desktopPermissions }));
        return;
      }

      // GET /connectivity
      if (req.method === "GET" && urlPath === "/connectivity") {
        json(res, 200, policy.getState());
        return;
      }

      // POST /connectivity/mode
      if (req.method === "POST" && urlPath === "/connectivity/mode") {
        const body = await parseBody(req) as Record<string, unknown>;
        const mode = body.mode as ConnectivityMode | null;
        if (mode !== null && mode !== "cloud-ok" && mode !== "local-only" && mode !== "offline") {
          json(res, 400, { error: "mode must be cloud-ok, local-only, offline, or null" });
          return;
        }
        policy.setManualOverride(mode, "API request");
        json(res, 200, policy.getState());
        return;
      }

      // GET /events — SSE stream
      if (req.method === "GET" && urlPath === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ connectivity: policy.mode })}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      // GET /tasks
      if (req.method === "GET" && urlPath === "/tasks") {
        const q = parseQueryString(req.url ?? "");
        const db = getDb();
        const conditions: string[] = [];
        const params: string[] = [];
        if (q.status) { conditions.push("status = ?"); params.push(q.status); }
        if (q.profile) { conditions.push("profile = ?"); params.push(q.profile); }
        if (q.project) { conditions.push("project = ?"); params.push(q.project); }
        const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
        const rows = db.prepare(`SELECT * FROM tasks${where} ORDER BY position ASC`).all(...params);
        json(res, 200, rows);
        return;
      }

      // GET /tasks/:id
      const taskMatch = urlPath.match(/^\/tasks\/([^/]+)$/);
      if (req.method === "GET" && taskMatch) {
        const db = getDb();
        const row = db.prepare("SELECT * FROM tasks WHERE _id = ?").get(taskMatch[1]);
        if (!row) { json(res, 404, { error: "Not found" }); return; }
        json(res, 200, row);
        return;
      }

      // POST /tasks
      if (req.method === "POST" && urlPath === "/tasks") {
        const { Task, generateId } = await import("@/lib/db");
        const body = await parseBody(req) as Record<string, unknown>;
        const task = await Task.create({ _id: generateId(), ...body });
        broadcast("tasks:created", { taskId: task._id });
        json(res, 201, task);
        return;
      }

      // PATCH /tasks/:id
      if (req.method === "PATCH" && taskMatch) {
        const { Task } = await import("@/lib/db");
        const body = await parseBody(req) as Record<string, unknown>;
        const task = await Task.findByIdAndUpdate(taskMatch[1], body);
        if (!task) { json(res, 404, { error: "Not found" }); return; }
        broadcast("tasks:updated", { taskId: task._id, status: task.status });
        json(res, 200, task);
        return;
      }

      // DELETE /tasks/:id
      if (req.method === "DELETE" && taskMatch) {
        const { Task } = await import("@/lib/db");
        await Task.findByIdAndUpdate(taskMatch[1], { status: "cancelled" });
        broadcast("tasks:updated", { taskId: taskMatch[1], status: "cancelled" });
        json(res, 204, null);
        return;
      }

      // POST /directives — create a directive (optionally with criteria[])
      if (req.method === "POST" && urlPath === "/directives") {
        const store = await import("@/lib/orchestrator/directive-store");
        const body = await parseBody(req) as Record<string, unknown>;
        const directive = store.createDirective({
          goal: String(body.goal ?? ""),
          profile: String(body.profile ?? "default"),
          project: String(body.project ?? "hivematrix"),
          projectPath: String(body.projectPath ?? process.cwd()),
          triggerPolicy: (body.triggerPolicy as Record<string, unknown>) ?? { type: "manual" },
          nextRunAt: (body.nextRunAt as string | null) ?? null,
        });
        const criteria = Array.isArray(body.criteria) ? body.criteria : [];
        for (const c of criteria) {
          if (typeof c === "string") store.addCriterion(directive._id, c);
        }
        broadcast("directives:created", { directiveId: directive._id });
        json(res, 201, { ...directive, criteria: store.getCriteria(directive._id) });
        return;
      }

      // GET /directives — list all directives
      if (req.method === "GET" && urlPath === "/directives") {
        const db = getDb();
        const rows = db.prepare("SELECT * FROM directives ORDER BY createdAt DESC").all();
        json(res, 200, rows);
        return;
      }

      // GET /directives/:id — directive with its criteria + runs
      const dirMatch = urlPath.match(/^\/directives\/([^/]+)$/);
      if (req.method === "GET" && dirMatch) {
        const store = await import("@/lib/orchestrator/directive-store");
        const directive = store.getDirective(dirMatch[1]);
        if (!directive) { json(res, 404, { error: "Not found" }); return; }
        const db = getDb();
        const runs = db.prepare("SELECT * FROM runs WHERE directiveId = ? ORDER BY startedAt DESC").all(dirMatch[1]);
        json(res, 200, { ...directive, criteria: store.getCriteria(dirMatch[1]), runs });
        return;
      }

      // POST /directives/:id/criteria — add a success criterion
      const critMatch = urlPath.match(/^\/directives\/([^/]+)\/criteria$/);
      if (req.method === "POST" && critMatch) {
        const store = await import("@/lib/orchestrator/directive-store");
        const body = await parseBody(req) as Record<string, unknown>;
        const c = store.addCriterion(critMatch[1], String(body.description ?? ""), body.proverType as string | undefined);
        json(res, 201, c);
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (err) {
      console.error("[daemon] Request error:", err);
      json(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  return server;
}

export function startDaemonServer(port = 3747): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createDaemonServer();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`[hivematrix] Daemon listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}
