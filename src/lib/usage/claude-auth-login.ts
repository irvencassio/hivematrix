import { execFile as nodeExecFile } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildCliPath } from "@/lib/config/binary-detection";

type ExecFile = (file: string, args: string[]) => Promise<void>;

export interface ClaudeAuthLoginOptions {
  homeDir?: string;
  execFile?: ExecFile;
  cliPath?: string;
}

export interface ClaudeAuthLoginResult {
  ok: boolean;
  detail: string;
  scriptPath: string;
}

function defaultExecFile(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, { timeout: 10_000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildAuthScript(cliPath: string): string {
  return `#!/bin/zsh
export PATH=${shellQuote(cliPath)}
clear
echo "HiveMatrix Claude auth login"
echo
echo "This runs: claude auth login"
echo "Complete the Claude login flow, then return to HiveMatrix and click refresh."
echo
claude auth login
status=$?
echo
if [ "$status" -eq 0 ]; then
  echo "Claude auth login finished."
  echo "Return to HiveMatrix and click refresh."
else
  echo "Claude auth login exited with status $status."
fi
echo
echo "Press Return to close this window."
read -r _
exit "$status"
`;
}

export async function startClaudeAuthLogin(
  options: ClaudeAuthLoginOptions = {},
): Promise<ClaudeAuthLoginResult> {
  const homeDir = options.homeDir ?? homedir();
  const dir = join(homeDir, ".hivematrix");
  const scriptPath = join(dir, "claude-auth-login.command");
  const cliPath = options.cliPath ?? buildCliPath();
  const execFile = options.execFile ?? defaultExecFile;

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(scriptPath, buildAuthScript(cliPath), { mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  await execFile("open", [scriptPath]);

  return {
    ok: true,
    detail: "Opened Terminal for claude auth login. After it finishes, refresh Frontier Usage.",
    scriptPath,
  };
}
