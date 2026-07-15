import type { Turn } from "@/lib/orchestrator/turn-types";
import type { ReviewState } from "@/lib/tasks/review-state";

export interface TaskLog {
  timestamp: string;
  type: "text" | "question" | "tool_use" | "tool_result" | "approval_request" | "stuck_request" | "error";
  content: string;
}

export interface TaskApproval {
  timestamp: string;
  tool: string;
  command: string;
  context?: string;
  decision?: "approve" | "done" | "denied" | "timeout";
  decidedVia?: string;
}

export interface TaskComment {
  timestamp: string;
  author: "human" | "system";
  content: string;
}

export interface BrainSelectionState {
  task: string[];
  session: string[];
}

export interface TaskOutput {
  summary?: string;
  filesChanged?: string[];
  gitDiff?: string;
  cost?: number;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  contextWindow?: number;
  modelsUsed?: string[];
  lastRunCost?: number;
  lastRunTurns?: number;
  lastRunInputTokens?: number;
  lastRunOutputTokens?: number;
  runCount?: number;
}

export type TaskDelayReason = "manual" | "usage_limit" | "transient_retry";
export type TaskSource = "dashboard" | "api" | "scheduler" | "directive" | "superwhisper";

// HiveMatrix task status — missions/goals removed; directives replace them.
export type HiveTaskStatus =
  | "backlog"
  | "assigned"
  | "in_progress"
  | "review"
  | "done"
  | "failed"
  | "cancelled";

export interface HiveTask {
  _id: string;
  title: string;
  description: string;
  project: string;
  projectPath: string;
  status: HiveTaskStatus;
  reviewState?: ReviewState | null;
  position: number;
  agentPid: number | null;
  sessionId: string | null;
  resumeSessionId: string | null;
  source: TaskSource;
  executor: "agent" | "human";
  workflow: string;
  workflowStepIndex: number;
  model?: string | null;
  profile?: string | null;
  delayUntil?: string | null;
  delayReason?: TaskDelayReason | null;
  worktreeName?: string | null;
  launchCommand?: string | null;
  agentType?: string;
  thinkingMode?: string;
  nextStep: string | null;
  parentTaskId: string | null;
  centralTaskId: string | null;
  directiveId?: string | null;
  /** Shared grouping key for tasks created together (chat/directive fan-out, or a coordinator's subtasks). */
  batchId?: string | null;
  /** Verification-gate result, when a real signal is available (e.g. the generic/local-model smoke runner). Never fabricated — null when no gate ran (e.g. the `claude -p` path). */
  verification?: { verdict: "passed" | "failed" | "uncertain"; report?: string; ranAt?: string } | null;
  dependsOn?: string[];
  brainSelection?: BrainSelectionState;
  output: TaskOutput | null;
  logs: TaskLog[];
  turns?: Turn[];
  approvals: TaskApproval[];
  comments: TaskComment[];
  error?: string;
  timeoutMinutes: number;
  maxBudgetUsd: number;
  // Verified-completion ledger
  completedBy?: string | null;
  proverType?: "test" | "probe" | "artifact" | "manual" | null;
  completionNote?: string | null;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySettings {
  enabled: boolean;
  brainRootDir: string;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  brainRootDir: "~/_GD/brain",
};
