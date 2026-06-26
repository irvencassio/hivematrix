import { spawn } from "node:child_process";

import { normalizeTerminalProfile, normalizeTerminalReadinessState, type TerminalProfile, type TerminalReadinessState } from "./contracts";

export interface TerminalReadinessRunnerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type TerminalReadinessRunner = (file: string, args: string[], opts?: { timeoutMs?: number }) => Promise<TerminalReadinessRunnerResult>;

export interface TerminalReadinessProbeResult {
  profile: TerminalProfile;
  state: TerminalReadinessState;
  summary: string;
  command: { file: string; args: string[] };
}

export async function runTerminalReadinessProbe(input: {
  profile: unknown;
  run?: TerminalReadinessRunner;
  timeoutMs?: number;
}): Promise<TerminalReadinessProbeResult> {
  const profile = normalizeTerminalProfile(input.profile);

  // Password-based methods are NOT probed with raw ssh: a non-interactive
  // BatchMode probe can never use a stored/typed password, and we never autotype
  // one. Report an honest, actionable state without spawning ssh at all.
  if (profile.authMethod === "password_keychain") {
    const state = normalizeTerminalReadinessState("needs_auth");
    return {
      profile,
      state,
      summary: "Password auth isn't auto-connectable yet — Terminal Lane can't use a stored password. Switch to key/agent auth, or connect manually.",
      command: { file: "(none)", args: [] },
    };
  }
  if (profile.authMethod === "manual_password") {
    const state = normalizeTerminalReadinessState("needs_auth");
    return {
      profile,
      state,
      summary: "This profile prompts for the password when you open the terminal; nothing is stored or auto-verified.",
      command: { file: "(none)", args: [] },
    };
  }

  const runner = input.run ?? defaultRunner;
  const command = readinessCommand(profile);
  const result = await runner(command.file, command.args, { timeoutMs: input.timeoutMs ?? 10_000 });
  const text = `${result.stdout}\n${result.stderr}`;
  const state = normalizeTerminalReadinessState(classifyExit(result.exitCode, text));
  return {
    profile,
    state,
    summary: summaryFor(state.status, text),
    command,
  };
}

function summaryFor(status: string, text: string): string {
  const trimmed = text.trim();
  switch (status) {
    case "ready": return "Connection ready.";
    case "needs_auth": return `Authentication failed — add your key to the SSH agent or check the key file. ${trimmed}`.trim();
    case "blocked": return `Host unreachable — check the network and host/port. ${trimmed}`.trim();
    case "probe_failed": return `Probe failed — ${trimmed || "see the run for details."}`;
    default: return trimmed || "Unknown.";
  }
}

function readinessCommand(profile: TerminalProfile): { file: string; args: string[] } {
  if (profile.kind === "local") return { file: "/usr/bin/true", args: [] };
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"];
  // ssh_key_file probes with the identity file (a path, never a secret).
  if (profile.authMethod === "ssh_key_file" && profile.keyPath) args.push("-i", profile.keyPath);
  if (profile.port && profile.port !== 22) args.push("-p", String(profile.port));
  args.push(`${profile.user}@${profile.host}`, "true");
  return { file: "/usr/bin/ssh", args };
}

function classifyExit(exitCode: number | null, text: string): "ready" | "needs_auth" | "probe_failed" | "blocked" {
  if (exitCode === 0) return "ready";
  if (/permission denied|publickey|password|passphrase|authentication/i.test(text)) return "needs_auth";
  if (/could not resolve|name or service not known|no route to host|connection timed out|operation timed out/i.test(text)) return "blocked";
  return "probe_failed";
}

async function defaultRunner(file: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<TerminalReadinessRunnerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: TerminalReadinessRunnerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      finish({ exitCode: null, stdout, stderr: `${stderr}\nProbe timed out`.trim() });
    }, opts.timeoutMs ?? 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => finish({ exitCode: code, stdout, stderr }));
  });
}
