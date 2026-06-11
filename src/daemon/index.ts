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

const PORT = parseInt(process.env.HIVEMATRIX_PORT ?? "3747", 10);

async function main(): Promise<void> {
  console.log("[hivematrix] Starting daemon...");

  // Initialize database (runs migrations if needed)
  const db = getDb();
  console.log(`[hivematrix] Database ready`);

  // Initialize connectivity policy (singleton)
  const policy = getConnectivityPolicy();
  console.log(`[hivematrix] Connectivity policy: ${policy.mode}`);

  // Start HTTP server
  await startDaemonServer(PORT);

  // Recover orphaned tasks from a previous crash
  const { recoverOrphanedTasks } = await import("@/lib/orchestrator/recovery");
  await recoverOrphanedTasks();

  // Start scheduler
  const { startScheduler } = await import("@/lib/orchestrator/scheduler");
  startScheduler();

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
