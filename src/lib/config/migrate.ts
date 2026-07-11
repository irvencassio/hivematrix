/**
 * One-time config migration: drops dead local-Qwen config keys and resets any
 * role-model override that names a stale local/Qwen model id back to the
 * Claude default (Claude-native cutover, 2026-07-11 — see
 * docs/superpowers/plans/2026-07-11-claude-native-cutover.md, Phase 5).
 *
 * Idempotent: a config with no qwen/localEngine/localModel keys and no
 * non-frontier role overrides is left untouched — no rewrite, no log, no
 * downgrade path needed. A config rolled back to a pre-cutover build simply
 * re-provisions Qwen from scratch (acceptable — see the plan's Phase 5 note).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { writeJsonAtomic } from "./atomic-write";
import { isFrontierOverride } from "@/lib/routing/model-resolver";

/** Whole subtrees dropped wholesale — "and nested" in the spec means their
 * entire nested content (e.g. qwen.sampling, qwen.primary) goes with the
 * parent key, not that there are additional sibling keys to hunt for. */
const DEAD_KEYS = ["qwen", "localEngine", "localModel"] as const;

/** Role-model override keys — reset to "" (→ Claude default) when the stored
 * value doesn't match isFrontierOverride (i.e. it names a Qwen/local id that
 * no longer resolves to anything). */
const ROLE_MODEL_KEYS = ["operationalModel", "thinkModel", "frontierModel", "writerModel"] as const;

export interface ConfigMigrationResult {
  changed: boolean;
  droppedKeys: string[];
  resetRoleModels: string[];
}

const NO_CHANGE: ConfigMigrationResult = { changed: false, droppedKeys: [], resetRoleModels: [] };

/**
 * Pure: apply the migration to an in-memory config object. Returns a new
 * object (input is never mutated) plus a report describing what changed, so
 * callers can decide whether a write + log is needed.
 */
export function migrateConfigObject(cfg: Record<string, unknown>): { config: Record<string, unknown>; result: ConfigMigrationResult } {
  const next = { ...cfg };
  const droppedKeys: string[] = [];
  for (const key of DEAD_KEYS) {
    if (key in next) {
      delete next[key];
      droppedKeys.push(key);
    }
  }

  const resetRoleModels: string[] = [];
  for (const key of ROLE_MODEL_KEYS) {
    const v = next[key];
    if (typeof v === "string" && v.trim() && !isFrontierOverride(v.trim())) {
      delete next[key];
      resetRoleModels.push(key);
    }
  }

  const changed = droppedKeys.length > 0 || resetRoleModels.length > 0;
  return { config: next, result: changed ? { changed, droppedKeys, resetRoleModels } : NO_CHANGE };
}

function configPath(): string {
  return join(homedir(), ".hivematrix", "config.json");
}

let _loggedOnce = false;

/**
 * Read ~/.hivematrix/config.json, apply the migration, and write back
 * atomically only if something changed. No-op on a missing/corrupt config
 * (left for the normal onboarding flow) or an already-migrated one. Logs once
 * per process. Never throws — a write failure is caught and reported, not
 * propagated, so it can never block daemon boot.
 */
export function migrateConfig(): ConfigMigrationResult {
  const path = configPath();
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return NO_CHANGE;
  }

  const { config, result } = migrateConfigObject(cfg);
  if (!result.changed) return NO_CHANGE;

  try {
    writeJsonAtomic(path, config);
  } catch (err) {
    console.error(`[config-migrate] failed to write migrated config: ${err instanceof Error ? err.message : String(err)}`);
    return NO_CHANGE;
  }

  if (!_loggedOnce) {
    _loggedOnce = true;
    const bits = [
      result.droppedKeys.length ? `dropped [${result.droppedKeys.join(", ")}]` : null,
      result.resetRoleModels.length ? `reset role override(s) [${result.resetRoleModels.join(", ")}] to default` : null,
    ].filter(Boolean);
    console.log(`[config-migrate] Claude-native cutover: ${bits.join("; ")}`);
  }
  return result;
}
