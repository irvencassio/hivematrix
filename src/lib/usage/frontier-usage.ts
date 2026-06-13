/**
 * Frontier model usage, aggregated from completed task outputs (the agent
 * manager accumulates cost + token counts per task). This is the live-spend
 * indicator the console shows — distinct from the (stubbed) subscription-window
 * fetcher in ./fetcher. Local Qwen work has zero cost and is excluded.
 */

import { Task } from "@/lib/db";
import { MODEL_SHORT_NAMES } from "@/lib/models/catalog";

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
  byModel: FrontierModelUsage[];
}

/** A model id that bills (frontier) vs. local Qwen / image models (free). */
export function isFrontierModel(modelId: string): boolean {
  return /^(claude|gpt|o[0-9]|codex)/i.test(modelId);
}

interface TaskOutput {
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelsUsed?: string[];
}

function parseOutput(output: unknown): TaskOutput {
  if (!output) return {};
  if (typeof output === "string") { try { return JSON.parse(output) as TaskOutput; } catch { return {}; } }
  return output as TaskOutput;
}

export async function getFrontierUsage(): Promise<FrontierUsage> {
  const tasks = await Task.find({});
  const byModel = new Map<string, FrontierModelUsage>();
  let totalCost = 0, inputTokens = 0, outputTokens = 0, taskCount = 0;

  for (const task of tasks) {
    const out = parseOutput(task.output);
    const frontier = (out.modelsUsed ?? []).filter(isFrontierModel);
    if (frontier.length === 0) continue;
    const cost = typeof out.cost === "number" ? out.cost : 0;
    totalCost += cost;
    inputTokens += out.inputTokens ?? 0;
    outputTokens += out.outputTokens ?? 0;
    taskCount += 1;
    // Attribute the task's cost to the first frontier model it used (avoids
    // double-counting when a task touched more than one).
    const primary = frontier[0];
    const row = byModel.get(primary) ?? { modelId: primary, label: MODEL_SHORT_NAMES[primary] ?? primary, tasks: 0, cost: 0 };
    row.tasks += 1;
    row.cost += cost;
    byModel.set(primary, row);
  }

  return {
    totalCost: Math.round(totalCost * 10000) / 10000,
    inputTokens,
    outputTokens,
    taskCount,
    byModel: [...byModel.values()].sort((a, b) => b.cost - a.cost),
  };
}
