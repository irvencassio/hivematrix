/**
 * Voice sidecar env overlay (Claude-native cutover, 2026-07-11).
 *
 * The local-Qwen LLM wiring this module used to derive (HIVE_LLM_*, pointed at
 * the daemon's configured local model) is gone — voice routes through the
 * Flash lane end to end now, so the sidecar's own LLM selection is irrelevant.
 * This overlay only carries app metadata into the child env; the sidecar keeps
 * whatever defaults it has for anything else.
 */

import { VERSION, BUILD_NUMBER, BUILD_DATE } from "@/lib/version";

const APP_META: Record<string, string> = {
  HIVE_APP_VERSION: VERSION,
  HIVE_APP_BUILD: String(BUILD_NUMBER),
  HIVE_APP_BUILD_DATE: BUILD_DATE,
};

export function voiceLlmEnv(): Record<string, string> {
  return { ...APP_META };
}
