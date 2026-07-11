import { randomUUID } from "node:crypto";

export const CENTRAL_PROTOCOL_VERSION = 1;

export const WORKER_TOKEN_SCOPES = ["worker:register", "tasks:pull", "tasks:status"] as const;
export type WorkerTokenScope = (typeof WORKER_TOKEN_SCOPES)[number];

export const WORKER_KINDS = [
  "generic",
  "messagebee",
  "mailbee",
  "webbee",
  "browserbee",
  "computerbee",
  "desktopbee",
  "cronbee",
  "authbee",
  "voicebee",
  "review",
  "managerbee",
  "brainbee",
  "inventorbee",
  "tubebee",
  "custom",
] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export const CENTRAL_TASK_STATUSES = [
  "pending",
  "assigned",
  "in_progress",
  "review",
  "done",
  "failed",
  "cancelled",
] as const;
export type CentralTaskStatus = (typeof CENTRAL_TASK_STATUSES)[number];

export const WORKER_HEALTH_STATES = ["online", "stale", "offline"] as const;
export type WorkerHealth = (typeof WORKER_HEALTH_STATES)[number];

export const WORKER_HEALTH_THRESHOLDS = {
  onlineMs: 60_000,
  staleMs: 300_000,
} as const;

export interface WorkerTokenConfig {
  hostname: string;
  tokenHash: string;
  createdAt: string;
  scopes: WorkerTokenScope[];
  bee: WorkerKind;
  label: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export interface ArtifactRef {
  artifactId?: string;
  label?: string;
  path?: string;
  mimeType?: string;
  kind?: string;
  sizeBytes?: number | null;
}

export interface TraceRef {
  traceId: string;
  label?: string;
  url?: string;
  kind?: string;
  createdAt?: string;
}

export interface WorkerTaskEvent {
  type: string;
  message: string;
  level?: "info" | "warning" | "error";
  createdAt?: string;
  data?: Record<string, unknown>;
}

export interface CentralEvent {
  id: string;
  kind: string;
  createdAt: string;
  workerHostname?: string;
  centralTaskId?: string;
  bee?: WorkerKind;
  message?: string;
  data?: Record<string, unknown>;
}

export interface WorkerRegistrationPayload {
  hostname: string;
  label: string;
  bee: WorkerKind;
  agentSlots: number;
  runningTasks: number;
  capabilities: string[];
  softwareVersion: string | null;
  metadata: Record<string, unknown>;
}

export interface WorkerLeaseRequest {
  worker: string;
  agentSlots: number;
  runningTasks: number;
}

export interface CentralTaskCreatePayload {
  title: string;
  description: string;
  project: string;
  assignedWorker: string;
  bee: WorkerKind;
  model: string;
  budget: number;
  workflow: string | null;
  metadata: Record<string, unknown>;
  artifactRefs: ArtifactRef[];
  traceRefs: TraceRef[];
}

export interface CentralTaskLeasePayload {
  _id: string;
  title: string;
  description: string;
  project: string;
  model: string;
  budget: number;
  workflow: string | null;
  metadata: Record<string, unknown>;
  bee: WorkerKind;
  artifactRefs: ArtifactRef[];
  traceRefs: TraceRef[];
}

export interface CentralTaskStatusPayload {
  status?: CentralTaskStatus;
  workerStatus?: string | null;
  output?: string | null;
  cost?: number | null;
  turns?: number | null;
  error?: string | null;
  completedAt?: string | null;
  artifactRefs?: ArtifactRef[];
  traceRefs?: TraceRef[];
  events?: WorkerTaskEvent[];
}

export class ContractValidationError extends Error {
  issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ContractValidationError";
    this.issues = issues.length > 0 ? issues : [message];
  }
}

export function isContractValidationError(error: unknown): error is ContractValidationError {
  return error instanceof ContractValidationError;
}

type UnknownRecord = Record<string, unknown>;

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
  { required = true, allowEmpty = false }: { required?: boolean; allowEmpty?: boolean } = {}
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

function readNumber(
  record: UnknownRecord,
  key: string,
  label: string,
  { required = true, min }: { required?: boolean; min?: number } = {}
): number | null {
  const value = record[key];
  if (value == null) {
    if (required) fail(`${label} is required`);
    return null;
  }
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    fail(`${label} must be a number`);
  }
  if (min != null && value < min) fail(`${label} must be >= ${min}`);
  return value;
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

function readMetadata(record: UnknownRecord, key: string): Record<string, unknown> {
  const value = record[key];
  if (value == null) return {};
  return asRecord(value, key);
}

