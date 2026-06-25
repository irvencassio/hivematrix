import type { TaskDoc } from "@/lib/db";
import { ContractValidationError } from "@/lib/central/contracts";
import { CODEX_COMPUTER_USE_MODEL_ID } from "@/lib/models/catalog";

// DesktopBee (formerly ComputerBee — renamed Q1 decision).
// Swift helper daemon owns macOS Accessibility, CGEvent, ScreenCaptureKit, NSWorkspace, AppleScript.
// Strategy order: AppleScript/JXA → AX semantic actions → vision last resort.

export const DESKTOPBEE_JOB_TYPES = [
  "desktop_ops",
  "messages",
  "system_settings",
  "installer",
  "file_ops",
] as const;
export type DesktopBeeJobType = (typeof DESKTOPBEE_JOB_TYPES)[number];

export const DESKTOPBEE_RUN_MODES = ["background", "foreground", "manual_escalation"] as const;
export type DesktopBeeRunMode = (typeof DESKTOPBEE_RUN_MODES)[number];

export const DESKTOPBEE_APPROVAL_MODES = ["confirm_app_launch", "confirm_external", "manual"] as const;
export type DesktopBeeApprovalMode = (typeof DESKTOPBEE_APPROVAL_MODES)[number];

export const DESKTOPBEE_ARTIFACT_POLICIES = ["none", "screenshots", "screenshots_and_logs"] as const;
export type DesktopBeeArtifactPolicy = (typeof DESKTOPBEE_ARTIFACT_POLICIES)[number];

export const DESKTOPBEE_TRACE_POLICIES = ["none", "timeline", "timeline_and_screenshots"] as const;
export type DesktopBeeTracePolicy = (typeof DESKTOPBEE_TRACE_POLICIES)[number];

export interface DesktopBeeJobCreatePayload {
  title: string;
  objective: string;
  project: string;
  primaryApp: string;
  requestedBy: string;
  requiresElevatedPermissions: boolean;
  runMode: DesktopBeeRunMode;
  approvalMode: DesktopBeeApprovalMode;
  jobType: DesktopBeeJobType;
  allowedApps: string[];
  steps: string[];
  successCriteria: string[];
  artifactPolicy: DesktopBeeArtifactPolicy;
  tracePolicy: DesktopBeeTracePolicy;
  sessionLabel: string | null;
  notes: string;
}

export interface DesktopBeeTaskRequestEnvelope extends DesktopBeeJobCreatePayload {
  requestedProjectPath: string;
  backingModel: string;
  createdVia: string;
}

export interface DesktopBeeJobSnapshot {
  id: string;
  title: string;
  status: string;
  requestedProject: string;
  requestedProjectPath: string;
  primaryApp: string;
  requestedBy: string;
  requiresElevatedPermissions: boolean;
  runMode: DesktopBeeRunMode;
  approvalMode: DesktopBeeApprovalMode;
  jobType: DesktopBeeJobType;
  allowedApps: string[];
  artifactPolicy: DesktopBeeArtifactPolicy;
  tracePolicy: DesktopBeeTracePolicy;
  sessionLabel: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopBeeHealthSnapshot {
  ok: true;
  bee: "desktopbee";
  backingModel: string;
  readiness: {
    codexConfigured: boolean;
    codexAuthMode: string;
    acknowledgedDesktopUse: boolean;
    consentRequired: boolean;
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
  jobTypesSupported: DesktopBeeJobType[];
  runModesSupported: DesktopBeeRunMode[];
  approvalModesSupported: DesktopBeeApprovalMode[];
}

type UnknownRecord = Record<string, unknown>;
type DesktopBeeTaskWithOutput = Pick<TaskDoc, "_id" | "title" | "status" | "createdAt" | "updatedAt" | "model" | "output">;

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

function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
  label: string,
): T[number] {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(normalized)) {
    return normalized as T[number];
  }
  fail(`${label} must be one of: ${allowed.join(", ")}`);
}

function deriveJobTitle(input: { title: string | null; primaryApp: string; objective: string }): string {
  if (input.title) return input.title;
  const words = input.objective.split(/\s+/).slice(0, 5).join(" ");
  return `Desktop Lane: ${input.primaryApp}${words ? ` - ${words}` : ""}`.slice(0, 100);
}

function deriveApprovalMode(runMode: DesktopBeeRunMode, requiresElevatedPermissions: boolean): DesktopBeeApprovalMode {
  if (runMode !== "background") return "manual";
  if (requiresElevatedPermissions) return "manual";
  return "confirm_app_launch";
}

