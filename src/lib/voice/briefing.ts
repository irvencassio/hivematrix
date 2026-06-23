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

export interface VoiceBriefingInput {
  approvals?: BriefingApproval[];
  failedTasks?: BriefingTask[];
  directives?: BriefingDirective[];
  usage?: BriefingUsage | null;
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

  parts.push(usageReply(input.usage));
  return parts.join(" ");
}
