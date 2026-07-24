import type { TaskDoc } from "@/lib/db";
import { ContractValidationError } from "@/lib/central/contracts";
import { buildAuthBeeSessionPlaneSummary, type AuthBeeSessionRecord } from "@/lib/session/contracts";
import { readHiveConfig } from "@/lib/brain/settings";

export const BROWSERBEE_JOB_TYPES = [
  "authenticated_research",
  "form_fill",
  "site_ops",
  "capture",
  "triage",
] as const;
export type BrowserBeeJobType = (typeof BROWSERBEE_JOB_TYPES)[number];

export const BROWSERBEE_RUN_MODES = ["isolated", "attached", "manual_escalation"] as const;
export type BrowserBeeRunMode = (typeof BROWSERBEE_RUN_MODES)[number];

export const BROWSERBEE_APPROVAL_MODES = ["auto", "confirm_external", "manual"] as const;
export type BrowserBeeApprovalMode = (typeof BROWSERBEE_APPROVAL_MODES)[number];

export const BROWSERBEE_ARTIFACT_POLICIES = ["none", "screenshots", "screenshots_and_html"] as const;
export type BrowserBeeArtifactPolicy = (typeof BROWSERBEE_ARTIFACT_POLICIES)[number];

export const BROWSERBEE_TRACE_POLICIES = ["none", "timeline", "timeline_and_screenshots"] as const;
export type BrowserBeeTracePolicy = (typeof BROWSERBEE_TRACE_POLICIES)[number];

/**
 * Which engine drives the browser for a Browser Lane job.
 *   desktop_fallback   — THE engine: Claude drives a real desktop browser via
 *     Desktop Lane (AppleScript → Accessibility → click/type). The name is
 *     historical; it is no longer a fallback to anything.
 *   codex_computer_use — LEGACY, never selected. Retained only so envelopes
 *     written before the Claude-native cutover (2026-07-22) still parse. Nothing
 *     produces it; resolveBrowserBeeBacking cannot return it.
 */
export const BROWSERBEE_BACKINGS = ["codex_computer_use", "desktop_fallback"] as const;
export type BrowserBeeBacking = (typeof BROWSERBEE_BACKINGS)[number];

/** What actually drives the browser, for status surfaces. */
export const BROWSER_LANE_ENGINE_LABEL = "claude-desktop-browser";

export interface BrowserBeeJobCreatePayload {
  title: string;
  objective: string;
  project: string;
  startUrl: string;
  siteLabel: string | null;
  requestedBy: string;
  requiresLogin: boolean;
  runMode: BrowserBeeRunMode;
  approvalMode: BrowserBeeApprovalMode;
  jobType: BrowserBeeJobType;
  allowedDomains: string[];
  steps: string[];
  successCriteria: string[];
  artifactPolicy: BrowserBeeArtifactPolicy;
  tracePolicy: BrowserBeeTracePolicy;
  sessionLabel: string | null;
  notes: string;
}

export interface BrowserBeeTaskRequestEnvelope extends BrowserBeeJobCreatePayload {
  requestedProjectPath: string;
  backing: BrowserBeeBacking;
  backingModel: string;
  createdVia: string;
}

