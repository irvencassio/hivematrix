/**
 * Shared poll-loop scaffolding.
 *
 * Every lane poller and interval-driven background loop reimplemented the exact
 * same lifecycle: a setInterval, a non-overlap `running` guard, unref-ing the timer
 * so it never keeps the process alive, and a `.catch` so a rejected tick logs
 * instead of surfacing as an unhandledRejection every interval. That was ~12 copies
 * of identical code. This owns the lifecycle once; each caller supplies only its
 * source-specific `tick` (which self-gates on whether its channel is enabled).
 *
 * The `.catch` lives here now — the single guarantee that pinned invariant depends
 * on (see poll-loop-guards.test.ts).
 */

export interface PollLoopOptions {
  /** Short label for log lines, e.g. "messagebee". */
  name: string;
  /** Interval between ticks, in ms. */
  intervalMs: number;
  /** The work to run each tick. May be async; overlapping ticks are skipped. */
  tick: () => Promise<void> | void;
}

/**
 * Start an interval loop. Returns an idempotent stop function. Overlapping ticks
 * are skipped (a slow tick never stacks), the timer is unref-ed, and a rejected
 * tick is logged rather than floated.
 */
export function startPollLoop(opts: PollLoopOptions): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  timer = setInterval(() => {
    if (running) return; // never overlap two ticks
    running = true;
    void Promise.resolve()
      .then(opts.tick)
      .catch((e) => { console.error(`[${opts.name}] poll failed: ${e instanceof Error ? e.message : e}`); })
      .finally(() => { running = false; });
  }, opts.intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return () => {
    if (timer) { clearInterval(timer); timer = null; }
  };
}
