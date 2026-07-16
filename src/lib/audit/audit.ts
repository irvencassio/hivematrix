/**
 * Audit log — an append-only, SIEM-friendly record of agent activity for
 * enterprise/regulated compliance: what each task was asked (prompt), which
 * model/agent ran it, the outcome, and what changed (diff stat). Written as JSONL
 * (one object per line — what Splunk/Elastic ingest) in daily files under
 * ~/.hivematrix/audit, never returning secrets. Bounded; never throws.
 */

import { appendFileSync, readFileSync, readdirSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { scrubSecrets } from "../vault/redaction";

export interface AuditEntry {
  ts: string;
  event: string;
  taskId?: string;
  agentType?: string;
  model?: string;
  project?: string;
  prompt?: string;
  summary?: string;
  status?: string;
  filesChanged?: string[];
  diffStat?: string;
  turns?: number;
  /**
   * Who triggered this action — the operator/agent identity (e.g. "cli", "hive",
   * "voice", "operator"). Canopy's "every action logged with your identity"
   * guarantee; lanes that carry a requestedBy string should stamp it here.
   */
  actor?: string;
  /**
   * What the action touched — a URL, site id, host, credential ref, or session
   * id. Never a secret value (scrubbed like every other field).
   */
  target?: string;
  /** Whether an autonomous agent or a human triggered this action — drives the History Panel's Agent/Human filter. */
  actorKind?: "agent" | "human";
}

export interface RecordAuditOptions {
  now?: () => string;
  /** Vault canary values (and any other literal secrets) to redact from trace fields. */
  redact?: string[];
}

const PROMPT_MAX = 4_000;
const SUMMARY_MAX = 2_000;
const DIFF_MAX = 4_000;

function auditDir(): string {
  const dir = join(homedir(), ".hivematrix", "audit");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function clamp(s: string | undefined, max: number): string | undefined {
  return s == null ? undefined : s.length > max ? s.slice(0, max) + "…[truncated]" : s;
}

/** Append one audit entry as JSONL. Stamps `ts` if absent; clamps long fields. */
export function recordAudit(entry: AuditEntry, options: RecordAuditOptions = {}): void {
  const now = options.now ?? (() => new Date().toISOString());
  const redacted = scrubSecrets(entry, options.redact ?? []) as AuditEntry;
  const ts = redacted.ts || now();
  const safe: AuditEntry = {
    ...redacted,
    ts,
    prompt: clamp(redacted.prompt, PROMPT_MAX),
    summary: clamp(redacted.summary, SUMMARY_MAX),
    diffStat: clamp(redacted.diffStat, DIFF_MAX),
  };
  try {
    appendFileSync(join(auditDir(), `audit-${ts.slice(0, 10)}.jsonl`), JSON.stringify(safe) + "\n");
  } catch { /* best effort — auditing must never break a task */ }
}

export interface ReadAuditOptions {
  limit?: number;
  taskId?: string;
  status?: string;
  event?: string;
  actorKind?: "agent" | "human";
  target?: string;
  eventPrefix?: string;
  since?: string;
  until?: string;
}

/** Read recent audit entries (newest first) across daily files, filtered. */
export function readAudit(opts: ReadAuditOptions = {}): AuditEntry[] {
  const limit = opts.limit ?? 200;
  let files: string[];
  try {
    files = readdirSync(auditDir()).filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse();
  } catch {
    return [];
  }
  const out: AuditEntry[] = [];
  for (const f of files) {
    let lines: string[];
    try { lines = readFileSync(join(auditDir(), f), "utf-8").split("\n").filter(Boolean); } catch { continue; }
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const e = JSON.parse(lines[i]) as AuditEntry;
        if (opts.taskId && e.taskId !== opts.taskId) continue;
        if (opts.status && e.status !== opts.status) continue;
        if (opts.event && e.event !== opts.event) continue;
        if (opts.actorKind && e.actorKind !== opts.actorKind) continue;
        if (opts.target && !e.target?.toLowerCase().includes(opts.target.toLowerCase())) continue;
        if (opts.eventPrefix && !e.event.startsWith(opts.eventPrefix)) continue;
        if (opts.since && e.ts < opts.since) continue;
        if (opts.until && e.ts > opts.until) continue;
        out.push(e);
      } catch { /* skip malformed line */ }
    }
    if (out.length >= limit) break;
  }
  return out;
}
