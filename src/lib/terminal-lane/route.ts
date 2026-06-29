/**
 * Terminal Lane request routing. Turns an explicit Terminal Lane request into a
 * structured, secret-free work item keyed by profileId — never raw ssh creds.
 * Mirrors the Canopy-style "profileID only" contract but is pure HiveMatrix
 * Terminal Lane; the output deliberately never references Canopy and never
 * carries a password/passphrase/private key.
 */
import { isTerminalLaneRequest, detectTerminalHostHint } from "./intent";

export type TerminalRouteStatus = "prepared" | "needs_input";
export type TerminalRouteReason = null | "profile_missing" | "auth_not_ready" | "execution_unavailable" | "stale_app" | "no_local_profile" | "choose_local_profile" | "choose_remote_profile";

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
  needsInput: { missing: string; instructions: string; choices?: string[] } | null;
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
  isDefault?: boolean;
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

function isLocalProfile(profile: ProfileLike): boolean {
  return profile.kind === "local" || profile.authMethod === "local";
}

function isRemoteProfile(profile: ProfileLike): boolean {
  return !isLocalProfile(profile);
}

function isLocalMachineHint(value: string | null): boolean {
  return !!value && /^(?:localhost|127(?:\.\d{1,3}){3}|::1|mac|macbook|imac)$/i.test(value);
}

function isRemoteKeywordHint(value: string | null): boolean {
  return !!value && /^(?:ssh|sftp)$/i.test(value);
}

function isCommandWordHint(value: string | null): boolean {
  return !!value && /^(?:check|run|execute|exec|open|start|launch|use)$/i.test(value);
}

function hasRemoteIntent(text: string): boolean {
  return /\b(?:ssh|sftp|remote|remotely|remote\s+server|connect\s+remotely)\b/i.test(text);
}

function chooseDefaultOrOnlyLocalProfile(profiles: ProfileLike[]): RoutedTerminalProfile | "choose" | null {
  const local = profiles.filter(isLocalProfile);
  if (local.length === 0) return null;
  const defaultLocal = local.find((p) => p.isDefault === true);
  if (defaultLocal) return project(defaultLocal);
  if (local.length === 1) return project(local[0]);
  return "choose";
}

function profileLabels(profiles: ProfileLike[]): string {
  return profiles.map((p) => `${p.displayName} (${p.id})`).join(", ");
}

function needsInputRoute(args: {
  explicit: boolean;
  hostHint: string | null;
  intentDetected: boolean;
  suggestedCommand: string | null;
  transcript: string[];
  reason: Exclude<TerminalRouteReason, null | "auth_not_ready" | "execution_unavailable" | "stale_app">;
  missing: string;
  instructions: string;
  choices?: string[];
}): TerminalLaneRoute {
  args.transcript.push(`needs_input: ${args.reason} — ${args.instructions}`);
  return {
    lane: "terminal",
    intentDetected: args.intentDetected,
    explicit: args.explicit,
    hostHint: args.hostHint,
    profile: null,
    suggestedCommand: args.suggestedCommand,
    status: "needs_input",
    reason: args.reason,
    needsInput: { missing: args.missing, instructions: args.instructions, ...(args.choices ? { choices: args.choices } : {}) },
    transcript: args.transcript,
  };
}

export function routeTerminalLaneRequest(input: { text: string; profiles: ProfileLike[] }): TerminalLaneRoute {
  const text = input.text || "";
  const explicit = isTerminalLaneRequest(text);
  const rawHostHint = detectTerminalHostHint(text);
  const remoteIntent = hasRemoteIntent(text);
  const hostHint = isRemoteKeywordHint(rawHostHint) || isCommandWordHint(rawHostHint) ? null : rawHostHint;
  const profile = hostHint && !isLocalMachineHint(hostHint) ? resolveTerminalProfileForQuery(hostHint, input.profiles) : null;
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

  if (explicit && (!hostHint || isLocalMachineHint(hostHint)) && remoteIntent) {
    const remoteProfiles = input.profiles.filter(isRemoteProfile);
    if (remoteProfiles.length > 0) {
      const choices = remoteProfiles.map((p) => p.id);
      const instructions = `Choose which remote Terminal Lane profile to use: ${profileLabels(remoteProfiles)}.`;
      transcript.push(`Profile resolution: remote Terminal Lane request needs a remote profile choice (${choices.join(", ")}).`);
      return needsInputRoute({
        explicit,
        hostHint: null,
        intentDetected: true,
        suggestedCommand,
        transcript,
        reason: "choose_remote_profile",
        missing: "remote profile",
        instructions,
        choices,
      });
    }
    const instructions = "Add or configure an SSH/remote Terminal Lane profile, then retry this remote request.";
    transcript.push("Profile resolution: no SSH/remote Terminal Lane profile is configured.");
    return needsInputRoute({
      explicit,
      hostHint: null,
      intentDetected: true,
      suggestedCommand,
      transcript,
      reason: "profile_missing",
      missing: "remote profile",
      instructions,
    });
  }

  if (explicit && (!hostHint || isLocalMachineHint(hostHint))) {
    const localChoice = chooseDefaultOrOnlyLocalProfile(input.profiles);
    if (localChoice && localChoice !== "choose") {
      transcript.push(`Profile resolution: selected local profile '${localChoice.id}' for this local Terminal Lane request.`);
      transcript.push(`Prepared: Terminal Lane work item for profile '${localChoice.id}'${suggestedCommand ? ` — suggested command: ${suggestedCommand}` : ""}.`);
      return { lane: "terminal", intentDetected: true, explicit, hostHint, profile: localChoice, suggestedCommand, status: "prepared", reason: null, needsInput: null, transcript };
    }
    if (localChoice === "choose") {
      const localProfiles = input.profiles.filter(isLocalProfile);
      const choices = localProfiles.map((p) => p.id);
      const instructions = `Choose which local Terminal Lane profile to use: ${profileLabels(localProfiles)}.`;
      transcript.push(`Profile resolution: multiple local Terminal Lane profiles are available (${choices.join(", ")}).`);
      return needsInputRoute({
        explicit,
        hostHint,
        intentDetected: true,
        suggestedCommand,
        transcript,
        reason: "choose_local_profile",
        missing: "local profile",
        instructions,
        choices,
      });
    }
    const instructions = "Create or set up a local Terminal Lane profile in the Terminal Lane app, then retry.";
    transcript.push("Profile resolution: local Terminal Lane profile is not configured.");
    return needsInputRoute({
      explicit,
      hostHint,
      intentDetected: true,
      suggestedCommand,
      transcript,
      reason: "no_local_profile",
      missing: "local profile",
      instructions,
    });
  }

  const missing = hostHint || "profile";
  const instructions = hostHint
    ? `No Terminal Lane profile matches '${hostHint}'. Add a Terminal Lane profile (host + user) for it in the Terminal Lane app, then retry.`
    : `Name the target host or add a Terminal Lane profile in the Terminal Lane app, then retry.`;
  transcript.push(hostHint ? `Profile resolution: no Terminal Lane profile matches '${hostHint}'.` : "Profile resolution: no target host given.");
  transcript.push(`needs_input: profile_missing — ${instructions}`);
  return { lane: "terminal", intentDetected, explicit, hostHint, profile: null, suggestedCommand, status: "needs_input", reason: "profile_missing", needsInput: { missing, instructions }, transcript };
}
