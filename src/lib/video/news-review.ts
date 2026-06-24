/**
 * AI-news video with a human-in-the-loop SCRIPT REVIEW, wired into the HiveMatrix
 * flow. Phase 1 drafts the script (cheap) and pauses as a `needs_input` review task;
 * the operator's Reply (console / iOS / voice) drives approve / edit / regenerate /
 * cancel via the pure classifier in review.ts. Only an approval runs the expensive
 * HeyGen render + YouTube publish (the spend/outward step).
 *
 * The decision logic is the tested core (review.ts); this is the IO glue that drives
 * the out-of-process `video/` scripts (news-script.mjs / make-avatar.mjs / publish.mjs)
 * and the linked review task.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { videoProjectDir } from "./factory";
import { classifyReply, decisionReply, reviewPrompt, type ReviewDecision } from "./review";
import { saveDraft, getDraft, updateDraft, type VideoDraft, type VideoDraftPaths } from "./draft-store";

const execFileP = promisify(execFile);
const RENDER_TIMEOUT_MS = 900_000; // HeyGen render + upload can take minutes

function outPaths(dir: string, date: Date): VideoDraftPaths {
  const stamp = date.toISOString().slice(0, 10);
  const base = join(dir, "out", `ai-news-${stamp}`);
  return {
    script: `${base}-script.txt`,
    title: `${base}-title.txt`,
    description: `${base}-description.txt`,
    tags: `${base}-tags.txt`,
    headlines: `${base}-headlines.json`,
    video: `${base}-avatar.mp4`,
  };
}

async function runNode(dir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileP(process.execPath, args, {
    cwd: dir,
    timeout: RENDER_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  });
}

async function closeTask(taskId: string | undefined, status: string): Promise<void> {
  if (!taskId) return;
  try {
    const { Task } = await import("@/lib/db");
    await Task.findByIdAndUpdate(taskId, { status, reviewState: null });
  } catch { /* task is a nicety; the draft is the source of truth */ }
}
async function setTaskPrompt(taskId: string | undefined, prompt: string): Promise<void> {
  if (!taskId) return;
  try {
    const { Task } = await import("@/lib/db");
    await Task.findByIdAndUpdate(taskId, { description: prompt });
  } catch { /* ignore */ }
}

export interface DraftNewsOptions {
  date?: Date;
  privacy?: string;   // youtube privacy on publish (default unlisted)
  source?: string;    // news source (default auto)
  writer?: string;    // script writer (default auto)
}

/** Phase 1 — draft the AI-news script and create a review checkpoint. */
export async function draftNewsVideo(opts: DraftNewsOptions = {}): Promise<VideoDraft> {
  const dir = videoProjectDir();
  if (!dir) throw new Error("video project not found (set HIVE_VIDEO_DIR)");
  const date = opts.date ?? new Date();
  const paths = outPaths(dir, date);
  mkdirSync(join(dir, "out"), { recursive: true });

  await runNode(dir, [
    "news-script.mjs",
    "--script-out", paths.script,
    "--title-out", paths.title,
    "--description-out", paths.description,
    "--tags-out", paths.tags,
    "--headlines-out", paths.headlines as string,
    "--source", opts.source ?? "auto",
    "--writer", opts.writer ?? "auto",
    "--date", date.toISOString(),
  ]);

  const script = existsSync(paths.script) ? readFileSync(paths.script, "utf-8").trim() : "";
  const title = existsSync(paths.title) ? readFileSync(paths.title, "utf-8").trim() : "AI News";

  const { generateId, Task } = await import("@/lib/db");
  const id = generateId();
  let taskId: string | undefined;
  try {
    const task = await Task.create({
      _id: generateId(),
      title: `Review video script: ${title}`,
      description: reviewPrompt(script),
      project: "hivematrix",
      projectPath: homedir(),
      status: "review",
      reviewState: "needs_input",
      executor: "video-review", // not an agent task — the scheduler won't run it
      source: "video",
      output: { videoDraftId: id },
    });
    taskId = (task as { _id?: string })._id;
  } catch { /* the draft still works via /video/drafts even if the task fails */ }

  return saveDraft({
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "review",
    kind: "ai-news",
    privacy: opts.privacy ?? "unlisted",
    title,
    paths,
    taskId,
    revisions: 0,
  });
}

/**
 * Phase 2 — apply the operator's reply to a drafted script. Returns the spoken/text
 * confirmation, or null if the draft isn't awaiting review. Approve/edit kick off the
 * render+publish in the background (the spend step); regenerate re-drafts and stays in
 * review; cancel spends nothing.
 */
export async function resolveVideoDraft(id: string, reply: string): Promise<{ decision: ReviewDecision; reply: string } | null> {
  const draft = getDraft(id);
  if (!draft || draft.status !== "review") return null;
  const decision = classifyReply(reply);

  if (decision.action === "cancel") {
    updateDraft(id, { status: "cancelled" });
    await closeTask(draft.taskId, "cancelled");
    return { decision, reply: decisionReply(decision, draft.title) };
  }

  if (decision.action === "regenerate") {
    const dir = videoProjectDir();
    if (!dir) throw new Error("video project not found");
    await runNode(dir, [
      "news-script.mjs",
      "--script-out", draft.paths.script,
      "--title-out", draft.paths.title,
      "--description-out", draft.paths.description,
      "--tags-out", draft.paths.tags,
      "--headlines-out", draft.paths.headlines ?? join(dir, "out", "headlines.json"),
      "--brief", decision.feedback ?? "",
    ]);
    const title = existsSync(draft.paths.title) ? readFileSync(draft.paths.title, "utf-8").trim() : draft.title;
    const newScript = existsSync(draft.paths.script) ? readFileSync(draft.paths.script, "utf-8").trim() : "";
    updateDraft(id, { revisions: draft.revisions + 1, title });
    await setTaskPrompt(draft.taskId, reviewPrompt(newScript));
    return { decision, reply: decisionReply(decision, title) };
  }

  // approve or edit → render + publish (gated spend), in the background.
  if (decision.action === "edit" && decision.script) writeFileSync(draft.paths.script, decision.script);
  updateDraft(id, { status: "rendering" });
  await closeTask(draft.taskId, "done");
  void renderAndPublish(id).catch((e) => {
    updateDraft(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  });
  return { decision, reply: decisionReply(decision, draft.title) };
}

async function renderAndPublish(id: string): Promise<void> {
  const draft = getDraft(id);
  if (!draft) return;
  const dir = videoProjectDir();
  if (!dir) throw new Error("video project not found");
  // Render the approved script to an avatar MP4 (HeyGen, ~$0.05/sec).
  await runNode(dir, ["make-avatar.mjs", draft.paths.script, draft.paths.video]);
  // Publish to YouTube and capture the URL from stdout.
  const { stdout } = await runNode(dir, [
    "publish.mjs", draft.paths.video,
    "--title-file", draft.paths.title,
    "--description-file", draft.paths.description,
    "--tags-file", draft.paths.tags,
    "--privacy", draft.privacy,
    "--kind", "avatar",
  ]);
  const m = stdout.match(/https?:\/\/(?:youtu\.be|www\.youtube\.com)\/\S+/);
  updateDraft(id, { status: "published", youtubeUrl: m ? m[0] : undefined });
}
