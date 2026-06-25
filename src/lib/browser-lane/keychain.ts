import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ContractValidationError } from "@/lib/central/contracts";

const execFileAsync = promisify(execFile);
const SERVICE_NAME = "HiveMatrix Browser Lane";

export interface KeychainRunResult {
  stdout: string;
  stderr: string;
}

export type KeychainRunner = (file: string, args: string[]) => Promise<KeychainRunResult>;

export interface BrowserLaneCredentialInput {
  siteId: string;
  credentialRef: string;
  username: string;
  password: string;
}

export interface BrowserLaneCredentialReadInput {
  siteId: string;
  credentialRef: string;
}

export interface BrowserLaneCredential {
  username: string;
  password: string;
}

export class BrowserLaneKeychain {
  private readonly run: KeychainRunner;

  constructor(opts: { run?: KeychainRunner } = {}) {
    this.run = opts.run ?? defaultRunner;
  }

  async saveCredential(input: BrowserLaneCredentialInput): Promise<void> {
    validateRef(input.credentialRef);
    await this.saveSecret({ account: accountKey(input.siteId, "username"), value: input.username, kind: "username" });
    await this.saveSecret({ account: accountKey(input.siteId, "password"), value: input.password, kind: "password" });
  }

  async readCredential(input: BrowserLaneCredentialReadInput): Promise<BrowserLaneCredential> {
    validateRef(input.credentialRef);
    const username = await this.readSecret(accountKey(input.siteId, "username"));
    const password = await this.readSecret(accountKey(input.siteId, "password"));
    return { username, password };
  }

  async saveSecret(input: { account: string; value: string; kind: "username" | "password" }): Promise<void> {
    if (input.kind !== "username" && input.kind !== "password") {
      throw new ContractValidationError(`Unsupported Browser Lane Keychain secret kind: ${String(input.kind)}`);
    }
    await this.run("security", [
      "add-generic-password",
      "-U",
      "-s",
      SERVICE_NAME,
      "-a",
      input.account,
      "-w",
      input.value,
    ]);
  }

  async readSecret(account: string): Promise<string> {
    const result = await this.run("security", [
      "find-generic-password",
      "-s",
      SERVICE_NAME,
      "-a",
      account,
      "-w",
    ]);
    return result.stdout.trimEnd();
  }

  redactedDiagnostic(call: { file: string; args: string[] }): string {
    const command = [call.file, ...call.args.slice(0, 1)].join(" ");
    return `${command} [redacted]`;
  }
}

function validateRef(ref: string): void {
  if (!/^hivematrix\.browser\.[a-z0-9._:-]+$/.test(ref)) {
    throw new ContractValidationError("credentialRef must start with hivematrix.browser.");
  }
}

function accountKey(siteId: string, kind: "username" | "password"): string {
  const normalized = siteId.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9._:-]+$/.test(normalized)) throw new ContractValidationError("siteId is not a valid Keychain account prefix");
  return `${normalized}:${kind}`;
}

async function defaultRunner(file: string, args: string[]): Promise<KeychainRunResult> {
  const { stdout, stderr } = await execFileAsync(file, args, { encoding: "utf8" });
  return { stdout, stderr };
}
