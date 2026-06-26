/**
 * Terminal Lane request routing. Turns an explicit Terminal Lane request into a
 * structured, secret-free work item keyed by profileId — never raw ssh creds.
 * Mirrors the Canopy-style "profileID only" contract but is pure HiveMatrix
 * Terminal Lane; the output deliberately never references Canopy and never
 * carries a password/passphrase/private key.
 */
import { isTerminalLaneRequest, detectTerminalHostHint } from "./intent";

export type TerminalRouteStatus = "prepared" | "needs_input";
export type TerminalRouteReason = null | "profile_missing" | "auth_not_ready" | "execution_unavailable" | "stale_app";

/** Non-secret projection of a Terminal Lane profile (no credentialRef/values). */
export interface RoutedTerminalProfile {
  id: string;
  displayName: string;
  kind: string;
  host: string | null;
  user: string | null;
  port: number | null;
  authMethod: string;
  credentialPresent: boolean;
  autoConnect: boolean;
}

export interface TerminalLaneRoute {
  lane: "terminal";
  intentDetected: boolean;
  explicit: boolean;
  hostHint: string | null;
  profile: RoutedTerminalProfile | null;
  suggestedCommand: string | null;
  status: TerminalRouteStatus;
  reason: TerminalRouteReason;
  needsInput: { missing: string; instructions: string } | null;
  transcript: string[];
}

// Minimal shape we read from a profile summary (extra fields are ignored).
interface ProfileLike {
  id: string;
  displayName: string;
  kind?: string;
  host?: string | null;
  user?: string | null;
  port?: number | null;
  authMethod?: string;
  credentialPresent?: boolean;
  autoConnect?: boolean;
}

function project(p: ProfileLike): RoutedTerminalProfile {
  return {
    id: p.id,
    displayName: p.displayName,
    kind: p.kind ?? "ssh",
    host: p.host ?? null,
    user: p.user ?? null,
    port: p.port ?? null,
    authMethod: p.authMethod ?? "local",
    credentialPresent: !!p.credentialPresent,
    autoConnect: p.autoConnect !== false,
  };
}

/** Resolve a profile by id, displayName, host, or user (exact first, then substring). */
export function resolveTerminalProfileForQuery(query: string, profiles: ProfileLike[]): RoutedTerminalProfile | null {
  const q = (query || "").trim().toLowerCase();
  if (!q) return null;
  const fields = (p: ProfileLike) => [p.id, p.displayName, p.host, p.user].filter(Boolean).map((v) => String(v).toLowerCase());
  const exact = profiles.find((p) => fields(p).includes(q));
  if (exact) return project(exact);
  const sub = profiles.find((p) => fields(p).some((f) => f.includes(q) || q.includes(f)));
  return sub ? project(sub) : null;
}

// Suggest a read-only command for well-known intents only — never autogenerate
// destructive commands, never anything with a secret.
function suggestCommand(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bos\b|os version|operating system|uname|distro|release/.test(t)) {
    return "cat /etc/os-release 2>/dev/null || uname -a";
  }
  if (/uptime/.test(t)) return "uptime";
  if (/disk|df\b|disk usage/.test(t)) return "df -h";
  return null;
}

export function routeTerminalLaneRequest(input: { text: string; profiles: ProfileLike[] }): TerminalLaneRoute {
  const text = input.text || "";
  const explicit = isTerminalLaneRequest(text);
  const hostHint = detectTerminalHostHint(text);
  const profile = hostHint ? resolveTerminalProfileForQuery(hostHint, input.profiles) : null;
  const intentDetected = explicit || (!!hostHint && !!profile);
  const suggestedCommand = suggestCommand(text);

  const transcript: string[] = [];
  transcript.push("Intent detected: " + (explicit ? "explicit Terminal Lane request" : "Terminal Lane host target") + (hostHint ? ` (target host: ${hostHint})` : ""));
  transcript.push("Route selected: Terminal Lane (HiveMatrix terminal lane) — not a generic frontier agent.");

  if (profile) {
    transcript.push(`Profile resolution: matched '${profile.id}'${profile.host ? ` (host ${profile.host})` : ""} by host/name.`);
    const autoOk = profile.autoConnect;
    const reason: TerminalRouteReason = autoOk ? null : "auth_not_ready";
    transcript.push(
      autoOk
        ? `Prepared: Terminal Lane work item for profile '${profile.id}'${suggestedCommand ? ` — suggested command: ${suggestedCommand}` : ""}.`
        : `Prepared (auth not ready): profile '${profile.id}' is not auto-connectable yet — connect it in the Terminal Lane app, then run${suggestedCommand ? ` ${suggestedCommand}` : ""}.`,
    );
    return { lane: "terminal", intentDetected, explicit, hostHint, profile, suggestedCommand, status: "prepared", reason, needsInput: null, transcript };
  }

  const missing = hostHint || "profile";
  const instructions = hostHint
    ? `No Terminal Lane profile matches '${hostHint}'. Add a Terminal Lane profile (host + user) for it in the Terminal Lane app, then retry.`
    : `Name the target host or add a Terminal Lane profile in the Terminal Lane app, then retry.`;
  transcript.push(hostHint ? `Profile resolution: no Terminal Lane profile matches '${hostHint}'.` : "Profile resolution: no target host given.");
  transcript.push(`needs_input: profile_missing — ${instructions}`);
  return { lane: "terminal", intentDetected, explicit, hostHint, profile: null, suggestedCommand, status: "needs_input", reason: "profile_missing", needsInput: { missing, instructions }, transcript };
}
