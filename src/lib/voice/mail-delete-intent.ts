import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";

export interface VoiceMailDeleteIntent {
  query: string;
  destructive: true;
}

const clean = (s: string) => s.replace(/[.?!,\s]+$/g, "").trim();

function normalizeDeleteQuery(raw: string): string {
  return clean(raw
    .replace(/^(?:the\s+)?(?:mail|email|message|messages)\s+/i, "")
    .replace(/^the\s+/i, ""));
}

/**
 * Detect explicit spoken requests to delete/trash email.
 *
 * This intentionally returns a review intent, not an execution command. Spoken
 * text is too fuzzy for destructive mailbox changes without candidate review.
 */
export function detectVoiceMailDeleteIntent(text: string): VoiceMailDeleteIntent | null {
  const orig = (text || "").trim();
  const t = orig.toLowerCase();
  if (!/\b(mail|email|emails|message|messages)\b/.test(t)) return null;

  const match = orig.match(/\b(?:delete|trash|remove)\s+(.+)$/i);
  if (!match) return null;

  const query = normalizeDeleteQuery(match[1] ?? "");
  if (!query) return null;

  return { query, destructive: true };
}

export function buildVoiceMailDeleteTask(intent: VoiceMailDeleteIntent): Record<string, unknown> {
  const titleQuery = intent.query.length > 48 ? `${intent.query.slice(0, 45).trimEnd()}...` : intent.query;
  return {
    title: `Delete email review: ${titleQuery}`,
    description: [
      `Mail Lane deletion request from voice: ${intent.query}`,
      "",
      "Do not delete anything yet.",
      "Find the candidate Apple Mail message(s), show the sender, subject, received date, and message id for review, then wait for explicit confirmation before moving anything to Trash.",
      "Never bulk-delete from a fuzzy spoken phrase. If there is more than one plausible match, ask the operator to choose.",
    ].join("\n"),
    project: DEFAULT_TASK_PROJECT,
    projectPath: process.env.HOME ?? "",
    status: "review",
    executor: "agent",
    source: "mail-lane",
    output: {
      mailDeleteVoiceRequest: {
        query: intent.query,
        destructive: true,
        source: "voice",
      },
    },
  };
}
