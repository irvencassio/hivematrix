/**
 * Builds the bounded "results from delegated subtasks" block a coordinator
 * task sees when the scheduler's waiting_children reaper resumes it. This is
 * the read-back half of COO delegation — a parent reads its children's
 * outputs via a continuation, never a block (see DECISIONS.md Q16).
 */

import { deriveOutput } from "./derive-output";
import type { Turn } from "./turn-types";

export interface ChildResultInput {
  taskId: string;
  agentType: string;
  title: string;
  status: string;
  /** Already-resolved text to show for this child — null means no output was captured. */
  resultText: string | null;
}

const MAX_CHARS_PER_CHILD = 2000;
const MAX_CHILDREN = 10;

/**
 * Extract the best available result text for a completed task — mirrors the
 * proven output.summary/result/text → turns headline → trailing log-text
 * fallback chain used for directive retrospective text extraction.
 */
export function extractChildResultText(task: { output?: unknown; turns?: unknown; logs?: unknown }): string | null {
  const out = (task.output ?? {}) as Record<string, unknown>;
  for (const key of ["summary", "result", "text"]) {
    const val = out[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }

  if (Array.isArray(task.turns) && task.turns.length > 0) {
    try {
      const view = deriveOutput(task.turns as unknown as Turn[]);
      if (view.headline?.text?.trim()) return view.headline.text.trim();
      if (view.resultStats?.summaryText?.trim()) return view.resultStats.summaryText.trim();
    } catch {
      // Fall through to the log fallback.
    }
  }

  if (Array.isArray(task.logs) && task.logs.length > 0) {
    let text = "";
    for (let i = task.logs.length - 1; i >= 0; i--) {
      const log = task.logs[i] as Record<string, unknown>;
      if (log.type === "text" && typeof log.content === "string" && log.content.trim()) {
        text = log.content + text;
      } else if (text) {
        break;
      }
    }
    if (text.trim()) return text.trim();
  }

  return null;
}

/**
 * Build the bounded results block. Caps: 2000 chars per child, 10 children —
 * an uncapped block blows the context window (the Hermes failure mode).
 * Every truncated or omitted child names its task id so the coordinator can
 * choose to look further.
 */
export function buildChildrenResultsBlock(children: ChildResultInput[]): string {
  const shown = children.slice(0, MAX_CHILDREN);
  const omitted = children.slice(MAX_CHILDREN);

  const sections = shown.map((c) => {
    const raw = (c.resultText ?? "(no output captured)").trim();
    const truncated = raw.length > MAX_CHARS_PER_CHILD;
    const body = truncated ? raw.slice(0, MAX_CHARS_PER_CHILD) : raw;
    const marker = truncated ? `\n…(truncated — see task ${c.taskId} for the full output)` : "";
    return `### [${c.agentType}] ${c.title} — ${c.status}\n${body}${marker}`;
  });

  const header = ["## Results from delegated subtasks"];
  if (omitted.length > 0) {
    header.push(`(${omitted.length} additional subtask(s) omitted — see task ids: ${omitted.map((c) => c.taskId).join(", ")})`);
  }

  return [header.join("\n"), ...sections].join("\n\n");
}
