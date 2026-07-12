/**
 * Native Android (and web) push via Firebase Cloud Messaging (FCM HTTP v1),
 * OAuth2 service-account auth — zero external deps (node:crypto signs the
 * RS256 OAuth JWT, node:https delivers). notify() (iMessage/Telegram/email)
 * remains the fallback fan-out; this is the "push to the lock screen" path
 * for Android.
 *
 * Config (`~/.hivematrix/config.json`):
 *   fcm: {
 *     serviceAccountPath?: string,       // path to a Google service-account JSON
 *     serviceAccount?: {...},            // ...or the JSON inline
 *     devices: [{ token, platform?, registeredAt }]
 *   }
 *
 * The Android app registers its device token via POST /devices/register; the
 * morning briefing loop calls sendFcmPush() to reach it.
 */

import { createPrivateKey, sign as cryptoSign } from "crypto";
import { readFileSync } from "fs";
import { request as httpsRequest } from "https";
import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";

const FCM_SEND_HOST = "fcm.googleapis.com";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
// Google access tokens last 1h; refresh a bit early like APNs' provider JWT.
const TOKEN_TTL_MS = 50 * 60 * 1000;

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string; // RSA PEM contents
  tokenUri: string;
}

export type FcmConfig = FcmCredentials;

export interface FcmDevice {
  token: string;
  platform?: string;
  registeredAt?: string;
}

export interface FcmPushOptions {
  title: string;
  body: string;
  /** Custom data merged into the payload (read by the app on tap). FCM requires string values. */
  data?: Record<string, unknown>;
  /** Override the device list (default: every registered device). */
  devices?: FcmDevice[];
}

export interface FcmDeviceResult {
  token: string;
  ok: boolean;
  status: number;
  reason?: string;
}

export interface FcmPushResult {
  configured: boolean;
  sent: number;
  results: FcmDeviceResult[];
}

// ---------------------------------------------------------------------------
// Config + device registry (config.json)
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Pure: validate + normalize the fcm config block. Returns null if unusable. */
export function parseFcmConfig(input: unknown, readKeyFile: (path: string) => string = (p) => readFileSync(p, "utf-8")): FcmConfig | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  let account: Record<string, unknown> | null = null;
  if (obj.serviceAccount && typeof obj.serviceAccount === "object") {
    account = obj.serviceAccount as Record<string, unknown>;
  } else if (str(obj.serviceAccountPath)) {
    try {
      account = JSON.parse(readKeyFile(str(obj.serviceAccountPath))) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (!account) return null;

  const projectId = str(account.project_id);
  const clientEmail = str(account.client_email);
  const privateKey = str(account.private_key);
  const tokenUri = str(account.token_uri) || DEFAULT_TOKEN_URI;
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey, tokenUri };
}

/** Pure: normalize the stored device list (dedup by token, drop blanks). */
export function parseFcmDevices(input: unknown): FcmDevice[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: FcmDevice[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const token = str((raw as Record<string, unknown>).token);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push({
      token,
      platform: str((raw as Record<string, unknown>).platform) || undefined,
      registeredAt: str((raw as Record<string, unknown>).registeredAt) || undefined,
    });
  }
  return out;
}

/** Pure: merge a newly-registered device into the list (upsert by token). */
export function upsertFcmDevice(devices: FcmDevice[], device: FcmDevice): FcmDevice[] {
  const token = str(device.token);
  if (!token) return devices;
  const rest = devices.filter((d) => d.token !== token);
  return [...rest, { ...device, token }];
}

export function getFcmConfig(): FcmConfig | null {
  return parseFcmConfig(loadHiveConfig().fcm);
}

export function listFcmDevices(): FcmDevice[] {
  const fcm = loadHiveConfig().fcm as Record<string, unknown> | undefined;
  return parseFcmDevices(fcm?.devices);
}

export function registerFcmDevice(device: FcmDevice): FcmDevice[] {
  const config = loadHiveConfig();
  const fcm = (config.fcm && typeof config.fcm === "object" ? config.fcm : {}) as Record<string, unknown>;
  const next = upsertFcmDevice(parseFcmDevices(fcm.devices), {
    ...device,
    registeredAt: device.registeredAt ?? new Date().toISOString(),
  });
  fcm.devices = next;
  config.fcm = fcm;
  saveHiveConfig(config);
  return next;
}

