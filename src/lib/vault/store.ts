import { getDb } from "@/lib/db";
import { VaultKeychain } from "./keychain";
import type { KeychainRunner } from "./keychain";
import { makeRef, parseRef } from "./refs";
import type { VaultRef } from "./refs";

export interface VaultRefEntry {
  ref: VaultRef;
  scope: string;
  name: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

interface VaultRefRow {
  scope: string;
  name: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export class VaultStore {
  private readonly kc: VaultKeychain;

  constructor(opts: { keychainRunner?: KeychainRunner } = {}) {
    this.kc = new VaultKeychain({ run: opts.keychainRunner });
  }

  /** Write a secret to the Keychain and record its ref in the SQLite index. */
  async set(scope: string, name: string, value: string, label = ""): Promise<VaultRef> {
    await this.kc.setSecret(scope, name, value);
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO vault_refs (scope, name, label, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope, name) DO UPDATE SET
        label    = excluded.label,
        updatedAt = excluded.updatedAt
    `).run(scope, name, label, now, now);
    return makeRef(scope, name);
  }

  /** Resolve a vault:// ref to its plaintext value.
   *  Only call this from lane execution code — never pass the result to a model or audit log. */
  async get(ref: VaultRef): Promise<string> {
    const { scope, name } = parseRef(ref);
    return this.kc.getSecret(scope, name);
  }

  /** Remove a secret from the Keychain and the SQLite index. */
  async delete(scope: string, name: string): Promise<void> {
    await this.kc.deleteSecret(scope, name);
    getDb().prepare("DELETE FROM vault_refs WHERE scope = ? AND name = ?").run(scope, name);
  }

  /** List ref metadata — never returns values. */
  list(scope?: string): VaultRefEntry[] {
    const rows = (scope
      ? getDb().prepare("SELECT * FROM vault_refs WHERE scope = ? ORDER BY scope, name").all(scope)
      : getDb().prepare("SELECT * FROM vault_refs ORDER BY scope, name").all()) as VaultRefRow[];
    return rows.map((r) => ({ ...r, ref: makeRef(r.scope, r.name) }));
  }

  /** True when the ref exists in our index (does not re-read the Keychain). */
  has(ref: VaultRef): boolean {
    const { scope, name } = parseRef(ref);
    return !!getDb()
      .prepare("SELECT 1 FROM vault_refs WHERE scope = ? AND name = ?")
      .get(scope, name);
  }
}

let _store: VaultStore | null = null;

export function getVaultStore(): VaultStore {
  _store ??= new VaultStore();
  return _store;
}
