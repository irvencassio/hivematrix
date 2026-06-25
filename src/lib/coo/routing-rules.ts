import { ContractValidationError } from "@/lib/central/contracts";
import { normalizeLaneId, type LaneId } from "@/lib/lanes/contracts";

export const COO_BACKEND_POLICIES = [
  "lane_owned_first",
  "local_only",
  "local_first_frontier_on_failure",
  "frontier_only",
  "escalation_only",
] as const;
export type CooBackendPolicy = (typeof COO_BACKEND_POLICIES)[number];

export const COO_MODEL_POSTURES = [
  "local_only",
  "mixed-local-first",
  "local_first_frontier_on_failure",
  "mixed-claude",
  "mixed-codex",
  "frontier-claude",
  "frontier-codex",
] as const;
export type CooModelPosture = (typeof COO_MODEL_POSTURES)[number];

export const COO_RISK_TIERS = ["low", "normal", "external_side_effect", "sensitive", "destructive"] as const;
export type CooRiskTier = (typeof COO_RISK_TIERS)[number];

export interface CooRoutingMatch {
  phrases: string[];
  domains: string[];
  projects: string[];
  workflows: string[];
  tags: string[];
}

export interface CooRoutingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  intent: string;
  match: CooRoutingMatch;
  constraints: Record<string, unknown>;
  lane: LaneId;
  capability: string;
  backendPolicy: CooBackendPolicy;
  modelPosture: CooModelPosture;
  riskTier: CooRiskTier;
  approvalPolicy: Record<string, unknown>;
  verificationPolicy: Record<string, unknown>;
  notes: string;
}

export interface CooRouteRequest {
  text: string;
  domains?: string[];
  project?: string | null;
  workflow?: string | null;
  tags?: string[];
}

export interface CooResolvedRoute {
  ruleId: string;
  ruleName: string;
  lane: LaneId;
  capability: string;
  backendPolicy: CooBackendPolicy;
  modelPosture: CooModelPosture;
  riskTier: CooRiskTier;
  approvalPolicy: Record<string, unknown>;
  verificationPolicy: Record<string, unknown>;
}

type UnknownRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new ContractValidationError(message);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as UnknownRecord;
}

function readString(record: UnknownRecord, key: string, fallback?: string): string {
  const value = record[key];
  if (value == null && fallback != null) return fallback;
  if (typeof value !== "string" || value.trim().length === 0) fail(`${key} is required`);
  return value.trim();
}

function readBoolean(record: UnknownRecord, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(record: UnknownRecord, key: string, fallback: number): number {
  const value = record[key];
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${key} must be a number`);
  return parsed;
}

function readObject(record: UnknownRecord, key: string): Record<string, unknown> {
  const value = record[key];
  if (value == null) return {};
  return asRecord(value, key);
}

function normalizeStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("match arrays must be arrays");
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)));
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], label: string): T[number] {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") fail(`${label} must be a string`);
  const normalized = value.trim();
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T[number];
  fail(`${label} must be one of: ${allowed.join(", ")}`);
}

function rejectPromptLikeKeys(record: UnknownRecord, path = "rule"): void {
  for (const [key, value] of Object.entries(record)) {
    if (/prompt|system|instruction/i.test(key)) {
      fail(`${path}.${key} looks like prompt text; COO routing rules must be typed`);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      rejectPromptLikeKeys(value as UnknownRecord, `${path}.${key}`);
    }
  }
}

function normalizeMatch(value: unknown): CooRoutingMatch {
  const record = value == null ? {} : asRecord(value, "match");
  rejectPromptLikeKeys(record, "match");
  return {
    phrases: normalizeStringArray(record.phrases),
    domains: normalizeStringArray(record.domains).map((domain) => domain.toLowerCase()),
    projects: normalizeStringArray(record.projects),
    workflows: normalizeStringArray(record.workflows),
    tags: normalizeStringArray(record.tags),
  };
}

export function normalizeCooRoutingRule(value: unknown): CooRoutingRule {
  const record = asRecord(value, "routing rule");
  rejectPromptLikeKeys(record);
  return {
    id: readString(record, "id"),
    name: readString(record, "name"),
    priority: readNumber(record, "priority", 0),
    enabled: readBoolean(record, "enabled", true),
    intent: readString(record, "intent"),
    match: normalizeMatch(record.match),
    constraints: readObject(record, "constraints"),
    lane: normalizeLaneId(record.lane),
    capability: readString(record, "capability"),
    backendPolicy: normalizeEnum(record.backendPolicy, COO_BACKEND_POLICIES, "lane_owned_first", "backendPolicy"),
    modelPosture: normalizeEnum(record.modelPosture, COO_MODEL_POSTURES, "mixed-local-first", "modelPosture"),
    riskTier: normalizeEnum(record.riskTier, COO_RISK_TIERS, "normal", "riskTier"),
    approvalPolicy: readObject(record, "approvalPolicy"),
    verificationPolicy: readObject(record, "verificationPolicy"),
    notes: typeof record.notes === "string" ? record.notes : "",
  };
}

function domainMatches(requestDomain: string, ruleDomain: string): boolean {
  const normalizedRequest = requestDomain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  const normalizedRule = ruleDomain.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return normalizedRequest === normalizedRule || normalizedRequest.endsWith(`.${normalizedRule}`);
}

function ruleMatches(request: CooRouteRequest, rule: CooRoutingRule): boolean {
  const text = request.text.toLowerCase();
  const phraseMatch = rule.match.phrases.length === 0 || rule.match.phrases.some((phrase) => text.includes(phrase.toLowerCase()));
  const domainMatch = rule.match.domains.length === 0 || (request.domains ?? []).some((domain) => rule.match.domains.some((ruleDomain) => domainMatches(domain, ruleDomain)));
  const projectMatch = rule.match.projects.length === 0 || (request.project != null && rule.match.projects.includes(request.project));
  const workflowMatch = rule.match.workflows.length === 0 || (request.workflow != null && rule.match.workflows.includes(request.workflow));
  const requestTags = new Set(request.tags ?? []);
  const tagMatch = rule.match.tags.length === 0 || rule.match.tags.some((tag) => requestTags.has(tag));
  return phraseMatch && domainMatch && projectMatch && workflowMatch && tagMatch;
}

export function resolveCooRoute(request: CooRouteRequest, rules: CooRoutingRule[]): CooResolvedRoute | null {
  const match = [...rules]
    .filter((rule) => rule.enabled && ruleMatches(request, rule))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))[0];
  if (!match) return null;
  return {
    ruleId: match.id,
    ruleName: match.name,
    lane: match.lane,
    capability: match.capability,
    backendPolicy: match.backendPolicy,
    modelPosture: match.modelPosture,
    riskTier: match.riskTier,
    approvalPolicy: match.approvalPolicy,
    verificationPolicy: match.verificationPolicy,
  };
}
