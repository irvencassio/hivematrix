/**
 * Dry-run verification harness for the HeyGen portal video pipeline:
 *   draft → portal task → portal completion → publish-only.
 *
 * It exercises the REAL pipeline helpers (the ones the daemon endpoints call) but
 * with injected fakes for every external side effect, so it never touches real
 * HeyGen or YouTube. The caller isolates state (temp HOME + temp HIVEMATRIX_DB_PATH);
 * this module only reads/writes that scratch. Output is structured and secret-free.
 */

import { readFileSync } from "fs";
import { seedHeyGenBrowserSite } from "@/lib/browser-lane/heygen";
import { getBrowserLaneReadinessDashboard, recordBrowserReadinessRun } from "@/lib/browser-lane/store";
import { dispatchHeyGenVideoWorkflow } from "./heygen-workflow";
import { applyHeyGenPortalCompletion, markPortalTaskCreated } from "./portal-completion";
import { publishDraftVideo } from "./news-review";
import { getDraft, saveDraft, type VideoDraft } from "./draft-store";

export interface PortalDryRunPhase { name: string; ok: boolean; detail: string }
export interface PortalDryRunReport {
  ok: boolean;
  dryRun: true;
  phases: PortalDryRunPhase[];
  evidence: { publishArgs: string[] };
  summary: string;
}
export interface PortalDryRunDeps {
  /** Source of the daemon routes to verify wiring (default: read src/daemon/server.ts). */
  serverSource?: () => string;
}

const REQUIRED_ROUTES = ["/video/heygen-workflow", "/video/portal-complete", "/video/publish-draft", "/video/drafts"];
const PROJECT_PATH = process.env.HOME ?? process.cwd(); // scratch root the caller isolated

function draft(id: string, status: string, extra: Record<string, unknown> = {}): VideoDraft {
  return {
    id, createdAt: "2026-06-25T10:00:00Z", updatedAt: "2026-06-25T10:00:00Z",
    status, kind: "ai-news", privacy: "unlisted", title: "Dry-run launch", revisions: 0,
    paths: { script: "/tmp/dryrun-script.txt", title: "/tmp/dryrun-title.txt", description: "/tmp/dryrun-desc.txt", tags: "/tmp/dryrun-tags.txt", video: "/tmp/dryrun-final.mp4" },
    ...extra,
  } as VideoDraft;
}

