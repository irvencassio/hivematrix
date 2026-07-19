/**
 * Marking a task's outstanding questions as answered.
 *
 * `deriveOutput` (orchestrator/derive-output.ts) decides a task is awaiting the
 * operator by walking the WHOLE accumulated turn log and collecting every
 * question turn whose `content.answeredBy` is unset. `answeredBy` was declared
 * in turn-types.ts and read in four places — but nothing ever wrote it. The
 * consequence: once a task asked a question, every later run of that task
 * re-derived `needs_input` and re-surfaced the ORIGINAL question as the
 * headline, no matter how much work had happened since. The operator saw a
 * finished task begging for a reply it had already been given.
 *
 * The reply/retry endpoints are the write site: an operator reply is precisely
 * the event that answers whatever was outstanding. Turns are append-only (the
 * task log is evidence, and it is what `deriveOutput` reads), so this stamps the
 * existing turns rather than dropping them — clearing `turns` would fix the
 * banner by destroying the transcript.
 *
 * The predicate here MUST match derive-output.ts:57-79. If that file changes
 * which turns count as questions, change this one with it, or a question shape
 * it recognises will become unanswerable again.
 */

/** Confidence floor for treating a `contains_question` signal as a real ask. */
const QUESTION_CONFIDENCE = 0.7;

interface TurnLike {
  kind?: unknown;
  content?: unknown;
  signals?: unknown;
}

/** True for the two turn shapes derive-output.ts counts as an open question. */
function isQuestionTurn(turn: TurnLike): boolean {
  const content = turn?.content as { type?: unknown } | undefined;
  if (!content || typeof content !== "object") return false;

  if (turn.kind === "ask_user_question" && content.type === "question") return true;

  if (turn.kind === "assistant_message" && content.type === "text") {
    const signals = Array.isArray(turn.signals) ? turn.signals : [];
    return signals.some((s) => {
      const sig = s as { kind?: unknown; confidence?: unknown };
      return sig?.kind === "contains_question"
        && (typeof sig.confidence === "number" ? sig.confidence : 0) >= QUESTION_CONFIDENCE;
    });
  }

  return false;
}

/**
 * Returns a copy of `turns` with every not-yet-answered question turn stamped
 * `content.answeredBy = answeredBy`. Already-answered turns are left exactly as
 * they are, so replying twice never rewrites the first answer's attribution.
 *
 * Never throws and never mutates the input: a malformed turn log must not be
 * able to break the reply path, which is the operator's only way to unstick a
 * task.
 */
export function markQuestionsAnswered(turns: unknown, answeredBy: string): unknown[] {
  if (!Array.isArray(turns)) return [];
  return turns.map((turn) => {
    const t = turn as TurnLike;
    if (!t || typeof t !== "object") return turn;
    if (!isQuestionTurn(t)) return turn;
    const content = t.content as Record<string, unknown>;
    if (content.answeredBy) return turn;
    return { ...t, content: { ...content, answeredBy } };
  });
}

/** True if any turn is an outstanding, unanswered question. */
export function hasUnansweredQuestion(turns: unknown): boolean {
  if (!Array.isArray(turns)) return false;
  return turns.some((turn) => {
    const t = turn as TurnLike;
    if (!t || typeof t !== "object" || !isQuestionTurn(t)) return false;
    return !(t.content as Record<string, unknown>).answeredBy;
  });
}
