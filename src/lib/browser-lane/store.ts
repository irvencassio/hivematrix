import { generateId, getDb } from "@/lib/db";
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
  status: string;
  probeCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export function upsertBrowserSite(input: unknown): BrowserSite {
  const site = normalizeBrowserSite(input);
  const db = getDb();
  db.prepare(`
    INSERT INTO browser_sites (_id, displayName, homeUrl, loginUrl, allowedDomains, profileRef, authStrategy, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(_id) DO UPDATE SET
      displayName = excluded.displayName,
      homeUrl = excluded.homeUrl,
      loginUrl = excluded.loginUrl,
      allowedDomains = excluded.allowedDomains,
      profileRef = excluded.profileRef,
      authStrategy = excluded.authStrategy,
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
    site.notes,
  );

  if (site.credentialRef) {
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

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