export function unregisterFcmDevice(token: string): FcmDevice[] {
  const config = loadHiveConfig();
  const fcm = (config.fcm && typeof config.fcm === "object" ? config.fcm : {}) as Record<string, unknown>;
  const next = parseFcmDevices(fcm.devices).filter((d) => d.token !== str(token));
  fcm.devices = next;
  config.fcm = fcm;
  saveHiveConfig(config);
  return next;
}

// ---------------------------------------------------------------------------
// OAuth2 access token (RS256 JWT-bearer grant)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Pure: build a signed OAuth2 JWT-bearer assertion (RS256) for the given second-resolution `nowSec`. */
export function buildFcmJwt(creds: FcmCredentials, nowSec: number): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(Buffer.from(JSON.stringify({
    iss: creds.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: creds.tokenUri,
    iat: Math.floor(nowSec),
    exp: Math.floor(nowSec) + 3600,
  })));
  const signingInput = `${header}.${payload}`;
  const privateKey = createPrivateKey(creds.privateKey);
  const sig = cryptoSign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64url(sig)}`;
}

function postForm(url: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpsRequest({
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function exchangeForAccessToken(creds: FcmCredentials, jwt: string): Promise<string> {
  const body = `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`;
  const { status, body: resBody } = await postForm(creds.tokenUri, body);
  if (status !== 200) throw new Error(`token exchange failed (${status}): ${resBody.slice(0, 200)}`);
  const parsed = JSON.parse(resBody) as { access_token?: string };
  if (!parsed.access_token) throw new Error("token exchange response missing access_token");
  return parsed.access_token;
}

let _tokenCache: { token: string; at: number } | null = null;

async function cachedAccessToken(creds: FcmCredentials, now = Date.now()): Promise<string> {
  if (_tokenCache && now - _tokenCache.at < TOKEN_TTL_MS) return _tokenCache.token;
  const jwt = buildFcmJwt(creds, now / 1000);
  const token = await exchangeForAccessToken(creds, jwt);
  _tokenCache = { token, at: now };
  return token;
}

/** Test seam: drop the cached OAuth2 access token. */
export function _resetFcmTokenCache(): void {
  _tokenCache = null;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function stringifyDataValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Pure: the JSON request body FCM HTTP v1 expects for a single-token send. */
export function buildFcmMessage(deviceToken: string, opts: Pick<FcmPushOptions, "title" | "body" | "data">): string {
  const data: Record<string, string> = {};
  if (opts.data) {
    for (const [key, value] of Object.entries(opts.data)) data[key] = stringifyDataValue(value);
  }
  return JSON.stringify({
    message: {
      token: deviceToken,
      notification: { title: opts.title, body: opts.body },
      ...(Object.keys(data).length > 0 ? { data } : {}),
    },
  });
}

async function postMessage(projectId: string, accessToken: string, device: FcmDevice, payload: string): Promise<FcmDeviceResult> {
  return new Promise((resolve) => {
    const req = httpsRequest({
      hostname: FCM_SEND_HOST,
      path: `/v1/projects/${projectId}/messages:send`,
      method: "POST",
      headers: {
        "authorization": `Bearer ${accessToken}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      let data = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let reason: string | undefined;
        if (status !== 200 && data) {
          try {
            const parsed = JSON.parse(data);
            reason = parsed?.error?.message ?? parsed?.error?.status ?? data.slice(0, 120);
          } catch {
            reason = data.slice(0, 120);
          }
        }
        resolve({ token: device.token, ok: status === 200, status, reason });
      });
    });
    req.on("error", (err) => {
      resolve({ token: device.token, ok: false, status: 0, reason: err instanceof Error ? err.message : "request error" });
    });
    req.end(payload);
  });
}

/**
 * Send a push to the operator's registered Android devices. No-op (configured:false)
 * when FCM isn't set up or no device has registered.
 */
export async function sendFcmPush(opts: FcmPushOptions): Promise<FcmPushResult> {
  const config = getFcmConfig();
  if (!config) return { configured: false, sent: 0, results: [] };
  const devices = opts.devices ?? listFcmDevices();
  if (devices.length === 0) return { configured: true, sent: 0, results: [] };

  let accessToken: string;
  try {
    accessToken = await cachedAccessToken(config);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "auth error";
    return { configured: true, sent: 0, results: devices.map((d) => ({ token: d.token, ok: false, status: 0, reason })) };
  }

  const results = await Promise.all(
    devices.map((device) => postMessage(config.projectId, accessToken, device, buildFcmMessage(device.token, opts))),
  );
  return { configured: true, sent: results.filter((r) => r.ok).length, results };
}
