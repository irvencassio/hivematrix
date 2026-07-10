import { appendAttachmentBlock, type TaskAttachmentInput } from "./attachments";

function appendContinuationBlock(description: string, header: string, body: string): string {
  return [description.trimEnd(), "", header, body].join("\n");
}

export function appendReplyContinuation(
  description: string,
  reply: string,
  attachments: TaskAttachmentInput[] = [],
): string {
  return appendContinuationBlock(description, "--- Operator reply (continue) ---", appendAttachmentBlock(reply.trim(), attachments));
}

/**
 * Reuses the same append-and-resume mechanism as a human reply, but with an
 * honest header — this content comes from a coordinator's delegated
 * subtasks, not the operator, and labeling it "Operator reply" would
 * mislead the model reading it.
 */
export function appendChildrenResultsContinuation(description: string, resultsBlock: string): string {
  return appendContinuationBlock(description, "--- Delegated subtask results (continue) ---", resultsBlock.trim());
}