function readDesktopBeeEnvelope(task: DesktopBeeTaskWithOutput): DesktopBeeTaskRequestEnvelope | null {
  const output = task.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const request = (output as Record<string, unknown>).desktopbeeRequest;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;

  const record = request as UnknownRecord;
  const title = readString(record, "title", "desktopbeeRequest.title", { required: false }) ?? task.title;
  const objective = readString(record, "objective", "desktopbeeRequest.objective", { required: false }) ?? task.title;
  const project = readString(record, "project", "desktopbeeRequest.project", { required: false }) ?? "ops";
  const primaryApp = readString(record, "primaryApp", "desktopbeeRequest.primaryApp", { required: false }) ?? "Desktop";

  return {
    title,
    objective,
    project,
    primaryApp,
    requestedBy: readString(record, "requestedBy", "desktopbeeRequest.requestedBy", { required: false }) ?? "hive",
    requiresElevatedPermissions: readBoolean(record, "requiresElevatedPermissions", false),
    runMode: normalizeEnum(record.runMode, DESKTOPBEE_RUN_MODES, "background", "desktopbeeRequest.runMode"),
    approvalMode: normalizeEnum(record.approvalMode, DESKTOPBEE_APPROVAL_MODES, "manual", "desktopbeeRequest.approvalMode"),
    jobType: normalizeEnum(record.jobType, DESKTOPBEE_JOB_TYPES, "desktop_ops", "desktopbeeRequest.jobType"),
    allowedApps: readStringArray(record, "allowedApps"),
    steps: readStringArray(record, "steps"),
    successCriteria: readStringArray(record, "successCriteria"),
    artifactPolicy: normalizeEnum(record.artifactPolicy, DESKTOPBEE_ARTIFACT_POLICIES, "screenshots", "desktopbeeRequest.artifactPolicy"),
    tracePolicy: normalizeEnum(record.tracePolicy, DESKTOPBEE_TRACE_POLICIES, "timeline_and_screenshots", "desktopbeeRequest.tracePolicy"),
    sessionLabel: readString(record, "sessionLabel", "desktopbeeRequest.sessionLabel", { required: false }),
    notes: readString(record, "notes", "desktopbeeRequest.notes", { required: false, allowEmpty: true }) ?? "",
    requestedProjectPath: readString(record, "requestedProjectPath", "desktopbeeRequest.requestedProjectPath", { required: false }) ?? "",
    backingModel: readString(record, "backingModel", "desktopbeeRequest.backingModel", { required: false }) ?? CODEX_COMPUTER_USE_MODEL_ID,
    createdVia: readString(record, "createdVia", "desktopbeeRequest.createdVia", { required: false }) ?? "desktopbee",
  };
}

export function parseDesktopBeeJobCreate(input: unknown): DesktopBeeJobCreatePayload {
  const record = asRecord(input, "desktopbee job");
  const objective = readString(record, "objective", "objective")!;
  const project = readString(record, "project", "project")!;
  const primaryApp = (readString(record, "primaryApp", "primaryApp") ?? "Desktop").trim();
  const requiresElevatedPermissions = readBoolean(record, "requiresElevatedPermissions", false);
  const runMode = normalizeEnum(record.runMode, DESKTOPBEE_RUN_MODES, "background", "runMode");
  const requestedBy = readString(record, "requestedBy", "requestedBy", { required: false }) ?? "hive";
  const title = deriveJobTitle({ title: readString(record, "title", "title", { required: false }), primaryApp, objective });
  const allowedApps = Array.from(
    new Set([primaryApp, ...readStringArray(record, "allowedApps")].map((e) => e.trim()).filter(Boolean)),
  );
  const successCriteria = readStringArray(record, "successCriteria");

  return {
    title,
    objective,
    project,
    primaryApp,
    requestedBy,
    requiresElevatedPermissions,
    runMode,
    approvalMode: normalizeEnum(record.approvalMode, DESKTOPBEE_APPROVAL_MODES, deriveApprovalMode(runMode, requiresElevatedPermissions), "approvalMode"),
    jobType: normalizeEnum(record.jobType, DESKTOPBEE_JOB_TYPES, "desktop_ops", "jobType"),
    allowedApps,
    steps: readStringArray(record, "steps"),
    successCriteria: successCriteria.length > 0
      ? successCriteria
      : ["Complete the requested desktop workflow and leave a concise summary in the final task result."],
    artifactPolicy: normalizeEnum(record.artifactPolicy, DESKTOPBEE_ARTIFACT_POLICIES, "screenshots", "artifactPolicy"),
    tracePolicy: normalizeEnum(record.tracePolicy, DESKTOPBEE_TRACE_POLICIES, "timeline_and_screenshots", "tracePolicy"),
    sessionLabel: readString(record, "sessionLabel", "sessionLabel", { required: false }),
    notes: readString(record, "notes", "notes", { required: false, allowEmpty: true }) ?? "",
  };
}

