/**
 * Writer-role model resolution. "Writing" work (video scripts, briefings,
 * summaries, drafted messages) shares one operator-pickable model preference —
 * the `writer` role in Settings → Models (config key `writerModel`).
 *
 * Unlike the fixed role→tier roles, the writer can be EITHER frontier or local,
 * so it gets its own resolver instead of the generic router:
 *   - a frontier model id  → that model when cloud-ok, local fallback when offline
 *   - a local model id     → locked to free/local always
 *   - unset (default)      → frontier favorite when cloud-ok, local otherwise
 */

import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { resolveModelId } from "@/lib/routing/model-resolver";
import { getRoleModels } from "./available";

export type WriterProvider = "anthropic" | "codex" | "local";

export interface WriterResolution {
  provider: WriterProvider;
  modelId: string | null;
  lockedLocal: boolean; // operator pinned a local model (free)
  reason: string;
}

const FRONTIER_RE = /^(claude-|codex:|gpt-|o[0-9])/i;

/** Pure: does this model id name a frontier (cloud) model vs a local one? */
export function isFrontierModelId(id: string): boolean {
  return FRONTIER_RE.test((id || "").trim());
}

/**
 * Resolve the model writing tasks should use, from the writer-role setting +
 * connectivity. `getWriter`/`canUseCloud` are injectable for tests.
 */
export function resolveWriterModel(opts: { canUseCloud?: boolean; writerModel?: string } = {}): WriterResolution {
  const choice = (opts.writerModel ?? getRoleModels().writer ?? "").trim();
  const canCloud = opts.canUseCloud ?? getConnectivityPolicy().canUseCloud();

  // Operator pinned a local model → lock everything writing to free/local.
  if (choice && !isFrontierModelId(choice)) {
    return { provider: "local", modelId: choice, lockedLocal: true, reason: "writer locked to a local model" };
  }
  // Offline (or local-only posture) → local regardless of the pick.
  if (!canCloud) {
    return { provider: "local", modelId: resolveModelId("local-primary"), lockedLocal: false, reason: "offline → local writer" };
  }
  // Frontier: the chosen frontier model, else the frontier favorite.
  const modelId = choice && isFrontierModelId(choice) ? choice : resolveModelId("frontier");
  const provider: WriterProvider = modelId && /^codex:/i.test(modelId) ? "codex" : "anthropic";
  return { provider, modelId, lockedLocal: false, reason: choice ? "writer → chosen frontier model (cloud-ok)" : "writer → default frontier (cloud-ok)" };
}