function isWorkerKind(value: string): value is WorkerKind {
  return (WORKER_KINDS as readonly string[]).includes(value);
}

function isWorkerTokenScope(value: string): value is WorkerTokenScope {
  return (WORKER_TOKEN_SCOPES as readonly string[]).includes(value);
}

function isCentralTaskStatus(value: string): value is CentralTaskStatus {
  return (CENTRAL_TASK_STATUSES as readonly string[]).includes(value);
}

// Lane-native ids accepted on input and normalized to the persisted worker kind.
// Part of the staged Bee→Lane migration: a lane-shaped producer can register or
// lease as "message"/"mail"/… and central stores the existing kind value, so no
// persisted data or old worker changes. The legacy kind strings stay canonical.
// Note: "review" is no longer aliased here — it is a canonical WorkerKind.
const LANE_ALIAS_TO_WORKER_KIND: Record<string, WorkerKind> = {
  message: "messagebee",
  mail: "mailbee",
  browser: "browserbee",
  desktop: "desktopbee",
  memory: "brainbee",
};

function normalizeWorkerKind(value: unknown): WorkerKind {
  if (typeof value !== "string" || !value.trim()) return "generic";
  const normalized = value.trim().toLowerCase();
  if (isWorkerKind(normalized)) return normalized;
  return LANE_ALIAS_TO_WORKER_KIND[normalized] ?? "custom";
}

function normalizeDateString(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeArtifactRef(value: unknown): ArtifactRef {
  const record = asRecord(value, "artifact ref");
  return {
    artifactId: readString(record, "artifactId", "artifactId", { required: false }) ?? undefined,
    label: readString(record, "label", "label", { required: false }) ?? undefined,
    path: readString(record, "path", "path", { required: false }) ?? undefined,
    mimeType: readString(record, "mimeType", "mimeType", { required: false }) ?? undefined,
    kind: readString(record, "kind", "kind", { required: false }) ?? undefined,
    sizeBytes: readNumber(record, "sizeBytes", "sizeBytes", { required: false, min: 0 }),
  };
}

function normalizeTraceRef(value: unknown): TraceRef {
  const record = asRecord(value, "trace ref");
  return {
    traceId: readString(record, "traceId", "traceId")!,
    label: readString(record, "label", "label", { required: false }) ?? undefined,
    url: readString(record, "url", "url", { required: false }) ?? undefined,
    kind: readString(record, "kind", "kind", { required: false }) ?? undefined,
    createdAt: normalizeDateString(record.createdAt, new Date().toISOString()),
  };
}

function normalizeTaskEvent(value: unknown): WorkerTaskEvent {
  const record = asRecord(value, "worker event");
  return {
    type: readString(record, "type", "event.type")!,
    message: readString(record, "message", "event.message")!,
    level: (readString(record, "level", "event.level", { required: false }) as WorkerTaskEvent["level"] | null) ?? "info",
    createdAt: normalizeDateString(record.createdAt, new Date().toISOString()),
    data: readMetadata(record, "data"),
  };
}

export function normalizeWorkerTokenEntry(value: unknown): WorkerTokenConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as UnknownRecord;
  const hostname = readString(record, "hostname", "worker token hostname")!;
  const tokenHash = readString(record, "tokenHash", "worker token hash")!;

  const scopes = Array.isArray(record.scopes)
    ? record.scopes.filter((scope): scope is WorkerTokenScope => typeof scope === "string" && isWorkerTokenScope(scope))
    : [...WORKER_TOKEN_SCOPES];

  return {
    hostname,
    tokenHash,
    createdAt: normalizeDateString(record.createdAt),
    scopes: scopes.length > 0 ? scopes : [...WORKER_TOKEN_SCOPES],
    bee: normalizeWorkerKind(record.lane ?? record.bee),
    label: readString(record, "label", "worker token label", { required: false }) ?? hostname,
    capabilities: readStringArray(record, "capabilities"),
    metadata: readMetadata(record, "metadata"),
  };
}

export function normalizeWorkerTokenEntries(value: unknown): WorkerTokenConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeWorkerTokenEntry(entry))
    .filter((entry): entry is WorkerTokenConfig => entry !== null);
}

export function workerHasScopes(
  token: Pick<WorkerTokenConfig, "scopes">,
  required: WorkerTokenScope | WorkerTokenScope[]
): boolean {
  const needed = Array.isArray(required) ? required : [required];
  return needed.every((scope) => token.scopes.includes(scope));
}

