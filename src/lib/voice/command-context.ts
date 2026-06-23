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

export function resolveApprovalReference(
  intent: Pick<CommandIntent, "kind" | "ordinal">,
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
