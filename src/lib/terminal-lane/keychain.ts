import { spawn } from "node:child_process";

import { ContractValidationError } from "@/lib/central/contracts";

export interface KeychainRunResult {
  stdout: string;
  stderr: string;
}

export type KeychainRunner = (file: string, args: string[], opts?: { stdin?: string }) => Promise<KeychainRunResult>;

/**
 * Identity of an SSH password in the macOS Keychain: an Internet Password item
 * keyed by host + user + port + the SSH protocol — the same identity other SSH
 * tools on this Mac use, so an item saved for user@host by one of them is found
 * and reused here. The profile's credentialRef is a marker only
 * (see terminalCredentialRef); it never addresses the Keychain.
 */
export interface TerminalPasswordKey {
  host: string;
  user: string;
  port?: number | null;
}

export class TerminalLaneKeychain {
  private readonly run: KeychainRunner;

  constructor(opts: { run?: KeychainRunner } = {}) {
    this.run = opts.run ?? defaultRunner;
  }

  async savePassword(input: TerminalPasswordKey & { value: string }): Promise<void> {
    const key = normalizeKey(input);
    if (/[\r\n]/.test(input.value)) {
      throw new ContractValidationError("password must not contain newline characters");
    }
    // `security -i` reads the command from stdin, keeping the secret out of argv
    // (visible in `ps`) while -U updates an existing item in place.
    const command = [
      "add-internet-password",
      "-U",
      "-s", quote(key.host),
      "-a", quote(key.user),
      "-P", String(key.port),
      "-r", '"ssh "',
      "-w", quote(input.value),
    ].join(" ");
    await this.run("security", ["-i"], { stdin: command });
  }

  async readPassword(key: TerminalPasswordKey): Promise<string | null> {
    const normalized = normalizeKey(key);
    try {
      const result = await this.run("security", [
        "find-internet-password",
        "-s", normalized.host,
        "-a", normalized.user,
        "-P", String(normalized.port),
        "-r", "ssh ",
        "-w",
      ]);
      return result.stdout.replace(/\n$/, "");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async hasPassword(key: TerminalPasswordKey): Promise<boolean> {
    return (await this.readPassword(key)) != null;
  }

  redactedDiagnostic(call: { file: string; args: string[] }): string {
    return `${[call.file, ...call.args.slice(0, 1)].join(" ")} [redacted]`;
  }
}

/**
 * Canonical credentialRef marker for a profile. It signals "the password for
 * this profile lives in the macOS Keychain" and satisfies the profile contract;
 * the Keychain item itself is addressed by host/user/port (TerminalPasswordKey).
 */
export function terminalCredentialRef(profileId: string): string {
  const normalized = profileId.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9._:-]+$/.test(normalized)) throw new ContractValidationError("profile id is not a valid credentialRef suffix");
  return `hivematrix.terminal.${normalized}`;
}

function normalizeKey(key: TerminalPasswordKey): { host: string; user: string; port: number } {
  const host = key.host?.trim() ?? "";
  const user = key.user?.trim() ?? "";
  if (!host) throw new ContractValidationError("host is required to address a Keychain SSH password");
  if (!user) throw new ContractValidationError("user is required to address a Keychain SSH password");
  const port = key.port ?? 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ContractValidationError("port must be an integer from 1 to 65535");
  return { host, user, port };
}

// Quoting for security(1)'s interactive command parser (double quotes with
// backslash escapes). Newlines are rejected before this is called.
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /could not be found in the keychain/i.test(error.message);
}

async function defaultRunner(file: string, args: string[], opts: { stdin?: string } = {}): Promise<KeychainRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const err = new Error(stderr.trim() || `${file} exited with code ${code}`);
      Object.assign(err, { stdout, stderr, code });
      reject(err);
    });

    child.stdin.end(opts.stdin != null ? `${opts.stdin}\n` : "");
  });
}
