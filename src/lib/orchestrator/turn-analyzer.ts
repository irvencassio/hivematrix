import type { Signal, Turn, WorkflowPhase } from "./turn-types";
import { extractJson } from "./mission-output-parser";
import {
  BUDGET_WARNING,
  CURRENT_SIGNAL_VERSION,
  FINAL_ANSWER_MARKERS,
  MIN_QUESTION_CHARS,
  MIN_QUESTION_WORDS,
  QUESTION_REBUTTAL,
  QUESTION_STARTERS,
  TERMINAL_PUNCTUATION,
} from "./heuristics";

export interface AnalyzeContext {
  /** Prior turns in the same task (earliest first). */
  priorTurns: Turn[];
  workflow?: WorkflowPhase;
}

function countWords(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function lastSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/[^.!?]+[.!?]*\s*$/);
  return (match?.[0] ?? trimmed).trim();
}

function detectQuestion(text: string): Signal | null {
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  const tailLine = [...lines].reverse().find((l) => l.trim()) ?? "";
  const tail = tailLine.trim();

  // Trailing '?' check
  if (tail.endsWith("?")) {
    const words = countWords(tail);
    if (tail.length >= MIN_QUESTION_CHARS && words >= MIN_QUESTION_WORDS) {
      // Rhetorical filter: look ahead (shouldn't exist since this is tail) —
      // also verify first word isn't a rebuttal starter (suggesting answered).
      if (!QUESTION_REBUTTAL.test(tail)) {
        // List-item variant (tail starts with -, *, digit.)
        const isListItem = /^[-*]\s|^\d+\./.test(tail);
        return {
          kind: "contains_question",
          confidence: isListItem ? 0.7 : 0.8,
          location: "end",
        };
      }
    }
  }

  // First-sentence opener (weak signal — used when trailing '?' missed)
  const firstLine = lines.find((l) => l.trim()) ?? "";
  const firstSentence = lastSentence(firstLine) || firstLine;
  if (QUESTION_STARTERS.test(firstSentence.trim())) {
    return {
      kind: "contains_question",
      confidence: 0.5,
      location: "heading",
    };
  }

  return null;
}

function detectFinalAnswer(text: string, priorAssistantWordCounts: number[]): Signal | null {
  if (!text) return null;

  // Explicit marker → strong signal
  if (FINAL_ANSWER_MARKERS.test(text)) {
    return { kind: "final_answer", confidence: 0.8 };
  }

  // Word count heuristic (>= median of prior assistant turns and no question)
  if (priorAssistantWordCounts.length > 0) {
    const sorted = [...priorAssistantWordCounts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (countWords(text) >= median && !detectQuestion(text)) {
      return { kind: "final_answer", confidence: 0.6 };
    }
  }

  return null;
}

function detectCodeFenceJson(text: string): Signal | null {
  if (!text || !text.includes("```")) return null;
  const { parsed, raw } = extractJson(text);
  if (raw == null) return null;
  return {
    kind: "code_fence_json",
    parsed: parsed !== null,
    bytes: raw.length,
  };
}

function detectBudgetWarning(text: string): Signal | null {
  return BUDGET_WARNING.test(text) ? { kind: "budget_warning" } : null;
}

function detectTruncated(text: string, explicitTruncated: boolean): Signal | null {
  if (!text) return null;
  const endsCleanly = TERMINAL_PUNCTUATION.test(text);
  if (explicitTruncated || !endsCleanly) {
    return { kind: "likely_truncated" };
  }
  return null;
}

function detectWorkflowGate(
  turn: Turn,
  ctx: AnalyzeContext,
  selfSignals: Signal[]
): Signal | null {
  if (!ctx.workflow) return null;
  const workflow = ctx.workflow.workflow;

  if (turn.kind === "assistant_message" || turn.kind === "ask_user_question") {
    if (workflow.includes("brainstorm")) {
      const hasQuestion =
        turn.kind === "ask_user_question" ||
        selfSignals.some(
          (s) => s.kind === "contains_question" && (s.confidence ?? 0) >= 0.7
        );
      if (hasQuestion) {
        return { kind: "workflow_gate", step: workflow, awaiting: "user_response" };
      }
    }
    if (workflow.includes("plan") || workflow.includes("review")) {
      const hasJson = selfSignals.some(
        (s) => s.kind === "code_fence_json" && s.parsed === true
      );
      if (hasJson) {
        return { kind: "workflow_gate", step: workflow, awaiting: "next_step" };
      }
    }
  }
  return null;
}

/**
 * Pure analyzer — produces Signal[] for a turn in the context of its
 * preceding turns. Safe to call lazily when `turn.signalsVersion` is behind
 * `CURRENT_SIGNAL_VERSION`.
 */
export function analyzeTurn(turn: Turn, ctx: AnalyzeContext): Signal[] {
  const out: Signal[] = [];

  if (turn.kind === "ask_user_question") {
    out.push({ kind: "contains_question", confidence: 1.0, location: "end" });
  }

  if (turn.kind === "assistant_message" && turn.content.type === "text") {
    const text = turn.content.text;
    const question = detectQuestion(text);
    if (question) out.push(question);

    const json = detectCodeFenceJson(text);
    if (json) out.push(json);

    const prior = ctx.priorTurns.filter(
      (t) => t.kind === "assistant_message" && t.content.type === "text"
    );
    const priorCounts = prior.map((t) =>
      t.content.type === "text" ? t.content.wordCount : 0
    );
    const finalAnswer = detectFinalAnswer(text, priorCounts);
    if (finalAnswer && !question) out.push(finalAnswer);

    const budget = detectBudgetWarning(text);
    if (budget) out.push(budget);

    const truncated = detectTruncated(text, turn.content.truncated);
    if (truncated) out.push(truncated);
  }

  if (turn.kind === "error" && turn.content.type === "error") {
    const budget = detectBudgetWarning(turn.content.text);
    if (budget) out.push(budget);
  }

  const gate = detectWorkflowGate(turn, ctx, out);
  if (gate) out.push(gate);

  return out;
}

/** Re-derive signals for a turn if its stored version is stale. Returns the
 * (possibly updated) turn. Does not mutate the input. */
export function ensureFreshSignals(turn: Turn, ctx: AnalyzeContext): Turn {
  if (
    (turn.signalsVersion ?? 0) >= CURRENT_SIGNAL_VERSION &&
    Array.isArray(turn.signals) &&
    turn.signals.length > 0
  ) {
    return turn;
  }
  return {
    ...turn,
    signals: analyzeTurn(turn, ctx),
    signalsVersion: CURRENT_SIGNAL_VERSION,
  };
}
