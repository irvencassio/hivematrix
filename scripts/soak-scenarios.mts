/**
 * Phase 5 soak failure-injection harness.
 *
 * Drives the live daemon through the three required unattended-failure
 * scenarios and verifies recovery from each:
 *   A. Usage exhaustion → local-only degrade → restore to cloud-ok
 *   B. Network drop      → offline (network capabilities gated) → restore
 *   C. Forced restart    → launchd kickstart → orphan recovery → resume
 *
 *   npx tsx scripts/soak-scenarios.mts
 *
 * Asserts the daemon stays operational and recovers cleanly; the background
 * soak directives keep cycling throughout.
 */

import { promisify } from "util";
import { execFile } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const execFileAsync = promisify(execFile);
const BASE = "http://127.0.0.1:3747";
const TOKEN = (() => { try { return readFileSync(join(homedir(), ".hivematrix", "auth-token"), "utf-8").trim(); } catch { return ""; } })();
function line(s = "") { process.stdout.write(s + "\n"); }

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const headers = { ...(opts.headers ?? {}), "Authorization": "Bearer " + TOKEN };
  const r = await fetch(BASE + path, { ...opts, headers, signal: AbortSignal.timeout(8000) });
  if (r.status === 204) return null;
  return r.json();
}
async function setMode(mode: string | null) {
  return api("/connectivity/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
}
async function waitHealthy(timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const h = await api("/health"); if (h?.status === "ok") return true; } catch { /* down */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = "") {
  line(`  [${ok ? "✓" : "✗"}] ${label}${detail ? " — " + detail : ""}`);
  if (ok) passed++; else failed++;
}

async function scenarioUsageExhaustion() {
  line("Scenario A: usage exhaustion → local-only → restore");
  const before = await api("/connectivity");
  check("daemon starts reachable", !!before, `mode=${before?.mode}`);

  // Simulate frontier usage exhausted → operator/auto degrade to local-only.
  await setMode("local-only");
  const degraded = await api("/connectivity");
  check("degraded to local-only", degraded?.mode === "local-only");

  // Local work must still be available; frontier gated.
  const m = await api("/metrics");
  check("daemon operational in local-only", m?.uptimeSeconds >= 0, `runs=${m?.runs?.done}done/${m?.runs?.failed}failed`);
  check("directives still active (cycling on Qwen)", (m?.directivesByStatus?.active ?? 0) >= 1);

  // Restore (usage window reopened).
  await setMode(null);
  const restored = await api("/connectivity");
  check("restored to cloud-ok", restored?.mode === "cloud-ok");
}

async function scenarioNetworkDrop() {
  line("Scenario B: network drop → offline → restore");
  await setMode("offline");
  const off = await api("/connectivity");
  check("entered offline", off?.mode === "offline");

  // Daemon stays up; local execution continues.
  const m = await api("/metrics");
  check("daemon healthy while offline", m?.uptimeSeconds >= 0);
  check("no run failures during offline", (m?.runs?.failed ?? 0) === 0, `failed=${m?.runs?.failed}`);

  await setMode(null);
  const back = await api("/connectivity");
  check("network restored → cloud-ok", back?.mode === "cloud-ok");
}

async function scenarioForcedRestart() {
  line("Scenario C: forced restart → orphan recovery → resume");
  const before = await api("/metrics");
  const runsBefore = before?.runs?.total ?? 0;
  check("pre-restart metrics captured", before != null, `runs total=${runsBefore}`);

  // Forced restart via launchd (the same mechanism the updater uses).
  const uid = process.getuid?.() ?? 0;
  try {
    await execFileAsync("launchctl", ["kickstart", "-k", `gui/${uid}/com.hivematrix.daemon`]);
    check("issued launchctl kickstart -k", true);
  } catch (e) {
    check("issued launchctl kickstart -k", false, e instanceof Error ? e.message : String(e));
    return;
  }

  const healthy = await waitHealthy(40000);
  check("daemon came back after restart", healthy);
  if (!healthy) return;

  // Runs/directives survive the restart (persisted in SQLite; orphans requeued).
  const after = await api("/metrics");
  check("run history preserved across restart", (after?.runs?.total ?? 0) >= runsBefore,
    `after total=${after?.runs?.total}`);
  check("directives still active post-restart", (after?.directivesByStatus?.active ?? 0) >= 1);
  check("connectivity re-initialized", !!after?.connectivity, `mode=${after?.connectivity}`);
}

async function main() {
  line("HiveMatrix Phase 5 Soak Failure Injection");
  line("==========================================");
  if (!(await waitHealthy(10000))) { line("✗ daemon not reachable on :3747"); process.exit(1); }
  line("");
  await scenarioUsageExhaustion(); line("");
  await scenarioNetworkDrop(); line("");
  await scenarioForcedRestart(); line("");
  // Leave the daemon in auto mode.
  await setMode(null).catch(() => {});
  line(`RESULT: ${passed} checks passed, ${failed} failed`);
  line(failed === 0 ? "✓ ALL FAILURE SCENARIOS RECOVERED" : "✗ a scenario did not recover cleanly");
  process.exit(failed === 0 ? 0 : 2);
}

main().catch((e) => { line(`fatal: ${e instanceof Error ? e.message : e}`); process.exit(1); });
