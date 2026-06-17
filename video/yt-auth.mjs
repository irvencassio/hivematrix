/**
 * Shared YouTube OAuth for the video factory (publish + analytics). One token
 * cached at ~/.hivematrix/youtube/token.json, but different scripts need
 * different scopes (upload vs read/analytics). getAuth() re-authorizes only when
 * the cached token is missing a scope the caller needs — so adding analytics
 * never breaks the existing upload flow, and a single browser consent can cover
 * both going forward.
 *
 * One-time setup: Google Cloud → enable "YouTube Data API v3" (+ "YouTube
 * Analytics API" for retention), create an OAuth "Desktop app" client, save its
 * JSON to ~/.hivematrix/youtube/client_secret.json.
 */
import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { YT_DIR, CREDS, TOKEN } from "./yt-paths.mjs";

export const SCOPE_UPLOAD = "https://www.googleapis.com/auth/youtube.upload";
export const SCOPE_READONLY = "https://www.googleapis.com/auth/youtube.readonly";
export const SCOPE_ANALYTICS = "https://www.googleapis.com/auth/yt-analytics.readonly";

/** True when the cached token's granted scopes cover every required scope. */
export function tokenCoversScopes(token, required) {
  const granted = new Set(String(token?.scope ?? "").split(/\s+/).filter(Boolean));
  return required.every((s) => granted.has(s));
}

/**
 * OAuth2 client authorized for at least `required` scopes. Reuses the cached
 * token when it already covers them; otherwise runs the browser consent for the
 * UNION of what's cached and what's needed (so we never drop a previously-granted
 * scope) and rewrites the token.
 */
export async function getAuth(required) {
  mkdirSync(YT_DIR, { recursive: true });
  if (!existsSync(CREDS)) {
    console.error(`Missing ${CREDS}\nSet up a Google OAuth "Desktop app" client (YouTube Data API v3) and save its JSON there.`);
    process.exit(1);
  }
  const keys = JSON.parse(readFileSync(CREDS, "utf-8"));
  const { client_id, client_secret, redirect_uris } = keys.installed || keys.web;

  if (existsSync(TOKEN)) {
    const token = JSON.parse(readFileSync(TOKEN, "utf-8"));
    if (tokenCoversScopes(token, required)) {
      const o = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0]);
      o.setCredentials(token);
      return o;
    }
    // Cached token is missing a needed scope — re-consent for the union.
    const have = String(token.scope ?? "").split(/\s+/).filter(Boolean);
    required = [...new Set([...have, ...required])];
    console.error("→ additional YouTube permission needed; re-authorizing in the browser…");
  }
  const client = await authenticate({ scopes: required, keyfilePath: CREDS });
  if (client.credentials) writeFileSync(TOKEN, JSON.stringify(client.credentials));
  return client;
}
