export function appendReplyContinuation(description: string, reply: string): string {
  return [
    description.trimEnd(),
    "",
    "--- Operator reply (continue) ---",
    reply.trim(),
  ].join("\n");
}
