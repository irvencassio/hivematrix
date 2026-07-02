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
        out.push(e);
      } catch { /* skip malformed line */ }
    }
    if (out.length >= limit) break;
  }
  return out;
}
