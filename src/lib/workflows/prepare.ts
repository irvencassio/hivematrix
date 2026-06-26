/**
 * Generic workflow prepare dispatcher.
 *
 * One place that turns a workflow id + inputs into a prepared run, dispatched by the
 * workflow's `handler` marker. Both the `/workflows/:id/prepare` endpoint and action
 * execution use this — there is no per-target bespoke path. Required inputs are checked
 * generically from the def's inputSchema (exact missing field names, no guessing).
 */

import { getWorkflowRegistry, summarizeWorkflow, type WorkflowSummary } from "./registry";

export interface PrepareWorkflowResult {
  ok: boolean;
  status: "prepared" | "needs_input" | "unsupported";
  workflow: WorkflowSummary | null;
  runId?: string;
  missing?: string[];
  result?: unknown;
  reason?: string;
}

function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export async function prepareWorkflowById(workflowId: string, inputs: Record<string, unknown>): Promise<PrepareWorkflowResult> {
  const def = getWorkflowRegistry().get(workflowId);
  if (!def) return { ok: false, status: "unsupported", workflow: null, reason: `unknown workflow "${workflowId}"` };
  const workflow = summarizeWorkflow(def);

  const missing = def.inputSchema.filter((f) => f.required && !hasValue(inputs[f.name])).map((f) => f.name);
  if (missing.length) return { ok: false, status: "needs_input", workflow, missing };

  switch (def.handler) {
    case "content-research-brief": {
      const { prepareContentResearchBrief } = await import("./content-research");
      const out = await prepareContentResearchBrief({
        topic: String(inputs.topic ?? ""),
        audience: typeof inputs.audience === "string" ? inputs.audience : undefined,
        objective: typeof inputs.objective === "string" ? inputs.objective : undefined,
        sources: Array.isArray(inputs.sources) ? inputs.sources.filter((s): s is string => typeof s === "string") : undefined,
      });
      return { ok: true, status: "prepared", workflow, runId: out.runId, result: { markdown: out.markdown, proposedAction: out.proposedAction } };
    }
    case "content-video-script": {
      const { prepareVideoScriptFromBrief } = await import("./video-script");
      try {
        const out = await prepareVideoScriptFromBrief({
          topic: String(inputs.topic ?? ""),
          audience: typeof inputs.audience === "string" ? inputs.audience : undefined,
          objective: typeof inputs.objective === "string" ? inputs.objective : undefined,
          briefMarkdown: typeof inputs.briefMarkdown === "string" ? inputs.briefMarkdown : undefined,
          sourceRunId: typeof inputs.sourceRunId === "string" ? inputs.sourceRunId : undefined,
          tone: typeof inputs.tone === "string" ? inputs.tone : undefined,
          duration: typeof inputs.duration === "string" ? inputs.duration : undefined,
        });
        return { ok: true, status: "prepared", workflow, runId: out.runId, result: { markdown: out.markdown, isDraft: out.isDraft, proposedAction: out.proposedAction } };
      } catch (e) {
        // Missing brief source → needs_input on the brief inputs (no guessing).
        return { ok: false, status: "needs_input", workflow, missing: ["briefMarkdown", "sourceRunId"], reason: e instanceof Error ? e.message : String(e) };
      }
    }
    case "heygen-portal-video": {
      const { dispatchHeyGenVideoWorkflow } = await import("@/lib/video/heygen-workflow");
      const { getBrowserLaneReadinessConfig } = await import("@/lib/browser-lane/readiness-schedule");
      const { seedHeyGenBrowserSite } = await import("@/lib/browser-lane/heygen");
      seedHeyGenBrowserSite();
      const result = await dispatchHeyGenVideoWorkflow(
        { script: String(inputs.script ?? ""), title: String(inputs.title ?? ""), creativeNotes: typeof inputs.creativeNotes === "string" ? inputs.creativeNotes : undefined },
        { staleAfterHours: getBrowserLaneReadinessConfig().staleAfterHours },
      );
      return { ok: true, status: "prepared", workflow, result };
    }
    case "content-youtube-summary": {
      const { prepareYoutubeSummary } = await import("./youtube-summary");
      const out = await prepareYoutubeSummary({
        url: typeof inputs.url === "string" ? inputs.url : "",
        title: typeof inputs.title === "string" ? inputs.title : undefined,
      });
      if (!out.ok) {
        return { ok: false, status: out.status, workflow, missing: out.missing, reason: out.reason };
      }
      return {
        ok: true,
        status: "prepared",
        workflow,
        runId: out.runId,
        result: { markdown: out.markdown, transcriptUsed: out.transcriptUsed, videoId: out.videoId },
      };
    }
    default:
      return { ok: false, status: "unsupported", workflow, reason: `no prepare handler for "${def.handler}"` };
  }
}
