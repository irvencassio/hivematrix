/**
 * HiveMatrix-side DesktopBee client.
 *
 * Dispatches DesktopBee actions to the native Swift helper over its loopback
 * API, enforcing the approval tier first. Free-tier actions go straight
 * through; policy/approval-tier actions require the caller to have obtained
 * approval (or the lane policy to auto-approve) — otherwise the client refuses
 * to dispatch and returns a structured "approval required" response, so a
 * dangerous action can never reach the helper unapproved.
 */

import {
  decideApproval,
  type DesktopBeeRequest,
  type DesktopBeeResponse,
  type DesktopBeeApprovalPolicy,
} from "./actions";
import { readToken, HELPER_TOKEN_FILE } from "@/lib/auth/token";

const DEFAULT_HELPER_PORT = 3748;

function helperAuthHeader(): Record<string, string> {
  const token = readToken(HELPER_TOKEN_FILE);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface DesktopBeeClientOptions {
  port?: number;
  /** Lane/directive approval policy consulted before dispatch. */
  policy?: DesktopBeeApprovalPolicy;
  /** Explicit human approval already granted for this request (overrides tier gate). */
  approved?: boolean;
  timeoutMs?: number;
}

export function desktopBeeHelperUrl(port = DEFAULT_HELPER_PORT): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Dispatch a DesktopBee action. Returns the helper's response, or an
 * "approval required" response if the action is gated and not approved.
 */
export async function dispatchDesktopBeeAction(
  req: DesktopBeeRequest,
  options: DesktopBeeClientOptions = {}
): Promise<DesktopBeeResponse> {
  const decision = decideApproval(req, options.policy);
  const approved = decision.autoApproved || options.approved === true;
  if (!approved) {
    return {
      ok: false,
      action: req.action,
      requestId: req.requestId,
      error: `approval required (${decision.tier}): ${decision.reason}`,
    };
  }

  const url = desktopBeeHelperUrl(options.port);
  try {
    const res = await fetch(`${url}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...helperAuthHeader() },
      // Carry the approved flag so the helper can enforce its own server-side
      // approval gate (defence-in-depth: the helper refuses act/script without it).
      body: JSON.stringify({ ...req, approved }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
      return { ok: false, action: req.action, requestId: req.requestId, error: `helper HTTP ${res.status}` };
    }
    return await res.json() as DesktopBeeResponse;
  } catch (err) {
    return {
      ok: false,
      action: req.action,
      requestId: req.requestId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Probe the helper's health endpoint. Returns null if unreachable. */
export async function probeDesktopBeeHelper(
  port = DEFAULT_HELPER_PORT,
  timeoutMs = 3_000
): Promise<{ version: string } | null> {
  try {
    const res = await fetch(`${desktopBeeHelperUrl(port)}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; version?: string };
    return data.ok ? { version: data.version ?? "?" } : null;
  } catch {
    return null;
  }
}
