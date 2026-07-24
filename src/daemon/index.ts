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

  // One-time config.json migration (Claude-native cutover): drops dead
  // qwen/localEngine/localModel keys and resets any role-model override that
  // names a stale local id. Runs before anything else reads config.json.
  const { migrateConfig } = await import("@/lib/config/migrate");
  migrateConfig();

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

  // Self-heal silently-emptied user data. A migration (or a stray process
  // pointed at the real DB) can wipe a table without throwing, so the
  // throw-based rollback above never fires — this restores empty high-value
  // tables (goals, Message Lane allowlist) from the newest backup that has rows.
  // Additive-only and conservative; see db/self-heal.ts. Never fatal.
  try {
    const { healEmptiedTables } = await import("@/lib/db/self-heal");
    const { backupsDir } = await import("@/lib/updater/updater");
    const healed = healEmptiedTables({ db, backupsDir: backupsDir() });
    for (const h of healed) {
      console.warn(`[self-heal] restored ${h.restored} row(s) into ${h.table} from ${h.from}`);
      // When message_identities are restored, reset the high-water mark to prevent
      // replaying old iMessages from freshly-restored senders (backlog-replay guard).
      if (h.table === "message_identities") {
        try {
          const { resetLastRowid } = await import("@/lib/messagebee/store");
          resetLastRowid();
          console.warn("[self-heal] Message Lane identities restored; reset high-water mark to prevent backlog replay");
        } catch (err) {
          console.error("[self-heal] failed to reset Message Lane high-water mark:", err instanceof Error ? err.message : err);
        }
      }
    }
  } catch (e) {
    console.error("[self-heal] failed:", e instanceof Error ? e.message : e);
  }

  // Last-resort fallback: healEmptiedTables() above may still leave `goals`
  // empty (fresh machine's first run, or every backup also hollowed out).
  // If so, seed it from the operator's persona/GOALS.md — additive-only,
  // one-shot (only ever acts on a genuinely empty table, same contract as
  // the self-heal block above), never fatal. See lib/goals/persona-seed.ts.
  try {
    const { seedGoalsFromPersonaIfEmpty } = await import("@/lib/goals/persona-seed");
    const { seeded } = seedGoalsFromPersonaIfEmpty();
    if (seeded > 0) {
      console.warn(`[goals:persona-seed] seeded ${seeded} goal(s) from persona/GOALS.md (goals table was empty)`);
    }
  } catch (e) {
    console.error("[goals:persona-seed] failed:", e instanceof Error ? e.message : e);
  }

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

  // Telemetry ping — fires once after a 5-minute settle, then every 24 hours.
  // Silently no-ops when telemetry is disabled (default). Uses only aggregate
  // counters; no raw event payloads leave the machine.
  const { flushTelemetryPing } = await import("@/lib/telemetry/telemetry");
  setTimeout(() => { void flushTelemetryPing(); }, 5 * 60 * 1000);
  setInterval(() => { void flushTelemetryPing(); }, 24 * 60 * 60 * 1000);

  // Recover orphaned tasks from a previous crash
  const { recoverOrphanedTasks } = await import("@/lib/orchestrator/recovery");
  await recoverOrphanedTasks();

  // Start scheduler
  const { startScheduler } = await import("@/lib/orchestrator/scheduler");
  startScheduler();

  // Self-heal: revive any recurring directive that was wrongly retired (criteria
  // proven once → status:done/nextRunAt:null) before the recurring-vs-one-shot
  // fix landed. Runs every boot so the accountability rituals can't stay dead.
  try {
    const { rearmStaleRecurringDirectives } = await import("@/lib/orchestrator/directive-engine");
    const revived = rearmStaleRecurringDirectives();
    if (revived.length) console.log(`[directives] revived ${revived.length} stale recurring directive(s): ${revived.join(", ")}`);
  } catch (e) { console.error("[directives] rearm-on-boot failed:", e instanceof Error ? e.message : e); }

  // Install the standing self-improvement/maintenance directive when the
  // `selfImprovement` feature is ON — without it the feedback→planning loop
  // never fires on its own. Idempotent (restarts happen routinely via
  // auto-update, so it must not create a duplicate each boot). When the feature
  // is OFF (default), block any directive a prior feature-on boot installed, so
  // the autonomous loop can never resurrect itself across an update.
  try {
    const { isFeatureEnabled } = await import("@/lib/config/features");
    if (isFeatureEnabled("selfImprovement")) {
      const { installSelfImprovementDirectiveIfMissing } = await import("@/lib/feedback/self-improvement");
      const { installed, directiveId } = installSelfImprovementDirectiveIfMissing();
      console.log(
        installed
          ? `[directives] installed self-improvement directive (${directiveId})`
          : `[directives] self-improvement directive already active (${directiveId})`
      );
    } else {
      const { disableActiveSelfImprovementDirectives } = await import("@/lib/feedback/self-improvement");
      const blocked = disableActiveSelfImprovementDirectives();
      console.log(`[directives] self-improvement feature off — blocked ${blocked} active directive(s)`);
    }
  } catch (e) { console.error("[directives] self-improvement boot gate failed:", e instanceof Error ? e.message : e); }

  // Self-heal: if the structured goals store is empty (e.g. after the
  // 2026-07-14 test-DB-isolation incident wiped it — see
  // docs/superpowers/specs/2026-07-15-goals-data-loss-design.md), seed it
  // from persona/GOALS.md so the Goals panel and the accountability loop
  // (daily_review/goal_checkin/weaver-daily-audit) never see a silent
  // "no goals yet" dead end. No-ops once any goal exists.
  try {
    const { importGoalsFromPersonaIfEmpty } = await import("@/lib/goals/import-from-persona");
    const result = importGoalsFromPersonaIfEmpty();
    if (result) console.log(`[goals] imported ${result.imported} goal(s) from GOALS.md (${result.skipped} already present)`);
  } catch (e) { console.error("[goals] persona import-on-boot failed:", e instanceof Error ? e.message : e); }

  // Flash dispatch: shared callback for both inbound channel pollers. Wraps
  // runFlashTurnText so messagebee/mailbee (lib/) never import from flash/ directly.
  // imagePaths (currently only messagebee sends these, for iMessage photo
  // attachments) are normalized here — copied into the daemon-owned vision
  // temp dir + HEIC→JPEG converted — via flash/images.ts before being handed
  // to the flash loop, which allows Read for just this turn's spawn.
  const { runFlashTurnText } = await import("@/lib/flash");
  const makeFlashDispatch =
    (channel: "imessage" | "mail") =>
    async (text: string, peer: string, imagePaths?: string[]) => {
      let normalizedImagePaths: string[] | undefined;
      if (imagePaths?.length) {
        const { normalizeImagePaths } = await import("@/lib/flash/images");
        normalizedImagePaths = await normalizeImagePaths(imagePaths);
      }
      const r = await runFlashTurnText({ text, channel, peer, imagePaths: normalizedImagePaths });
      return r.reply;
    };

  // Start the Message Lane poll loop (self-gates: no-ops unless the imessage
  // channel is enabled + chat.db is readable). Allowlisted senders go to Flash Lane.
  const { startMessageBeePoller } = await import("@/lib/messagebee/poller");
  startMessageBeePoller(undefined, makeFlashDispatch("imessage"));

  // Start the Mail Lane poll loop (self-gates: no-ops unless the email channel is
  // enabled). Known senders go to Flash Lane; unknown + triage-all → triage task.
  const { startMailBeePoller } = await import("@/lib/mailbee/poller");
  startMailBeePoller(undefined, makeFlashDispatch("mail"));

  // Start the Voice-email outbox watcher — polls ~/.hivematrix/voice-email-outbox/
  // for JSON files from voice_email.py or turn_server.py /email, and sends each
  // one via Apple Mail. Self-gates: no-ops when the outbox directory is absent.
  const { startVoiceEmailOutboxPoller } = await import("@/lib/voice/voice-email-outbox");
  startVoiceEmailOutboxPoller();

  // Notification loop: escalate stuck tasks / approvals to the founder's phone
  // (Telegram/iMessage/email) and read button taps back. Self-gates on config.
  const { startNotifyLoop } = await import("@/lib/notify/notify-loop");
  startNotifyLoop();

  // Browser Lane readiness sweep: a daily, config-gated pass that refreshes
  // per-site auth/readiness so COO dispatch has fresh state to gate on.
  const { startBrowserLaneReadinessLoop } = await import("@/lib/browser-lane/readiness-schedule");
  startBrowserLaneReadinessLoop();

  // Work Packages / Flight Loops removed 2026-07-06 — broad prompts self-plan via
  // Superpowers (workflow:"work"), so there's no decomposition loop to run.

  // Flash Lane learning loop: every 15 minutes, distill sessions that have gone
  // cold (6h inactivity) — extract reusable skills and file feedback to backlog.
  const { startFlashLearningLoop } = await import("@/lib/flash/learning-loop");
  startFlashLearningLoop();

  // Heartbeat (W8 presence layer): every N minutes one unprompted flash pass over
  // persona/HEARTBEAT.md + a live status snapshot; the agent acts within the
  // autonomy dial and messages the operator only when something is worth saying.
  // Daily moments (morning brief / evening recap) ride the same loop. Self-gates
  // on config (heartbeat.enabled). Delivery deps injected here so flash/ keeps
  // its import surface (same inversion as makeFlashDispatch above).
  const { startHeartbeatLoop } = await import("@/lib/flash/heartbeat");
  startHeartbeatLoop({
    notify: async (t) => (await import("@/lib/notify/notify")).notify(t),
    composeStatus: async () => (await import("@/lib/voice/command-turn")).composeBriefing(),
    sendPush: async (o) => (await import("@/lib/notify/push")).sendPush(o),
  });

  // Voice result return path: when a voice-escalated task finishes, speak the
  // result (Kokoro) and push a voice:result SSE event so the open Talk screen
  // gets the answer it was told was "being looked into".
  const { startVoiceResultLoop } = await import("@/lib/voice/voice-result-loop");
  startVoiceResultLoop();

  // Review Lane heartbeat: fold scheduler diagnostics + directive/run state +
  // pending escalations into a control-plane report, cached + broadcast.
  const { startReviewLaneHeartbeat } = await import("@/lib/managerbee/heartbeat");
  startReviewLaneHeartbeat();

  // Memory Lane poller: curate playbook files (dedup repeated retrospective rules)
  // on a slow schedule. Self-gates when the brain root is unreachable.
  const { startBrainBeePoller } = await import("@/lib/brainbee/poller");
  startBrainBeePoller();

  // YouTube watcher: poll a configured playlist (Data API), summarize new videos
  // (transcript-based) into HTML brain docs + notify. Self-gates on config
  // (youtube.enabled + apiKey + playlistId).
  const { startYouTubeWatcherPoller } = await import("@/lib/youtube/poller");
  startYouTubeWatcherPoller();

  // Embeddings indexer: keep the brain corpus vector index fresh for semantic
  // retrieval. Self-gates on config (embeddings.enabled + endpoint + model).
  const { startEmbeddingsIndexer } = await import("@/lib/embeddings/indexer");
  startEmbeddingsIndexer();

  // Market Insight Lane: watch market data + fire threshold alerts (analysis/alerts ONLY —
  // never trades). Self-gates on Alpaca data-API env keys + a non-empty watchlist.
  const { startTraderBeePoller } = await import("@/lib/traderbee/poller");
  startTraderBeePoller();

  // Update self-heal: if the .app bundle on disk is newer than this running
  // daemon's own code, the shell swapped the bundle underneath us (an updater
  // without the post-install daemon handoff). Kickstart via launchd so we
  // relaunch into the new bundle. No-op for a dev/source run. This makes updates
  // "take" even when the installing shell predates the handoff.
  const { startSelfHealLoop } = await import("@/lib/updater/self-heal");
  startSelfHealLoop();

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

  // Graceful shutdown.
  //
  // This used to be `db.close(); process.exit(0)` — which killed the daemon
  // while agent workers were mid-run. Because workers share the daemon's
  // process group, the same signal already reached them, and their deaths were
  // recorded as agent failures ("Exited with code: 143") with the session
  // discarded. Now: checkpoint in-flight tasks durably FIRST, then drain
  // workers with SIGTERM before exiting, so the work resumes on next boot.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return; // a second signal must not re-enter mid-drain
    shuttingDown = true;
    console.log(`[hivematrix] Shutting down (${signal})...`);
    void (async () => {
      try {
        const { agentManager } = await import("@/lib/orchestrator/agent-manager");
        const { checkpointed, drained } = await agentManager.shutdownAllAgents("daemon_shutdown", 5000);
        console.log(`[hivematrix] shutdown: ${checkpointed} task(s) checkpointed, ${drained} worker(s) drained`);
      } catch (e) {
        console.error("[hivematrix] shutdown drain failed:", e instanceof Error ? e.message : e);
      } finally {
        try { db.close(); } catch { /* already closed */ }
        process.exit(0);
      }
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[hivematrix] Fatal startup error:", err);
  process.exit(1);
});
