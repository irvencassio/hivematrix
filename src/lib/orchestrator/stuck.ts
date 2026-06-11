import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { Task } from "@/lib/db";
import { broadcast } from "@/lib/ws/broadcaster";
import { notifySuperwhisperPermissionRequest } from "@/lib/integrations/superwhisper-hive";

const APPROVALS_DIR = join(process.env.HOME!, ".hivematrix", "approvals");
const STUCK_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour default — matches human reply latency

if (!existsSync(APPROVALS_DIR)) mkdirSync(APPROVALS_DIR, { recursive: true });

export interface StuckRequest {
  taskId: string;
  timestamp: string;
  reason: string;
  lastOutput: string;
  options: string[]; // ["retry", "skip", "abort"] + any custom
  missionId: string | null;
  source: "agent" | "watchdog";
}

export interface StuckDecision {
  decision: string; // "retry" | "skip" | "abort" | custom free-text token
  text: string; // optional free-text reply from human
}

/**
 * Raise a "stuck" request. Returns a promise that resolves to the human's
 * decision (or null on timeout). The MCP tool `hive_ask_human` awaits this.
 *
 * Stored as `~/.hivematrix/approvals/stuck-<taskId>-<ts>.json` so it's visible
 * alongside approvals in the UI. Decision is written as `<same>.decision`
 * and optional free text as `<same>.reply`.
 */
export async function raiseStuck(
  taskId: string,
  reason: string,
  lastOutput: string,
  source: "agent" | "watchdog" = "agent",
  options: string[] = ["retry", "skip", "abort"]
): Promise<StuckDecision | null> {
  const timestamp = String(Date.now() * 1000); // nanosecond-ish for uniqueness
  const requestFile = join(APPROVALS_DIR, `stuck-${taskId}-${timestamp}.json`);
  const decisionFile = join(APPROVALS_DIR, `stuck-${taskId}-${timestamp}.decision`);
  const replyFile = join(APPROVALS_DIR, `stuck-${taskId}-${timestamp}.reply`); // legacy sidecar, read-only

  let missionId: string | null = null;
  try {
    const task = await Task.findById(taskId);
    missionId = (task?.missionId as string) ?? null;
  } catch {
    // non-blocking
  }

  const req: StuckRequest = {
    taskId,
    timestamp,
    reason: redactSecrets(reason),
    lastOutput: redactSecrets(lastOutput.slice(-4000)),
    options,
    missionId,
    source,
  };

  writeFileSync(requestFile, JSON.stringify(req), { mode: 0o600 });

  // Broadcast so dashboards + Telegram adapter see it immediately.
  broadcast({
    type: "task:log",
    taskId,
    log: {
      type: "stuck_request",
      content: `Stuck: ${req.reason}`,
      stuckTimestamp: timestamp,
      reason: req.reason,
      options,
      source,
      missionId,
    },
  });
  notifySuperwhisperPermissionRequest(taskId, {
    timestamp,
    tool: "AskUserQuestion",
    command: req.reason,
    context: req.lastOutput,
  });

  // Poll for decision.
  const start = Date.now();
  while (Date.now() - start < STUCK_TIMEOUT_MS) {
    if (existsSync(decisionFile)) {
      const raw = readFileSync(decisionFile, "utf-8");
      let decision = raw.trim();
      let text = "";
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          decision = String(parsed.decision ?? "").trim();
          text = String(parsed.text ?? "");
        }
      } catch {
        // Legacy plain-text decision file — keep as-is; try the old .reply sidecar.
        if (existsSync(replyFile)) text = readFileSync(replyFile, "utf-8");
      }
      broadcast({
        type: "stuck:resolved",
        taskId,
        timestamp,
        decision,
      });
      return { decision, text };
    }
    await sleep(2000);
  }

  broadcast({
    type: "stuck:resolved",
    taskId,
    timestamp,
    decision: "timeout",
  });
  return null;
}

/**
 * Human-side: write the decision (and optional free-text) for a stuck request.
 * First-write-wins so Telegram + dashboard don't both act on the same request.
 */
export async function resolveStuck(
  taskId: string,
  timestamp: string,
  decision: string,
  via: string,
  text?: string
): Promise<boolean> {
  const decisionFile = join(APPROVALS_DIR, `stuck-${taskId}-${timestamp}.decision`);
  const requestFile = join(APPROVALS_DIR, `stuck-${taskId}-${timestamp}.json`);

  if (!existsSync(requestFile)) return false;

  // Validate decision is one of the originally-offered options (plus "reply"
  // and "timeout" sentinels). Prevents an allowlisted caller from injecting
  // arbitrary strings that flow back to the agent as the `decision` field.
  try {
    const req: StuckRequest = JSON.parse(readFileSync(requestFile, "utf-8"));
    const allowed = new Set([...(req.options ?? []), "reply", "timeout"]);
    if (!allowed.has(decision)) return false;
  } catch {
    return false;
  }

  // Cap free-text length before it reaches the agent (prompt-injection budget).
  const safeText = (text ?? "").slice(0, 2000);
  const payload = JSON.stringify({ decision, text: safeText });

  try {
    writeFileSync(decisionFile, payload, { flag: "wx", mode: 0o600 });
  } catch {
    return false; // already resolved
  }

  broadcast({
    type: "task:log",
    taskId,
    log: {
      type: "text",
      content: `Nudge via ${via}: ${decision}${safeText ? ` — "${safeText}"` : ""}`,
    },
  });
  return true;
}

/** List open stuck requests (no decision file yet) so adapters can re-hydrate on start. */
export function getPendingStuck(): StuckRequest[] {
  try {
    const files = readdirSync(APPROVALS_DIR);
    const stuckJson = files.filter((f) => f.startsWith("stuck-") && f.endsWith(".json"));
    const out: StuckRequest[] = [];
    for (const f of stuckJson) {
      const decFile = f.replace(".json", ".decision");
      if (files.includes(decFile)) continue;
      try {
        out.push(JSON.parse(readFileSync(join(APPROVALS_DIR, f), "utf-8")));
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ----- helpers -----

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Aggressive secret redaction for outbound messages. Not perfect — belt and
 * suspenders alongside "don't put secrets in prompts". Redacts:
 *  - `API_KEY=xxx` or `TOKEN=xxx` style env assignments
 *  - Long base64-ish blobs (>= 32 chars)
 *  - `sk-…` / `Bearer …`
 */
function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g, "***REDACTED PRIVATE KEY***")
    .replace(/\b(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|SESSION|COOKIE|PRIVATE[_-]?KEY)\s*[:=]\s*\S+/gi, "$1=***REDACTED***")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 ***REDACTED***")
    .replace(/\bghp_[A-Za-z0-9]{30,}\b/g, "ghp_***REDACTED***")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, "github_pat_***REDACTED***")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]+\b/g, "xox***REDACTED***")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***REDACTED***")
    .replace(/\bAIza[0-9A-Za-z\-_]{35}\b/g, "AIza***REDACTED***")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-***REDACTED***")
    .replace(/\b(?:sk|pk)_live_[A-Za-z0-9]{20,}\b/g, "***REDACTED STRIPE KEY***")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "***REDACTED JWT***")
    .replace(/\b[A-Za-z0-9+/=]{40,}\b/g, (m) => `${m.slice(0, 8)}…[${m.length}b-redacted]`);
}
