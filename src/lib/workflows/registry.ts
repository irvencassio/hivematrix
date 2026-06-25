/**
 * Workflow Registry (MVP).
 *
 * A typed, deterministic catalog of repeatable business workflows so COO / model /
 * operator surfaces can DISCOVER them — lane, readiness needs, handoffs, artifacts,
 * runbook, and routing hints — without a bespoke endpoint per workflow.
 *
 * Definitions are PURE DATA: serializable, secret-free, no functions. A `handler`
 * string marker maps a workflow to an existing helper (the registry never holds the
 * execution logic). No prompt-defined workflows.
 */

import { ContractValidationError } from "@/lib/central/contracts";
import { normalizeLaneId, type LaneId } from "@/lib/lanes/contracts";

export interface WorkflowInputField {
  name: string;
  type: "string" | "string[]" | "boolean";
  required: boolean;
  description: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  lane: LaneId;
  capability: string;
  inputSchema: WorkflowInputField[];
  readiness: { required: boolean; siteId?: string; note: string };
  approvalPolicy: { mode: "manual" | "auto" | "confirm_external"; note: string };
  handoffPoints: string[];
  artifacts: string[];
  runbook: string;
  routing: { domains: string[]; phrases: string[]; tags: string[] };
  /** Marker that maps to an existing execution helper — never logic in the registry. */
  handler: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  lane: LaneId;
  runbook: string;
}

export interface WorkflowMatchQuery {
  text?: string;
  domains?: string[];
  tags?: string[];
}

const SECRET_KEY = /password|passwd|pwd|secret|token|cookie|session|credential|api[_-]?key|bearer|keychain/i;

function rejectSecretKeys(record: Record<string, unknown>, path = "workflow"): void {
  for (const [key, value] of Object.entries(record)) {
    if (SECRET_KEY.test(key)) throw new ContractValidationError(`${path}.${key} looks like a secret and is not allowed in a workflow definition`);
    if (value && typeof value === "object" && !Array.isArray(value)) rejectSecretKeys(value as Record<string, unknown>, `${path}.${key}`);
  }
}

/** Validate + normalize a workflow definition (lane canonicalized; no secret fields). */
export function normalizeWorkflowDefinition(input: WorkflowDefinition): WorkflowDefinition {
  if (!input || typeof input !== "object") throw new ContractValidationError("workflow definition must be an object");
  rejectSecretKeys(input as unknown as Record<string, unknown>);
  for (const field of ["id", "name", "description", "capability", "runbook", "handler"] as const) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new ContractValidationError(`workflow.${field} is required`);
  }
  return { ...input, lane: normalizeLaneId(input.lane) };
}

export interface WorkflowRegistry {
  list(): WorkflowDefinition[];
  get(id: string): WorkflowDefinition | null;
  match(query: WorkflowMatchQuery): WorkflowDefinition | null;
}

function host(value: string): string {
  const raw = value.trim().toLowerCase();
  try { return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname; } catch { return raw.replace(/^https?:\/\//, "").split("/")[0]; }
}
function hostMatch(a: string, b: string): boolean {
  return !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

/** Build a registry from definitions; validates unique ids + rejects secrets. */
export function createWorkflowRegistry(defs: WorkflowDefinition[]): WorkflowRegistry {
  const byId = new Map<string, WorkflowDefinition>();
  for (const raw of defs) {
    const def = normalizeWorkflowDefinition(raw);
    if (byId.has(def.id)) throw new ContractValidationError(`duplicate workflow id "${def.id}" — workflow ids must be unique`);
    byId.set(def.id, def);
  }
  // Deterministic order by id.
  const ordered = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    list: () => ordered.map((d) => ({ ...d })),
    get: (id) => (byId.has(id) ? { ...byId.get(id)! } : null),
    match: (query) => {
      const wantHosts = (query.domains ?? []).map(host).filter(Boolean);
      const text = (query.text ?? "").toLowerCase();
      const tags = new Set(query.tags ?? []);
      for (const def of ordered) {
        const domainHit = def.routing.domains.some((d) => wantHosts.some((w) => hostMatch(w, host(d))));
        const phraseHit = def.routing.phrases.some((p) => p && text.includes(p.toLowerCase()));
        const tagHit = def.routing.tags.some((t) => tags.has(t));
        if (domainHit || phraseHit || tagHit) return { ...def };
      }
      return null;
    },
  };
}

/** Compact, secret-free shape surfaced to COO / model / console. */
export function summarizeWorkflow(def: WorkflowDefinition): WorkflowSummary {
  return { id: def.id, name: def.name, lane: def.lane, runbook: def.runbook };
}

// Built-in workflows. Def-only modules (no runs store import) → no import cycle.
import { HEYGEN_PORTAL_VIDEO_WORKFLOW } from "./heygen-portal";
import { CONTENT_RESEARCH_BRIEF_WORKFLOW } from "./content-research-brief";
import { VIDEO_SCRIPT_WORKFLOW } from "./video-script-def";

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [HEYGEN_PORTAL_VIDEO_WORKFLOW, CONTENT_RESEARCH_BRIEF_WORKFLOW, VIDEO_SCRIPT_WORKFLOW];

let singleton: WorkflowRegistry | null = null;
export function getWorkflowRegistry(): WorkflowRegistry {
  if (!singleton) singleton = createWorkflowRegistry(BUILTIN_WORKFLOWS);
  return singleton;
}
