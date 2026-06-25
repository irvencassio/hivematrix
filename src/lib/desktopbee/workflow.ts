/**
 * Desktop Lane proof-workflow runner.
 *
 * Executes a recipe (an ordered list of Desktop Lane actions) through the
 * approval-gated client, recording an audit trail: an AX-tree snapshot of the
 * target app before and after, plus per-step result + best-effort capture.
 * This is how a Phase 4 proof workflow runs — approval-gated, AX-audited,
 * driven by the local model.
 *
 * AX-tree before/after is the primary audit evidence (structured, deterministic,
 * vision-free — fits the local-model strategy). Screen capture is attached when
 * the helper's Screen Recording grant is active; otherwise the run still
 * completes with AX evidence.
 */

import {
  dispatchDesktopBeeAction,
  type DesktopBeeClientOptions,
} from "./client";
import type { DesktopBeeRequest, DesktopBeeResponse, DesktopBeeApprovalPolicy } from "./actions";

export interface RecipeStep extends DesktopBeeRequest {
  /** Human-readable intent for the audit log. */
  intent?: string;
  /** Whether this step has explicit human approval (for policy/approval tiers). */
  approved?: boolean;
}

export interface AuditEntry {
  index: number;
  intent: string;
  action: string;
  ok: boolean;
  strategy?: string;
  error?: string;
  captureRef?: string;
}

export interface WorkflowResult {
  recipe: string;
  app?: string;
  ok: boolean;
  steps: AuditEntry[];
  axBefore?: unknown;
  axAfter?: unknown;
  capture?: string | null;
  startedAt: string;
  finishedAt: string;
}

async function snapshotAx(app: string, opts: DesktopBeeClientOptions): Promise<unknown> {
  const r = await dispatchDesktopBeeAction({ action: "desktop.ax.query", app, params: { maxDepth: 4 } }, opts);
  return r.ok ? r.data : { error: r.error };
}

async function bestEffortCapture(tag: string, opts: DesktopBeeClientOptions): Promise<string | null> {
  const r = await dispatchDesktopBeeAction({ action: "desktop.capture", params: { tag } }, opts);
  return r.ok ? (r.captureRef ?? null) : null;
}

export interface RunRecipeOptions {
  name: string;
  app?: string;
  steps: RecipeStep[];
  policy?: DesktopBeeApprovalPolicy;
  port?: number;
  now?: () => string;
}

export async function runRecipe(opts: RunRecipeOptions): Promise<WorkflowResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const clientBase: DesktopBeeClientOptions = { policy: opts.policy, port: opts.port };

  const axBefore = opts.app ? await snapshotAx(opts.app, clientBase) : undefined;

  const audit: AuditEntry[] = [];
  let allOk = true;
  for (let i = 0; i < opts.steps.length; i++) {
    const step = opts.steps[i];
    const res: DesktopBeeResponse = await dispatchDesktopBeeAction(step, {
      ...clientBase,
      approved: step.approved,
    });
    audit.push({
      index: i,
      intent: step.intent ?? step.action,
      action: step.action,
      ok: res.ok,
      strategy: res.strategy,
      error: res.error,
      captureRef: res.captureRef,
    });
    if (!res.ok) { allOk = false; break; } // stop on first failure
  }

  const axAfter = opts.app ? await snapshotAx(opts.app, clientBase) : undefined;
  const capture = await bestEffortCapture(`${opts.name}-final`, clientBase);

  return {
    recipe: opts.name,
    app: opts.app,
    ok: allOk,
    steps: audit,
    axBefore,
    axAfter,
    capture,
    startedAt,
    finishedAt: now(),
  };
}