export interface BrowserBeeJobSnapshot {
  id: string;
  title: string;
  status: string;
  requestedProject: string;
  requestedProjectPath: string;
  startUrl: string;
  siteLabel: string | null;
  requestedBy: string;
  requiresLogin: boolean;
  runMode: BrowserBeeRunMode;
  approvalMode: BrowserBeeApprovalMode;
  jobType: BrowserBeeJobType;
  allowedDomains: string[];
  artifactPolicy: BrowserBeeArtifactPolicy;
  tracePolicy: BrowserBeeTracePolicy;
  sessionLabel: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserBeeHealthSnapshot {
  ok: true;
  bee: "browserbee";
  backingModel: string;
  readiness: {
    acknowledgedComputerUse: boolean;
    consentRequired: boolean;
    desktopFallbackEnabled: boolean;
    effectiveBacking: BrowserBeeBacking | "unavailable";
  };
  counts: {
    total: number;
    backlog: number;
    active: number;
    review: number;
    done: number;
    failed: number;
    cancelled: number;
  };
  latestTaskAt: string | null;
  sessionPlane: {
    mode: "shared_session_plane";
    total: number;
    ready: number;
    needsReauth: number;
    expired: number;
    providers: string[];
  };
  runModesSupported: BrowserBeeRunMode[];
  approvalModesSupported: BrowserBeeApprovalMode[];
}

type UnknownRecord = Record<string, unknown>;
type BrowserBeeTaskWithOutput = Pick<TaskDoc, "_id" | "title" | "status" | "createdAt" | "updatedAt" | "model" | "output">;

function fail(message: string): never {
  throw new ContractValidationError(message);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function readString(
  record: UnknownRecord,
  key: string,
  label: string,
  { required = true, allowEmpty = false }: { required?: boolean; allowEmpty?: boolean } = {},
): string | null {
  const value = record[key];
  if (value == null) {
    if (required) fail(`${label} is required`);
    return null;
  }
  if (typeof value !== "string") fail(`${label} must be a string`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    if (required) fail(`${label} is required`);
    return null;
  }
  return trimmed;
}

function readBoolean(record: UnknownRecord, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(record: UnknownRecord, key: string): string[] {
  const value = record[key];
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`${key} must be an array`);
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], label: string): T[number] {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(normalized)) {
    return normalized as T[number];
  }
  fail(`${label} must be one of: ${allowed.join(", ")}`);
}

function normalizeUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`Invalid startUrl: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("startUrl must use http or https");
  }
  return parsed.toString();
}

function deriveJobTitle(input: { title: string | null; objective: string; siteLabel: string | null; startUrl: string }): string {
  if (input.title) return input.title;
  if (input.siteLabel) return `Browser Lane: ${input.siteLabel}`;
  const host = new URL(input.startUrl).hostname.replace(/^www\./, "");
  const words = input.objective.split(/\s+/).slice(0, 5).join(" ");
  return `Browser Lane: ${host}${words ? ` - ${words}` : ""}`.slice(0, 100);
}

function deriveApprovalMode(runMode: BrowserBeeRunMode, requiresLogin: boolean): BrowserBeeApprovalMode {
  if (runMode === "attached") return "manual";
  if (requiresLogin) return "confirm_external";
  return "auto";
}

function readBrowserBeeEnvelope(task: BrowserBeeTaskWithOutput): BrowserBeeTaskRequestEnvelope | null {
  const output = task.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const request = (output as Record<string, unknown>).browserbeeRequest;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;

  const record = request as UnknownRecord;
  const title = readString(record, "title", "browserbeeRequest.title", { required: false }) ?? task.title;
  const objective = readString(record, "objective", "browserbeeRequest.objective", { required: false }) ?? task.title;
  const project = readString(record, "project", "browserbeeRequest.project", { required: false }) ?? "ops";
  const startUrl = readString(record, "startUrl", "browserbeeRequest.startUrl", { required: false }) ?? "about:blank";

  return {
    title,
    objective,
    project,
    startUrl,
    siteLabel: readString(record, "siteLabel", "browserbeeRequest.siteLabel", { required: false }),
    requestedBy: readString(record, "requestedBy", "browserbeeRequest.requestedBy", { required: false }) ?? "hive",
    requiresLogin: readBoolean(record, "requiresLogin", false),
    runMode: normalizeEnum(record.runMode, BROWSERBEE_RUN_MODES, "isolated", "browserbeeRequest.runMode"),
    approvalMode: normalizeEnum(
      record.approvalMode,
      BROWSERBEE_APPROVAL_MODES,
      "manual",
      "browserbeeRequest.approvalMode",
    ),
    jobType: normalizeEnum(record.jobType, BROWSERBEE_JOB_TYPES, "site_ops", "browserbeeRequest.jobType"),
    allowedDomains: readStringArray(record, "allowedDomains"),
    steps: readStringArray(record, "steps"),
    successCriteria: readStringArray(record, "successCriteria"),
    artifactPolicy: normalizeEnum(
      record.artifactPolicy,
      BROWSERBEE_ARTIFACT_POLICIES,
      "screenshots",
      "browserbeeRequest.artifactPolicy",
    ),
    tracePolicy: normalizeEnum(record.tracePolicy, BROWSERBEE_TRACE_POLICIES, "timeline", "browserbeeRequest.tracePolicy"),
    sessionLabel: readString(record, "sessionLabel", "browserbeeRequest.sessionLabel", { required: false }),
    notes: readString(record, "notes", "browserbeeRequest.notes", { required: false, allowEmpty: true }) ?? "",
    requestedProjectPath: readString(record, "requestedProjectPath", "browserbeeRequest.requestedProjectPath", { required: false }) ?? "",
    backing: normalizeEnum(record.backing, BROWSERBEE_BACKINGS, "desktop_fallback", "browserbeeRequest.backing"),
    backingModel: readString(record, "backingModel", "browserbeeRequest.backingModel", { required: false }) ?? BROWSER_LANE_ENGINE_LABEL,
    createdVia: readString(record, "createdVia", "browserbeeRequest.createdVia", { required: false }) ?? "browserbee",
  };
}

export function parseBrowserBeeJobCreate(input: unknown): BrowserBeeJobCreatePayload {
  const record = asRecord(input, "browserbee job");
  const objective = readString(record, "objective", "objective")!;
  const project = readString(record, "project", "project")!;
  const normalizedStartUrl = normalizeUrl(readString(record, "startUrl", "startUrl")!);
  const startUrl = new URL(normalizedStartUrl);
  const siteLabel = readString(record, "siteLabel", "siteLabel", { required: false });
  const requiresLogin = readBoolean(record, "requiresLogin", false);
  const runMode = normalizeEnum(record.runMode, BROWSERBEE_RUN_MODES, "isolated", "runMode");
  const requestedBy = readString(record, "requestedBy", "requestedBy", { required: false }) ?? "hive";
  const title = deriveJobTitle({
    title: readString(record, "title", "title", { required: false }),
    objective,
    siteLabel,
    startUrl: normalizedStartUrl,
  });

  const allowedDomains = Array.from(
    new Set([startUrl.hostname, ...readStringArray(record, "allowedDomains")].map((entry) => entry.trim()).filter(Boolean)),
  );
  const successCriteria = readStringArray(record, "successCriteria");

  return {
    title,
    objective,
    project,
    startUrl: normalizedStartUrl,
    siteLabel,
    requestedBy,
    requiresLogin,
    runMode,
    approvalMode: normalizeEnum(
      record.approvalMode,
      BROWSERBEE_APPROVAL_MODES,
      deriveApprovalMode(runMode, requiresLogin),
      "approvalMode",
    ),
    jobType: normalizeEnum(record.jobType, BROWSERBEE_JOB_TYPES, "site_ops", "jobType"),
    allowedDomains,
    steps: readStringArray(record, "steps"),
    successCriteria:
      successCriteria.length > 0
        ? successCriteria
        : ["Complete the requested browser workflow and leave a concise summary in the final task result."],
    artifactPolicy: normalizeEnum(record.artifactPolicy, BROWSERBEE_ARTIFACT_POLICIES, "screenshots", "artifactPolicy"),
    tracePolicy: normalizeEnum(record.tracePolicy, BROWSERBEE_TRACE_POLICIES, "timeline", "tracePolicy"),
    sessionLabel: readString(record, "sessionLabel", "sessionLabel", { required: false }),
    notes: readString(record, "notes", "notes", { required: false, allowEmpty: true }) ?? "",
  };
}

/** The shared job-metadata + objective/steps/criteria/notes block, common to every backing. */
function buildBrowserBeeJobBodySections(
  payload: BrowserBeeJobCreatePayload,
  options: { requestedProjectPath: string },
): string[] {
  const sections = [
    `Requested by: ${payload.requestedBy}`,
    `Target project: ${payload.project}`,
    `Target project path: ${options.requestedProjectPath}`,
    `Start URL: ${payload.startUrl}`,
    `Site: ${payload.siteLabel ?? new URL(payload.startUrl).hostname}`,
    `Job type: ${payload.jobType}`,
    `Run mode: ${payload.runMode}`,
    `Approval mode: ${payload.approvalMode}`,
    `Requires login: ${payload.requiresLogin ? "yes" : "no"}`,
    `Allowed domains: ${payload.allowedDomains.join(", ")}`,
    `Artifact policy: ${payload.artifactPolicy}`,
    `Trace policy: ${payload.tracePolicy}`,
  ];

  if (payload.sessionLabel) {
    sections.push(`Session label: ${payload.sessionLabel}`);
  }

  sections.push("", "Objective:", payload.objective);

  if (payload.steps.length > 0) {
    sections.push("", "Execution steps:");
    for (const step of payload.steps) {
      sections.push(`- ${step}`);
    }
  }

  if (payload.successCriteria.length > 0) {
    sections.push("", "Success criteria:");
    for (const criterion of payload.successCriteria) {
      sections.push(`- ${criterion}`);
    }
  }

  if (payload.notes.trim()) {
    sections.push("", "Operator notes:", payload.notes.trim());
  }

  return sections;
}

/**
 * The Browser Lane job prompt. ONE builder — Claude driving a desktop browser is
 * the only engine (see resolveBrowserBeeBacking). There used to be a second,
 * near-identical Codex variant; the pair drifted, and the Codex one described a
 * backing that could never run.
 */
export function buildBrowserBeeTaskDescription(
  payload: BrowserBeeJobCreatePayload,
  options: { requestedProjectPath: string },
): string {
  const sections = [
    "This task came from Browser Lane. Claude drives a real desktop browser here — there is no Codex Computer Use engine, and nothing is waiting on OpenAI auth.",
    "Treat it as a stateful browser workflow, not a generic fresh-public-web research request.",
    "If the work can be completed by Browser Lane read/search mode without login state, multi-step browser control, or rendered interaction, stop and note that the request should be rerouted.",
    "Drive the browser with the desktop_action tool. Prefer the most reliable strategy first: desktop.script.run (AppleScript) to open/navigate a browser → desktop.ax.query/desktop.ax.act on the browser's Accessibility tree → desktop.click/desktop.type by coordinate only as a last resort. Use desktop.capture to verify state.",
    "Stay within the approved domains and the stated workflow scope. Reuse an already-signed-in browser session rather than re-entering credentials; if login is required and no session exists, stop and report that human login is needed — for keychain_password sites, mention that the operator can use Browser Lane's 'Sign in with saved credential' button to retrieve it without retyping it.",
    "",
    ...buildBrowserBeeJobBodySections(payload, options),
    "",
    "Output expectations:",
    "- Summarize what happened on the site.",
    "- Call out any approvals, login prompts, or blockers encountered.",
    "- Mention screenshots, traces, or HTML captures created while executing the workflow.",
  ];

  return sections.join("\n");
}

/**
 * The Browser Lane job prompt for the CANOPY engine (T6, 2026-07-24).
 *
 * The desktop prompt above tells an agent to drive Chrome/Safari itself. Under
 * `browserLane.engine: "canopy"` that is exactly what must NOT happen: the work
 * belongs in the Canopy Browser app, which owns the signed-in sessions and the
 * site policy. So this prompt gives the agent one instruction — call HiveMatrix's
 * own Browser Lane endpoint, which routes into the app — and explicitly forbids
 * ad-hoc browser tools, mirroring the wording the voice/task-intake door already
 * uses (`buildVoiceBrowserLaneTask`). Same job, same envelope; different door,
 * same destination.
 */
export function buildCanopyBrowserTaskDescription(
  payload: BrowserBeeJobCreatePayload,
  options: { requestedProjectPath: string; daemonPort?: string },
): string {
  const port = options.daemonPort ?? process.env.HIVEMATRIX_PORT ?? "3747";
  const args = {
    mode: payload.requiresLogin ? "workflow" : "open",
    objective: payload.objective,
    startUrl: payload.startUrl,
    jobType: payload.jobType,
    requiresLogin: payload.requiresLogin,
    ...(payload.steps.length ? { steps: payload.steps } : {}),
  };
  const sections = [
    "This task came from Browser Lane. The browser is the Canopy Browser app — a real WebKit browser that already holds the signed-in sessions and enforces the site policy (read/write access mode, domain scope, ownership).",
    "Do NOT use WebSearch, Chrome MCP, desktop_action, or any ad-hoc browser tool. Do not open Chrome or Safari. Call HiveMatrix's Browser Lane endpoint and report exactly what it returns:",
    "",
    "```bash",
    `curl -s -X POST "http://127.0.0.1:${port}/lane/browser" \\`,
    `  -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${JSON.stringify({ args })}'`,
    "```",
    "",
    "Equivalent model tool: hivematrix_browser",
    "",
    "If the response refuses the run (a read-only site, an out-of-scope domain) report that refusal message verbatim — it is the app's decision, not a bug to work around. If it reports that human login is required, stop and say so; credentials are always a human click in the Canopy Browser app.",
    "",
    ...buildBrowserBeeJobBodySections(payload, { requestedProjectPath: options.requestedProjectPath }),
    "",
    "Output expectations:",
    "- Summarize what the run found on the site.",
    "- Call out any refusal, login prompt, or failed step, quoting the message you were given.",
  ];
  return sections.join("\n");
}

