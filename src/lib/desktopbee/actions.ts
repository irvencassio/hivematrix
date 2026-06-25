/**
 * DesktopBee action contract — the structured protocol HiveMatrix speaks to the
 * native Swift helper daemon over a loopback API.
 *
 * Mirrors the Browser Lane/Canopy principle a third time: a signed native helper
 * owns the dangerous surface (Accessibility, CGEvent, ScreenCapture, AppleScript);
 * agents speak only this structured contract; nothing sensitive flows through
 * prompts. Each action carries an approval tier so the HiveMatrix lane can gate
 * act/script operations while letting read-only AX queries run freely.
 *
 * Strategy order an agent should prefer (most reliable first):
 *   1. script.run  — AppleScript/JXA where the app is scriptable
 *   2. ax.query/ax.act — AX-tree semantic actions (structured, no vision)
 *   3. click/type by coordinate — last resort, always capture-verified
 */

export const DESKTOPBEE_ACTIONS = [
  "desktop.apps.list",   // list running/launchable apps (read)
  "desktop.app.launch",  // launch an app / open a file via `open` (act, no Automation)
  "desktop.app.activate", // bring an app to the foreground (act)
  "desktop.ax.query",    // read the Accessibility tree of an app/window (read)
  "desktop.ax.act",      // press/setValue/menu on an AX element (act)
  "desktop.type",        // synthesize keystrokes (act)
  "desktop.click",       // synthesize a mouse click at a point/element (act)
  "desktop.capture",     // ScreenCaptureKit screenshot for verification (read)
  "desktop.script.run",  // run AppleScript/JXA, allowlisted apps (approval)
  "desktop.permissions", // read/prompt Accessibility + Screen Recording status (read)
] as const;

export type DesktopBeeAction = (typeof DESKTOPBEE_ACTIONS)[number];

/**
 * Approval tier for an action:
 *   free     — read-only, no approval (AX query, capture, apps list)
 *   policy   — act on the UI; allowed per the directive/lane approval policy
 *   approval — always requires explicit human approval by default (script.run,
 *              and any act on a non-allowlisted app)
 */
export type DesktopBeeTier = "free" | "policy" | "approval";

const ACTION_TIER: Record<DesktopBeeAction, DesktopBeeTier> = {
  "desktop.apps.list": "free",
  "desktop.ax.query": "free",
  "desktop.capture": "free",
  "desktop.permissions": "free",
  "desktop.app.launch": "policy",
  "desktop.app.activate": "policy",
  "desktop.ax.act": "policy",
  "desktop.type": "policy",
  "desktop.click": "policy",
  "desktop.script.run": "approval",
};

export function actionTier(action: DesktopBeeAction): DesktopBeeTier {
  return ACTION_TIER[action];
}

// ---------------------------------------------------------------------------
// Request / response envelopes
// ---------------------------------------------------------------------------

export interface DesktopBeeRequest {
  action: DesktopBeeAction;
  /** Bundle id or app name the action targets (where applicable). */
  app?: string;
  /** Action-specific parameters (AX path, coordinates, keystrokes, script…). */
  params?: Record<string, unknown>;
  /** Correlation id for the audit log. */
  requestId?: string;
}

export interface DesktopBeeResponse {
  ok: boolean;
  action: DesktopBeeAction;
  requestId?: string;
  /** Action result payload (AX tree, app list, capture ref, etc.). */
  data?: unknown;
  /** Path to a before/after capture written for the audit log, if any. */
  captureRef?: string;
  error?: string;
  /** Which strategy the helper used: script | ax | coordinate. */
  strategy?: "script" | "ax" | "coordinate";
}

export interface DesktopBeeApprovalDecision {
  action: DesktopBeeAction;
  tier: DesktopBeeTier;
  /** True when the action may proceed without a human approval prompt. */
  autoApproved: boolean;
  reason: string;
}

export interface DesktopBeeApprovalPolicy {
  /** Apps allowed for act-tier operations without escalation. */
  appAllowlist?: string[];
  /** When true, policy-tier acts auto-approve (within the allowlist). */
  autoApprovePolicyTier?: boolean;
  /** When true, even script.run auto-approves (dangerous; off by default). */
  autoApproveScripts?: boolean;
}

/**
 * Decide whether an action may proceed without a human approval prompt, given
 * the lane/directive approval policy. The Swift helper is the enforcer of last
 * resort, but this is the HiveMatrix-side gate consulted before dispatch.
 */
export function decideApproval(
  req: DesktopBeeRequest,
  policy: DesktopBeeApprovalPolicy = {}
): DesktopBeeApprovalDecision {
  const tier = actionTier(req.action);
  const app = req.app;
  const allowlisted = !app || (policy.appAllowlist ?? []).includes(app);

  if (tier === "free") {
    return { action: req.action, tier, autoApproved: true, reason: "read-only action" };
  }

  if (tier === "approval") {
    const auto = policy.autoApproveScripts === true && allowlisted;
    return {
      action: req.action,
      tier,
      autoApproved: auto,
      reason: auto ? "scripts auto-approved by policy (allowlisted app)" : "script execution requires approval",
    };
  }

  // policy tier
  if (!allowlisted) {
    return { action: req.action, tier, autoApproved: false, reason: `app "${app}" not in allowlist` };
  }
  const auto = policy.autoApprovePolicyTier === true;
  return {
    action: req.action,
    tier,
    autoApproved: auto,
    reason: auto ? "act auto-approved by policy (allowlisted app)" : "act requires approval",
  };
}

export function isDesktopBeeAction(value: unknown): value is DesktopBeeAction {
  return typeof value === "string" && (DESKTOPBEE_ACTIONS as readonly string[]).includes(value);
}
