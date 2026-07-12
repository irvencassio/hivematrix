/**
 * Structured permission-error convention for PIM lane tools (P0.2).
 *
 * Each PIM tool's OS precondition (Contacts/Calendar/Reminders access) can be
 * denied by macOS's TCC (Transparency, Consent & Control) privacy system. When
 * that happens, an osascript executor must not return a generic failure
 * string — it must return a structured, parseable result so Flash can *speak
 * the fix* ("I need calendar access — open Privacy & Security → Calendars")
 * instead of dead-ending on an opaque error.
 *
 * This is a result convention plus one small helper — not a new store, not a
 * new product concept. `permissionNeeded`/`parsePermissionNeeded` are the
 * wire format; `isPermissionError` is the detector that decides whether an
 * osascript stderr is a permission denial (vs. some other failure that should
 * keep its existing generic message).
 */

/** The exact, parseable prefix. Do not change without updating parsePermissionNeeded. */
const PREFIX = "PERMISSION_NEEDED";
const SEP = " — "; // em dash, single spaces either side — part of the wire format

/**
 * Build the structured permission-error string:
 *   `PERMISSION_NEEDED: <grant> — <one spoken remediation sentence>`
 * `grant` and `remediation` are trimmed before assembly.
 */
export function permissionNeeded(grant: string, remediation: string): string {
  return `${PREFIX}: ${grant.trim()}${SEP}${remediation.trim()}`;
}

/**
 * Parse a `permissionNeeded()` string back into its parts, or null if `s`
 * doesn't match the convention (e.g. a generic failure string).
 */
export function parsePermissionNeeded(s: string): { grant: string; remediation: string } | null {
  if (!s.startsWith(`${PREFIX}: `)) return null;
  const rest = s.slice(`${PREFIX}: `.length);
  const idx = rest.indexOf(SEP);
  if (idx < 0) return null;
  const grant = rest.slice(0, idx).trim();
  const remediation = rest.slice(idx + SEP.length).trim();
  if (!grant || !remediation) return null;
  return { grant, remediation };
}

// ---------------------------------------------------------------------------
// TCC/osascript denial signatures — a small, documented allow-list. Each one
// is a known macOS/AppleScript denial substring or AppleEvent error code.
// Keep this list short and specific: matching too broadly would misclassify
// unrelated failures (syntax errors, "nothing found") as permission errors.

const PERMISSION_SIGNATURES: RegExp[] = [
  // "Not authorized to send Apple events to <App>." — the canonical TCC
  // denial message osascript emits when Automation access is off.
  /not authorized to send apple events/i,
  // errAEEventNotPermitted (-1743) — the AppleEvent-level error code for the
  // same denial, sometimes surfacing without the human-readable sentence.
  /-1743\b/,
  // errAEEventWouldRequireUserConsent / procNotFound-adjacent consent errors
  // some Automation prompts surface as -1728 ("can't get ... access").
  /-1728\b/,
  // Accessibility (assistive access) denial wording.
  /not allowed assistive access/i,
  // errAENotAKey / -600 "Application isn't running" often shows up when
  // Automation access silently blocks the target app from even launching.
  /application isn.t running/i,
  /\(-600\)/,
];

/** True if `osascriptStderr` looks like a macOS permission (TCC) denial. */
export function isPermissionError(osascriptStderr: string): boolean {
  const s = (osascriptStderr || "").trim();
  if (!s) return false;
  return PERMISSION_SIGNATURES.some((re) => re.test(s));
}
