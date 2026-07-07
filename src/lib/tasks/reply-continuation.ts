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
