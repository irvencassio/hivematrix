/**
 * Message Lane routing — pure decision logic for one inbound message.
 *
 * An allowlisted sender's text either answers a task that's waiting on them
 * (needs_input) or starts a new task. A non-allowlisted sender is read-only:
 * their message never creates or resolves work (the security gate).
 */

import {
  type InboundMessage,
  parseModelDirective,
  deriveMessageTaskTitle,
} from "./contracts";

export type MessageRoute =
  | { kind: "ignore"; reason: string }
  | { kind: "reply_to_task"; taskId: string; stuckTimestamp: string; text: string }
  | { kind: "new_task"; title: string; description: string; model: string | null };

export interface PendingInput {
  taskId: string;
  /** The stuck request timestamp to resolve. */
  stuckTimestamp: string;
}

export interface RouteContext {
  /** Is the sender on the allowlist (paired/allowed identity)? */
  allowlisted: boolean;
  /** Tasks from this sender currently awaiting their input. */
  pendingInput: PendingInput[];
}

export function routeInbound(msg: InboundMessage, ctx: RouteContext): MessageRoute {
  const text = (msg.text ?? "").trim();
  if (!text) return { kind: "ignore", reason: "empty message" };

  // Security gate: only allowlisted senders can drive the system.
  if (!ctx.allowlisted) {
    return { kind: "ignore", reason: `sender ${msg.handle} not on allowlist (read-only)` };
  }

  // If the sender owes an answer to a waiting task, their text resolves it.
  if (ctx.pendingInput.length > 0) {
    const latest = [...ctx.pendingInput].sort((a, b) => b.stuckTimestamp.localeCompare(a.stuckTimestamp))[0];
    return { kind: "reply_to_task", taskId: latest.taskId, stuckTimestamp: latest.stuckTimestamp, text };
  }

  // Otherwise start a new task; honor an inline `/model` directive.
  const { model, cleanedText } = parseModelDirective(text);
  const body = cleanedText || text;
  return {
    kind: "new_task",
    title: deriveMessageTaskTitle(body),
    description: body,
    model,
  };
}
