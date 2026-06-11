import { loadHiveConfig, saveHiveConfig, type HiveConfig } from "@/lib/central/config";
import { normalizeAuthBeeSessionEntries, type AuthBeeSessionRecord } from "./contracts";

const AUTHBEE_SESSIONS_KEY = "authbeeSessions";

export function getAuthBeeSessionEntries(config: HiveConfig = loadHiveConfig()): AuthBeeSessionRecord[] {
  return normalizeAuthBeeSessionEntries(config[AUTHBEE_SESSIONS_KEY]);
}

export function setAuthBeeSessionEntries(config: HiveConfig, entries: AuthBeeSessionRecord[]): void {
  config[AUTHBEE_SESSIONS_KEY] = entries;
}

export function saveAuthBeeSessionEntries(entries: AuthBeeSessionRecord[]): void {
  const config = loadHiveConfig();
  setAuthBeeSessionEntries(config, entries);
  saveHiveConfig(config);
}
