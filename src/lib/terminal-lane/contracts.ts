import { ContractValidationError } from "@/lib/central/contracts";

export const TERMINAL_READINESS_STATUSES = ["ready", "needs_auth", "probe_failed", "blocked", "unknown"] as const;
export type TerminalReadinessStatus = (typeof TERMINAL_READINESS_STATUSES)[number];
export type TerminalReadinessColor = "green" | "yellow" | "orange" | "red" | "gray";

// Honest auth model. password_keychain is intentionally NOT auto-connectable
// yet: Terminal Lane has no native SSH runtime that can consume a stored
// password, so we never pretend a saved password auto-connects (raw /usr/bin/ssh
// can't use it). See the design doc.
export const TERMINAL_AUTH_METHODS = ["local", "ssh_key_agent", "ssh_key_file", "password_keychain", "manual_password"] as const;
export type TerminalAuthMethod = (typeof TERMINAL_AUTH_METHODS)[number];

export interface TerminalProfile {
  id: string;
  displayName: string;
  kind: "local" | "ssh";
  authMethod: TerminalAuthMethod;
  host: string | null;
  user: string | null;
  port: number | null;
  shell: string | null;
  cwd: string | null;
  /** Absolute path to a private key (ssh_key_file) — metadata only, never a secret. */
  keyPath: string | null;
  credentialRef: string | null;
  openCommand: string;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TerminalAuthCapability {
  autoConnect: boolean;
  needsKeychain: boolean;
  reason: string | null;
}

/** Honest connectability per auth method — used by UI, readiness, and open. */
export function terminalAuthCapability(profile: Pick<TerminalProfile, "authMethod">): TerminalAuthCapability {
  switch (profile.authMethod) {
    case "local":
      return { autoConnect: true, needsKeychain: false, reason: null };
    case "ssh_key_agent":
      return { autoConnect: true, needsKeychain: false, reason: null };
    case "ssh_key_file":
      return { autoConnect: true, needsKeychain: false, reason: null };
    case "password_keychain":
      return { autoConnect: false, needsKeychain: true, reason: "Saved, but not auto-connectable yet — Terminal Lane can't use a stored password to auto-connect. Use key auth, or connect manually." };
    case "manual_password":
      return { autoConnect: false, needsKeychain: false, reason: "Opens an interactive session and prompts for the password; nothing is stored." };
  }
}

export interface TerminalReadinessState {
  status: TerminalReadinessStatus;
  color: TerminalReadinessColor;
  label: string;
}

type UnknownRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new ContractValidationError(message);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as UnknownRecord;
}

export function rejectInlineSecrets(record: UnknownRecord, label = "terminal profile"): void {
  for (const key of Object.keys(record)) {
    if (/password|passphrase|private.?key|secret|token|cookie/i.test(key) && key !== "credentialRef") {
      fail(`${label} must not include inline secret field "${key}"; use credentialRef`);
    }
  }
}

function readString(record: UnknownRecord, key: string, options: { required?: boolean; allowEmpty?: boolean } = {}): string | null {
  const required = options.required ?? true;
  const value = record[key];
  if (value == null) {
    if (required) fail(`${key} is required`);
    return null;
  }
  if (typeof value !== "string") fail(`${key} must be a string`);
  const trimmed = value.trim();
  if (!options.allowEmpty && trimmed.length === 0) {
    if (required) fail(`${key} is required`);
    return null;
  }
  return trimmed;
}

function readPort(record: UnknownRecord): number | null {
  const value = record.port;
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) fail("port must be an integer from 1 to 65535");
  return n;
}

function normalizeId(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9._:-]+$/.test(normalized)) fail(`${label} must contain only letters, numbers, dots, underscores, colons, or hyphens`);
  return normalized;
}

function normalizeKind(value: unknown): "local" | "ssh" {
  if (value == null || value === "") return "local";
  if (typeof value !== "string") fail("kind must be a string");
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "ssh") return normalized;
  fail("kind must be local or ssh");
}

function validateShell(shell: string | null): string | null {
  if (!shell) return null;
  if (!shell.startsWith("/") || /\s/.test(shell)) fail("shell must be an absolute path without spaces");
  return shell;
}

