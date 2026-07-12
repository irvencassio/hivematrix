/**
 * brain_read — read the FULL text of a single brain document by path, as
 * returned by brain_search's hits. brain_search finds candidate docs with a
 * relevance score and a snippet; this fetches one doc's complete content so
 * an agent can actually answer from it instead of guessing off a fragment
 * (the gap: "what are my Solo Founder goals" got a snippet and a punt).
 *
 * Same discipline as search.ts: a bounded, timed read (the brain root
 * commonly lives on a dehydrating Google Drive mount) so a stalled Drive
 * never hangs the daemon, plus a hard output cap so one huge doc can't blow
 * the model's context.
 *
 * SECURITY: the requested path is resolved against the brain root and MUST
 * stay inside it — no absolute paths, no `..` traversal to escape the root.
 * A path that resolves outside the root is refused before any read is
 * attempted.
 */

import { promises as fs } from "fs";
import { resolve, sep } from "path";
import { configuredBrainRootDir } from "./settings";

export interface BrainReadResult {
  root: string | null;
  /** The path as requested by the caller (not the resolved absolute path). */
  path: string;
  ok: boolean;
  content: string;
  truncated: boolean;
  reason?: string;
}

export interface BrainReadOptions {
  root?: string | null;
  /** Hard cap on returned content length. Default ~20k chars. */
  maxChars?: number;
  /** Per-file read timeout — mirrors search.ts's readWithTimeout budget. */
  timeoutMs?: number;
}

type ReadOutcome = { ok: true; content: string } | { ok: false; reason: string };

async function readWithTimeout(path: string, timeoutMs: number): Promise<ReadOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReadOutcome>((resolvePromise) => {
    timer = setTimeout(
      () => resolvePromise({ ok: false, reason: "timed out reading the file (possibly a stalled cloud-drive mount)" }),
      timeoutMs,
    );
  });
  const read = fs.readFile(path, "utf-8")
    .then((content): ReadOutcome => ({ ok: true, content }))
    .catch((err: NodeJS.ErrnoException): ReadOutcome => ({
      ok: false,
      reason: err && err.code === "ENOENT" ? "not found" : `read error: ${err instanceof Error ? err.message : String(err)}`,
    }));
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve `relPath` against `root`, requiring the result to stay inside the
 * root. Returns null (never a path) if the request would escape — including
 * via an absolute path (path.resolve treats an absolute second argument as
 * the whole answer, which this rejects) or a `..` traversal.
 */
function resolveInRoot(root: string, relPath: string): string | null {
  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, relPath);
  const rootWithSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (candidate !== rootResolved && !candidate.startsWith(rootWithSep)) return null;
  return candidate;
}

/**
 * Read a brain doc's full content by its brain-root-relative path. Bounded,
 * best-effort, and sandboxed to the brain root — see file header.
 */
export async function readBrainDoc(path: string, opts: BrainReadOptions = {}): Promise<BrainReadResult> {
  const root = opts.root !== undefined ? opts.root : configuredBrainRootDir();
  const maxChars = opts.maxChars ?? 20_000;
  const timeoutMs = opts.timeoutMs ?? 4_000;
  const requested = String(path ?? "").trim();

  if (!root) {
    return { root: null, path: requested, ok: false, content: "", truncated: false, reason: "brain memory is disabled or no brain root is configured" };
  }
  if (!requested) {
    return { root, path: requested, ok: false, content: "", truncated: false, reason: "'path' is required" };
  }

  const resolved = resolveInRoot(root, requested);
  if (!resolved) {
    return {
      root, path: requested, ok: false, content: "", truncated: false,
      reason: "path escapes the brain root — only paths inside the brain root may be read (no absolute paths or \"..\" traversal)",
    };
  }

  const outcome = await readWithTimeout(resolved, timeoutMs);
  if (!outcome.ok) {
    return {
      root, path: requested, ok: false, content: "", truncated: false,
      reason: outcome.reason === "not found"
        ? "no such file under the brain root — try brain_search first to find the exact path"
        : outcome.reason,
    };
  }

  const truncated = outcome.content.length > maxChars;
  const content = truncated ? outcome.content.slice(0, maxChars) : outcome.content;
  return { root, path: requested, ok: true, content, truncated };
}

/** Render a read result as the string an agent tool returns. */
export function formatBrainReadResult(result: BrainReadResult): string {
  if (!result.ok) return `Error: ${result.reason ?? "could not read the file"}.`;
  const note = result.truncated
    ? `\n\n(Truncated to ${result.content.length} chars — the document is longer than this cap.)`
    : "";
  return `${result.path}:\n${result.content}${note}`;
}
