import type { OutputView, Turn, WorkflowPhase, ResultContent } from "./turn-types";
import type { ResultStatus } from "@/lib/config/constants";
import { analyzeTurn, ensureFreshSignals } from "./turn-analyzer";

export interface DeriveOptions {
  workflow?: WorkflowPhase;
}

function questionPromptFromText(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tailQuestion = [...lines].reverse().find((l) => l.endsWith("?"));
  if (tailQuestion) return tailQuestion;
  return text.trim();
}

/**
 * Pure transformer: list of turns → OutputView. Replaces the fragile
 * "walk logs backwards and glue text entries" heuristic that used to live
 * in agent-manager.handleExit. Safe to call on partial (in-progress) turn
 * lists too.
 */
export function deriveOutput(turns: Turn[], opts: DeriveOptions = {}): OutputView {
  const view: OutputView = {
    headline: null,
    awaiting: null,
    questions: [],
    workflowPhase: opts.workflow ?? null,
    lastAssistantTurnId: null,
    resultStats: null,
    producedArtifacts: [],
  };

  // Freshen signals lazily — preserves stable ordering when a heuristic bump
  // invalidates stored data.
  const fresh: Turn[] = [];
  for (let i = 0; i < turns.length; i++) {
    fresh.push(
      ensureFreshSignals(turns[i], {
        priorTurns: fresh,
        workflow: opts.workflow ?? turns[i].phase,
      })
    );
  }

  // Walk from end to start collecting candidates + artifacts.
  for (let i = fresh.length - 1; i >= 0; i--) {
    const t = fresh[i];

    if (!view.lastAssistantTurnId && t.kind === "assistant_message") {
      view.lastAssistantTurnId = t.id;
    }

    if (!view.resultStats && t.kind === "result" && t.content.type === "result") {
      view.resultStats = t.content as ResultContent;
    }

    if (t.kind === "ask_user_question" && t.content.type === "question") {
      const answered = !!(t.content as { answeredBy?: string }).answeredBy;
      if (!answered) {
        view.questions.unshift({
          turnId: t.id,
          prompt: t.content.prompt,
          options: t.content.options,
        });
      }
    }

    if (t.kind === "assistant_message" && t.content.type === "text") {
      const text = t.content.text;
      const answered = !!(t.content as { answeredBy?: string }).answeredBy;
      const question = t.signals.find(
        (s) => s.kind === "contains_question" && (s.confidence ?? 0) >= 0.7
      );
      if (question && !answered) {
        view.questions.unshift({
          turnId: t.id,
          prompt: questionPromptFromText(text),
        });
      }
      for (const s of t.signals) {
        if (s.kind === "code_fence_json") {
          view.producedArtifacts.unshift({
            kind: "json",
            turnId: t.id,
            preview: text.slice(0, 240),
          });
        }
      }
    }
  }

  // ---- Awaiting banner ----
  const unansweredQuestion = view.questions[view.questions.length - 1];
  if (unansweredQuestion) {
    view.awaiting = {
      kind: "user_response",
      step: opts.workflow?.workflow,
      turnId: unansweredQuestion.turnId,
    };
  } else {
    // Check latest assistant message for workflow_gate signal
    for (let i = fresh.length - 1; i >= 0; i--) {
      const t = fresh[i];
      const gate = t.signals.find((s) => s.kind === "workflow_gate");
      if (gate) {
        view.awaiting = {
          kind: gate.awaiting ?? "user_response",
          step: gate.step,
          turnId: t.id,
        };
        break;
      }
      if (t.kind === "assistant_message") break;
    }
  }

  // ---- Result status ----
  {
    const hasError = fresh.some(t => t.kind === "error");
    let status: ResultStatus | undefined;
    if (hasError) {
      status = "failed";
    } else if (view.questions.length > 0) {
      const lastQ = view.questions[view.questions.length - 1];
      const optCount = lastQ.options?.length ?? 0;
      status = optCount === 2 ? "needs_confirmation" : optCount > 2 ? "needs_selection" : "needs_input";
    } else if (view.awaiting?.kind === "user_response") {
      status = "needs_input";
    } else if (view.resultStats !== null || view.lastAssistantTurnId !== null) {
      status = "answered";
    }
    view.resultStatus = status;
  }

  // ---- Headline priority ----
  // 1. Latest unanswered AskUserQuestion
  const latestQuestion = [...fresh].reverse().find(
    (t) =>
      (t.kind === "ask_user_question" &&
        t.content.type === "question" &&
        !(t.content as { answeredBy?: string }).answeredBy) ||
      (t.kind === "assistant_message" &&
        t.content.type === "text" &&
        !(t.content as { answeredBy?: string }).answeredBy &&
        t.signals.some((s) => s.kind === "contains_question" && (s.confidence ?? 0) >= 0.7))
  );
  if (latestQuestion?.content.type === "question") {
    view.headline = {
      turnId: latestQuestion.id,
      text: latestQuestion.content.prompt,
      kind: latestQuestion.kind,
      options: latestQuestion.content.options,
    };
    return view;
  }
  if (latestQuestion?.content.type === "text") {
    view.headline = {
      turnId: latestQuestion.id,
      text: questionPromptFromText(latestQuestion.content.text),
      kind: latestQuestion.kind,
    };
    return view;
  }

  // 2. Latest assistant_message with final_answer signal
  for (let i = fresh.length - 1; i >= 0; i--) {
    const t = fresh[i];
    if (t.kind !== "assistant_message" || t.content.type !== "text") continue;
    if (t.signals.some((s) => s.kind === "final_answer")) {
      view.headline = { turnId: t.id, text: t.content.text, kind: t.kind };
      return view;
    }
  }

  // 3. workflow_step_end's preceding assistant message
  for (let i = fresh.length - 1; i >= 0; i--) {
    if (fresh[i].kind === "workflow_step_end") {
      for (let j = i - 1; j >= 0; j--) {
        const t = fresh[j];
        if (t.kind === "assistant_message" && t.content.type === "text") {
          view.headline = { turnId: t.id, text: t.content.text, kind: t.kind };
          return view;
        }
      }
      break;
    }
  }

  // 4. Latest assistant_message of any kind
  for (let i = fresh.length - 1; i >= 0; i--) {
    const t = fresh[i];
    if (t.kind === "assistant_message" && t.content.type === "text" && t.content.text.trim()) {
      view.headline = { turnId: t.id, text: t.content.text, kind: t.kind };
      return view;
    }
  }

  // 5. CLI result summary
  if (view.resultStats?.summaryText) {
    const latestResult = [...fresh].reverse().find((t) => t.kind === "result");
    if (latestResult) {
      view.headline = {
        turnId: latestResult.id,
        text: view.resultStats.summaryText,
        kind: latestResult.kind,
      };
      return view;
    }
  }

  // 6. Empty — caller renders "Agent still working…" placeholder
  return view;
}

// Re-export analyze for callers that want to rerun directly
export { analyzeTurn };
