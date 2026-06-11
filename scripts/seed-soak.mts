/**
 * Seed recurring directives for the 72h soak (via the running daemon's HTTP API).
 *
 * Creates schedule-triggered directives with NO criteria — the directive engine
 * runs each, then re-arms it forever (a criteria-less directive can never
 * self-complete; it re-arms per its trigger policy). Each cycle spawns a tiny
 * real Qwen task, exercising scheduler → spawnGenericAgent → LM Studio →
 * tool-bridge → verify → re-arm continuously.
 *
 *   npx tsx scripts/seed-soak.mts              # against daemon on :3747
 *   HIVEMATRIX_PORT=3747 npx tsx scripts/seed-soak.mts
 *
 * Going through the API keeps the daemon the single DB writer. Idempotent:
 * skips a goal that already exists.
 */

const PORT = process.env.HIVEMATRIX_PORT ?? "3747";
const BASE = `http://127.0.0.1:${PORT}`;

const SOAK_DIRECTIVES = [
  { goal: "SOAK heartbeat A: use the bash tool to append the current date to /tmp/hm-soak-heartbeat-A.txt, then stop.", interval: "PT3M" },
  { goal: "SOAK heartbeat B: use the write_file tool to write the text BEAT to /tmp/hm-soak-heartbeat-B.txt, then stop.", interval: "PT5M" },
  { goal: "SOAK compute: use the bash tool to compute 2+2 and write the result to /tmp/hm-soak-compute.txt, then stop.", interval: "PT7M" },
];

async function main() {
  const listRes = await fetch(`${BASE}/directives`);
  if (!listRes.ok) throw new Error(`daemon not reachable at ${BASE} (HTTP ${listRes.status})`);
  const existing = new Set((await listRes.json() as { goal: string }[]).map((d) => d.goal));

  let created = 0;
  for (const spec of SOAK_DIRECTIVES) {
    if (existing.has(spec.goal)) {
      console.log(`skip (exists): ${spec.goal.slice(0, 50)}…`);
      continue;
    }
    const res = await fetch(`${BASE}/directives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: spec.goal,
        project: "hivematrix",
        projectPath: "/tmp",
        triggerPolicy: { type: "schedule", interval: spec.interval },
      }),
    });
    if (!res.ok) { console.error(`failed: ${spec.goal.slice(0, 40)} (HTTP ${res.status})`); continue; }
    const d = await res.json() as { _id: string };
    console.log(`created ${d._id} (every ${spec.interval}): ${spec.goal.slice(0, 50)}…`);
    created++;
  }
  console.log(`\nSeeded ${created} new soak directive(s). They re-arm forever → continuous scheduled work.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
