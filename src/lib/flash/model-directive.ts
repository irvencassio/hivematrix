/**
 * Per-conversation model override, set from chat.
 *
 * Model selection collapsed to a single default (routing/model-resolver.ts), so
 * the escape hatch has to live where the operator actually is: in the thread.
 * "/model opus" pins this conversation; "/model default" releases it.
 *
 * Deliberately an EXPLICIT directive, not natural-language detection. A turn
 * that merely mentions a model — "why did that run on sonnet?" — must not
 * silently repoint the conversation. Directives are recognised only at the very
 * start of a message, and only as their own line.
 */

/** Model names accepted from chat. Aliases the CLI understands, not full ids —
 *  a full id like "claude-opus-4-8" also passes through untouched. */
const KNOWN_ALIASES = new Set(["opus", "sonnet", "haiku"]);

/** Words that clear the override and return the thread to the default. */
const CLEAR_WORDS = new Set(["default", "reset", "clear", "auto", "none"]);

export interface ModelDirective {
  /** The model to pin, "" to clear it, or null when the text is not a directive. */
  model: string | null;
  /** The message with the directive line removed — "" when it was the whole message. */
  text: string;
  /** Operator-facing confirmation, or an error when the name was not recognised. */
  notice: string | null;
}

const NOT_A_DIRECTIVE: ModelDirective = { model: null, text: "", notice: null };

/**
 * Parse a leading "/model <name>" directive.
 * Returns model:null when `raw` is an ordinary message, so callers can pass
 * every turn through this without branching first.
 */
export function parseModelDirective(raw: string): ModelDirective {
  const text = (raw ?? "").trim();
  if (!text.toLowerCase().startsWith("/model")) return { ...NOT_A_DIRECTIVE, text };

  // Only the first LINE is the directive; anything after it is the real message.
  const nl = text.indexOf("\n");
  const line = (nl === -1 ? text : text.slice(0, nl)).trim();
  const rest = nl === -1 ? "" : text.slice(nl + 1).trim();

  const arg = line.slice("/model".length).trim();
  if (!arg) {
    return { model: null, text: rest, notice: "Usage: /model opus | sonnet | haiku | default" };
  }

  const name = arg.toLowerCase();
  if (CLEAR_WORDS.has(name)) {
    return { model: "", text: rest, notice: "Model override cleared — this conversation follows the default again." };
  }

  // Accept the short aliases, or any full provider id (claude-*, codex:*).
  const looksLikeId = /^(claude-|codex:|gpt-)/i.test(arg);
  if (!KNOWN_ALIASES.has(name) && !looksLikeId) {
    return { model: null, text: rest, notice: `Unknown model "${arg}". Try: opus, sonnet, haiku, or default.` };
  }

  const model = looksLikeId ? arg : name;
  return { model, text: rest, notice: `This conversation now runs on ${model}.` };
}

/** True when a stored override should be used instead of the surface default. */
export function effectiveModelOverride(sessionOverride: string | null | undefined): string | null {
  const v = (sessionOverride ?? "").trim();
  return v ? v : null;
}
