/**
 * Hardware-aware local-engine provisioner (CLI wrapper).
 *
 * Thin CLI over src/lib/models/provision.ts — the same logic the daemon runs
 * behind the Settings "Provision local engine" button.
 *
 *   npx tsx scripts/provision-local-engine.mts            # plan only (dry run)
 *   npx tsx scripts/provision-local-engine.mts --apply    # install + pull + write config
 */

import { planLocalEngine, provisionLocalEngine } from "../src/lib/models/provision";

const APPLY = process.argv.includes("--apply");
function line(s = "") { process.stdout.write(s + "\n"); }

async function main() {
  const plan = planLocalEngine();
  line(`\nHiveMatrix local-engine provisioner — ${Math.round(plan.ramGB)} GB ${plan.arch}\n`);
  if (!plan.localCapable) {
    line(plan.reason ?? "This Mac can't run a local model — cloud-only.");
  } else {
    line(`Recommended resident profile: ${plan.tiers.map((t) => `${t.key} (${t.alias})`).join(" + ")}`);
  }

  if (!APPLY) {
    line("\nDry run — re-run with --apply to install Rapid-MLX, pull these models, and write config.\n");
    return;
  }
  line("");
  await provisionLocalEngine({ onLog: line });
  line("");
}

main().catch((e) => { line(`✗ ${e?.message ?? e}`); process.exit(1); });
