import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface YouTubeConfig {
  enabled: boolean;
  apiKey: string;
  playlistId: string;
  pollIntervalMinutes: number;
  maxPerTick: number;
}

/** Read the youtube watcher config from ~/.hivematrix/config.json (null if absent). */
export function getYouTubeConfig(): YouTubeConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const y = cfg?.youtube;
    if (!y || typeof y !== "object") return null;
    return {
      enabled: y.enabled === true,
      apiKey: typeof y.apiKey === "string" ? y.apiKey.trim() : "",
      playlistId: typeof y.playlistId === "string" ? y.playlistId.trim() : "",
      pollIntervalMinutes: typeof y.pollIntervalMinutes === "number" && y.pollIntervalMinutes > 0 ? y.pollIntervalMinutes : 30,
      maxPerTick: typeof y.maxPerTick === "number" && y.maxPerTick > 0 ? Math.min(y.maxPerTick, 20) : 5,
    };
  } catch {
    return null;
  }
}

/** True only when fully configured (enabled + key + playlist). */
export function isYouTubeWatcherEnabled(): boolean {
  const c = getYouTubeConfig();
  return !!c && c.enabled && !!c.apiKey && !!c.playlistId;
}
