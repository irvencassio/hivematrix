/**
 * MessageBee contracts — pure types + helpers for the SMS/iMessage channel lane
 * (Q8). No zod (HiveMatrix uses hand-rolled validation); all functions here are
 * side-effect-free and unit-tested.
 */

/** A message read from the Messages chat.db. */
export interface InboundMessage {
  /** chat.db message.ROWID — the monotonic high-water key. */
  rowid: number;
  /** Raw sender identity (phone number or email handle). */
  handle: string;
  /** Plain message text. */
  text: string;
  /** ISO timestamp the message was received. */
  receivedAt: string;
  /** "iMessage" | "SMS" (best-effort from chat.db). */
  service: string;
}

/**
 * Normalize an identity for allowlist comparison: emails lowercased; phone
 * numbers reduced to digits (keeping a leading +). Mirrors Hive 1's proven
 * normalization so paired handles match regardless of formatting.
 */
export function normalizeHandle(identity: string): string {
  const trimmed = (identity ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  return trimmed.replace(/[^\d+]/g, "");
}

/** Whether two identities refer to the same person (email exact; phone last-10). */
export function handlesMatch(left: string, right: string): boolean {
  const a = normalizeHandle(left);
  const b = normalizeHandle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes("@") || b.includes("@")) return false;
  const ad = a.replace(/\D/g, "");
  const bd = b.replace(/\D/g, "");
  return ad.length >= 10 && bd.length >= 10 && ad.slice(-10) === bd.slice(-10);
}

// A sender can steer the model with `/model opus`, `#model sonnet`, etc.
const MODEL_DIRECTIVE_REGEX =
  /(?:^|[\s(])(?:\/model|#model|@model|model(?=\s*[:=]))(?:\s*[:=]\s*|\s+)([a-z0-9:._-]+)\b/i;

/** Extract a leading/inline `/model X` directive; return it + the text minus the directive. */
export function parseModelDirective(text: string): { model: string | null; cleanedText: string } {
  const m = text.match(MODEL_DIRECTIVE_REGEX);
  if (!m) return { model: null, cleanedText: text.trim() };
  const model = m[1].toLowerCase();
  const cleanedText = text.replace(MODEL_DIRECTIVE_REGEX, " ").replace(/\s{2,}/g, " ").trim();
  return { model, cleanedText };
}

/** Title for a task created from a text (first line, clamped). */
export function deriveMessageTaskTitle(text: string): string {
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "Message";
  const clamped = firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
  return `SMS: ${clamped}`;
}
