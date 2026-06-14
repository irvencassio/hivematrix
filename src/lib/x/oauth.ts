/**
 * OAuth 1.0a request signing for the X (Twitter) API. Posting a tweet requires
 * user-context auth — an app-only bearer token can read but not post — so we sign
 * with the four user keys (consumer key/secret + access token/secret). Pure +
 * deterministic (nonce/timestamp injectable), so the signature is testable.
 *
 * For JSON-body POSTs (POST /2/tweets) the body is NOT part of the signature base
 * (only the oauth_* params), which this builder assumes.
 */

import { createHmac } from "crypto";

/** RFC-3986 percent-encoding (stricter than encodeURIComponent). */
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export interface OAuth1Creds {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** Build the `Authorization: OAuth ...` header for a request. */
export function buildOAuthHeader(
  method: string,
  url: string,
  creds: OAuth1Creds,
  opts: { nonce: string; timestamp: string },
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: opts.nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: opts.timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessSecret)}`;
  const signature = createHmac("sha1", signingKey).update(base).digest("base64");

  const all: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  return "OAuth " + Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(all[k])}"`)
    .join(", ");
}
