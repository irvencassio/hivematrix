/**
 * Daemon-side updater (Phase 5).
 *
 * Flow: check channel manifest → download tarball → verify (SHA-256 + Ed25519
 * signature, fail-closed) → backup the SQLite DB → apply (migrations are
 * forward-only, run on next daemon start) → restart via launchd → post-start
 * health probe → rollback to the previous version on a failed probe.
 *
 * The platform updates itself; agents never hot-patch the running system — they
 * propose patches as PRs into the release channel (CTO-verdict line, June 10).
 *
 * Download and restart are injected as hooks so the orchestration is testable
 * without a real CDN or a real launchctl restart.
 */

import { createHash, verify as cryptoVerify } from "crypto";
import { readFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  type UpdateManifest,
  type UpdateRelease,
  type UpdateChannel,
  parseManifest,
  isUpdateAvailable,
} from "./manifest";

function hivematrixDir(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dbPath(): string {
  return process.env.HIVEMATRIX_DB_PATH || join(hivematrixDir(), "hivematrix.db");
}

export function backupsDir(): string {
  const dir = join(hivematrixDir(), "backups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// --- Integrity + authenticity -------------------------------------------------

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Verify an Ed25519 signature over the message bytes. Returns false on any
 * error (fail-closed). `publicKeyPem` is the channel's published verify key;
 * with no key configured, updates are refused.
 */
export function verifyEd25519(message: Buffer, signatureB64: string, publicKeyPem: string | null): boolean {
  if (!publicKeyPem) return false;
  try {
    return cryptoVerify(null, message, publicKeyPem, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Verify a downloaded tarball: SHA-256 must match the manifest, and the
 * manifest's signature (over the SHA-256 hex string) must verify against the
 * configured public key. Fail-closed.
 */
export function verifyDownload(
  tarballPath: string,
  release: UpdateRelease,
  publicKeyPem: string | null
): { ok: boolean; reason: string } {
  if (!existsSync(tarballPath)) return { ok: false, reason: "tarball missing" };
  const actual = sha256File(tarballPath);
  if (actual !== release.tarballSha256) {
    return { ok: false, reason: `sha256 mismatch (got ${actual.slice(0, 12)}…, want ${release.tarballSha256.slice(0, 12)}…)` };
  }
  if (!verifyEd25519(Buffer.from(release.tarballSha256, "utf-8"), release.signature, publicKeyPem)) {
    return { ok: false, reason: "signature verification failed" };
  }
  return { ok: true, reason: "verified" };
}

// --- DB backup / restore ------------------------------------------------------

export function backupDatabase(label = "preupdate"): string | null {
  const src = dbPath();
  if (!existsSync(src)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backupsDir(), `hivematrix-${label}-${stamp}.db`);
  copyFileSync(src, dest);
  return dest;
}

/** Keep the most recent `keep` backups; delete older ones. */
export function pruneBackups(keep = 5): number {
  const dir = backupsDir();
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("hivematrix-") && f.endsWith(".db"))
    .sort()
    .reverse();
  let removed = 0;
  for (const f of files.slice(keep)) {
    rmSync(join(dir, f), { force: true });
    removed++;
  }
  return removed;
}

export function restoreDatabase(backupPath: string): boolean {
  if (!existsSync(backupPath)) return false;
  copyFileSync(backupPath, dbPath());
  return true;
}

// --- Check ----------------------------------------------------------------

export async function checkForUpdate(
  currentVersion: string,
  channelUrl: string,
  channel: UpdateChannel = "stable",
  fetchImpl: typeof fetch = fetch,
  headers?: Record<string, string>
): Promise<{ available: boolean; release: UpdateRelease | null; manifest: UpdateManifest | null; error?: string }> {
  try {
    const res = await fetchImpl(channelUrl, { signal: AbortSignal.timeout(15_000), headers });
    if (!res.ok) return { available: false, release: null, manifest: null, error: `HTTP ${res.status}` };
    const manifest = parseManifest(await res.json());
    if (!manifest) return { available: false, release: null, manifest: null, error: "invalid manifest" };
    if (manifest.channel !== channel) {
      return { available: false, release: null, manifest, error: `channel mismatch (${manifest.channel} != ${channel})` };
    }
    const available = isUpdateAvailable(currentVersion, manifest);
    return { available, release: available ? manifest.latest : null, manifest };
  } catch (err) {
    return { available: false, release: null, manifest: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Apply orchestration ---------------------------------------------------

export interface UpdateHooks {
  /** Download the release tarball to a local path; return that path. */
  download: (release: UpdateRelease) => Promise<string>;
  /** Swap the running bundle to the new version (extract/install). */
  install: (tarballPath: string, release: UpdateRelease) => Promise<void>;
  /** Restart the daemon (e.g. launchctl kickstart -k). */
  restart: () => Promise<void>;
  /** Post-restart health probe; true = healthy. */
  probe: () => Promise<boolean>;
  /** Public key for signature verification (null = refuse). */
  publicKeyPem: string | null;
}

export type UpdateStep =
  | "checked" | "downloaded" | "verified" | "backed_up"
  | "installed" | "restarted" | "probed" | "rolled_back" | "done" | "failed";

export interface UpdateOutcome {
  ok: boolean;
  steps: UpdateStep[];
  version?: string;
  backupPath?: string | null;
  error?: string;
  rolledBack?: boolean;
}

/**
 * Run the full migrate-backup-restart-probe-rollback update for a release.
 * Any failure before restart aborts cleanly; a failed post-restart probe
 * triggers a DB restore + rollback signal.
 */
export async function applyUpdate(release: UpdateRelease, hooks: UpdateHooks): Promise<UpdateOutcome> {
  const steps: UpdateStep[] = [];
  let backupPath: string | null = null;
  try {
    const tarball = await hooks.download(release);
    steps.push("downloaded");

    const verdict = verifyDownload(tarball, release, hooks.publicKeyPem);
    if (!verdict.ok) {
      steps.push("failed");
      return { ok: false, steps, error: `verification failed: ${verdict.reason}` };
    }
    steps.push("verified");

    backupPath = backupDatabase("preupdate");
    pruneBackups();
    steps.push("backed_up");

    await hooks.install(tarball, release);
    steps.push("installed");

    await hooks.restart();
    steps.push("restarted");

    const healthy = await hooks.probe();
    steps.push("probed");
    if (!healthy) {
      // Rollback: restore the DB; the bundle rollback is the installer's
      // responsibility (previous version retained by the install layer).
      if (backupPath) restoreDatabase(backupPath);
      steps.push("rolled_back");
      return { ok: false, steps, error: "post-update health probe failed", backupPath, rolledBack: true };
    }

    steps.push("done");
    return { ok: true, steps, version: release.version, backupPath };
  } catch (err) {
    steps.push("failed");
    return { ok: false, steps, error: err instanceof Error ? err.message : String(err), backupPath };
  }
}
