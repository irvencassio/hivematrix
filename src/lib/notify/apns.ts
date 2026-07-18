/**
 * Native iOS push via Apple Push Notification service (APNs), HTTP/2 + token
 * (.p8) auth — zero external deps (node:crypto signs the ES256 provider JWT,
 * node:http2 delivers). This is the only true "push to the lock screen" path;
 * notify() (iMessage/Telegram/email) is the fallback fan-out.
 *
 * Config (`~/.hivematrix/config.json`):
 *   apns: {
 *     keyId, teamId, bundleId,          // from the Apple Developer portal
 *     key | keyPath,                    // the .p8 auth key (inline PEM or a path)
 *     production?: boolean,             // default env for devices that don't pin one
 *     devices: [{ token, env?, platform?, registeredAt }]
 *   }
 *
 * The iOS app registers its device token via POST /devices/register; the morning
 * briefing loop calls sendApnsPush() to reach it.
 */

import { createPrivateKey, sign as cryptoSign } from "crypto";
import { readFileSync } from "fs";
import { connect as http2Connect } from "http2";
import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";

const PROD_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
// Apple rejects provider tokens older than 1h and throttles refresh under 20m.
const JWT_TTL_MS = 50 * 60 * 1000;

export type ApnsEnv = "production" | "sandbox";

export interface ApnsCredentials {
  keyId: string;
  teamId: string;
  bundleId: string;
  key: string; // .p8 PEM contents
}

export interface ApnsConfig extends ApnsCredentials {
  production: boolean;
}

export interface ApnsDevice {
  token: string;
  env?: ApnsEnv;
  platform?: string;
  registeredAt?: string;
}

export interface ApnsPushOptions {
  title: string;
  body: string;
  /** Custom data merged into the payload (read by the app on tap). */
  data?: Record<string, unknown>;
  /** Override the device list (default: every registered device). */
  devices?: ApnsDevice[];
}

export interface ApnsDeviceResult {
  token: string;
  ok: boolean;
  status: number;
  reason?: string;
}

export interface ApnsPushResult {
  configured: boolean;
  sent: number;
  results: ApnsDeviceResult[];
}

// ---------------------------------------------------------------------------
// Config + device registry (config.json)
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Pure: validate + normalize the apns config block. Returns null if unusable. */
export function parseApnsConfig(input: unknown, readKeyFile: (path: string) => string = (p) => readFileSync(p, "utf-8")): ApnsConfig | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const keyId = str(obj.keyId);
  const teamId = str(obj.teamId);
  const bundleId = str(obj.bundleId);
  let key = str(obj.key);
  if (!key && str(obj.keyPath)) {
    try { key = readKeyFile(str(obj.keyPath)); } catch { return null; }
  }
  if (!keyId || !teamId || !bundleId || !key) return null;
  return { keyId, teamId, bundleId, key, production: obj.production === true };
}

/** Pure: normalize the stored device list (dedup by token, drop blanks). */
export function parseApnsDevices(input: unknown): ApnsDevice[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ApnsDevice[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const token = str((raw as Record<string, unknown>).token);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    const env = (raw as Record<string, unknown>).env;
    out.push({
      token,
      env: env === "production" || env === "sandbox" ? env : undefined,
      platform: str((raw as Record<string, unknown>).platform) || undefined,
      registeredAt: str((raw as Record<string, unknown>).registeredAt) || undefined,
    });
  }
  return out;
}

/** Pure: merge a newly-registered device into the list (upsert by token). */
export function upsertDevice(devices: ApnsDevice[], device: ApnsDevice): ApnsDevice[] {
  const token = str(device.token);
  if (!token) return devices;
  const rest = devices.filter((d) => d.token !== token);
  return [...rest, { ...device, token }];
}

export function getApnsConfig(): ApnsConfig | null {
  return parseApnsConfig(loadHiveConfig().apns);
}

export function listApnsDevices(): ApnsDevice[] {
  const apns = loadHiveConfig().apns as Record<string, unknown> | undefined;
  return parseApnsDevices(apns?.devices);
}

export function registerApnsDevice(device: ApnsDevice): ApnsDevice[] {
  const config = loadHiveConfig();
  const apns = (config.apns && typeof config.apns === "object" ? config.apns : {}) as Record<string, unknown>;
  const next = upsertDevice(parseApnsDevices(apns.devices), {
    ...device,
    registeredAt: device.registeredAt ?? new Date().toISOString(),
  });
  apns.devices = next;
  config.apns = apns;
  saveHiveConfig(config);
  return next;
}

export function unregisterApnsDevice(token: string): ApnsDevice[] {
  const config = loadHiveConfig();
  const apns = (config.apns && typeof config.apns === "object" ? config.apns : {}) as Record<string, unknown>;
  const next = parseApnsDevices(apns.devices).filter((d) => d.token !== str(token));
  apns.devices = next;
  config.apns = apns;
  saveHiveConfig(config);
  return next;
}

