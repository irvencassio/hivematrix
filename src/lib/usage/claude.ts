import { execFileSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { createHash } from "crypto";

export type ClaudeAuthMode = "subscription" | "logged-out";

function getCredentialSuffix(configDir: string): string {
  const fullPath = configDir.startsWith("/") ? configDir : join(homedir(), configDir);
  const defaultPath = join(homedir(), ".claude");
  if (fullPath === defaultPath) return "";
  return `-${createHash("sha256").update(fullPath).digest("hex").slice(0, 8)}`;
}

export function readClaudeAuthMode(configDir: string): ClaudeAuthMode {
  const suffix = getCredentialSuffix(configDir);
  const service = suffix ? `Claude Code-credentials${suffix}` : "Claude Code-credentials";

  try {
    const raw = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    const creds = JSON.parse(raw) as {
      claudeAiOauth?: {
        accessToken?: string;
        expiresAt?: number;
      };
    };
    const oauth = creds?.claudeAiOauth;
    if (oauth?.accessToken && typeof oauth.expiresAt === "number" && oauth.expiresAt > Date.now()) {
      return "subscription";
    }
  } catch {
    // Treat missing or unreadable credentials as logged out.
  }

  return "logged-out";
}
