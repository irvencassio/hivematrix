/**
 * Hardware-aware local-engine provisioner (the "helper installer").
 *
 * Sizes the Rapid-MLX local engine to THIS Mac, installs the engine if needed,
 * pulls only the model tiers that fit in RAM, and writes the matching
 * `localEngine` block into ~/.hivematrix/config.json. Idempotent.
 *
 *   npx tsx scripts/provision-local-engine.mts            # plan only (dry run)
 *   npx tsx scripts/provision-local-engine.mts --apply    # install + pull + write config
 *
 * Greying-out is the UI's job (Settings reads localEngineCapability); this is
 * the matching install side: a machine that can't keep a tier resident never
 * gets it pulled or configured here.
 */

import { execFileSync, execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  localEngineCapability, probeHardware, DEFAULT_TIERS, resolveRapidBinary,
  type TierKey, type LocalTier,
} from "../src/lib/models/local-engine";

const APPLY = process.argv.includes("--apply");
function line(s = "") { process.stdout.write(s + "\n"); }
function configPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "config.json");
}
function readConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(configPath(), "utf-8")); } catch { return {}; }
}

/** Install Rapid-MLX into a stable venv and return the binary path. */
function installRapidMlx(): string {
  const venv = join(homedir(), ".hivematrix", "rapidmlx", ".venv");
  const bin = join(venv, "bin", "rapid-mlx");
  if (existsSync(bin)) { line(`  rapid-mlx already present at ${bin}`); return bin; }
  line("  creating venv + installing rapid-mlx (this can take a minute)…");
  execSync(`python3 -m venv ${JSON.stringify(venv)}`, { stdio: "inherit" });
  execSync(`${JSON.stringify(join(venv, "bin", "pip"))} install --upgrade pip rapid-mlx`, { stdio: "inherit" });
  // Symlink into a discoverable location so the daemon's resolver finds it.
  const localBin = join(homedir(), ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  try { execSync(`ln -sf ${JSON.stringify(bin)} ${JSON.stringify(join(localBin, "rapid-mlx"))}`); } catch { /* best effort */ }
  return bin;
}

async function main() {
  const hw = probeHardware();
  const cap = localEngineCapability(hw);
  line(`\nHiveMatrix local-engine provisioner — ${Math.round(hw.ramGB)} GB ${hw.arch}\n`);

  // Per-tier capability report (this is exactly what the UI greys out).
  for (const t of cap.tiers) {
    const mark = t.residentCapable ? "✓ resident" : t.capable ? "○ on-demand" : "✗ unavailable";
    line(`  ${t.key.padEnd(7)} ${mark}${t.reason ? "  — " + t.reason : ""}`);
  }

  if (!cap.localCapable) {
    line(`\n${cap.reason}`);
    line("Nothing to install. Configure cloud frontier keys instead (Settings → Models).");
    if (APPLY) {
      const cfg = readConfig();
      cfg.localEngine = { engine: "rapid-mlx", binary: null, tiers: [] };
      writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
      line("Wrote cloud-only localEngine block (no tiers).");
    }
    return;
  }

  const tiers: LocalTier[] = cap.recommendedTiers
    .map((k: TierKey) => DEFAULT_TIERS.find((d) => d.key === k))
    .filter((t): t is LocalTier => !!t);
  line(`\nRecommended resident profile: ${tiers.map((t) => `${t.key} (${t.alias})`).join(" + ")}`);

  if (!APPLY) {
    line("\nDry run — re-run with --apply to install Rapid-MLX, pull these models, and write config.\n");
    return;
  }

  // 1. Engine binary.
  line("\n[1/3] Rapid-MLX engine");
  const bin = resolveRapidBinary(cap as never) ?? installRapidMlx();
  line(`  using ${bin}`);
  try { execFileSync(bin, ["doctor"], { stdio: "inherit" }); } catch { /* doctor is advisory */ }

  // 2. Pull only the models that fit.
  line("\n[2/3] Pulling models (only the tiers that fit in RAM)");
  for (const t of tiers) {
    line(`  pull ${t.alias}…`);
    execFileSync(bin, ["pull", t.alias], { stdio: "inherit" });
  }

  // 3. Write config.
  line("\n[3/3] Writing ~/.hivematrix/config.json localEngine block");
  const cfg = readConfig();
  cfg.localEngine = { engine: "rapid-mlx", binary: bin, tiers };
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  line("  done. Restart the daemon — it will serve the configured tiers on boot.\n");
}

main().catch((e) => { line(`✗ ${e?.message ?? e}`); process.exit(1); });
