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
 *   local-model   — a Qwen/local model profile is configured       [required]
 *   daemon        — launchd agent installed                         [required]
 *   brain         — brain memory root exists                        [required]
 *   frontier      — a frontier API key/auth is available            [optional]
 *   desktopbee    — Desktop Lane helper built + permissions granted [optional]
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { findBinary, CLAUDE_BINARY_SEARCH_PATHS, CODEX_BINARY_SEARCH_PATHS } from "@/lib/config/binary-detection";
import { resolveMemorySettings } from "@/lib/brain/settings";
import { localEngineCapability } from "@/lib/models/local-engine";

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

/**
 * Compute onboarding status. `now` is injectable for deterministic timestamps;
 * `helperReachable`/`desktopPermissions` can be injected from a live probe of
 * the Desktop Lane helper (the file checks alone can't see runtime TCC grants).
 */
export function getOnboardingStatus(opts: {
  now?: string;
  helperBuilt?: boolean;
  desktopPermissions?: { accessibility: boolean; screenRecording: boolean } | null;
  messagebee?: { enabled: boolean; chatDbReadable: boolean; chatDbDetail?: string } | null;
  mailbee?: { enabled: boolean; mailControllable: boolean } | null;
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

  // local-model — satisfied by a configured Rapid-MLX localEngine, a legacy
  // local model (LM Studio/Qwen profile), OR the default cloud-first posture.
  // Users can still explicitly choose local-only, in which case this becomes
  // a real required setup step again.
  const qwen = cfg?.qwen as Record<string, unknown> | undefined;
  const localEngine = cfg?.localEngine as Record<string, unknown> | undefined;
  const engineTiers = Array.isArray(localEngine?.tiers) ? (localEngine!.tiers as unknown[]) : [];
  const engineConfigured = engineTiers.length > 0;
  const legacyConfigured = !!(qwen && (qwen.primary as Record<string, unknown>)?.modelId) ||
    !!(cfg?.localModel as Record<string, unknown>)?.modelName;
  const modelConfigured = engineConfigured || legacyConfigured;
  const cap = localEngineCapability();
  // cloud-only by explicit posture, because the hardware can't run local, OR
  // cloud-first by default once the app has a config file.
  const cloudOnly = cfg?.runMode === "cloud-only" || !cap.localCapable;
  const cloudFirst = !!cfg && cfg.runMode !== "local-only";
  const localOk = modelConfigured || cloudOnly || cloudFirst;
  const engineModel = engineConfigured
    ? (engineTiers.map((t) => (t as Record<string, unknown>)?.alias).filter(Boolean).join(" + ") || "rapid-mlx")
    : null;
  steps.push({
    id: "local-model",
    title: "Local model (Rapid-MLX)",
    required: true,
    state: localOk ? "done" : "incomplete",
    detail: engineModel
      ? `Rapid-MLX tiers: ${engineModel}`
      : legacyConfigured
        ? `model: ${(qwen?.primary as Record<string, unknown>)?.modelId ?? (cfg?.localModel as Record<string, unknown>)?.modelName}`
        : !cap.localCapable
          ? `cloud-only — ${cap.reason ?? "this Mac can't run a local model"}`
        : cloudOnly
          ? "cloud-only mode — no local model required"
          : cloudFirst
            ? "cloud-first mode — local model can be provisioned later"
            : "no local model configured",
    remediation: localOk ? undefined
      : `Run the provisioner to size + install the local engine for this Mac (recommended: ${cap.recommendedTiers.join(" + ") || "cloud-only"}): npx tsx scripts/provision-local-engine.mts --apply`,
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

  // frontier (optional) — API keys OR installed CLIs both count
  const hasFrontierKey = !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY ||
    !!((cfg?.providers as Record<string, unknown>)?.openai);
  const claudePath = findBinary("claude", CLAUDE_BINARY_SEARCH_PATHS);
  const codexPath  = findBinary("codex",  CODEX_BINARY_SEARCH_PATHS);
  const hasFrontierCli = !!(claudePath || codexPath);
  const hasFrontier = hasFrontierKey || hasFrontierCli;
  const frontierDetail = hasFrontier
    ? [
        hasFrontierKey ? "API key present" : null,
        claudePath ? `claude CLI (${claudePath})` : null,
        codexPath  ? `codex CLI (${codexPath})`  : null,
      ].filter(Boolean).join(", ")
    : "no frontier key or CLI found (local-only operation)";
  steps.push({
    id: "frontier",
    title: "Frontier model access",
    required: false,
    state: hasFrontier ? "done" : "incomplete",
    detail: frontierDetail,
    remediation: hasFrontier ? undefined : "Optional: install the claude or codex CLI, or provide an ANTHROPIC_API_KEY/OPENAI_API_KEY for cloud-ok mode.",
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
