/**
 * Role-based model router.
 *
 * Roles are the routing unit, not model IDs. The router resolves a role +
 * connectivity policy to a ModelTier, then maps that tier to concrete model
 * config. The router never hard-codes model IDs — those come from settings.
 *
 * Roles:
 *   think        — planning, review, architecture → frontier in cloud-ok, unavailable otherwise
 *   execute      — bulk coding, file ops, extraction → operational (Haiku) always in cloud-ok
 *   code-critical — final implementation, UI → frontier while headroom exists; else queue + unavailable
 *   image        — image generation → Nano Banana in cloud-ok; mflux in local/offline
 *   cheap-web    — Browser Lane summarization → operational (Haiku) always in cloud-ok
 *
 * Frontier-review debt: when code-critical runs on the operational tier due to
 * mode, a review task is enqueued so it gets a frontier pass when cloud-ok is
 * restored.
 */

import type { ConnectivityPolicy, ModelRole, ModelTier } from "@/lib/connectivity/policy";

export interface RouterResult {
  tier: ModelTier;
  role: ModelRole;
  /** True when a frontier review should be queued (code-critical ran locally) */
  reason: string;
}

export interface RouteOptions {
  /**
   * "Cloud-only" posture: never route to the cheap operational tier. Any role
   * that would resolve to operational is promoted to frontier when the cloud
   * is reachable, or marked unavailable otherwise (so the task waits for
   * cloud rather than silently falling back to a cheaper model).
   */
  noLocal?: boolean;
}

export function routeByRole(role: ModelRole, policy: ConnectivityPolicy, opts: RouteOptions = {}): RouterResult {
  let tier = policy.resolveModelTier(role);

  if (opts.noLocal && tier === "operational") {
    tier = policy.canUseCloud() ? "frontier" : "unavailable";
  }


  let reason: string;
  switch (tier) {
    case "frontier-premium":
      reason = `${role} → frontier-premium / Opus (cloud-ok)`;
      break;
    case "frontier":
      reason = `${role} → frontier (cloud-ok)`;
      break;
    case "operational":
      reason = `${role} → operational (connectivity: ${policy.mode})`;
      break;
    case "nanai":
      reason = `${role} → nanai (image generation)`;
      break;
    case "unavailable":
      reason = `${role} → unavailable (mode: ${policy.mode})`;
      break;
  }

  return { tier, role, reason };
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
  return true; // operational is always available (Haiku/Codex Spark, or an operator override)
}
