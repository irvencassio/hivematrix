import { generateId, getDb } from "@/lib/db";
import { laneDisplayName } from "@/lib/lanes/contracts";
import {
  normalizeBrowserReadinessState,
  normalizeBrowserSite,
  normalizeReadinessProbe,
  type BrowserReadinessColor,
  type BrowserReadinessStatus,
  type BrowserSite,
  type ReadinessProbe,
} from "./contracts";

interface BrowserSiteRow {
  _id: string;
  displayName: string;
  homeUrl: string;
  loginUrl: string | null;
  allowedDomains: string;
  profileRef: string | null;
  authStrategy: BrowserSite["authStrategy"];
  providerAccount: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  credentialRef?: string | null;
}

interface BrowserProbeRow {
  _id: string;
  siteId: string;
  name: string;
  url: string;
  assertions_json: string;
  requiresAuth: number;
  enabled: number;
}

interface BrowserTraceRunRow {
  _id: string;
  siteId: string | null;
  workflowId: string | null;
  status: string;
  traceDir: string | null;
  startedAt: string;
  completedAt: string | null;
  metadata: string;
}

interface BrowserTraceEventRow {
  _id: number;
  traceRunId: string;
  event: string;
  payload: string;
  screenshotPath: string | null;
  createdAt: string;
}

export interface BrowserReadinessRunRecord {
  id: string;
  siteId: string;
  probeId: string | null;
  status: BrowserReadinessStatus;
  color: BrowserReadinessColor;
  summary: string;
  traceRunId: string | null;
}

