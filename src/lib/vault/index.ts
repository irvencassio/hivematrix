/**
 * Credential Vault — macOS Keychain-backed secret store.
 *
 * Secrets are namespaced as vault://<scope>/<name> (e.g. vault://site/github.com).
 * Refs are safe to carry in prompts, task payloads, SSE events, and audit logs.
 * Plaintext values resolve ONLY inside lane execution code via resolveVaultRef().
 *
 * Import restrictions (enforced by code review and scope-wall):
 *   - Only browser-lane, terminal-lane, daemon (server.ts), and config may import vault.
 *   - vault/ must NOT import from orchestrator/.
 */

export type { VaultRef } from "./refs";
export { isVaultRef, makeRef, parseRef, describeRef } from "./refs";
export type { VaultRefEntry } from "./store";
export { getVaultStore } from "./store";
export { scrubSecrets, scrubSecretsText, TRACE_REDACTION_MASK } from "./redaction";

/**
 * Resolve a vault:// ref to its plaintext value.
 *
 * Call ONLY from lane execution code (browser-lane login fill, terminal-lane
 * host auth, config secrets resolution). Never pass the resolved value to a
 * model, SSE event, or audit log — carry the ref instead.
 */
export async function resolveVaultRef(ref: import("./refs").VaultRef): Promise<string> {
  const { getVaultStore } = await import("./store");
  return getVaultStore().get(ref);
}