export function computeWorkerHealth(lastSeen: Date | string | number, now = Date.now()): WorkerHealth {
  const lastSeenMs = new Date(lastSeen).getTime();
  if (Number.isNaN(lastSeenMs)) return "offline";
  const elapsed = now - lastSeenMs;
  if (elapsed < WORKER_HEALTH_THRESHOLDS.onlineMs) return "online";
  if (elapsed < WORKER_HEALTH_THRESHOLDS.staleMs) return "stale";
  return "offline";
}

export function parseWorkerRegistration(
  body: unknown,
  fallbackHostname?: string
): WorkerRegistrationPayload {
  const record = asRecord(body, "worker registration");
  const hostname = readString(record, "hostname", "hostname", { required: false }) ?? fallbackHostname;
  if (!hostname) fail("hostname is required");

  return {
    hostname,
    label: readString(record, "label", "label", { required: false }) ?? hostname,
    bee: normalizeWorkerKind(record.lane ?? record.bee),
    agentSlots: readNumber(record, "agentSlots", "agentSlots", { required: false, min: 0 }) ?? 4,
    runningTasks: readNumber(record, "runningTasks", "runningTasks", { required: false, min: 0 }) ?? 0,
    capabilities: readStringArray(record, "capabilities"),
    softwareVersion: readString(record, "softwareVersion", "softwareVersion", { required: false }) ?? null,
    metadata: readMetadata(record, "metadata"),
  };
}

export function parseWorkerLeaseRequest(params: URLSearchParams, fallbackWorker: string): WorkerLeaseRequest {
  const worker = (params.get("worker") || fallbackWorker).trim();
  if (!worker) fail("worker is required");

  const runningTasksRaw = params.get("runningTasks");
  const agentSlotsRaw = params.get("agentSlots");

  const runningTasks = runningTasksRaw == null ? 0 : Number.parseInt(runningTasksRaw, 10);
  const agentSlots = agentSlotsRaw == null ? 4 : Number.parseInt(agentSlotsRaw, 10);

  if (!Number.isFinite(runningTasks) || runningTasks < 0) fail("runningTasks must be a non-negative integer");
  if (!Number.isFinite(agentSlots) || agentSlots < 0) fail("agentSlots must be a non-negative integer");

  return { worker, runningTasks, agentSlots };
}

export function parseCentralTaskCreate(body: unknown): CentralTaskCreatePayload {
  const record = asRecord(body, "central task");

  return {
    title: readString(record, "title", "title")!,
    description: readString(record, "description", "description")!,
    project: readString(record, "project", "project")!,
    assignedWorker: readString(record, "assignedWorker", "assignedWorker")!,
    bee: normalizeWorkerKind(record.lane ?? record.bee),
    model: readString(record, "model", "model", { required: false }) ?? "opus",
    budget: readNumber(record, "budget", "budget", { required: false, min: 0 }) ?? 5,
    workflow: readString(record, "workflow", "workflow", { required: false }) ?? null,
    metadata: readMetadata(record, "metadata"),
    artifactRefs: Array.isArray(record.artifactRefs) ? record.artifactRefs.map(normalizeArtifactRef) : [],
    traceRefs: Array.isArray(record.traceRefs) ? record.traceRefs.map(normalizeTraceRef) : [],
  };
}

export function parseCentralTaskStatus(body: unknown): CentralTaskStatusPayload {
  const record = asRecord(body, "task status");
  const statusValue = readString(record, "status", "status", { required: false });
  if (statusValue && !isCentralTaskStatus(statusValue)) {
    fail(`status must be one of ${CENTRAL_TASK_STATUSES.join(", ")}`);
  }
  const status = statusValue && isCentralTaskStatus(statusValue) ? statusValue : undefined;

  return {
    status,
    workerStatus: readString(record, "workerStatus", "workerStatus", { required: false, allowEmpty: true }),
    output: readString(record, "output", "output", { required: false, allowEmpty: true }),
    cost: readNumber(record, "cost", "cost", { required: false, min: 0 }),
    turns: readNumber(record, "turns", "turns", { required: false, min: 0 }),
    error: readString(record, "error", "error", { required: false, allowEmpty: true }),
    completedAt: record.completedAt == null ? null : normalizeDateString(record.completedAt),
    artifactRefs: Array.isArray(record.artifactRefs) ? record.artifactRefs.map(normalizeArtifactRef) : undefined,
    traceRefs: Array.isArray(record.traceRefs) ? record.traceRefs.map(normalizeTraceRef) : undefined,
    events: Array.isArray(record.events) ? record.events.map(normalizeTaskEvent) : undefined,
  };
}

