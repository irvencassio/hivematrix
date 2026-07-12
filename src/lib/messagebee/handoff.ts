/**
 * Message Lane routing — pure decision logic for one inbound message.
 *
 * An allowlisted sender's text either answers a task that's waiting on them
 * (needs_input) or enters a Flash Lane conversational session. Flash handles
 * both quick replies and complex work (via escalate_to_task internally).
 * A non-allowlisted sender is read-only: their message never creates or resolves
 * work (the security gate).
 */

import {
  type InboundMessage,
  parseModelDirective,
} from "./contracts";

export type MessageRoute =
  | { kind: "ignore"; reason: string }
  | { kind: "reply_to_task"; taskId: string; stuckTimestamp: string; text: string }
  | { kind: "flash_turn"; text: string; peer: string; imagePaths: string[] };

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
  const imagePaths = msg.attachments ?? [];
  const hasImages = imagePaths.length > 0;
  // A photo-only message has empty text (imessage.ts already strips the
  // U+FFFC placeholder) but must still route — don't drop it as "empty".
  if (!text && !hasImages) return { kind: "ignore", reason: "empty message" };

  // Security gate: only allowlisted senders can drive the system.
  if (!ctx.allowlisted) {
    return { kind: "ignore", reason: `sender ${msg.handle} not on allowlist (read-only)` };
  }

  // If the sender owes an answer to a waiting task, their text resolves it.
  // (Images aren't routed into a needs_input reply — only the text matters there.)
  if (ctx.pendingInput.length > 0 && text) {
    const latest = [...ctx.pendingInput].sort((a, b) => b.stuckTimestamp.localeCompare(a.stuckTimestamp))[0];
    return { kind: "reply_to_task", taskId: latest.taskId, stuckTimestamp: latest.stuckTimestamp, text };
  }

  // Route to Flash Lane — strip any /model directive (Flash uses its own routing).
  const { cleanedText } = parseModelDirective(text);
  const flashText = cleanedText || text || (hasImages ? "[Photo attached — no caption]" : "");
  return { kind: "flash_turn", text: flashText, peer: msg.handle, imagePaths };
}
