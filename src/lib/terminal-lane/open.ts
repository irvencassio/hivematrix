/**
 * Canopy-style open contract: opening a Terminal Lane session takes a profileID
 * ONLY — never a password. The resolver looks up the (already-stored) profile and
 * returns the command to run plus honest connectability. No secret ever crosses
 * this boundary, and nothing is executed here (the app runs the command in its
 * own PTY). This mirrors Canopy's TerminalAgentExecutor.openSSH(profileID).
 */
import { getTerminalProfile } from "./store";
import { rejectInlineSecrets, terminalAuthCapability, type TerminalAuthMethod, type TerminalProfile } from "./contracts";

export interface TerminalOpenRequest {
  ok: boolean;
  profileId: string;
  openCommand: string | null;
  authMethod: TerminalAuthMethod | null;
  autoConnect: boolean;
  connectMode: string;
  reason: string | null;
  error?: string;
}

export interface ResolveTerminalOpenDeps {
  getProfile?: (id: string) => TerminalProfile | null;
}

const CONNECT_MODE: Record<TerminalAuthMethod, string> = {
  local: "Local shell",
  ssh_key_agent: "SSH (key/agent)",
  ssh_key_file: "SSH (key file)",
  password_keychain: "SSH (password — manual)",
  manual_password: "SSH (password — manual)",
};

export function resolveTerminalOpenRequest(input: { profileId: string }, deps: ResolveTerminalOpenDeps = {}): TerminalOpenRequest {
  if (!input || typeof input !== "object") throw new Error("open request must be an object with a profileId");
  // Reject any attempt to smuggle a secret through the open boundary.
  rejectInlineSecrets(input as Record<string, unknown>, "open request");
  const profileId = typeof input.profileId === "string" ? input.profileId.trim() : "";
  if (!profileId) throw new Error("profileId is required");

  const getProfile = deps.getProfile ?? getTerminalProfile;
  const profile = getProfile(profileId);
  if (!profile) {
    return { ok: false, profileId, openCommand: null, authMethod: null, autoConnect: false, connectMode: "Unknown", reason: "No such profile.", error: "profile_not_found" };
  }
  const cap = terminalAuthCapability(profile);
  return {
    ok: true,
    profileId: profile.id,
    openCommand: profile.openCommand, // never contains a password (see buildTerminalOpenCommand)
    authMethod: profile.authMethod,
    autoConnect: cap.autoConnect,
    connectMode: CONNECT_MODE[profile.authMethod],
    reason: cap.reason,
  };
}
