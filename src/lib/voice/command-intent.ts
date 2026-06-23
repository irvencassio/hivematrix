/**
 * Voice command intent — the "Jarvis" layer for push-to-talk. Turns a spoken
 * utterance into a structured command over the daemon's real capabilities (board,
 * approvals, directives, tasks, connectivity) so voice can DRIVE the system, not
 * just chat. Pure + deterministic (no LLM round-trip), fully unit-tested; the IO
 * glue that reads state / performs actions / synthesizes the spoken reply lives in
 * command-turn.ts. Mirrors the skill-intent.ts pattern.
 *
 * Detection runs BEFORE the LLM reply; an unmatched utterance returns {kind:"none"}
 * and falls through to the conversational answer.
 */

export type ConnMode = "cloud-ok" | "local-only" | "offline" | "auto";

export type CommandKind =
  | "board"            // "what's on my board" — counts by lane
  | "approvalsList"    // "anything to approve" — pending queue summary
  | "approve"          // "approve it / approve the first one" — resolve latest
  | "deny"             // "deny that / reject it"
  | "directives"       // "what are my directives"
  | "createTask"       // "create a task to <X>" / "remind me to <X>"
  | "connectivity"     // "are we online / connectivity status"
  | "setConnectivity"  // "go offline / cloud only / go local / auto"
  | "none";

export interface CommandIntent {
  kind: CommandKind;
  taskText?: string;   // createTask
  mode?: ConnMode;     // setConnectivity
}

const clean = (s: string) => s.replace(/[.?!,\s]+$/g, "").trim();

/** Detect a system command in a spoken utterance. Pure; order = specific first. */
export function detectCommandIntent(text: string): CommandIntent {
  const t = (text || "").toLowerCase().trim();
  if (!t) return { kind: "none" };

  // --- Connectivity SET (verbs) — before the query form ---
  if (/\b(go|switch to|set)\b.*\boffline\b/.test(t) || /^offline$/.test(t)) return { kind: "setConnectivity", mode: "offline" };
  if (/\b(go|switch to|set)\b.*\b(local[\s-]?only|local)\b/.test(t)) return { kind: "setConnectivity", mode: "local-only" };
  if (/\b(go|switch to|set|back)\b.*\b(online|cloud([\s-]?ok)?)\b/.test(t) || /\bcloud[\s-]?ok\b/.test(t)) return { kind: "setConnectivity", mode: "cloud-ok" };
  if (/\b(automatic|auto)\b.*\bconnectivity\b/.test(t) || /\bconnectivity\b.*\bauto(matic)?\b/.test(t)) return { kind: "setConnectivity", mode: "auto" };

  // --- Connectivity QUERY ---
  if (/\b(connectivity|are we online|am i online|are we connected|connection status|what mode)\b/.test(t)) return { kind: "connectivity" };

  // --- Create task / reminder (verb forms). Match case-insensitively but extract
  // the task text from the ORIGINAL string so the title keeps its capitalization.
  const orig = (text || "").trim();
  const taskMatch = orig.match(/\b(?:create|add|make|new|start|open|queue)\s+(?:a\s+|an\s+|another\s+)?task\b(?:\s+(?:to|that|for|about|:|-))?\s*(.+)$/i);
  if (taskMatch && clean(taskMatch[1])) return { kind: "createTask", taskText: clean(taskMatch[1]) };
  const remind = orig.match(/\b(?:remind me to|remember to|have the team|get someone to|make sure to)\s+(.+)$/i);
  if (remind && clean(remind[1])) return { kind: "createTask", taskText: clean(remind[1]) };

  // --- Approvals: query BEFORE the approve/deny verbs ---
  if (/\b(any|pending|outstanding|waiting)\s+approvals?\b/.test(t)
      || /\bwhat('?s| is|s)?\b[^.?!]*\bapprov/.test(t)
      || /\banything\s+(?:to\s+approve|waiting\s+for\s+(?:my\s+)?approval)\b/.test(t)
      || /\bneed\w*\s+(?:my\s+)?approv/.test(t)
      || /^approvals?\??$/.test(t)) {
    return { kind: "approvalsList" };
  }
  if (/\b(deny|reject|decline|disapprove)\b/.test(t)) return { kind: "deny" };
  if (/\bapprove\b/.test(t)) return { kind: "approve" };

  // --- Directives / standing goals ---
  if (/\b(directives?|standing goals?|what.*standing|what are you watching)\b/.test(t)) return { kind: "directives" };

  // --- Board / task status ---
  if (/\b(board|task status|how many tasks|what('?s| is) (queued|in progress|pending)|what are you working on|what('?s| is) running|status report)\b/.test(t)) {
    return { kind: "board" };
  }

  return { kind: "none" };
}

// --- Spoken-reply builders (pure; given already-fetched data) -----------------

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? `${n} ${one}` : `${n} ${many}`);

export function boardReply(counts: Record<string, number>): string {
  const queued = (counts.backlog || 0);
  const inProgress = (counts.assigned || 0) + (counts.in_progress || 0);
  const review = (counts.review || 0);
  const done = (counts.done || 0);
  const failed = (counts.failed || 0);
  const total = queued + inProgress + review;
  if (total === 0 && done === 0 && failed === 0) return "Your board is empty — nothing queued or running.";
  const parts: string[] = [];
  if (queued) parts.push(plural(queued, "queued", "queued"));
  if (inProgress) parts.push(`${inProgress} in progress`);
  if (review) parts.push(`${review} in review`);
  if (failed) parts.push(plural(failed, "failed", "failed"));
  const head = parts.length ? parts.join(", ") : "nothing active";
  return `On the board: ${head}. ${done} done.`;
}

export interface SpokenApproval { title: string; kind: string }
export function approvalsReply(items: SpokenApproval[]): string {
  if (!items.length) return "Nothing is waiting for your approval.";
  const first = items[0];
  if (items.length === 1) return `One approval waiting: ${first.title}. Say "approve it" or "deny it".`;
  return `${items.length} approvals waiting. First up: ${first.title}. Say "approve it" or "deny it".`;
}

export function resolvedReply(decision: "approve" | "deny", title: string | null): string {
  const verb = decision === "approve" ? "Approved" : "Denied";
  return title ? `${verb}: ${title}.` : `${verb} the latest request.`;
}
export function noApprovalToResolveReply(): string {
  return "There's nothing waiting for approval right now.";
}

export interface SpokenDirective { goal: string; status: string }
export function directivesReply(rows: SpokenDirective[]): string {
  const active = rows.filter((r) => r.status === "active");
  if (!rows.length) return "You have no standing directives.";
  if (!active.length) return `No active directives (${rows.length} total, none running).`;
  const names = active.slice(0, 3).map((r) => r.goal).join("; ");
  const more = active.length > 3 ? `, and ${active.length - 3} more` : "";
  return `${plural(active.length, "active directive")}: ${names}${more}.`;
}

export function createdTaskReply(title: string): string {
  return `Done — I queued a task: ${title}.`;
}

export function connectivityReply(mode: string): string {
  switch (mode) {
    case "cloud-ok": return "We're online — cloud models are available.";
    case "local-only": return "Running local-only — on-device models, no cloud.";
    case "offline": return "We're offline — no network calls.";
    default: return `Connectivity mode is ${mode}.`;
  }
}
export function setConnectivityReply(mode: ConnMode): string {
  if (mode === "auto") return "Connectivity set to automatic.";
  return "Set. " + connectivityReply(mode);
}
