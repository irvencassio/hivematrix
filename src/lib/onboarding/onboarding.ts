/**
 * First-run onboarding (Phase 6).
 *
 * Inspects the machine and reports which provisioning steps are done vs.
 * outstanding, each with a concrete remediation hint. The console renders this
 * as a setup checklist; nothing here mutates state — it's a read-only probe so
 * it's safe to call any time (also doubles as a "system readiness" view).
 *
 * Steps (required ones gate a green first-run):
 *   config        — ~/.hivematrix/config.json present
 *   daemon        — launchd agent installed                         [required]
 *   brain         — brain memory root exists                        [required]
 *   frontier      — a frontier CLI (Claude/Codex) is available      [required]
 *   desktopbee    — Desktop Lane helper built + permissions granted [optional]
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { findBinary, CLAUDE_BINARY_SEARCH_PATHS, CODEX_BINARY_SEARCH_PATHS } from "@/lib/config/binary-detection";
import { resolveMemorySettings } from "@/lib/brain/settings";

export type StepState = "done" | "incomplete";

export interface OnboardingStep {
  id: string;
  title: string;
  required: boolean;
  state: StepState;
  detail: string;
  /** What the user (or installer) should do to satisfy this step. */
  remediation?: string;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  requiredComplete: boolean;
  allComplete: boolean;
  generatedAt: string;
}

function configPath(): string {
  return join(homedir(), ".hivematrix", "config.json");
}

function readConfig(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(configPath(), "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function launchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", "com.hivematrix.daemon.plist");
}

function claudeJsonPath(): string {
  return join(homedir(), ".claude.json");
}

