import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";
import { getLaneDefinition, listLaneDefinitions, type LaneDefinition } from "@/lib/lanes/catalog";
import { readToken } from "@/lib/auth/token";

export type LaneRuntimeMode = "embedded" | "launchagent" | "planned";

export interface LaneLaunchAgentSettings {
  autoStart: boolean;
  repoPath: string;
  plistLabel: string;
  plistPath: string;
}

interface NodeRuntimeSpec {
  executable: string;
  environment?: Record<string, string>;
}

export interface LaneHealthSnapshot {
  ok: boolean;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface LaneWorkerStatus {
  kind: string;
  name: string;
  role: LaneDefinition["role"];
  phase: LaneDefinition["phase"];
  summary: string;
  runtimeMode: LaneRuntimeMode;
  manageable: boolean;
  available: boolean;
  autoStart: boolean;
  running: boolean;
  loaded: boolean;
  healthy: boolean | null;
  pid: number | null;
  repoPath: string | null;
  plistLabel: string | null;
  plistPath: string | null;
  healthcheckUrl: string | null;
  statusDetail: string | null;
}

interface LaneWorkerDescriptor {
  kind: string;
  runtimeMode: LaneRuntimeMode;
  manageable: boolean;
  defaultRepoPath?: string;
  defaultPlistLabel?: string;
  healthcheckUrl?: string;
  distEntry?: string;
  logDirName?: string;
}

interface LaneServicesConfigShape {
  // Going forward HiveMatrix persists per-worker launch-agent settings under
  // `laneServices`. `beeServices` is the legacy key — still read as a fallback
  // so older config.json files keep working until a later migration drops it.
  laneServices?: Record<string, Partial<LaneLaunchAgentSettings>>;
  beeServices?: Record<string, Partial<LaneLaunchAgentSettings>>;
}

const MANAGED_LANE_DESCRIPTORS: LaneWorkerDescriptor[] = [
  {
    // In HiveMatrix, Message Lane is an in-daemon poller (not a standalone Hive-1
    // launchagent). Status is derived from the iMessage channel state below;
    // managed via the Message Lane setup modal, so no launchctl toggle.
    kind: "messagebee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    // Likewise an in-daemon poller, gated on the email channel being enabled.
    kind: "mailbee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    kind: "inventorbee",
    runtimeMode: "launchagent",
    manageable: true,
    defaultRepoPath: join(homedir(), "inventorbee"),
    defaultPlistLabel: "com.inventorbee.agent",
    healthcheckUrl: "http://127.0.0.1:4014/healthcheck",
    distEntry: "dist/index.js",
    logDirName: "inventorbee",
  },
  {
    kind: "review",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    kind: "brainbee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    kind: "browserbee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    kind: "webbee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    kind: "computerbee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    kind: "cronbee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    kind: "authbee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    kind: "tubebee",
    runtimeMode: "embedded",
    manageable: false,
  },
  {
    // The Swift helper (on :3748). Bundled + auto-started with the app; its
    // health is the /desktopbee/health probe (which pings the helper).
    kind: "desktopbee",
    runtimeMode: "embedded",
    manageable: false,
  },
];

const DESCRIPTOR_MAP = new Map(MANAGED_LANE_DESCRIPTORS.map((descriptor) => [descriptor.kind, descriptor]));

// Backwards-compat aliases: maps deprecated kind strings to the canonical kind that
// replaced them, so callers (tests, persisted worker records) still resolve correctly.
const DESCRIPTOR_KIND_COMPAT: Record<string, string> = {
  managerbee: "review",
};

function getUid(): string {
  return execSync("id -u", { encoding: "utf-8", timeout: 2000 }).trim();
}

function expandHomePath(value: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

// Pure config-shape helpers (no filesystem) so the lane/legacy key migration is
// unit-testable without touching the real ~/.hivematrix/config.json.
export function selectLaneServices(
  config: LaneServicesConfigShape,
): Record<string, Partial<LaneLaunchAgentSettings>> {
  // Prefer the lane-native key, fall back to the legacy `beeServices` block.
  return config.laneServices ?? config.beeServices ?? {};
}

export function applyLaneServices<T extends LaneServicesConfigShape & Record<string, unknown>>(
  config: T,
  settings: Record<string, Partial<LaneLaunchAgentSettings>>,
): T {
  // Write the lane-native key going forward and drop the legacy mirror so the
  // two can't drift; the read path still accepts `beeServices` for old files.
  config.laneServices = settings;
  delete config.beeServices;
  return config;
}

function readLaneServicesConfig(): Record<string, Partial<LaneLaunchAgentSettings>> {
  return selectLaneServices(loadHiveConfig() as LaneServicesConfigShape);
}

function saveLaneServicesConfig(settings: Record<string, Partial<LaneLaunchAgentSettings>>): void {
  const config = applyLaneServices(loadHiveConfig() as LaneServicesConfigShape & Record<string, unknown>, settings);
  saveHiveConfig(config);
}

export function resolveLaneLaunchAgentSettings(kind: string): LaneLaunchAgentSettings | null {
  const descriptor = DESCRIPTOR_MAP.get(kind);
  if (!descriptor || descriptor.runtimeMode !== "launchagent") return null;

  const saved = readLaneServicesConfig()[kind] ?? {};
  const plistLabel = String(saved.plistLabel || descriptor.defaultPlistLabel || "").trim();
  const repoPath = expandHomePath(String(saved.repoPath || descriptor.defaultRepoPath || "").trim());
  const plistPath = expandHomePath(
    String(saved.plistPath || join(homedir(), "Library", "LaunchAgents", `${plistLabel}.plist`)).trim(),
  );

  return {
    autoStart: saved.autoStart === true,
    repoPath,
    plistLabel,
    plistPath,
  };
}

export function updateLaneLaunchAgentSettings(kind: string, updates: Partial<LaneLaunchAgentSettings>): LaneLaunchAgentSettings | null {
  const current = resolveLaneLaunchAgentSettings(kind);
  if (!current) return null;

  const next: LaneLaunchAgentSettings = {
    ...current,
    ...updates,
  };

  const all = readLaneServicesConfig();
  all[kind] = next;
  saveLaneServicesConfig(all);
  return next;
}

export function buildLaunchAgentPlist(
  kind: string,
  settings: LaneLaunchAgentSettings,
  nodeRuntime: string | NodeRuntimeSpec,
): string {
  const descriptor = DESCRIPTOR_MAP.get(kind);
  if (!descriptor || !descriptor.distEntry) {
    throw new Error(`Lane ${kind} does not support LaunchAgent generation`);
  }

  const runtime = typeof nodeRuntime === "string"
    ? { executable: nodeRuntime, environment: {} }
    : { executable: nodeRuntime.executable, environment: nodeRuntime.environment ?? {} };
  const distPath = join(settings.repoPath, descriptor.distEntry);
  const logDir = join(homedir(), "Library", "Logs", descriptor.logDirName || kind);
  const outLog = join(logDir, `${kind}.out.log`);
  const errLog = join(logDir, `${kind}.err.log`);
  const extraEnvironment = Object.entries(runtime.environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `    <key>${escapeXml(key)}</key><string>${escapeXml(value)}</string>`)
    .join("\n");
  const environmentBlock = extraEnvironment ? `${extraEnvironment}\n` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(settings.plistLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(runtime.executable)}</string>
    <string>--enable-source-maps</string>
    <string>${escapeXml(distPath)}</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(settings.repoPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
${environmentBlock}  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(outLog)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(errLog)}</string>
</dict>
</plist>
`;
}

function isPlainNodeBinary(path: string): boolean {
  return basename(path).toLowerCase() === "node";
}

function parseNodeVersion(name: string): number[] {
  const match = name.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i);
  if (!match) return [-1, -1, -1];
  return [match[1], match[2] ?? "0", match[3] ?? "0"].map((part) => Number.parseInt(part, 10));
}

function compareNodeVersionsDesc(left: string, right: string): number {
  const a = parseNodeVersion(left);
  const b = parseNodeVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (b[index] ?? -1) - (a[index] ?? -1);
    if (delta !== 0) return delta;
  }
  return right.localeCompare(left);
}

function listNvmNodeBins(): string[] {
  const versionsDir = join(homedir(), ".nvm", "versions", "node");
  if (!existsSync(versionsDir)) return [];

  return readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareNodeVersionsDesc)
    .map((version) => join(versionsDir, version, "bin", "node"))
    .filter((candidate) => existsSync(candidate));
}

function resolveNodeRuntime(): NodeRuntimeSpec {
  // In a packaged appliance the daemon runs under the Node bundled inside the
  // .app; HIVEMATRIX_NODE_BIN (set by the launchd plist / Tauri bootstrap) points
  // at it and is authoritative, so bee services spawn with the same bundled Node
  // rather than an unrelated system Node that may not exist on a clean machine.
  const bundledNode = process.env.HIVEMATRIX_NODE_BIN;
  if (bundledNode && existsSync(bundledNode)) {
    return { executable: bundledNode };
  }

  if (process.execPath && existsSync(process.execPath) && isPlainNodeBinary(process.execPath)) {
    return { executable: process.execPath };
  }

  try {
    const shellNode = execSync("which node", { encoding: "utf-8", timeout: 3000 }).trim();
    if (shellNode && existsSync(shellNode)) {
      return { executable: shellNode };
    }
  } catch {
    // ignore shell lookup failures and keep trying deterministic paths
  }

  const candidates = [
    ...listNvmNodeBins(),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { executable: candidate };
    }
  }

  if (process.execPath && existsSync(process.execPath)) {
    return {
      executable: process.execPath,
      environment: {
        ELECTRON_RUN_AS_NODE: "1",
      },
    };
  }

  throw new Error("Unable to find a usable node binary");
}

export function resolveNodeBin(): string {
  return resolveNodeRuntime().executable;
}

function ensureLaunchAgentPrereqs(kind: string, settings: LaneLaunchAgentSettings): { descriptor: LaneWorkerDescriptor; nodeRuntime: NodeRuntimeSpec } {
  const descriptor = DESCRIPTOR_MAP.get(kind);
  if (!descriptor || descriptor.runtimeMode !== "launchagent") {
    throw new Error(`Lane ${kind} is not launchagent-managed`);
  }
  if (!settings.repoPath || !existsSync(settings.repoPath)) {
    throw new Error(`Repo path does not exist for ${kind}: ${settings.repoPath}`);
  }
  if (!descriptor.distEntry || !existsSync(join(settings.repoPath, descriptor.distEntry))) {
    throw new Error(`Built entry missing for ${kind}. Run the lane build first.`);
  }
  if (!settings.plistLabel.trim()) {
    throw new Error(`Missing LaunchAgent label for ${kind}`);
  }
  const nodeRuntime = resolveNodeRuntime();
  return { descriptor, nodeRuntime };
}

function writeLaunchAgent(kind: string, settings: LaneLaunchAgentSettings): void {
  const { descriptor, nodeRuntime } = ensureLaunchAgentPrereqs(kind, settings);
  const plistDir = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(plistDir, { recursive: true });
  mkdirSync(join(homedir(), "Library", "Logs", descriptor.logDirName || kind), { recursive: true });
  writeFileSync(settings.plistPath, buildLaunchAgentPlist(kind, settings, nodeRuntime));
}

function launchctlPrint(label: string): string | null {
  try {
    return execFileSync("launchctl", ["print", `gui/${getUid()}/${label}`], {
      encoding: "utf-8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function parseLaunchctlStatus(output: string | null): { loaded: boolean; running: boolean; pid: number | null; detail: string | null } {
  if (!output) return { loaded: false, running: false, pid: null, detail: null };

  const pidMatch = output.match(/\bpid = (\d+)/);
  const stateMatch = output.match(/\bstate = ([a-z_]+)/i);
  const lastExitMatch = output.match(/\blast exit code = (\d+)/i);
  return {
    loaded: true,
    running: Boolean(pidMatch),
    pid: pidMatch ? Number.parseInt(pidMatch[1], 10) : null,
    detail: stateMatch?.[1] ?? lastExitMatch?.[1] ?? null,
  };
}

async function checkHealth(
  url: string | undefined,
  authToken?: string | null,
): Promise<{ healthy: boolean | null; detail: string | null }> {
  if (!url) return { healthy: null, detail: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    // Daemon-loopback health routes are token-gated; pass the shared secret so
    // the probe doesn't 401 (the embedded bees would then look falsely unhealthy).
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) {
      clearTimeout(timeout);
      return { healthy: false, detail: `health_http_${response.status}` };
    }
    const body = await response.json().catch(() => null);
    clearTimeout(timeout);
    const parsed = summarizeEmbeddedHealthDetail(url, body);
    return { healthy: true, detail: parsed };
  } catch (error) {
    clearTimeout(timeout);
    return { healthy: false, detail: error instanceof Error ? error.message : "health_unreachable" };
  }
}

export function summarizeEmbeddedHealthDetail(kindOrUrl: string, payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const bee = typeof record.bee === "string" ? record.bee : kindOrUrl;

  if (bee === "browserbee") {
    const sessionPlane = record.sessionPlane;
    if (!sessionPlane || typeof sessionPlane !== "object" || Array.isArray(sessionPlane)) return null;
    const plane = sessionPlane as Record<string, unknown>;
    const ready = typeof plane.ready === "number" ? plane.ready : 0;
    const needsReauth = typeof plane.needsReauth === "number" ? plane.needsReauth : 0;
    const expired = typeof plane.expired === "number" ? plane.expired : 0;
    const providers = Array.isArray(plane.providers)
      ? plane.providers.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const providerSuffix = providers.length > 0 ? ` · ${providers.join(", ")}` : "";
    return `${ready} ready · ${needsReauth} needs reauth · ${expired} expired${providerSuffix}`;
  }

  if (bee === "authbee") {
    const counts = record.counts;
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
    const values = counts as Record<string, unknown>;
    const ready = typeof values.ready === "number" ? values.ready : 0;
    const needsReauth = typeof values.needsReauth === "number" ? values.needsReauth : 0;
    const expired = typeof values.expired === "number" ? values.expired : 0;
    return `${ready} ready · ${needsReauth} needs reauth · ${expired} expired`;
  }

  return null;
}

function descriptorForKind(kind: string): LaneWorkerDescriptor {
  const canonical = DESCRIPTOR_KIND_COMPAT[kind] ?? kind;
  const existing = DESCRIPTOR_MAP.get(canonical);
  if (existing) return existing;
  return {
    kind,
    runtimeMode: "planned",
    manageable: false,
  };
}

export function getLaneWorkerRuntimeDescriptor(kind: string): Pick<LaneWorkerDescriptor, "kind" | "runtimeMode" | "manageable"> {
  const descriptor = descriptorForKind(kind);
  return {
    kind: descriptor.kind,
    runtimeMode: descriptor.runtimeMode,
    manageable: descriptor.manageable,
  };
}

export async function listLaneWorkerStatuses(): Promise<LaneWorkerStatus[]> {
  const definitions = listLaneDefinitions();
  const statuses: LaneWorkerStatus[] = [];

  for (const definition of definitions) {
    const descriptor = descriptorForKind(definition.kind);

    // Channel bees (messagebee/mailbee) are in-daemon pollers — report live
    // status from the channel state + its OS permission, not launchctl/HTTP.
    if (definition.kind === "messagebee" || definition.kind === "mailbee") {
      const ch = await channelStatus(definition.kind);
      statuses.push({
        kind: definition.kind,
        name: definition.name,
        role: definition.role,
        phase: definition.phase,
        summary: definition.summary,
        runtimeMode: "embedded",
        manageable: false,
        available: true,
        autoStart: ch.enabled,
        running: ch.enabled,
        loaded: ch.enabled,
        healthy: ch.enabled ? ch.permitted : null,
        pid: null,
        repoPath: null,
        plistLabel: null,
        plistPath: null,
        healthcheckUrl: null,
        statusDetail: ch.detail,
      });
      continue;
    }

    if (descriptor.runtimeMode === "launchagent") {
      const settings = resolveLaneLaunchAgentSettings(definition.kind);
      const repoPath = settings?.repoPath ?? null;
      const available = Boolean(repoPath && existsSync(repoPath));
      const launchState = settings ? parseLaunchctlStatus(launchctlPrint(settings.plistLabel)) : { loaded: false, running: false, pid: null, detail: null };
      const health = await checkHealth(descriptor.healthcheckUrl);

      statuses.push({
        kind: definition.kind,
        name: definition.name,
        role: definition.role,
        phase: definition.phase,
        summary: definition.summary,
        runtimeMode: descriptor.runtimeMode,
        manageable: descriptor.manageable,
        available,
        autoStart: settings?.autoStart === true,
        running: launchState.running,
        loaded: launchState.loaded,
        healthy: health.healthy,
        pid: launchState.pid,
        repoPath,
        plistLabel: settings?.plistLabel ?? null,
        plistPath: settings?.plistPath ?? null,
        healthcheckUrl: descriptor.healthcheckUrl ?? null,
        statusDetail: health.detail ?? launchState.detail,
      });
      continue;
    }

    const embeddedHealthUrl = embeddedHealthRoute(definition.kind);
    // Embedded lanes are served by THIS daemon (HIVEMATRIX_PORT, default 3747) —
    // not a separate worker on :4000 (a Hive-1 artifact that always "fetch failed").
    const daemonPort = process.env.HIVEMATRIX_PORT ?? process.env.PORT ?? "3747";
    const health = await checkHealth(
      embeddedHealthUrl ? `http://127.0.0.1:${daemonPort}${embeddedHealthUrl}` : undefined,
      readToken("auth-token"),
    );
    const available = descriptor.runtimeMode === "embedded";
    statuses.push({
      kind: definition.kind,
      name: definition.name,
      role: definition.role,
      phase: definition.phase,
      summary: definition.summary,
      runtimeMode: descriptor.runtimeMode,
      manageable: descriptor.manageable,
      available,
      autoStart: descriptor.runtimeMode === "embedded",
      running: descriptor.runtimeMode === "embedded",
      loaded: descriptor.runtimeMode === "embedded",
      healthy: descriptor.runtimeMode === "embedded" ? health.healthy : null,
      pid: null,
      repoPath: null,
      plistLabel: null,
      plistPath: null,
      healthcheckUrl: embeddedHealthUrl,
      statusDetail: descriptor.runtimeMode === "planned" ? "No runtime registered yet." : health.detail,
    });
  }