/**
 * Description for the opt-in Desktop fallback: the same job, but driven by
 * Claude through Desktop Lane instead of Codex Computer Use. Used only
 * when Codex auth is unavailable and the operator has enabled the fallback.
 */
/**
 * @deprecated Browser Lane has one engine now; this is buildBrowserBeeTaskDescription.
 * Kept as a thin alias so any caller still importing the old name keeps working.
 */
export function buildBrowserBeeDesktopFallbackDescription(
  payload: BrowserBeeJobCreatePayload,
  options: { requestedProjectPath: string },
): string {
  return buildBrowserBeeTaskDescription(payload, options);
}

export function buildBrowserBeeTaskRequestEnvelope(
  payload: BrowserBeeJobCreatePayload,
  requestedProjectPath: string,
  options: { backing?: BrowserBeeBacking; backingModel?: string } = {},
): BrowserBeeTaskRequestEnvelope {
  const backing = options.backing ?? "desktop_fallback";
  return {
    ...payload,
    requestedProjectPath,
    backing,
    backingModel: options.backingModel ?? BROWSER_LANE_ENGINE_LABEL,
    createdVia: "browser-lane.jobs",
  };
}

/**
 * Whether the opt-in Desktop fallback is enabled. Off by default — the
 * operator must set `browserLane.desktopFallback: true` in
 * `~/.hivematrix/config.json` to allow Browser Lane to degrade to a local
 * desktop-driven browser when Codex auth is missing.
 */
