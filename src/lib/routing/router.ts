/**
 * Role-based model router.
 *
 * Roles are the routing unit, not model IDs. The router resolves a role +
 * connectivity policy to a ModelTier, then maps that tier to concrete model
 * config. The router never hard-codes model IDs — those come from settings.
 *
 * Roles:
 *   think        — planning, review, architecture → frontier in cloud-ok, local-primary otherwise
 *   execute      — bulk coding, file ops, extraction → local-secondary always (cheapest local)
 *   code-critical — final implementation, UI → frontier while headroom exists; else queue + local
 *   image        — image generation → Nano Banana in cloud-ok; mflux in local/offline
 *   cheap-web    — WebBee summarization → local-secondary always
 *
 * Frontier-review debt: when code-critical runs on local due to mode, a review
 * task is enqueued so it gets a frontier pass when cloud-ok is restored.
 */

import type { ConnectivityPolicy, ModelRole, ModelTier } from "@/lib/connectivity/policy";

export interface RouterResult {
  tier: ModelTier;
  role: ModelRole;
  /** True when a frontier review should be queued (code-critical ran locally) */
  frontierReviewDebt: boolean;
  reason: string;
}

export interface RouteOptions {
  /**
   * "Cloud-only" posture: never route to the local model. Any role that would
   * resolve to a local tier is promoted to frontier when the cloud is
   * reachable, or marked unavailable otherwise (so the task waits for cloud
   * rather than silently falling back to local Qwen).
   */
  noLocal?: boolean;
}

export function routeByRole(role: ModelRole, policy: ConnectivityPolicy, opts: RouteOptions = {}): RouterResult {
  let tier = policy.resolveModelTier(role);

  if (opts.noLocal && (tier === "local-primary" || tier === "local-secondary")) {
    tier = policy.canUseCloud() ? "frontier" : "unavailable";
  }

  // code-critical that did NOT land on frontier accrues frontier-review debt —
  // except under noLocal, where an unavailable tier means "wait for cloud", not
  // "ran locally", so there is nothing to review later.
  const frontierReviewDebt = role === "code-critical" && tier !== "frontier" && tier !== "unavailable";

  let reason: string;
  switch (tier) {
    case "frontier-premium":
      reason = `${role} → frontier-premium / Opus (cloud-ok)`;
      break;
    case "frontier":
      reason = `${role} → frontier (cloud-ok)`;
      break;
    case "local-primary":
      reason = `${role} → local-primary (connectivity: ${policy.mode})`;
      break;
    case "local-secondary":
      reason = `${role} → local-secondary (bulk/cheap path)`;
      break;
    case "nanai":
      reason = `${role} → nanai (image generation)`;
      break;
    case "unavailable":
      reason = `${role} → unavailable (mode: ${policy.mode})`;
      break;
  }

  return { tier, role, frontierReviewDebt, reason };
}

/** Convenience: resolve multiple roles at once. */
export function routeMultiple(
  roles: ModelRole[],
  policy: ConnectivityPolicy
): Record<ModelRole, RouterResult> {
  const result = {} as Record<ModelRole, RouterResult>;
  for (const role of roles) {
    result[role] = routeByRole(role, policy);
  }
  return result;
}

/** Returns true when the given tier is satisfied by the connectivity policy. */
export function isTierAvailable(tier: ModelTier, policy: ConnectivityPolicy): boolean {
  if (tier === "unavailable") return false;
  if (tier === "frontier-premium" || tier === "frontier" || tier === "nanai") return policy.canUseCloud();
  return true; // local-primary and local-secondary are always available (if model loaded)
}
