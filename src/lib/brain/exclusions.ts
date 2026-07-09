/**
 * Brain doc exclusion sidecar for the Brain / Memory Review screen (§5 of
 * docs/superpowers/specs/2026-07-09-brain-memory-review-console-design.md).
 * Keyed by brain-relative path — mirrors the embeddings-index.json sidecar
 * pattern. Excluding a doc drops it from the auto-load bundle, the awareness
 * index block, and the semantic index; it stays on disk and keyword-
 * searchable, and the flag is reversible.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function exclusionsPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "brain-exclusions.json");
}

/** All currently-excluded brain-relative paths. Never throws. */
export function loadExclusions(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(exclusionsPath(), "utf-8")) as { excluded?: unknown };
    return new Set(Array.isArray(raw.excluded) ? raw.excluded.filter((p): p is string => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

export function isExcluded(brainRelPath: string): boolean {
  return loadExclusions().has(brainRelPath);
}

/** Toggle the exclusion flag for one or more brain-relative paths. */
export function setExcluded(brainRelPaths: string[], excluded: boolean): void {
  const set = loadExclusions();
  for (const p of brainRelPaths) {
    if (excluded) set.add(p);
    else set.delete(p);
  }
  writeFileSync(exclusionsPath(), JSON.stringify({ excluded: [...set].sort() }, null, 2));
}
