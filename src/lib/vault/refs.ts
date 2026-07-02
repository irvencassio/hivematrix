/** Opaque ref carried in prompts, payloads, SSE events, and audit logs.
 *  The literal secret value NEVER appears outside VaultStore.get(). */
export type VaultRef = `vault://${string}/${string}`;

// Scope is lowercase only; name allows uppercase/underscore for env-var-sourced secrets.
const SCOPE_SEG = "[a-z0-9._:-]+";
const NAME_SEG = "[a-zA-Z0-9._:_-]+";
const REF_RE = new RegExp(`^vault://(${SCOPE_SEG})/(${NAME_SEG})$`);

export function isVaultRef(s: unknown): s is VaultRef {
  return typeof s === "string" && REF_RE.test(s);
}

export function makeRef(scope: string, name: string): VaultRef {
  return `vault://${scope}/${name}` as VaultRef;
}

export function parseRef(ref: string): { scope: string; name: string } {
  const m = REF_RE.exec(ref);
  if (!m) throw new Error(`Invalid vault ref: ${ref}`);
  return { scope: m[1], name: m[2] };
}

/** Replace all vault:// refs in a string with their scope/name form (for display). */
export function describeRef(ref: VaultRef): string {
  const { scope, name } = parseRef(ref);
  return `${scope}/${name}`;
}
