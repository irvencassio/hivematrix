export interface BriefingApproval {
  title: string;
  kind: string;
}

export interface BriefingTask {
  title: string;
}

export interface BriefingDirective {
  goal: string;
  status: string;
}

export interface BriefingUsage {
  totalCost?: number;
  todayCost?: number;
  taskCount?: number;
  todayTaskCount?: number;
  subscriptionPercentRemaining?: number | null;
}

export interface BriefingBrowserSite {
  name: string;
  color: string;
  status: string;
  siteId: string;
  traceRunId: string | null;
}

export interface BriefingBrowserReadiness {
  needsAttention: number;
  byColor: { green: number; yellow: number; orange: number; red: number; gray: number };
  topSites: BriefingBrowserSite[];
  staleCount?: number;
  lastSweepAt?: string | null;
}

export interface BriefingWorkflowInbox {
  needsReview: number;
  ready: number;
  blocked: number;
  attention: number;
}

export interface VoiceBriefingInput {
  approvals?: BriefingApproval[];
  failedTasks?: BriefingTask[];
  directives?: BriefingDirective[];
  usage?: BriefingUsage | null;
  browserReadiness?: BriefingBrowserReadiness | null;
  workflowInbox?: BriefingWorkflowInbox | null;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? `${n} ${one}` : `${n} ${many}`);

function listHead(items: string[], max = 2): string {
  const visible = items.slice(0, max).join("; ");
  const more = items.length > max ? `, and ${items.length - max} more` : "";
  return `${visible}${more}`;
}

function money(value: number | undefined): string {
  return `$${(value ?? 0).toFixed(2)}`;
}

export function usageReply(usage: BriefingUsage | null | undefined): string {
  if (!usage) return "Usage is unavailable.";
  const parts = [
    `${money(usage.totalCost)} total`,
    `${money(usage.todayCost)} today`,
    plural(usage.taskCount ?? 0, "frontier task"),
  ];
  if (typeof usage.todayTaskCount === "number") parts.push(`${usage.todayTaskCount} today`);
  if (typeof usage.subscriptionPercentRemaining === "number") {
    parts.push(`${Math.round(usage.subscriptionPercentRemaining)}% subscription remaining`);
  }
  return `Usage: ${parts.join(", ")}.`;
}

export function buildVoiceBriefing(input: VoiceBriefingInput): string {
  const approvals = input.approvals ?? [];
  const failedTasks = input.failedTasks ?? [];
  const activeDirectives = (input.directives ?? []).filter((directive) => directive.status === "active");

  const parts: string[] = [];
  if (approvals.length > 0) {
    parts.push(`${plural(approvals.length, "approval")} pending: ${listHead(approvals.map((item) => item.title))}.`);
  } else {
    parts.push("No pending approvals.");
  }

  if (failedTasks.length > 0) {
    parts.push(`${plural(failedTasks.length, "failed task")}: ${listHead(failedTasks.map((task) => task.title))}.`);
  } else {
    parts.push("No failed tasks.");
  }

  if (activeDirectives.length > 0) {
    parts.push(`${plural(activeDirectives.length, "active directive")}: ${listHead(activeDirectives.map((directive) => directive.goal))}.`);
  } else {
    parts.push("No active directives.");
  }

  const inboxLine = workflowInboxReply(input.workflowInbox);
  if (inboxLine) parts.push(inboxLine);

  const browserLine = browserReadinessReply(input.browserReadiness);
  if (browserLine) parts.push(browserLine);

  parts.push(usageReply(input.usage));
  return parts.join(" ");
}

/**
 * Compact Workflow Inbox line: reviews needing attention, ready-to-execute actions,
 * and a blocked/failed count. Counts only — no artifact previews, no secrets. Returns
 * "" when the inbox is empty (so the briefing stays short).
 */
export function workflowInboxReply(inbox: BriefingWorkflowInbox | null | undefined): string {
  if (!inbox) return "";
  const total = inbox.needsReview + inbox.ready + inbox.blocked + inbox.attention;
  if (total === 0) return "";
  const parts = [
    `${plural(inbox.needsReview, "review")} pending`,
    `${plural(inbox.ready, "action")} ready`,
    `${inbox.blocked + inbox.attention} blocked or failed`,
  ];
  return `Workflow inbox: ${parts.join(", ")}.`;
}

/**
 * Compact Browser Lane readiness line. Reports how many sites need attention
 * (red + orange + gray/unknown) and names the top few with their status + a
 * siteId/traceRunId for troubleshooting. Metadata only — no secrets. Returns ""
 * when no readiness data was gathered (so existing briefings are unchanged).
 */
export function browserReadinessReply(readiness: BriefingBrowserReadiness | null | undefined): string {
  if (!readiness) return "";
  const staleCount = readiness.staleCount ?? 0;
  let line: string;
  if (readiness.needsAttention > 0) {
    const head = readiness.topSites.slice(0, 2).map((site) => {
      const trace = site.traceRunId ? ` [${site.traceRunId}]` : ` [${site.siteId}]`;
      return `${site.name} (${site.status})${trace}`;
    });
    const more = readiness.topSites.length > 2 ? `, and ${readiness.topSites.length - 2} more` : "";
    line = `Browser Lane: ${plural(readiness.needsAttention, "site")} need attention: ${head.join("; ")}${more}`;
  } else if (staleCount > 0) {
    line = `Browser Lane: ${plural(staleCount, "site")} have stale readiness — run a readiness check`;
  } else {
    line = "Browser Lane: all sites ready";
  }
  // Freshness: when the daily sweep last refreshed readiness (UTC, minute-level).
  if (readiness.lastSweepAt) {
    const when = new Date(readiness.lastSweepAt);
    const stamp = Number.isNaN(when.getTime()) ? readiness.lastSweepAt : `${when.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    line += ` (readiness last refreshed ${stamp})`;
  }
  return `${line}.`;
}
