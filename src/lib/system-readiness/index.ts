import { getDb } from "@/lib/db";
import { getBrowserLaneReadinessDashboard, type BrowserLaneReadinessDashboard } from "@/lib/browser-lane/store";
import { getBrowserLaneReadinessConfig } from "@/lib/browser-lane/readiness-schedule";
import { getAllLaneAppStates } from "@/lib/lane-apps";
import { readConfigMatchedLocalModelHealth, type LocalModelHealth } from "@/lib/local-model/health";
import { getWorkflowInbox, type WorkflowInbox } from "@/lib/workflows/inbox";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { getBundledVersion } from "@/lib/version/bundle-version";
import { seedDefaultCooRoutingRules } from "@/lib/coo/store";

export type SystemReadinessSeverity = "ok" | "info" | "warn" | "critical";

export interface SystemReadinessCheck {
  id: string;
  label: string;
  severity: SystemReadinessSeverity;
  summary: string;
  nextAction?: string;
  repairActions?: SystemReadinessRepairAction[];
  details?: Record<string, unknown>;
}

export interface SystemReadinessReport {
  ok: boolean;
  generatedAt: string;
  summary: string;
  counts: Record<SystemReadinessSeverity, number>;
  checks: SystemReadinessCheck[];
}

export const SYSTEM_READINESS_REPAIR_ACTIONS = [
  "seed_coo_rules",
] as const;
export type SystemReadinessRepairActionId = (typeof SYSTEM_READINESS_REPAIR_ACTIONS)[number];

export interface SystemReadinessRepairAction {
  id: SystemReadinessRepairActionId;
  label: string;
  description: string;
}

export interface SystemReadinessRepairResult {
  ok: boolean;
  action: SystemReadinessRepairActionId;
  message: string;
  changed: number;
  report: SystemReadinessReport;
}

interface MinimalLaneAppState {
  id: string;
  displayName: string;
  status: string;
  installed?: { short: string; build: string } | null;
  expected?: { short: string; build: string } | null;
}

interface MinimalBrowserDashboard {
  totals: BrowserLaneReadinessDashboard["totals"];
  sites: Array<{
    id?: string;
    displayName?: string;
    readiness?: {
      color?: string;
      stale?: boolean;
      status?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
}

type MinimalLocalModelHealth = Partial<Omit<LocalModelHealth, "provider">> & {
  provider?: string;
};

export interface SystemReadinessDeps {
  now?: () => Date;
  version?: () => string;
  connectivity?: () => string;
  getBrowserDashboard?: () => MinimalBrowserDashboard;
  getLaneApps?: () => Promise<MinimalLaneAppState[]> | MinimalLaneAppState[];
  getWorkflowInbox?: () => WorkflowInbox;
  readLocalModelHealth?: () => MinimalLocalModelHealth | null;
}

const SEVERITIES: SystemReadinessSeverity[] = ["critical", "warn", "info", "ok"];
const SECRET_RE = /\b(password|passwd|secret|token|api[-_]?key|cookie|session|bearer)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

function countRows(table: string, where = "1=1"): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number };
  return Number(row?.n ?? 0);
}

