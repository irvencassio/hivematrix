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
import { buildCliPath } from "@/lib/config/binary-detection";
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

/** TCC panes the Desktop Lane helper needs; the wizard opens these. */
export const TCC_DEEP_LINKS = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  // Full Disk Access — required for the daemon to read ~/Library/Messages/chat.db (Message Lane).
  fullDiskAccess: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  // Automation — required to drive Apple Mail via osascript (Mail Lane).
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  // Microphone — required for voice input (Talk mode / voice sidecar).
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
} as const;

// ── Pure builders (unit-tested) ───────────────────────────────────────────────

function plistString(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** launchd plist for the BUNDLED daemon: `<node> <daemon.cjs>`, no tsx/repo. */
export function buildDaemonPlist(opts: { nodeBin: string; daemonCjs: string; logDir: string }): string {
  const cliPath = buildCliPath();
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
  <key>WorkingDirectory</key><string>${plistString(homedir())}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>HIVEMATRIX_PORT</key><string>3747</string>
    <key>HIVEMATRIX_NODE_BIN</key><string>${plistString(opts.nodeBin)}</string>
    <key>PATH</key><string>${plistString(cliPath)}</string>
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

/** launchd plist for the Desktop Lane Swift helper (the TCC-holding process). */
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

/**
 * Open a macOS System Settings privacy pane natively. The console runs in a
 * Tauri/WKWebView where window.open() is a no-op for the x-apple.* URL scheme,
 * so the daemon (a normal process) shells out to `open` instead. Restricted to
 * the known TCC panes — never opens an arbitrary URL/file.
 */
export function openSystemSettingsPane(
  pane: keyof typeof TCC_DEEP_LINKS,
  exec: Exec = defaultExec,
): ActionResult {
  const url = TCC_DEEP_LINKS[pane];
  if (!url) return { ok: false, detail: `unknown pane: ${pane}` };
  try {
    exec("open", [url]);
    return { ok: true, detail: `opened ${pane} pane` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

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
 * Install + load the Desktop Lane helper launchd agent (the bundled
 * DesktopBeeHelper.app under the app's Resources) and return TCC deep-links the
 * wizard opens so the user can grant Accessibility + Screen Recording.
 */
export function installDesktopBeeHelper(
  opts: { execPath?: string; exec?: Exec } = {},
): ActionResult {
  const execPath = opts.execPath ?? process.execPath;
  const readiness = getBundleInstallReadiness(execPath);
  if (!readiness.appRoot) {
    return { ok: false, detail: readiness.reason ?? "Desktop Lane helper unavailable (not a packaged bundle)", data: { state: readiness.state } };
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
    detail: "Desktop Lane helper installed; grant Accessibility + Screen Recording",
    data: { plistPath, helperApp, deepLinks: TCC_DEEP_LINKS },
  };
}

/**
 * Guided Message Lane setup: enable/disable the iMessage channel, allowlist a
 * sender, and report whether Full Disk Access (chat.db readability) is in
 * place. Idempotent and safe to re-run; returns the live state the wizard
 * renders.
 */
export async function configureMessageBee(opts: {
  enable?: boolean;
  phone?: string;
  displayName?: string;
  selfHandles?: string[];
}): Promise<ActionResult> {
  const store = await import("@/lib/messagebee/store");
  const { normalizeHandle } = await import("@/lib/messagebee/contracts");

  if (Array.isArray(opts.selfHandles)) {
    store.setSelfHandles(opts.selfHandles);
  }

  if (opts.enable === false) {
    store.setChannelEnabled(false);
    return {
      ok: true,
      detail: "Message Lane disabled.",
      data: {
        enabled: false,
        chatDbReadable: false,
        chatDbDetail: "Message Lane disabled",
        identities: store.listIdentities(),
        selfHandles: store.getSelfHandles(),
        deepLinks: { fullDiskAccess: TCC_DEEP_LINKS.fullDiskAccess },
      },
    };
  }

  const { probeChatDbAccess } = await import("@/lib/messagebee/imessage");

  store.setChannelEnabled(true);

  const warnings: string[] = [];
  const raw = (opts.phone ?? "").trim();
  if (raw) {
    if (!normalizeHandle(raw)) warnings.push(`"${raw}" is not a valid phone number or email — not allowlisted`);
    else store.upsertIdentity(raw, "allowed", opts.displayName ?? null);
  }

  const chatDbProbe = probeChatDbAccess();
  const chatDbReadable = chatDbProbe.ok;
  const enabled = store.isChannelEnabled();
  const identities = store.listIdentities();
  const allowlisted = identities.filter((i) => i.status === "allowed" || i.status === "paired").length;
  const ok = enabled && chatDbReadable && allowlisted > 0;

  let detail: string;
  if (!chatDbReadable) detail = `Channel enabled, but Message Lane is not ready: ${chatDbProbe.detail}`;
  else if (allowlisted === 0) detail = "Channel enabled and Messages readable — add an allowlisted sender to start driving it.";
  else detail = "Message Lane ready: channel on, Messages readable, sender allowlisted.";

  return {
    ok,
    detail,
    data: {
      enabled,
      chatDbReadable,
      chatDbDetail: chatDbProbe.detail,
      identities,
      selfHandles: store.getSelfHandles(),
      deepLinks: { fullDiskAccess: TCC_DEEP_LINKS.fullDiskAccess },
      warnings: warnings.length ? warnings : undefined,
    },
  };
}

/**
 * Guided Mail Lane setup: enable the email channel, add a trusted sender, and
 * report whether Apple Mail is controllable (Automation permission). On enable,
 * advances the high-water mark to the newest message so the whole mailbox isn't
 * replayed into tasks. Idempotent; returns the live state the wizard renders.
 */
export async function configureMailBee(opts: {
  enable?: boolean;
  email?: string;
  displayName?: string;
}): Promise<ActionResult> {
  const store = await import("@/lib/mailbee/store");
  const { probeAppleMail, readInboxSince } = await import("@/lib/mailbee/applemail");

  const warnings: string[] = [];
  const raw = (opts.email ?? "").trim();
  if (raw) {
    if (!raw.includes("@")) warnings.push(`"${raw}" is not an email — not added to trusted senders`);
    else store.upsertIdentity(raw, "allowed", opts.displayName ?? null);
  }

  // allowLaunch: true both launches Mail (if needed) and fires the AppleEvent
  // that makes macOS register HiveMatrix under Mail's Automation entry — the
  // very first attempt commonly fails with "not authorized" WHILE the TCC
  // prompt is shown; the console's guided dialog polls this same probe again
  // after the user responds (see mlRetryAutomationProbe in console.ts).
  const probe = await probeAppleMail(undefined, { allowLaunch: true });
  const mailControllable = probe.ok;
  // Only enable once Mail is controllable, and pin the high-water to the newest
  // message so existing inbox mail isn't turned into a flood of tasks.
  if (opts.enable !== false && mailControllable) {
    store.ensureChannel();
    const recent = await readInboxSince(0, 1);
    store.setLastId(recent[0]?.id ?? 0);
    store.setChannelEnabled(true);
  }

  const enabled = store.isChannelEnabled();
  const identities = store.listIdentities();
  const trusted = identities.filter((i) => i.status === "allowed" || i.status === "paired").length;
  const ok = enabled && mailControllable;

  let detail: string;
  if (!mailControllable) detail = probe.detail;
  else if (!enabled) detail = "Mail controllable — enabling the channel…";
  else detail = trusted > 0
    ? "Mail Lane ready: channel on, Mail controllable, trusted sender set."
    : "Channel on and Mail controllable — add a trusted sender for auto-send (others are draft-for-approval).";

  return {
    ok,
    detail,
    data: {
      enabled,
      mailControllable,
      mailProbeKind: probe.kind,
      mailProbeDetail: probe.detail,
      identities,
      deepLinks: { automation: TCC_DEEP_LINKS.automation },
      warnings: warnings.length ? warnings : undefined,
    },
  };
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
