import { spawn } from "node:child_process";

import { ContractValidationError } from "@/lib/central/contracts";

const SERVICE_NAME = "HiveMatrix Browser Lane";

export interface KeychainRunResult {
  stdout: string;
  stderr: string;
}

export type KeychainRunner = (file: string, args: string[], opts?: { stdin?: string }) => Promise<KeychainRunResult>;

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
    ], { stdin: input.value });
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

    if (opts.stdin != null) {
      child.stdin.end(`${opts.stdin}\n`);
    } else {
      child.stdin.end();
    }
  });
}