  return statuses;
}

/** Live status for an in-daemon channel bee: enabled? OS permission granted? */
async function channelStatus(kind: string): Promise<{ enabled: boolean; permitted: boolean; detail: string }> {
  if (kind === "messagebee") {
    const { getMessagebeeStatus } = await import("@/lib/messagebee/status");
    const status = getMessagebeeStatus();
    const permitted = status.chatDbReadable;
    return {
      enabled: status.enabled,
      permitted,
      detail: !status.enabled ? "channel off — set up to enable"
        : permitted ? "running; reading Messages chat.db" : `enabled, but ${status.chatDbDetail}`,
    };
  }
  // mailbee
  const { isChannelEnabled } = await import("@/lib/mailbee/store");
  const { canControlMail } = await import("@/lib/mailbee/applemail");
  const enabled = isChannelEnabled();
  const permitted = enabled ? await canControlMail() : false;
  return {
    enabled, permitted,
    detail: !enabled ? "channel off — set up to enable"
      : permitted ? "running; controlling Apple Mail" : "enabled, but Mail Automation permission is missing",
  };
}

export function embeddedHealthRoute(kind: string): string | null {
  switch (kind) {
    case "review":
      return "/api/review-lane/health";
    case "managerbee": // @deprecated compat — use "review"
      return "/api/managerbee/health";
    case "brainbee":
      return "/api/brainbee/health";
    case "browserbee":
      return "/browserbee/health";
    case "desktopbee":
      return "/desktopbee/health";
    case "computerbee":
      return "/api/computerbee/health";
    case "cronbee":
      return "/api/cronbee/health";
    case "authbee":
      return "/api/authbee/health";
    case "inventorbee":
      return "/api/inventorbee/health";
    default:
      return null;
  }
}

