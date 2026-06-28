/**
 * Follow-up item creation service for Flight Loop passes.
 *
 * Generates work package items for failed or review source items with status
 * determined by risk level and loop auto-ready policy:
 *   high risk  → "held"  (operator approval required before it can run)
 *   low risk + autoReadySafeItems → "ready" (starts immediately on next advance)
 *   otherwise  → "draft" (queued for operator review)
 */

import { generateId, getDb } from "@/lib/db";
import { scrubSecretText } from "@/lib/workflows/runs";

export interface FollowUpSource {
  id: string;
  title: string;
  status: "failed" | "review";
  risk: "low" | "medium" | "high";
  blocker: string | null;
  /** Task output summary — already scrubbed and truncated by the caller. */
  taskOutput: string | null;
}

export interface CreateFollowUpItemsInput {
  packageId: string;
  sources: FollowUpSource[];
  /** Position to assign to the first created item; incremented for each subsequent item. */
  startPosition: number;
  autoReadySafeItems: boolean;
  /** personal_admin: all items start as draft regardless of risk */
  forceDraft?: boolean;
  /** release: risky items always held regardless of autoReadySafeItems */
  forceHeld?: boolean;
}

export interface FollowUpItemCreated {
  id: string;
  title: string;
  status: "draft" | "held" | "ready";
  risk: "low" | "medium" | "high";
}

/**
 * Resolves the initial status for a follow-up item. Pure function — no I/O.
 */
export function resolveFollowUpStatus(
  risk: "low" | "medium" | "high",
  autoReadySafeItems: boolean,
): "draft" | "held" | "ready" {
  if (risk === "high") return "held";
  if (risk === "low" && autoReadySafeItems) return "ready";
  return "draft";
}

export interface GateFollowUpSource {
  name: string;
  exitCode: number | null;
  /** Already scrubbed and truncated by the caller. */
  output: string;
}

/**
 * Creates follow-up items for failed repo gates (typecheck, tests, scope-wall).
 * Gates are always low-risk — local read-only checks. Status follows the same
 * resolveFollowUpStatus rules as item-based follow-ups.
 */
export function createGateFollowUpItems(input: {
  packageId: string;
  failedGates: GateFollowUpSource[];
  startPosition: number;
  autoReadySafeItems: boolean;
}): FollowUpItemCreated[] {
  if (input.failedGates.length === 0) return [];
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO work_package_items
      (_id, packageId, position, title, prompt, status, risk, dependsOn, scopeHints, executionMode)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'sequential')
  `);
  const created: FollowUpItemCreated[] = [];
  let pos = input.startPosition;
  for (const gate of input.failedGates) {
    const id = generateId();
    const risk = "low" as const;
    const status = resolveFollowUpStatus(risk, input.autoReadySafeItems);
    const title = scrubSecretText(`Fix failing gate: ${gate.name}`);
    const outputSnippet = gate.output ? ` Output: ${gate.output.slice(0, 300)}` : "";
    const prompt = scrubSecretText(
      `Repo gate "${gate.name}" failed (exit ${gate.exitCode ?? "unknown"}).${outputSnippet} Investigate and fix.`,
    );
    stmt.run(id, input.packageId, pos++, title, prompt, status, risk);
    created.push({ id, title, status, risk });
  }
  return created;
}

/**
 * Creates follow-up items for unmet Goal Flight success criteria.
 * Each unmet criterion gets a "Achieve: <criterion>" item at medium risk.
 */
export function createCriterionFollowUpItems(input: {
  packageId: string;
  unmetCriteria: string[];
  startPosition: number;
  autoReadySafeItems: boolean;
}): FollowUpItemCreated[] {
  if (input.unmetCriteria.length === 0) return [];
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO work_package_items
      (_id, packageId, position, title, prompt, status, risk, dependsOn, scopeHints, executionMode)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'sequential')
  `);
  const created: FollowUpItemCreated[] = [];
  let pos = input.startPosition;
  for (const criterion of input.unmetCriteria) {
    const id = generateId();
    const risk = "medium" as const;
    const status = resolveFollowUpStatus(risk, input.autoReadySafeItems);
    const title = scrubSecretText(`Achieve: ${criterion}`);
    const prompt = scrubSecretText(
      `Success criterion not yet satisfied: "${criterion}". Create and execute a plan to satisfy this requirement.`,
    );
    stmt.run(id, input.packageId, pos++, title, prompt, status, risk);
    created.push({ id, title, status, risk });
  }
  return created;
}

/**
 * Writes follow-up items to the DB for each source item and returns their
 * created records. Returns an empty array if sources is empty.
 */
export function createFollowUpItems(input: CreateFollowUpItemsInput): FollowUpItemCreated[] {
  if (input.sources.length === 0) return [];
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO work_package_items
      (_id, packageId, position, title, prompt, status, risk, dependsOn, scopeHints, executionMode)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'sequential')
  `);

  const created: FollowUpItemCreated[] = [];
  let pos = input.startPosition;

  for (const source of input.sources) {
    const id = generateId();
    let status: "draft" | "held" | "ready";
    if (input.forceDraft) {
      status = "draft";
    } else if (input.forceHeld && source.risk === "high") {
      status = "held";
    } else {
      status = resolveFollowUpStatus(source.risk, input.autoReadySafeItems);
    }
    const title = scrubSecretText(`Re-examine: ${source.title}`);
    const outputNote = source.taskOutput ? ` Output: ${source.taskOutput}` : "";
    const prompt = scrubSecretText(
      source.status === "failed"
        ? `Item failed${source.blocker ? ` with error: ${source.blocker}` : ""}.${outputNote} Investigate and fix: ${source.title}`
        : `Item needs review.${outputNote} Inspect and resolve: ${source.title}`,
    );

    stmt.run(id, input.packageId, pos++, title, prompt, status, source.risk);
    created.push({ id, title, status, risk: source.risk });
  }

  return created;
}
