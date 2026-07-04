import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getConfigDir(): string {
  return join(homedir(), ".hivematrix");
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export type HiveConfig = Record<string, unknown>;

export function loadHiveConfig(): HiveConfig {
  try {
    return JSON.parse(readFileSync(getConfigPath(), "utf-8")) as HiveConfig;
  } catch {
    return {};
  }
}

export function saveHiveConfig(config: HiveConfig): void {
  mkdirSync(getConfigDir(), { recursive: true });
  // Atomic write (tmp + rename): out-of-process readers (the PreToolUse approval
  // hook greps this file from Claude Code task processes) must never observe a
  // half-written config — and the heartbeat now rewrites it on an interval.
  const path = getConfigPath();
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2));
  renameSync(tmp, path);
}
