/**
 * Turn-structured log model — replaces the flat append-only `TaskLog[]`.
 *
 * A "turn" is one coherent unit of activity: a complete assistant message,
 * a single tool call with its result, a system notice, etc. Each turn gets
 * a stable id, a human-readable label, and zero or more derived signals.
 */

import type { ResultStatus } from "@/lib/config/constants";

export type TurnKind =
  | "assistant_message"
  | "assistant_thinking"
  | "tool_call"
  | "tool_result"
  | "ask_user_question"
  | "workflow_step_start"
  | "workflow_step_end"
  | "result"
  | "error"
  | "system";

export type TurnRole = "assistant" | "tool" | "user" | "system";

export interface TextContent {
  type: "text";
  text: string;
  wordCount: number;
  truncated: boolean;
  answeredBy?: string;
}

export interface ThinkingContent {
  type: "thinking";
  text: string;
  truncated: boolean;
}

export interface ToolContent {
  type: "tool";
  tool: string;
  input: unknown;
  resultTurnId?: string;
}

export interface ToolResultContent {
  type: "tool_result";
  forToolTurnId?: string;
  text: string;
  isError: boolean;
  truncated: boolean;
}

export interface QuestionContent {
  type: "question";
  prompt: string;
  options?: string[];
  answeredBy?: string;
}

export interface ResultContent {
  type: "result";
  summaryText: string;
  cost: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  sessionId: string;
  resultStatus?: ResultStatus;
}

export interface ErrorContent {
  type: "error";
  text: string;
}

export interface WorkflowMarkerContent {
  type: "workflow_marker";
  step: string;
  stepIndex: number;
  event: "start" | "end";
}

export type TurnContent =
  | TextContent
  | ThinkingContent
  | ToolContent
  | ToolResultContent
  | QuestionContent
  | ResultContent
  | ErrorContent
  | WorkflowMarkerContent;

export type SignalKind =
  | "contains_question"
  | "final_answer"
  | "workflow_gate"
  | "code_fence_json"
  | "budget_warning"
  | "likely_truncated";

export interface Signal {
  kind: SignalKind;
  confidence?: number;
  location?: "end" | "mid" | "heading";
  step?: string;
  awaiting?: "user_response" | "next_step";
  parsed?: boolean;
  bytes?: number;
}

export interface WorkflowPhase {
  workflow: string;
  stepIndex: number;
  stepName?: string;
}

export interface Turn {
  id: string;
  taskId: string;
  sequence: number;
  role: TurnRole;
  kind: TurnKind;
  label: string;
  phase?: WorkflowPhase;
  startedAt: string;
  endedAt?: string;
  content: TurnContent;
  signals: Signal[];
  signalsVersion: number;
}

export interface OutputView {
  headline: { turnId: string; text: string; kind: TurnKind } | null;
  awaiting: { kind: "user_response" | "next_step"; step?: string; turnId: string } | null;
  questions: { turnId: string; prompt: string; options?: string[] }[];
  workflowPhase: WorkflowPhase | null;
  lastAssistantTurnId: string | null;
  resultStats: ResultContent | null;
  producedArtifacts: { kind: "json" | "diff"; turnId: string; preview: string }[];
  resultStatus?: ResultStatus;
}
