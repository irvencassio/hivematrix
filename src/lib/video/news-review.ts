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

function outPaths(dir: string, date: Date, id: string): VideoDraftPaths {
  const stamp = date.toISOString().slice(0, 10);
  // Key the file base on the draft id too — two drafts on the same day must NOT
  // share files, or a second draft would clobber the first's script/video.
  const base = join(dir, "out", `ai-news-${stamp}-${id}`);
  return {
    script: `${base}-script.txt`,
    title: `${base}-title.txt`,
    description: `${base}-description.txt`,
    tags: `${base}-tags.txt`,
    headlines: `${base}-headlines.json`,
    video: `${base}-avatar.mp4`,
  };
}

async function runNode(dir: string, args: string[], extraEnv: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  return execFileP(process.execPath, args, {
    cwd: dir,
    timeout: RENDER_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...extraEnv },
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
async function setTaskFields(taskId: string | undefined, fields: Record<string, unknown>): Promise<void> {
  if (!taskId) return;
  try {
    const { Task } = await import("@/lib/db");
    await Task.findByIdAndUpdate(taskId, fields);
  } catch { /* ignore */ }
}

/** A render/publish that failed → return the task to review with the reason, so the
 * operator can fix it (e.g. add HeyGen credit) and approve again, or cancel. */
async function failReviewTask(taskId: string | undefined, errorMsg: string): Promise<void> {
  const concise = /insufficient credit/i.test(errorMsg)
    ? "Render failed: HeyGen is out of API credit. Add credit, then approve again — or cancel."
    : `Render failed: ${errorMsg.replace(/\s+/g, " ").slice(0, 280)}`;
  await setTaskFields(taskId, { status: "review", reviewState: "needs_input", error: concise });
}

/** Re-show a review task with an updated script: refresh the prompt AND the
 * editable copy (output.reviewScript, which the console's "Edit the draft" loads),
 * keeping it open for review. Used after an edit/rework so nothing renders yet. */
async function refreshReviewTask(taskId: string | undefined, script: string): Promise<void> {
  if (!taskId) return;
  try {
    const { Task } = await import("@/lib/db");
    const t = await Task.findById(taskId);
    const out = (t && typeof (t as { output?: unknown }).output === "object" && (t as { output?: Record<string, unknown> }).output) || {};
    await Task.findByIdAndUpdate(taskId, {
      description: reviewPrompt(script),
      output: { ...out, reviewScript: script },
      status: "review",
      reviewState: "needs_input",
    });
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
  const { generateId, Task } = await import("@/lib/db");
  const id = generateId();
  const paths = outPaths(dir, date, id);
  mkdirSync(join(dir, "out"), { recursive: true });

  // Pick the writer per the writer-role setting. Frontier (Claude) when chosen +
  // online (news-script's auto path uses an Anthropic key if present, else local);
  // a local pick or offline → the daemon's local model. Always feed HIVE_LLM_* so
  // the local path/fallback works.
  const { voiceLlmEnv } = await import("@/lib/voice/llm-env");
  let writerArgs: string[];
  if (opts.writer) {
    writerArgs = ["--writer", opts.writer]; // explicit override (e.g. a directive)
  } else {
    const { resolveWriterModel } = await import("@/lib/models/writer-role");
    const w = resolveWriterModel();
    writerArgs = w.provider === "anthropic" && w.modelId
      ? ["--writer", "auto", "--model", w.modelId]
      : ["--writer", "local"];
  }
  await runNode(dir, [
    "news-script.mjs",
    "--script-out", paths.script,
    "--title-out", paths.title,
    "--description-out", paths.description,
    "--tags-out", paths.tags,
    "--headlines-out", paths.headlines as string,
    "--source", opts.source ?? "auto",
    ...writerArgs,
    "--date", date.toISOString(),
  ], voiceLlmEnv());

  const script = existsSync(paths.script) ? readFileSync(paths.script, "utf-8").trim() : "";
  const title = existsSync(paths.title) ? readFileSync(paths.title, "utf-8").trim() : "AI News";

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
      // reviewScript = the clean script (the console's "Edit the draft" loads this
      // into the reply box so the operator edits in place, no copy-paste).
      output: { videoDraftId: id, reviewScript: script },
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
    await refreshReviewTask(draft.taskId, newScript); // stays in review with the new draft
    return { decision, reply: decisionReply(decision, title) };
  }

  // edit → SAVE the revised script and stay in review (no render/publish yet, no
  // spend). The operator re-reads it and approves separately. This is the key fix:
  // editing used to immediately render+publish, which surprised + spent money.
  if (decision.action === "edit" && decision.script) {
    writeFileSync(draft.paths.script, decision.script);
    updateDraft(id, { revisions: draft.revisions + 1 });
    await refreshReviewTask(draft.taskId, decision.script);
    return { decision, reply: decisionReply(decision, draft.title) };
  }

  // approve → render + publish (the gated spend). Keep the task VISIBLE while it
  // renders and reflect the outcome — don't optimistically close to done, or a
  // failed render (e.g. HeyGen out of credit) vanishes with no feedback.
  updateDraft(id, { status: "rendering" });
  await setTaskFields(draft.taskId, { status: "in_progress", reviewState: null });
  void renderAndPublish(id)
    .then(async () => { await closeTask(draft.taskId, "done"); })
    .catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      updateDraft(id, { status: "error", error: msg });
      await failReviewTask(draft.taskId, msg); // back to review with the error surfaced
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
