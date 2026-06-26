import { spawn } from "node:child_process";

import { ContractValidationError } from "@/lib/central/contracts";

const SERVICE_NAME = "HiveMatrix Terminal Lane";

export interface KeychainRunResult {
  stdout: string;
  stderr: string;
}

export type KeychainRunner = (file: string, args: string[], opts?: { stdin?: string }) => Promise<KeychainRunResult>;
export type TerminalSecretKind = "password" | "ssh_key_passphrase" | "private_key";

export class TerminalLaneKeychain {
  private readonly run: KeychainRunner;

  constructor(opts: { run?: KeychainRunner } = {}) {
    this.run = opts.run ?? defaultRunner;
  }

  async saveSecret(input: { profileId: string; credentialRef: string; kind: TerminalSecretKind; value: string }): Promise<void> {
    validateRef(input.credentialRef);
    validateKind(input.kind);
    await this.run("security", [
      "add-generic-password",
      "-U",
      "-s",
      SERVICE_NAME,
      "-a",
      accountKey(input.profileId, input.kind),
      "-w",
    ], { stdin: input.value });
  }

  async readSecret(input: { profileId: string; credentialRef: string; kind: TerminalSecretKind }): Promise<string> {
    validateRef(input.credentialRef);
    validateKind(input.kind);
    const result = await this.run("security", [
      "find-generic-password",
      "-s",
      SERVICE_NAME,
      "-a",
      accountKey(input.profileId, input.kind),
      "-w",
    ]);
    return result.stdout.trimEnd();
  }

  redactedDiagnostic(call: { file: string; args: string[] }): string {
    return `${[call.file, ...call.args.slice(0, 1)].join(" ")} [redacted]`;
  }
}

function validateRef(ref: string): void {
  if (!/^hivematrix\.terminal\.[a-z0-9._:-]+$/.test(ref)) {
    throw new ContractValidationError("credentialRef must start with hivematrix.terminal.");
  }
}

function validateKind(kind: string): void {
  if (!["password", "ssh_key_passphrase", "private_key"].includes(kind)) {
    throw new ContractValidationError(`Unsupported Terminal Lane Keychain secret kind: ${kind}`);
  }
}

function accountKey(profileId: string, kind: TerminalSecretKind): string {
  const normalized = profileId.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9._:-]+$/.test(normalized)) throw new ContractValidationError("profileId is not a valid Keychain account prefix");
  return `${normalized}:${kind}`;
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
