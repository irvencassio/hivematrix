/**
 * Flash task-lookup tools: give the chat assistant READ access to its own task
 * board so it can diagnose a failure or report status itself, instead of asking
 * the operator to screenshot the error. Read-only — Flash already has
 * escalate_to_task for creating work; this is the missing "look it up" half.
 */

import { getDb, Task } from "@/lib/db";

export interface TaskLogEntry {
  timestamp?: string;
  type?: string;
  content?: unknown;
}

export interface TaskLike {
  _id: string;
  title: string;
  status: string;
  model?: string | null;
  project?: string | null;
  error?: string | null;
  reviewState?: string | null;
  completionNote?: string | null;
  logs?: unknown;
  output?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

const STATUS_ICON: Record<string, string> = {
  failed: "✗", done: "✓", review: "◷", in_progress: "▸",
  cancelled: "∅", archived: "▨", backlog: "•", pending: "•", assigned: "▸",
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Resolve a task by exact _id, then _id-prefix, then fuzzy title (most recent). */
export async function resolveTask(query: string): Promise<TaskLike | null> {
  const q = (query ?? "").trim();
  if (!q) return null;
  const exact = await Task.findById(q).catch(() => null);
  if (exact) return exact as TaskLike;
  // _id prefix (operators paste short ids) or case-insensitive title contains.
  const row = getDb()
    .prepare("SELECT _id FROM tasks WHERE _id LIKE ? OR lower(title) LIKE lower(?) ORDER BY updatedAt DESC LIMIT 1")
    .get(q + "%", "%" + q + "%") as { _id: string } | undefined;
  return row ? ((await Task.findById(row._id)) as TaskLike | null) : null;
}

/** Normalize the stored logs (array, or JSON string) into entries. */
export function toLogEntries(logs: unknown): TaskLogEntry[] {
  let arr: unknown = logs;
  if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { return []; } }
  return Array.isArray(arr) ? (arr as TaskLogEntry[]) : [];
}

/** The last `n` log entries, each as a compact one-liner (the tail is the most
 *  useful part when diagnosing why a task exited). */
export function logTail(logs: unknown, n = 12): string[] {
  const entries = toLogEntries(logs);
  return entries.slice(-n).map((e) => {
    const type = String(e.type ?? "").trim();
    const raw = typeof e.content === "string" ? e.content : JSON.stringify(e.content ?? "");
    const content = truncate(String(raw).replace(/\s+/g, " ").trim(), 160);
    return type ? `[${type}] ${content}` : content;
  });
}

/** The task's result/output summarized to a string, or "" if none. */
export function summarizeOutput(output: unknown): string {
  let o: unknown = output;
  if (typeof o === "string") { const s = o; try { o = JSON.parse(o); } catch { return s.trim(); } }
  if (!o || typeof o !== "object") return "";
  const rec = o as Record<string, unknown>;
  const pick = rec.summary ?? rec.result ?? rec.text ?? rec.message;
  if (typeof pick === "string" && pick.trim()) return pick.trim();
  const keys = Object.keys(rec);
  return keys.length ? truncate(JSON.stringify(rec), 400) : "";
}

/** One-line summary for a list. */
export function formatTaskLine(t: TaskLike): string {
  const icon = STATUS_ICON[t.status] ?? "•";
  return `${t._id.slice(0, 8)}  ${icon} ${t.status}${t.reviewState ? "/" + t.reviewState : ""} — ${truncate(t.title, 70)}${t.model ? ` (${t.model})` : ""}`;
}

/** Full detail for one task — status, error, result, and the log tail. */
export function formatTaskDetail(t: TaskLike, opts: { logTail?: number } = {}): string {
  const lines: string[] = [];
  lines.push(`Task ${t._id.slice(0, 8)} — "${t.title}"`);
  lines.push(`Status: ${t.status}${t.reviewState ? ` (${t.reviewState})` : ""}${t.model ? ` · model ${t.model}` : ""}${t.project ? ` · ${t.project}` : ""}`);
  if (t.error) lines.push(`Error: ${truncate(String(t.error), 400)}`);
  if (t.completionNote) lines.push(`Note: ${truncate(String(t.completionNote), 300)}`);
  const result = summarizeOutput(t.output);
  if (result) lines.push(`Result: ${truncate(result, 500)}`);
  const tail = logTail(t.logs, opts.logTail ?? 12);
  if (tail.length) {
    lines.push("", `Recent activity (last ${tail.length}):`);
    for (const e of tail) lines.push("  " + e);
  }
  return lines.join("\n");
}

/** get_task tool body: resolve + format, or a helpful miss. */
export async function getTaskDetailText(query: string): Promise<string> {
  const t = await resolveTask(query);
  if (!t) return `No task found matching "${query}". Use list_tasks to see recent tasks, then look one up by its id.`;
  return formatTaskDetail(t);
}

/** list_tasks tool body: recent tasks, optionally filtered by status. */
export async function listTasksText(opts: { status?: string; limit?: number } = {}): Promise<string> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 15), 1), 50);
  const query: Record<string, unknown> = {};
  const status = (opts.status ?? "").trim();
  if (status) query.status = status;
  const tasks = (await Task.find(query).sort({ updatedAt: -1 }).limit(limit)) as TaskLike[];
  if (!tasks.length) return status ? `No tasks with status "${status}".` : "No tasks on the board.";

  const header = status
    ? `${tasks.length} ${status} task(s), most recent first:`
    : boardSummaryLine() + `\nMost recent ${tasks.length}:`;
  return header + "\n" + tasks.map(formatTaskLine).join("\n");
}

/** A "3 failed · 9 review · 1 in_progress" style count line across all tasks. */
export function boardSummaryLine(): string {
  const rows = getDb()
    .prepare("SELECT status, COUNT(*) n FROM tasks GROUP BY status")
    .all() as { status: string; n: number }[];
  if (!rows.length) return "Board: empty.";
  const order = ["in_progress", "backlog", "pending", "review", "failed", "done", "cancelled", "archived"];
  rows.sort((a, b) => (order.indexOf(a.status) + 100) % 100 - (order.indexOf(b.status) + 100) % 100);
  return "Board: " + rows.map((r) => `${r.n} ${r.status}`).join(" · ");
}
