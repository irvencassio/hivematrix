/**
 * Secrets via environment variables, with set/unset visibility in settings.
 *
 * Keys are NEVER stored in config.json or returned to clients — only their env
 * var name and whether they're currently set. `secretStatuses()` powers the
 * settings view ("is this key configured?") without ever exposing the value.
 */

export interface SecretSpec {
  /** Environment variable name. */
  env: string;
  /** Human label for settings. */
  label: string;
  /** What it unlocks. */
  purpose: string;
}

/** The keys HiveMatrix knows how to use. Add a row to surface a new integration. */
export const KNOWN_SECRETS: SecretSpec[] = [
  { env: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", purpose: "Frontier model" },
  { env: "OPENAI_API_KEY", label: "OpenAI / Codex", purpose: "Frontier model, Codex, fallback embeddings" },
  { env: "NANAI_API_KEY", label: "Nano Banana", purpose: "Image generation (cloud)" },
  { env: "APCA_API_KEY_ID", label: "Alpaca key id", purpose: "Market data — Market Data Lane (data only, never trades)" },
  { env: "APCA_API_SECRET_KEY", label: "Alpaca secret", purpose: "Market data — Market Data Lane (data only, never trades)" },
  { env: "X_API_KEY", label: "X consumer key", purpose: "X/Twitter posting (OAuth 1.0a)" },
  { env: "X_API_SECRET", label: "X consumer secret", purpose: "X/Twitter posting (OAuth 1.0a)" },
  { env: "X_ACCESS_TOKEN", label: "X access token", purpose: "X/Twitter posting (OAuth 1.0a)" },
  { env: "X_ACCESS_SECRET", label: "X access secret", purpose: "X/Twitter posting (OAuth 1.0a)" },
  { env: "YOUTUBE_API_KEY", label: "YouTube Data API", purpose: "YouTube watcher (alt to config)" },
  { env: "PERSONAL_ACCESS_TOKEN", label: "Azure DevOps PAT", purpose: "ADO MCP auth (pat mode — base64 email:pat)" },
  { env: "ADO_MCP_AUTH_TOKEN", label: "Azure DevOps Entra token", purpose: "ADO MCP auth (envvar mode — Entra bearer)" },
];

export interface SecretStatus extends SecretSpec {
  set: boolean;
}

/** True when the env var is present and non-blank. Pure (env injectable). */
export function isSecretSet(envName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[envName];
  return typeof v === "string" && v.trim().length > 0;
}

/** Per-key set/unset status for the settings view. Never includes values. */
export function secretStatuses(env: NodeJS.ProcessEnv = process.env): SecretStatus[] {
  return KNOWN_SECRETS.map((s) => ({ ...s, set: isSecretSet(s.env, env) }));
}
