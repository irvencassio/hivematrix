import { createAgentBrowserAdapter } from "@/lib/browser-lane/adapters/agent-browser";
import type { BrowserLaneAdapter } from "./adapter";
import { runBrowserReadinessProbe } from "./readiness";
import {
  completeBrowserTraceRun,
  createBrowserTraceRun,
  listBrowserSites,
  listEnabledReadinessProbes,
  recordBrowserReadinessRun,
  recordBrowserTraceEvent,
} from "./store";
import type { BrowserReadinessColor, BrowserReadinessStatus } from "./contracts";

export interface BrowserLaneProbeRunSummary {
  siteId: string;
  probeId: string;
  status: BrowserReadinessStatus;
  color: BrowserReadinessColor;
  traceRunId: string;
  failedAssertions: string[];
  humanRequired?: string;
  error?: string;
}

export interface BrowserLaneProbeServiceResult {
  ok: boolean;
  lane: "browser";
  siteId: string;
  backendReady: boolean;
  runs: BrowserLaneProbeRunSummary[];
  error?: string;
}

export interface BrowserLaneProbeServiceInput {
  siteId?: string;
  adapter?: BrowserLaneAdapter;
}

export async function runBrowserLaneReadiness(input: BrowserLaneProbeServiceInput = {}): Promise<BrowserLaneProbeServiceResult> {
  const siteId = input.siteId?.trim() || "all";
  const adapter = input.adapter ?? createAgentBrowserAdapter();
  const sites = listBrowserSites({ siteId });

  if (sites.length === 0) {
    return {
      ok: false,
      lane: "browser",
      siteId,
      backendReady: input.adapter != null,
      runs: [],
      error: siteId === "all"
        ? "No Browser Lane sites are configured."
        : `No Browser Lane site is configured for "${siteId}".`,
    };
  }

  const runs: BrowserLaneProbeRunSummary[] = [];

  for (const site of sites) {
    const probes = listEnabledReadinessProbes(site.id);
    for (const probe of probes) {
      const traceRunId = createBrowserTraceRun({ siteId: site.id, workflowId: probe.id, metadata: { source: "browser-lane.probe" } });
      const result = await runBrowserReadinessProbe({
        site,
        probe,
        adapter,
        trace: {
          record(event) {
            recordBrowserTraceEvent({
              traceRunId,
              event: event.eventType,
              payload: {
                siteId: event.siteId,
                probeId: event.probeId,
                message: event.message,
                data: event.data ?? {},
              },
            });
          },
        },
      });

      completeBrowserTraceRun(traceRunId, result.state.status === "ready" ? "done" : "failed", {
        status: result.state.status,
        error: result.error ?? null,
      });
      recordBrowserReadinessRun({
        siteId: site.id,
        probeId: probe.id,
        status: result.state.status,
        color: result.state.color,
        summary: result.error ?? result.state.label,
        traceRunId,
        metadata: {
          failedAssertions: result.failedAssertions.map((assertion) => assertion.value),
          humanRequired: result.humanRequired ?? null,
        },
      });

      runs.push({
        siteId: site.id,
        probeId: probe.id,
        status: result.state.status,
        color: result.state.color,
        traceRunId,
        failedAssertions: result.failedAssertions.map((assertion) => assertion.value),
        ...(result.humanRequired ? { humanRequired: result.humanRequired } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
    }
  }

  return {
    ok: true,
    lane: "browser",
    siteId,
    // A real backend is now wired (agent_browser read-only MVP) whether or not a
    // custom adapter was injected.
    backendReady: true,
    runs,
  };
}
