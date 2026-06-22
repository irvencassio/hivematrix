/**
 * Scan-on-install — heuristic content checks for imported/pulled skills.
 *
 * The 2026 registry research is blunt: ~37% of public skills carry a security
 * flaw and confirmed-malicious payloads exist. HiveMatrix's posture is "won't
 * auto-trust an unscanned/flagged skill": this scanner flags prompt-injection,
 * data-exfiltration, destructive commands, and obfuscation. A `block` verdict
 * vetoes auto-trust even for signed/team/personal skills (defense in depth).
 * Pure — fully testable.
 */

import type { Skill, SkillKind, ScanVerdict } from "./contracts";

export type ScanSeverity = "low" | "med" | "high";
export type { ScanVerdict };

export interface ScanFinding { rule: string; severity: ScanSeverity; detail: string }
export interface ScanResult { verdict: ScanVerdict; findings: ScanFinding[] }

interface Rule {
  rule: string;
  re: RegExp;
  severity: ScanSeverity;
  /** Severity override when the skill is a script (executable). */
  scriptSeverity?: ScanSeverity;
  detail: string;
}

// Rules run over the skill body. Execution-oriented rules escalate for scripts.
const RULES: Rule[] = [
  { rule: "prompt-injection", severity: "high",
    re: /\b(ignore|disregard|forget)\b[^\n]{0,40}\b(previous|prior|earlier|above|system)\b[^\n]{0,40}\b(instruction|prompt|rule|message)/i,
    detail: "tries to override prior/system instructions" },
  { rule: "exfil-instruction", severity: "high",
    re: /\bdo\s+not\s+(tell|inform|mention|notify|reveal)\b[^\n]{0,30}\b(the\s+)?(user|operator|owner)/i,
    detail: "instructs the agent to hide actions from the user" },
  { rule: "pipe-to-shell", severity: "high",
    re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?)\b/i,
    detail: "downloads and executes remote code (curl|wget … | sh)" },
  { rule: "obfuscated-exec", severity: "high",
    re: /base64\s+(--decode|-d|-D)\b[^\n]*\|\s*(sh|bash|zsh|python3?)/i,
    detail: "decodes and executes obfuscated payload" },
  { rule: "destructive-rm", severity: "high",
    re: /\brm\s+-[rfRF]{1,2}\s+(\/|~|\$HOME|\*)/,
    detail: "recursive force-delete of a broad path" },
  { rule: "disk-destroy", severity: "high",
    re: /\b(mkfs(\.\w+)?|dd\s+if=\/dev\/(zero|random)|:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;\s*:)/,
    detail: "disk wipe or fork-bomb" },
  { rule: "secret-access", severity: "med", scriptSeverity: "high",
    re: /(~\/\.ssh\/|id_rsa\b|\/\.aws\/credentials|\bAWS_SECRET|PRIVATE KEY|\b\.env\b)/i,
    detail: "reads or references credentials/secrets" },
  { rule: "chmod-777", severity: "med", scriptSeverity: "high",
    re: /\bchmod\s+(-R\s+)?0?777\b/,
    detail: "world-writable permissions" },
  { rule: "eval", severity: "low", scriptSeverity: "med",
    re: /\beval\s*[("'`$]/,
    detail: "dynamic code evaluation" },
  { rule: "hidden-unicode", severity: "med",
    re: /[​-‍﻿⁠‪-‮]/,
    detail: "hidden/zero-width or bidi control characters" },
  { rule: "long-base64-blob", severity: "low", scriptSeverity: "med",
    re: /[A-Za-z0-9+/]{220,}={0,2}/,
    detail: "large base64 blob (possible embedded payload)" },
];

const RANK: Record<ScanSeverity, number> = { low: 1, med: 2, high: 3 };

function verdictFor(findings: ScanFinding[]): ScanVerdict {
  let max = 0;
  for (const f of findings) max = Math.max(max, RANK[f.severity]);
  if (max >= RANK.high) return "block";
  if (max >= RANK.low) return "warn";
  return "pass";
}

/** Scan a skill's content. Pure. Scripts get escalated severities. */
export function scanSkillContent(body: string, kind: SkillKind = "instruction"): ScanResult {
  const findings: ScanFinding[] = [];
  for (const r of RULES) {
    if (r.re.test(body)) {
      const severity = kind === "script" && r.scriptSeverity ? r.scriptSeverity : r.severity;
      findings.push({ rule: r.rule, severity, detail: r.detail });
    }
  }
  return { verdict: verdictFor(findings), findings };
}

/** Convenience for a full Skill. */
export function scanSkill(skill: Pick<Skill, "body" | "kind">): ScanResult {
  return scanSkillContent(skill.body, skill.kind);
}