export async function runHeyGenPortalDryRun(deps: PortalDryRunDeps = {}): Promise<PortalDryRunReport> {
  const phases: PortalDryRunPhase[] = [];
  const evidence = { publishArgs: [] as string[] };
  const run = async (name: string, fn: () => Promise<string>): Promise<void> => {
    try { phases.push({ name, ok: true, detail: await fn() }); }
    catch (e) { phases.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
  };

  const DRAFT_ID = "dryrun-draft";

  // 1. Seed the HeyGen site + probe + routing rule.
  await run("seed", async () => {
    const seeded = seedHeyGenBrowserSite();
    if (seeded.site.id !== "heygen") throw new Error("seed did not register the heygen site");
    return "site + readiness probe + COO routing rule registered (metadata only)";
  });

  // 2. Simulate a reviewed AI-news draft.
  await run("draft", async () => {
    saveDraft(draft(DRAFT_ID, "review"));
    if (getDraft(DRAFT_ID)?.status !== "review") throw new Error("draft did not persist");
    return "review draft created";
  });

  // 3. Readiness gate: with no readiness run, create must be held — never a task.
  await run("readiness-gate", async () => {
    const result = await dispatchHeyGenVideoWorkflow(
      { script: "One. Two. Three. A dry-run script.", title: "Dry-run launch", project: "inbox" },
      { create: true, projectPath: PROJECT_PATH, browserAvailable: true, staleAfterHours: 24, persistTask: async () => { throw new Error("a task must not be created while readiness is unmet"); } },
    );
    if (result.status !== "readiness_required") throw new Error(`expected readiness_required, got ${result.status}`);
    return "create correctly held (readiness_required) with no green readiness";
  });

  // 4. Portal task created once readiness is green + fresh; draft → portal_pending.
  await run("portal-task", async () => {
    recordBrowserReadinessRun({ siteId: "heygen", status: "ready", color: "green", summary: "dry-run ready", traceRunId: "dryrun-trace" });
    let createdId = "";
    const result = await dispatchHeyGenVideoWorkflow(
      { script: "One. Two. Three. A dry-run script.", title: "Dry-run launch", project: "inbox" },
      { create: true, projectPath: PROJECT_PATH, browserAvailable: true, staleAfterHours: 24, persistTask: async () => { createdId = "dryrun-child-1"; return { id: createdId }; } },
    );
    if (result.status !== "created") throw new Error(`expected created, got ${result.status}`);
    await markPortalTaskCreated(DRAFT_ID, createdId);
    if (getDraft(DRAFT_ID)?.status !== "portal_pending") throw new Error("draft did not move to portal_pending");
    return `portal child task ${createdId} created; draft → portal_pending`;
  });

  // 5. Portal completion with a fake local MP4 → portal_completed.
  await run("completion", async () => {
    const res = await applyHeyGenPortalCompletion(
      { parentDraftId: DRAFT_ID, childTaskId: "dryrun-child-1", localVideoPath: "/tmp/dryrun-final.mp4" },
      { fileExists: () => true },
    );
    if (res.status !== "portal_completed") throw new Error(`expected portal_completed, got ${res.status}`);
    if (getDraft(DRAFT_ID)?.paths.video !== "/tmp/dryrun-final.mp4") throw new Error("local video path not bound");
    return "completion bound the local video; draft → portal_completed";
  });

  // 6. Publish-only DRY RUN: shapes publish.mjs, records args, uploads nothing.
  await run("publish-only", async () => {
    const result = await publishDraftVideo(DRAFT_ID, {
      fileExists: () => true,
      runVideoScript: async (args) => { evidence.publishArgs = args; return { stdout: "DRY-RUN (no upload) https://youtu.be/DRYRUN", stderr: "" }; },
    });
    if (!result.ok || !result.published) throw new Error(`publish-only failed: ${result.reason ?? result.code}`);
    if (!evidence.publishArgs.includes("publish.mjs")) throw new Error("publish-only did not invoke the publish step");
    if (evidence.publishArgs.includes("make-avatar.mjs")) throw new Error("publish-only must not re-render");
    return `publish.mjs shaped (dry-run, no upload); youtubeUrl=${result.youtubeUrl ?? "—"}`;
  });

  // 7. needs_publish_input must refuse to publish (no local file).
  await run("needs-publish-refusal", async () => {
    const NID = "dryrun-needs";
    saveDraft(draft(NID, "needs_publish_input", { portalVideoUrl: "https://app.heygen.com/v/dryrun" }));
    let called = 0;
    const result = await publishDraftVideo(NID, { fileExists: () => true, runVideoScript: async () => { called += 1; return { stdout: "", stderr: "" }; } });
    if (result.ok) throw new Error("needs_publish_input must not publish");
    if (result.code !== "needs_publish_input") throw new Error(`expected needs_publish_input, got ${result.code}`);
    if (called !== 0) throw new Error("needs_publish_input must not invoke the publish script");
    return "needs_publish_input correctly refused (no local file)";
  });

  // 8. Endpoint wiring: the daemon declares all four routes.
  await run("endpoint-wiring", async () => {
    const source = (deps.serverSource ?? (() => readFileSync("src/daemon/server.ts", "utf8")))();
    const missing = REQUIRED_ROUTES.filter((r) => !source.includes(`"${r}"`));
    if (missing.length) throw new Error(`daemon is missing routes: ${missing.join(", ")}`);
    return "all portal endpoints are wired in the daemon";
  });

  const ok = phases.every((p) => p.ok);
  const passed = phases.filter((p) => p.ok).length;
  return {
    ok,
    dryRun: true,
    phases,
    evidence,
    summary: ok
      ? `HeyGen portal pipeline OK — ${passed}/${phases.length} phases passed (dry-run, no real HeyGen/YouTube side effects).`
      : `HeyGen portal pipeline FAILED — ${passed}/${phases.length} phases passed. First failure: ${phases.find((p) => !p.ok)?.name}.`,
  };
}
