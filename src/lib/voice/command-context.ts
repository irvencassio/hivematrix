import type { CommandIntent } from "./command-intent";

export type ContextApprovalKind = "checkpoint" | "content" | "tool" | "stuck";

export interface ContextApproval {
  kind: ContextApprovalKind;
  taskId: string;
  timestamp: string;
  title: string;
}

export interface ApprovalPointer {
  taskId: string;
  timestamp: string;
}

export interface CommandContextTurn {
  kind: string;
  text: string;
}

export interface CommandContext {
  turns: CommandContextTurn[];
  approvals: ContextApproval[];
  focusedApproval: ApprovalPointer | null;
  lastTaskId: string | null;
}

export type ApprovalResolution =
  | { status: "resolved"; item: ContextApproval }
  | { status: "ambiguous"; choices: ContextApproval[] }
  | { status: "none" };

const MAX_TURNS = 5;
const MAX_APPROVALS = 5;

export function emptyCommandContext(): CommandContext {
  return {
    turns: [],
    approvals: [],
    focusedApproval: null,
    lastTaskId: null,
  };
}

function pointerFor(item: ContextApproval): ApprovalPointer {
  return { taskId: item.taskId, timestamp: item.timestamp };
}

function sameApproval(a: ApprovalPointer, b: ApprovalPointer): boolean {
  return a.taskId === b.taskId && a.timestamp === b.timestamp;
}

export function rememberTurn(context: CommandContext, turn: CommandContextTurn): CommandContext {
  return {
    ...context,
    turns: [...context.turns, turn].slice(-MAX_TURNS),
  };
}

export function rememberApprovalList(context: CommandContext, approvals: ContextApproval[]): CommandContext {
  const shortList = approvals.slice(0, MAX_APPROVALS);
  return {
    ...context,
    approvals: shortList,
    focusedApproval: shortList.length > 0 ? pointerFor(shortList[0]) : null,
  };
}

export function rememberLastTask(context: CommandContext, taskId: string | null): CommandContext {
  return { ...context, lastTaskId: taskId };
}

function findFocusedApproval(context: CommandContext, candidates: ContextApproval[]): ContextApproval | null {
  if (!context.focusedApproval) return null;
  return candidates.find((item) => sameApproval(pointerFor(item), context.focusedApproval!)) ?? null;
}

const KNOWN_KINDS: ContextApprovalKind[] = ["checkpoint", "content", "tool", "stuck"];

/** Lowercase, punctuation-folded word list — "mail_send: draft to Bob" ->
 * ["mail","send","draft","to","bob"] — so a spoken phrase can match a title
 * regardless of underscores/colons/word order. */
function normalizeWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
}

/** Match a spoken description ("the mail draft", "the checkpoint") against
 * pending approvals by kind keyword or by every word of the description
 * appearing in the title. Union of both, deduped — used to decide "resolved"
 * (exactly one match) vs "ambiguous" (more than one) before falling back to
 * focus/single-candidate. */
function matchByText(matchText: string, candidates: ContextApproval[]): ContextApproval[] {
  const needleWords = normalizeWords(matchText);
  if (needleWords.length === 0) return [];

  const byTitle = candidates.filter((item) => {
    const titleWords = new Set(normalizeWords(item.title));
    return needleWords.every((w) => titleWords.has(w));
  });

  const kindWord = KNOWN_KINDS.find((k) => needleWords.includes(k));
  const byKind = kindWord ? candidates.filter((item) => item.kind === kindWord) : [];

  const seen = new Set<string>();
  const merged: ContextApproval[] = [];
  for (const item of [...byTitle, ...byKind]) {
    const key = `${item.taskId}:${item.timestamp}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

export function resolveApprovalReference(
  intent: Pick<CommandIntent, "kind" | "ordinal" | "matchText">,
  context: CommandContext,
  liveApprovals: ContextApproval[] = context.approvals,
): ApprovalResolution {
  if (intent.kind !== "approve" && intent.kind !== "deny") return { status: "none" };

  const candidates = liveApprovals.filter((item) => item.kind !== "stuck");
  if (candidates.length === 0) return { status: "none" };

  if (intent.ordinal !== undefined) {
    const item = candidates[intent.ordinal - 1];
    return item ? { status: "resolved", item } : { status: "none" };
  }

  const matchText = intent.matchText?.trim();
  if (matchText) {
    const matches = matchByText(matchText, candidates);
    if (matches.length === 1) return { status: "resolved", item: matches[0] };
    if (matches.length > 1) return { status: "ambiguous", choices: matches };
    // Zero matches: the descriptive text didn't line up with anything —
    // fall through to focus/single-candidate/full-ambiguous below rather
    // than failing outright, since a vague or slightly-off phrase ("approve
    // that thing") is common and there may still be an obvious target.
  }

  const focused = findFocusedApproval(context, candidates);
  if (focused) return { status: "resolved", item: focused };
  if (candidates.length === 1) return { status: "resolved", item: candidates[0] };
  return { status: "ambiguous", choices: candidates };
}

export class RollingCommandContextStore {
  private readonly contexts = new Map<string, CommandContext>();

  constructor(private readonly maxSessions = 8) {}

  get(sessionId = "default"): CommandContext {
    return this.contexts.get(sessionId) ?? emptyCommandContext();
  }

  set(sessionId: string, context: CommandContext): CommandContext {
    if (!this.contexts.has(sessionId) && this.contexts.size >= this.maxSessions) {
      const oldest = this.contexts.keys().next().value;
      if (oldest) this.contexts.delete(oldest);
    }
    this.contexts.set(sessionId, context);
    return context;
  }

  update(sessionId: string, update: (context: CommandContext) => CommandContext): CommandContext {
    return this.set(sessionId, update(this.get(sessionId)));
  }

  clear(sessionId = "default"): void {
    this.contexts.delete(sessionId);
  }
}
