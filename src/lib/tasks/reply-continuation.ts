import { appendAttachmentBlock, type TaskAttachmentInput } from "./attachments";

export function appendReplyContinuation(
  description: string,
  reply: string,
  attachments: TaskAttachmentInput[] = [],
): string {
  return [
    description.trimEnd(),
    "",
    "--- Operator reply (continue) ---",
    appendAttachmentBlock(reply.trim(), attachments),
  ].join("\n");
}

/**
 * Append a Flight coordinator's parent-derived answer to a child task description
 * and requeue it — used when the coordinator auto-resolves a needs_parent_decision
 * blocker from the parent context without involving the operator.
 */
export function appendCoordinatorAnswer(description: string, answer: string): string {
  return [
    description.trimEnd(),
    "",
    "--- Flight coordinator answer (continue) ---",
    answer.trim(),
  ].join("\n");
}