// ---------------------------------------------------------------------------
// Provider JWT (ES256)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Pure: build a signed APNs provider JWT (ES256) for the given second-resolution `nowSec`. */
export function buildApnsJwt(creds: ApnsCredentials, nowSec: number): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: creds.keyId })));
  const payload = base64url(Buffer.from(JSON.stringify({ iss: creds.teamId, iat: Math.floor(nowSec) })));
  const signingInput = `${header}.${payload}`;
  const privateKey = createPrivateKey(creds.key);
  const sig = cryptoSign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(sig)}`;
}

let _jwtCache: { jwt: string; at: number } | null = null;

function cachedJwt(creds: ApnsCredentials, now = Date.now()): string {
  if (_jwtCache && now - _jwtCache.at < JWT_TTL_MS) return _jwtCache.jwt;
  const jwt = buildApnsJwt(creds, now / 1000);
  _jwtCache = { jwt, at: now };
  return jwt;
}

/** Test seam: drop the cached provider JWT. */
export function _resetApnsJwtCache(): void {
  _jwtCache = null;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function hostFor(device: ApnsDevice, config: ApnsConfig): string {
  const env: ApnsEnv = device.env ?? (config.production ? "production" : "sandbox");
  return env === "production" ? PROD_HOST : SANDBOX_HOST;
}

/** Pure: group devices by the APNs host they should be delivered through. */
export function groupDevicesByHost(devices: ApnsDevice[], config: ApnsConfig): Map<string, ApnsDevice[]> {
  const groups = new Map<string, ApnsDevice[]>();
  for (const device of devices) {
    const host = hostFor(device, config);
    const list = groups.get(host) ?? [];
    list.push(device);
    groups.set(host, list);
  }
  return groups;
}

/**
 * Pure: the JSON payload body APNs expects for a simple alert push.
 *
 * `data.kind === "approval"` also sets the aps `category`, which is what makes
 * iOS render the Approve/Deny buttons on the notification (the app registers a
 * matching UNNotificationCategory with that id). Without the category the push
 * still arrives, but it is just text — the operator has to unlock, open the app
 * and find the queue, which defeats the point of pushing approvals at all.
 * data.taskId/timestamp ride along as top-level keys, which is where the app's
 * notification delegate reads them from to resolve without opening.
 */
export const APNS_APPROVAL_CATEGORY = "HM_APPROVAL";

export function buildApnsPayload(opts: Pick<ApnsPushOptions, "title" | "body" | "data">): string {
  const data = opts.data ?? {};
  const isApproval = data.kind === "approval";
  return JSON.stringify({
    aps: {
      alert: { title: opts.title, body: opts.body },
      sound: "default",
      ...(isApproval ? { category: APNS_APPROVAL_CATEGORY } : {}),
    },
    ...data,
  });
}

async function postToHost(host: string, jwt: string, topic: string, payload: string, devices: ApnsDevice[]): Promise<ApnsDeviceResult[]> {
  return new Promise((resolve) => {
    const session = http2Connect(host);
    const results: ApnsDeviceResult[] = [];
    let pending = devices.length;
    let settled = false;
    const finish = () => { if (!settled) { settled = true; try { session.close(); } catch { /* ignore */ } resolve(results); } };
    session.on("error", () => {
      for (const d of devices) results.push({ token: d.token, ok: false, status: 0, reason: "session error" });
      finish();
    });
    for (const device of devices) {
      const stream = session.request({
        ":method": "POST",
        ":path": `/3/device/${device.token}`,
        "authorization": `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "content-type": "application/json",
      });
      let status = 0;
      let data = "";
      stream.on("response", (headers) => { status = Number(headers[":status"]) || 0; });
      stream.setEncoding("utf-8");
      stream.on("data", (chunk) => { data += chunk; });
      stream.on("end", () => {
        let reason: string | undefined;
        if (status !== 200 && data) { try { reason = JSON.parse(data).reason; } catch { reason = data.slice(0, 120); } }
        results.push({ token: device.token, ok: status === 200, status, reason });
        if (--pending === 0) finish();
      });
      stream.on("error", () => {
        results.push({ token: device.token, ok: false, status: 0, reason: "stream error" });
        if (--pending === 0) finish();
      });
      stream.end(payload);
    }
    if (devices.length === 0) finish();
  });
}

/**
 * Send a push to the operator's registered iOS devices. No-op (configured:false)
 * when APNs isn't set up or no device has registered.
 */
export async function sendApnsPush(opts: ApnsPushOptions): Promise<ApnsPushResult> {
  const config = getApnsConfig();
  if (!config) return { configured: false, sent: 0, results: [] };
  const devices = opts.devices ?? listApnsDevices();
  if (devices.length === 0) return { configured: true, sent: 0, results: [] };

  const jwt = cachedJwt(config);
  const payload = buildApnsPayload(opts);
  const groups = groupDevicesByHost(devices, config);

  const batches = await Promise.all(
    [...groups.entries()].map(([host, list]) => postToHost(host, jwt, config.bundleId, payload, list)),
  );
  const results = batches.flat();
  return { configured: true, sent: results.filter((r) => r.ok).length, results };
}
