import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface RemoteAccessSettings {
  namedHostname?: string;
  cloudflareAccessClientId?: string;
  cloudflareAccessClientSecret?: string;
  tailscaleEnabled?: boolean;
  cloudflareEnabled?: boolean;
  cloudflareConnectorToken?: string;
}

function settingsDir(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function settingsPath(): string {
  return join(settingsDir(), "remote-access.json");
}

export function normalizePublicUrl(hostname: string | null | undefined): string | undefined {
  const raw = String(hostname ?? "").trim().replace(/\/+$/, "");
  if (!raw) return undefined;
  return raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
}

function clean(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  return raw || undefined;
}

export function readRemoteAccessSettings(): RemoteAccessSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Record<string, unknown>;
    const settings: RemoteAccessSettings = {};
    const namedHostname = normalizePublicUrl(parsed.namedHostname as string | undefined);
    const cloudflareAccessClientId = clean(parsed.cloudflareAccessClientId);
    const cloudflareAccessClientSecret = clean(parsed.cloudflareAccessClientSecret);
    const cloudflareConnectorToken = clean(parsed.cloudflareConnectorToken);
    if (namedHostname) settings.namedHostname = namedHostname;
    if (cloudflareAccessClientId) settings.cloudflareAccessClientId = cloudflareAccessClientId;
    if (cloudflareAccessClientSecret) settings.cloudflareAccessClientSecret = cloudflareAccessClientSecret;
    if (cloudflareConnectorToken) settings.cloudflareConnectorToken = cloudflareConnectorToken;
    // Booleans must be read on `typeof === "boolean"`, not truthiness — `false`
    // is a real, meaningful value here (the toggle is off), not "unset".
    if (typeof parsed.tailscaleEnabled === "boolean") settings.tailscaleEnabled = parsed.tailscaleEnabled;
    if (typeof parsed.cloudflareEnabled === "boolean") settings.cloudflareEnabled = parsed.cloudflareEnabled;
    return settings;
  } catch {
    return {};
  }
}

export function saveRemoteAccessSettings(next: RemoteAccessSettings): RemoteAccessSettings {
  const settings: RemoteAccessSettings = {};
  const namedHostname = normalizePublicUrl(next.namedHostname);
  const cloudflareAccessClientId = clean(next.cloudflareAccessClientId);
  const cloudflareAccessClientSecret = clean(next.cloudflareAccessClientSecret);
  const cloudflareConnectorToken = clean(next.cloudflareConnectorToken);
  if (namedHostname) settings.namedHostname = namedHostname;
  if (cloudflareAccessClientId) settings.cloudflareAccessClientId = cloudflareAccessClientId;
  if (cloudflareAccessClientSecret) settings.cloudflareAccessClientSecret = cloudflareAccessClientSecret;
  if (cloudflareConnectorToken) settings.cloudflareConnectorToken = cloudflareConnectorToken;
  // Same truthiness trap as above: `false` must survive the copy.
  if (typeof next.tailscaleEnabled === "boolean") settings.tailscaleEnabled = next.tailscaleEnabled;
  if (typeof next.cloudflareEnabled === "boolean") settings.cloudflareEnabled = next.cloudflareEnabled;
  writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(settingsPath(), 0o600); } catch { /* best effort */ }
  return settings;
}

export function mergeRemoteAccessSettings(next: RemoteAccessSettings): RemoteAccessSettings {
  return saveRemoteAccessSettings({ ...readRemoteAccessSettings(), ...next });
}
