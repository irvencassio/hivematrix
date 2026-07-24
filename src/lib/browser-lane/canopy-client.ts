/**
 * Canopy Browser client — HiveMatrix's integration path to the standalone
 * Canopy Browser app (T6 cutover).
 *
 * Canopy Browser is a real WebKit browser that owns its own signed-in sessions,
 * its own site policy (scoping, accessMode, domain ownership) and its own audit
 * trail. HiveMatrix talks to it over LOOPBACK HTTP — deliberately NOT MCP:
 * HiveMatrix carries no MCP client and does not need one, exactly as the app's
 * own `docs/automation-api.md` ("For HiveMatrix (T6)") specifies.
 *
 * Modelled on `read-client.ts` (the `POST /answer` read path) — same shape:
 * a base-URL resolver, a typed result, and a thin `fetch` wrapper that returns
 * the raw `Response` so the caller decides how to surface failures.
 *
 * POLICY IS NOT DUPLICATED HERE. The app is the single enforcement point; a
 * refusal comes back as `refusal` and its `message` is surfaced VERBATIM.
 */

import { readHiveConfig } from "@/lib/brain/settings";

const DEFAULT_CANOPY_BROWSER_BASE_URL = "http://127.0.0.1:4021";

/** The step vocabulary `POST /act` accepts. */
export type CanopyActAction = "navigate" | "click" | "type" | "extract" | "waitFor";

export const CANOPY_ACT_ACTIONS: readonly CanopyActAction[] = [
  "navigate",
  "click",
  "type",
  "extract",
  "waitFor",
] as const;

export interface CanopyActStep {
  action: CanopyActAction;
  url?: string;
  selector?: string;
  text?: string;
  timeoutMs?: number;
}

export interface CanopyActLink {
  title: string;
  url: string;
}

export interface CanopyActPage {
  url: string;
  title: string;
  text: string;
  links: CanopyActLink[];
}

export interface CanopyActStepResult {
  index: number;
  action: string;
  ok: boolean;
  detail: string;
  page?: CanopyActPage | null;
}

/**
 * The app refused the run before any step executed (read-only site, out of
 * scope). `message` is the app's own operator-facing wording — surface it
 * verbatim, never paraphrase it, and never second-guess the decision.
 */
export interface CanopyActRefusal {
  code: string;
  siteId: string | null;
  siteName: string | null;
  message: string;
}

/**
 * The run hit a sign-in wall. `finalPage` is null in this case — the app never
 * returns a logged-out page as the answer. Credentials are always a human
 * click in the app; nothing here can trigger a fill.
 */
export interface CanopyHumanLoginRequired {
  code: string;
  siteId: string | null;
  siteName: string | null;
  url: string | null;
  hasSavedCredential: boolean;
  message: string;
}

export interface CanopyActResult {
  ok: boolean;
  failedStep: number | null;
  steps: CanopyActStepResult[];
  finalPage: CanopyActPage | null;
  refusal: CanopyActRefusal | null;
  humanLoginRequired: CanopyHumanLoginRequired | null;
}

export interface CanopyActRequest {
  /**
   * The policy verb the app classifies read-vs-write. Browser Lane's `jobType`
   * values (`authenticated_research` / `capture` / `triage` = read,
   * `form_fill` / `site_ops` = write) are recognised verbatim by the app's
   * PolicyEngine, so they are passed straight through. An action the app does
   * not recognise fails CLOSED (treated as a write) — omitting it is safe, not
   * a bypass.
   */
  action: string;
  /** Who is asking. Recorded on the app's audit record. */
  requester: string;
  steps: CanopyActStep[];
  /** Transport timeout. Defaults to a generous 120s: a run may load several pages. */
  timeoutMs?: number;
}

export function resolveCanopyBrowserBaseUrl(): string {
  const configured = process.env.CANOPY_BROWSER_BASE_URL?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_CANOPY_BROWSER_BASE_URL).replace(/\/$/, "");
}

/**
 * POST the run to the app. Returns the raw Response (like `requestBrowserLaneRead`)
 * so the caller can distinguish transport failure from a policy refusal, which
 * the app reports as a normal 200 with `refusal` set.
 */
