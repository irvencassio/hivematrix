import { spawn } from "node:child_process";

/** Service name under which all vault items are stored in the macOS Keychain. */
const SERVICE = "hivematrix-vault";

export type KeychainRunner = (
  file: string,
  args: string[],
  opts?: { stdin?: string },
) => Promise<{ stdout: string; stderr: string }>;

export class VaultKeychain {
  private readonly run: KeychainRunner;

  constructor(opts: { run?: KeychainRunner } = {}) {
    this.run = opts.run ?? defaultRunner;
  }

  async setSecret(scope: string, name: string, value: string): Promise<void> {
    validateSegment(scope, "scope");
    validateSegment(name, "name");
    await this.run(
      "security",
      ["add-generic-password", "-U", "-s", SERVICE, "-a", accountKey(scope, name), "-w"],
      { stdin: value },
    );
  }

  async getSecret(scope: string, name: string): Promise<string> {
    validateSegment(scope, "scope");
    validateSegment(name, "name");
    const result = await this.run("security", [
      "find-generic-password",
      "-s", SERVICE,
      "-a", accountKey(scope, name),
      "-w",
    ]);
    return result.stdout.trimEnd();
  }

  async deleteSecret(scope: string, name: string): Promise<void> {
    validateSegment(scope, "scope");
    validateSegment(name, "name");
    await this.run("security", [
      "delete-generic-password",
      "-s", SERVICE,
      "-a", accountKey(scope, name),
    ]);
  }
}

function accountKey(scope: string, name: string): string {
  return `${scope}/${name}`;
}

export function validateSegment(value: string, field: string): void {
  // scope: lowercase only; name: also allows uppercase and underscore (env-var names)
  const pattern = field === "scope" ? /^[a-z0-9._:-]+$/ : /^[a-zA-Z0-9._:-]+$/;
  if (!pattern.test(value)) {
    throw new Error(`vault ${field} must match ${field === "scope" ? "[a-z0-9._:-]+" : "[a-zA-Z0-9._:-]+"}, got: ${value}`);
  }
}

async function defaultRunner(
  file: string,
  args: string[],
  opts: { stdin?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
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
      if (code === 0) { resolve({ stdout, stderr }); return; }
      const err = new Error(stderr.trim() || `${file} exited with code ${code}`);
      Object.assign(err, { stdout, stderr, code });
      reject(err);
    });

    child.stdin.end(opts.stdin != null ? `${opts.stdin}\n` : "");
  });
}
