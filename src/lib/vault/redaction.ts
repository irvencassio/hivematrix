export const TRACE_REDACTION_MASK = "[redacted]";

const SECRET_KEY_HINT = /\b(password|passphrase|secret|token|cookie|totp|api[_-]?key|apikey|access[_-]?key|authorization|private[_-]?key|session|credential|bearer)\b/i;

function dedupeAndOrder(raw: readonly string[]): string[] {
  return Array.from(
    new Set(raw.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((value) => value.length >= 4)),
  ).sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace literal secret values inside a string with a redaction mask. */
export function scrubSecretsText(input: string, secrets: readonly string[]): string {
  if (!input) return input;
  let out = input;
  for (const secret of dedupeAndOrder(secrets)) {
    out = out.replace(new RegExp(escapeRegExp(secret), "g"), TRACE_REDACTION_MASK);
  }
  return out;
}

/** Recursively redact literal secret values from trace-like objects, including secret-key fields. */
export function scrubSecrets(value: unknown, secrets: readonly string[]): unknown {
  if (value == null) return value;
  if (typeof value === "string") return scrubSecretsText(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => scrubSecrets(entry, secrets));
  if (typeof value !== "object") return value;

  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    next[key] = SECRET_KEY_HINT.test(key)
      ? TRACE_REDACTION_MASK
      : scrubSecrets(child, secrets);
  }
  return next;
}
