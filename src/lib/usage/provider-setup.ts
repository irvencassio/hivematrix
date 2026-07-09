/**
 * Provider install + login launcher — writes a zsh `.command` script per
 * frontier provider and opens it in Terminal for the operator to complete
 * interactively. Generalizes the original Claude-only `claude-auth-login.ts`
 * (kept as a thin back-compat wrapper) to cover Codex too.
 *
 * Install/login commands are deliberately asymmetric per provider (see the
 * design spec, §0): Codex has a full scriptable install; Claude is
 * login-first with a best-effort install attempt and a manual-install
 * fallback URL echoed on failure.
 */

import { execFile as nodeExecFile } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildCliPath, findBinary, CLAUDE_BINARY_SEARCH_PATHS, CODEX_BINARY_SEARCH_PATHS } from "@/lib/config/binary-detection";
import type { FrontierProviderId } from "@/lib/config/frontier-providers";

type ExecFile = (file: string, args: string[]) => Promise<void>;

export interface ProviderSetupOptions {
  homeDir?: string;
  execFile?: ExecFile;
  cliPath?: string;
  /** Whether the binary is already present — skips the install step when true. Defaults to a real findBinary probe. */
  binaryPresent?: boolean;
}

export interface ProviderSetupResult {
  ok: boolean;
  detail: string;
  scriptPath: string;
}

interface ProviderSetupCommands {
  label: string;
  binaryName: string;
  /** Shell lines run only when the binary is not already present. */
  installLines: string[];
  loginLine: string;
}

const PROVIDER_SETUP_COMMANDS: Record<FrontierProviderId, ProviderSetupCommands> = {
  codex: {
    label: "Codex",
    binaryName: "codex",
    installLines: ["npm install -g @openai/codex"],
    loginLine: "codex login",
  },
  claude: {
    label: "Claude",
    binaryName: "claude",
    installLines: [
      'npm install -g @anthropic-ai/claude-code || echo "If that failed, install manually: https://claude.com/claude-code"',
    ],
    loginLine: "claude auth login",
  },
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildSetupScript(id: FrontierProviderId, cliPath: string, installNeeded: boolean): string {
  const cmds = PROVIDER_SETUP_COMMANDS[id];
  const installBlock = installNeeded
    ? `echo "${cmds.binaryName} CLI not found — installing…"\n${cmds.installLines.join("\n")}\necho\n`
    : "";
  return `#!/bin/zsh
export PATH=${shellQuote(cliPath)}
clear
echo "HiveMatrix ${cmds.label} setup"
echo
${installBlock}echo "This runs: ${cmds.loginLine}"
echo "Complete the ${cmds.label} login flow, then return to HiveMatrix and click refresh."
echo
${cmds.loginLine}
status=$?
echo
if [ "$status" -eq 0 ]; then
  echo "${cmds.label} login finished."
  echo "Return to HiveMatrix and click refresh."
else
  echo "${cmds.label} login exited with status $status."
fi
echo
echo "Press Return to close this window."
read -r _
exit "$status"
`;
}

function defaultExecFile(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, { timeout: 10_000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function detectBinaryPresent(id: FrontierProviderId): boolean {
  const searchPaths = id === "claude" ? CLAUDE_BINARY_SEARCH_PATHS : CODEX_BINARY_SEARCH_PATHS;
  return !!findBinary(id, searchPaths);
}

/** Writes the `.command` script and returns its path. Does not open it. */
export function writeProviderSetupCommand(id: FrontierProviderId, options: ProviderSetupOptions = {}): string {
  const homeDir = options.homeDir ?? homedir();
  const dir = join(homeDir, ".hivematrix");
  const scriptPath = join(dir, `${id}-setup.command`);
  const cliPath = options.cliPath ?? buildCliPath();
  const binaryPresent = options.binaryPresent ?? detectBinaryPresent(id);

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(scriptPath, buildSetupScript(id, cliPath, !binaryPresent), { mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  return scriptPath;
}

/** Writes the setup script and opens it in Terminal. */
export async function openProviderSetup(
  id: FrontierProviderId,
  options: ProviderSetupOptions = {},
): Promise<ProviderSetupResult> {
  const scriptPath = writeProviderSetupCommand(id, options);
  const execFile = options.execFile ?? defaultExecFile;
  await execFile("open", [scriptPath]);

  const label = PROVIDER_SETUP_COMMANDS[id].label;
  return {
    ok: true,
    detail: `Opened Terminal for ${label} setup. After it finishes, refresh Frontier Usage.`,
    scriptPath,
  };
}
