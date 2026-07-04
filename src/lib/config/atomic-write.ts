/**
 * Crash-safe JSON file write: serialize to a sibling temp file, then rename
 * over the target. rename(2) is atomic on the same filesystem, so readers see
 * either the old or the new content — never a truncated file. config.json is
 * read by nearly every subsystem (features, autonomy, models, qwen profile);
 * a partial write there silently degrades all of them.
 */

import { renameSync, writeFileSync } from "fs";

export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}
