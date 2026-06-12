/**
 * First-run wizard actions — the idempotent installers behind the POST
 * /onboarding/* endpoints. Each turns one read-only onboarding step (see
 * getOnboardingStatus) from "incomplete" to "done", and is safe to re-run.
 *
 * Side effects (launchctl, fs, network) live behind small injectable seams so
 * the formatting/decision logic stays unit-testable without a real bundle.
 */

import { existsSync, mkdirSync, writeFileSync, symlinkSync, readlinkSync, lstatSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { loadHiveConfig, saveHiveConfig, type HiveConfig } from "@/lib/central/config";
import { getOrCreateToken } from "@/lib/auth/token";
import { getBundledDaemonPaths, getBundleInstallReadiness } from "./app-bundle";

export interface ActionResult {
  ok: boolean;
  detail: string;
  /** Extra structured data for the wizard (deep-links, resolved paths, …). */
  data?: Record<string, unknown>;
}

const DAEMON_LABEL = "com.hivematrix.daemon";
const HELPER_LABEL = "com.hivematrix.desktopbee.helper";

function launchAgentsDir(): string { return join(homedir(), "Library", "LaunchAgents"); }
function logDir(): string { return join(homedir(), "Library", "Logs", "HiveMatrix"); }

/** TCC panes the DesktopBee helper needs; the wizard opens these. */
export const TCC_DEEP_LINKS = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  // Full Disk Access — required for the daemon to read ~/Library/Messages/chat.db (MessageBee).
  fullDiskAccess: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
} as const;

// ── Pure builders (unit-tested) ───────────────────────────────────────────────

