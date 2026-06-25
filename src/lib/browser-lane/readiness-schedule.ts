/**
 * Browser Lane readiness maintenance — a scheduled sweep that keeps per-site
 * auth/readiness fresh so COO dispatch has trustworthy state to gate on.
 *
 * Mirrors the morning-briefing loop: a cheap once-a-minute tick that self-gates
 * on config and fires once per day at the configured hour. The sweep reuses
 * runBrowserLaneReadiness — which already records honest statuses (no-site,
 * no-backend, human-required, CAPTCHA/2FA, failure) — and never logs secrets.
 *
 * Config (`~/.hivematrix/config.json`):
 *   browserLaneReadiness: { enabled, hour: 0-23, staleAfterHours, lastRunAt? }
 */

import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import type { BrowserLaneProbeServiceResult } from "./probe-service";
import type { BrowserReadinessColor } from "./contracts";

export interface BrowserLaneReadinessConfig {
  enabled: boolean;
  hour: number; // 0-23, local
  staleAfterHours: number;
  lastRunAt?: string;
}

const DEFAULT_CONFIG: BrowserLaneReadinessConfig = { enabled: false, hour: 7, staleAfterHours: 24 };

/** Pure: normalize the stored config (clamps hour 0-23, staleAfterHours ≥ 1). */
export function parseBrowserLaneReadinessConfig(input: unknown): BrowserLaneReadinessConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_CONFIG };
  const obj = input as Record<string, unknown>;
  const rawHour = typeof obj.hour === "number" ? Math.floor(obj.hour) : DEFAULT_CONFIG.hour;
  const rawStale = typeof obj.staleAfterHours === "number" ? Math.floor(obj.staleAfterHours) : DEFAULT_CONFIG.staleAfterHours;
  return {
    enabled: obj.enabled === true,
    hour: Math.min(23, Math.max(0, rawHour)),
    staleAfterHours: Math.max(1, rawStale),
    lastRunAt: typeof obj.lastRunAt === "string" ? obj.lastRunAt : undefined,
  };
}

export function getBrowserLaneReadinessConfig(): BrowserLaneReadinessConfig {
  return parseBrowserLaneReadinessConfig(loadHiveConfig().browserLaneReadiness);
}

export function setBrowserLaneReadinessConfig(patch: Partial<BrowserLaneReadinessConfig>): BrowserLaneReadinessConfig {
  const config = loadHiveConfig();
  const next = parseBrowserLaneReadinessConfig({ ...getBrowserLaneReadinessConfig(), ...patch });
  config.browserLaneReadiness = next;
  saveHiveConfig(config);
  return next;
}

/** Pure: is the daily sweep due now? Once today's target hour has passed and we
 * haven't already run since that target. Mirrors briefingDue. */
export function readinessSweepDue(config: BrowserLaneReadinessConfig, now: Date = new Date()): boolean {
  if (!config.enabled) return false;
  const target = new Date(now);
  target.setHours(config.hour, 0, 0, 0);
  if (now < target) return false;
  if (!config.lastRunAt) return true;
  return new Date(config.lastRunAt) < target;
}

export interface ReadinessSweepSummary {
  ok: boolean;
  runCount: number;
  byColor: Record<BrowserReadinessColor, number>;
  attention: number;
  ranAt: string;
  error?: string;
}

export interface ReadinessSweepDeps {
  now?: () => Date;
  runReadiness?: (input: { siteId: string }) => Promise<BrowserLaneProbeServiceResult>;
  setConfig?: (patch: Partial<BrowserLaneReadinessConfig>) => BrowserLaneReadinessConfig;
}

/**
 * Run a readiness sweep over all sites (or one) right now, stamp lastRunAt, and
 * return a secret-free summary. The underlying probe service records honest
 * statuses; this only rolls them up into counts.
 */
export async function runReadinessSweepNow(deps: ReadinessSweepDeps & { siteId?: string } = {}): Promise<ReadinessSweepSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const runReadiness = deps.runReadiness ?? (async (input) => (await import("./probe-service")).runBrowserLaneReadiness(input));
  const setConfig = deps.setConfig ?? setBrowserLaneReadinessConfig;

  const result = await runReadiness({ siteId: deps.siteId?.trim() || "all" });
  const byColor: Record<BrowserReadinessColor, number> = { green: 0, yellow: 0, orange: 0, red: 0, gray: 0 };
  for (const run of result.runs) byColor[run.color] = (byColor[run.color] ?? 0) + 1;
  const attention = byColor.orange + byColor.red + byColor.gray;

  // Stamp the run even when it found no sites — "we tried" is the honest record.
  setConfig({ lastRunAt: now.toISOString() });

  return {
    ok: result.ok,
    runCount: result.runs.length,
    byColor,
    attention,
    ranAt: now.toISOString(),
    ...(result.error ? { error: result.error } : {}),
  };
}

const CHECK_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(deps: ReadinessSweepDeps): Promise<void> {
  const config = getBrowserLaneReadinessConfig();
  if (!config.enabled) return;
  const now = (deps.now ?? (() => new Date()))();
  if (!readinessSweepDue(config, now)) return;
  if (getConnectivityPolicy().mode === "offline") return; // a browser sweep needs a backend

  // Mark BEFORE the run so a slow/failed sweep can't double-fire next tick.
  setBrowserLaneReadinessConfig({ lastRunAt: now.toISOString() });
  try {
    const summary = await runReadinessSweepNow({ ...deps, setConfig: (p) => setBrowserLaneReadinessConfig(p) });
    console.log(`[browser-lane] readiness sweep done (runs=${summary.runCount}, attention=${summary.attention}, ok=${summary.ok})`);
  } catch (e) {
    console.error(`[browser-lane] readiness sweep failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Start the readiness sweep loop (idempotent). Self-gates on config. */
export function startBrowserLaneReadinessLoop(deps: ReadinessSweepDeps = {}, intervalMs = CHECK_INTERVAL_MS): () => void {
  if (timer) return stopBrowserLaneReadinessLoop;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void tick(deps).finally(() => { running = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopBrowserLaneReadinessLoop;
}

export function stopBrowserLaneReadinessLoop(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
