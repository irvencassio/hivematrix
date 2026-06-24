/**
 * Persistence for video script drafts awaiting review. One JSON record per draft
 * under ~/.hivematrix/video/drafts/. References the script/title/etc files the
 * `video/` pipeline wrote, plus the review status and the linked needs_input task.
 */

import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "fs";

export type DraftStatus = "review" | "rendering" | "published" | "cancelled" | "error";

export interface VideoDraftPaths {
  script: string;
  title: string;
  description: string;
  tags: string;
  headlines?: string;
  video: string;
}

export interface VideoDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: DraftStatus;
  kind: string;        // "ai-news"
  privacy: string;     // youtube privacy on publish
  title: string;
  paths: VideoDraftPaths;
  taskId?: string;     // the linked needs_input task (surfaces in Reply UI)
  revisions: number;   // how many regenerate loops
  youtubeUrl?: string;
  error?: string;
}

export function draftsDir(): string {
  const d = join(homedir(), ".hivematrix", "video", "drafts");
  mkdirSync(d, { recursive: true });
  return d;
}
function draftPath(id: string): string { return join(draftsDir(), `${id}.json`); }

export function saveDraft(d: VideoDraft): VideoDraft {
  const next = { ...d, updatedAt: new Date().toISOString() };
  writeFileSync(draftPath(next.id), JSON.stringify(next, null, 2));
  return next;
}

export function getDraft(id: string): VideoDraft | null {
  const p = draftPath(id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")) as VideoDraft; } catch { return null; }
}

export function listDrafts(): VideoDraft[] {
  return readdirSync(draftsDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(readFileSync(join(draftsDir(), f), "utf-8")) as VideoDraft; } catch { return null; } })
    .filter((d): d is VideoDraft => !!d)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Drafts still waiting on the operator (for the console "Video review" panel). */
export function pendingDrafts(): VideoDraft[] {
  return listDrafts().filter((d) => d.status === "review");
}

export function updateDraft(id: string, patch: Partial<VideoDraft>): VideoDraft | null {
  const cur = getDraft(id);
  if (!cur) return null;
  return saveDraft({ ...cur, ...patch });
}