function validateCredentialRef(ref: string | null): string | null {
  if (!ref) return null;
  if (!/^hivematrix\.terminal\.[a-z0-9._:-]+$/.test(ref)) {
    fail("credentialRef must start with hivematrix.terminal.");
  }
  return ref;
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._~@%+=:,/-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildTerminalOpenCommand(input: {
  kind: "local" | "ssh";
  host?: string | null;
  user?: string | null;
  port?: number | null;
  shell?: string | null;
  keyPath?: string | null;
}): string {
  if (input.kind === "local") return validateShell(input.shell ?? null) ?? "/bin/bash";
  const host = input.host?.trim().toLowerCase();
  const user = input.user?.trim();
  if (!host) fail("host is required for ssh profiles");
  if (!user) fail("user is required for ssh profiles");
  const target = `${user}@${host}`;
  // Identity file (ssh_key_file) is a path, never a secret. No password ever
  // appears in an open command — Terminal Lane does not autotype credentials.
  const parts = ["ssh"];
  if (input.keyPath) parts.push("-i", shellQuote(input.keyPath));
  if (input.port && input.port !== 22) parts.push("-p", String(input.port));
  parts.push(shellQuote(target));
  return parts.join(" ");
}

// authMethod governs which fields are valid. When absent (legacy payloads) it is
// inferred from kind + credentialRef so old profiles keep working.
function resolveAuthMethod(record: UnknownRecord, kind: "local" | "ssh", credentialRef: string | null): TerminalAuthMethod {
  const raw = record.authMethod;
  if (raw != null && raw !== "") {
    if (typeof raw !== "string" || !(TERMINAL_AUTH_METHODS as readonly string[]).includes(raw.trim())) {
      fail(`authMethod must be one of: ${TERMINAL_AUTH_METHODS.join(", ")}`);
    }
    return raw.trim() as TerminalAuthMethod;
  }
  if (kind === "local") return "local";
  return credentialRef ? "password_keychain" : "ssh_key_agent";
}

function validateKeyPath(keyPath: string | null): string | null {
  if (!keyPath) return null;
  if (!keyPath.startsWith("/") && !keyPath.startsWith("~")) fail("keyPath must be an absolute path");
  if (/\s/.test(keyPath)) fail("keyPath must not contain spaces");
  return keyPath;
}

export function normalizeTerminalProfile(input: unknown): TerminalProfile {
  const record = asRecord(input, "terminal profile");
  rejectInlineSecrets(record);
  const credentialRef = validateCredentialRef(readString(record, "credentialRef", { required: false }));
  const explicitKind = normalizeKind(record.kind);
  const authMethod = resolveAuthMethod(record, explicitKind, credentialRef);
  // kind is derived from authMethod so the two can never disagree.
  const kind: "local" | "ssh" = authMethod === "local" ? "local" : "ssh";
  const host = readString(record, "host", { required: kind === "ssh" })?.toLowerCase() ?? null;
  const user = readString(record, "user", { required: kind === "ssh" }) ?? null;
  const port = readPort(record) ?? (kind === "ssh" ? 22 : null);
  const shell = validateShell(readString(record, "shell", { required: false }));
  const keyPath = validateKeyPath(readString(record, "keyPath", { required: false }));
  const openCommandInput = readString(record, "openCommand", { required: false });

  // Per-method field rules — keep secret boundaries honest.
  if (kind === "local") {
    if (credentialRef) fail("local profiles must not carry a credentialRef");
    if (keyPath) fail("local profiles must not carry a keyPath");
  } else {
    if ((authMethod === "ssh_key_agent" || authMethod === "manual_password") && credentialRef) {
      fail(`${authMethod} profiles must not carry a credentialRef`);
    }
    if (authMethod === "password_keychain" && !credentialRef) {
      fail("password_keychain profiles require a credentialRef (Keychain)");
    }
    if (authMethod === "ssh_key_file" && !keyPath) {
      fail("ssh_key_file profiles require a keyPath");
    }
  }

  const effectiveCredentialRef = kind === "local" ? null : (authMethod === "password_keychain" || authMethod === "ssh_key_file" ? credentialRef : null);
  const effectiveKeyPath = authMethod === "ssh_key_file" ? keyPath : null;

  const profile: TerminalProfile = {
    id: normalizeId(readString(record, "id")!, "id"),
    displayName: readString(record, "displayName")!,
    kind,
    authMethod,
    host: kind === "local" ? null : host,
    user: kind === "local" ? user : user,
    port: kind === "local" ? null : port,
    shell,
    cwd: readString(record, "cwd", { required: false }),
    keyPath: kind === "local" ? null : effectiveKeyPath,
    credentialRef: effectiveCredentialRef,
    openCommand: openCommandInput ?? buildTerminalOpenCommand({ kind, host, user, port, shell, keyPath: effectiveKeyPath }),
    notes: readString(record, "notes", { required: false, allowEmpty: true }) ?? "",
    createdAt: readString(record, "createdAt", { required: false }),
    updatedAt: readString(record, "updatedAt", { required: false }),
  };
  if (profile.kind === "local" && profile.openCommand.trim().startsWith("ssh ")) {
    fail("local profiles cannot use an ssh openCommand");
  }
  return profile;
}

export function normalizeTerminalReadinessState(value: unknown): TerminalReadinessState {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "unknown";
  const status = (TERMINAL_READINESS_STATUSES as readonly string[]).includes(raw) ? raw as TerminalReadinessStatus : "unknown";
  switch (status) {
    case "ready":
      return { status, color: "green", label: "Ready" };
    case "needs_auth":
      return { status, color: "orange", label: "Needs authentication" };
    case "probe_failed":
      return { status, color: "yellow", label: "Probe failed" };
    case "blocked":
      return { status, color: "red", label: "Blocked" };
    case "unknown":
      return { status, color: "gray", label: "Unknown" };
  }
}
