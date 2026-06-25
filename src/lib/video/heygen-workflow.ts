/**
 * HeyGen video workflow dispatch — the model/operator surface that turns a script
 * into a HeyGen Browser Lane task, routed through COO dispatch so routing, audit,
 * readiness, and execution-availability gates stay centralized.
 *
 * The COO work item is used only for the readiness/route match (HeyGen domains →
 * Browser Lane). When a task is actually created, it is built from the RICH HeyGen
 * envelope (with the manual handoff steps), not the generic COO work item — but the
 * readiness/exec gates run first, so a stale / needs_reauth / orange / gray HeyGen
 * site yields readiness_required and never creates a task.
 */

import { buildHeyGenVideoJob, HEYGEN_SITE, type HeyGenVideoInput } from "@/lib/browser-lane/heygen";
import { buildBrowserBeeTaskRequestEnvelope, type BrowserBeeJobCreatePayload, type BrowserBeeTaskRequestEnvelope } from "@/lib/browser-lane/jobs";
import { dispatchCooRequest, dispatchCooTask, type CooDispatchResult } from "@/lib/coo/dispatch";
import type { CooResolvedRouteWithDisplay } from "@/lib/coo/store";

export interface HeyGenPersistTaskInput {
  envelope: BrowserBeeTaskRequestEnvelope;
  projectPath: string;
  route: CooResolvedRouteWithDisplay;
  job: BrowserBeeJobCreatePayload;
}

export interface HeyGenWorkflowOptions {
  create?: boolean;
  projectPath?: string | null;
  browserAvailable?: boolean;
  staleAfterHours?: number;
  /** Required when create=true. Persists the rich HeyGen task and returns its id. */
  persistTask?: (input: HeyGenPersistTaskInput) => Promise<{ id: string }>;
}

export interface HeyGenWorkflowResult extends CooDispatchResult {
  job: BrowserBeeJobCreatePayload;
}

export async function dispatchHeyGenVideoWorkflow(
  input: HeyGenVideoInput,
  options: HeyGenWorkflowOptions = {},
): Promise<HeyGenWorkflowResult> {
  const job = buildHeyGenVideoJob(input);
  // Route on the objective + HeyGen domain; the audit carries the objective, never
  // the raw script body (which lives in the job notes).
  const request = { text: job.objective, domains: [HEYGEN_SITE.allowedDomains[0]], project: input.project ?? null };

  if (!options.create) {
    const result = dispatchCooRequest(request, { staleAfterHours: options.staleAfterHours });
    return { ...result, job };
  }

  const persistTask = options.persistTask;
  if (!persistTask) throw new Error("persistTask is required to create a HeyGen video task");

  const result = await dispatchCooTask(request, {
    create: true,
    projectPath: options.projectPath ?? null,
    browserAvailable: options.browserAvailable,
    staleAfterHours: options.staleAfterHours,
    // Readiness/exec gates run before this; it only fires when creation is allowed.
    createTask: async ({ projectPath: root, route }) => {
      const envelope = buildBrowserBeeTaskRequestEnvelope(job, root);
      return persistTask({ envelope, projectPath: root, route, job });
    },
  });
  return { ...result, job };
}
