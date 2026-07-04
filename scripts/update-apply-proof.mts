/**
 * Prove update *apply* end-to-end against the real (private) GitHub release,
 * with rollback safety. Does NOT touch the live daemon bundle — installs to a
 * staging dir and uses a no-op restart — so it's safe to run repeatedly.
 *
 *   npx tsx scripts/update-apply-proof.mts
 *
 * 1. Resolve the release from config.updater (authenticated, private repo).
 * 2. applyUpdate happy path: real auth download → verify (SHA-256 + Ed25519) →
 *    DB backup → staged extract → probe OK → done.
 * 3. applyUpdate rollback: same, but probe fails → DB restored from backup.
 */

import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

// CRITICAL: isolate backup/restore to a throwaway DB so this NEVER touches the
// live daemon's ~/.hivematrix/hivematrix.db. The updater resolves the DB path
// from HIVEMATRIX_DB_PATH at call time.
const proofDb = join(mkdtempSync(join(tmpdir(), "hm-apply-db-")), "proof.db");
process.env.HIVEMATRIX_DB_PATH = proofDb;

const { getUpdaterConfig, downloadRelease, CURRENT_VERSION } = await import("../src/lib/updater/daemon-update");
const { applyUpdate, checkForUpdate } = await import("../src/lib/updater/updater");

function line(s = "") { process.stdout.write(s + "\n"); }
const dbPath = proofDb;

async function main() {
  const cfg = getUpdaterConfig();
  if (!cfg.channelUrl) { line("✗ config.updater not set"); process.exit(1); }
  line("Update Apply Proof (real private GitHub release, staged + safe)");
  line("================================================================");

  // Resolve the published release via the authenticated channel.
  const chk = await checkForUpdate(CURRENT_VERSION, cfg.channelUrl, cfg.channel, fetch, cfg.headers);
  const release = chk.manifest?.latest;
  if (!release) { line(`✗ could not fetch release manifest: ${chk.error}`); process.exit(1); }
  line(`release: v${release.version}  sha256=${release.tarballSha256.slice(0, 12)}…  signed=${!!release.signature}`);
  line("");

  writeFileSync(dbPath, "INITIAL_DB_STATE"); // seed the throwaway DB for backup
  const stage = mkdtempSync(join(tmpdir(), "hm-apply-"));
  let installedTo = "";

  const baseHooks = {
    download: (r: typeof release) => downloadRelease(r, cfg.headers, join(stage, "release.tar.gz")),
    install: async (tarball: string) => {
      // Stage-extract only — never swaps the live bundle in this proof.
      installedTo = join(stage, "extracted");
      execFileSync("mkdir", ["-p", installedTo]);
      execFileSync("tar", ["xzf", tarball, "-C", installedTo]);
    },
    restart: async () => { /* no-op: do not restart the live daemon in the proof */ },
    publicKeyPem: cfg.publicKeyPem,
  };

  // --- Happy path ---
  line("1) Happy path (probe OK):");
  const ok = await applyUpdate(release, { ...baseHooks, probe: async () => true });
  line(`   steps: ${ok.steps.join(" → ")}`);
  line(`   result: ${ok.ok ? "✓ done" : "✗ " + ok.error}`);
  const extractedApp = existsSync(join(installedTo, "HiveMatrix.app"));
  line(`   [${extractedApp ? "✓" : "✗"}] real tarball downloaded + verified + extracted (HiveMatrix.app present)`);
  line(`   [${ok.backupPath && existsSync(ok.backupPath) ? "✓" : "✗"}] pre-update DB backup created`);
  line("");

  // --- Rollback safety ---
  line("2) Rollback safety (probe FAILS → DB restored):");
  const sentinel = "DB_STATE_" + Date.now();
  writeFileSync(dbPath, sentinel); // mark current DB state
  const rb = await applyUpdate(release, {
    ...baseHooks,
    install: async (tarball: string) => {
      // Simulate a migration that corrupts the DB; rollback must restore it.
      execFileSync("tar", ["xzf", tarball, "-C", stage]);
      writeFileSync(dbPath, "CORRUPTED_BY_MIGRATION");
    },
    probe: async () => false,
  });
  line(`   steps: ${rb.steps.join(" → ")}`);
  line(`   [${rb.rolledBack ? "✓" : "✗"}] rollback triggered on failed probe`);
  const restored = readFileSync(dbPath, "utf-8") === sentinel;
  line(`   [${restored ? "✓" : "✗"}] DB restored to pre-update state`);
  line("");

  const pass = ok.ok && extractedApp && !!ok.backupPath && rb.rolledBack && restored;
  line(pass ? "✓ APPLY PROVEN END-TO-END (real download, verify, backup, rollback-safe)"
            : "✗ apply proof incomplete");
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { line(`fatal: ${e instanceof Error ? e.message : e}`); process.exit(1); });