export interface BrowserReadinessRunInput {
  siteId: string;
  probeId?: string | null;
  status: BrowserReadinessStatus;
  color: BrowserReadinessColor;
  summary?: string;
  traceRunId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BrowserSiteSummary {
  id: string;
  displayName: string;
  homeUrl: string;
  loginUrl: string | null;
  allowedDomains: string[];
  credentialRef: string | null;
  authStrategy: BrowserSite["authStrategy"];
  providerAccount: string | null;
  status: string;
  probeCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BrowserTraceEvent {
  id: number;
  traceRunId: string;
  event: string;
  payload: Record<string, unknown>;
  screenshotPath: string | null;
  createdAt: string;
}

export interface BrowserTraceRunSummary {
  id: string;
  siteId: string | null;
  workflowId: string | null;
  status: string;
  traceDir: string | null;
  startedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  eventCount: number;
}

export interface BrowserTraceRunDetail extends BrowserTraceRunSummary {
  events: BrowserTraceEvent[];
}

export function upsertBrowserSite(input: unknown): BrowserSite {
  const site = normalizeBrowserSite(input);
  const db = getDb();
  db.prepare(`
    INSERT INTO browser_sites (_id, displayName, homeUrl, loginUrl, allowedDomains, profileRef, authStrategy, providerAccount, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(_id) DO UPDATE SET
      displayName = excluded.displayName,
      homeUrl = excluded.homeUrl,
      loginUrl = excluded.loginUrl,
      allowedDomains = excluded.allowedDomains,
      profileRef = excluded.profileRef,
      authStrategy = excluded.authStrategy,
      providerAccount = excluded.providerAccount,
      notes = excluded.notes,
      updatedAt = datetime('now')
  `).run(
    site.id,
    site.displayName,
    site.homeUrl,
    site.loginUrl,
    JSON.stringify(site.allowedDomains),
    site.profileRef,
    site.authStrategy,
    site.providerAccount,
    site.notes,
  );

  // A credential row exists only for keychain_password sites — that is the one
  // strategy with a real secret behind the reference. SSO/manual sites carry no
  // credentialRef secret (any "session label" is non-secret metadata on the site).
  if (site.authStrategy === "keychain_password" && site.credentialRef) {
    db.prepare(`
      INSERT INTO browser_credentials (_id, siteId, credentialRef, kind, allowedDomains, status)
      VALUES (?, ?, ?, 'keychain_password', ?, 'unknown')
      ON CONFLICT(credentialRef) DO UPDATE SET
        siteId = excluded.siteId,
        allowedDomains = excluded.allowedDomains,
        updatedAt = datetime('now')
    `).run(generateId(), site.id, site.credentialRef, JSON.stringify(site.allowedDomains));
  }

  return getBrowserSite(site.id)!;
}

export function getBrowserSite(id: string): BrowserSite | null {
  const row = getDb().prepare(`
    SELECT s.*, c.credentialRef AS credentialRef
    FROM browser_sites s
    LEFT JOIN browser_credentials c ON c.siteId = s._id
    WHERE s._id = ?
    ORDER BY c.createdAt ASC
    LIMIT 1
  `).get(id) as BrowserSiteRow | undefined;
  return row ? rowToSite(row) : null;
}

export function listBrowserSites(filter: { siteId?: string | null } = {}): BrowserSite[] {
  const params: string[] = [];
  const where = filter.siteId && filter.siteId !== "all" ? "WHERE s._id = ?" : "";
  if (where) params.push(filter.siteId!);
  const rows = getDb().prepare(`
    SELECT s.*, c.credentialRef AS credentialRef
    FROM browser_sites s
    LEFT JOIN browser_credentials c ON c.siteId = s._id
    ${where}
    GROUP BY s._id
    ORDER BY s.displayName COLLATE NOCASE ASC
  `).all(...params) as BrowserSiteRow[];
  return rows.map(rowToSite);
}

export function listBrowserSiteSummaries(filter: { siteId?: string | null } = {}): BrowserSiteSummary[] {
  const params: string[] = [];
  const where = filter.siteId && filter.siteId !== "all" ? "WHERE s._id = ?" : "";
  if (where) params.push(filter.siteId!);
  const rows = getDb().prepare(`
    SELECT
      s.*,
      c.credentialRef AS credentialRef,
      (SELECT COUNT(*) FROM browser_readiness_probes p WHERE p.siteId = s._id AND p.enabled = 1) AS probeCount
    FROM browser_sites s
    LEFT JOIN browser_credentials c ON c.siteId = s._id
    ${where}
    GROUP BY s._id
    ORDER BY s.displayName COLLATE NOCASE ASC
  `).all(...params) as Array<BrowserSiteRow & { status: string; probeCount: number }>;
  return rows.map((row) => {
    const site = rowToSite(row);
    return {
      id: site.id,
      displayName: site.displayName,
      homeUrl: site.homeUrl,
      loginUrl: site.loginUrl,
      allowedDomains: site.allowedDomains,
      credentialRef: site.credentialRef,
      authStrategy: site.authStrategy,
      providerAccount: site.providerAccount,
      status: row.status,
      probeCount: Number(row.probeCount ?? 0),
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    };
  });
}

export function upsertBrowserReadinessProbe(input: unknown): ReadinessProbe {
  const probe = normalizeReadinessProbe(input);
  getDb().prepare(`
    INSERT INTO browser_readiness_probes (_id, siteId, name, url, assertions_json, requiresAuth, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(_id) DO UPDATE SET
      siteId = excluded.siteId,
      name = excluded.name,
      url = excluded.url,
      assertions_json = excluded.assertions_json,
      requiresAuth = excluded.requiresAuth,
      enabled = 1,
      updatedAt = datetime('now')
  `).run(
    probe.id,
    probe.siteId,
    probe.name,
    probe.url,
    JSON.stringify(probe.assertions),
    probe.requiresAuth ? 1 : 0,
  );
  return probe;
}

export function listEnabledReadinessProbes(siteId: string): ReadinessProbe[] {
  const rows = getDb().prepare(`
    SELECT * FROM browser_readiness_probes
    WHERE siteId = ? AND enabled = 1
    ORDER BY name COLLATE NOCASE ASC, _id ASC
  `).all(siteId) as BrowserProbeRow[];
  return rows.map(rowToProbe);
}

export function createBrowserTraceRun(input: { siteId?: string | null; workflowId?: string | null; metadata?: Record<string, unknown> } = {}): string {
  const id = generateId();
  getDb().prepare(`
    INSERT INTO browser_trace_runs (_id, siteId, workflowId, status, metadata)
    VALUES (?, ?, ?, 'running', ?)
  `).run(id, input.siteId ?? null, input.workflowId ?? null, JSON.stringify(input.metadata ?? {}));
  return id;
}

export function recordBrowserTraceEvent(input: { traceRunId: string; event: string; payload?: Record<string, unknown>; screenshotPath?: string | null }): void {
  getDb().prepare(`
    INSERT INTO browser_trace_events (traceRunId, event, payload, screenshotPath)
    VALUES (?, ?, ?, ?)
  `).run(input.traceRunId, input.event, JSON.stringify(input.payload ?? {}), input.screenshotPath ?? null);
}

export function completeBrowserTraceRun(id: string, status: "done" | "failed", metadata: Record<string, unknown> = {}): void {
  getDb().prepare(`
    UPDATE browser_trace_runs
    SET status = ?, completedAt = datetime('now'), metadata = ?
    WHERE _id = ?
  `).run(status, JSON.stringify(metadata), id);
}

export function listBrowserTraceRuns(limit = 20): BrowserTraceRunSummary[] {
  const rows = getDb().prepare(`
    SELECT
      r.*,
      (SELECT COUNT(*) FROM browser_trace_events e WHERE e.traceRunId = r._id) AS eventCount
    FROM browser_trace_runs r
    ORDER BY r.startedAt DESC, r._id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(100, Math.floor(limit)))) as Array<BrowserTraceRunRow & { eventCount: number }>;
  return rows.map(rowToTraceSummary);
}

export function getLatestBrowserTraceRun(): BrowserTraceRunDetail | null {
  const latest = listBrowserTraceRuns(1)[0];
  return latest ? getBrowserTraceRun(latest.id) : null;
}

export function getBrowserTraceRun(id: string): BrowserTraceRunDetail | null {
  const row = getDb().prepare(`
    SELECT
      r.*,
      (SELECT COUNT(*) FROM browser_trace_events e WHERE e.traceRunId = r._id) AS eventCount
    FROM browser_trace_runs r
    WHERE r._id = ?
  `).get(id) as (BrowserTraceRunRow & { eventCount: number }) | undefined;
  if (!row) return null;
  const events = getDb().prepare(`
    SELECT * FROM browser_trace_events
    WHERE traceRunId = ?
    ORDER BY _id ASC
  `).all(id) as BrowserTraceEventRow[];
  return { ...rowToTraceSummary(row), events: events.map(rowToTraceEvent) };
}

export function recordBrowserReadinessRun(input: BrowserReadinessRunInput): BrowserReadinessRunRecord {
  const state = normalizeBrowserReadinessState(input.status);
  const id = generateId();
  getDb().prepare(`
    INSERT INTO browser_readiness_runs (_id, siteId, probeId, status, color, summary, traceRunId, completedAt, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(
    id,
    input.siteId,
    input.probeId ?? null,
    state.status,
    input.color || state.color,
    input.summary ?? "",
    input.traceRunId ?? null,
    JSON.stringify(input.metadata ?? {}),
  );
  return {
    id,
    siteId: input.siteId,
    probeId: input.probeId ?? null,
    status: state.status,
    color: input.color || state.color,
    summary: input.summary ?? "",
    traceRunId: input.traceRunId ?? null,
  };
}

// ------------------------------------------------------------------
// Manual readiness mark — the honest fallback when no live probe is feasible
// (e.g. an SSO session we can't programmatically validate yet). The operator
// vouches for the state from a constrained allow-list; nothing fabricates green.
// Recorded as a normal readiness run tagged metadata.source = "manual" so the
// dashboard, matcher, and COO gating consume it through the existing path.
// ------------------------------------------------------------------
export const MANUAL_READINESS_STATES = ["ready", "needs_reauth", "blocked"] as const;
export type ManualReadinessState = (typeof MANUAL_READINESS_STATES)[number];

export interface ManualReadinessInput {
  siteId: string;
  state: ManualReadinessState;
  note?: string;
}

export function recordManualReadiness(input: ManualReadinessInput): BrowserReadinessRunRecord {
  const siteId = (input.siteId ?? "").trim();
  if (!siteId) throw new Error("siteId is required");
  if (!(MANUAL_READINESS_STATES as readonly string[]).includes(input.state)) {
    throw new Error(`state must be one of: ${MANUAL_READINESS_STATES.join(", ")}`);
  }
  const state = normalizeBrowserReadinessState(input.state);
  const note = typeof input.note === "string" ? input.note.trim() : "";
  return recordBrowserReadinessRun({
    siteId,
    status: state.status,
    color: state.color,
    summary: note ? `Operator marked ${state.label}: ${note}` : `Operator marked ${state.label}`,
    metadata: { source: "manual", note },
  });
}

// ------------------------------------------------------------------
// Site / auth readiness dashboard
//
// Aggregates the per-site MVP signals into one view: the latest readiness run
// (status + color), the Keychain credential reference and its verification
// status, the trace linkage for drill-down, and enabled probe counts. Secrets
// never appear here — only credentialRef metadata, exactly as stored.
// ------------------------------------------------------------------
export interface BrowserLaneDashboardSite {
  id: string;
  displayName: string;
  homeUrl: string;
  loginUrl: string | null;
  allowedDomains: string[];
  authStrategy: BrowserSite["authStrategy"];
  providerAccount: string | null;
  credentialRef: string | null;
  credentialStatus: string | null;
  credentialLastVerifiedAt: string | null;
  probeCount: number;
  readiness: {
    status: BrowserReadinessStatus;
    color: BrowserReadinessColor;
    label: string;
    summary: string;
    runId: string | null;
    traceRunId: string | null;
    completedAt: string | null;
    startedAt: string | null;
    lastRunAt: string | null;
    ageMs: number | null;
    stale: boolean;
  };
}

export interface BrowserLaneReadinessDashboard {
  lane: "browser";
  laneDisplayName: string;
  staleAfterHours: number;
  totals: {
    sites: number;
    byColor: Record<BrowserReadinessColor, number>;
    needsAttention: number;
    stale: number;
  };
  sites: BrowserLaneDashboardSite[];
}

export interface BrowserLaneReadinessQuery {
  siteId?: string | null;
  staleAfterHours?: number;
  now?: Date;
}

interface DashboardRow extends BrowserSiteRow {
  credentialStatus: string | null;
  credentialLastVerifiedAt: string | null;
  probeCount: number;
  runId: string | null;
  readinessStatus: string | null;
  readinessColor: string | null;
  readinessSummary: string | null;
  readinessTraceRunId: string | null;
  readinessCompletedAt: string | null;
  readinessStartedAt: string | null;
}

export function getBrowserLaneReadinessDashboard(filter: BrowserLaneReadinessQuery = {}): BrowserLaneReadinessDashboard {
  const staleAfterHours = Number.isFinite(filter.staleAfterHours) ? Math.max(0, filter.staleAfterHours as number) : 24;
  const nowMs = (filter.now ?? new Date()).getTime();
  const staleThresholdMs = staleAfterHours * 3600 * 1000;
  const params: string[] = [];
  const where = filter.siteId && filter.siteId !== "all" ? "WHERE s._id = ?" : "";
  if (where) params.push(filter.siteId!);
  const rows = getDb().prepare(`
    SELECT
      s.*,
      c.credentialRef AS credentialRef,
      c.status AS credentialStatus,
      c.lastVerifiedAt AS credentialLastVerifiedAt,
      (SELECT COUNT(*) FROM browser_readiness_probes p WHERE p.siteId = s._id AND p.enabled = 1) AS probeCount,
      lr._id AS runId,
      lr.status AS readinessStatus,
      lr.color AS readinessColor,
      lr.summary AS readinessSummary,
      lr.traceRunId AS readinessTraceRunId,
      lr.completedAt AS readinessCompletedAt,
      lr.startedAt AS readinessStartedAt
    FROM browser_sites s
    LEFT JOIN browser_credentials c ON c.siteId = s._id
    LEFT JOIN browser_readiness_runs lr ON lr._id = (
      SELECT _id FROM browser_readiness_runs
      WHERE siteId = s._id
      ORDER BY startedAt DESC, rowid DESC
      LIMIT 1
    )
    ${where}
    GROUP BY s._id
    ORDER BY s.displayName COLLATE NOCASE ASC
  `).all(...params) as DashboardRow[];

  const byColor: Record<BrowserReadinessColor, number> = { green: 0, yellow: 0, orange: 0, red: 0, gray: 0 };
  let needsAttention = 0;
  let staleCount = 0;

  const sites = rows.map((row): BrowserLaneDashboardSite => {
    const site = rowToSite(row);
    // No run yet → honest "unknown/gray" rather than a fabricated "ready".
    const state = normalizeBrowserReadinessState(row.readinessStatus ?? "unknown");
    const color = (row.readinessColor as BrowserReadinessColor | null) ?? state.color;
    byColor[color] += 1;
    if (color === "orange" || color === "red") needsAttention += 1;
    // Staleness: no run at all is stale; otherwise age of the latest run vs the
    // threshold. SQLite datetime() is UTC, stored without a zone marker.
    const lastRunAt = row.readinessStartedAt ?? null;
    const lastRunMs = lastRunAt ? Date.parse(lastRunAt.replace(" ", "T") + "Z") : NaN;
    const ageMs = Number.isFinite(lastRunMs) ? Math.max(0, nowMs - lastRunMs) : null;
    const stale = lastRunAt == null || ageMs == null || ageMs > staleThresholdMs;
    if (stale) staleCount += 1;
    return {
      id: site.id,
      displayName: site.displayName,
      homeUrl: site.homeUrl,
      loginUrl: site.loginUrl,
      allowedDomains: site.allowedDomains,
      authStrategy: site.authStrategy,
      providerAccount: site.providerAccount,
      credentialRef: site.credentialRef,
      credentialStatus: row.credentialStatus ?? null,
      credentialLastVerifiedAt: row.credentialLastVerifiedAt ?? null,
      probeCount: Number(row.probeCount ?? 0),
      readiness: {
        status: state.status,
        color,
        label: state.label,
        summary: row.readinessSummary ?? "",
        runId: row.runId ?? null,
        traceRunId: row.readinessTraceRunId ?? null,
        completedAt: row.readinessCompletedAt ?? null,
        startedAt: row.readinessStartedAt ?? null,
        lastRunAt,
        ageMs,
        stale,
      },
    };
  });

  return {
    lane: "browser",
    laneDisplayName: laneDisplayName("browser"),
    staleAfterHours,
    totals: { sites: sites.length, byColor, needsAttention, stale: staleCount },
    sites,
  };
}

// ------------------------------------------------------------------
// Readiness match — given target domain(s), find the configured site and report
// its readiness. Metadata only: site id/name, color/status, the non-secret
// credentialRef pointer, and traceRunId. Never credential values or cookies.
// ------------------------------------------------------------------
export interface BrowserSiteReadinessMatch {
  matched: boolean;
  siteId: string | null;
  siteName: string | null;
  color: BrowserReadinessColor | null;
  status: BrowserReadinessStatus | null;
  credentialRef: string | null;
  traceRunId: string | null;
  stale: boolean;
  lastRunAt: string | null;
  ageMs: number | null;
}

function readinessHost(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function hostsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function matchBrowserSiteReadiness(
  domains: string[],
  opts: { staleAfterHours?: number; now?: Date } = {},
): BrowserSiteReadinessMatch {
  const none: BrowserSiteReadinessMatch = {
    matched: false, siteId: null, siteName: null, color: null, status: null, credentialRef: null, traceRunId: null,
    stale: false, lastRunAt: null, ageMs: null,
  };
  const wanted = (domains ?? []).map(readinessHost).filter(Boolean);
  if (wanted.length === 0) return none;
  const dashboard = getBrowserLaneReadinessDashboard({ staleAfterHours: opts.staleAfterHours, now: opts.now });
  for (const site of dashboard.sites) {
    const hosts = site.allowedDomains.map(readinessHost);
    if (wanted.some((w) => hosts.some((h) => hostsMatch(w, h)))) {
      return {
        matched: true,
        siteId: site.id,
        siteName: site.displayName,
        color: site.readiness.color,
        status: site.readiness.status,
        credentialRef: site.credentialRef,
        traceRunId: site.readiness.traceRunId,
        stale: site.readiness.stale,
        lastRunAt: site.readiness.lastRunAt,
        ageMs: site.readiness.ageMs,
      };
    }
  }
  return none;
}

function rowToSite(row: BrowserSiteRow): BrowserSite {
  return normalizeBrowserSite({
    id: row._id,
    displayName: row.displayName,
    homeUrl: row.homeUrl,
    loginUrl: row.loginUrl,
    allowedDomains: parseJsonArray(row.allowedDomains),
    credentialRef: row.credentialRef ?? null,
    profileRef: row.profileRef,
    authStrategy: row.authStrategy,
    providerAccount: row.providerAccount ?? null,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function rowToProbe(row: BrowserProbeRow): ReadinessProbe {
  return normalizeReadinessProbe({
    id: row._id,
    siteId: row.siteId,
    name: row.name,
    url: row.url,
    assertions: parseJsonArray(row.assertions_json),
    requiresAuth: row.requiresAuth === 1,
  });
}

function rowToTraceSummary(row: BrowserTraceRunRow & { eventCount: number }): BrowserTraceRunSummary {
  return {
    id: row._id,
    siteId: row.siteId,
    workflowId: row.workflowId,
    status: row.status,
    traceDir: row.traceDir,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    metadata: redactSecrets(parseJsonObject(row.metadata)) as Record<string, unknown>,
    eventCount: Number(row.eventCount ?? 0),
  };
}

function rowToTraceEvent(row: BrowserTraceEventRow): BrowserTraceEvent {
  return {
    id: row._id,
    traceRunId: row.traceRunId,
    event: row.event,
    payload: redactSecrets(parseJsonObject(row.payload)) as Record<string, unknown>,
    screenshotPath: row.screenshotPath,
    createdAt: row.createdAt,
  };
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = /password|secret|token|cookie|totp/i.test(key) ? "[redacted]" : redactSecrets(entry);
  }
  return redacted;
}