function plistString(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** launchd plist for the BUNDLED daemon: `<node> <daemon.cjs>`, no tsx/repo. */
export function buildDaemonPlist(opts: { nodeBin: string; daemonCjs: string; logDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${plistString(opts.nodeBin)}</string>
    <string>${plistString(opts.daemonCjs)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HIVEMATRIX_PORT</key><string>3747</string>
    <key>HIVEMATRIX_NODE_BIN</key><string>${plistString(opts.nodeBin)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${plistString(join(opts.logDir, "daemon.out.log"))}</string>
  <key>StandardErrorPath</key><string>${plistString(join(opts.logDir, "daemon.err.log"))}</string>
</dict>
</plist>
`;
}

/** launchd plist for the DesktopBee Swift helper (the TCC-holding process). */
export function buildHelperPlist(opts: { helperApp: string; logDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${HELPER_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${plistString(join(opts.helperApp, "Contents", "MacOS", "DesktopBeeHelper"))}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>DESKTOPBEE_PORT</key><string>3748</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${plistString(join(opts.logDir, "desktopbee-helper.out.log"))}</string>
  <key>StandardErrorPath</key><string>${plistString(join(opts.logDir, "desktopbee-helper.err.log"))}</string>
</dict>
</plist>
`;
}

/** Deep-merge a patch into a config object (plain objects recurse; else replace). */
export function mergeConfig(base: HiveConfig, patch: Record<string, unknown>): HiveConfig {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      out[k] = mergeConfig(cur as HiveConfig, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Side-effectful installers ─────────────────────────────────────────────────

export type Exec = (cmd: string, args: string[]) => void;
const defaultExec: Exec = (cmd, args) => { execFileSync(cmd, args, { stdio: "ignore" }); };

/** bootout (ignore failure) → bootstrap → kickstart. Mirrors service-manager. */
function bootstrapLaunchAgent(label: string, plistPath: string, exec: Exec): void {
  const uid = process.getuid?.() ?? 0;
  const domain = `gui/${uid}`;
  try { exec("launchctl", ["bootout", `${domain}/${label}`]); } catch { /* not loaded yet */ }
  exec("launchctl", ["bootstrap", domain, plistPath]);
  try { exec("launchctl", ["kickstart", "-k", `${domain}/${label}`]); } catch { /* RunAtLoad covers it */ }
}

/** Write config.json (+ ensure the daemon token). Merges `patch` if given. */
export function writeConfigStep(patch: Record<string, unknown> = {}): ActionResult {
  const merged = mergeConfig(loadHiveConfig(), patch);
  saveHiveConfig(merged);
  getOrCreateToken("auth-token");
  return { ok: true, detail: "config.json written" };
}

/**
 * Set the canonical brain root — the SINGLE source of truth at
 * config.memory.brainRootDir (what resolveMemorySettings/all harnesses read).
 * Optionally create it and point a convenience `~/brain` symlink at it.
 */
export function setBrainRoot(opts: {
  brainRootDir: string;
  createIfMissing?: boolean;
  makeShortcut?: boolean;
}): ActionResult {
  const dir = opts.brainRootDir.trim();
  if (!dir) return { ok: false, detail: "brainRootDir is required" };

  saveHiveConfig(mergeConfig(loadHiveConfig(), { memory: { enabled: true, brainRootDir: dir } }));

  const warnings: string[] = [];
  const expanded = dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir;
  if (opts.createIfMissing && !existsSync(expanded)) {
    try { mkdirSync(expanded, { recursive: true }); } catch (e) { warnings.push(`could not create ${expanded}: ${String(e)}`); }
  }
  if (opts.makeShortcut) {
    const shortcut = join(homedir(), "brain");
    try {
      const isLink = (() => { try { return lstatSync(shortcut).isSymbolicLink(); } catch { return false; } })();
      if (isLink && readlinkSync(shortcut) === expanded) {
        // already points where we want — idempotent no-op
      } else if (!existsSync(shortcut)) {
        symlinkSync(expanded, shortcut);
      } else {
        warnings.push(`~/brain already exists and is not a shortcut to ${expanded} — left untouched`);
      }
    } catch (e) { warnings.push(`could not create ~/brain shortcut: ${String(e)}`); }
  }
  return {
    ok: existsSync(expanded),
    detail: existsSync(expanded) ? `brain root set: ${dir}` : `brain root set but ${expanded} does not exist`,
    data: warnings.length ? { warnings } : undefined,
  };
}

/**
 * Install + load the launchd agent for the bundled daemon, handing 24/7
 * supervision to launchd. Refuses unless the app runs from /Applications
 * (translocation guard) so the baked paths are stable.
 */
export function installDaemonLaunchAgent(
  opts: { execPath?: string; exec?: Exec } = {},
): ActionResult {
  const execPath = opts.execPath ?? process.execPath;
  const readiness = getBundleInstallReadiness(execPath);
  if (!readiness.ok) {
    return { ok: false, detail: readiness.reason ?? "cannot install from this location", data: { state: readiness.state } };
  }
  const paths = getBundledDaemonPaths(execPath)!;
  mkdirSync(launchAgentsDir(), { recursive: true });
  mkdirSync(logDir(), { recursive: true });
  const plistPath = join(launchAgentsDir(), `${DAEMON_LABEL}.plist`);
  writeFileSync(plistPath, buildDaemonPlist({ nodeBin: paths.nodeBin, daemonCjs: paths.daemonCjs, logDir: logDir() }));
  bootstrapLaunchAgent(DAEMON_LABEL, plistPath, opts.exec ?? defaultExec);
  return { ok: true, detail: "daemon launchd agent installed", data: { plistPath, appRoot: readiness.appRoot } };
}

/**
 * Install + load the DesktopBee helper launchd agent (the bundled
 * DesktopBeeHelper.app under the app's Resources) and return TCC deep-links the
 * wizard opens so the user can grant Accessibility + Screen Recording.
 */
export function installDesktopBeeHelper(
  opts: { execPath?: string; exec?: Exec } = {},
): ActionResult {
  const execPath = opts.execPath ?? process.execPath;
  const readiness = getBundleInstallReadiness(execPath);
  if (!readiness.appRoot) {
    return { ok: false, detail: readiness.reason ?? "DesktopBee helper unavailable (not a packaged bundle)", data: { state: readiness.state } };
  }
  const helperApp = join(readiness.appRoot, "Contents", "Resources", "DesktopBeeHelper.app");
  if (!existsSync(helperApp)) {
    return { ok: false, detail: `bundled helper not found at ${helperApp}` };
  }
  mkdirSync(launchAgentsDir(), { recursive: true });
  mkdirSync(logDir(), { recursive: true });
  const plistPath = join(launchAgentsDir(), `${HELPER_LABEL}.plist`);
  writeFileSync(plistPath, buildHelperPlist({ helperApp, logDir: logDir() }));
  bootstrapLaunchAgent(HELPER_LABEL, plistPath, opts.exec ?? defaultExec);
  return {
    ok: true,
    detail: "DesktopBee helper installed; grant Accessibility + Screen Recording",
    data: { plistPath, helperApp, deepLinks: TCC_DEEP_LINKS },
  };
}

/**
 * Configure the local model. Three modes:
 *   - "endpoint": validate a reachable OpenAI-compatible endpoint and write it.
 *   - "cloud-only": no local model; set the macro mode so the step is satisfied.
 *   - "download": guided pull is initiated elsewhere (see model-download.ts);
 *     here we just record the chosen provider/model intent.
 */
export async function configureLocalModel(opts: {
  mode: "endpoint" | "cloud-only" | "download";
  endpoint?: string;
  modelId?: string;
  provider?: string;
  fetchImpl?: typeof fetch;
}): Promise<ActionResult> {
  if (opts.mode === "cloud-only") {
    writeConfigStep({ runMode: "cloud-only" });
    return { ok: true, detail: "cloud-only: local model skipped" };
  }
  if (opts.mode === "endpoint") {
    const endpoint = (opts.endpoint ?? "").trim();
    const modelId = (opts.modelId ?? "").trim();
    if (!endpoint || !modelId) return { ok: false, detail: "endpoint and modelId are required" };
    const reachable = await probeOpenAiEndpoint(endpoint, opts.fetchImpl ?? fetch);
    if (!reachable.ok) return { ok: false, detail: `endpoint not reachable: ${reachable.detail}` };
    writeConfigStep({
      qwen: { primary: { modelId, endpoint } },
      localModel: { provider: opts.provider ?? "lmstudio", endpoint, modelName: modelId },
    });
    return { ok: true, detail: `local model configured: ${modelId} @ ${endpoint}` };
  }
  // download
  writeConfigStep({ qwen: { primary: { modelId: opts.modelId ?? "", endpoint: opts.endpoint ?? "" } } });
  return { ok: true, detail: "download initiated", data: { provider: opts.provider } };
}

/** Quick reachability probe of an OpenAI-compatible /v1/models endpoint. */
export async function probeOpenAiEndpoint(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  const base = endpoint.replace(/\/+$/, "");
  const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
    return res.ok ? { ok: true, detail: `HTTP ${res.status}` } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Configure frontier access: store an API key and/or report detected CLIs. */
export async function configureFrontier(opts: {
  anthropicApiKey?: string;
  openaiApiKey?: string;
}): Promise<ActionResult> {
  const { findBinary, CLAUDE_BINARY_SEARCH_PATHS, CODEX_BINARY_SEARCH_PATHS } =
    await import("@/lib/config/binary-detection");
  const patch: Record<string, unknown> = {};
  if (opts.anthropicApiKey?.trim()) patch.providers = { anthropic: { apiKey: opts.anthropicApiKey.trim() } };
  if (opts.openaiApiKey?.trim()) {
    patch.providers = mergeConfig((patch.providers as HiveConfig) ?? {}, { openai: { apiKey: opts.openaiApiKey.trim() } });
  }
  if (Object.keys(patch).length) writeConfigStep(patch);
  const claudePath = findBinary("claude", CLAUDE_BINARY_SEARCH_PATHS);
  const codexPath = findBinary("codex", CODEX_BINARY_SEARCH_PATHS);
  const have = !!(opts.anthropicApiKey || opts.openaiApiKey || claudePath || codexPath);
  return {
    ok: have,
    detail: have ? "frontier access configured" : "no frontier key or CLI found",
    data: { claudeCli: claudePath, codexCli: codexPath },
  };
}
