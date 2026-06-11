/**
 * Local shared-secret tokens for the loopback control surfaces.
 *
 * Tokens live in ~/.hivematrix/<name> (mode 600), created on first use. They
 * gate the daemon API and the daemon↔helper channel so a malicious web page
 * (which can't read a cross-origin response and thus can't learn the token)
 * cannot forge authenticated requests, and only the daemon — which holds the
 * helper token file — can drive the DesktopBee helper.
 */

import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function tokensDir(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read the token file `name`, creating a fresh 256-bit token if absent. */
export function getOrCreateToken(name: string): string {
  const path = join(tokensDir(), name);
  try {
    const existing = readFileSync(path, "utf-8").trim();
    if (existing) return existing;
  } catch { /* create below */ }
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return token;
}

/** Read a token file without creating it (null if absent). */
export function readToken(name: string): string | null {
  try {
    const t = readFileSync(join(tokensDir(), name), "utf-8").trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Constant-time-ish comparison to avoid trivial timing leaks. */
export function tokenEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const DAEMON_TOKEN_FILE = "auth-token";
export const HELPER_TOKEN_FILE = "desktopbee-token";
