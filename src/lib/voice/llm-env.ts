/**
 * Derive the voice sidecar's LLM env (HIVE_LLM_*) from the daemon's configured
 * local model (the Qwen profile) so the spoken loop routes to the SAME local
 * server the rest of HiveMatrix uses, instead of the sidecar's hardcoded LM
 * Studio default (:1234). The sidecar's llm.py reads these vars natively; this
 * is the daemon-side half that feeds them in when it spawns turn_cli.py.
 *
 * Returns an env OVERLAY to merge into the child's env. When no local profile is
 * configured we return {} and the sidecar keeps its own defaults — never break
 * the loop just because the router has nothing to say.
 */

import { getQwenProfile } from "@/lib/config/qwen-profile";
import { getLocalEngineConfig, localTargetForRole } from "@/lib/models/local-engine";
import { VERSION, BUILD_NUMBER, BUILD_DATE } from "@/lib/version";

/** OpenAI-compatible base URL for an endpoint: append /v1 unless already versioned. */
export function openAiBaseUrl(endpoint: string): string {
  const e = endpoint.trim().replace(/\/+$/, "");
  return /\/v\d+$/.test(e) ? e : `${e}/v1`;
}

/**
 * HIVE_LLM_* overlay for the voice loop. Prefers the profile's SECONDARY model
 * (the faster "operational" role) for live-voice latency, falling back to the
 * primary; endpoint and modelId are taken from the SAME config so they stay
 * paired. Empty object when no local profile exists.
 */
const APP_META: Record<string, string> = {
  HIVE_APP_VERSION: VERSION,
  HIVE_APP_BUILD: String(BUILD_NUMBER),
  HIVE_APP_BUILD_DATE: BUILD_DATE,
};

export function voiceLlmEnv(): Record<string, string> {
  const profile = getQwenProfile();

  // When the configured local model is an explicit OpenAI-compatible server
  // (Dwarf Star DeepSeek, vLLM, LM Studio, Ollama), route voice to that SAME
  // model+endpoint. Otherwise the default Rapid-MLX engine kind would send voice
  // to a stale tier alias (e.g. a Qwen tier) that isn't the model actually
  // loaded — it only "works" because the server ignores the model name.
  if (profile && profile.primary.provider !== "mlx") {
    const model = profile.secondary ?? profile.primary;
    return {
      HIVE_LLM_BASE_URL: openAiBaseUrl(model.endpoint),
      HIVE_LLM_MODEL: model.modelId,
      HIVE_LLM_API_KEY: "local",
      ...APP_META,
    };
  }

  // Rapid-MLX engine: use the FAST/operational local tier (reasoning off).
  const le = getLocalEngineConfig();
  if (le.engine === "rapid-mlx") {
    const t = localTargetForRole("operational", le);
    if (t) return { HIVE_LLM_BASE_URL: t.endpoint, HIVE_LLM_MODEL: t.model, HIVE_LLM_API_KEY: "local", ...APP_META };
  }
  if (!profile) return { ...APP_META };
  const model = profile.secondary ?? profile.primary;
  return {
    HIVE_LLM_BASE_URL: openAiBaseUrl(model.endpoint),
    HIVE_LLM_MODEL: model.modelId,
    HIVE_LLM_API_KEY: "local",
    ...APP_META,
  };
}