export function readBrowserBeeDesktopFallbackEnabled(config: Record<string, unknown> = readHiveConfig()): boolean {
  const browserLane = config.browserLane;
  if (browserLane && typeof browserLane === "object" && !Array.isArray(browserLane)) {
    return (browserLane as Record<string, unknown>).desktopFallback === true;
  }
  const legacy = config.browserbee;
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    return (legacy as Record<string, unknown>).desktopFallback === true;
  }
  return false;
}

export interface BrowserBeeBackingDecision {
  /** The backing to run on, or null if the job cannot be dispatched. */
  backing: BrowserBeeBacking | null;
  reason: string;
}

/**
 * Decide whether a Browser Lane job can be dispatched.
 *
 * Browser Lane is CLAUDE-NATIVE (2026-07-22). It used to prefer an OpenAI Codex
 * Computer Use backing and treat Claude-driving-the-desktop as a fallback, but
 * that backing was unreachable in practice: gpt-5.4-computer-use requires an
 * OpenAI API-key account and returns HTTP 400 "not supported when using Codex
 * with a ChatGPT account" on a subscription login — which is what this machine
 * has. So the Codex branch never ran, while its existence made every failure
 * read as an auth problem and sent people looking for `codex login`.
 *
 * There is now one engine: Claude drives a real desktop browser through Desktop
 * Lane (task agents carry the desktop_action tool as of 0.1.250). The only real
 * precondition left is that Desktop Lane is actually up, so that is the only
 * thing this checks. Do not reintroduce a Codex branch — see
 * docs/browser-lane-claude-native.md.
 */
