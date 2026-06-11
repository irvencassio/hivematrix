import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getConfigDir(): string {
  return join(homedir(), ".hive");
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
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}
