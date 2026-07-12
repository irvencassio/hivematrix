/**
 * AGENTS.md support — the converged open standard for repo conventions (stack,
 * build/test commands, house style, permission boundaries). Codex/Cursor/Copilot
 * read it natively; Claude Code (reads CLAUDE.md) does NOT,
 * so HiveMatrix injects it for them so every coding task follows the repo's rules.
 *
 * Per the ETH Zurich finding, the value is in a tight, hand-curated file — we
 * inject the repo's authored AGENTS.md verbatim (bounded), never auto-generate one.
 * Cloud-stall-safe: async, time-bounded read (a project may sit on a cloud mount).
 */

import { promises as fs } from "fs";
import { join } from "path";

const MAX_CHARS = 8_000;
const READ_TIMEOUT_MS = 3_000;
const CANDIDATES = ["AGENTS.md", ".agents.md"];

async function readWithTimeout(path: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), READ_TIMEOUT_MS); });
  const read = fs.readFile(path, "utf-8").then((c) => c as string).catch(() => null);
  try { return await Promise.race([read, timeout]); } finally { if (timer) clearTimeout(timer); }
}

/** Read the project's AGENTS.md (root), bounded. Null if absent/unreadable. */
export async function readAgentsMd(projectPath: string): Promise<string | null> {
  for (const name of CANDIDATES) {
    const raw = await readWithTimeout(join(projectPath, name));
    if (raw && raw.trim()) return raw.trim().slice(0, MAX_CHARS);
  }
  return null;
}

/** Wrap AGENTS.md content as a labeled system-prompt block. "" when empty. */
export function formatAgentsMd(content: string | null): string {
  if (!content || !content.trim()) return "";
  return `--- Project conventions (AGENTS.md) — follow these for any code/file work ---\n${content.trim()}`;
}
