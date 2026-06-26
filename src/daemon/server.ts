/**
 * HiveMatrix Daemon HTTP server.
 *
 * Exposes a REST + SSE API consumed by the console (Next.js or Tauri).
 * Uses Node's built-in http module — no framework dependency.
 *
 * Routes:
 *   GET  /health                     — daemon health snapshot
 *   GET  /connectivity               — current connectivity state
 *   GET  /posture                    — capability dispositions for each connectivity mode
 *   POST /connectivity/mode          — manual override { mode: 'cloud-ok'|'local-only'|'offline'|null }
 *   GET  /tasks                      — list tasks (query: status, profile, project)
 *   GET  /tasks/:id                  — get task
 *   POST /tasks                      — create task
 *   PATCH /tasks/:id                 — update task fields
 *   DELETE /tasks/:id                — cancel/delete task
 *   GET  /events                     — SSE stream (tasks:*, connectivity:*)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve, sep } from "path";
import { getDb } from "@/lib/db";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import type { ConnectivityMode } from "@/lib/connectivity/policy";
import { setBroadcastFn, setBroadcastEventFn } from "@/lib/ws/broadcaster";
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

export function consoleHtmlHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  };
}

export function normalizeHomeProjectPath(input: unknown, home = homedir()): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("projectPath is required");
  }

  const normalizedHome = resolve(home);
  const raw = input.trim();
  let expanded = raw;
  if (raw === "~") {
    expanded = normalizedHome;
  } else if (raw.startsWith("~/")) {
    expanded = `${normalizedHome}${sep}${raw.slice(2)}`;
  } else if (raw === "$HOME" || raw === "${HOME}") {
    expanded = normalizedHome;
  } else if (raw.startsWith("$HOME/")) {
    expanded = `${normalizedHome}${sep}${raw.slice(6)}`;
  } else if (raw.startsWith("${HOME}/")) {
    expanded = `${normalizedHome}${sep}${raw.slice(8)}`;
  }

  const resolved = resolve(expanded);
  if (resolved === sep) {
    throw new Error("projectPath cannot be root (/)");
  }
  if (resolved !== normalizedHome && !resolved.startsWith(`${normalizedHome}${sep}`)) {
    throw new Error(`projectPath must be under $HOME (${normalizedHome})`);
  }
  return resolved;
}

function mermaidAssetPath(): string | null {
  const argvDir = process.argv[1] ? dirname(resolve(process.argv[1])) : "";
  const candidates = [
    argvDir ? resolve(argvDir, "assets", "mermaid.min.js") : "",
    resolve(process.cwd(), "dist", "daemon", "assets", "mermaid.min.js"),
    resolve(process.cwd(), "node_modules", "mermaid", "dist", "mermaid.min.js"),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function serveMermaidAsset(res: ServerResponse): void {
  const asset = mermaidAssetPath();
  if (!asset) {
    json(res, 404, { error: "mermaid asset not found" });
    return;
  }
  const buf = readFileSync(asset);
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Content-Length": buf.length,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  res.end(buf);
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

/** Read the raw request body as a string (no parsing). */
function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
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
  // Named-event channel (e.g. voice:result) for in-process modules.
  setBroadcastEventFn((event, data) => broadcast(event, data));

  // Broadcast mode changes over SSE
  policy.on("modeChange", (state) => {
    broadcast("connectivity:change", state);
  });

  // Routes servable without the token: liveness + the console page itself
  // (the page receives the token injected into its HTML, same-origin only).
  const isPublicRoute = (method: string, path: string) =>
    method === "GET" && (path === "/health" || path === "/" || path === "/console" || path === "/assets/mermaid.min.js");

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
        res.writeHead(200, consoleHtmlHeaders());
        res.end(CONSOLE_HTML.replace("%%HM_TOKEN%%", viaCloudflare ? "" : AUTH_TOKEN));
        return;
      }

      if (req.method === "GET" && urlPath === "/assets/mermaid.min.js") {
        serveMermaidAsset(res);
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
        const { getLicenseStatus } = await import("@/lib/license/license");
        json(res, 200, {
          status: "ok",
          version: getBundledVersion(),
          connectivity: policy.mode,
          activeTasks: taskCount,
          uptime: process.uptime(),
          license: getLicenseStatus().state,
        });
        return;
      }

      // GET /system/readiness — read-only result-quality truth surface. It
      // aggregates readiness and stale-state signals; it never seeds, installs,
      // launches, repairs, approves, or mutates state.
      if (req.method === "GET" && urlPath === "/system/readiness") {
        const { getSystemReadinessReport } = await import("@/lib/system-readiness");
        const report = await getSystemReadinessReport({ connectivity: () => policy.mode });
        json(res, 200, { ok: report.ok, report });
        return;
      }

      // POST /system/readiness/repair — explicit, allow-listed repair actions.
      // There is intentionally no "repair all"; every mutation is one operator
      // click and the implementation owns the action allowlist:
      // seed_coo_rules, seed_heygen_browser_site, refresh_legacy_video_reviews.
      if (req.method === "POST" && urlPath === "/system/readiness/repair") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { performSystemReadinessRepair } = await import("@/lib/system-readiness");
          const result = await performSystemReadinessRepair({ action: body.action }, { connectivity: () => policy.mode });
          json(res, 200, result);
        } catch (err) {
          json(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // GET /projects — discovered projects for the project selector
      if (req.method === "GET" && urlPath === "/projects") {
        const { discoverProjects, discoverProjectsFresh, shouldPreSelect } = await import("@/lib/routing/project-discovery");
        // ?fresh=1 bypasses the 5-min cache (the "Re-scan" button).
        const fresh = parseQueryString(req.url ?? "").fresh === "1";
        const projects = fresh ? discoverProjectsFresh() : discoverProjects();
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
        const { buildAvailableModels, buildRoleModelOptions, getDefaultModel, getThemeSettings } = await import("@/lib/models/available");
        const { localEngineStatus, localEngineCapability } = await import("@/lib/models/local-engine");
        const { versionInfo } = await import("@/lib/version");
        const backends = detectBackends();
        const available = buildAvailableModels(backends);
        const theme = getThemeSettings();
        const localEngine = await localEngineStatus();
        const localEngineCap = localEngineCapability();
        const { getLocation, getAutoUpdate, getAppIconChoice, getFrontierProvider, getRoleModels } = await import("@/lib/models/available");
        json(res, 200, {
          backends,
          localEngine,
          localEngineCapability: localEngineCap,
          available,
          defaultModel: getDefaultModel(available),
          version: versionInfo(),
          theme: theme.theme,
          hasWallpaper: !!theme.wallpaperPath,
          wallpaperPath: theme.wallpaperPath,
          wallpaperOpacity: theme.wallpaperOpacity,
          location: getLocation(),
          autoUpdate: getAutoUpdate(),
          appIconChoice: getAppIconChoice(),
          frontierProvider: getFrontierProvider(),
          roleModels: getRoleModels(),
          roleModelOptions: buildRoleModelOptions(backends),
        });
        return;
      }

      // GET /settings/keys — which API keys (env vars) are SET. Never returns
      // values — only env name, label, purpose, and a boolean. Keys are provided
      // via environment variables, not config.json.
      if (req.method === "GET" && urlPath === "/settings/keys") {
        const { secretStatuses } = await import("@/lib/config/secrets");
        json(res, 200, { keys: secretStatuses() });
        return;
      }

      // GET /settings/features — feature flags + on/off state + machine capability.
      if (req.method === "GET" && urlPath === "/settings/features") {
        const { getFeatureFlags, KNOWN_FEATURES, featureCapability } = await import("@/lib/config/features");
        const flags = getFeatureFlags();
        json(res, 200, { features: KNOWN_FEATURES.map((f) => {
          const cap = featureCapability(f.key);
          return { ...f, enabled: flags[f.key] === true, capable: cap.capable, reason: cap.reason ?? null };
        }) });
        return;
      }
      // POST /settings/features — { key, enabled } toggle a flag.
      if (req.method === "POST" && urlPath === "/settings/features") {
        const { setFeature, KNOWN_FEATURES, featureCapability } = await import("@/lib/config/features");
        const body = await parseBody(req) as Record<string, unknown>;
        const key = String(body.key ?? "");
        if (!KNOWN_FEATURES.some((f) => f.key === key)) { json(res, 400, { error: `unknown feature "${key}"` }); return; }
        // Don't let a feature be enabled on a machine that can't run it.
        if (body.enabled === true) {
          const cap = featureCapability(key);
          if (!cap.capable) { json(res, 400, { error: cap.reason ?? "not available on this machine" }); return; }
        }
        const flags = setFeature(key as typeof KNOWN_FEATURES[number]["key"], body.enabled === true);
        json(res, 200, { features: flags });
        return;
      }
      // GET/POST /settings/voice/auto-approval — conservative voice approval policy.
      if (req.method === "GET" && urlPath === "/settings/voice/auto-approval") {
        const { getAutoApprovalPolicy } = await import("@/lib/voice/auto-approval-policy");
        json(res, 200, { policy: getAutoApprovalPolicy() });
        return;
      }
      if (req.method === "POST" && urlPath === "/settings/voice/auto-approval") {
        const { setAutoApprovalPolicy } = await import("@/lib/voice/auto-approval-policy");
        const body = await parseBody(req) as Record<string, unknown>;
        json(res, 200, {
          policy: setAutoApprovalPolicy({
            enabled: body.enabled === true,
            allowCheckpoints: body.allowCheckpoints === true,
            allowLowRiskTools: body.allowLowRiskTools === true,
          }),
        });
        return;
      }

      // GET/POST /settings/briefing — proactive morning briefing (enabled + hour).
      if (req.method === "GET" && urlPath === "/settings/briefing") {
        const { getMorningBriefingConfig } = await import("@/lib/briefing/morning-briefing");
        const { getApnsConfig, listApnsDevices } = await import("@/lib/notify/apns");
        json(res, 200, { briefing: getMorningBriefingConfig(), apnsConfigured: getApnsConfig() !== null, devices: listApnsDevices().length });
        return;
      }
      if (req.method === "POST" && urlPath === "/settings/briefing") {
        const { setMorningBriefingConfig } = await import("@/lib/briefing/morning-briefing");
        const body = await parseBody(req) as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        if ("enabled" in body) patch.enabled = body.enabled === true;
        if (typeof body.hour === "number") patch.hour = body.hour;
        json(res, 200, { briefing: setMorningBriefingConfig(patch) });
        return;
      }
      // GET/POST /settings/browser-lane-readiness — scheduled readiness sweep config.
      if (req.method === "GET" && urlPath === "/settings/browser-lane-readiness") {
        const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
        json(res, 200, { readiness: getBrowserLaneReadinessConfig() });
        return;
      }
      if (req.method === "POST" && urlPath === "/settings/browser-lane-readiness") {
        const { setBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
        const body = await parseBody(req) as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        if ("enabled" in body) patch.enabled = body.enabled === true;
        if (typeof body.hour === "number") patch.hour = body.hour;
        if (typeof body.staleAfterHours === "number") patch.staleAfterHours = body.staleAfterHours;
        json(res, 200, { readiness: setBrowserLaneReadinessConfig(patch) });
        return;
      }
      // POST /briefing/test — deliver the briefing right now (verify push wiring).
      if (req.method === "POST" && urlPath === "/briefing/test") {
        const { runBriefingNow } = await import("@/lib/briefing/morning-briefing");
        json(res, 200, await runBriefingNow());
        return;
      }

      // GET /releases — browsable changelog (version · date · one-line note).
      if (req.method === "GET" && urlPath === "/releases") {
        const { CHANGELOG } = await import("@/lib/version/changelog");
        json(res, 200, { releases: CHANGELOG });
        return;
      }

      // POST /devices/register — iOS app registers its APNs device token.
      if (req.method === "POST" && urlPath === "/devices/register") {
        const { registerApnsDevice } = await import("@/lib/notify/apns");
        const body = await parseBody(req) as Record<string, unknown>;
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!token) { json(res, 400, { error: "token required" }); return; }
        const env = body.env === "production" || body.env === "sandbox" ? body.env : undefined;
        const devices = registerApnsDevice({ token, env, platform: typeof body.platform === "string" ? body.platform : "ios" });
        json(res, 200, { devices: devices.length });
        return;
      }
      // POST /devices/unregister — drop a device token (logout / token rotation).
      if (req.method === "POST" && urlPath === "/devices/unregister") {
        const { unregisterApnsDevice } = await import("@/lib/notify/apns");
        const body = await parseBody(req) as Record<string, unknown>;
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!token) { json(res, 400, { error: "token required" }); return; }
        const devices = unregisterApnsDevice(token);
        json(res, 200, { devices: devices.length });
        return;
      }

      // GET /ado — Azure DevOps status (flag on? org configured? auth ready?).
      if (req.method === "GET" && urlPath === "/ado") {
        const { adoStatus } = await import("@/lib/ado/mcp");
        json(res, 200, adoStatus());
        return;
      }

      // POST /settings — default model, local endpoint, theme, wallpaper
      if (req.method === "POST" && urlPath === "/settings") {
        const body = await parseBody(req) as Record<string, unknown>;
        const m = await import("@/lib/models/available");
        if (typeof body.defaultModel === "string") m.setDefaultModel(body.defaultModel);
        if (typeof body.localEndpoint === "string" && body.localEndpoint.trim()) m.setLocalEndpoint(body.localEndpoint.trim());
        if (body.theme === "system" || body.theme === "light" || body.theme === "dark" || body.theme === "matrix") m.setTheme(body.theme);
        if (typeof body.wallpaperPath === "string") m.setWallpaperPath(body.wallpaperPath.trim() || null);
        if (body.wallpaperPath === null) m.setWallpaperPath(null);
        if (typeof body.wallpaperData === "string" && typeof body.wallpaperExt === "string") {
          m.saveWallpaperUpload(body.wallpaperData, body.wallpaperExt);
        }
        if (typeof body.wallpaperOpacity === "number") m.setWallpaperOpacity(body.wallpaperOpacity);
        if (typeof body.location === "string") m.setLocation(body.location);
        if (typeof body.autoUpdate === "boolean") m.setAutoUpdate(body.autoUpdate);
        if (body.appIconChoice === "dark-green" || body.appIconChoice === "white") m.setAppIconChoice(body.appIconChoice);
        if (body.frontierProvider === "claude" || body.frontierProvider === "codex") m.setFrontierProvider(body.frontierProvider);
        if (body.roleModel && typeof body.roleModel === "object") {
          const rm = body.roleModel as { role?: unknown; modelId?: unknown };
          if ((rm.role === "thinking" || rm.role === "coding" || rm.role === "operational" || rm.role === "writer") && typeof rm.modelId === "string") {
            m.setRoleModel(rm.role, rm.modelId);
          }
        }
        const available = m.buildAvailableModels();
        const theme = m.getThemeSettings();
        json(res, 200, { ok: true, defaultModel: m.getDefaultModel(available), theme: theme.theme,
          hasWallpaper: !!theme.wallpaperPath, wallpaperPath: theme.wallpaperPath,
          wallpaperOpacity: theme.wallpaperOpacity, location: m.getLocation(), autoUpdate: m.getAutoUpdate(),
          appIconChoice: m.getAppIconChoice() });
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

      // GET /observability — normalized per-run telemetry + totals across all
      // three providers (Claude / Codex / local Qwen). ?taskId=… for one task.
      if (req.method === "GET" && urlPath === "/observability") {
        const { listTaskTelemetry, getTaskTelemetry, observabilitySummary } = await import("@/lib/observability/store");
        const oq = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const taskId = oq.get("taskId");
        if (taskId) {
          json(res, 200, { taskId, runs: getTaskTelemetry(taskId) });
          return;
        }
        const limit = parseInt(oq.get("limit") ?? "50", 10) || 50;
        json(res, 200, { totals: observabilitySummary(), recent: listTaskTelemetry(limit) });
        return;
      }

      // GET /observability/series?window=24h|7d|30d — time-bucketed telemetry +
      // per-provider cache rollups for the dashboard (all three providers).
      if (req.method === "GET" && urlPath === "/observability/series") {
        const { observabilitySeries } = await import("@/lib/observability/series");
        const sq = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const w = sq.get("window");
        const window = w === "24h" || w === "30d" ? w : "7d";
        json(res, 200, observabilitySeries(window));
        return;
      }

      // GET /update/check — query the configured release channel for an update
      if (req.method === "GET" && urlPath === "/update/check") {
        const { checkUpdateStatus } = await import("@/lib/updater/daemon-update");
        json(res, 200, await checkUpdateStatus());
        return;
      }
      // GET /usage — frontier model spend aggregated from task outputs
      if (req.method === "GET" && urlPath === "/usage") {
        const { getFrontierUsage } = await import("@/lib/usage/frontier-usage");
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        json(res, 200, await getFrontierUsage({ bypassSubscriptionCache: q.get("refresh") === "1" }));
        return;
      }
      // POST /claude/auth/login — open Terminal for the interactive Claude CLI OAuth flow.
      if (req.method === "POST" && urlPath === "/claude/auth/login") {
        const { startClaudeAuthLogin } = await import("@/lib/usage/claude-auth-login");
        try {
          json(res, 200, await startClaudeAuthLogin());
        } catch (e) {
          json(res, 500, {
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      // GET /update/status — compare the GitHub release feed to the running version (drives the console pill)
      if (req.method === "GET" && urlPath === "/update/status") {
        const { getUpdateStatus } = await import("@/lib/updater/feed-check");
        json(res, 200, await getUpdateStatus());
        return;
      }
      // POST /update/apply — relaunch the desktop app so its updater installs the update
      if (req.method === "POST" && urlPath === "/update/apply") {
        const { applyUpdateViaRelaunch } = await import("@/lib/updater/feed-check");
        json(res, 200, applyUpdateViaRelaunch());
        return;
      }

      // GET /onboarding — first-run / readiness checklist
      if (req.method === "GET" && urlPath === "/onboarding") {
        const { getOnboardingStatus } = await import("@/lib/onboarding/onboarding");
        const { probeDesktopBeeHelper, dispatchDesktopBeeAction } = await import("@/lib/desktopbee/client");
        // Live-probe the Desktop Lane helper for build + permission state.
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
        const { probeChatDbAccess } = await import("@/lib/messagebee/imessage");
        const chatDbProbe = probeChatDbAccess();
        const messagebee = { enabled: isChannelEnabled(), chatDbReadable: chatDbProbe.ok, chatDbDetail: chatDbProbe.detail };
        const { isChannelEnabled: mailEnabled } = await import("@/lib/mailbee/store");
        const { canControlMail } = await import("@/lib/mailbee/applemail");
        const mailbee = { enabled: mailEnabled(), mailControllable: await canControlMail() };
        json(res, 200, getOnboardingStatus({ helperBuilt, desktopPermissions, messagebee, mailbee }));
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

      // POST /onboarding/desktopbee — compatibility route for installing the Desktop Lane helper.
      if (req.method === "POST" && urlPath === "/onboarding/desktopbee") {
        const { installDesktopBeeHelper } = await import("@/lib/onboarding/actions");
        json(res, 200, installDesktopBeeHelper());
        return;
      }
      // POST /onboarding/messagebee — compatibility route for Message Lane setup.
      if (req.method === "POST" && urlPath === "/onboarding/messagebee") {
        const body = await parseBody(req) as { enable?: boolean; phone?: string; displayName?: string };
        const { configureMessageBee } = await import("@/lib/onboarding/actions");
        json(res, 200, await configureMessageBee(body ?? {}));
        return;
      }
      // POST /onboarding/mailbee — compatibility route for Mail Lane setup.
      if (req.method === "POST" && urlPath === "/onboarding/mailbee") {
        const body = await parseBody(req) as { enable?: boolean; email?: string; displayName?: string };
        const { configureMailBee } = await import("@/lib/onboarding/actions");
        json(res, 200, await configureMailBee(body ?? {}));
        return;
      }
      // GET /messagebee/ignored — non-allowlisted senders seen recently (one-click allow)
      if (req.method === "GET" && urlPath === "/messagebee/ignored") {
        const { listIgnoredSenders } = await import("@/lib/messagebee/store");
        json(res, 200, { ignored: listIgnoredSenders() });
        return;
      }
      // POST /messagebee/allow — allowlist a handle and drop it from the ignored list
      if (req.method === "POST" && urlPath === "/messagebee/allow") {
        const body = await parseBody(req) as { address?: string };
        const address = String(body.address ?? "").trim();
        if (!address) { json(res, 400, { error: "address required" }); return; }
        const { upsertIdentity, clearIgnoredSender } = await import("@/lib/messagebee/store");
        upsertIdentity(address, "allowed");
        clearIgnoredSender(address);
        json(res, 200, { ok: true, address });
        return;
      }
      // POST /system/open-pane — open a macOS privacy pane natively (webview window.open can't)
      if (req.method === "POST" && urlPath === "/system/open-pane") {
        const body = await parseBody(req) as { pane?: string };
        const allowed = ["accessibility", "screenRecording", "fullDiskAccess", "automation"];
        if (!body?.pane || !allowed.includes(body.pane)) { json(res, 400, { ok: false, detail: "invalid pane" }); return; }
        const { openSystemSettingsPane } = await import("@/lib/onboarding/actions");
        json(res, 200, openSystemSettingsPane(body.pane as "accessibility" | "screenRecording" | "fullDiskAccess" | "automation"));
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
      // POST /tunnel/configure-named — persist/adopt a named tunnel hostname for pairing.
      if (req.method === "POST" && urlPath === "/tunnel/configure-named") {
        const { configureNamedTunnel } = await import("@/lib/tunnel/cloudflared");
        const body = await parseBody(req) as Record<string, unknown>;
        const hostname = String(body.hostname ?? "").trim();
        if (!hostname) { json(res, 400, { error: "hostname required" }); return; }
        json(res, 200, configureNamedTunnel(hostname));
        return;
      }
      // POST /tunnel/access-credentials — persist optional Cloudflare Access service-token credentials for mobile pairing.
      if (req.method === "POST" && urlPath === "/tunnel/access-credentials") {
        const { updateNamedTunnelAccess } = await import("@/lib/tunnel/cloudflared");
        const body = await parseBody(req) as Record<string, unknown>;
        json(res, 200, updateNamedTunnelAccess({
          cloudflareAccessClientId: String(body.cloudflareAccessClientId ?? ""),
          cloudflareAccessClientSecret: String(body.cloudflareAccessClientSecret ?? ""),
        }));
        return;
      }
      // GET /tunnel/qr — QR (SVG) of the pairing payload {url, token} for iOS.
      // Generated locally via qrencode; the token never leaves the machine.
      if (req.method === "GET" && urlPath === "/tunnel/qr") {
        const { tunnelStatus, pairingPayload, generateQrSvg } = await import("@/lib/tunnel/cloudflared");
        const { readRemoteAccessSettings } = await import("@/lib/tunnel/remote-access-settings");
        const st = tunnelStatus();
        if (!st.url) { json(res, 400, { error: "no tunnel running" }); return; }
        if (!st.qrInstalled) { json(res, 503, { error: "qrencode not installed (brew install qrencode)" }); return; }
        const settings = readRemoteAccessSettings();
        const svg = await generateQrSvg(pairingPayload(st.url, AUTH_TOKEN, {
          cloudflareAccessClientId: settings.cloudflareAccessClientId,
          cloudflareAccessClientSecret: settings.cloudflareAccessClientSecret,
        }));
        if (!svg) { json(res, 500, { error: "qr generation failed" }); return; }
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(svg);
        return;
      }

      // GET /lanes — status of every embedded/managed lane (Settings view)
      if (req.method === "GET" && urlPath === "/lanes") {
        const { listLaneServiceStatuses } = await import("@/lib/lanes/status");
        json(res, 200, { lanes: await listLaneServiceStatuses() });
        return;
      }

      // GET /bees — compatibility status for older clients.
      if (req.method === "GET" && urlPath === "/bees") {
        const { listLaneServiceStatuses } = await import("@/lib/lanes/status");
        json(res, 200, { bees: await listLaneServiceStatuses() });
        return;
      }

      // GET /local-model/status — local serving supervisor state (managed, healthy, pid…)
      if (req.method === "GET" && urlPath === "/local-model/status") {
        const { getServingStatus } = await import("@/lib/local-model/serving");
        json(res, 200, getServingStatus());
        return;
      }

      // GET /local-engine/provision — provisioning plan (what fits this Mac) + job status.
      if (req.method === "GET" && urlPath === "/local-engine/provision") {
        const { planLocalEngine, getProvisionStatus } = await import("@/lib/models/provision");
        json(res, 200, { plan: planLocalEngine(), status: getProvisionStatus() });
        return;
      }
      // POST /local-engine/provision — start a background provision (install + pull + write config).
      if (req.method === "POST" && urlPath === "/local-engine/provision") {
        const { startProvision } = await import("@/lib/models/provision");
        json(res, 202, startProvision());
        return;
      }

      // GET /messagebee — channel status (enabled, chat.db readable, allowlist)
      if (req.method === "GET" && urlPath === "/messagebee") {
        const { isChannelEnabled, listIdentities } = await import("@/lib/messagebee/store");
        const { probeChatDbAccess } = await import("@/lib/messagebee/imessage");
        const chatDbProbe = probeChatDbAccess();
        json(res, 200, {
          enabled: isChannelEnabled(),
          chatDbReadable: chatDbProbe.ok,
          chatDbDetail: chatDbProbe.detail,
          identities: listIdentities(),
        });
        return;
      }

      // POST /messagebee/enable — { enabled: boolean }. On enable, set the
      // high-water mark to the current max ROWID so we never replay history.
      if (req.method === "POST" && urlPath === "/messagebee/enable") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { setChannelEnabled, setLastRowid, ensureChannel } = await import("@/lib/messagebee/store");
        const { currentMaxRowid, probeChatDbAccess } = await import("@/lib/messagebee/imessage");
        const enabled = body.enabled !== false;
        ensureChannel();
        if (enabled) {
          const chatDbProbe = probeChatDbAccess();
          if (!chatDbProbe.ok) { json(res, 412, { error: chatDbProbe.detail }); return; }
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

      // GET /posture — per-mode capability disposition (works/degraded/queued)
      if (req.method === "GET" && urlPath === "/posture") {
        const { getPostureReport } = await import("@/lib/connectivity/posture");
        json(res, 200, getPostureReport());
        return;
      }

      // GET /frontier-debt/status — pending/drained frontier-review-debt counts
      if (req.method === "GET" && urlPath === "/frontier-debt/status") {
        const { getDebtStatus } = await import("@/lib/orchestrator/frontier-debt");
        json(res, 200, getDebtStatus());
        return;
      }

      // Review Lane — control-plane heartbeat + diagnostics (W4.2)
      if (req.method === "GET" && (urlPath === "/managerbee/status" || urlPath === "/api/managerbee/health")) {
        const { getManagerBeeStatus } = await import("@/lib/managerbee/heartbeat");
        const report = getManagerBeeStatus();
        json(res, 200, urlPath === "/api/managerbee/health"
          ? { bee: "managerbee", ok: report.health === "ok", health: report.health, report }
          : report);
        return;
      }

      // Memory Lane — playbook-hygiene status (W4.2)
      if (req.method === "GET" && (urlPath === "/brainbee/status" || urlPath === "/api/brainbee/health")) {
        const { getBrainBeeStatus } = await import("@/lib/brainbee/poller");
        const status = getBrainBeeStatus();
        json(res, 200, urlPath === "/api/brainbee/health"
          ? { bee: "brainbee", ok: status.enabled, ...status }
          : status);
        return;
      }

      // Telemetry — opt-in, local-first (W7.2)
      if (req.method === "GET" && urlPath === "/telemetry/status") {
        const { getTelemetrySummary } = await import("@/lib/telemetry/telemetry");
        json(res, 200, getTelemetrySummary());
        return;
      }
      if (req.method === "POST" && urlPath === "/telemetry/config") {
        const { setTelemetryEnabled } = await import("@/lib/telemetry/telemetry");
        const body = await parseBody(req) as Record<string, unknown>;
        json(res, 200, setTelemetryEnabled(body.enabled === true));
        return;
      }
      if (req.method === "POST" && urlPath === "/telemetry/clear") {
        const { clearTelemetry } = await import("@/lib/telemetry/telemetry");
        json(res, 200, { cleared: clearTelemetry() });
        return;
      }

      // GET /diagnostics/bundle — operational support bundle (opt-in to send) (W7.2)
      if (req.method === "GET" && urlPath === "/diagnostics/bundle") {
        const { buildDiagnosticsBundle } = await import("@/lib/telemetry/diagnostics");
        const { getBundledVersion } = await import("@/lib/version/bundle-version");
        json(res, 200, buildDiagnosticsBundle({ version: getBundledVersion(), connectivity: policy.mode }));
        return;
      }

      // License — local, offline-friendly verification (W7.3)
      if (req.method === "GET" && urlPath === "/license/status") {
        const { getLicenseStatus } = await import("@/lib/license/license");
        json(res, 200, getLicenseStatus());
        return;
      }
      if (req.method === "POST" && urlPath === "/license") {
        const { installLicense } = await import("@/lib/license/license");
        const body = await parseBody(req) as Record<string, unknown>;
        if (!body || typeof body !== "object" || !body.payload || typeof body.signature !== "string") {
          json(res, 400, { error: "expected a signed license { payload, signature }" });
          return;
        }
        json(res, 200, installLicense(body as never));
        return;
      }

      // GET /feedback/loop-health — the self-improvement signal: how much of the
      // captured backlog (incl. items auto-filed from directive reflection) is
      // actually being resolved, how many issues recur, and backlog age.
      if (req.method === "GET" && urlPath === "/feedback/loop-health") {
        const { loopHealth } = await import("@/lib/feedback/self-improvement");
        json(res, 200, loopHealth());
        return;
      }

      // GET /feedback/for-planning?n= — the open backlog (oldest first) a
      // maintenance/self-improvement directive can pull into its plan, plus a
      // ready-to-inject prompt fragment.
      if (req.method === "GET" && urlPath === "/feedback/for-planning") {
        const { openFeedbackForPlanning, formatOpenFeedbackForPlanning } = await import("@/lib/feedback/self-improvement");
        const nRaw = parseInt(parseQueryString(req.url ?? "").n ?? "", 10);
        const limit = Number.isFinite(nRaw) && nRaw > 0 ? Math.min(nRaw, 50) : undefined;
        json(res, 200, { items: openFeedbackForPlanning(limit), promptFragment: formatOpenFeedbackForPlanning(limit) });
        return;
      }

      // POST /feedback/:id/work — producer (operator): turn a feedback item into
      // a feedback-linked task and move the item to triaged. When the task
      // completes, Hook A advances the item (→ done if proven).
      const feedbackWorkMatch = urlPath.match(/^\/feedback\/([^/]+)\/work$/);
      if (req.method === "POST" && feedbackWorkMatch) {
        const { getFeedback, setFeedbackStatus } = await import("@/lib/feedback/feedback");
        const { Task, generateId } = await import("@/lib/db");
        const item = getFeedback(feedbackWorkMatch[1]);
        if (!item) { json(res, 404, { error: "feedback not found" }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const task = await Task.create({
          _id: generateId(),
          title: `[feedback] ${item.title.slice(0, 60)}`,
          description: `Address this ${item.kind} from the feedback backlog:\n\n${item.title}\n\n${item.detail ?? ""}`.trim(),
          project: typeof body.project === "string" ? body.project : "hivematrix",
          projectPath: typeof body.projectPath === "string" ? body.projectPath : process.cwd(),
          profile: typeof body.agentType === "string" ? body.agentType : "developer",
          status: "backlog",
          executor: "agent",
          source: "feedback",
          output: { feedbackId: item._id },
        });
        setFeedbackStatus(item._id, "triaged");
        broadcast("tasks:created", { taskId: task._id });
        json(res, 201, { task, feedback: getFeedback(item._id) });
        return;
      }

      // POST /feedback/maintenance-directive — producer (autonomous): install the
      // standing self-improvement directive that pulls the backlog each run.
      if (req.method === "POST" && urlPath === "/feedback/maintenance-directive") {
        const { buildSelfImprovementDirective } = await import("@/lib/feedback/self-improvement");
        const { createDirective } = await import("@/lib/orchestrator/directive-store");
        const body = await parseBody(req) as Record<string, unknown>;
        const directive = createDirective(buildSelfImprovementDirective({
          project: typeof body.project === "string" ? body.project : undefined,
          projectPath: typeof body.projectPath === "string" ? body.projectPath : undefined,
          dailyAtHour: typeof body.dailyAtHour === "number" ? body.dailyAtHour : undefined,
        }));
        json(res, 201, directive);
        return;
      }

      // GET /youtube — watcher status (configured? enabled? last poll/error + counts).
      if (req.method === "GET" && urlPath === "/youtube") {
        const { getYouTubeConfig, isYouTubeWatcherEnabled } = await import("@/lib/youtube/config");
        const { getWatcherState } = await import("@/lib/youtube/store");
        const cfg = getYouTubeConfig();
        json(res, 200, {
          configured: !!cfg && !!cfg.apiKey && !!cfg.playlistId,
          enabled: isYouTubeWatcherEnabled(),
          playlistId: cfg?.playlistId ?? null,
          pollIntervalMinutes: cfg?.pollIntervalMinutes ?? null,
          state: getWatcherState(),
        });
        return;
      }

      // POST /youtube/poll — run one watcher cycle now (manual trigger for setup/testing).
      if (req.method === "POST" && urlPath === "/youtube/poll") {
        const { isYouTubeWatcherEnabled } = await import("@/lib/youtube/config");
        if (!isYouTubeWatcherEnabled()) {
          json(res, 400, { error: "YouTube watcher is not configured/enabled (set youtube.enabled, apiKey, playlistId in ~/.hivematrix/config.json)" });
          return;
        }
        const { pollOnce } = await import("@/lib/youtube/poller");
        const { getWatcherState } = await import("@/lib/youtube/store");
        await pollOnce();
        json(res, 200, { ok: true, state: getWatcherState() });
        return;
      }

      // POST /digest — "drop in a link" → a task fetches + summarizes the URL and
      // saves a markdown brain doc for review (scenario #43, the article path the
      // YouTube watcher doesn't cover). No external dependency.
      if (req.method === "POST" && urlPath === "/digest") {
        const { isHttpUrl, digestDocFilename, buildDigestTaskDescription } = await import("@/lib/digest/contracts");
        const { configuredBrainRootDir, defaultBrainRootDir } = await import("@/lib/brain/settings");
        const { Task, generateId } = await import("@/lib/db");
        const body = await parseBody(req) as Record<string, unknown>;
        const url = typeof body.url === "string" ? body.url.trim() : "";
        if (!isHttpUrl(url)) { json(res, 400, { error: "a valid http(s) url is required" }); return; }
        const note = typeof body.note === "string" ? body.note : undefined;
        const root = configuredBrainRootDir() ?? defaultBrainRootDir();
        const dateStr = new Date().toISOString().slice(0, 10);
        const docPath = `${root}/digests/${digestDocFilename(url, dateStr)}`;
        const task = await Task.create({
          _id: generateId(),
          title: `[digest] ${url.slice(0, 60)}`,
          description: buildDigestTaskDescription({ url, note, docPath }),
          project: "ops",
          projectPath: process.cwd(),
          profile: "researcher",
          status: "backlog",
          executor: "agent",
          source: "digest",
          output: { digest: { url, docPath } },
        });
        broadcast("tasks:created", { taskId: task._id });
        json(res, 201, { task, docPath });
        return;
      }

      // GET /brain/links — `[[wikilink]]` graph. ?doc=NAME → forward+backlinks
      // for one doc; otherwise the whole graph (nodes with their links).
      if (req.method === "GET" && urlPath === "/brain/links") {
        const { buildLinkGraph, linksForDoc } = await import("@/lib/brain/links");
        const q = parseQueryString(req.url ?? "");
        const graph = await buildLinkGraph();
        const doc = (q.doc ?? "").trim();
        if (doc) { json(res, 200, { doc, ...linksForDoc(doc, graph) }); return; }
        json(res, 200, { nodes: graph.nodes });
        return;
      }

      // GET /brain/hygiene — corpus stale + duplicate/near-duplicate report.
      // ?staleDays=180&threshold=0.85 optional.
      if (req.method === "GET" && urlPath === "/brain/hygiene") {
        const { scanBrainHygiene } = await import("@/lib/brain/hygiene");
        const q = parseQueryString(req.url ?? "");
        const staleDays = Number.parseInt(q.staleDays ?? "", 10);
        const threshold = Number.parseFloat(q.threshold ?? "");
        json(res, 200, await scanBrainHygiene({
          staleDays: Number.isFinite(staleDays) && staleDays > 0 ? staleDays : undefined,
          threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : undefined,
        }));
        return;
      }

      // POST /brain/summarize — create an agent task that writes a "what shifted"
      // weekly digest of recently-changed brain docs. Body: { sinceDays? }.
      if (req.method === "POST" && urlPath === "/brain/summarize") {
        const { recentBrainDocs, weeklyDigestFilename, buildBrainDigestTaskDescription } = await import("@/lib/brain/summary");
        const { configuredBrainRootDir, defaultBrainRootDir } = await import("@/lib/brain/settings");
        const { Task, generateId } = await import("@/lib/db");
        const body = await parseBody(req) as Record<string, unknown>;
        const sinceDays = typeof body.sinceDays === "number" && body.sinceDays > 0 ? Math.floor(body.sinceDays) : 7;
        const docs = await recentBrainDocs({ sinceDays });
        const root = configuredBrainRootDir() ?? defaultBrainRootDir();
        const dateStr = new Date().toISOString().slice(0, 10);
        const docPath = `${root}/digests/${weeklyDigestFilename(dateStr)}`;
        const task = await Task.create({
          _id: generateId(),
          title: `[brain digest] last ${sinceDays}d (${docs.length} docs)`,
          description: buildBrainDigestTaskDescription({ docs, docPath, sinceDays }),
          project: "ops",
          projectPath: process.cwd(),
          profile: "researcher",
          status: "backlog",
          executor: "agent",
          source: "brain-digest",
          output: { brainDigest: { sinceDays, docCount: docs.length, docPath } },
        });
        broadcast("tasks:created", { taskId: task._id });
        json(res, 201, { task, docPath, docCount: docs.length });
        return;
      }

      // X (Twitter) posting — OPERATOR-triggered (outward-facing/irreversible, so
      // the operator calling this IS the approval). GET shows keys-set; POST posts.
      if (req.method === "GET" && urlPath === "/x") {
        const { isXConfigured } = await import("@/lib/x/provider");
        json(res, 200, { configured: isXConfigured() });
        return;
      }
      if (req.method === "POST" && urlPath === "/x/post") {
        const { isXConfigured, postTweet } = await import("@/lib/x/provider");
        if (!isXConfigured()) { json(res, 400, { error: "X not configured — set X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET env vars" }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const text = typeof body.text === "string" ? body.text : "";
        const r = await postTweet(text, { replyToId: typeof body.replyToId === "string" ? body.replyToId : undefined });
        json(res, r.ok ? 201 : 502, r);
        return;
      }
      if (req.method === "POST" && urlPath === "/x/thread") {
        const { isXConfigured, postThread } = await import("@/lib/x/provider");
        if (!isXConfigured()) { json(res, 400, { error: "X not configured — set X_* env vars" }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const tweets = Array.isArray(body.tweets) ? body.tweets.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];
        if (tweets.length === 0) { json(res, 400, { error: "tweets[] (non-empty strings) required" }); return; }
        json(res, 200, await postThread(tweets));
        return;
      }

      // GET /traderbee — Market Insight Lane watch/alert status (keys set? watchlist + last poll).
      // ANALYSIS & ALERTS ONLY — never trades.
      if (req.method === "GET" && urlPath === "/traderbee") {
        const { isTraderBeeConfigured } = await import("@/lib/traderbee/provider");
        const { getWatchlist, getTraderBeeState } = await import("@/lib/traderbee/store");
        json(res, 200, { configured: isTraderBeeConfigured(), watchlist: getWatchlist(), state: getTraderBeeState() });
        return;
      }
      // POST /traderbee/watch — { symbol, rules:[{type:"above"|"below"|"pct_move", value}] }
      if (req.method === "POST" && urlPath === "/traderbee/watch") {
        const { upsertWatch } = await import("@/lib/traderbee/store");
        const body = await parseBody(req) as Record<string, unknown>;
        const symbol = typeof body.symbol === "string" ? body.symbol : "";
        const rules = Array.isArray(body.rules) ? body.rules : [];
        const item = upsertWatch(symbol, rules);
        if (!item) { json(res, 400, { error: "valid 'symbol' is required" }); return; }
        json(res, 201, item);
        return;
      }
      // DELETE /traderbee/watch/:symbol
      const tbDel = urlPath.match(/^\/traderbee\/watch\/([^/]+)$/);
      if (req.method === "DELETE" && tbDel) {
        const { removeWatch } = await import("@/lib/traderbee/store");
        json(res, 200, { removed: removeWatch(decodeURIComponent(tbDel[1])) });
        return;
      }
      // POST /traderbee/poll — evaluate the Market Insight Lane watchlist now (manual trigger).
      if (req.method === "POST" && urlPath === "/traderbee/poll") {
        const { isTraderBeeConfigured } = await import("@/lib/traderbee/provider");
        if (!isTraderBeeConfigured()) {
          json(res, 400, { error: "Market Data Lane not configured — set APCA_API_KEY_ID + APCA_API_SECRET_KEY env vars (data API only)" });
          return;
        }
        const { pollOnce } = await import("@/lib/traderbee/poller");
        const { getTraderBeeState } = await import("@/lib/traderbee/store");
        await pollOnce();
        json(res, 200, { ok: true, state: getTraderBeeState() });
        return;
      }

      // POST /bee/:tool — generic capability-lane dispatch for the CLI executors
      // (Claude Code / Codex), giving them parity with the local agent for
      // webbee/browserbee/desktopbee/termbee. Reuses executeBeeTool, so the
      // connectivity-capability gate is enforced identically. Body: {args:{...}}.
      const beeMatch = urlPath.match(/^\/bee\/([a-z_]+)$/);
      if (req.method === "POST" && beeMatch) {
        const tool = beeMatch[1];
        const { isLaneTool, executeLaneTool } = await import("@/lib/orchestrator/lane-tools");
        if (!isLaneTool(tool)) { json(res, 404, { error: `unknown lane tool "${tool}"` }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const args = (body.args && typeof body.args === "object" && !Array.isArray(body.args))
          ? body.args as Record<string, unknown>
          : {};
        const result = await executeLaneTool(tool, args, {
          projectPath: typeof body.projectPath === "string" ? body.projectPath : process.cwd(),
          project: typeof body.project === "string" ? body.project : "ops",
          requestedBy: "cli",
        });
        json(res, result.startsWith("Error") ? 400 : 200, { ok: !result.startsWith("Error"), result });
        return;
      }

      // POST /lane/browser — stable Browser Lane dispatch for CLI executors and
      // external model adapters. Body: {args:{mode:"search|read|open|snapshot|workflow", ...}}.
      if (req.method === "POST" && urlPath === "/lane/browser") {
        const { executeLaneTool } = await import("@/lib/orchestrator/lane-tools");
        const body = await parseBody(req) as Record<string, unknown>;
        const args = (body.args && typeof body.args === "object" && !Array.isArray(body.args))
          ? body.args as Record<string, unknown>
          : {};
        const result = await executeLaneTool("hivematrix_browser", args, {
          projectPath: typeof body.projectPath === "string" ? body.projectPath : process.cwd(),
          project: typeof body.project === "string" ? body.project : "ops",
          requestedBy: "cli",
        });
        json(res, result.startsWith("Error") ? 400 : 200, { ok: !result.startsWith("Error"), result });
        return;
      }

      // GET /desktopbee/health — compatibility route that pings the Swift helper (:3748). 200 when up so
      // the Lanes view shows Desktop Lane healthy; 503 when the helper is unreachable.
      if (req.method === "GET" && urlPath === "/desktopbee/health") {
        const { probeDesktopBeeHelper } = await import("@/lib/desktopbee/client");
        const health = await probeDesktopBeeHelper().catch(() => null);
        json(res, health ? 200 : 503, {
          ok: !!health,
          bee: "desktopbee",
          helperVersion: health?.version ?? null,
          detail: health ? "helper running" : "Desktop Lane helper unreachable on :3748",
        });
        return;
      }

      // GET /browserbee/health — compatibility readiness so a refused browser
      // job (e.g. LinkedIn) explains itself: is Codex auth present? is the
      // Desktop Lane fallback enabled? what backing will actually run?
      if (req.method === "GET" && urlPath === "/browserbee/health") {
        const { buildBrowserBeeHealthSnapshot, readBrowserBeeDesktopFallbackEnabled } = await import("@/lib/browser-lane/jobs");
        const { readCodexAuthState } = await import("@/lib/usage/codex");
        const { readHiveConfig } = await import("@/lib/brain/settings");
        const { Task } = await import("@/lib/db");
        const tasks = await Task.find({ source: "browserbee" });
        const auth = readCodexAuthState();
        const ack = (readHiveConfig().browserbee as Record<string, unknown> | undefined)?.acknowledgedComputerUse === true;
        const snapshot = buildBrowserBeeHealthSnapshot({
          tasks: tasks.map((t) => ({ status: t.status as string, createdAt: t.createdAt as string })),
          readiness: {
            codexConfigured: auth.authMode === "subscription" || auth.authMode === "api-key",
            codexAuthMode: auth.authMode,
            acknowledgedComputerUse: ack,
            desktopFallbackEnabled: readBrowserBeeDesktopFallbackEnabled(),
            desktopBeeAvailable: policy.getCapability("desktopbee").available,
          },
        });
        json(res, 200, snapshot);
        return;
      }

      // GET /browser-lane/health — public replacement for /browserbee/health.
      if (req.method === "GET" && urlPath === "/browser-lane/health") {
        const { buildBrowserBeeHealthSnapshot, readBrowserBeeDesktopFallbackEnabled } = await import("@/lib/browser-lane/jobs");
        const { readCodexAuthState } = await import("@/lib/usage/codex");
        const { readHiveConfig } = await import("@/lib/brain/settings");
        const { Task } = await import("@/lib/db");
        const tasks = await Task.find({ source: "browser-lane" });
        const legacyTasks = await Task.find({ source: "browserbee" });
        const auth = readCodexAuthState();
        const ack = (readHiveConfig().browserLane as Record<string, unknown> | undefined)?.acknowledgedComputerUse === true
          || (readHiveConfig().browserbee as Record<string, unknown> | undefined)?.acknowledgedComputerUse === true;
        const snapshot = buildBrowserBeeHealthSnapshot({
          tasks: [...tasks, ...legacyTasks].map((t) => ({ status: t.status as string, createdAt: t.createdAt as string })),
          readiness: {
            codexConfigured: auth.authMode === "subscription" || auth.authMode === "api-key",
            codexAuthMode: auth.authMode,
            acknowledgedComputerUse: ack,
            desktopFallbackEnabled: readBrowserBeeDesktopFallbackEnabled(),
            desktopBeeAvailable: policy.getCapability("desktopbee").available,
          },
        });
        json(res, 200, { ...snapshot, bee: undefined, lane: "browser" });
        return;
      }

      if (req.method === "GET" && urlPath === "/browser-lane/sites") {
        const { listBrowserSiteSummaries } = await import("@/lib/browser-lane/store");
        json(res, 200, { ok: true, lane: "browser", sites: listBrowserSiteSummaries() });
        return;
      }

      // --- Lane Apps manager -------------------------------------------------
      // HiveMatrix updates ITSELF automatically; the standalone Browser Lane and
      // Terminal Lane apps are installed/updated EXPLICITLY here — never silently
      // overwritten by the updater. GET reports install state for both.
      if (req.method === "GET" && urlPath === "/lane-apps") {
        const { getAllLaneAppStates } = await import("@/lib/lane-apps");
        // ?verify=1 also runs signature + launch verification (slower; launches the app).
        const verify = parseQueryString(req.url ?? "").verify === "1";
        const apps = await getAllLaneAppStates({ verify });
        json(res, 200, { ok: true, apps });
        return;
      }

      // POST /lane-apps/:id/install — install/update one lane app from its
      // packaged artifact into the user-writable target (~/Applications/...).
      const laneAppInstall = urlPath.match(/^\/lane-apps\/(browser-lane|terminal-lane)\/install$/);
      if (req.method === "POST" && laneAppInstall) {
        const { installLaneAppById } = await import("@/lib/lane-apps");
        try {
          const result = await installLaneAppById(laneAppInstall[1]);
          json(res, 200, { ok: true, ...result });
        } catch (err) {
          json(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // POST /lane-apps/:id/launch — open the active installed copy.
      const laneAppLaunch = urlPath.match(/^\/lane-apps\/(browser-lane|terminal-lane)\/launch$/);
      if (req.method === "POST" && laneAppLaunch) {
        const { activePathFor } = await import("@/lib/lane-apps");
        const appPath = activePathFor(laneAppLaunch[1]);
        if (!appPath) {
          json(res, 400, { ok: false, error: "Lane app is not installed." });
          return;
        }
        const { spawn } = await import("node:child_process");
        spawn("open", [appPath], { stdio: "ignore", detached: true }).unref();
        json(res, 200, { ok: true, launched: appPath });
        return;
      }

      // POST /lane-apps/:id/reveal — reveal the active bundle in Finder. Scoped
      // to the lane app id (no arbitrary-path reveal) so callers can't probe the fs.
      const laneAppReveal = urlPath.match(/^\/lane-apps\/(browser-lane|terminal-lane)\/reveal$/);
      if (req.method === "POST" && laneAppReveal) {
        const { activePathFor } = await import("@/lib/lane-apps");
        const appPath = activePathFor(laneAppReveal[1]);
        if (!appPath) {
          json(res, 400, { ok: false, error: "Lane app is not installed." });
          return;
        }
        const { spawn } = await import("node:child_process");
        spawn("open", ["-R", appPath], { stdio: "ignore", detached: true }).unref();
        json(res, 200, { ok: true, revealed: appPath });
        return;
      }

      // POST /lane-apps/:id/verify — rerun signature + Gatekeeper + launch
      // verification and return the refreshed status. codesign/spctl passing is
      // NOT enough; the launch probe is a separate signal (the LaunchServices lesson).
      const laneAppVerify = urlPath.match(/^\/lane-apps\/(browser-lane|terminal-lane)\/verify$/);
      if (req.method === "POST" && laneAppVerify) {
        const { verifyLaneAppById } = await import("@/lib/lane-apps");
        const { state, verification } = await verifyLaneAppById(laneAppVerify[1]);
        json(res, 200, { ok: true, state, verification });
        return;
      }

      // GET /browser-lane/dashboard — site/auth readiness dashboard: per-site
      // latest readiness state (color), Keychain credential status, probe counts,
      // and trace linkage, plus a roll-up of how many sites need attention.
      if (req.method === "GET" && urlPath === "/browser-lane/dashboard") {
        const { getBrowserLaneReadinessDashboard } = await import("@/lib/browser-lane/store");
        const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const dashboard = getBrowserLaneReadinessDashboard({ siteId: q.get("siteId"), staleAfterHours: getBrowserLaneReadinessConfig().staleAfterHours });
        json(res, 200, { ok: true, ...dashboard });
        return;
      }

      // POST /browser-lane/readiness/run — run a readiness sweep now (all/one site).
      if (req.method === "POST" && urlPath === "/browser-lane/readiness/run") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { runReadinessSweepNow } = await import("@/lib/browser-lane/readiness-schedule");
        const summary = await runReadinessSweepNow({ siteId: typeof body.siteId === "string" ? body.siteId : "all" });
        json(res, 200, { ok: true, summary });
        return;
      }

      // POST /browser-lane/readiness/mark — honest operator-asserted readiness for
      // sites with no feasible live probe yet (e.g. SSO sessions). No fake green:
      // the operator vouches for the state from a constrained allow-list.
      if (req.method === "POST" && urlPath === "/browser-lane/readiness/mark") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { recordManualReadiness } = await import("@/lib/browser-lane/store");
          const run = recordManualReadiness({
            siteId: typeof body.siteId === "string" ? body.siteId : "",
            state: body.state as never,
            note: typeof body.note === "string" ? body.note : undefined,
          });
          json(res, 200, { ok: true, lane: "browser", run });
        } catch (e) {
          json(res, 400, { ok: false, lane: "browser", error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (req.method === "POST" && urlPath === "/browser-lane/sites") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { upsertBrowserSite } = await import("@/lib/browser-lane/store");
          const site = upsertBrowserSite(body.site ?? body);
          json(res, 200, { ok: true, lane: "browser", site });
        } catch (e) {
          json(res, 400, { ok: false, lane: "browser", error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (req.method === "POST" && urlPath === "/browser-lane/probes") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { upsertBrowserReadinessProbe } = await import("@/lib/browser-lane/store");
          const probe = upsertBrowserReadinessProbe(body.probe ?? body);
          json(res, 200, { ok: true, lane: "browser", probe });
        } catch (e) {
          json(res, 400, { ok: false, lane: "browser", error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (req.method === "GET" && urlPath === "/browser-lane/traces") {
        const { listBrowserTraceRuns } = await import("@/lib/browser-lane/store");
        json(res, 200, { ok: true, lane: "browser", traces: listBrowserTraceRuns() });
        return;
      }

      if (req.method === "GET" && urlPath === "/browser-lane/traces/latest") {
        const { getLatestBrowserTraceRun } = await import("@/lib/browser-lane/store");
        const trace = getLatestBrowserTraceRun();
        json(res, trace ? 200 : 404, trace ? { ok: true, lane: "browser", trace } : { ok: false, lane: "browser", error: "No Browser Lane traces found." });
        return;
      }

      const browserTraceMatch = urlPath.match(/^\/browser-lane\/traces\/([^/]+)$/);
      if (req.method === "GET" && browserTraceMatch) {
        const { getBrowserTraceRun } = await import("@/lib/browser-lane/store");
        const trace = getBrowserTraceRun(decodeURIComponent(browserTraceMatch[1]));
        json(res, trace ? 200 : 404, trace ? { ok: true, lane: "browser", trace } : { ok: false, lane: "browser", error: "Browser Lane trace not found." });
        return;
      }

      // POST /browser-lane/probe — readiness orchestration endpoint backed by
      // stored site/probe rows. The default adapter is honest when no browser
      // backend is wired yet: it records blocked runs instead of pretending.
      if (req.method === "POST" && urlPath === "/browser-lane/probe") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { runBrowserLaneReadiness } = await import("@/lib/browser-lane/probe-service");
        const result = await runBrowserLaneReadiness({ siteId: typeof body.siteId === "string" ? body.siteId : "all" });
        json(res, result.ok ? 200 : 404, result);
        return;
      }

      if (req.method === "GET" && urlPath === "/terminal-lane/profiles") {
        const { listTerminalProfileSummaries } = await import("@/lib/terminal-lane/store");
        json(res, 200, { ok: true, lane: "terminal", profiles: listTerminalProfileSummaries() });
        return;
      }

      if (req.method === "POST" && urlPath === "/terminal-lane/profiles") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { upsertTerminalProfile } = await import("@/lib/terminal-lane/store");
          const profile = upsertTerminalProfile(body.profile ?? body);
          json(res, 200, { ok: true, lane: "terminal", profile });
        } catch (e) {
          json(res, 400, { ok: false, lane: "terminal", error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (req.method === "GET" && urlPath === "/terminal-lane/dashboard") {
        const { getTerminalLaneReadinessDashboard } = await import("@/lib/terminal-lane/store");
        json(res, 200, { ok: true, ...getTerminalLaneReadinessDashboard() });
        return;
      }

      if (req.method === "POST" && urlPath === "/terminal-lane/probes") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { upsertTerminalReadinessProbe } = await import("@/lib/terminal-lane/store");
          const probe = upsertTerminalReadinessProbe(body.probe ?? body);
          json(res, 200, { ok: true, lane: "terminal", probe });
        } catch (e) {
          json(res, 400, { ok: false, lane: "terminal", error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (req.method === "POST" && urlPath === "/terminal-lane/readiness/run") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { listTerminalProfiles, listEnabledTerminalReadinessProbes, recordTerminalReadinessRun } = await import("@/lib/terminal-lane/store");
        const { runTerminalReadinessProbe } = await import("@/lib/terminal-lane/readiness");
        const requested = typeof body.profileId === "string" && body.profileId.trim() ? body.profileId.trim() : "all";
        const profiles = listTerminalProfiles().filter((profile) => requested === "all" || profile.id === requested);
        const runs = [];
        for (const profile of profiles) {
          const probes = listEnabledTerminalReadinessProbes(profile.id);
          const probe = probes[0] ?? { id: `${profile.id}-default`, profileId: profile.id, name: "Default", command: null };
          const result = await runTerminalReadinessProbe({ profile });
          const run = recordTerminalReadinessRun({
            profileId: profile.id,
            probeId: probe.id,
            status: result.state.status,
            color: result.state.color,
            summary: result.summary,
            metadata: { command: result.command.file, args: result.command.args },
          });
          runs.push({ ...run, displayName: profile.displayName });
        }
        json(res, profiles.length ? 200 : 404, profiles.length
          ? { ok: true, lane: "terminal", profileId: requested, runs }
          : { ok: false, lane: "terminal", profileId: requested, runs: [], error: requested === "all" ? "No Terminal Lane profiles are configured." : `No Terminal Lane profile is configured for "${requested}".` });
        return;
      }

      if (req.method === "GET" && urlPath === "/terminal-lane/traces") {
        const { listTerminalSessionAudit } = await import("@/lib/terminal-lane/store");
        json(res, 200, { ok: true, lane: "terminal", traces: listTerminalSessionAudit() });
        return;
      }

      // ----------------------------------------------------------------
      // COO routing rules — SQL-backed intent→lane routing table. Rules are
      // stored and resolved against canonical lane ids; legacy lane/capability
      // names are normalized on write so older callers keep working.
      // ----------------------------------------------------------------
      if (req.method === "GET" && urlPath === "/coo/routing-rules") {
        const { listCooRoutingRules } = await import("@/lib/coo/store");
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const laneParam = q.get("lane");
        const rules = listCooRoutingRules({
          lane: laneParam ? (laneParam as never) : null,
          enabledOnly: q.get("enabled") === "1" || q.get("enabledOnly") === "true",
        });
        json(res, 200, { ok: true, rules });
        return;
      }

      if (req.method === "POST" && urlPath === "/coo/routing-rules") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { upsertCooRoutingRule } = await import("@/lib/coo/store");
          const rule = upsertCooRoutingRule(body.rule ?? body);
          json(res, 200, { ok: true, rule });
        } catch (e) {
          json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // POST /coo/routing-rules/seed — install the canonical default rules
      // (idempotent; existing rules are left untouched).
      if (req.method === "POST" && urlPath === "/coo/routing-rules/seed") {
        const { seedDefaultCooRoutingRules, listCooRoutingRules } = await import("@/lib/coo/store");
        const created = seedDefaultCooRoutingRules();
        json(res, 200, { ok: true, created, rules: listCooRoutingRules() });
        return;
      }

      // POST /coo/routing-rules/resolve — resolve a request against enabled rules.
      if (req.method === "POST" && urlPath === "/coo/routing-rules/resolve") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { resolveCooRouteFromRules } = await import("@/lib/coo/store");
          const route = resolveCooRouteFromRules({
            text: typeof body.text === "string" ? body.text : "",
            domains: Array.isArray(body.domains) ? body.domains.filter((d): d is string => typeof d === "string") : undefined,
            project: typeof body.project === "string" ? body.project : null,
            workflow: typeof body.workflow === "string" ? body.workflow : null,
            tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : undefined,
          });
          json(res, 200, { ok: true, route });
        } catch (e) {
          json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // POST /video/heygen-workflow — turn a script into a HeyGen Browser Lane
      // video task, routed through COO dispatch so readiness/exec gates apply. A
      // task is created only when HeyGen readiness is green + fresh; otherwise the
      // exact readiness blocker is returned. Login/2FA/CAPTCHA/file-picker/preview/
      // export are operator handoffs in the job — never automated.
      if (req.method === "POST" && urlPath === "/video/heygen-workflow") {
        const body = await parseBody(req) as Record<string, unknown>;
        const script = typeof body.script === "string" ? body.script.trim() : "";
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!script || !title) { json(res, 400, { ok: false, error: "script and title are required" }); return; }
        const input = {
          script,
          title,
          creativeNotes: typeof body.creativeNotes === "string" ? body.creativeNotes : undefined,
          assetPaths: Array.isArray(body.assetPaths) ? body.assetPaths.filter((p): p is string => typeof p === "string") : undefined,
          project: typeof body.project === "string" ? body.project : undefined,
        };
        const parentDraftId = typeof body.parentDraftId === "string" ? body.parentDraftId : undefined;
        const force = body.force === true;
        const { dispatchHeyGenVideoWorkflow } = await import("@/lib/video/heygen-workflow");
        const { seedHeyGenBrowserSite } = await import("@/lib/browser-lane/heygen");
        seedHeyGenBrowserSite(); // idempotent: ensure the site/probe/rule exist
        try {
          if (body.create === true) {
            let projectPath: string;
            try { projectPath = normalizeHomeProjectPath(body.projectPath); }
            catch (e) { json(res, 400, { ok: false, error: `create requires a valid projectPath under $HOME: ${e instanceof Error ? e.message : String(e)}` }); return; }
            // Dup guard: don't create a second portal child while one is pending,
            // unless the caller forces it (e.g. an explicit retry).
            if (parentDraftId) {
              const { getDraft } = await import("@/lib/video/draft-store");
              const { portalChildPending } = await import("@/lib/video/portal-completion");
              const draft = getDraft(parentDraftId);
              if (draft && portalChildPending(draft, force)) {
                json(res, 200, { ok: true, result: { status: "portal_pending", taskId: draft.portalTaskId, draftId: parentDraftId, deduped: true } });
                return;
              }
            }
            const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
            const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
            const result = await dispatchHeyGenVideoWorkflow(input, {
              create: true,
              projectPath,
              browserAvailable: getConnectivityPolicy().getCapability("browserbee").available,
              staleAfterHours: getBrowserLaneReadinessConfig().staleAfterHours,
              persistTask: async ({ envelope, projectPath: root, route }) => {
                const { Task } = await import("@/lib/db");
                const { buildBrowserBeeTaskDescription } = await import("@/lib/browser-lane/jobs");
                const description = buildBrowserBeeTaskDescription(envelope, { requestedProjectPath: root });
                const task = await Task.create({
                  title: envelope.title,
                  description,
                  project: envelope.project,
                  projectPath: root,
                  model: envelope.backingModel,
                  status: "backlog",
                  executor: "agent",
                  source: "browser-lane",
                  output: { browserbeeRequest: envelope, coo: { ruleId: route.ruleId, capability: route.capability }, heygen: { title, ...(parentDraftId ? { parentDraftId } : {}) } },
                });
                broadcast("tasks:created", { taskId: task._id });
                // Link the child to the parent draft (→ portal_pending) when provided.
                if (parentDraftId) {
                  const { markPortalTaskCreated } = await import("@/lib/video/portal-completion");
                  await markPortalTaskCreated(parentDraftId, task._id, {
                    updateTask: async (id, fields) => { await Task.findByIdAndUpdate(id, fields); },
                  });
                }
                return { id: task._id };
              },
            });
            // Record/transition the durable workflow run for this portal video.
            try {
              const { linkHeyGenPortalRunOnDispatch } = await import("@/lib/workflows/heygen-run-link");
              linkHeyGenPortalRunOnDispatch(result, { draftId: parentDraftId, title });
            } catch { /* the ledger is a nicety; the dispatch result is the source of truth */ }
            json(res, 200, { ok: true, result });
          } else {
            const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
            const result = await dispatchHeyGenVideoWorkflow(input, { staleAfterHours: getBrowserLaneReadinessConfig().staleAfterHours });
            json(res, 200, { ok: true, result });
          }
        } catch (e) {
          json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // POST /video/portal-complete — hand a HeyGen portal child task's result back
      // to the parent video draft (final URL / local path / manual note, or a
      // failed/cancelled outcome). Idempotent; never accepts/returns secrets and
      // never falsely marks YouTube publishing done.
      if (req.method === "POST" && urlPath === "/video/portal-complete") {
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const { applyHeyGenPortalCompletion } = await import("@/lib/video/portal-completion");
          const { Task } = await import("@/lib/db");
          const result = await applyHeyGenPortalCompletion(body, {
            updateTask: async (id, fields) => { await Task.findByIdAndUpdate(id, fields); },
          });
          // Mark the child Browser Lane task terminal to match the outcome.
          const childTaskId = typeof body.childTaskId === "string" ? body.childTaskId : undefined;
          if (result.ok && childTaskId) {
            const childStatus = body.childStatus === "failed" ? "failed" : body.childStatus === "cancelled" ? "cancelled" : "done";
            try { await Task.findByIdAndUpdate(childTaskId, { status: childStatus, reviewState: null }); } catch { /* draft is the source of truth */ }
          }
          // Transition the workflow run to match the completion outcome.
          if (result.ok && typeof body.parentDraftId === "string") {
            try {
              const { linkHeyGenPortalRunOnCompletion } = await import("@/lib/workflows/heygen-run-link");
              linkHeyGenPortalRunOnCompletion(body.parentDraftId, { status: result.status, childStatus: body.childStatus as never });
            } catch { /* ledger is a nicety */ }
          }
          json(res, result.ok ? 200 : 404, result);
        } catch (e) {
          json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // POST /video/publish-draft — publish-only path: upload a portal_completed
      // draft's existing local MP4 to YouTube WITHOUT re-rendering through HeyGen.
      // needs_publish_input (no local file) → 409; already published → idempotent 200.
      if (req.method === "POST" && urlPath === "/video/publish-draft") {
        const body = await parseBody(req) as Record<string, unknown>;
        const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
        if (!draftId) { json(res, 400, { ok: false, error: "draftId is required" }); return; }
        try {
          const { publishDraftVideo } = await import("@/lib/video/news-review");
          const result = await publishDraftVideo(draftId);
          if (result.ok && result.published) {
            try {
              const { linkHeyGenPortalRunOnPublish } = await import("@/lib/workflows/heygen-run-link");
              linkHeyGenPortalRunOnPublish(draftId, result);
            } catch { /* ledger is a nicety */ }
          }
          const status = result.ok ? 200 : result.code === "no_draft" ? 404 : 409;
          json(res, status, result);
        } catch (e) {
          json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // GET /workflows — the typed registry of repeatable business workflows
      // (discovery metadata only: lane, readiness, handoffs, runbook). Secret-free.
      if (req.method === "GET" && urlPath === "/workflows") {
        const { getWorkflowRegistry } = await import("@/lib/workflows/registry");
        json(res, 200, { workflows: getWorkflowRegistry().list() });
        return;
      }

      // GET /workflows/runs — durable run ledger across workflows. Secret-free.
      if (req.method === "GET" && urlPath === "/workflows/runs") {
        const { listWorkflowRuns } = await import("@/lib/workflows/runs");
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        json(res, 200, { runs: listWorkflowRuns({ workflowId: q.get("workflowId") ?? undefined, draftId: q.get("draftId") ?? undefined }) });
        return;
      }

      // GET /workflows/inbox — the COO queue: needs-review / ready / blocked / failed /
      // recently-completed, aggregated read-only over runs + actions. Secret-free; never executes.
      if (req.method === "GET" && urlPath === "/workflows/inbox") {
        const { getWorkflowInbox, formatWorkflowInboxSummary } = await import("@/lib/workflows/inbox");
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const limitRaw = q.get("limit");
        const inbox = getWorkflowInbox({
          workflowId: q.get("workflowId") ?? undefined,
          limit: limitRaw ? Number(limitRaw) : undefined,
        });
        json(res, 200, { inbox, summary: formatWorkflowInboxSummary(inbox) });
        return;
      }

      // GET /workflows/actions — recent proposed handoffs (for the console). Secret-free.
      if (req.method === "GET" && urlPath === "/workflows/actions") {
        const { listWorkflowActions } = await import("@/lib/workflows/actions");
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        json(res, 200, { actions: listWorkflowActions({ status: (q.get("status") as never) || "proposed" }) });
        return;
      }

      // POST /workflows/actions/:id/execute — explicitly execute a proposed action.
      // Routes through the registered handler; needs_input returns the exact missing fields.
      const actionExecuteMatch = urlPath.match(/^\/workflows\/actions\/([^/]+)\/execute$/);
      if (req.method === "POST" && actionExecuteMatch) {
        const body = await parseBody(req) as Record<string, unknown>;
        const { executeWorkflowAction } = await import("@/lib/workflows/actions");
        const inputs = (body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)) ? body.inputs as Record<string, unknown> : body;
        const out = await executeWorkflowAction(decodeURIComponent(actionExecuteMatch[1]), inputs);
        const status = out.status === "invalid" ? 404 : out.status === "needs_input" ? 400 : out.ok ? 200 : 400;
        json(res, status, out);
        return;
      }

      const actionGetMatch = urlPath.match(/^\/workflows\/actions\/([^/]+)$/);
      if (req.method === "GET" && actionGetMatch) {
        const { getWorkflowAction } = await import("@/lib/workflows/actions");
        const action = getWorkflowAction(decodeURIComponent(actionGetMatch[1]));
        json(res, action ? 200 : 404, action ? { ok: true, action } : { ok: false, error: "Workflow action not found." });
        return;
      }

      // POST /workflows/runs/:id/review — approve / request_changes / reject a run. The
      // review gate blocks downstream action execution until a run is approved.
      const runReviewMatch = urlPath.match(/^\/workflows\/runs\/([^/]+)\/review$/);
      if (req.method === "POST" && runReviewMatch) {
        const body = await parseBody(req) as Record<string, unknown>;
        const decision = body.decision;
        if (decision !== "approve" && decision !== "request_changes" && decision !== "reject") {
          json(res, 400, { ok: false, error: "decision must be approve | request_changes | reject" }); return;
        }
        const { reviewWorkflowRun } = await import("@/lib/workflows/runs");
        const run = reviewWorkflowRun(decodeURIComponent(runReviewMatch[1]), decision, {
          note: typeof body.note === "string" ? body.note : undefined,
          reviewedArtifacts: Array.isArray(body.reviewedArtifacts) ? body.reviewedArtifacts.filter((s): s is string => typeof s === "string") : undefined,
        });
        json(res, run ? 200 : 404, run ? { ok: true, run } : { ok: false, error: "Workflow run not found." });
        return;
      }

      // POST /workflows/runs/:id/artifact — revise an allowlisted draft artifact.
      const runArtifactMatch = urlPath.match(/^\/workflows\/runs\/([^/]+)\/artifact$/);
      if (req.method === "POST" && runArtifactMatch) {
        const body = await parseBody(req) as Record<string, unknown>;
        const key = typeof body.key === "string" ? body.key : "";
        const ALLOWED = new Set(["scriptText", "scriptMarkdown"]);
        if (!ALLOWED.has(key)) { json(res, 400, { ok: false, error: `artifact key must be one of: ${[...ALLOWED].join(", ")}` }); return; }
        if (typeof body.value !== "string") { json(res, 400, { ok: false, error: "value must be a string" }); return; }
        const { reviseWorkflowRunArtifact } = await import("@/lib/workflows/runs");
        const run = reviseWorkflowRunArtifact(decodeURIComponent(runArtifactMatch[1]), key, body.value);
        json(res, run ? 200 : 404, run ? { ok: true, run } : { ok: false, error: "Workflow run not found." });
        return;
      }

      // GET /workflows/runs/:id/actions — proposed actions for a run.
      const runActionsMatch = urlPath.match(/^\/workflows\/runs\/([^/]+)\/actions$/);
      if (req.method === "GET" && runActionsMatch) {
        const { listWorkflowActions } = await import("@/lib/workflows/actions");
        json(res, 200, { actions: listWorkflowActions({ sourceRunId: decodeURIComponent(runActionsMatch[1]) }) });
        return;
      }

      const workflowRunMatch = urlPath.match(/^\/workflows\/runs\/([^/]+)$/);
      if (req.method === "GET" && workflowRunMatch) {
        const { getWorkflowRun } = await import("@/lib/workflows/runs");
        const { listWorkflowActions } = await import("@/lib/workflows/actions");
        const run = getWorkflowRun(decodeURIComponent(workflowRunMatch[1]));
        json(res, run ? 200 : 404, run ? { ok: true, run, actions: listWorkflowActions({ sourceRunId: run.id }) } : { ok: false, error: "Workflow run not found." });
        return;
      }

      const workflowRunsForMatch = urlPath.match(/^\/workflows\/([^/]+)\/runs$/);
      if (req.method === "GET" && workflowRunsForMatch) {
        const { listWorkflowRuns } = await import("@/lib/workflows/runs");
        json(res, 200, { runs: listWorkflowRuns({ workflowId: decodeURIComponent(workflowRunsForMatch[1]) }) });
        return;
      }

      // POST /workflows/:id/prepare — low-risk prepare, dispatched generically by the
      // workflow's handler marker (prepareWorkflowById). needs_input returns exact
      // missing fields. No external side effects beyond what the handler does.
      const workflowPrepareMatch = urlPath.match(/^\/workflows\/([^/]+)\/prepare$/);
      if (req.method === "POST" && workflowPrepareMatch) {
        const body = await parseBody(req) as Record<string, unknown>;
        const { prepareWorkflowById } = await import("@/lib/workflows/prepare");
        try {
          const out = await prepareWorkflowById(decodeURIComponent(workflowPrepareMatch[1]), body);
          const status = out.status === "unsupported" ? (out.workflow ? 400 : 404) : out.status === "needs_input" ? 400 : 200;
          json(res, status, { ok: out.ok, status: out.status, workflow: out.workflow, runId: out.runId, missing: out.missing, result: out.result, error: out.reason });
        } catch (e) {
          json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // GET /workflows/:id — one workflow definition.
      const workflowMatch = urlPath.match(/^\/workflows\/([^/]+)$/);
      if (req.method === "GET" && workflowMatch) {
        const { getWorkflowRegistry } = await import("@/lib/workflows/registry");
        const wf = getWorkflowRegistry().get(decodeURIComponent(workflowMatch[1]));
        json(res, wf ? 200 : 404, wf ? { ok: true, workflow: wf } : { ok: false, error: "Workflow not found." });
        return;
      }

      // POST /coo/dispatch — route-to-execution bridge. Resolves the request to a
      // lane/capability and returns a typed dispatch result: a Browser-Lane-ready
      // work item for browser routes, an explicit approval requirement for
      // channel/native lanes, or a clear no_match/unsupported/needs_input result.
      // Prepare-only by default; create=true turns a Browser-Lane *prepared*
      // result into one real task (other statuses never create). Never performs
      // risky actions and never returns secret material.
      if (req.method === "POST" && urlPath === "/coo/dispatch") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { dispatchCooRequest, dispatchCooTask, CooDispatchValidationError } = await import("@/lib/coo/dispatch");
        const request = {
          text: typeof body.text === "string" ? body.text : "",
          domains: Array.isArray(body.domains) ? body.domains.filter((d): d is string => typeof d === "string") : undefined,
          project: typeof body.project === "string" ? body.project : null,
          workflow: typeof body.workflow === "string" ? body.workflow : null,
          tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : undefined,
        };
        // A real task needs a real project root under $HOME — validate this up
        // front so a bad path is a clean 400 (and nothing is created or audited),
        // distinct from an unexpected creation failure (500) below.
        let createProjectPath: string | null = null;
        if (body.create === true) {
          try {
            createProjectPath = normalizeHomeProjectPath(body.projectPath);
          } catch (e) {
            json(res, 400, { ok: false, error: `create requires a valid projectPath under $HOME: ${e instanceof Error ? e.message : String(e)}` });
            return;
          }
        }
        try {
          if (body.create === true && createProjectPath) {
            // Honest execution gating: only create a Browser Lane task when the
            // browser workflow capability is available; otherwise dispatchCooTask
            // returns execution_unavailable without creating anything.
            const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
            const browserAvailable = getConnectivityPolicy().getCapability("browserbee").available;
            const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
            const result = await dispatchCooTask(request, {
              create: true,
              projectPath: createProjectPath,
              browserAvailable,
              staleAfterHours: getBrowserLaneReadinessConfig().staleAfterHours,
              createTask: async ({ workItem, projectPath: root, route }) => {
                const { Task } = await import("@/lib/db");
                const { buildBrowserBeeTaskDescription } = await import("@/lib/browser-lane/jobs");
                const description = buildBrowserBeeTaskDescription(workItem.envelope, { requestedProjectPath: root });
                const task = await Task.create({
                  title: workItem.envelope.title,
                  description,
                  project: workItem.envelope.project,
                  projectPath: root,
                  model: workItem.envelope.backingModel,
                  status: "backlog",
                  executor: "agent",
                  source: "browser-lane",
                  output: { browserbeeRequest: workItem.envelope, coo: { ruleId: route.ruleId, capability: route.capability } },
                });
                broadcast("tasks:created", { taskId: task._id });
                return { id: task._id };
              },
            });
            json(res, 200, { ok: true, result });
          } else {
            const result = dispatchCooRequest(request);
            json(res, 200, { ok: true, result });
          }
        } catch (e) {
          // Empty/invalid text → 400 (no audit written). Anything else is a 500.
          const status = e instanceof CooDispatchValidationError ? 400 : 500;
          json(res, status, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // GET /coo/dispatch/audit — append-only dispatch decision trail.
      if (req.method === "GET" && urlPath === "/coo/dispatch/audit") {
        const { listCooDispatchAudit } = await import("@/lib/coo/dispatch");
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const limit = Number(q.get("limit") ?? "50");
        json(res, 200, { ok: true, audit: listCooDispatchAudit(Number.isFinite(limit) ? limit : 50) });
        return;
      }

      const cooRuleHistoryMatch = urlPath.match(/^\/coo\/routing-rules\/([^/]+)\/history$/);
      if (req.method === "GET" && cooRuleHistoryMatch) {
        const { listCooRoutingRuleHistory } = await import("@/lib/coo/store");
        json(res, 200, { ok: true, history: listCooRoutingRuleHistory(decodeURIComponent(cooRuleHistoryMatch[1])) });
        return;
      }

      const cooRuleMatch = urlPath.match(/^\/coo\/routing-rules\/([^/]+)$/);
      if (req.method === "GET" && cooRuleMatch) {
        const { getCooRoutingRule } = await import("@/lib/coo/store");
        const rule = getCooRoutingRule(decodeURIComponent(cooRuleMatch[1]));
        json(res, rule ? 200 : 404, rule ? { ok: true, rule } : { ok: false, error: "Routing rule not found." });
        return;
      }

      if (req.method === "DELETE" && cooRuleMatch) {
        const { deleteCooRoutingRule } = await import("@/lib/coo/store");
        const removed = deleteCooRoutingRule(decodeURIComponent(cooRuleMatch[1]));
        json(res, removed ? 200 : 404, removed ? { ok: true } : { ok: false, error: "Routing rule not found." });
        return;
      }

      // Feedback — local bug/enhancement backlog (file by text/console/mobile)
      if (req.method === "GET" && urlPath === "/feedback") {
        const { listFeedback, feedbackSummary } = await import("@/lib/feedback/feedback");
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const kind = q.get("kind") as "bug" | "enhancement" | null;
        const status = q.get("status") as never;
        json(res, 200, { feedback: listFeedback({ kind: kind ?? undefined, status: status ?? undefined }), summary: feedbackSummary() });
        return;
      }
      if (req.method === "POST" && urlPath === "/feedback") {
        const { recordFeedback } = await import("@/lib/feedback/feedback");
        const body = await parseBody(req) as Record<string, unknown>;
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) { json(res, 400, { error: "title is required" }); return; }
        const item = recordFeedback({
          kind: body.kind === "enhancement" ? "enhancement" : "bug",
          title,
          detail: typeof body.detail === "string" ? body.detail : "",
          source: typeof body.source === "string" ? body.source : "console",
        });
        json(res, 201, item);
        return;
      }
      const feedbackMatch = urlPath.match(/^\/feedback\/([^/]+)$/);
      if (req.method === "PATCH" && feedbackMatch) {
        const { setFeedbackStatus } = await import("@/lib/feedback/feedback");
        const body = await parseBody(req) as Record<string, unknown>;
        const updated = setFeedbackStatus(feedbackMatch[1], body.status as never);
        if (!updated) { json(res, 404, { error: "Not found" }); return; }
        json(res, 200, updated);
        return;
      }

      // GET /approvals/pending — unified queue (checkpoints/content/tool/stuck) for mobile (W6.1)
      if (req.method === "GET" && urlPath === "/approvals/pending") {
        const { buildApprovalQueue } = await import("@/lib/approvals/queue");
        json(res, 200, { approvals: buildApprovalQueue() });
        return;
      }

      // POST /approvals/resolve — approve/deny (or stuck retry/skip/abort) from the phone (W6.1)
      if (req.method === "POST" && urlPath === "/approvals/resolve") {
        const body = await parseBody(req) as Record<string, unknown>;
        const taskId = typeof body.taskId === "string" ? body.taskId : "";
        const timestamp = typeof body.timestamp === "string" ? body.timestamp : "";
        const decision = typeof body.decision === "string" ? body.decision : "";
        if (!taskId || !timestamp || !decision) { json(res, 400, { error: "taskId, timestamp, decision required" }); return; }
        if (body.kind === "stuck") {
          const { resolveStuck } = await import("@/lib/orchestrator/stuck");
          await resolveStuck(taskId, timestamp, decision, "mobile");
        } else {
          const { resolveApproval } = await import("@/lib/orchestrator/approval");
          await resolveApproval(taskId, timestamp, decision === "approve" || decision === "done" ? "approve" : "denied", "mobile");
        }
        json(res, 200, { ok: true });
        return;
      }

      // GET /runs/:runId/journal — directive run progress (phase transitions) for mobile (W6.1)
      const runJournalMatch = urlPath.match(/^\/runs\/([^/]+)\/journal$/);
      if (req.method === "GET" && runJournalMatch) {
        const { getRun, getJournal } = await import("@/lib/orchestrator/directive-store");
        const run = getRun(runJournalMatch[1]);
        if (!run) { json(res, 404, { error: "Not found" }); return; }
        json(res, 200, { run, journal: getJournal(runJournalMatch[1]) });
        return;
      }

      // GET /notify/status — configured notification channels
      if (req.method === "GET" && urlPath === "/notify/status") {
        const { getTelegramConfig } = await import("@/lib/notify/telegram");
        const { resolveNotifyTargets } = await import("@/lib/notify/notify");
        const { loadHiveConfig } = await import("@/lib/central/config");
        const cfg = loadHiveConfig();
        const tg = getTelegramConfig();
        json(res, 200, {
          telegramConfigured: tg !== null,
          targets: resolveNotifyTargets((cfg.notify as Record<string, unknown>) ?? {}, tg !== null),
        });
        return;
      }

      // POST /notify/config — set notify channels + Telegram bot config.
      if (req.method === "POST" && urlPath === "/notify/config") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { writeConfigStep } = await import("@/lib/onboarding/actions");
        const patch: Record<string, unknown> = {};
        if (body.notify && typeof body.notify === "object") patch.notify = body.notify;
        if (body.telegram && typeof body.telegram === "object") patch.telegram = body.telegram;
        writeConfigStep(patch);
        json(res, 200, { ok: true });
        return;
      }

      // POST /notify/test — fan a test message out to all configured channels.
      if (req.method === "POST" && urlPath === "/notify/test") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { notify } = await import("@/lib/notify/notify");
        const result = await notify(typeof body.text === "string" && body.text.trim() ? body.text : "HiveMatrix test notification");
        json(res, 200, result);
        return;
      }

      // GET /mailbee — channel status (enabled, Mail controllable, allowlist)
      if (req.method === "GET" && urlPath === "/mailbee") {
        const { isChannelEnabled, listIdentities, trustedDomains, triageAll } = await import("@/lib/mailbee/store");
        const { canControlMail } = await import("@/lib/mailbee/applemail");
        json(res, 200, {
          enabled: isChannelEnabled(),
          mailControllable: await canControlMail(),
          identities: listIdentities(),
          trustedDomains: trustedDomains(),
          triageAll: triageAll(),
        });
        return;
      }

      // POST /mailbee/enable — { enabled }. On enable, set high-water to newest msg id.
      if (req.method === "POST" && urlPath === "/mailbee/enable") {
        const body = await parseBody(req) as Record<string, unknown>;
        const { setChannelEnabled, setLastId, ensureChannel } = await import("@/lib/mailbee/store");
        const { canControlMail, readInboxSince } = await import("@/lib/mailbee/applemail");
        const enabled = body.enabled !== false;
        ensureChannel();
        if (enabled) {
          if (!(await canControlMail())) { json(res, 412, { error: "Mail.app not controllable — open Mail and grant Automation permission to HiveMatrix" }); return; }
          const recent = await readInboxSince(0, 1);
          setLastId(recent[0]?.id ?? 0);
        }
        setChannelEnabled(enabled);
        json(res, 200, { ok: true, enabled });
        return;
      }

      // POST /mailbee/identities — manage the trusted-sender allowlist.
      if (req.method === "POST" && urlPath === "/mailbee/identities") {
        const body = await parseBody(req) as Record<string, unknown>;
        const address = String(body.address ?? "").trim();
        if (!address) { json(res, 400, { error: "address is required" }); return; }
        const status = ["pending", "allowed", "paired", "blocked"].includes(body.status as string) ? (body.status as string) : "allowed";
        const { upsertIdentity, listIdentities } = await import("@/lib/mailbee/store");
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

      // Outbound dispatch — the SAME trust-gated send path the local agent uses,
      // exposed over loopback so the Claude Code / Codex CLI executors (which run
      // their own toolset and never see the bee tools) can send via the right
      // channel instead of improvising with osascript. Auth is the daemon token,
      // already verified above. The execute fns own the safety gate: email sends
      // only to trusted recipients (else drafts), iMessage only to allowlist.
      if (req.method === "POST" && (urlPath === "/mailbee/send" || urlPath === "/mailbee/draft")) {
        const { parseOutboundFields } = await import("@/lib/orchestrator/outbound-routing");
        const fields = parseOutboundFields(req.headers["content-type"], await readRawBody(req));
        const { executeMailBeeSend, executeMailBeeDraft } = await import("@/lib/orchestrator/lane-tools");
        const args = { to: fields.to ?? "", subject: fields.subject ?? "", body: fields.body ?? "", attachments: fields.attachments ?? [] };
        const message = urlPath === "/mailbee/send"
          ? await executeMailBeeSend(args)
          : await executeMailBeeDraft(args);
        json(res, message.startsWith("Error") ? 400 : 200, { ok: !message.startsWith("Error"), message });
        return;
      }
      if (req.method === "POST" && urlPath === "/messagebee/send") {
        const { parseOutboundFields } = await import("@/lib/orchestrator/outbound-routing");
        const fields = parseOutboundFields(req.headers["content-type"], await readRawBody(req));
        const { executeMessageBeeSend } = await import("@/lib/orchestrator/lane-tools");
        const message = await executeMessageBeeSend({ to: fields.to ?? "", text: fields.text ?? "", attachments: fields.attachments });
        json(res, message.startsWith("Error") ? 400 : 200, { ok: !message.startsWith("Error"), message });
        return;
      }

      // POST /voice/session — the Voice Lane sidecar (which owns the realtime audio
      // loop) hands a finished/escalated conversation here; routeVoiceSession
      // decides whether it becomes a Hive task ("voice notes → task artifacts").
      // The decision logic is pure + unit-tested in lib/voice/session.ts; this is
      // the thin DB/HTTP glue.
      if (req.method === "POST" && urlPath === "/voice/session") {
        const { parseVoiceSessionBody, routeVoiceSession } = await import("@/lib/voice/session");
        const { Task, generateId } = await import("@/lib/db");
        const { DEFAULT_TASK_PROJECT } = await import("@/lib/routing/project-constants");
        const parsed = parseVoiceSessionBody(await parseBody(req) as Record<string, unknown>);
        if ("error" in parsed) { json(res, 400, { error: parsed.error }); return; }
        const route = routeVoiceSession(parsed.session, { escalated: parsed.escalated });
        if (route.kind === "none") { json(res, 200, { created: false, reason: route.reason }); return; }
        const { sessionId, surface, handle } = parsed.session;
        const task = await Task.create(route.kind === "browserLaneTask"
          ? { _id: generateId(), ...route.task, output: { ...route.task.output, voice: { sessionId, surface, handle } } }
          : {
              _id: generateId(),
              title: route.title,
              description: route.description,
              project: DEFAULT_TASK_PROJECT,
              projectPath: homedir(),
              status: "backlog",
              executor: "agent",
              source: "voice",
              output: { voice: { sessionId, surface, handle } },
            });
        broadcast("tasks:created", { taskId: task._id });
        json(res, 201, { created: true, taskId: task._id });
        return;
      }

      // POST /voice/skills — deterministic voice skill picker. Body { text }
      // (a transcript). Detects "what skills do I have / find a skill for X / use
      // the Y skill" and returns a spoken reply (no LLM). handled:false → let the
      // normal voice turn answer. Voice clients call this before/around the LLM.
      if (req.method === "POST" && urlPath === "/voice/skills") {
        const { detectSkillIntent, buildSkillVoiceReply } = await import("@/lib/voice/skill-intent");
        const { listSkills } = await import("@/lib/skills/store");
        const body = await parseBody(req) as Record<string, unknown>;
        const text = typeof body.text === "string" ? body.text : "";
        const intent = detectSkillIntent(text);
        if (intent.kind === "none") { json(res, 200, { handled: false }); return; }
        json(res, 200, { intent, ...buildSkillVoiceReply(intent, await listSkills()) });
        return;
      }

      // POST /voice/turn — one in-app push-to-talk turn, gated by the `voice`
      // feature flag. Two input modes:
      //   { text }         — transcript from on-device STT (iOS Speech framework);
      //                      skips server STT entirely (no Whisper/model needed).
      //   { audioBase64 }  — recorded audio → server STT (only when a backend is
      //                      configured via HIVE_STT_COMMAND).
      // Either way: → local LLM → cloned-voice TTS; returns transcript, reply, audio.
      if (req.method === "POST" && urlPath === "/voice/turn") {
        const { isFeatureEnabled } = await import("@/lib/config/features");
        if (!isFeatureEnabled("voice")) { json(res, 403, { error: "voice feature is off — enable it in Settings → Features" }); return; }
        const { voiceRuntime } = await import("@/lib/voice/runtime");
        const { voiceLlmEnv } = await import("@/lib/voice/llm-env");
        const { buildCliPath } = await import("@/lib/config/binary-detection");
        const rt = voiceRuntime();
        if (!rt) { json(res, 503, { error: "voice sidecar not available" }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const text = typeof body.text === "string" ? body.text.trim() : "";
        const audioB64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
        if (!text && !audioB64) { json(res, 400, { error: "text or audioBase64 is required" }); return; }
        const lang = typeof body.lang === "string" ? body.lang : "en";
        // Fast path: relay to the persistent worker (LLM + TTS kept warm across
        // turns — no per-turn model reload). Falls back to turn_cli.py below if
        // the worker can't be started.
        try {
          const { relayTurn, relayTurnText } = await import("@/lib/voice/turn-server");
          const r = text ? await relayTurnText(text, lang) : await relayTurn(audioB64, lang);
          if (r.escalated && r.transcript) {
            void (async () => {
              try {
                const { routeVoiceSession } = await import("@/lib/voice/session");
                const { Task, generateId } = await import("@/lib/db");
                const { DEFAULT_TASK_PROJECT } = await import("@/lib/routing/project-constants");
                const sessionId = generateId();
                const voiceSession = {
                  sessionId,
                  surface: "ios" as const,
                  startedAt: new Date().toISOString(),
                  turns: [
                    { role: "user" as const, text: r.transcript },
                    ...(r.reply ? [{ role: "assistant" as const, text: r.reply }] : []),
                  ],
                };
                const route = routeVoiceSession(voiceSession, { escalated: true });
                if (route.kind === "task" || route.kind === "browserLaneTask") {
                  const task = await Task.create(route.kind === "browserLaneTask"
                    ? { _id: generateId(), ...route.task, output: { ...route.task.output, voice: { sessionId, surface: "ios" } } }
                    : {
                        _id: generateId(),
                        title: route.title,
                        description: route.description,
                        project: DEFAULT_TASK_PROJECT,
                        projectPath: homedir(),
                        status: "backlog",
                        executor: "agent",
                        source: "voice",
                        output: { voice: { sessionId, surface: "ios" } },
                      });
                  broadcast("tasks:created", { taskId: task._id });
                }
              } catch (e) {
                console.error(`[turn] escalation task failed: ${e instanceof Error ? e.message : e}`);
              }
            })();
          }
          // Re-voice deterministic overrides in the SAME warm live voice (Kokoro)
          // as the conversational reply — one consistent Talk voice. The cloned
          // persona is reserved for produced narration, not the Talk surface.
          const { synthesizeLiveVoice } = await import("@/lib/voice/turn-server");
          const speak = (replyText: string): Promise<string> => synthesizeLiveVoice(replyText, lang);
          // Voice skill picker: answer "what skills do I have / use the X skill"
          // deterministically, overriding the LLM reply.
          const { skillTurnOverride } = await import("@/lib/voice/skill-turn");
          const ov = await skillTurnOverride(r.transcript || "", { synthesize: speak });
          if (ov) { json(res, 200, { transcript: r.transcript, ...ov }); return; }
          // Video script review by voice: "read me the script" / "approve the video".
          const { videoVoiceOverride } = await import("@/lib/video/voice-turn");
          const vv = await videoVoiceOverride(r.transcript || "", { synthesize: speak });
          if (vv) { json(res, 200, { transcript: r.transcript, ...vv }); return; }
          // Voice command layer ("Jarvis"): drive the board / approvals / directives /
          // tasks / connectivity by voice, overriding the conversational reply.
          const { commandTurnOverride } = await import("@/lib/voice/command-turn");
          const cmd = await commandTurnOverride(r.transcript || "", { synthesize: speak });
          if (cmd) {
            if (cmd.command.taskId) broadcast("tasks:created", { taskId: cmd.command.taskId });
            json(res, 200, { transcript: r.transcript, ...cmd });
            return;
          }
          json(res, 200, { transcript: r.transcript, reply: r.reply, audioBase64: r.audioBase64 });
          return;
        } catch (e) {
          console.error(`[turn] warm worker failed, falling back to per-turn: ${e instanceof Error ? e.message : String(e)}`);
        }
        const { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } = await import("fs");
        const { generateId } = await import("@/lib/db");
        const { execFile } = await import("child_process");
        const tmp = join(homedir(), ".hivematrix", "artifacts", "voice");
        mkdirSync(tmp, { recursive: true });
        const id = generateId();
        const inPath = join(tmp, `${id}.webm`);
        const outPath = join(tmp, `${id}-reply.m4a`);
        // Text turn: no audio to write — pass the transcript via --text (skips STT).
        const cliArgs = text
          ? [join(rt.scriptsDir, "turn_cli.py"), outPath, "--text", text, "--lang", lang]
          : [join(rt.scriptsDir, "turn_cli.py"), inPath, outPath, "--lang", lang];
        if (!text) writeFileSync(inPath, Buffer.from(audioB64, "base64"));
        await new Promise<void>((resolve) => {
          execFile(rt.python, cliArgs, { cwd: rt.scriptsDir, timeout: 120_000, env: { ...process.env, ...voiceLlmEnv(), PATH: buildCliPath() } }, (err, stdout, stderr) => {
            if (err) { json(res, 500, { error: ((stderr || err.message || "").trim()).slice(-300) }); resolve(); return; }
            let meta: { transcript?: string; reply?: string } = {};
            try { meta = JSON.parse((stdout.trim().split("\n").pop()) || "{}"); } catch { /* ignore */ }
            void (async () => {
              try {
                const { skillTurnOverride } = await import("@/lib/voice/skill-turn");
                const ov = await skillTurnOverride(meta.transcript ?? "");
                if (ov) { json(res, 200, { transcript: meta.transcript ?? "", ...ov }); resolve(); return; }
              } catch { /* fall through */ }
              const replyB64 = existsSync(outPath) ? readFileSync(outPath).toString("base64") : "";
              json(res, 200, { transcript: meta.transcript ?? "", reply: meta.reply ?? "", audioBase64: replyB64 });
              resolve();
            })();
          });
        });
        try { unlinkSync(inPath); } catch { /* ignore */ }
        try { unlinkSync(outPath); } catch { /* ignore */ }
        return;
      }

      // POST /voice/provision — set up the local voice runtime (venv + MLX deps +
      // models) for a DMG user who just enabled Voice. Gated + capability-checked;
      // runs in the background, poll GET /voice/provision/status.
      if (req.method === "POST" && urlPath === "/voice/provision") {
        const { isFeatureEnabled, featureCapability } = await import("@/lib/config/features");
        if (!isFeatureEnabled("voice")) { json(res, 403, { error: "voice feature is off — enable it in Settings → Features" }); return; }
        const cap = featureCapability("voice");
        if (!cap.capable) { json(res, 400, { error: cap.reason ?? "not available on this machine" }); return; }
        const { provisionVoiceRuntime, provisionStatus } = await import("@/lib/voice/provision");
        void provisionVoiceRuntime();
        json(res, 202, provisionStatus());
        return;
      }
      if (req.method === "GET" && urlPath === "/voice/provision/status") {
        const { provisionStatus } = await import("@/lib/voice/provision");
        json(res, 200, provisionStatus());
        return;
      }

      // GET /voice/rtc/config — ICE servers (STUN + the operator's Cloudflare
      // TURN) for the realtime iOS client to gather candidates. Gated by `voice`.
      if (req.method === "GET" && urlPath === "/voice/rtc/config") {
        const { isFeatureEnabled } = await import("@/lib/config/features");
        if (!isFeatureEnabled("voice")) { json(res, 403, { error: "voice feature is off — enable it in Settings → Features" }); return; }
        const { realtimeIceServers } = await import("@/lib/voice/realtime-session");
        json(res, 200, { iceServers: await realtimeIceServers() });
        return;
      }

      // POST/PATCH /voice/rtc/offer — realtime voice signaling relay (P5.2). The
      // client's SmallWebRTC offer (POST) / trickle-ICE updates (PATCH) are
      // forwarded to the headless Pipecat realtime server; its answer is returned.
      // Media flows P2P (phone↔Mac), not through here. Gated by `voice` (+ cap).
      if ((req.method === "POST" || req.method === "PATCH") && urlPath === "/voice/rtc/offer") {
        const { isFeatureEnabled, featureCapability } = await import("@/lib/config/features");
        if (!isFeatureEnabled("voice")) { json(res, 403, { error: "voice feature is off — enable it in Settings → Features" }); return; }
        const cap = featureCapability("voice");
        if (!cap.capable) { json(res, 400, { error: cap.reason ?? "not available on this machine" }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const { relayOffer } = await import("@/lib/voice/realtime-session");
        try {
          const { status, body: answer } = await relayOffer(body, req.method as "POST" | "PATCH");
          json(res, status, answer);
        } catch (e) {
          json(res, 503, { error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // POST /video/news/draft — draft the AI-news video script and PAUSE for human
      // review (the checkpoint before the expensive HeyGen render). Creates a
      // needs_input review task; the operator's Reply drives render/edit/regenerate/
      // cancel. Gated by the `video` feature flag.
      if (req.method === "POST" && urlPath === "/video/news/draft") {
        const { isFeatureEnabled } = await import("@/lib/config/features");
        if (!isFeatureEnabled("video")) { json(res, 403, { error: "video feature is off — enable it in Settings → Features" }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const { draftNewsVideo } = await import("@/lib/video/news-review");
        try {
          const draft = await draftNewsVideo({
            privacy: typeof body.privacy === "string" ? body.privacy : undefined,
            source: typeof body.source === "string" ? body.source : undefined,
            writer: typeof body.writer === "string" ? body.writer : undefined,
          });
          if (draft.taskId) broadcast("tasks:created", { taskId: draft.taskId });
          json(res, 200, { draft });
        } catch (e) { json(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
        return;
      }
      // GET /video/drafts — video script drafts + their review status.
      if (req.method === "GET" && urlPath === "/video/drafts") {
        const { listDrafts } = await import("@/lib/video/draft-store");
        json(res, 200, { drafts: listDrafts() });
        return;
      }
      // GET /video/drafts/:id — one draft + its current script text (review panel).
      const videoDraftMatch = urlPath.match(/^\/video\/drafts\/([^/]+)$/);
      if (req.method === "GET" && videoDraftMatch) {
        const { getDraft } = await import("@/lib/video/draft-store");
        const d = getDraft(videoDraftMatch[1]);
        if (!d) { json(res, 404, { error: "not found" }); return; }
        const { readFileSync, existsSync } = await import("fs");
        const script = existsSync(d.paths.script) ? readFileSync(d.paths.script, "utf-8") : "";
        json(res, 200, { draft: d, script });
        return;
      }

      // POST /video/make — agent/daemon-driven video creation, gated by the
      // `video` feature flag. Drives the out-of-process Node video factory
      // (topic→script→cloned-voice narration→captions→render). Long-running.
      if (req.method === "POST" && urlPath === "/video/make") {
        const { isFeatureEnabled } = await import("@/lib/config/features");
        if (!isFeatureEnabled("video")) { json(res, 403, { error: "video feature is off — enable it in Settings → Features" }); return; }
        const { runVideoFactory } = await import("@/lib/video/factory");
        const { generateId } = await import("@/lib/db");
        const { mkdirSync, writeFileSync } = await import("fs");
        const body = await parseBody(req) as Record<string, unknown>;
        const topic = typeof body.topic === "string" && body.topic.trim() ? body.topic.trim() : undefined;
        const script = typeof body.script === "string" && body.script.trim() ? body.script.trim() : undefined;
        if (!topic && !script) { json(res, 400, { error: "topic or script is required" }); return; }
        const id = generateId();
        const dir = join(homedir(), ".hivematrix", "artifacts", "video");
        mkdirSync(dir, { recursive: true });
        const out = join(dir, `${id}.mp4`);
        let scriptFile: string | undefined;
        if (script) { scriptFile = join(dir, `${id}.txt`); writeFileSync(scriptFile, script); }
        try {
          const r = await runVideoFactory({
            topic, scriptFile, out,
            lang: typeof body.lang === "string" ? body.lang : undefined,
            title: typeof body.title === "string" ? body.title : undefined,
            seconds: typeof body.seconds === "number" ? body.seconds : undefined,
            screen: typeof body.screen === "string" ? body.screen : undefined,
            presenter: typeof body.presenter === "string" ? body.presenter : undefined,
            renderMode: body.renderMode === "agent" ? "agent" : undefined,
            style: typeof body.style === "string" ? body.style : undefined,
            orientation: body.orientation === "portrait" || body.orientation === "landscape" ? body.orientation : undefined,
            creativeBrief: typeof body.creativeBrief === "string" ? body.creativeBrief : undefined,
          });
          json(res, 201, { ok: true, path: r.path });
        } catch (e) {
          json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // GET /audit — compliance trail (prompt + outcome + diff), newest first,
      // filterable by ?taskId=&status=&event=&limit=. Never returns secrets.
      if (req.method === "GET" && urlPath === "/audit") {
        const { readAudit } = await import("@/lib/audit/audit");
        const q = parseQueryString(req.url ?? "");
        const limit = parseInt(q.limit ?? "", 10);
        json(res, 200, {
          entries: readAudit({
            taskId: q.taskId || undefined,
            status: q.status || undefined,
            event: q.event || undefined,
            limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : undefined,
          }),
        });
        return;
      }
      // GET /audit/export — newline-delimited JSON (JSONL) for SIEM ingestion.
      if (req.method === "GET" && urlPath === "/audit/export") {
        const { readAudit } = await import("@/lib/audit/audit");
        const q = parseQueryString(req.url ?? "");
        const limit = parseInt(q.limit ?? "", 10);
        const entries = readAudit({ limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50000) : 5000 });
        res.writeHead(200, { "Content-Type": "application/x-ndjson", "Content-Disposition": "attachment; filename=hivematrix-audit.jsonl" });
        res.end(entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""));
        return;
      }

      // GET /codegraph?symbol=X&path=Y — deterministic symbol lookup (definitions
      // + references). Complements semantic search for large codebases.
      if (req.method === "GET" && urlPath === "/codegraph") {
        const q = parseQueryString(req.url ?? "");
        const symbol = (q.symbol ?? "").trim();
        const path = (q.path ?? process.cwd()).trim() || process.cwd();
        if (!symbol) { json(res, 400, { error: "symbol is required" }); return; }
        const { findSymbol } = await import("@/lib/codegraph/provider");
        json(res, 200, await findSymbol(symbol, path));
        return;
      }

      // GET /skills — the skill library index (name, description, tags, uses,
      // compat = which harnesses it runs on, hasInput = takes text input).
      if (req.method === "GET" && urlPath === "/skills") {
        const { listSkills } = await import("@/lib/skills/store");
        json(res, 200, { skills: await listSkills() });
        return;
      }

      // GET /skills/sync — sync config + fan-out targets + prune candidate count.
      if (req.method === "GET" && urlPath === "/skills/sync") {
        const { getSkillsSyncConfig } = await import("@/lib/skills/sync");
        const { harnessTargets } = await import("@/lib/skills/fanout");
        const { stalePruneCandidates } = await import("@/lib/skills/prune");
        const { readAllSkills } = await import("@/lib/skills/store");
        const cfg = getSkillsSyncConfig();
        const all = await readAllSkills();
        json(res, 200, {
          configured: !!cfg,
          repoUrl: cfg?.repoUrl ?? null,
          targets: harnessTargets().map((t) => ({ id: t.id, dir: t.dir })),
          pruneCandidateCount: stalePruneCandidates(all).length,
          skillCount: all.length,
        });
        return;
      }
      // POST /skills/sync — git pull/push the personal skill repo, then fan out.
      if (req.method === "POST" && urlPath === "/skills/sync") {
        const { gitSyncSkills } = await import("@/lib/skills/sync");
        const { fanOutSkills } = await import("@/lib/skills/fanout");
        const { readAllSkills } = await import("@/lib/skills/store");
        const body = await parseBody(req) as Record<string, unknown>;
        const direction = body.direction === "pull" || body.direction === "push" ? body.direction : "both";
        const sync = await gitSyncSkills({ direction });
        const fanout = await fanOutSkills(await readAllSkills());
        json(res, 200, { sync, fanout });
        return;
      }
      // POST /skills/fanout — write trusted skills into the harness dirs (no git).
      if (req.method === "POST" && urlPath === "/skills/fanout") {
        const { fanOutSkills } = await import("@/lib/skills/fanout");
        const { readAllSkills } = await import("@/lib/skills/store");
        json(res, 200, { fanout: await fanOutSkills(await readAllSkills()) });
        return;
      }
      // GET /skills/prune — skills that have gone cold (idle/never-used).
      if (req.method === "GET" && urlPath === "/skills/prune") {
        const { stalePruneCandidates } = await import("@/lib/skills/prune");
        const { readAllSkills } = await import("@/lib/skills/store");
        json(res, 200, { candidates: stalePruneCandidates(await readAllSkills()) });
        return;
      }
      // GET /skills/search?q= — ranked skill picker (fuzzy over name/desc/tags).
      if (req.method === "GET" && urlPath === "/skills/search") {
        const { listSkills } = await import("@/lib/skills/store");
        const { rankSkills } = await import("@/lib/skills/search");
        const q = parseQueryString(req.url ?? "");
        json(res, 200, { skills: rankSkills(await listSkills(), (q.q ?? "").trim()) });
        return;
      }
      // GET /skills/browse?scope=team — list a scope's shared skills WITHOUT
      // importing (browse-before-import), annotated with signed/scan/in-library.
      if (req.method === "GET" && urlPath === "/skills/browse") {
        const { browseSource } = await import("@/lib/skills/sync");
        const { coerceScope } = await import("@/lib/skills/contracts");
        const q = parseQueryString(req.url ?? "");
        const scope = coerceScope((q.scope ?? "").trim());
        if (!scope) { json(res, 400, { error: "scope must be personal|team|org|public" }); return; }
        json(res, 200, await browseSource(scope));
        return;
      }
      // POST /skills/import-remote — cherry-pick one skill from a scope's repo.
      if (req.method === "POST" && urlPath === "/skills/import-remote") {
        const { importRemoteSkill } = await import("@/lib/skills/sync");
        const { coerceScope } = await import("@/lib/skills/contracts");
        const body = await parseBody(req) as Record<string, unknown>;
        const scope = coerceScope(typeof body.scope === "string" ? body.scope : undefined);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!scope || !name) { json(res, 400, { error: "scope and name are required" }); return; }
        json(res, 200, await importRemoteSkill(scope, name));
        return;
      }
      // GET /skills/sources — configured tiered scopes + the operator's signer id.
      if (req.method === "GET" && urlPath === "/skills/sources") {
        const { getSkillSources } = await import("@/lib/skills/sync");
        const { readSigningPublicKey, keyFingerprint } = await import("@/lib/skills/signing");
        const pub = readSigningPublicKey();
        json(res, 200, {
          sources: getSkillSources().map((s) => ({ scope: s.scope, repoUrl: s.repoUrl, branch: s.branch })),
          signerId: pub ? keyFingerprint(pub) : null,
        });
        return;
      }

      // POST /skills — create a skill (operator → trusted). kind: instruction|script.
      if (req.method === "POST" && urlPath === "/skills") {
        const { upsertSkill } = await import("@/lib/skills/store");
        const { coerceInterpreter } = await import("@/lib/skills/contracts");
        const body = await parseBody(req) as Record<string, unknown>;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const skillBody = typeof body.body === "string" ? body.body : "";
        if (!name || !skillBody) { json(res, 400, { error: "name and body are required" }); return; }
        const result = await upsertSkill({
          name,
          description: typeof body.description === "string" ? body.description : "",
          body: skillBody,
          source: "operator",
          kind: body.kind === "script" ? "script" : "instruction",
          interpreter: coerceInterpreter(typeof body.interpreter === "string" ? body.interpreter : undefined),
          tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : undefined,
        });
        json(res, result.created || result.refined ? 201 : 200, { ...result, name });
        return;
      }

      // POST /skills/import — import a shared skill (team/public) from a URL or
      // pasted content. Imported skills are UNTRUSTED (instructions an agent would
      // follow — a prompt-injection vector) until the operator approves them, so
      // they are NOT auto-shown to agents until trusted.
      if (req.method === "POST" && urlPath === "/skills/import") {
        const body = await parseBody(req) as Record<string, unknown>;
        const url = typeof body.url === "string" ? body.url.trim() : "";
        let content = typeof body.content === "string" ? body.content : "";
        let source = "import:pasted";
        if (!content) {
          if (!url) { json(res, 400, { error: "url or content is required" }); return; }
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            if (!r.ok) { json(res, 502, { error: `fetch failed (HTTP ${r.status})` }); return; }
            content = await r.text();
            source = `import:${url}`;
          } catch (e) { json(res, 502, { error: e instanceof Error ? e.message : String(e) }); return; }
        }
        const { parseSkillFile } = await import("@/lib/skills/contracts");
        const { upsertSkill } = await import("@/lib/skills/store");
        const { scanSkillContent } = await import("@/lib/skills/scan");
        const parsed = parseSkillFile(content);
        const name = parsed?.name ?? (typeof body.name === "string" ? body.name : "imported-skill");
        const skillBody = parsed?.body ?? content;
        const scan = scanSkillContent(skillBody, parsed?.kind ?? "instruction");
        const result = await upsertSkill({
          name,
          description: parsed?.description ?? "Imported skill",
          tags: parsed?.tags,
          body: skillBody,
          source,
          compat: parsed?.compat,
          kind: parsed?.kind,
          trusted: false, // review before agents see it
          scanVerdict: scan.verdict,
        });
        json(res, result.created || result.refined ? 201 : 200, { ...result, name, trusted: false, scan });
        return;
      }

      // POST /skills/:name/trust — { trusted } approve/revoke an imported skill.
      const skillTrustMatch = urlPath.match(/^\/skills\/([^/]+)\/trust$/);
      if (req.method === "POST" && skillTrustMatch) {
        const { setSkillTrusted, readSkill } = await import("@/lib/skills/store");
        const { trustNeedsForce } = await import("@/lib/skills/scan");
        const body = await parseBody(req) as Record<string, unknown>;
        const name = decodeURIComponent(skillTrustMatch[1]);
        const trusting = body.trusted !== false;
        const skill = await readSkill(name);
        // Refuse to trust a scan-BLOCKED skill without an explicit force override.
        if (trusting && skill && trustNeedsForce(skill.scanVerdict, true, body.force === true)) {
          json(res, 409, { ok: false, requiresForce: true, scanVerdict: "block",
            error: `"${name}" scanned as BLOCKED — re-confirm with force to trust it anyway` });
          return;
        }
        const ok = await setSkillTrusted(name, trusting);
        json(res, ok ? 200 : 404, { ok, trusted: trusting });
        return;
      }

      // GET /skills/:name/scan — re-run the content scanner (findings + verdict).
      const skillScanMatch = urlPath.match(/^\/skills\/([^/]+)\/scan$/);
      if (req.method === "GET" && skillScanMatch) {
        const { readSkill } = await import("@/lib/skills/store");
        const { scanSkill } = await import("@/lib/skills/scan");
        const skill = await readSkill(decodeURIComponent(skillScanMatch[1]));
        if (!skill) { json(res, 404, { error: "skill not found" }); return; }
        json(res, 200, scanSkill(skill));
        return;
      }

      // POST /skills/:name/publish — sign + push a skill to a scope's repo.
      const skillPublishMatch = urlPath.match(/^\/skills\/([^/]+)\/publish$/);
      if (req.method === "POST" && skillPublishMatch) {
        const { publishSkill } = await import("@/lib/skills/sync");
        const { coerceScope } = await import("@/lib/skills/contracts");
        const body = await parseBody(req) as Record<string, unknown>;
        const scope = coerceScope(typeof body.scope === "string" ? body.scope : undefined);
        if (!scope) { json(res, 400, { error: "scope must be personal|team|org|public" }); return; }
        const result = await publishSkill(decodeURIComponent(skillPublishMatch[1]), scope);
        json(res, result.ok ? 200 : 400, result);
        return;
      }

      // GET /skills/:name — full skill (to view/verify) + its shareable markdown
      // (export/copy to give to a team). DELETE removes it.
      const skillOneMatch = urlPath.match(/^\/skills\/([^/]+)$/);
      if (req.method === "GET" && skillOneMatch && decodeURIComponent(skillOneMatch[1]) !== "import") {
        const { readSkill } = await import("@/lib/skills/store");
        const { renderSkillFile } = await import("@/lib/skills/contracts");
        const skill = await readSkill(decodeURIComponent(skillOneMatch[1]));
        if (!skill) { json(res, 404, { error: "skill not found" }); return; }
        json(res, 200, { skill, markdown: renderSkillFile(skill) });
        return;
      }
      if (req.method === "DELETE" && skillOneMatch) {
        const { deleteSkill } = await import("@/lib/skills/store");
        json(res, 200, { removed: await deleteSkill(decodeURIComponent(skillOneMatch[1])) });
        return;
      }

      // GET /skills/runs/:id — status + log of a script-skill run.
      const skillRunStatusMatch = urlPath.match(/^\/skills\/runs\/([^/]+)$/);
      if (req.method === "GET" && skillRunStatusMatch) {
        const { getScriptRun } = await import("@/lib/skills/run-script");
        const r = getScriptRun(decodeURIComponent(skillRunStatusMatch[1]));
        if (!r) { json(res, 404, { error: "run not found" }); return; }
        json(res, 200, r);
        return;
      }

      // POST /skills/:name/run — launch a skill. INSTRUCTION skills spawn an agent
      // task (fills {{input}} or appends). SCRIPT skills EXECUTE deterministically
      // in the background (trusted-gated) and return a runId to poll.
      const skillRunMatch = urlPath.match(/^\/skills\/([^/]+)\/run$/);
      if (req.method === "POST" && skillRunMatch) {
        const { readSkill } = await import("@/lib/skills/store");
        const skill = await readSkill(decodeURIComponent(skillRunMatch[1]));
        if (!skill) { json(res, 404, { error: "skill not found" }); return; }
        const body = await parseBody(req) as Record<string, unknown>;
        const input = typeof body.input === "string" ? body.input : "";

        if (skill.kind === "script") {
          const { runScriptSkill } = await import("@/lib/skills/run-script");
          const cwd = typeof body.path === "string" && body.path.trim() ? body.path.trim() : process.cwd();
          const r = runScriptSkill(skill, input, { cwd });
          json(res, r.ok ? 202 : 400, r.ok ? { kind: "script", runId: r.run!.runId } : { error: r.error });
          return;
        }

        const { applySkillInput } = await import("@/lib/skills/contracts");
        const { Task, generateId } = await import("@/lib/db");
        const task = await Task.create({
          _id: generateId(),
          title: `[skill] ${skill.name}`,
          description: `Apply this skill:\n\n${applySkillInput(skill.body, input)}`,
          project: "ops",
          projectPath: process.cwd(),
          profile: typeof body.agentType === "string" ? body.agentType : "developer",
          status: "backlog",
          executor: "agent",
          source: "skill",
          output: { skill: skill.name },
        });
        broadcast("tasks:created", { taskId: task._id });
        json(res, 201, { kind: "instruction", task });
        return;
      }

      // GET /commands — the active (or ?profile=) local profile's LOCAL slash
      // commands + folder skills, discovered under <configDir>/commands and
      // <configDir>/skills. Read-only listing; these run natively via /commands/run.
      if (req.method === "GET" && urlPath === "/commands") {
        const { scanLocalCommands } = await import("@/lib/commands/local-catalog");
        const profile = parseQueryString(req.url ?? "").profile;
        json(res, 200, { commands: await scanLocalCommands(profile?.trim() || undefined) });
        return;
      }

      // POST /commands/run — { name, args?, profile? }. Run a local command/skill
      // natively by creating a standalone Task whose description IS "/<name> <args>"
      // (prompt === description for a standalone/auto task — subprocess.ts). The
      // name MUST exist in a fresh scan, so an arbitrary "/..." prompt can't be
      // injected; args is a single line appended after the slash invocation.
      if (req.method === "POST" && urlPath === "/commands/run") {
        const body = await parseBody(req) as Record<string, unknown>;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const args = typeof body.args === "string" ? body.args.trim() : "";
        const profile = typeof body.profile === "string" && body.profile.trim() ? body.profile.trim() : undefined;
        if (!name) { json(res, 400, { error: "name is required" }); return; }
        let projectPath: string;
        try {
          projectPath = normalizeHomeProjectPath(body.projectPath);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : "invalid projectPath" });
          return;
        }

        const { scanLocalCommands } = await import("@/lib/commands/local-catalog");
        const cmd = (await scanLocalCommands(profile)).find((c) => c.invokeName === name);
        if (!cmd) { json(res, 404, { error: "command not found in local catalog" }); return; }

        const safeArgs = args.replace(/[\r\n]+/g, " ").trim();
        const description = safeArgs ? `/${cmd.invokeName} ${safeArgs}` : `/${cmd.invokeName}`;

        const { normalizeTaskProfileKey, getActiveTaskProfileKey } = await import("@/lib/config/constants");
        const { Task, generateId } = await import("@/lib/db");
        const task = await Task.create({
          _id: generateId(),
          title: `[command] /${cmd.invokeName}`,
          description,
          project: "ops",
          projectPath,
          profile: profile ? normalizeTaskProfileKey(profile) : getActiveTaskProfileKey(),
          status: "backlog",
          executor: "agent",
          source: "command",
          output: { command: cmd.invokeName, kind: cmd.kind },
        });
        broadcast("tasks:created", { taskId: task._id });
        json(res, 201, { task });
        return;
      }

      // POST /skills/import-local — bulk-import the active (or ?profile) profile's
      // folder SKILLS into the brain library. Each SKILL.md body becomes a TRUSTED
      // instruction skill (operator's own skills). v1 copies SKILL.md text only;
      // bundled scripts stay at sourcePath (native /commands/run keeps full fidelity).
      if (req.method === "POST" && urlPath === "/skills/import-local") {
        const body = await parseBody(req) as Record<string, unknown>;
        const profile = typeof body.profile === "string" && body.profile.trim() ? body.profile.trim() : undefined;
        const { scanLocalCommands, readManifestBody } = await import("@/lib/commands/local-catalog");
        const { upsertSkill } = await import("@/lib/skills/store");

        const skills = (await scanLocalCommands(profile)).filter((c) => c.kind === "skill");
        let imported = 0, refined = 0, skipped = 0, withAssets = 0;
        for (const s of skills) {
          const text = await readManifestBody(s.sourcePath);
          if (!text || !text.trim()) { skipped++; continue; }
          const r = await upsertSkill({
            name: s.displayName,
            description: s.description,
            body: text,
            source: s.sourcePath,
            tags: ["local-skill", "imported"],
            trusted: true,
            kind: "instruction",
          });
          if (r.created) imported++; else if (r.refined) refined++; else skipped++;
          if (s.hasBundledFiles) withAssets++;
        }
        json(res, 200, { imported, refined, skipped, withAssets });
        return;
      }

      // GET /mcp — registered MCP servers + status (running/reachable, restartable).
      if (req.method === "GET" && urlPath === "/mcp") {
        const { listMcpStatus } = await import("@/lib/mcp/registry");
        json(res, 200, { servers: await listMcpStatus() });
        return;
      }
      // POST /mcp/:name/restart — restart a managed (HTTP/SSE) MCP server.
      const mcpRestart = urlPath.match(/^\/mcp\/([^/]+)\/restart$/);
      if (req.method === "POST" && mcpRestart) {
        const { getMcpServers, probeMcpServer } = await import("@/lib/mcp/registry");
        const server = getMcpServers().find((s) => s.name === decodeURIComponent(mcpRestart[1]));
        if (!server) { json(res, 404, { error: "mcp server not found in config (mcpServers)" }); return; }
        if (server.transport === "stdio") {
          json(res, 200, { name: server.name, restarted: false, detail: "stdio MCP servers are launched per session by the executor — nothing to restart; it relaunches on the next task." });
          return;
        }
        // For HTTP/SSE we don't own the process here; re-probe and report. A managed
        // supervisor (launchagent) is the follow-on for owned MCP processes.
        const status = await probeMcpServer(server);
        json(res, 200, { name: server.name, restarted: false, status: status.status, detail: `Not a HiveMatrix-managed process — current status: ${status.detail}. (Owned-process restart is a follow-on.)` });
        return;
      }

      // POST /skills/:name/used — usage signal from a CLI executor: bump useCount
      // and fold in an optional one-line refinement ("improves during use").
      const skillUsedMatch = urlPath.match(/^\/skills\/([^/]+)\/used$/);
      if (req.method === "POST" && skillUsedMatch) {
        const { markSkillUsed } = await import("@/lib/skills/store");
        const body = await parseBody(req) as Record<string, unknown>;
        const r = await markSkillUsed(decodeURIComponent(skillUsedMatch[1]), {
          refinement: typeof body.refinement === "string" ? body.refinement : undefined,
        });
        json(res, r.ok ? 200 : 404, r);
        return;
      }

      // GET /brain/search?q=...&n=... — keyword retrieval over the brain root,
      // so the console and the CLI executors (Claude Code / Codex) can recall a
      // stored doc by relevance, not just a pinned path. Same engine as the
      // brain_search tool; bounded + cloud-stall safe.
      if (req.method === "GET" && urlPath === "/brain/search") {
        const q = (parseQueryString(req.url ?? "").q ?? "").trim();
        const nRaw = parseInt(parseQueryString(req.url ?? "").n ?? "", 10);
        if (!q) { json(res, 400, { error: "q (query) is required" }); return; }
        const maxResults = Number.isFinite(nRaw) && nRaw > 0 ? Math.min(nRaw, 20) : undefined;
        const { isEmbeddingsEnabled } = await import("@/lib/embeddings/provider");
        if (isEmbeddingsEnabled()) {
          const { hybridBrainSearch } = await import("@/lib/embeddings/search");
          json(res, 200, await hybridBrainSearch(q, { maxResults }));
        } else {
          const { searchBrain } = await import("@/lib/brain/search");
          json(res, 200, await searchBrain(q, { maxResults }));
        }
        return;
      }

      // GET /embeddings — semantic-retrieval status (configured? index size?).
      if (req.method === "GET" && urlPath === "/embeddings") {
        const { getEmbeddingsConfig, isEmbeddingsEnabled } = await import("@/lib/embeddings/provider");
        const { loadIndex } = await import("@/lib/embeddings/index-store");
        const cfg = getEmbeddingsConfig();
        const idx = loadIndex();
        json(res, 200, {
          enabled: isEmbeddingsEnabled(),
          model: cfg?.model ?? null,
          endpoint: cfg?.endpoint ?? null,
          indexedModel: idx.model || null,
          indexedDocs: Object.keys(idx.entries).length,
        });
        return;
      }

      // POST /embeddings/reindex — rebuild the corpus vector index now.
      if (req.method === "POST" && urlPath === "/embeddings/reindex") {
        const { isEmbeddingsEnabled } = await import("@/lib/embeddings/provider");
        if (!isEmbeddingsEnabled()) {
          json(res, 400, { error: "embeddings not configured/enabled (set embeddings.enabled, endpoint, model in ~/.hivematrix/config.json)" });
          return;
        }
        const { reindexBrain } = await import("@/lib/embeddings/indexer");
        json(res, 200, await reindexBrain());
        return;
      }

      // POST /lanes/:kind/autostart — enable+start or disable+stop a manageable
      // launchagent lane. Body: { enabled: boolean }.
      const laneAutostartMatch = urlPath.match(/^\/lanes\/([a-z]+)\/autostart$/);
      if (req.method === "POST" && laneAutostartMatch) {
        const kind = laneAutostartMatch[1];
        const body = await parseBody(req) as Record<string, unknown>;
        const enabled = body.enabled === true;
        const { setLaneAutoStart, getLaneRuntimeDescriptor } = await import("@/lib/lanes/status");
        const desc = getLaneRuntimeDescriptor(kind);
        if (!desc.manageable || desc.runtimeMode !== "launchagent") {
          json(res, 400, { error: `${kind} is not a manageable launchagent lane` });
          return;
        }
        try {
          const next = setLaneAutoStart(kind, enabled);
          if (!next) { json(res, 404, { error: `lane ${kind} not found` }); return; }
          json(res, 200, { kind, enabled, settings: next });
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // POST /bees/:kind/autostart — compatibility alias for older clients.
      const beeAutostartMatch = urlPath.match(/^\/bees\/([a-z]+)\/autostart$/);
      if (req.method === "POST" && beeAutostartMatch) {
        const kind = beeAutostartMatch[1];
        const body = await parseBody(req) as Record<string, unknown>;
        const enabled = body.enabled === true;
        const { setLaneWorkerAutoStart, getLaneWorkerRuntimeDescriptor } = await import("@/lib/lanes/service-manager");
        const desc = getLaneWorkerRuntimeDescriptor(kind);
        if (!desc.manageable || desc.runtimeMode !== "launchagent") {
          json(res, 400, { error: `${kind} is not a manageable launchagent lane worker` });
          return;
        }
        try {
          const next = setLaneWorkerAutoStart(kind, enabled);
          if (!next) { json(res, 404, { error: `lane worker ${kind} not found` }); return; }
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
        const { restartLaneWorkerService } = await import("@/lib/lanes/service-manager");
        try { restartLaneWorkerService(kind); json(res, 200, { kind, restarted: true }); }
        catch (e) { json(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
        return;
      }

      // GET /connectivity
      if (req.method === "GET" && urlPath === "/connectivity") {
        const { getPostureReport } = await import("@/lib/connectivity/posture");
        json(res, 200, { ...policy.getState(), posture: getPostureReport() });
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
      // GET /linkedin/job — preview the domain-locked LinkedIn engagement job spec (W5.3)
      if (req.method === "GET" && urlPath === "/linkedin/job") {
        const { buildLinkedInEngagementJob } = await import("@/lib/linkedin/engagement");
        json(res, 200, buildLinkedInEngagementJob());
        return;
      }

      // POST /linkedin/ritual — install the daily LinkedIn engagement directive (W5.3)
      if (req.method === "POST" && urlPath === "/linkedin/ritual") {
        const { buildLinkedInRitualDirective } = await import("@/lib/linkedin/engagement");
        const { createDirective } = await import("@/lib/orchestrator/directive-store");
        const body = await parseBody(req) as Record<string, unknown>;
        const directive = createDirective(buildLinkedInRitualDirective({
          projectPath: typeof body.projectPath === "string" ? body.projectPath : undefined,
          dailyAtHour: typeof body.dailyAtHour === "number" ? body.dailyAtHour : undefined,
          voiceNote: typeof body.voiceNote === "string" ? body.voiceNote : undefined,
        }));
        json(res, 201, directive);
        return;
      }

      // POST /content/brief — fan a content brief into channel renditions,
      // stage them as task artifacts, and raise one approve-by-text gate (W5.2).
      if (req.method === "POST" && urlPath === "/content/brief") {
        const { Task, generateId } = await import("@/lib/db");
        const { runContentPipeline } = await import("@/lib/content/pipeline");
        const { CONTENT_CHANNELS, isContentChannel } = await import("@/lib/content/channels");
        const body = await parseBody(req) as Record<string, unknown>;
        const topic = typeof body.topic === "string" ? body.topic.trim() : "";
        if (!topic) { json(res, 400, { error: "topic is required" }); return; }
        const brief = {
          topic,
          audience: typeof body.audience === "string" ? body.audience : undefined,
          goal: typeof body.goal === "string" ? body.goal : undefined,
          notes: typeof body.notes === "string" ? body.notes : undefined,
        };
        const channels = Array.isArray(body.channels)
          ? body.channels.filter((c): c is string => typeof c === "string").filter(isContentChannel)
          : CONTENT_CHANNELS;
        const task = await Task.create({
          _id: generateId(),
          title: `Content: ${topic.slice(0, 60)}`,
          description: `Content brief → renditions for ${channels.join(", ")}`,
          projectPath: process.cwd(),
          profile: "marketing",
          source: "content",
          status: "review",
          executor: "agent",
        });
        const result = await runContentPipeline(task._id, brief, channels.length ? channels : CONTENT_CHANNELS);
        broadcast("tasks:created", { taskId: task._id });
        json(res, 201, result);
        return;
      }

      // POST /uploads — receive raw file bytes (base64 JSON) from a remote client
      // and persist them under ~/.hivematrix/uploads, returning the absolute local
      // path the agent can read. The iOS app's own file paths point at the phone,
      // which this Mac can't open; callers upload here first, then reference the
      // returned `path` as a task attachment.
      if (req.method === "POST" && urlPath === "/uploads") {
        const { saveUpload } = await import("@/lib/uploads/store");
        const body = await parseBody(req) as Record<string, unknown>;
        try {
          const saved = saveUpload({
            filename: typeof body.filename === "string" ? body.filename : undefined,
            dataBase64: typeof body.dataBase64 === "string" ? body.dataBase64 : undefined,
          });
          json(res, 201, saved);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : "upload failed" });
        }
        return;
      }

      if (req.method === "POST" && urlPath === "/tasks") {
        const { Task, generateId } = await import("@/lib/db");
        const { deriveTaskTitle } = await import("@/lib/tasks/derive-title");
        const { normalizeTaskAttachments, appendAttachmentBlock } = await import("@/lib/tasks/attachments");
        const body = await parseBody(req) as Record<string, unknown>;
        const attachments = normalizeTaskAttachments(Array.isArray(body.attachments) ? body.attachments as unknown[] : []);
        const description = typeof body.description === "string" ? body.description : "";
        body.description = appendAttachmentBlock(description, attachments);
        delete body.attachments;
        // "Make me an AI-news video" → route straight to the structured draft +
        // review (one task with the full script + Edit-the-draft), instead of a
        // general agent that would spawn a second review task plus a summary.
        const { isAiNewsVideoRequest } = await import("@/lib/video/news-intent");
        if (body.executor !== "video-review" && isAiNewsVideoRequest(description)) {
          try {
            const { draftNewsVideo } = await import("@/lib/video/news-review");
            const draft = await draftNewsVideo({});
            if (draft.taskId) broadcast("tasks:created", { taskId: draft.taskId });
            json(res, 201, { routed: "video-review", taskId: draft.taskId, draftId: draft.id, title: draft.title });
            return;
          } catch (e) {
            console.error(`[tasks] AI-news video route failed; creating a normal task: ${e instanceof Error ? e.message : e}`);
            // fall through to a normal task
          }
        }
        // Title is optional — derive it from the instructions when absent/blank.
        const title = typeof body.title === "string" ? body.title.trim() : "";
        body.title = title || deriveTaskTitle(description);
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
        // Video script review: a reply to a video-draft review task drives
        // approve / edit / regenerate / cancel — not the generic agent re-queue.
        let videoDraftId: string | undefined;
        try {
          const { Task } = await import("@/lib/db");
          const t = await Task.findById(tid);
          const rawOut = t ? (t as Record<string, unknown>).output : undefined;
          const parsed = typeof rawOut === "string" ? JSON.parse(rawOut) : rawOut;
          const d = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).videoDraftId : undefined;
          if (typeof d === "string" && d) videoDraftId = d;
        } catch { /* detection failed → treat as a normal task */ }
        if (videoDraftId) {
          // Creating the Browser Lane portal child task is an outward workflow step
          // — require an EXPLICIT word ("approve" / an edited script / "cancel"),
          // never a blank submission.
          if (!text) { json(res, 400, { error: "Reply \"approve\" to create the Browser Lane portal task, paste an edited script, give a change to rework it, or \"cancel\"." }); return; }
          try {
            const { resolveVideoDraft } = await import("@/lib/video/news-review");
            const out = await resolveVideoDraft(videoDraftId, text);
            broadcast("tasks:updated", { taskId: tid });
            json(res, 200, { ok: true, video: out?.decision.action ?? "ignored", reply: out?.reply });
          } catch (e) {
            console.error(`[video-review] resolve failed: ${e instanceof Error ? e.message : e}`);
            json(res, 500, { error: "video review action failed" });
          }
          return;
        }
        const { normalizeTaskAttachments, prependAttachmentBlock } = await import("@/lib/tasks/attachments");
        const attachments = normalizeTaskAttachments(Array.isArray(body.attachments) ? body.attachments as unknown[] : []);
        if (!text && !attachments.length) { json(res, 400, { error: "text or attachment is required" }); return; }
        const { getPendingStuck, resolveStuck } = await import("@/lib/orchestrator/stuck");
        const pending = getPendingStuck().filter(r => r.taskId === tid);
        if (!pending.length) {
          const { Task } = await import("@/lib/db");
          const { appendReplyContinuation } = await import("@/lib/tasks/reply-continuation");
          const cur = await Task.findById(tid);
          if (!cur) { json(res, 404, { error: "Not found" }); return; }
          // Reply is allowed for an explicit needs_input request AND for any
          // finished task the operator wants to answer/continue (review, failed,
          // cancelled). In all cases the reply is appended and the task re-runs.
          const replyable = cur.reviewState === "needs_input"
            || ["review", "failed", "cancelled"].includes(String(cur.status));
          if (!replyable) {
            json(res, 404, { error: "This task can't take a reply in its current state" });
            return;
          }
          await Task.findByIdAndUpdate(tid, {
            description: appendReplyContinuation(String(cur.description ?? ""), text, attachments),
            status: "backlog",
            error: null,
            agentPid: null,
            startedAt: null,
            completedAt: null,
            reviewState: null,
          });
          broadcast("tasks:updated", { taskId: tid, status: "backlog" });
          json(res, 200, { ok: true, fallback: "requeued" });
          return;
        }
        // Resolve the most-recent pending request.
        const req2 = pending.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
        const ok = await resolveStuck(tid, req2.timestamp, "reply", "console", prependAttachmentBlock(text, attachments));
        if (!ok) { json(res, 409, { error: "Already resolved" }); return; }
        // Clear the needs_input reviewState so the board stops flagging it.
        const { Task } = await import("@/lib/db");
        await Task.findByIdAndUpdate(tid, { reviewState: null });
        json(res, 200, { ok: true }); return;
      }

      // POST /tasks/:id/steer — interrupt a running agent and resume it with new
      // operator guidance. The agent-manager guards state (in-progress, Codex
      // thread, session available) and surfaces a clear reason when it can't.
      const steerMatch = urlPath.match(/^\/tasks\/([^/]+)\/steer$/);
      if (req.method === "POST" && steerMatch) {
        const tid = steerMatch[1];
        const body = await parseBody(req) as Record<string, unknown>;
        const message = String(body.message ?? body.text ?? "").trim();
        if (!message) { json(res, 400, { error: "message is required" }); return; }
        try {
          const { agentManager } = await import("@/lib/orchestrator/agent-manager");
          await agentManager.requestSteerByTaskId(tid, message);
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, 409, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // POST /tasks/:id/<action> — retry | archive | cancel
      const taskActionMatch = urlPath.match(/^\/tasks\/([^/]+)\/(retry|archive|cancel)$/);
      if (req.method === "POST" && taskActionMatch) {
        const { Task } = await import("@/lib/db");
        const [, tid, action] = taskActionMatch;
        if (action === "retry") {
          // Optional steering: append operator guidance + attachment paths to the
          // task's instructions so the rerun is steered, not a blind repeat.
          const body = await parseBody(req) as Record<string, unknown>;
          const steer = String(body.steer ?? "").trim();
          const { normalizeTaskAttachments, renderAttachmentBlock } = await import("@/lib/tasks/attachments");
          const attachments = normalizeTaskAttachments(Array.isArray(body.attachments) ? body.attachments as unknown[] : []);
          const updates: Record<string, unknown> = {
            status: "backlog", error: null, agentPid: null, startedAt: null, completedAt: null, reviewState: null,
          };
          if (steer || attachments.length) {
            const cur = await Task.findById(tid);
            if (!cur) { json(res, 404, { error: "Not found" }); return; }
            let block = "\n\n--- Operator guidance (retry) ---";
            if (steer) block += "\n" + steer;
            if (attachments.length) block += "\n" + renderAttachmentBlock(attachments);
            updates.description = (cur.description ?? "") + block;
          }
          const t = await Task.findByIdAndUpdate(tid, updates);
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
