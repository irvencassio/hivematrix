/**
 * MailBee contracts — pure types + the trust-classification engine (ported from
 * Hive 1, the highest-value reusable ingress-safety asset). No zod; unit-tested.
 *
 * Every inbound email is untrusted input until classified. classifyMailTrust
 * gates what may act on it: prompt-injection signals + risky attachments push to
 * "suspicious"; known sender + authenticated domain earns "trusted" (the only
 * level eligible for auto-send); everything else is "external" (draft-for-approval).
 */

/** A message read from Apple Mail. */
export interface InboundEmail {
  /** Mail.app message id — the monotonic high-water key. */
  id: number;
  from: string;
  fromName: string | null;
  subject: string;
  body: string;
  receivedAt: string;
  /** Attachment filenames (used for risky-extension detection). */
  attachments: string[];
}

export interface TrustHints {
  knownSender?: boolean;
  authenticatedDomain?: boolean;
  sameOrg?: boolean;
}

export type TrustLevel = "trusted" | "external" | "suspicious";

export interface MailTrustAssessment {
  level: TrustLevel;
  reasons: string[];
  promptInjectionSignals: string[];
  riskyAttachments: string[];
}

const RISKY_ATTACHMENT_PATTERN = /\.(app|command|exe|js|pkg|py|rb|scpt|sh|swift|ts)$/i;

const PROMPT_INJECTION_PATTERNS = [
  /\bignore (all|any|the) (previous|prior) instructions\b/i,
  /\bsystem prompt\b/i,
  /\bdeveloper message\b/i,
  /\breveal (your|the) prompt\b/i,
  /\btool call\b/i,
  /\bpasswords?\b/i,
  /\bapi keys?\b/i,
  /\bsecrets?\b/i,
];

export interface TrustInput {
  subject: string;
  text: string;
  attachments: string[];
  trustHints: TrustHints;
}

export function classifyMailTrust(input: TrustInput): MailTrustAssessment {
  const promptInjectionSignals = PROMPT_INJECTION_PATTERNS
    .filter((p) => p.test(input.text) || p.test(input.subject))
    .map((p) => p.source);

  const riskyAttachments = input.attachments.filter((f) => RISKY_ATTACHMENT_PATTERN.test(f));

  const reasons: string[] = [];
  let level: TrustLevel = "external";

  if (promptInjectionSignals.length > 0) {
    reasons.push("Prompt-injection style instructions detected in the email body or subject.");
    level = "suspicious";
  }
  if (riskyAttachments.length > 0) {
    reasons.push("One or more attachments look executable or script-like and should be treated as untrusted.");
    level = "suspicious";
  }

  if (level !== "suspicious") {
    const h = input.trustHints;
    if (h.knownSender) reasons.push("Sender was marked as a known contact.");
    if (h.authenticatedDomain) reasons.push("Sender domain was marked as authenticated.");
    if (h.sameOrg) reasons.push("Sender was marked as same-organization.");
    if (h.knownSender && h.authenticatedDomain) {
      level = "trusted";
    } else if (!h.knownSender && !h.sameOrg) {
      reasons.push("Sender should be treated as external until intent is verified.");
    }
  }

  if (reasons.length === 0) {
    reasons.push("No explicit trust hints were provided; treat the email as external input.");
  }

  return { level, reasons, promptInjectionSignals, riskyAttachments };
}

/** Whether a trust level is eligible for autonomous send (vs draft-for-approval). */
export function mayAutoSend(level: TrustLevel): boolean {
  return level === "trusted";
}

/** The domain part of an email address (lowercased), or "" if malformed. */
export function emailDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1).trim().toLowerCase() : "";
}

export function deriveEmailTaskTitle(subject: string, from: string): string {
  const subj = subject.trim() || "(no subject)";
  const clamped = subj.length > 64 ? `${subj.slice(0, 61)}…` : subj;
  return `Email from ${from}: ${clamped}`;
}
