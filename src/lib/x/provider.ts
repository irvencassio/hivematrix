/**
 * X (Twitter) posting via API v2. Outward-facing + irreversible, so per the
 * "approve by text before posting" rule this is OPERATOR/APPROVAL-triggered (the
 * daemon endpoint), not a free agent tool. Keys via env vars; self-gates to null
 * when absent. Posts only — never reads DMs or acts beyond creating tweets.
 */

import { randomBytes } from "crypto";
import { buildOAuthHeader, type OAuth1Creds } from "./oauth";
import { resolveSecret } from "@/lib/config/secrets";
import type { VaultRef } from "@/lib/vault/refs";

const TWEETS_URL = "https://api.twitter.com/2/tweets";

export function getXCreds(env: NodeJS.ProcessEnv = process.env): OAuth1Creds | null {
  const consumerKey = env.X_API_KEY?.trim();
  const consumerSecret = env.X_API_SECRET?.trim();
  const accessToken = env.X_ACCESS_TOKEN?.trim();
  const accessSecret = env.X_ACCESS_SECRET?.trim();
  if (consumerKey && consumerSecret && accessToken && accessSecret) {
    return { consumerKey, consumerSecret, accessToken, accessSecret };
  }
  return null;
}

export function isXConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getXCreds(env) !== null;
}

/** Vault-aware credential resolution: env first, then vault://env/* refs. */
export async function resolveXCreds(
  opts: {
    env?: NodeJS.ProcessEnv;
    resolveRef?: (ref: VaultRef) => Promise<string>;
  } = {},
): Promise<OAuth1Creds | null> {
  const [consumerKey, consumerSecret, accessToken, accessSecret] = await Promise.all([
    resolveSecret("X_API_KEY", opts),
    resolveSecret("X_API_SECRET", opts),
    resolveSecret("X_ACCESS_TOKEN", opts),
    resolveSecret("X_ACCESS_SECRET", opts),
  ]);
  if (consumerKey && consumerSecret && accessToken && accessSecret) {
    return { consumerKey, consumerSecret, accessToken, accessSecret };
  }
  return null;
}

export interface PostTweetResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface PostTweetOpts {
  replyToId?: string;
  creds?: OAuth1Creds;
  nonce?: string;
  timestamp?: string;
}

export async function postTweet(text: string, opts: PostTweetOpts = {}): Promise<PostTweetResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: "tweet text is required" };
  const creds = opts.creds ?? await resolveXCreds();
  if (!creds) return { ok: false, error: "X keys not set (X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET)" };

  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const auth = buildOAuthHeader("POST", TWEETS_URL, creds, { nonce, timestamp });

  const payload: Record<string, unknown> = { text: body };
  if (opts.replyToId) payload.reply = { in_reply_to_tweet_id: opts.replyToId };

  try {
    const res = await fetch(TWEETS_URL, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    return { ok: true, id: data?.data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PostThreadResult {
  ok: boolean;
  ids: string[];
  error?: string;
}

/** Post a thread: each tweet replies to the previous. Stops on the first failure. */
export async function postThread(tweets: string[]): Promise<PostThreadResult> {
  const ids: string[] = [];
  let replyToId: string | undefined;
  for (const t of tweets) {
    const r = await postTweet(t, { replyToId });
    if (!r.ok || !r.id) return { ok: false, ids, error: r.error ?? "no id returned" };
    ids.push(r.id);
    replyToId = r.id;
  }
  return { ok: true, ids };
}