export function buildCentralTaskLease(task: {
  _id: unknown;
  title: string;
  description: string;
  project: string;
  model?: string | null;
  budget?: number | null;
  workflow?: string | null;
  metadata?: Record<string, unknown>;
  bee?: string | null;
  artifactRefs?: ArtifactRef[] | unknown[];
  traceRefs?: TraceRef[] | unknown[];
}): CentralTaskLeasePayload {
  return {
    _id: String(task._id),
    title: task.title,
    description: task.description,
    project: task.project,
    model: task.model || "opus",
    budget: typeof task.budget === "number" ? task.budget : 5,
    workflow: task.workflow ?? null,
    metadata: task.metadata ?? {},
    bee: normalizeWorkerKind(task.bee),
    artifactRefs: Array.isArray(task.artifactRefs) ? (task.artifactRefs as ArtifactRef[]) : [],
    traceRefs: Array.isArray(task.traceRefs) ? (task.traceRefs as TraceRef[]) : [],
  };
}

export function buildCentralTaskSummary(task: {
  _id: unknown;
  title: string;
  description: string;
  project: string;
  assignedWorker: string;
  status: string;
  workerStatus?: string | null;
  output?: string | null;
  cost?: number | null;
  turns?: number | null;
  error?: string | null;
  cancelRequested?: boolean;
  model?: string | null;
  budget?: number | null;
  workflow?: string | null;
  metadata?: Record<string, unknown>;
  bee?: string | null;
  artifactRefs?: ArtifactRef[] | unknown[];
  traceRefs?: TraceRef[] | unknown[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
  completedAt?: Date | string | null;
  lastEventAt?: Date | string | null;
  lastEventType?: string | null;
}) {
  return {
    _id: String(task._id),
    title: task.title,
    description: task.description,
    project: task.project,
    assignedWorker: task.assignedWorker,
    status: task.status,
    workerStatus: task.workerStatus ?? null,
    output: task.output ?? null,
    cost: task.cost ?? null,
    turns: task.turns ?? null,
    error: task.error ?? null,
    cancelRequested: task.cancelRequested === true,
    model: task.model || "opus",
    budget: typeof task.budget === "number" ? task.budget : 5,
    workflow: task.workflow ?? null,
    metadata: task.metadata ?? {},
    bee: normalizeWorkerKind(task.bee),
    artifactRefs: Array.isArray(task.artifactRefs) ? (task.artifactRefs as ArtifactRef[]) : [],
    traceRefs: Array.isArray(task.traceRefs) ? (task.traceRefs as TraceRef[]) : [],
    createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : null,
    updatedAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : null,
    completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
    lastEventAt: task.lastEventAt ? new Date(task.lastEventAt).toISOString() : null,
    lastEventType: task.lastEventType ?? null,
  };
}

export function buildWorkerSnapshot(worker: {
  _id: unknown;
  hostname: string;
  label?: string | null;
  lastSeen: Date | string;
  agentSlots?: number | null;
  runningTasks?: number | null;
  registeredAt?: Date | string | null;
  bee?: string | null;
  scopes?: string[] | null;
  capabilities?: string[] | null;
  softwareVersion?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const status = computeWorkerHealth(worker.lastSeen);

  return {
    _id: String(worker._id),
    hostname: worker.hostname,
    label: worker.label || worker.hostname,
    status,
    lastSeen: new Date(worker.lastSeen).toISOString(),
    agentSlots: worker.agentSlots ?? 0,
    runningTasks: worker.runningTasks ?? 0,
    registeredAt: worker.registeredAt ? new Date(worker.registeredAt).toISOString() : null,
    bee: normalizeWorkerKind(worker.bee),
    scopes: (worker.scopes ?? []).filter((scope): scope is WorkerTokenScope => typeof scope === "string" && isWorkerTokenScope(scope)),
    capabilities: (worker.capabilities ?? []).filter((capability): capability is string => typeof capability === "string"),
    softwareVersion: worker.softwareVersion ?? null,
    metadata: worker.metadata ?? {},
  };
}

export function createCentralEvent(input: Omit<CentralEvent, "id" | "createdAt"> & { createdAt?: string }): CentralEvent {
  return {
    id: randomUUID(),
    createdAt: normalizeDateString(input.createdAt),
    kind: input.kind,
    workerHostname: input.workerHostname,
    centralTaskId: input.centralTaskId,
    bee: input.bee,
    message: input.message,
    data: input.data,
  };
}