function readClaudeJson(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(claudeJsonPath(), "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Compute onboarding status. `now` is injectable for deterministic timestamps;
 * `helperReachable`/`desktopPermissions` can be injected from a live probe of
 * the Desktop Lane helper (the file checks alone can't see runtime TCC grants);
 * `findBinaryImpl` is injectable so tests don't depend on the real machine's
 * claude/codex CLI installation.
 */
export function getOnboardingStatus(opts: {
  now?: string;
  helperBuilt?: boolean;
  desktopPermissions?: { accessibility: boolean; screenRecording: boolean } | null;
  messagebee?: { enabled: boolean; chatDbReadable: boolean; chatDbDetail?: string } | null;
  mailbee?: { enabled: boolean; mailControllable: boolean } | null;
  findBinaryImpl?: typeof findBinary;
  /** Override the "/Applications/Canopy.app" existsSync check — injectable
   *  since that path is absolute (not under the test-swappable HOME). Defaults
   *  to a real filesystem check. */
  canopyInstalled?: boolean;
} = {}): OnboardingStatus {
  const cfg = readConfig();
  const steps: OnboardingStep[] = [];

  // config
  steps.push({
    id: "config",
    title: "Configuration file",
    required: true,
    state: cfg ? "done" : "incomplete",
    detail: cfg ? "~/.hivematrix/config.json present" : "no config file",
    remediation: cfg ? undefined : "Create ~/.hivematrix/config.json (the onboarding flow writes it).",
  });

  // daemon (launchd)
  const daemonOk = existsSync(launchdPlistPath());
  steps.push({
    id: "daemon",
    title: "Background daemon (launchd)",
    required: true,
    state: daemonOk ? "done" : "incomplete",
    detail: daemonOk ? "launchd agent installed" : "launchd agent not installed",
    remediation: daemonOk ? undefined : "Render scripts/launchd/com.hivematrix.daemon.plist.template to ~/Library/LaunchAgents and `launchctl load -w`.",
  });

  // brain — read the SAME source of truth every harness uses
  // (config.memory.brainRootDir via resolveMemorySettings), not a separate key.
  const brainRoot = resolveMemorySettings(cfg ?? {}).brainRootDir;
  const brainOk = existsSync(brainRoot);
  steps.push({
    id: "brain",
    title: "Brain memory plane",
    required: true,
    state: brainOk ? "done" : "incomplete",
    detail: brainOk ? `brain root: ${brainRoot}` : `brain root not found: ${brainRoot}`,
    remediation: brainOk ? undefined : "Set config.memory.brainRootDir to your brain directory and ensure it exists (the wizard's Brain step does this).",
  });

  // persona (optional) — birth ritual produces IDENTITY.md; migrated installs already have it
  const personaOk = brainOk && existsSync(join(brainRoot, "persona", "IDENTITY.md"));
  steps.push({
    id: "persona",
    title: "Persona (birth ritual)",
    required: false,
    state: personaOk ? "done" : "incomplete",
    detail: personaOk
      ? `persona established (${brainRoot}/persona/IDENTITY.md)`
      : brainOk
        ? "persona not yet created — run the birth ritual"
        : "brain root must be set up first",
    remediation: personaOk
      ? undefined
      : "Open Setup → Persona in the console and run the birth ritual to give your assistant a name and identity.",
  });

  // frontier — required post-cutover: HiveMatrix is Claude-native, so a
  // frontier CLI (claude or codex, subscription OAuth) is the ONLY text
  // inference path. No local model fallback remains.
  const find = opts.findBinaryImpl ?? findBinary;
  const claudePath = find("claude", CLAUDE_BINARY_SEARCH_PATHS);
  const codexPath  = find("codex",  CODEX_BINARY_SEARCH_PATHS);
  const hasFrontier = !!(claudePath || codexPath);
  const frontierDetail = hasFrontier
    ? [
        claudePath ? `claude CLI (${claudePath})` : null,
        codexPath  ? `codex CLI (${codexPath})`  : null,
      ].filter(Boolean).join(", ")
    : "no frontier CLI found — install claude or codex to enable text inference";
  steps.push({
    id: "frontier",
    title: "Frontier model access",
    required: true,
    state: hasFrontier ? "done" : "incomplete",
    detail: frontierDetail,
    remediation: hasFrontier ? undefined : "Install the claude CLI (https://claude.com/claude-code) or the codex CLI and sign in.",
  });

  steps.push({
    id: "codex-cli",
    title: "Codex CLI (optional)",
    required: false,
    state: codexPath ? "done" : "incomplete",
    detail: codexPath
      ? `Optional Codex CLI detected (${codexPath})`
      : "Optional: install only if you want ChatGPT/Codex routing.",
    remediation: codexPath ? undefined : "Install the Codex CLI, then run `codex login` with a ChatGPT Plus/Pro account.",
  });

  // canopy (optional) — the MCP terminal that replaced the retired Terminal
  // Lane. "Installed" is the .app bundle; "registered" is a `canopy` entry in
  // Claude Code's own MCP registry (~/.claude.json). Both are needed for
  // Claude Code sessions to actually be able to use it.
  const canopyInstalled = opts.canopyInstalled ?? existsSync("/Applications/Canopy.app");
  const canopyServers = readClaudeJson()?.mcpServers;
  const canopyRegistered = !!canopyServers && typeof canopyServers === "object" && "canopy" in canopyServers;
  const canopyOk = canopyInstalled && canopyRegistered;
  const canopyDetail = !canopyInstalled
    ? "Canopy not installed"
    : !canopyRegistered
      ? "Canopy installed but not registered for Claude Code"
      : "installed and registered";
  steps.push({
    id: "canopy",
    title: "Canopy (MCP terminal, optional)",
    required: false,
    state: canopyOk ? "done" : "incomplete",
    detail: canopyDetail,
    remediation: canopyOk
      ? undefined
      : "Optional: install Canopy (replaces the retired Terminal Lane) and register it as an mcpServers entry in ~/.claude.json so Claude Code sessions can use it.",
  });

  // desktopbee (optional compatibility id) — Desktop Lane
  const perms = opts.desktopPermissions;
  const desktopOk = opts.helperBuilt === true && !!perms && perms.accessibility && perms.screenRecording;
  let desktopDetail = "Desktop Lane helper not built";
  if (opts.helperBuilt) {
    if (!perms) desktopDetail = "helper built; permission status unknown (helper not running)";
    else desktopDetail = `helper built; accessibility=${perms.accessibility} screenRecording=${perms.screenRecording}`;
  }
  steps.push({
    id: "desktopbee",
    title: "Desktop Lane (desktop control)",
    required: false,
    state: desktopOk ? "done" : "incomplete",
    detail: desktopDetail,
    remediation: desktopOk ? undefined : "Optional: install the Desktop Lane helper and grant Accessibility + Screen Recording in System Settings.",
  });

  // messagebee (optional compatibility id) — Message Lane SMS/iMessage control surface
  const mb = opts.messagebee;
  const messagebeeOk = !!mb && mb.enabled && mb.chatDbReadable;
  let messagebeeDetail = "Message Lane disabled";
  if (mb) {
    if (!mb.enabled) messagebeeDetail = mb.chatDbReadable ? "chat.db readable; channel disabled" : "Message Lane disabled";
    else if (!mb.chatDbReadable) messagebeeDetail = mb.chatDbDetail ?? "Full Disk Access needed to read Messages (chat.db)";
    else messagebeeDetail = "enabled; reading chat.db and sending via Messages";
  }
  steps.push({
    id: "messagebee",
    title: "Message Lane (text HiveMatrix)",
    required: false,
    state: messagebeeOk ? "done" : "incomplete",
    detail: messagebeeDetail,
    remediation: messagebeeOk ? undefined : "Optional: grant Full Disk Access (to read Messages), enable the channel, and allowlist your phone in Settings > Message Lane.",
  });

  // mailbee (optional compatibility id) — Mail Lane email watch + trust-gated drafting via Apple Mail
  const ml = opts.mailbee;
  const mailbeeOk = !!ml && ml.enabled && ml.mailControllable;
  let mailbeeDetail = "Mail Lane disabled";
  if (ml) {
    if (!ml.enabled) mailbeeDetail = ml.mailControllable ? "Mail controllable; channel disabled" : "Mail Lane disabled";
    else if (!ml.mailControllable) mailbeeDetail = "Mail.app automation permission needed";
    else mailbeeDetail = "enabled; watching the inbox";
  }
  steps.push({
    id: "mailbee",
    title: "Mail Lane (email watch)",
    required: false,
    state: mailbeeOk ? "done" : "incomplete",
    detail: mailbeeDetail,
    remediation: mailbeeOk ? undefined : "Optional: grant HiveMatrix Automation control of Mail.app, enable the channel, and add trusted senders in Settings > Mail Lane.",
  });

  // telemetry (optional) — opt-in anonymous usage stats
  const telemetryEnabled = !!(cfg?.telemetry as Record<string, unknown> | undefined)?.enabled;
  steps.push({
    id: "telemetry",
    title: "Anonymous usage stats (optional)",
    required: false,
    state: telemetryEnabled ? "done" : "incomplete",
    detail: telemetryEnabled
      ? "opted in — aggregate counters sent daily to first-party endpoint; no event payloads leave this Mac"
      : "opted out — nothing leaves this Mac (recommended for privacy-first users)",
    remediation: telemetryEnabled
      ? undefined
      : "Optional: enable in Settings > General > Anonymous usage stats to help improve HiveMatrix.",
  });

  const requiredComplete = steps.filter((s) => s.required).every((s) => s.state === "done");
  const allComplete = steps.every((s) => s.state === "done");
  return { steps, requiredComplete, allComplete, generatedAt: opts.now ?? new Date().toISOString() };
}
