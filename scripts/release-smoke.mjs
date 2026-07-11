/**
 * Pre-release operator-path smoke check.
 *
 * Run: node --import tsx/esm scripts/release-smoke.mjs
 *
 * Exercises the real operator surfaces against a throwaway temp DB and prints a
 * ✓/✗ checklist (exit 1 on any failure). Also importable as { runSmoke } so the
 * companion .test.mjs runs the same checks inside `npm test`. No network, no app
 * launch, no secrets.
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_VALUE_RE = /"password"|"passphrase"|"privateKey"|"private_key"|"token"|"cookie"|"sshpass"/i;

export async function runSmoke({ quiet = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "hivematrix-release-smoke-"));
  const prevDb = process.env.HIVEMATRIX_DB_PATH;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "smoke.db");

  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });

  try {
    // 1. Daemon DB starts (migrations apply).
    const { getDb } = await import("@/lib/db");
    const version = getDb().pragma("user_version", { simple: true });
    add("daemon db starts + migrations apply", typeof version === "number" && version > 0, `user_version=${version}`);

    // 2. Lane Apps status returns Browser Lane.
    const { getAllLaneAppStates } = await import("@/lib/lane-apps");
    const apps = await getAllLaneAppStates();
    const appIds = apps.map((a) => a.id);
    add("lane-apps status returns Browser Lane",
      appIds.includes("browser-lane"), appIds.join(", "));

    // 3. Unified Lane Setup model returns the lane with full state.
    const { getLaneSetup } = await import("@/lib/lane-setup");
    const setup = await getLaneSetup();
    const laneIds = setup.lanes.map((l) => l.id);
    const shaped = setup.lanes.every((l) => l.installState && l.launchState && l.signingState && l.daemonState && l.nextAction);
    add("lane-setup returns the lane with install/launch/signing/daemon state",
      laneIds.includes("browser-lane") && shaped, laneIds.join(", "));

    // 4. The lane reports a bundled version + honest install state (installed/launchable if bundled).
    const browser = setup.lanes.find((l) => l.id === "browser-lane");
    add("Browser Lane reports bundled version + install state",
      !!browser?.bundledVersion?.short && !!browser?.installState, `${browser?.installState} (bundled ${browser?.bundledVersion?.short})`);

    // 5. Browser Lane site dashboard does not leak secret values.
    const { getBrowserLaneReadinessDashboard } = await import("@/lib/browser-lane/store");
    const bDash = JSON.stringify(getBrowserLaneReadinessDashboard());
    add("Browser Lane site dashboard leaks no secret values", !SECRET_VALUE_RE.test(bDash));

    // 6. Workflow inbox loads.
    const { getWorkflowInbox } = await import("@/lib/workflows/inbox");
    const inbox = getWorkflowInbox();
    add("workflow inbox loads", !!inbox && !!inbox.groups && !!inbox.counts);

    // 7. Daemon declares the Settings → Lanes endpoints.
    const server = readFileSync(new URL("../src/daemon/server.ts", import.meta.url), "utf8");
    const endpoints = ['"/lane-apps"', '"/lane-setup"', '"/browser-lane/dashboard"', '"/workflows/inbox"'];
    const missing = endpoints.filter((e) => !server.includes(e));
    add("daemon declares Settings → Lanes endpoints", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "");
  } catch (err) {
    add("smoke run completed without throwing", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (prevDb === undefined) delete process.env.HIVEMATRIX_DB_PATH;
    else process.env.HIVEMATRIX_DB_PATH = prevDb;
    rmSync(tmp, { recursive: true, force: true });
  }

  const ok = checks.every((c) => c.ok);
  if (!quiet) {
    for (const c of checks) {
      const mark = c.ok ? "✓" : "✗";
      const detail = c.detail ? `  — ${c.detail}` : "";
      console.log(`${mark} ${c.name}${detail}`);
    }
    console.log(ok ? "\nRelease smoke: PASS" : "\nRelease smoke: FAIL");
  }
  return { ok, checks };
}

// Run directly → print + exit code.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runSmoke().then(({ ok }) => process.exit(ok ? 0 : 1));
}