function cleanSnippet(value: unknown, max = 180): string {
  const text = String(value ?? "")
    .replace(SECRET_RE, "$1=[redacted]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

function check(
  id: string,
  label: string,
  severity: SystemReadinessSeverity,
  summary: string,
  nextAction?: string,
  details?: Record<string, unknown>,
  repairActions?: SystemReadinessRepairAction[],
): SystemReadinessCheck {
  return { id, label, severity, summary, ...(nextAction ? { nextAction } : {}), ...(repairActions?.length ? { repairActions } : {}), ...(details ? { details } : {}) };
}

const REPAIR_COPY: Record<SystemReadinessRepairActionId, SystemReadinessRepairAction> = {
  seed_coo_rules: {
    id: "seed_coo_rules",
    label: "Seed COO rules",
    description: "Install the canonical default COO routing rules without overwriting operator edits.",
  },
};

function cooRoutingCheck(): SystemReadinessCheck {
  const total = countRows("coo_routing_rules");
  const enabled = countRows("coo_routing_rules", "enabled = 1");
  if (total === 0) {
    return check(
      "coo-routing-rules",
      "COO routing rules",
      "warn",
      "No COO routing rules are stored, so routing depends on hardcoded/default paths only.",
      "Seed or review COO routing rules in Settings -> Lanes before relying on autonomous routing.",
      { total, enabled },
      [REPAIR_COPY.seed_coo_rules],
    );
  }
  return check("coo-routing-rules", "COO routing rules", "ok", `${enabled}/${total} COO routing rules enabled.`, undefined, { total, enabled });
}

function browserReadinessCheck(dashboard: MinimalBrowserDashboard): SystemReadinessCheck {
  const totals = dashboard.totals;
  if (!totals.sites) {
    return check(
      "browser-lane-readiness",
      "Browser Lane readiness",
      "warn",
      "No Browser Lane sites are configured.",
      "Add the key business sites and mark or probe readiness before routing authenticated browser work.",
      { sites: 0 },
    );
  }
  if (totals.needsAttention > 0 || totals.stale > 0) {
    const bits = [`${totals.needsAttention} site${totals.needsAttention === 1 ? "" : "s"} need attention`];
    if (totals.stale > 0) bits.push(`${totals.stale} stale`);
    const top = dashboard.sites
      .filter((site) => {
        const readiness = site.readiness as { color?: string; stale?: boolean } | undefined;
        return readiness?.stale || (readiness?.color && readiness.color !== "green");
      })
      .slice(0, 5)
      .map((site) => ({ id: site.id, displayName: site.displayName, readiness: site.readiness }));
    return check(
      "browser-lane-readiness",
      "Browser Lane readiness",
      "warn",
      `Browser Lane has ${bits.join(", ")}.`,
      "Run readiness checks or refresh SSO sessions in Browser Lane.",
      { totals, top },
    );
  }
  return check("browser-lane-readiness", "Browser Lane readiness", "ok", `${totals.sites} Browser Lane site${totals.sites === 1 ? "" : "s"} ready.`, undefined, { totals });
}

function laneAppsCheck(apps: MinimalLaneAppState[]): SystemReadinessCheck {
  if (!apps.length) {
    return check("lane-apps", "Lane apps", "info", "No standalone lane apps are registered in this build.");
  }
  const critical = apps.filter((app) => app.status === "invalid_signature" || app.status === "launch_failed");
  const attention = apps.filter((app) => app.status === "missing" || app.status === "update_available");
  if (critical.length) {
    const attentionSummary = attention.length
      ? `; ${attention.map((a) => `${a.displayName} ${a.status.replace("_", " ")}`).join(", ")}`
      : "";
    return check(
      "lane-apps",
      "Lane apps",
      "critical",
      `Lane app launch/signature issue: ${critical.map((a) => `${a.displayName} ${a.status.replace("_", " ")}`).join(", ")}${attentionSummary}.`,
      "Verify or reinstall the affected lane apps from Settings -> Lanes.",
      { apps: apps.map((a) => ({ id: a.id, displayName: a.displayName, status: a.status, installed: a.installed, expected: a.expected })) },
    );
  }
  if (attention.length) {
    return check(
      "lane-apps",
      "Lane apps",
      "warn",
      `${attention.length} lane app${attention.length === 1 ? "" : "s"} missing or need update.`,
      "Install/update lane apps explicitly from Settings -> Lanes.",
      { apps: apps.map((a) => ({ id: a.id, displayName: a.displayName, status: a.status, installed: a.installed, expected: a.expected })) },
    );
  }
  return check("lane-apps", "Lane apps", "ok", `${apps.length} standalone lane app${apps.length === 1 ? "" : "s"} installed.`, undefined, {
    apps: apps.map((a) => ({ id: a.id, displayName: a.displayName, status: a.status, installed: a.installed, expected: a.expected })),
  });
}

function workflowInboxCheck(inbox: WorkflowInbox): SystemReadinessCheck {
  const c = inbox.counts;
  const attention = c.needs_review + c.changes_requested + c.proposed_actions_blocked + c.failed_or_attention;
  if (attention > 0) {
    return check(
      "workflow-inbox",
      "Workflow inbox",
      "warn",
      `${attention} workflow item${attention === 1 ? "" : "s"} need review, input, or attention.`,
      "Open the Workflow Inbox and clear review/blocked items.",
      { counts: c },
    );
  }
  if (c.proposed_actions_ready > 0 || c.running_or_pending > 0) {
    return check("workflow-inbox", "Workflow inbox", "info", `${c.proposed_actions_ready} actions ready; ${c.running_or_pending} running/pending.`, undefined, { counts: c });
  }
  return check("workflow-inbox", "Workflow inbox", "ok", "Workflow inbox is empty.", undefined, { counts: c });
}

function localModelCheck(health: MinimalLocalModelHealth | null): SystemReadinessCheck {
  if (!health) {
    return check("local-model", "Local model", "info", "No cached local model readiness result yet.", "Run the local model readiness check if local/offline routing quality matters.");
  }
  const ready = health.qwenReady === true || health.ready === true;
  const providerLabel = health.provider === "dwarfstar" ? "Dwarf Star"
    : health.provider === "mlx" ? "Rapid-MLX"
    : health.provider === "vllm" ? "vLLM"
    : health.provider === "lmstudio" ? "LM Studio"
    : health.provider === "ollama" ? "Ollama"
    : health.provider ?? "local";
  const modelLabel = health.provider === "dwarfstar" && /deepseek/i.test(String(health.modelName ?? ""))
    ? `Dwarf Star DeepSeek (${health.modelName})`
    : `${providerLabel} ${health.modelName ?? "model"}`;
  const detail = {
    provider: health.provider,
    endpoint: health.endpoint,
    modelName: health.modelName,
    checkedAt: health.checkedAt,
    decodeRateTokPerSec: health.decodeRateTokPerSec,
    message: cleanSnippet(health.message),
  };
  if (!ready) {
    const next = health.provider === "dwarfstar"
      ? "Start ds4-serve on the configured endpoint and rerun local model readiness before relying on DeepSeek."
      : "Run qwen readiness and fix the local endpoint before relying on local-only mode.";
    return check("local-model", "Local model", "warn", `${modelLabel} is not ready: ${cleanSnippet(health.message) || "readiness failed"}.`, next, detail);
  }
  const rate = typeof health.decodeRateTokPerSec === "number" ? ` at ${health.decodeRateTokPerSec.toFixed(1)} tok/s` : "";
  return check("local-model", "Local model", "ok", `${modelLabel} ready${rate}.`, undefined, detail);
}

function recentFailedTasksCheck(): SystemReadinessCheck {
  const rows = getDb().prepare(`
    SELECT _id, title, source, error, updatedAt
    FROM tasks
    WHERE status = 'failed'
    ORDER BY datetime(updatedAt) DESC, rowid DESC
    LIMIT 8
  `).all() as Array<{ _id: string; title: string; source: string; error: string | null; updatedAt: string }>;
  if (!rows.length) return check("recent-failed-tasks", "Recent failed tasks", "ok", "No failed active tasks.");
  return check(
    "recent-failed-tasks",
    "Recent failed tasks",
    "warn",
    `${rows.length} failed active task${rows.length === 1 ? "" : "s"} need review.`,
    "Open failed tasks and retry/cancel after reading the error.",
    {
      tasks: rows.map((row) => ({
        id: row._id,
        title: cleanSnippet(row.title, 100),
        source: cleanSnippet(row.source, 40),
        error: cleanSnippet(row.error, 140),
        updatedAt: row.updatedAt,
      })),
    },
  );
}

function daemonCheck(deps: Required<Pick<SystemReadinessDeps, "version" | "connectivity">>): SystemReadinessCheck {
  const version = deps.version();
  const connectivity = deps.connectivity();
  return check("daemon", "Daemon", "ok", `HiveMatrix daemon ${version} is running in ${connectivity} mode.`, undefined, { version, connectivity });
}

function countSeverities(checks: SystemReadinessCheck[]): Record<SystemReadinessSeverity, number> {
  const counts = { ok: 0, info: 0, warn: 0, critical: 0 };
  for (const item of checks) counts[item.severity] += 1;
  return counts;
}

function summarize(counts: Record<SystemReadinessSeverity, number>): string {
  if (counts.critical > 0) return `System readiness: ${counts.critical} critical issue(s), ${counts.warn} warning(s).`;
  if (counts.warn > 0) return `System readiness: ${counts.warn} warning(s), ${counts.info} info item(s).`;
  if (counts.info > 0) return `System readiness: green with ${counts.info} info item(s).`;
  return "System readiness: green.";
}

export async function getSystemReadinessReport(deps: SystemReadinessDeps = {}): Promise<SystemReadinessReport> {
  const now = deps.now ?? (() => new Date());
  const version = deps.version ?? (() => getBundledVersion());
  const connectivity = deps.connectivity ?? (() => getConnectivityPolicy().mode);
  const getBrowserDashboard: () => MinimalBrowserDashboard = deps.getBrowserDashboard
    ?? (() => getBrowserLaneReadinessDashboard({ staleAfterHours: getBrowserLaneReadinessConfig().staleAfterHours }) as unknown as MinimalBrowserDashboard);
  const getLaneApps = deps.getLaneApps ?? (() => getAllLaneAppStates());
  const getInbox = deps.getWorkflowInbox ?? (() => getWorkflowInbox({ limit: 50 }));
  const readLocal = deps.readLocalModelHealth ?? (() => readConfigMatchedLocalModelHealth());

  const checks: SystemReadinessCheck[] = [
    daemonCheck({ version, connectivity }),
    localModelCheck(readLocal()),
    cooRoutingCheck(),
    browserReadinessCheck(getBrowserDashboard()),
    laneAppsCheck(await getLaneApps()),
    workflowInboxCheck(getInbox()),
    recentFailedTasksCheck(),
  ];
  checks.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.label.localeCompare(b.label));
  const counts = countSeverities(checks);
  return {
    ok: counts.critical === 0 && counts.warn === 0,
    generatedAt: now().toISOString(),
    summary: summarize(counts),
    counts,
    checks,
  };
}

function isRepairAction(value: unknown): value is SystemReadinessRepairActionId {
  return typeof value === "string" && (SYSTEM_READINESS_REPAIR_ACTIONS as readonly string[]).includes(value);
}

export async function performSystemReadinessRepair(input: { action: unknown }, deps: SystemReadinessDeps = {}): Promise<SystemReadinessRepairResult> {
  if (!isRepairAction(input.action)) {
    throw new Error(`Unsupported system readiness repair action: ${String(input.action ?? "")}`);
  }
  let changed = 0;
  let message = "";
  switch (input.action) {
    case "seed_coo_rules":
      changed = seedDefaultCooRoutingRules("system-readiness-repair");
      message = changed ? `Seeded ${changed} COO routing rule${changed === 1 ? "" : "s"}.` : "COO routing rules were already seeded.";
      break;
  }
  return {
    ok: true,
    action: input.action,
    message,
    changed,
    report: await getSystemReadinessReport(deps),
  };
}
