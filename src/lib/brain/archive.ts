/**
 * Brain doc archive/restore/delete (§4 of the design spec, plus an explicit
 * operator request to add permanent delete). Archiving MOVES a doc to
 * <brainRoot>/projects/<slug>/_archived/<relFile> (preserving any sub-path);
 * restoring moves it back. Because every corpus walker (indexer.ts, search.ts,
 * hygiene.ts, doc-review.ts's active-doc listing) already skips a directory
 * named `_archived`, the move alone removes the doc from context, search, and
 * the semantic index — no extra flag needed, unlike exclude (§5) which keeps
 * the file in its original spot.
 *
 * Delete is deliberately scoped to ALREADY-ARCHIVED docs only — it permanently
 * unlinks a file from `_archived/`, never a still-active doc. That keeps the
 * irreversible step behind the reversible one: archive, verify nothing broke,
 * then delete for good, rather than a one-click permanent removal of a live doc.
 *
 * Bounded + Drive-stall-safe: fs.rename/unlink can still stall on a dehydrated
 * cloud mount, so each races against a timeout like every other brain fs touch.
 */

import { promises as fs } from "fs";
import { dirname, join } from "path";
import { BRAIN_READ_TIMEOUT_MS } from "@/lib/brain/memory-bundle";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { projectDocBrainRelPath } from "@/lib/brain/doc-review";

export interface ArchiveMoveResult {
  ok: boolean;
  error?: string;
}

async function moveWithTimeout(from: string, to: string, timeoutMs = BRAIN_READ_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((res) => { timer = setTimeout(() => res(false), timeoutMs); });
  const move = (async () => {
    await fs.mkdir(dirname(to), { recursive: true });
    await fs.rename(from, to);
    return true;
  })().catch(() => false);
  try {
    return await Promise.race([move, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function archivedPathFor(root: string, slug: string, relFile: string): string {
  return join(root, "projects", slug, "_archived", relFile);
}

/** Move a project doc into its project's _archived/ dir. Path-guarded via projectDocBrainRelPath. */
export async function archiveProjectDoc(slug: string, relFile: string, brainRootDir?: string): Promise<ArchiveMoveResult> {
  const root = brainRootDir ?? configuredBrainRootDir();
  if (!root) return { ok: false, error: "no brain root configured" };
  const relPath = projectDocBrainRelPath(slug, relFile, root);
  if (!relPath) return { ok: false, error: "invalid or out-of-bounds path" };
  const from = join(root, relPath);
  const to = archivedPathFor(root, slug, relFile);
  const moved = await moveWithTimeout(from, to);
  return moved ? { ok: true } : { ok: false, error: "archive failed (missing file, permissions, or a stalled cloud mount) — the file was left in place" };
}

/** Move an archived doc back to its normal project-relative location. */
export async function restoreProjectDoc(slug: string, relFile: string, brainRootDir?: string): Promise<ArchiveMoveResult> {
  const root = brainRootDir ?? configuredBrainRootDir();
  if (!root) return { ok: false, error: "no brain root configured" };
  const relPath = projectDocBrainRelPath(slug, relFile, root);
  if (!relPath) return { ok: false, error: "invalid or out-of-bounds path" };
  const from = archivedPathFor(root, slug, relFile);
  const to = join(root, relPath);
  const moved = await moveWithTimeout(from, to);
  return moved ? { ok: true } : { ok: false, error: "restore failed (missing file, permissions, or a stalled cloud mount) — the file was left in place" };
}

async function unlinkWithTimeout(path: string, timeoutMs = BRAIN_READ_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((res) => { timer = setTimeout(() => res(false), timeoutMs); });
  const del = fs.unlink(path).then(() => true).catch(() => false);
  try {
    return await Promise.race([del, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Permanently delete an archived doc. Scoped to `_archived/` only — the path
 * is built from the same archivedPathFor() as archive/restore, so this can
 * never reach outside a project's archive dir, and it never touches a doc
 * still at its active location. Irreversible; the caller must confirm.
 */
export async function deleteArchivedProjectDoc(slug: string, relFile: string, brainRootDir?: string): Promise<ArchiveMoveResult> {
  const root = brainRootDir ?? configuredBrainRootDir();
  if (!root) return { ok: false, error: "no brain root configured" };
  const relPath = projectDocBrainRelPath(slug, relFile, root); // validates relFile has no traversal
  if (!relPath) return { ok: false, error: "invalid or out-of-bounds path" };
  const target = archivedPathFor(root, slug, relFile);
  const deleted = await unlinkWithTimeout(target);
  return deleted ? { ok: true } : { ok: false, error: "delete failed (not archived, permissions, or a stalled cloud mount)" };
}
