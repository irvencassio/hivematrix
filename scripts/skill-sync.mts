/**
 * Standalone skill sync/fan-out/prune CLI — the same lib the daemon uses, so
 * non-HiveMatrix users get the core. Reads <brain>/skills and ~/.hivematrix/config.json.
 *
 *   npx tsx scripts/skill-sync.mts --pull        # git pull + import into the brain store
 *   npx tsx scripts/skill-sync.mts --push        # render brain skills out + git push
 *   npx tsx scripts/skill-sync.mts               # sync both ways
 *   npx tsx scripts/skill-sync.mts --fanout      # write skills into Claude/Codex/Qwen dirs
 *   npx tsx scripts/skill-sync.mts --prune       # list skills you no longer use
 */

import { gitSyncSkills } from "../src/lib/skills/sync";
import { fanOutSkills } from "../src/lib/skills/fanout";
import { stalePruneCandidates } from "../src/lib/skills/prune";
import { readAllSkills } from "../src/lib/skills/store";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
function line(s = "") { process.stdout.write(s + "\n"); }

async function main() {
  if (has("--prune")) {
    const c = stalePruneCandidates(await readAllSkills());
    if (!c.length) { line("No unused skills — library is lean."); return; }
    line(`Unused skills (${c.length}):`);
    for (const x of c) line(`  ${x.name} — ${x.reason}, ${x.ageDays}d idle, ${x.useCount} uses`);
    return;
  }

  if (has("--fanout")) {
    line("Fanning out trusted skills to harness dirs…");
    for (const r of await fanOutSkills(await readAllSkills())) {
      line(`  ${r.id} (${r.dir}): wrote ${r.written}, removed ${r.removed}${r.skipped.length ? `, skipped ${r.skipped.length}` : ""}`);
    }
    return;
  }

  const direction = has("--pull") ? "pull" : has("--push") ? "push" : "both";
  line(`git sync (${direction})…`);
  const s = await gitSyncSkills({ direction, onLog: line });
  if (!s.configured) { line("No skillsSync.repoUrl configured in ~/.hivematrix/config.json."); }
  else line(`imported ${s.imported}, refined ${s.refined}${s.pushed ? ", pushed" : ""}${s.errors.length ? `, ${s.errors.length} error(s)` : ""}`);

  line("Fanning out to harness dirs…");
  for (const r of await fanOutSkills(await readAllSkills())) {
    line(`  ${r.id}: wrote ${r.written}, removed ${r.removed}`);
  }
}

main().catch((e) => { line(`✗ ${e?.message ?? e}`); process.exit(1); });
