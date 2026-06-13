/**
 * HiveMatrix Daemon entry point.
 *
 * Run with: node --import tsx/esm src/daemon/index.ts
 *
 * launchd supervises this process. On crash it restarts. On update,
 * the updater stops it, swaps the binary, runs migrations, restarts, probes.
 */

import { getDb } from "@/lib/db";
import { startDaemonServer } from "./server";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";

// Prepend an ISO-8601 timestamp to every daemon log line. launchd routes
// stdout/stderr to log files; timestamps make a 72h soak log readable.
for (const level of ["log", "warn", "error"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => orig(`[${new Date().toISOString()}]`, ...args);
}

const PORT = parseInt(process.env.HIVEMATRIX_PORT ?? "3747", 10);

async function main(): Promise<void> {
  console.log("[hivematrix] Starting daemon...");

  // Decide fresh / update / same BEFORE getDb() creates or migrates the DB.
  const { getBundledVersion } = await import("@/lib/version/bundle-version");
  const { planBoot, recordInstalledVersion } = await import("@/lib/onboarding/install-state");
  const { backupDatabase, pruneBackups, restoreDatabase } = await import("@/lib/updater/updater");
  const bundledVersion = getBundledVersion();
  const boot = planBoot(bundledVersion);
  console.log(`[hivematrix] boot: ${boot.mode} (${boot.from ?? "—"} -> ${boot.to})`);

  // On an update, back up the DB so a failed migration can be rolled back.
  let preUpdateBackup: string | null = null;
  if (boot.mode === "update") {
    preUpdateBackup = backupDatabase("preupdate");
    pruneBackups();
    console.log(`[hivematrix] pre-update DB backup: ${preUpdateBackup ?? "(no existing db)"}`);
  }

  // Initialize database (runs forward-only migrations if needed). On an update,
  // restore the backup if a migration throws, then re-raise.
  let db;
  try {
    db = getDb();
  } catch (err) {
    if (boot.mode === "update" && preUpdateBackup) {
      console.error("[hivematrix] migration failed — restoring pre-update DB backup");
      restoreDatabase(preUpdateBackup);
    }
    throw err;
  }
  console.log(`[hivematrix] Database ready`);

  // Initialize connectivity policy (singleton)
  const policy = getConnectivityPolicy();
  console.log(`[hivematrix] Connectivity policy: ${policy.mode}`);

  // License check — local + offline-friendly. Never hard-blocks (no phone-home,
  // must run in 100%-local posture); a missing/expired license is surfaced, not
  // enforced, in v1. Status is exposed on /health and /license/status.
  const { getLicenseStatus } = await import("@/lib/license/license");
  const license = getLicenseStatus();
  console.log(`[hivematrix] License: ${license.state} — ${license.reason}`);

  // Telemetry context (opt-in, local-first): tag events with version + mode, and
  // capture crashes as events when the operator has enabled telemetry.
  const { setTelemetryContext, recordTelemetryEvent } = await import("@/lib/telemetry/telemetry");
  setTelemetryContext({ connectivity: policy.mode, version: bundledVersion });
  policy.on("modeChange", ({ current }: { current: string }) => setTelemetryContext({ connectivity: current }));
  recordTelemetryEvent({ category: "daemon", event: "started", payload: { boot: boot.mode } });
  for (const signal of ["uncaughtException", "unhandledRejection"] as const) {
    process.on(signal, (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      recordTelemetryEvent({ category: "crash", event: signal, payload: { message } });
      console.error(`[hivematrix] ${signal}:`, err);
      if (signal === "uncaughtException") process.exit(1);
    });
  }

  // Start HTTP server
  await startDaemonServer(PORT);

  // Recover orphaned tasks from a previous crash
  const { recoverOrphanedTasks } = await import("@/lib/orchestrator/recovery");
  await recoverOrphanedTasks();

  // Start scheduler
  const { startScheduler } = await import("@/lib/orchestrator/scheduler");
  startScheduler();

  // Start the MessageBee poll loop (self-gates: no-ops unless the imessage
  // channel is enabled + chat.db is readable). SMS/iMessage in/out.
  const { startMessageBeePoller } = await import("@/lib/messagebee/poller");
  startMessageBeePoller();

  // Start the MailBee poll loop (self-gates: no-ops unless the email channel is
  // enabled). Watches Apple Mail; trust-classifies inbound into triage tasks.
  const { startMailBeePoller } = await import("@/lib/mailbee/poller");
  startMailBeePoller();

  // Supervise the local model server when Qwen is "on this laptop": launch it,
  // health-probe it, relaunch on crash (self-gates on location === "local").
  const { startLocalServingSupervisor } = await import("@/lib/local-model/serving");
  startLocalServingSupervisor();

  // Notification loop: escalate stuck tasks / approvals to the founder's phone
  // (Telegram/iMessage/email) and read button taps back. Self-gates on config.
  const { startNotifyLoop } = await import("@/lib/notify/notify-loop");
  startNotifyLoop();

  // ManagerBee heartbeat: fold scheduler diagnostics + directive/run state +
  // pending escalations into a control-plane report, cached + broadcast.
  const { startManagerBeeHeartbeat } = await import("@/lib/managerbee/heartbeat");
  startManagerBeeHeartbeat();

  // BrainBee poller: curate playbook files (dedup repeated retrospective rules)
  // on a slow schedule. Self-gates when the brain root is unreachable.
  const { startBrainBeePoller } = await import("@/lib/brainbee/poller");
  startBrainBeePoller();

  // Frontier-review-debt loop: replay code-critical work that ran locally as a
  // frontier review when cloud-ok returns. Also drain immediately on that edge.
  const { startFrontierDebtLoop, drainFrontierDebt } = await import("@/lib/orchestrator/frontier-debt");
  startFrontierDebtLoop();
  policy.on("modeChange", ({ current }: { current: string }) => {
    if (current === "cloud-ok") void drainFrontierDebt().catch(() => 0);
  });

  // Update finalize: the daemon reached "ready", so the migrated DB is queryable.
  // Record the new version (so the next boot is "same"); roll back on a failed
  // post-update self-check rather than advancing into a broken state.
  if (boot.mode === "update") {
    try {
      db.prepare("SELECT COUNT(*) FROM tasks").get();
      recordInstalledVersion(bundledVersion);
      console.log(`[hivematrix] update applied: ${boot.from ?? "—"} -> ${boot.to}`);
    } catch (err) {
      console.error("[hivematrix] post-update self-check failed — restoring DB backup, not advancing version", err);
      if (preUpdateBackup) restoreDatabase(preUpdateBackup);
      db.close();
      process.exit(1);
    }
  } else if (boot.mode === "fresh") {
    // Record so the first real launch after setup isn't mistaken for an update.
    recordInstalledVersion(bundledVersion);
  }

  console.log("[hivematrix] Daemon ready");

  // Graceful shutdown
  const shutdown = () => {
    console.log("[hivematrix] Shutting down...");
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[hivematrix] Fatal startup error:", err);
  process.exit(1);
});
