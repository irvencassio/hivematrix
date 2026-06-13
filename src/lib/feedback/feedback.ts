/**
 * Feedback collection — bugs and enhancement requests.
 *
 * A lightweight local backlog the founder fills from anywhere (a text to
 * MessageBee, the desktop console, or the mobile app) and triages on-box. Not a
 * full issue tracker — just "capture it before it's forgotten", with counts the
 * UIs can render. DB-backed; everything stays local.
 */

import { getDb, generateId } from "@/lib/db";

export const FEEDBACK_KINDS = ["bug", "enhancement"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ["open", "triaged", "done", "wontfix"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackItem {
  _id: string;
  kind: FeedbackKind;
  title: string;
  detail: string;
  source: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RecordFeedbackInput {
  kind: FeedbackKind;
  title: string;
  detail?: string;
  source?: string;
}

export function recordFeedback(input: RecordFeedbackInput): FeedbackItem {
  const kind: FeedbackKind = input.kind === "enhancement" ? "enhancement" : "bug";
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new Error("feedback title is required");
  const id = generateId();
  getDb()
    .prepare("INSERT INTO feedback (_id, kind, title, detail, source) VALUES (?, ?, ?, ?, ?)")
    .run(id, kind, title, (input.detail ?? "").trim(), (input.source ?? "console").trim() || "console");
  return getFeedback(id)!;
}

export function getFeedback(id: string): FeedbackItem | null {
  return (getDb().prepare("SELECT * FROM feedback WHERE _id = ?").get(id) as FeedbackItem | undefined) ?? null;
}

export interface ListFeedbackFilter {
  kind?: FeedbackKind;
  status?: FeedbackStatus;
}

export function listFeedback(filter: ListFeedbackFilter = {}): FeedbackItem[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.kind) {
    clauses.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDb()
    .prepare(`SELECT * FROM feedback ${where} ORDER BY createdAt DESC, rowid DESC`)
    .all(...params) as FeedbackItem[];
}

export function setFeedbackStatus(id: string, status: FeedbackStatus): FeedbackItem | null {
  if (!FEEDBACK_STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  const info = getDb()
    .prepare("UPDATE feedback SET status = ?, updatedAt = datetime('now') WHERE _id = ?")
    .run(status, id);
  return info.changes > 0 ? getFeedback(id) : null;
}

export interface FeedbackSummary {
  total: number;
  open: number;
  byKind: Record<FeedbackKind, number>;
  byStatus: Record<FeedbackStatus, number>;
}

export function feedbackSummary(): FeedbackSummary {
  const rows = getDb().prepare("SELECT kind, status FROM feedback").all() as Array<{ kind: FeedbackKind; status: FeedbackStatus }>;
  const byKind = Object.fromEntries(FEEDBACK_KINDS.map((k) => [k, 0])) as Record<FeedbackKind, number>;
  const byStatus = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<FeedbackStatus, number>;
  for (const r of rows) {
    if (r.kind in byKind) byKind[r.kind] += 1;
    if (r.status in byStatus) byStatus[r.status] += 1;
  }
  return { total: rows.length, open: byStatus.open, byKind, byStatus };
}
