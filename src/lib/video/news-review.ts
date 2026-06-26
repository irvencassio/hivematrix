/**
 * AI-news video with a human-in-the-loop SCRIPT REVIEW, wired into the HiveMatrix
 * flow. Phase 1 drafts the script (cheap) and pauses as a `needs_input` review task;
 * the operator's Reply (console / iOS / voice) drives approve / edit / regenerate /
 * cancel via the pure classifier in review.ts. Approval creates a Browser Lane
 * HeyGen portal child task; publishing happens later only after a local portal MP4
 * is handed back.
 *
 * The decision logic is the tested core (review.ts); this is the IO glue that drives
 * the out-of-process `video/` scripts (news-script.mjs / publish.mjs) and the linked
 * review task.
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
const RENDER_TIMEOUT_MS = 900_000; // script generation / upload can take minutes

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

/** A portal task creation failure → return the task to review with the reason, so
 * the operator can fix Browser Lane readiness/auth and approve again, or cancel. */
async function failPortalReviewTask(taskId: string | undefined, errorMsg: string): Promise<void> {
  const concise = `Browser Lane portal task not created: ${errorMsg.replace(/\s+/g, " ").slice(0, 260)}`;
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

export interface CreatePortalTaskInput {
  draft: VideoDraft;
  script: string;
  title: string;
}

export interface CreatePortalTaskResult {
  status: string;
  taskId?: string | null;
  reason?: string | null;
}

export interface ResolveVideoDraftDeps {
  createPortalTask?: (input: CreatePortalTaskInput) => Promise<CreatePortalTaskResult>;
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
 * confirmation, or null if the draft isn't awaiting review. Approve creates the
 * Browser Lane HeyGen portal child task; regenerate re-drafts and stays in review;
 * cancel spends nothing.
 */
export async function resolveVideoDraft(id: string, reply: string, deps: ResolveVideoDraftDeps = {}): Promise<{ decision: ReviewDecision; reply: string } | null> {
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

  // edit → SAVE the revised script and stay in review. The operator re-reads it
  // and approves separately.
  if (decision.action === "edit" && decision.script) {
    writeFileSync(draft.paths.script, decision.script);
    updateDraft(id, { revisions: draft.revisions + 1 });
    await refreshReviewTask(draft.taskId, decision.script);
    return { decision, reply: decisionReply(decision, draft.title) };
  }

  // approve → create the Browser Lane HeyGen portal child task. No API renderer is
  // called here; the parent remains visible while the child handles portal work.
  const script = existsSync(draft.paths.script) ? readFileSync(draft.paths.script, "utf-8").trim() : "";
  const title = existsSync(draft.paths.title) ? readFileSync(draft.paths.title, "utf-8").trim() : draft.title;
  const createPortalTask = deps.createPortalTask ?? createHeyGenPortalTaskForDraft;
  const portal = await createPortalTask({ draft, script, title });
  if ((portal.status === "created" || portal.status === "portal_pending") && portal.taskId) {
    const { markPortalTaskCreated } = await import("./portal-completion");
    const { Task } = await import("@/lib/db");
    await markPortalTaskCreated(id, portal.taskId, {
      updateTask: async (taskId, fields) => { await Task.findByIdAndUpdate(taskId, fields); },
    });
    return { decision, reply: `Approved — created Browser Lane HeyGen portal task ${portal.taskId} for "${title}".` };
  }

  const reason = portal.reason || `portal dispatch returned ${portal.status}`;
  updateDraft(id, { status: "review", error: reason });
  await failPortalReviewTask(draft.taskId, reason);
  return { decision, reply: `Approved, but Browser Lane needs attention before it can create the HeyGen portal task: ${reason}` };
}

async function createHeyGenPortalTaskForDraft(input: CreatePortalTaskInput): Promise<CreatePortalTaskResult> {
  const { draft, script, title } = input;
  if (!script.trim()) return { status: "needs_input", taskId: null, reason: "draft has no script text" };

  const { dispatchHeyGenVideoWorkflow } = await import("./heygen-workflow");
  const { seedHeyGenBrowserSite } = await import("@/lib/browser-lane/heygen");
  const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
  const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
  const { Task } = await import("@/lib/db");

  seedHeyGenBrowserSite();
  const result = await dispatchHeyGenVideoWorkflow(
    { script, title, project: "hivematrix" },
    {
      create: true,
      projectPath: homedir(),
      browserAvailable: getConnectivityPolicy().getCapability("browserbee").available,
      staleAfterHours: getBrowserLaneReadinessConfig().staleAfterHours,
      persistTask: async ({ envelope, projectPath: root, route }) => {
        const { buildBrowserBeeTaskDescription } = await import("@/lib/browser-lane/jobs");
        const description = buildBrowserBeeTaskDescription(envelope, { requestedProjectPath: root });
        const task = await Task.create({
          title: envelope.title,
          description,
          project: envelope.project,
          projectPath: root,
          model: envelope.backingModel,
          status: "backlog",
          executor: "agent",
          source: "browser-lane",
          output: {
            browserbeeRequest: envelope,
            coo: { ruleId: route.ruleId, capability: route.capability },
            heygen: { title, parentDraftId: draft.id },
          },
        });
        return { id: task._id };
      },
    },
  );

  try {
    const { linkHeyGenPortalRunOnDispatch } = await import("@/lib/workflows/heygen-run-link");
    linkHeyGenPortalRunOnDispatch(result, { draftId: draft.id, title });
  } catch { /* the draft + child task remain the source of truth */ }

  return { status: result.status, taskId: result.taskId, reason: result.reason };
}

/**
 * Shared publish step (no render): upload an already-rendered local MP4 to YouTube
 * via publish.mjs and return the captured URL. Used by the portal publish-only path.
 */
async function runPublish(run: (args: string[]) => Promise<{ stdout: string }>, draft: VideoDraft): Promise<string | undefined> {
  const { stdout } = await run([
    "publish.mjs", draft.paths.video,
    "--title-file", draft.paths.title,
    "--description-file", draft.paths.description,
    "--tags-file", draft.paths.tags,
    "--privacy", draft.privacy,
    "--kind", "avatar",
  ]);
  const m = stdout.match(/https?:\/\/(?:youtu\.be|www\.youtube\.com)\/\S+/);
  return m ? m[0] : undefined;
}

export interface PublishDraftDeps {
  /** Run a `video/` script (default: out-of-process via the video project dir). */
  runVideoScript?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  /** Check a local file exists (default: fs.existsSync). */
  fileExists?: (path: string) => boolean;
}

export interface PublishDraftResult {
  ok: boolean;
  published: boolean;
  draftId: string;
  youtubeUrl?: string;
  alreadyPublished?: boolean;
  reason?: string;
  code?: "no_draft" | "needs_publish_input" | "not_publishable" | "missing_video" | "no_project";
}

/**
 * Publish-only path for a HeyGen portal-completed draft: upload its existing local
 * MP4 to YouTube WITHOUT re-rendering through the HeyGen API. Never calls
 * make-avatar.mjs. Idempotent for an already-published draft; refuses
 * needs_publish_input (no local file) and anything not portal_completed.
 */
export async function publishDraftVideo(id: string, deps: PublishDraftDeps = {}): Promise<PublishDraftResult> {
  const draft = getDraft(id);
  if (!draft) return { ok: false, published: false, draftId: id, code: "no_draft", reason: "no video draft found" };

  // Idempotent: already published → return the existing URL, no re-upload.
  if (draft.status === "published" && draft.youtubeUrl) {
    return { ok: true, published: true, alreadyPublished: true, draftId: id, youtubeUrl: draft.youtubeUrl };
  }
  if (draft.status === "needs_publish_input") {
    return { ok: false, published: false, draftId: id, code: "needs_publish_input", reason: "This draft completed in the HeyGen portal with only a URL / manual note — there is no local file to publish. Provide a local video, or publish manually." };
  }
  if (draft.status !== "portal_completed") {
    return { ok: false, published: false, draftId: id, code: "not_publishable", reason: `Draft is "${draft.status}", not portal_completed — nothing to publish-only.` };
  }

  const fileExists = deps.fileExists ?? existsSync;
  if (!fileExists(draft.paths.video)) {
    return { ok: false, published: false, draftId: id, code: "missing_video", reason: `The portal video file is missing: ${draft.paths.video}` };
  }

  // When a runner is injected (tests), the real project dir isn't needed.
  let run = deps.runVideoScript;
  if (!run) {
    const dir = videoProjectDir();
    if (!dir) return { ok: false, published: false, draftId: id, code: "no_project", reason: "video project not found (set HIVE_VIDEO_DIR)" };
    run = (args) => runNode(dir, args);
  }

  const youtubeUrl = await runPublish(run, draft);
  updateDraft(id, { status: "published", youtubeUrl });
  return { ok: true, published: true, draftId: id, youtubeUrl };
}
