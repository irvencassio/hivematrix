/**
 * Secrets via environment variables or the credential vault, with set/unset
 * visibility in settings.
 *
 * Values are NEVER stored in config.json or returned to clients — only whether
 * a secret is currently configured (env var present, or vault ref registered).
 * `secretStatuses()` powers the settings view ("is this key configured?")
 * without ever exposing the value.
 */

import type { VaultRef } from "@/lib/vault/refs";
import { isVaultRef } from "@/lib/vault/refs";
import { resolveVaultRef } from "@/lib/vault";

export interface SecretSpec {
  /** Environment variable name. */
  env: string;
  /** Human label for settings. */
  label: string;
  /** What it unlocks. */
  purpose: string;
  /** Optional vault ref that may supply the value when the env var is absent. */
  vaultRef?: VaultRef;
}

/** The keys HiveMatrix knows how to use. Add a row to surface a new integration. */
export const KNOWN_SECRETS: SecretSpec[] = [
  { env: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", purpose: "Frontier model" },
  { env: "OPENAI_API_KEY", label: "OpenAI / Codex", purpose: "Frontier model, Codex, fallback embeddings" },
  { env: "NANAI_API_KEY", label: "Nano Banana", purpose: "Image generation (cloud)" },
  { env: "APCA_API_KEY_ID", label: "Alpaca key id", purpose: "Market data — Market Data Lane (data only, never trades)", vaultRef: "vault://env/APCA_API_KEY_ID" as VaultRef },
  { env: "APCA_API_SECRET_KEY", label: "Alpaca secret", purpose: "Market data — Market Data Lane (data only, never trades)", vaultRef: "vault://env/APCA_API_SECRET_KEY" as VaultRef },
  { env: "X_API_KEY", label: "X consumer key", purpose: "X/Twitter posting (OAuth 1.0a)", vaultRef: "vault://env/X_API_KEY" as VaultRef },
  { env: "X_API_SECRET", label: "X consumer secret", purpose: "X/Twitter posting (OAuth 1.0a)", vaultRef: "vault://env/X_API_SECRET" as VaultRef },
  { env: "X_ACCESS_TOKEN", label: "X access token", purpose: "X/Twitter posting (OAuth 1.0a)", vaultRef: "vault://env/X_ACCESS_TOKEN" as VaultRef },
  { env: "X_ACCESS_SECRET", label: "X access secret", purpose: "X/Twitter posting (OAuth 1.0a)", vaultRef: "vault://env/X_ACCESS_SECRET" as VaultRef },
  { env: "YOUTUBE_API_KEY", label: "YouTube Data API", purpose: "YouTube watcher (alt to config)", vaultRef: "vault://env/YOUTUBE_API_KEY" as VaultRef },
  { env: "PERSONAL_ACCESS_TOKEN", label: "Azure DevOps PAT", purpose: "ADO MCP auth (pat mode — base64 email:pat)" },
  { env: "ADO_MCP_AUTH_TOKEN", label: "Azure DevOps Entra token", purpose: "ADO MCP auth (envvar mode — Entra bearer)" },
];

export interface SecretStatus extends Omit<SecretSpec, "vaultRef"> {
  set: boolean;
  /** Where the secret is sourced from when set. */
  source: "env" | "vault" | null;
  /** The vault ref associated with this secret, if any. */
  vaultRef?: VaultRef;
}

/**
 * Resolve a secret value: env-var first, vault ref fallback.
 * Call ONLY from lane execution code or config resolution — never pass
 * the returned value to a model, SSE event, or audit log; carry the ref instead.
 */
export async function resolveSecret(
  envName: string,
  opts: {
    env?: NodeJS.ProcessEnv;
    /** Injected in tests instead of the real Keychain/DB vault. */
    resolveRef?: (ref: VaultRef) => Promise<string>;
  } = {},
): Promise<string | undefined> {
  const env = opts.env ?? process.env;
  const envVal = env[envName]?.trim();
  if (envVal) return envVal;

  const spec = KNOWN_SECRETS.find((s) => s.env === envName);
  if (!spec?.vaultRef) return undefined;

  const resolve = opts.resolveRef ?? resolveVaultRef;
  try {
    const val = await resolve(spec.vaultRef);
    return val?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** True when the env var is present and non-blank. Pure (env injectable). */
export function isSecretSet(envName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[envName];
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Per-key set/unset status for the settings view. Never includes values.
 * vaultIndex is the set of known vault refs (from VaultStore.list()) — pass
 * undefined to skip vault source checking (e.g. in tests that don't open DB).
 */
export function secretStatuses(
  env: NodeJS.ProcessEnv = process.env,
  vaultIndex?: Set<string>,
): SecretStatus[] {
  return KNOWN_SECRETS.map((s) => {
    const fromEnv = isSecretSet(s.env, env);
    const fromVault =
      !fromEnv &&
      s.vaultRef != null &&
      isVaultRef(s.vaultRef) &&
      (vaultIndex != null ? vaultIndex.has(s.vaultRef) : false);

    const set = fromEnv || fromVault;
    const source: "env" | "vault" | null = fromEnv ? "env" : fromVault ? "vault" : null;

    const status: SecretStatus = { env: s.env, label: s.label, purpose: s.purpose, set, source };
    if (s.vaultRef) status.vaultRef = s.vaultRef;
    return status;
  });
}
