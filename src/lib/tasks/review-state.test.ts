import test from "node:test";
import assert from "node:assert/strict";

import type { Turn } from "@/lib/orchestrator/turn-types";

import { deriveReviewStateFromTurns, getReviewStateMeta } from "./review-state";

function assistantQuestionTurn(): Turn {
  return {
    id: "turn-1",
    taskId: "task-1",
    sequence: 0,
    role: "assistant",
    kind: "assistant_message",
    label: "question",
    startedAt: "2026-06-08T12:00:00.000Z",
    endedAt: "2026-06-08T12:00:01.000Z",
    content: {
      type: "text",
      text: "Which path should I take?",
      wordCount: 5,
      truncated: false,
    },
    signals: [{ kind: "contains_question", confidence: 0.99 }],
    signalsVersion: 1,
  };
}

function finalAnswerTurn(): Turn {
  return {
    id: "turn-2",
    taskId: "task-2",
    sequence: 1,
    role: "assistant",
    kind: "assistant_message",
    label: "final",
    startedAt: "2026-06-08T12:02:00.000Z",
    endedAt: "2026-06-08T12:02:01.000Z",
    content: {
      type: "text",
      text: "I updated the API route and verified the task flow.",
      wordCount: 10,
      truncated: false,
    },
    signals: [{ kind: "final_answer", confidence: 0.95 }],
    signalsVersion: 1,
  };
}

test("deriveReviewStateFromTurns returns needs_input when the latest review output asks a human question", () => {
  assert.equal(deriveReviewStateFromTurns([assistantQuestionTurn()]), "needs_input");
});

test("deriveReviewStateFromTurns returns ready_for_review when the task has no unanswered question", () => {
  assert.equal(deriveReviewStateFromTurns([finalAnswerTurn()]), "ready_for_review");
});

test("getReviewStateMeta returns distinct labels for review substates", () => {
  assert.deepEqual(getReviewStateMeta("needs_input"), {
    label: "Needs Input",
    tone: "attention",
  });
  assert.deepEqual(getReviewStateMeta("ready_for_review"), {
    label: "Ready for Review",
    tone: "review",
  });
  assert.deepEqual(getReviewStateMeta("needs_parent_decision"), {
    label: "Needs Flight decision",
    tone: "review",
  });
  assert.equal(getReviewStateMeta(null), null);
});
