/**
 * Writing a brain document.
 *
 * Flash could search and read the brain but never write to it: its whole tool
 * set was read-only for files. So "research this and create a brain doc" — a
 * routine request — was structurally impossible. The model tried the
 * `brain-chat` skill, which is an INSTRUCTION skill: it returns a recipe saying
 * "write the file", which Flash then had no tool to carry out. A fallback that
 * cannot work, behind a capability that does not exist, presented to the
 * operator as "tool limitations". Observed 2026-07-19.
 *
 * Confined to the brain root by the same `resolveInRoot` the read path uses —
 * deliberately the same function, not a second copy of the check.
 */

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { dirname, extname } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { resolveInRoot } from "@/lib/brain/read";

/** Extensions a brain doc may have. Keeps this from becoming a general file writer. */
const ALLOWED_EXTENSIONS = new Set([".md", ".html", ".txt"]);

/** Refuse absurd payloads outright rather than filling the vault. */
const MAX_CHARS = 400_000;

export interface BrainWriteResult {
  ok: boolean;
  path: string;
  bytes?: number;
  overwritten?: boolean;
  reason?: string;
}

export interface BrainWriteOptions {
  root?: string | null;
  /** Replace an existing doc. Default false: writing over notes by accident is worse than an error. */
  overwrite?: boolean;
}

/**
 * Write `content` to a brain-root-relative `path`. Never throws — every failure
 * is a returned reason, so a tool call reports something useful instead of
 * dying mid-turn.
 */
export function writeBrainDoc(
  path: string,
  content: string,
  opts: BrainWriteOptions = {},
): BrainWriteResult {
  const root = opts.root !== undefined ? opts.root : configuredBrainRootDir();
  const requested = String(path ?? "").trim();

  if (!root) return { ok: false, path: requested, reason: "brain memory is disabled or no brain root is configured" };
  if (!requested) return { ok: false, path: requested, reason: "'path' is required" };
  if (typeof content !== "string" || !content.trim()) {
    return { ok: false, path: requested, reason: "'content' is required and cannot be empty" };
  }
  if (content.length > MAX_CHARS) {
    return { ok: false, path: requested, reason: `content is ${content.length} chars; the limit is ${MAX_CHARS}` };
  }

  const ext = extname(requested).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      path: requested,
      reason: `only ${[...ALLOWED_EXTENSIONS].join(", ")} files may be written to the brain (got "${ext || "no extension"}")`,
    };
  }

  const resolved = resolveInRoot(root, requested);
  if (!resolved) {
    return {
      ok: false,
      path: requested,
      reason: 'path escapes the brain root — only paths inside the brain root may be written (no absolute paths or ".." traversal)',
    };
  }

  const existed = existsSync(resolved);
  if (existed && !opts.overwrite) {
    return { ok: false, path: requested, reason: "a document already exists at that path; pass overwrite:true to replace it" };
  }

  try {
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, content, "utf-8");
    return { ok: true, path: requested, bytes: Buffer.byteLength(content, "utf-8"), overwritten: existed };
  } catch (e) {
    return { ok: false, path: requested, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Operator-facing one-liner for a tool result. */
export function formatBrainWriteResult(r: BrainWriteResult): string {
  if (!r.ok) return `Error: could not write "${r.path}" — ${r.reason}`;
  return `${r.overwritten ? "Replaced" : "Saved"} brain doc "${r.path}" (${r.bytes} bytes).`;
}
