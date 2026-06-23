import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DEFAULT_CANOPY_AGENT_PORT = 8421;
const DEFAULT_CANOPY_STATE_FILE = join(homedir(), "Library", "Application Support", "Canopy", "agent-bridge.json");

export interface CanopyBridgeConfig {
  port: number;
  token: string;
}

export interface CanopyCapability {
  name: string;
  summary?: string;
  permission?: string;
  supportsDryRun?: boolean;
  inputKeys?: string[];
  executionOwner?: string;
  sideEffect?: string | null;
}

export interface CanopyResult {
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
  approval?: {
    status: string;
    reason: string;
  };
}

export interface CanopyInvokeOptions {
  config?: CanopyBridgeConfig;
  fetchImpl?: typeof fetch;
  explicitApproval?: boolean;
}

interface PersistedCanopyBridgeState {
  port?: unknown;
  token?: unknown;
}

const REQUIRED_TERMINAL_CAPABILITIES = [
  "terminal.sessions.list",
  "terminal.session.open_local",
  "terminal.session.read",
  "terminal.session.send",
];

export function loadCanopyBridgeConfigFromState(state: PersistedCanopyBridgeState): CanopyBridgeConfig {
  const parsedPort = typeof state.port === "string" || typeof state.port === "number"
    ? Number(state.port)
    : DEFAULT_CANOPY_AGENT_PORT;
  return {
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_CANOPY_AGENT_PORT,
    token: typeof state.token === "string" ? state.token : "",
  };
}

export function loadCanopyBridgeConfig(): CanopyBridgeConfig {
  const envPort = process.env.CANOPY_AGENT_PORT;
  const envToken = process.env.CANOPY_AGENT_TOKEN;
  if (envPort || envToken) {
    return loadCanopyBridgeConfigFromState({
      port: envPort ?? DEFAULT_CANOPY_AGENT_PORT,
      token: envToken ?? "",
    });
  }

  const stateFile = process.env.CANOPY_AGENT_STATE_FILE ?? DEFAULT_CANOPY_STATE_FILE;
  try {
    return loadCanopyBridgeConfigFromState(JSON.parse(readFileSync(stateFile, "utf-8")) as PersistedCanopyBridgeState);
  } catch {
    return { port: DEFAULT_CANOPY_AGENT_PORT, token: "" };
  }
}

export function canUseCanopyTerminal(capabilities: CanopyCapability[]): boolean {
  const names = new Set(capabilities.map((capability) => capability.name));
  return REQUIRED_TERMINAL_CAPABILITIES.every((name) => names.has(name));
}

function canopyUrl(config: CanopyBridgeConfig, path: string): string {
  return `http://127.0.0.1:${config.port}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(token: string): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function listCanopyCapabilities(opts: CanopyInvokeOptions = {}): Promise<CanopyCapability[]> {
  const config = opts.config ?? loadCanopyBridgeConfig();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(canopyUrl(config, "/capabilities"), {
    headers: authHeaders(config.token),
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error(`Canopy capability request failed with HTTP ${res.status}`);
  return await res.json() as CanopyCapability[];
}

export async function invokeCanopyCapability(
  capability: string,
  payload: Record<string, string> = {},
  opts: CanopyInvokeOptions = {},
): Promise<CanopyResult> {
  const config = opts.config ?? loadCanopyBridgeConfig();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(canopyUrl(config, "/invoke"), {
    method: "POST",
    headers: {
      ...authHeaders(config.token),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      capability,
      payload,
      explicitApproval: opts.explicitApproval === true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text) as CanopyResult;
}