export function resolveBrowserBeeBacking(input: {
  desktopBeeAvailable: boolean;
}): BrowserBeeBackingDecision {
  if (!input.desktopBeeAvailable) {
    return {
      backing: null,
      reason:
        "Desktop Lane is unavailable (the Swift helper is not running), so there is no engine to drive the browser. "
        + "Start Desktop Lane and retry.",
    };
  }
  return {
    backing: "desktop_fallback",
    reason: "Claude drives a real desktop browser through Desktop Lane.",
  };
}

export function buildBrowserBeeJobSnapshot(task: BrowserBeeTaskWithOutput): BrowserBeeJobSnapshot {
  const request = readBrowserBeeEnvelope(task);

  return {
    id: String(task._id),
    title: task.title,
    status: task.status,
    requestedProject: request?.project ?? "ops",
    requestedProjectPath: request?.requestedProjectPath ?? "",
    startUrl: request?.startUrl ?? "",
    siteLabel: request?.siteLabel ?? null,
    requestedBy: request?.requestedBy ?? "hive",
    requiresLogin: request?.requiresLogin ?? false,
    runMode: request?.runMode ?? "isolated",
    approvalMode: request?.approvalMode ?? "manual",
    jobType: request?.jobType ?? "site_ops",
    allowedDomains: request?.allowedDomains ?? [],
    artifactPolicy: request?.artifactPolicy ?? "screenshots",
    tracePolicy: request?.tracePolicy ?? "timeline",
    sessionLabel: request?.sessionLabel ?? null,
    model: task.model ?? request?.backingModel ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function buildBrowserBeeHealthSnapshot(args: {
  tasks: Array<Pick<TaskDoc, "status" | "createdAt">>;
  readiness: {
    acknowledgedComputerUse: boolean;
    desktopFallbackEnabled?: boolean;
    desktopBeeAvailable?: boolean;
  };
  sessions?: Array<Pick<AuthBeeSessionRecord, "provider" | "status" | "kind" | "attachedTo" | "domains">>;
}): BrowserBeeHealthSnapshot {
  const counts = {
    total: args.tasks.length,
    backlog: 0,
    active: 0,
    review: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };

  let latestTaskAt: string | null = null;
  for (const task of args.tasks) {
    if (!latestTaskAt || task.createdAt > latestTaskAt) latestTaskAt = task.createdAt;
    switch (task.status) {
      case "backlog":
        counts.backlog += 1;
        break;
      case "assigned":
      case "in_progress":
        counts.active += 1;
        break;
      case "review":
        counts.review += 1;
        break;
      case "done":
        counts.done += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      case "cancelled":
        counts.cancelled += 1;
        break;
      default:
        break;
    }
  }

  const sessionSummary = buildAuthBeeSessionPlaneSummary(args.sessions ?? []);
  const sessionPlane = {
    mode: sessionSummary.mode,
    total: sessionSummary.total,
    ready: sessionSummary.ready,
    needsReauth: sessionSummary.needsReauth,
    expired: sessionSummary.expired,
    providers: sessionSummary.providers,
  };

  const desktopFallbackEnabled = args.readiness.desktopFallbackEnabled === true;
  const backingDecision = resolveBrowserBeeBacking({
    desktopBeeAvailable: args.readiness.desktopBeeAvailable !== false,
  });

  return {
    ok: true,
    bee: "browserbee",
    backingModel: BROWSER_LANE_ENGINE_LABEL,
    readiness: {
      acknowledgedComputerUse: args.readiness.acknowledgedComputerUse,
      consentRequired: args.readiness.acknowledgedComputerUse !== true,
      desktopFallbackEnabled,
      effectiveBacking: backingDecision.backing ?? "unavailable",
    },
    counts,
    latestTaskAt,
    sessionPlane,
    runModesSupported: [...BROWSERBEE_RUN_MODES],
    approvalModesSupported: [...BROWSERBEE_APPROVAL_MODES],
  };
}
