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
import { getOrCreateToken, tokenEquals, DAEMON_TOKEN_FILE } from "@/lib/auth/token";

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
  const AUTH_TOKEN = getOrCreateToken(DAEMON_TOKEN_FILE);

  // Wire the internal broadcaster so scheduler/recovery can emit SSE events
  setBroadcastFn((payload) => broadcast("hive:event", payload));

  // Broadcast mode changes over SSE
  policy.on("modeChange", (state) => {
    broadcast("connectivity:change", state);
  });

  // Routes servable without the token: liveness + the console page itself
  // (the page receives the token injected into its HTML, same-origin only).
  const isPublicRoute = (method: string, path: string) =>
    method === "GET" && (path === "/health" || path === "/" || path === "/console");

  // Extract the caller's token from the Authorization header or ?token= query
  // (EventSource can't set headers, so SSE passes it as a query param).
  function requestToken(req: IncomingMessage, urlPath: string): string | null {
    void urlPath;
    const auth = req.headers["authorization"];
    if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
    const url = req.url ?? "";
    const idx = url.indexOf("?");
    if (idx !== -1) {
      const t = new URLSearchParams(url.slice(idx + 1)).get("token");
      if (t) return t;
    }
    return null;
  }

  const server = createServer(async (req, res) => {
    // No wildcard CORS. The console is served same-origin (and the Tauri shell
    // navigates to the daemon origin), so cross-origin access is neither needed
    // nor allowed — this closes the browser drive-by (CSRF) vector.
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlPath = (req.url ?? "/").split("?")[0];

    // Authenticate everything except the public liveness/page routes.
    if (!isPublicRoute(req.method ?? "GET", urlPath)) {
      if (!tokenEquals(requestToken(req, urlPath), AUTH_TOKEN)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
    }

    try {
      // GET / or /console — the operator console.
      // SECURITY: the token is injected into the HTML ONLY for direct loopback
      // requests. Requests arriving via Cloudflare (tunnel) carry a
      // CF-Connecting-IP header — for those we serve the console WITHOUT the
      // token, so a remote visitor must paste it (obtained from local Settings).
      // This closes the "anyone with the tunnel URL gets the token" hole.
      if (req.method === "GET" && (urlPath === "/" || urlPath === "/console")) {
        const viaCloudflare = !!(req.headers["cf-connecting-ip"] || req.headers["cf-ray"]);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(CONSOLE_HTML.replace("%%HM_TOKEN%%", viaCloudflare ? "" : AUTH_TOKEN));
        return;
      }

      // GET /health — liveness, no secrets. This is the ONLY route with CORS
      // enabled: the Tauri shell's splash (a different, bundled origin) probes
      // it cross-origin before navigating to the same-origin console. Data and
      // mutating routes stay token-gated with no CORS.
      if (req.method === "GET" && urlPath === "/health") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        const db = getDb();
        const taskCount = (db.prepare("SELECT COUNT(*) as n FROM tasks WHERE status IN ('backlog','assigned','in_progress')").get() as { n: number }).n;
        const { getBundledVersion } = await import("@/lib/version/bundle-version");
        json(res, 200, {
          status: "ok",
          version: getBundledVersion(),
          connectivity: policy.mode,
          activeTasks: taskCount,
          uptime: process.uptime(),
        });
        return;
      }

      // GET /projects — discovered projects for the project selector
      if (req.method === "GET" && urlPath === "/projects") {
        const { discoverProjects, shouldPreSelect } = await import("@/lib/routing/project-discovery");
        const projects = discoverProjects();
        json(res, 200, {
          projects: projects.map((p) => ({
            name: p.name,
            path: p.path,
            sources: p.sources,
            hasManifest: p.hasManifest,
            lastModified: p.lastModified.toISOString(),
            preSelect: shouldPreSelect(p),
          })),
        });
        return;
      }

      // GET /models — backends, available models, default, version (for Settings + New Task)
      if (req.method === "GET" && urlPath === "/models") {
        const { detectBackends } = await import("@/lib/models/backends");
        const { buildAvailableModels, getDefaultModel, getThemeSettings } = await import("@/lib/models/available");
        const { versionInfo } = await import("@/lib/version");
        const backends = detectBackends();
        const available = buildAvailableModels(backends);
        const theme = getThemeSettings();
        json(res, 200, {
          backends,
          available,
          defaultModel: getDefaultModel(available),
          version: versionInfo(),
          theme: theme.theme,
          hasWallpaper: !!theme.wallpaperPath,
        });
        return;
      }

      // POST /settings — default model, local endpoint, theme, wallpaper
      if (req.method === "POST" && urlPath === "/settings") {
        const body = await parseBody(req) as Record<string, unknown>;
        const m = await import("@/lib/models/available");
        if (typeof body.defaultModel === "string") m.setDefaultModel(body.defaultModel);
        if (typeof body.localEndpoint === "string" && body.localEndpoint.trim()) m.setLocalEndpoint(body.localEndpoint.trim());
        if (body.theme === "system" || body.theme === "light" || body.theme === "dark") m.setTheme(body.theme);
        if (typeof body.wallpaperPath === "string") m.setWallpaperPath(body.wallpaperPath.trim() || null);
        if (body.wallpaperPath === null) m.setWallpaperPath(null);
        if (typeof body.wallpaperData === "string" && typeof body.wallpaperExt === "string") {
          m.saveWallpaperUpload(body.wallpaperData, body.wallpaperExt);
        }
        const available = m.buildAvailableModels();
        const theme = m.getThemeSettings();
        json(res, 200, { ok: true, defaultModel: m.getDefaultModel(available), theme: theme.theme, hasWallpaper: !!theme.wallpaperPath });
        return;
      }

      // GET /wallpaper — serve the configured wallpaper image (token via ?token=)
      if (req.method === "GET" && urlPath === "/wallpaper") {
        const { getThemeSettings } = await import("@/lib/models/available");
        const wp = getThemeSettings().wallpaperPath;
        const { existsSync, readFileSync } = await import("fs");
        if (!wp || !existsSync(wp)) { json(res, 404, { error: "no wallpaper" }); return; }
        const ext = wp.split(".").pop()?.toLowerCase() ?? "png";
        const ctype = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/png";
        const buf = readFileSync(wp);
        res.writeHead(200, { "Content-Type": ctype, "Content-Length": buf.length });
        res.end(buf);
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

      // GET /update/check — query the configured release channel for an update
      if (req.method === "GET" && urlPath === "/update/check") {
        const { checkUpdateStatus } = await import("@/lib/updater/daemon-update");
        json(res, 200, await checkUpdateStatus());
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
        const { isChannelEnabled } = await import("@/lib/messagebee/store");
        const { canReadChatDb } = await import("@/lib/messagebee/imessage");
        const messagebee = { enabled: isChannelEnabled(), chatDbReadable: canReadChatDb() };
        json(res, 200, getOnboardingStatus({ helperBuilt, desktopPermissions, messagebee }));
        return;
      }

      // POST /onboarding/config — write config.json + ensure the daemon token
      if (req.method === "POST" && urlPath === "/onboarding/config") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { writeConfigStep } = await import("@/lib/onboarding/actions");
        json(res, 200, writeConfigStep((body.config as Record<string, unknown>) ?? {}));
        return;
      }

      // POST /onboarding/brain — set the canonical brain root (config.memory.brainRootDir)
      if (req.method === "POST" && urlPath === "/onboarding/brain") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { setBrainRoot } = await import("@/lib/onboarding/actions");
        json(res, 200, setBrainRoot({
          brainRootDir: String(body.brainRootDir ?? ""),
          createIfMissing: body.createIfMissing !== false,
          makeShortcut: body.makeShortcut === true,
        }));
        return;
      }

      // POST /onboarding/local-model — point-at / cloud-only / download
      if (req.method === "POST" && urlPath === "/onboarding/local-model") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { configureLocalModel } = await import("@/lib/onboarding/actions");
        const mode = body.mode === "endpoint" || body.mode === "cloud-only" || body.mode === "download" ? body.mode : "endpoint";
        json(res, 200, await configureLocalModel({
          mode,
          endpoint: typeof body.endpoint === "string" ? body.endpoint : undefined,
          modelId: typeof body.modelId === "string" ? body.modelId : undefined,
          provider: typeof body.provider === "string" ? body.provider : undefined,
        }));
        return;
      }

      // POST /onboarding/frontier — store API key(s) / detect CLIs
      if (req.method === "POST" && urlPath === "/onboarding/frontier") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { configureFrontier } = await import("@/lib/onboarding/actions");
        json(res, 200, await configureFrontier({
          anthropicApiKey: typeof body.anthropicApiKey === "string" ? body.anthropicApiKey : undefined,
          openaiApiKey: typeof body.openaiApiKey === "string" ? body.openaiApiKey : undefined,
        }));
        return;
      }

      // POST /onboarding/daemon — install + load the launchd agent (the finish/handoff)
      if (req.method === "POST" && urlPath === "/onboarding/daemon") {
        const { installDaemonLaunchAgent } = await import("@/lib/onboarding/actions");
        json(res, 200, installDaemonLaunchAgent());
        return;
      }

      // POST /onboarding/desktopbee — install helper agent + return TCC deep-links
      if (req.method === "POST" && urlPath === "/onboarding/desktopbee") {
        const { installDesktopBeeHelper } = await import("@/lib/onboarding/actions");
        json(res, 200, installDesktopBeeHelper());
        return;
      }

      // GET /tunnel — cloudflared status
      if (req.method === "GET" && urlPath === "/tunnel") {
        const { tunnelStatus } = await import("@/lib/tunnel/cloudflared");
        json(res, 200, tunnelStatus());
        return;
      }
      // POST /tunnel/start — start a quick tunnel to this daemon
      if (req.method === "POST" && urlPath === "/tunnel/start") {
        const { startQuickTunnel, tunnelStatus } = await import("@/lib/tunnel/cloudflared");
        try {
          const url = await startQuickTunnel(parseInt(process.env.HIVEMATRIX_PORT ?? "3747", 10));
          json(res, 200, { ...tunnelStatus(), url });
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
      // POST /tunnel/stop
      if (req.method === "POST" && urlPath === "/tunnel/stop") {
        const { stopTunnel, tunnelStatus } = await import("@/lib/tunnel/cloudflared");
        stopTunnel();
        json(res, 200, tunnelStatus());
        return;
      }
      // POST /tunnel/start-named — run a named tunnel via connector token
      if (req.method === "POST" && urlPath === "/tunnel/start-named") {
        const { startNamedTunnel, tunnelStatus } = await import("@/lib/tunnel/cloudflared");
        const body = await parseBody(req) as Record<string, unknown>;
        const token = String(body.connectorToken ?? "").trim();
        const hostname = String(body.hostname ?? "").trim();
        if (!token || !hostname) { json(res, 400, { error: "connectorToken and hostname required" }); return; }
        try { await startNamedTunnel(token, hostname.startsWith("http") ? hostname : `https://${hostname}`); json(res, 200, tunnelStatus()); }
        catch (e) { json(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
        return;
      }
      // GET /tunnel/qr — QR (SVG) of the pairing payload {url, token} for iOS.
      // Generated locally via qrencode; the token never leaves the machine.
      if (req.method === "GET" && urlPath === "/tunnel/qr") {
        const { tunnelStatus, pairingPayload, generateQrSvg } = await import("@/lib/tunnel/cloudflared");
        const st = tunnelStatus();
        if (!st.url) { json(res, 400, { error: "no tunnel running" }); return; }
        if (!st.qrInstalled) { json(res, 503, { error: "qrencode not installed (brew install qrencode)" }); return; }
        const svg = await generateQrSvg(pairingPayload(st.url, AUTH_TOKEN));
        if (!svg) { json(res, 500, { error: "qr generation failed" }); return; }
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(svg);
        return;
      }

      // GET /bees — status of every embedded/managed bee lane (Settings view)
      if (req.method === "GET" && urlPath === "/bees") {
        const { listBeeServiceStatuses } = await import("@/lib/bees/service-manager");
        json(res, 200, { bees: await listBeeServiceStatuses() });
        return;
      }

      // GET /messagebee — channel status (enabled, chat.db readable, allowlist)
      if (req.method === "GET" && urlPath === "/messagebee") {
        const { isChannelEnabled, listIdentities } = await import("@/lib/messagebee/store");
        const { canReadChatDb } = await import("@/lib/messagebee/imessage");
        json(res, 200, {
          enabled: isChannelEnabled(),
          chatDbReadable: canReadChatDb(),
          identities: listIdentities(),
        });
        return;
      }

      // POST /messagebee/enable — { enabled: boolean }. On enable, set the
      // high-water mark to the current max ROWID so we never replay history.
      if (req.method === "POST" && urlPath === "/messagebee/enable") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { setChannelEnabled, setLastRowid, ensureChannel } = await import("@/lib/messagebee/store");
        const { currentMaxRowid, canReadChatDb } = await import("@/lib/messagebee/imessage");
        const enabled = body.enabled !== false;
        ensureChannel();
        if (enabled) {
          if (!canReadChatDb()) { json(res, 412, { error: "chat.db not readable — grant Full Disk Access to HiveMatrix" }); return; }
          setLastRowid(currentMaxRowid());
        }
        setChannelEnabled(enabled);
        json(res, 200, { ok: true, enabled });
        return;
      }

      // POST /messagebee/identities — manage the sender allowlist.
      // Body: { address, status: pending|allowed|paired|blocked, displayName? }
      if (req.method === "POST" && urlPath === "/messagebee/identities") {
        const body = await parseBody(req) as Record<string, unknown>;
        const address = String(body.address ?? "").trim();
        if (!address) { json(res, 400, { error: "address is required" }); return; }
        const status = ["pending", "allowed", "paired", "blocked"].includes(body.status as string)
          ? (body.status as "pending" | "allowed" | "paired" | "blocked") : "allowed";
        const { upsertIdentity, listIdentities } = await import("@/lib/messagebee/store");
        upsertIdentity(address, status, typeof body.displayName === "string" ? body.displayName : null);
        json(res, 200, { ok: true, identities: listIdentities() });
        return;
      }

      // POST /messagebee/test-send — { handle, text } verify outbound works.
      if (req.method === "POST" && urlPath === "/messagebee/test-send") {
        const body = await parseBody(req) as Record<string, unknown>;
        const handle = String(body.handle ?? "").trim();
        const text = String(body.text ?? "HiveMatrix test message").trim();
        if (!handle) { json(res, 400, { error: "handle is required" }); return; }
        const { sendIMessage } = await import("@/lib/messagebee/imessage");
        const ok = await sendIMessage(handle, text);
        json(res, ok ? 200 : 502, { ok });
        return;
      }

      // POST /bees/:kind/autostart — enable+start or disable+stop a manageable
      // (launchagent) bee. Body: { enabled: boolean }.
      const beeAutostartMatch = urlPath.match(/^\/bees\/([a-z]+)\/autostart$/);
      if (req.method === "POST" && beeAutostartMatch) {
        const kind = beeAutostartMatch[1];
        const body = await parseBody(req) as Record<string, unknown>;
        const enabled = body.enabled === true;
        const { setBeeAutoStart, getBeeRuntimeDescriptor } = await import("@/lib/bees/service-manager");
        const desc = getBeeRuntimeDescriptor(kind);
        if (!desc.manageable || desc.runtimeMode !== "launchagent") {
          json(res, 400, { error: `${kind} is not a manageable launchagent bee` });
          return;
        }
        try {
          const next = setBeeAutoStart(kind, enabled);
          if (!next) { json(res, 404, { error: `bee ${kind} not found` }); return; }
          json(res, 200, { kind, enabled, settings: next });
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // POST /bees/:kind/restart — restart a running launchagent bee
      const beeRestartMatch = urlPath.match(/^\/bees\/([a-z]+)\/restart$/);
      if (req.method === "POST" && beeRestartMatch) {
        const kind = beeRestartMatch[1];
        const { restartBeeService } = await import("@/lib/bees/service-manager");
        try { restartBeeService(kind); json(res, 200, { kind, restarted: true }); }
        catch (e) { json(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
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

      // GET /tasks — excludes archived by default (pass ?status=archived to see them)
      if (req.method === "GET" && urlPath === "/tasks") {
        const q = parseQueryString(req.url ?? "");
        const db = getDb();
        const conditions: string[] = [];
        const params: string[] = [];
        if (q.status) { conditions.push("status = ?"); params.push(q.status); }
        else { conditions.push("status != 'archived'"); }
        if (q.profile) { conditions.push("profile = ?"); params.push(q.profile); }
        if (q.project) { conditions.push("project = ?"); params.push(q.project); }
        const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
        const rows = db.prepare(`SELECT * FROM tasks${where} ORDER BY position ASC LIMIT 300`).all(...params);
        json(res, 200, rows);
        return;
      }

      // POST /tasks/archive-completed — bulk-archive terminal tasks (declutter the board)
      if (req.method === "POST" && urlPath === "/tasks/archive-completed") {
        const db = getDb();
        const r = db.prepare(
          "UPDATE tasks SET status='archived', updatedAt=datetime('now') WHERE status IN ('review','done','failed','cancelled')"
        ).run();
        broadcast("tasks:updated", { archived: r.changes });
        json(res, 200, { archived: r.changes });
        return;
      }

      // GET /tasks/:id
      const taskMatch = urlPath.match(/^\/tasks\/([^/]+)$/);
      if (req.method === "GET" && taskMatch) {
        const db = getDb();
        const row = db.prepare("SELECT * FROM tasks WHERE _id = ?").get(taskMatch[1]) as Record<string, unknown> | undefined;
        if (!row) { json(res, 404, { error: "Not found" }); return; }
        // Attach pending stuck request so the UI can surface the question.
        if (row.reviewState === "needs_input") {
          const { getPendingStuck } = await import("@/lib/orchestrator/stuck");
          const pending = getPendingStuck().filter(r => r.taskId === taskMatch[1]);
          if (pending.length) {
            const latest = pending.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
            (row as Record<string, unknown>).pendingQuestion = latest.reason;
          }
        }
        json(res, 200, row);
        return;
      }

      // POST /tasks
      if (req.method === "POST" && urlPath === "/tasks") {
        const { Task, generateId } = await import("@/lib/db");
        const { deriveTaskTitle } = await import("@/lib/tasks/derive-title");
        const body = await parseBody(req) as Record<string, unknown>;
        // Title is optional — derive it from the instructions when absent/blank.
        const title = typeof body.title === "string" ? body.title.trim() : "";
        body.title = title || deriveTaskTitle(body.description as string);
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

      // POST /tasks/:id/reply — send a text reply to a needs_input task
      const replyMatch = urlPath.match(/^\/tasks\/([^/]+)\/reply$/);
      if (req.method === "POST" && replyMatch) {
        const tid = replyMatch[1];
        const body = await parseBody(req) as Record<string, unknown>;
        const text = String(body.text ?? "").trim();
        if (!text) { json(res, 400, { error: "text is required" }); return; }
        const { getPendingStuck, resolveStuck } = await import("@/lib/orchestrator/stuck");
        const pending = getPendingStuck().filter(r => r.taskId === tid);
        if (!pending.length) { json(res, 404, { error: "No pending input request for this task" }); return; }
        // Resolve the most-recent pending request.
        const req2 = pending.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
        const ok = await resolveStuck(tid, req2.timestamp, "reply", "console", text);
        if (!ok) { json(res, 409, { error: "Already resolved" }); return; }
        // Clear the needs_input reviewState so the board stops flagging it.
        const { Task } = await import("@/lib/db");
        await Task.findByIdAndUpdate(tid, { reviewState: null });
        json(res, 200, { ok: true }); return;
      }

      // POST /tasks/:id/<action> — retry | archive | cancel
      const taskActionMatch = urlPath.match(/^\/tasks\/([^/]+)\/(retry|archive|cancel)$/);
      if (req.method === "POST" && taskActionMatch) {
        const { Task } = await import("@/lib/db");
        const [, tid, action] = taskActionMatch;
        if (action === "retry") {
          const t = await Task.findByIdAndUpdate(tid, {
            status: "backlog", error: null, agentPid: null, startedAt: null, completedAt: null, reviewState: null,
          });
          if (!t) { json(res, 404, { error: "Not found" }); return; }
          broadcast("tasks:updated", { taskId: tid, status: "backlog" });
          json(res, 200, t); return;
        }
        if (action === "cancel") {
          // Kill a running agent if present, then mark cancelled.
          try {
            const { agentManager } = await import("@/lib/orchestrator/agent-manager");
            await agentManager.killAgentByTaskId(tid);
          } catch { /* not running */ }
          const t = await Task.findByIdAndUpdate(tid, { status: "cancelled", agentPid: null });
          if (!t) { json(res, 404, { error: "Not found" }); return; }
          broadcast("tasks:updated", { taskId: tid, status: "cancelled" });
          json(res, 200, t); return;
        }
        // archive
        const t = await Task.findByIdAndUpdate(tid, { status: "archived" });
        if (!t) { json(res, 404, { error: "Not found" }); return; }
        broadcast("tasks:updated", { taskId: tid, status: "archived" });
        json(res, 200, t); return;
      }

      // DELETE /tasks/:id — hard delete
      if (req.method === "DELETE" && taskMatch) {
        const { Task } = await import("@/lib/db");
        await Task.findByIdAndDelete(taskMatch[1]);
        broadcast("tasks:updated", { taskId: taskMatch[1], deleted: true });
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

      // PATCH /directives/:id — update a directive (any subset of fields)
      if (req.method === "PATCH" && dirMatch) {
        const store = await import("@/lib/orchestrator/directive-store");
        const existing = store.getDirective(dirMatch[1]);
        if (!existing) { json(res, 404, { error: "Not found" }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const fields: Record<string, string | null> = {};
        for (const key of ["goal", "status", "profile", "project", "projectPath", "retiredReason"]) {
          if (body[key] !== undefined) fields[key] = String(body[key]);
        }
        if (body.triggerPolicy !== undefined) fields.triggerPolicy = JSON.stringify(body.triggerPolicy);
        if (body.budgetPolicy !== undefined) fields.budgetPolicy = JSON.stringify(body.budgetPolicy);
        if (body.approvalPolicy !== undefined) fields.approvalPolicy = JSON.stringify(body.approvalPolicy);
        if (body.brainSelection !== undefined) fields.brainSelection = JSON.stringify(body.brainSelection);
        if (body.nextRunAt !== undefined) fields.nextRunAt = body.nextRunAt ? String(body.nextRunAt) : null;
        store.updateDirective(dirMatch[1], fields);
        broadcast("directives:updated", { directiveId: dirMatch[1] });
        json(res, 200, store.getDirective(dirMatch[1]));
        return;
      }

      // DELETE /directives/:id — delete a directive and all associated data
      if (req.method === "DELETE" && dirMatch) {
        const store = await import("@/lib/orchestrator/directive-store");
        const deleted = store.deleteDirective(dirMatch[1]);
        if (!deleted) { json(res, 404, { error: "Not found" }); return; }
        broadcast("directives:deleted", { directiveId: dirMatch[1] });
        json(res, 204, null);
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
