/**
 * What actually gets injected into a task's prompt, as a list the operator can see.
 *
 * Every task carries tens of KB of preamble assembled from several places, and
 * none of it was visible anywhere. That opacity hid two real problems:
 *
 *   - AGENTS.md is silently truncated at 8000 chars. The file is near that cap,
 *     and its git-hygiene rules sit LAST — so they are what gets cut first, with
 *     no warning to anyone.
 *   - `agentGuide` in a task's recorded overhead is not a file. It is an
 *     accumulator over ~8 generated blocks plus ~/.hivematrix/agent-guide.md,
 *     which does not exist on this machine. It reported 16,747 bytes from a
 *     path with nothing at it, which reads as a file you could go and edit.
 *
 * This module answers one question honestly: for this project, what is loaded,
 * from where, how big is it, and is any of it being cut off?
 *
 * Read-only. Never throws — an unreadable source is reported as such, never a
 * reason to fail the caller.
 */

import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getActiveProfile } from "@/lib/config/constants";

export type ContextSourceKind = "file" | "generated";

export interface ContextSource {
  /** Display label, e.g. "AGENTS.md". */
  label: string;
  kind: ContextSourceKind;
  /** Absolute path for kind==="file"; null for generated blocks. */
  path: string | null;
  /** Bytes contributed. 0 when missing. */
  bytes: number;
  /** Character cap applied at injection, if any. */
  capChars: number | null;
  /** True when the source exceeds its cap and is being cut. */
  truncated: boolean;
  /** False when a file source does not exist on disk. */
  found: boolean;
  /** Short plain-English note on what this contributes. */
  note: string;
}

/** AGENTS.md cap — must match MAX_CHARS in lib/conventions/agents-md.ts. */
export const AGENTS_MD_MAX_CHARS = 8_000;

/** Filenames readAgentsMd() tries, in order. Must match its CANDIDATES. */
const AGENTS_MD_CANDIDATES = ["AGENTS.md", ".agents.md"];

function fileSource(
  label: string,
  path: string,
  note: string,
  capChars: number | null = null,
): ContextSource {
  let bytes = 0;
  let chars = 0;
  let found = false;
  try {
    if (existsSync(path) && statSync(path).isFile()) {
      const raw = readFileSync(path, "utf-8");
      found = true;
      bytes = Buffer.byteLength(raw);
      chars = raw.trim().length;
    }
  } catch {
    found = false;
  }
  return {
    label,
    kind: "file",
    path,
    bytes,
    capChars,
    truncated: found && capChars !== null && chars > capChars,
    found,
    note,
  };
}

/**
 * The generated system-prompt blocks that make up most of what a task reads.
 * They are listed so the total is honest, but they are not files and cannot be
 * edited directly — that distinction is the whole point of showing them.
 */
const GENERATED_BLOCKS: ReadonlyArray<{ label: string; note: string }> = [
  { label: "Brain doc policy", note: "How and where the agent may write brain docs." },
  { label: "Verification gate", note: "The requirement to verify work before reporting done." },
  { label: "Outbound routing", note: "Which lane handles outbound HTTP." },
  { label: "Brain search routing", note: "How to search the brain instead of guessing." },
  { label: "Brain index", note: "Titles of available brain docs for this project." },
  { label: "Lane tools routing", note: "Which lane tools exist and when to reach for them." },
  { label: "Agent roster", note: "Live agent types a COO task may delegate to." },
  { label: "Delegation directive", note: "Plan-and-review-at-the-top instruction (self-planning work only)." },
];

/**
 * Enumerate every context source a task in `projectPath` would load.
 * `profile` mirrors spawnAgent's optional Claude-profile override.
 */
export function listContextSources(projectPath: string, profile?: string): ContextSource[] {
  const sources: ContextSource[] = [];

  // AGENTS.md — the capped one. Report the candidate that exists, else the
  // conventional name so the operator can see it is simply absent.
  const agentsPath =
    AGENTS_MD_CANDIDATES.map((n) => join(projectPath, n)).find((p) => existsSync(p)) ??
    join(projectPath, AGENTS_MD_CANDIDATES[0]);
  sources.push(
    fileSource(
      "AGENTS.md",
      agentsPath,
      "Repo conventions injected verbatim into every coding task.",
      AGENTS_MD_MAX_CHARS,
    ),
  );

  sources.push(
    fileSource("CLAUDE.md", join(projectPath, "CLAUDE.md"), "Loaded natively by Claude Code for this project."),
  );

  const cfgDir = profile ? `.${profile}` : getActiveProfile();
  sources.push(
    fileSource(
      "MEMORY.md",
      join(homedir(), cfgDir, "projects", projectPath.replace(/\//g, "-"), "memory", "MEMORY.md"),
      "Persistent cross-session memory index for this project.",
    ),
  );

  sources.push(
    fileSource(
      "agent-guide.md",
      join(homedir(), ".hivematrix", "agent-guide.md"),
      "Optional operator-authored guide appended to every task. Absent by default — the large 'agentGuide' figure in task overhead is mostly the generated blocks below, not this file.",
    ),
  );

  for (const b of GENERATED_BLOCKS) {
    sources.push({
      label: b.label,
      kind: "generated",
      path: null,
      bytes: 0,
      capChars: null,
      truncated: false,
      found: true,
      note: b.note,
    });
  }

  return sources;
}

export interface ContextInventory {
  projectPath: string;
  sources: ContextSource[];
  /** Total bytes of the FILE sources (generated blocks are sized at spawn time). */
  fileBytes: number;
  /** Files that exist and are being cut off by a cap. */
  truncated: string[];
  /** File sources that are absent. */
  missing: string[];
}

export function contextInventory(projectPath: string, profile?: string): ContextInventory {
  const sources = listContextSources(projectPath, profile);
  const files = sources.filter((s) => s.kind === "file");
  return {
    projectPath,
    sources,
    fileBytes: files.reduce((n, s) => n + s.bytes, 0),
    truncated: files.filter((s) => s.truncated).map((s) => s.label),
    missing: files.filter((s) => !s.found).map((s) => s.label),
  };
}