export async function requestCanopyBrowserAct(request: CanopyActRequest): Promise<Response> {
  return fetch(`${resolveCanopyBrowserBaseUrl()}/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(request.timeoutMs ?? 120_000),
    body: JSON.stringify({
      action: request.action,
      requester: request.requester,
      steps: request.steps,
    }),
  });
}

// ------------------------------------------------------------------
// Engine selection (T6 step 2/6)
// ------------------------------------------------------------------

/**
 * Which engine drives Browser Lane's open/snapshot/workflow modes.
 *   "canopy"  — the standalone Canopy Browser app over loopback HTTP (default).
 *   "desktop" — the pre-T6 path: dispatch a task to a generic agent that drives
 *               Chrome/Safari through Desktop Lane (`executeBrowserBeeRun`).
 *
 * Kept as a single config flag so the cutover rolls back with one edit to
 * `~/.hivematrix/config.json`:  {"browserLane": {"engine": "desktop"}}.
 */
export type BrowserLaneEngine = "desktop" | "canopy";

/**
 * T6 lands the flag defaulted to "desktop" so the cutover is opt-in first; the
 * final step of T6 flips it to "canopy".
 */
export const DEFAULT_BROWSER_LANE_ENGINE: BrowserLaneEngine = "desktop";

export function resolveBrowserLaneEngine(config?: Record<string, unknown>): BrowserLaneEngine {
  const cfg = config ?? readHiveConfig();
  const lane = cfg.browserLane;
  const raw = lane && typeof lane === "object" && !Array.isArray(lane)
    ? (lane as Record<string, unknown>).engine
    : undefined;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "desktop" || value === "canopy") return value;
  return DEFAULT_BROWSER_LANE_ENGINE;
}

// ------------------------------------------------------------------
// Step building + result rendering
// ------------------------------------------------------------------

export interface CanopyActStepPlan {
  steps: CanopyActStep[];
  /**
   * Natural-language steps the caller supplied that `/act` cannot execute (it
   * takes selectors, not prose). Reported honestly rather than silently dropped.
   */
  unexecutable: string[];
}

function normalizeStructuredStep(raw: Record<string, unknown>): CanopyActStep | null {
  const action = typeof raw.action === "string" ? raw.action.trim() : "";
  const normalized = action === "wait_for" || action === "waitfor" ? "waitFor" : action;
  if (!(CANOPY_ACT_ACTIONS as readonly string[]).includes(normalized)) return null;
  const step: CanopyActStep = { action: normalized as CanopyActAction };
  if (typeof raw.url === "string" && raw.url.trim()) step.url = raw.url.trim();
  if (typeof raw.selector === "string" && raw.selector.trim()) step.selector = raw.selector.trim();
  if (typeof raw.text === "string") step.text = raw.text;
  if (typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)) step.timeoutMs = raw.timeoutMs;
  return step;
}

/**
 * Turn a Browser Lane request into an ordered `/act` step list.
 *
 * Structured steps (objects carrying an `action`) are passed through — that is
 * the real multi-step path. Browser Lane's own `steps` field is `string[]` of
 * prose, which `/act` cannot drive: those are returned in `unexecutable` so the
 * caller can say so out loud instead of pretending they ran.
 */
export function buildCanopyActSteps(input: { startUrl: string; steps?: unknown }): CanopyActStepPlan {
  const structured: CanopyActStep[] = [];
  const unexecutable: string[] = [];

  if (Array.isArray(input.steps)) {
    for (const entry of input.steps) {
      if (typeof entry === "string") {
        const text = entry.trim();
        if (text) unexecutable.push(text);
        continue;
      }
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const step = normalizeStructuredStep(entry as Record<string, unknown>);
        if (step) structured.push(step);
        else unexecutable.push(JSON.stringify(entry));
      }
    }
  }

  const steps: CanopyActStep[] = [];
  if (structured.length === 0 || structured[0].action !== "navigate") {
    steps.push({ action: "navigate", url: input.startUrl });
  }
  steps.push(...structured);
  // Always end on an extract so the run returns page content, not just "ok".
  if (steps[steps.length - 1]?.action !== "extract") {
    steps.push({ action: "extract" });
  }
  return { steps, unexecutable };
}

/** Human-readable transcript of a run — what goes in the board task's output. */
export function summarizeCanopyActResult(result: CanopyActResult): string {
  const lines = result.steps.map((s) => `${s.ok ? "✓" : "✗"} [${s.index}] ${s.action} — ${s.detail}`);
  if (result.failedStep != null) {
    lines.push(`Run stopped at step ${result.failedStep}; later steps did not execute.`);
  }
  if (result.finalPage) {
    lines.push("", `Final page: ${result.finalPage.title} — ${result.finalPage.url}`);
    if (result.finalPage.text) lines.push("", result.finalPage.text.slice(0, 8_000));
    if (result.finalPage.links?.length) {
      lines.push("", "Links:", ...result.finalPage.links.slice(0, 20).map((l) => `- ${l.title} — ${l.url}`));
    }
  }
  return lines.join("\n");
}