export function buildDesktopBeeTaskDescription(payload: DesktopBeeJobCreatePayload, options: { requestedProjectPath: string }): string {
  const sections = [
    "This task came from Desktop Lane.",
    "Treat it as a native desktop automation workflow.",
    "Strategy order: AppleScript/JXA (scriptable apps) → AX-tree semantic actions → coordinate/vision last resort.",
    "If the workflow can be completed through a direct API, file edit, or Browser Lane workflow, stop and reroute.",
    "",
    `Requested by: ${payload.requestedBy}`,
    `Target project: ${payload.project}`,
    `Target project path: ${options.requestedProjectPath}`,
    `Primary app: ${payload.primaryApp}`,
    `Job type: ${payload.jobType}`,
    `Run mode: ${payload.runMode}`,
    `Approval mode: ${payload.approvalMode}`,
    `Requires elevated permissions: ${payload.requiresElevatedPermissions ? "yes" : "no"}`,
    `Allowed apps: ${payload.allowedApps.join(", ")}`,
    `Artifact policy: ${payload.artifactPolicy}`,
    `Trace policy: ${payload.tracePolicy}`,
  ];

  if (payload.sessionLabel) sections.push(`Session label: ${payload.sessionLabel}`);
  sections.push("", "Objective:", payload.objective);
  if (payload.steps.length > 0) {
    sections.push("", "Execution steps:");
    for (const step of payload.steps) sections.push(`- ${step}`);
  }
  if (payload.successCriteria.length > 0) {
    sections.push("", "Success criteria:");
    for (const criterion of payload.successCriteria) sections.push(`- ${criterion}`);
  }
  if (payload.notes.trim()) sections.push("", "Operator notes:", payload.notes.trim());

  sections.push("", "Output expectations:",
    "- Summarize what happened in the desktop app flow.",
    "- Call out any app launches, approvals, or blockers encountered.",
    "- Mention screenshots or traces created.");

  return sections.join("\n");
}

export function buildDesktopBeeTaskRequestEnvelope(payload: DesktopBeeJobCreatePayload, requestedProjectPath: string): DesktopBeeTaskRequestEnvelope {
  return { ...payload, requestedProjectPath, backingModel: CODEX_COMPUTER_USE_MODEL_ID, createdVia: "desktopbee.jobs" };
}

export function buildDesktopBeeJobSnapshot(task: DesktopBeeTaskWithOutput): DesktopBeeJobSnapshot {
  const request = readDesktopBeeEnvelope(task);
  return {
    id: String(task._id),
    title: task.title,
    status: task.status,
    requestedProject: request?.project ?? "ops",
    requestedProjectPath: request?.requestedProjectPath ?? "",
    primaryApp: request?.primaryApp ?? "Desktop",
    requestedBy: request?.requestedBy ?? "hive",
    requiresElevatedPermissions: request?.requiresElevatedPermissions ?? false,
    runMode: request?.runMode ?? "background",
    approvalMode: request?.approvalMode ?? "manual",
    jobType: request?.jobType ?? "desktop_ops",
    allowedApps: request?.allowedApps ?? [],
    artifactPolicy: request?.artifactPolicy ?? "screenshots",
    tracePolicy: request?.tracePolicy ?? "timeline_and_screenshots",
    sessionLabel: request?.sessionLabel ?? null,
    model: task.model ?? request?.backingModel ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function buildDesktopBeeHealthSnapshot(args: {
  tasks: Array<Pick<TaskDoc, "status" | "createdAt">>;
  readiness: { codexConfigured: boolean; codexAuthMode: string; acknowledgedDesktopUse: boolean };
}): DesktopBeeHealthSnapshot {
  const counts = { total: args.tasks.length, backlog: 0, active: 0, review: 0, done: 0, failed: 0, cancelled: 0 };
  let latestTaskAt: string | null = null;
  for (const task of args.tasks) {
    if (!latestTaskAt || task.createdAt > latestTaskAt) latestTaskAt = task.createdAt;
    switch (task.status) {
      case "backlog": counts.backlog += 1; break;
      case "assigned": case "in_progress": counts.active += 1; break;
      case "review": counts.review += 1; break;
      case "done": counts.done += 1; break;
      case "failed": counts.failed += 1; break;
      case "cancelled": counts.cancelled += 1; break;
    }
  }
  return {
    ok: true,
    bee: "desktopbee",
    backingModel: CODEX_COMPUTER_USE_MODEL_ID,
    readiness: { ...args.readiness, consentRequired: args.readiness.acknowledgedDesktopUse !== true },
    counts,
    latestTaskAt,
    jobTypesSupported: [...DESKTOPBEE_JOB_TYPES],
    runModesSupported: [...DESKTOPBEE_RUN_MODES],
    approvalModesSupported: [...DESKTOPBEE_APPROVAL_MODES],
  };
}
