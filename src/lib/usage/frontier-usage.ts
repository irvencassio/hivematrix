/**
 * Frontier model usage, aggregated from completed task outputs (the agent
 * manager accumulates cost + token counts per task). This is the live-spend
 * indicator the console shows — distinct from the (stubbed) subscription-window
 * fetcher in ./fetcher. Local Qwen work has zero cost and is excluded.
 */

import { Task } from "@/lib/db";
import { MODEL_SHORT_NAMES, claudeShortName } from "@/lib/models/catalog";
import {
  getSubscriptionRemainingDetailed,
  type SubscriptionUsage,
  type SubscriptionUsageOptions,
  type SubscriptionUsageResult,
  type SubscriptionUsageStatus,
} from "./subscription";
import { readCodexUsageProfile, type CodexUsageProfile } from "./codex";

export interface FrontierModelUsage {
  modelId: string;
  label: string;
  tasks: number;
  cost: number;
}

export interface FrontierUsage {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  taskCount: number;
  todayCost: number;
  todayTaskCount: number;
  byModel: FrontierModelUsage[];
  /** Remaining subscription capacity from the Anthropic OAuth usage API. Null when not logged in via claude.ai subscription. */
  subscription: SubscriptionUsage | null;
  /** Non-secret status for why subscription usage is available or unavailable. */
  subscriptionStatus: SubscriptionUsageStatus;
  /** Codex/ChatGPT subscription rate-limit windows parsed from local Codex session logs. */
  codexSubscription: CodexUsageProfile | null;
}

/** A model id that bills (frontier) vs. local Qwen / image models (free). */
export function isFrontierModel(modelId: string): boolean {
  return /^(claude|gpt|o[0-9]|codex|opus$|sonnet$|haiku$)/i.test(modelId);
}

interface TaskOutput {
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelsUsed?: string[];
}

interface UsageTask {
  output?: unknown;
  completedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export interface FrontierUsageOptions {
  bypassSubscriptionCache?: boolean;
}

type SubscriptionReader = (options?: SubscriptionUsageOptions) => Promise<SubscriptionUsageResult>;

let subscriptionReader: SubscriptionReader = (options) => getSubscriptionRemainingDetailed(undefined, options);
let codexUsageReader: () => CodexUsageProfile | null = readCodexUsageProfile;

function parseOutput(output: unknown): TaskOutput {
  if (!output) return {};
  if (typeof output === "string") { try { return JSON.parse(output) as TaskOutput; } catch { return {}; } }
  return output as TaskOutput;
}

export async function getFrontierUsage(options: FrontierUsageOptions = {}): Promise<FrontierUsage> {
  const tasks = await Task.find({}) as UsageTask[];
  const byModel = new Map<string, FrontierModelUsage>();
  let totalCost = 0, inputTokens = 0, outputTokens = 0, taskCount = 0, todayCost = 0, todayTaskCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const task of tasks) {
    const out = parseOutput(task.output);
    const frontier = (out.modelsUsed ?? []).filter(isFrontierModel);
    if (frontier.length === 0) continue;
    const cost = typeof out.cost === "number" ? out.cost : 0;
    totalCost += cost;
    inputTokens += out.inputTokens ?? 0;
    outputTokens += out.outputTokens ?? 0;
    taskCount += 1;
    const taskDate = (task.completedAt ?? task.updatedAt ?? task.createdAt ?? "").slice(0, 10);
    if (taskDate === today) {
      todayCost += cost;
      todayTaskCount += 1;
    }
    // Attribute the task's cost to the first frontier model it used (avoids
    // double-counting when a task touched more than one).
    const primary = frontier[0];
    const row = byModel.get(primary) ?? { modelId: primary, label: claudeShortName(primary) ?? MODEL_SHORT_NAMES[primary] ?? primary, tasks: 0, cost: 0 };
    row.tasks += 1;
    row.cost += cost;
    byModel.set(primary, row);
  }

  const subscriptionResult = await subscriptionReader({ bypassCache: options.bypassSubscriptionCache });
  const codexSubscription = codexUsageReader();

  return {
    totalCost: Math.round(totalCost * 10000) / 10000,
    inputTokens,
    outputTokens,
    taskCount,
    todayCost: Math.round(todayCost * 10000) / 10000,
    todayTaskCount,
    byModel: [...byModel.values()].sort((a, b) => b.cost - a.cost),
    subscription: subscriptionResult.usage,
    subscriptionStatus: subscriptionResult.status,
    codexSubscription,
  };
}

export function _setSubscriptionReaderForTests(reader: SubscriptionReader | null): void {
  subscriptionReader = reader ?? ((options) => getSubscriptionRemainingDetailed(undefined, options));
}

export function _setCodexUsageReaderForTests(reader: (() => CodexUsageProfile | null) | null): void {
  codexUsageReader = reader ?? readCodexUsageProfile;
}