export function setLaneWorkerAutoStart(kind: string, autoStart: boolean, repoPath?: string): LaneLaunchAgentSettings | null {
  const current = resolveLaneLaunchAgentSettings(kind);
  if (!current) return null;

  const next = updateLaneLaunchAgentSettings(kind, {
    autoStart,
    ...(repoPath ? { repoPath } : {}),
  });
  if (!next) return null;

  if (autoStart) {
    writeLaunchAgent(kind, next);
    try {
      execFileSync("launchctl", ["bootstrap", `gui/${getUid()}`, next.plistPath], { timeout: 5000, stdio: "ignore" });
    } catch {
      // already bootstrapped or loaded
    }
    execFileSync("launchctl", ["kickstart", "-k", `gui/${getUid()}/${next.plistLabel}`], { timeout: 5000, stdio: "ignore" });
  } else {
    try {
      execFileSync("launchctl", ["bootout", `gui/${getUid()}`, next.plistPath], { timeout: 5000, stdio: "ignore" });
    } catch {
      // already stopped
    }
    rmSync(next.plistPath, { force: true });
  }

  return next;
}

export function ensureLaneWorkerLoaded(kind: string): boolean {
  const settings = resolveLaneLaunchAgentSettings(kind);
  if (!settings) {
    throw new Error(`Lane ${kind} is not launchagent-managed`);
  }
  if (!settings.autoStart) return false;

  const current = parseLaunchctlStatus(launchctlPrint(settings.plistLabel));
  if (current.loaded && current.running) return false;

  writeLaunchAgent(kind, settings);
  try {
    execFileSync("launchctl", ["bootstrap", `gui/${getUid()}`, settings.plistPath], { timeout: 5000, stdio: "ignore" });
  } catch {
    // already bootstrapped
  }
  execFileSync("launchctl", ["kickstart", "-k", `gui/${getUid()}/${settings.plistLabel}`], { timeout: 5000, stdio: "ignore" });
  return true;
}

export function restartLaneWorkerService(kind: string): void {
  const settings = resolveLaneLaunchAgentSettings(kind);
  if (!settings) {
    throw new Error(`Lane ${kind} is not restartable`);
  }
  writeLaunchAgent(kind, settings);
  try {
    execFileSync("launchctl", ["bootstrap", `gui/${getUid()}`, settings.plistPath], { timeout: 5000, stdio: "ignore" });
  } catch {
    // already bootstrapped
  }
  execFileSync("launchctl", ["kickstart", "-k", `gui/${getUid()}/${settings.plistLabel}`], { timeout: 5000, stdio: "ignore" });
}

export function laneWorkerExists(kind: string): boolean {
  return getLaneDefinition(kind) !== null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
