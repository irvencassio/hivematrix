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
  const runner = input.run ?? defaultRunner;
  const command = readinessCommand(profile);
  const result = await runner(command.file, command.args, { timeoutMs: input.timeoutMs ?? 10_000 });
  const text = `${result.stdout}\n${result.stderr}`;
  const state = normalizeTerminalReadinessState(classifyExit(result.exitCode, text));
  return {
    profile,
    state,
    summary: state.status === "ready" ? "Connection ready" : (text.trim() || state.label),
    command,
  };
}

function readinessCommand(profile: TerminalProfile): { file: string; args: string[] } {
  if (profile.kind === "local") return { file: "/usr/bin/true", args: [] };
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
  ];
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
