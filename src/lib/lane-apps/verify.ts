import { spawn } from "node:child_process";

// Injectable command runner — same shape as terminal-lane/readiness.ts so unit
// tests never shell out.
export interface LaneAppCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
export type LaneAppCommandRunner = (
  file: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<LaneAppCommandResult>;

export interface VerifyLaneAppInput {
  appPath: string;
  executable: string;
  /** Run the launch probe (open + pgrep). Off by default — it actually starts the app. */
  launchProbe?: boolean;
  run?: LaneAppCommandRunner;
  timeoutMs?: number;
}

export interface VerifyLaneAppResult {
  codesignOk: boolean;
  gatekeeperOk: boolean;
  /** codesign AND spctl both accepted. */
  signatureOk: boolean;
  /** null when the launch probe was not requested. */
  launchOk: boolean | null;
  details: {
    codesign: string;
    spctl: string;
    launch?: string;
  };
}

// Verify a lane app bundle. codesign + spctl establish signature validity;
// the optional launch probe establishes that the bundle ACTUALLY launches —
// which codesign/spctl passing does not guarantee (the LaunchServices lesson:
// a signed, Gatekeeper-clean bundle with a bad entitlement still fails to run).
export async function verifyLaneApp(input: VerifyLaneAppInput): Promise<VerifyLaneAppResult> {
  const run = input.run ?? defaultRunner;
  const timeoutMs = input.timeoutMs ?? 15_000;

  const codesign = await run("codesign", ["--verify", "--deep", "--strict", input.appPath], { timeoutMs });
  const codesignOk = codesign.exitCode === 0;

  const spctl = await run("spctl", ["-a", "-vvv", "-t", "exec", input.appPath], { timeoutMs });
  const gatekeeperOk = spctl.exitCode === 0;

  const signatureOk = codesignOk && gatekeeperOk;

  let launchOk: boolean | null = null;
  let launchDetail: string | undefined;
  if (input.launchProbe) {
    const open = await run("open", ["-g", input.appPath], { timeoutMs });
    if (open.exitCode !== 0) {
      launchOk = false;
      launchDetail = `open failed: ${(open.stderr || open.stdout).trim()}`;
    } else {
      const pgrep = await run("pgrep", ["-f", input.executable], { timeoutMs });
      launchOk = pgrep.exitCode === 0 && pgrep.stdout.trim().length > 0;
      launchDetail = launchOk ? "launched" : "process not found after launch";
      // Best-effort cleanup so the probe doesn't leave the app running.
      if (launchOk) await run("pkill", ["-f", input.executable], { timeoutMs }).catch(() => undefined);
    }
  }

  return {
    codesignOk,
    gatekeeperOk,
    signatureOk,
    launchOk,
    details: {
      codesign: codesignOk ? "valid" : (codesign.stderr || codesign.stdout).trim() || "codesign rejected",
      spctl: gatekeeperOk ? "accepted" : (spctl.stderr || spctl.stdout).trim() || "spctl rejected",
      ...(launchDetail ? { launch: launchDetail } : {}),
    },
  };
}

async function defaultRunner(
  file: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<LaneAppCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: LaneAppCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      finish({ exitCode: null, stdout, stderr: `${stderr}\nCommand timed out`.trim() });
    }, opts.timeoutMs ?? 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => finish({ exitCode: code, stdout, stderr }));
  });
}
