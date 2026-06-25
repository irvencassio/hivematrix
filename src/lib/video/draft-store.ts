/**
 * Persistence for video script drafts awaiting review. One JSON record per draft
 * under ~/.hivematrix/video/drafts/. References the script/title/etc files the
 * `video/` pipeline wrote, plus the review status and the linked needs_input task.
 */

import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "fs";

export type DraftStatus =
  | "review"
  | "rendering"
  | "published"
  | "cancelled"
  | "error"
  // HeyGen portal flow: a Browser Lane child task does the portal work and hands
  // a result back. portal_pending = child created and running; portal_completed =
  // a usable local video is ready for the existing publish path; needs_publish_input
  // = only a HeyGen URL / manual note came back (no local file → not published).
  | "portal_pending"
  | "portal_completed"
  | "needs_publish_input";

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
  // HeyGen portal linkage / completion (metadata only — never secrets).
  portalTaskId?: string;         // the Browser Lane child task doing the portal work
  portalResolvedTaskId?: string; // child whose completion was applied (idempotency)
  portalVideoUrl?: string;       // HeyGen final video URL (NOT a YouTube publish)
  portalCompletedAt?: string;
  manualCompletionNote?: string;
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
