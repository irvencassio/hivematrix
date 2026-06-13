# Appliance Resilience Drills (W7.4)

The HiveMatrix appliance must survive a crash or a reboot mid-work without a
human. These drills prove it. Run them on the reference appliance before each
release and record the result in the release notes.

## Resumability — how it works (why the drills pass)

The recovery story is **structural**, not best-effort:

1. **launchd supervises the daemon.** The LaunchAgent plist is generated with
   `RunAtLoad` + `KeepAlive` (`src/lib/bees/service-manager.ts:222`), so launchd
   restarts the daemon immediately on crash and at login after a reboot.
2. **Orphaned tasks are recovered on boot.** `recoverOrphanedTasks()`
   (`src/lib/orchestrator/recovery.ts:5`) runs early in daemon start
   (`src/daemon/index.ts`) and re-queues tasks that were mid-flight when the
   process died.
3. **Directive runs resume from the journal.** Every run-phase transition is
   written to `run_journal` (`directive-store.ts`); on restart `getActiveRuns()`
   picks up any run not in a terminal phase and the engine advances it from its
   last recorded step. No run state lives only in memory.
4. **The local model server is re-supervised.** When Qwen runs on-box, the
   serving supervisor (`src/lib/local-model/serving.ts`) relaunches it after a
   crash/reboot — so 100%-local posture comes back without hand-running a server.
5. **License + connectivity are re-evaluated locally** at boot (no phone-home),
   so a rebooted appliance is fully operational offline.

## Drill 1 — kill -9 everything mid-directive → resumes

1. Start a directive with a few interdependent criteria; let it reach `execute`
   with tasks in flight.
2. `pkill -9 -f 'daemon/index'` (and any spawned agent PIDs).
3. **Expected:** launchd restarts the daemon within seconds; `recoverOrphanedTasks`
   re-queues the in-flight tasks; the directive run continues from its last
   `run_journal` step. Confirm via `GET /runs/:runId/journal` that the phase
   sequence has no gap and the run reaches `done`/`failed` normally.
4. **Pass criteria:** no manual intervention; the run completes; no duplicate
   task execution (idempotent re-queue).

## Drill 2 — 3am reboot → running again by 3:05

1. With a scheduled directive armed (e.g. the LinkedIn daily ritual, W5.3),
   `sudo reboot`.
2. **Expected:** on login, launchd starts the daemon; `GET /health` returns
   `status: ok` within ~5 minutes; the local model server is back up (local
   posture); scheduled directives fire at their next due time.
3. **Pass criteria:** `GET /health` ok and `GET /metrics` shows the scheduler
   `running` by 3:05, with no human action.

## Drill 3 — offline cold start

1. Disconnect networking, then reboot.
2. **Expected:** daemon boots; connectivity policy resolves to `offline`/`local-only`;
   `GET /posture` shows local Qwen + DesktopBee + TermBee `works`, frontier work
   `queued`; license verifies locally (no phone-home).
3. **Pass criteria:** the box is usable offline immediately after reboot.

## Recording results

For each release, log: date, build version, drill 1/2/3 pass/fail, daemon
restart latency, and any orphaned-task or journal-gap anomalies. Attach the
`GET /diagnostics/bundle` output (W7.2) as the artifact.
