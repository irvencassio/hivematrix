/**
 * Embedding provider — local-first. Calls an OpenAI-compatible `/v1/embeddings`
 * endpoint, which the existing mlx/llama.cpp serving stack exposes, so embeddings
 * work in every connectivity mode and no brain-doc content leaves the box. A cloud
 * endpoint is configurable but not the default. Self-gates: returns null when
 * unconfigured or on any error, so every caller falls back to keyword retrieval.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { readToken } from "@/lib/auth/token";

export interface EmbeddingsConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  provider: string;
  pollIntervalMinutes: number;
}

// Defaults aligned with Brainpower's existing pipeline so the two systems share
// ONE embedding model over the shared brain (Brainpower uses qwen3-embedding:8b-q8_0
// via Ollama). Enabling embeddings with just {enabled:true} matches Brainpower.
const DEFAULT_EMBEDDINGS_ENDPOINT = "http://localhost:11434/v1";
const DEFAULT_EMBEDDINGS_MODEL = "qwen3-embedding:8b-q8_0";

export function getEmbeddingsConfig(): EmbeddingsConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const e = cfg?.embeddings;
    if (!e || typeof e !== "object") return null;
    return {
      enabled: e.enabled === true,
      endpoint: typeof e.endpoint === "string" && e.endpoint.trim() ? e.endpoint.trim() : DEFAULT_EMBEDDINGS_ENDPOINT,
      model: typeof e.model === "string" && e.model.trim() ? e.model.trim() : DEFAULT_EMBEDDINGS_MODEL,
      provider: typeof e.provider === "string" ? e.provider.trim() : "local",
      pollIntervalMinutes: typeof e.pollIntervalMinutes === "number" && e.pollIntervalMinutes > 0 ? e.pollIntervalMinutes : 60,
    };
  } catch {
    return null;
  }
}

export function isEmbeddingsEnabled(): boolean {
  const c = getEmbeddingsConfig();
  return !!c && c.enabled && !!c.endpoint && !!c.model;
}

/** The embeddings URL for an endpoint base (mirrors the chat-completions logic). */
export function embeddingsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/embeddings` : `${base}/v1/embeddings`;
}

interface EmbeddingsResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
}

/**
 * Embed a batch of texts → one vector each (aligned to input order), or null on
 * disabled/unreachable/malformed. Never throws.
 */
export async function embedTexts(texts: string[], opts: { signal?: AbortSignal } = {}): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const cfg = getEmbeddingsConfig();
  if (!cfg || !cfg.enabled || !cfg.endpoint || !cfg.model) return null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // A cloud provider may need an api key; reuse the loopback token only for local.
  const apiKey = readToken("embeddings-api-key");
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(embeddingsUrl(cfg.endpoint), {
      method: "POST",
      headers,
      body: JSON.stringify({ model: cfg.model, input: texts }),
      signal: opts.signal ?? AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as EmbeddingsResponse;
    if (!Array.isArray(data.data)) return null;
    // Order by index defensively, then map to vectors. Bail if any are missing.
    const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = sorted.map((d) => d.embedding).filter((v): v is number[] => Array.isArray(v));
    return vectors.length === texts.length ? vectors : null;
  } catch {
    return null;
  }
}

/** Convenience: embed a single text → one vector, or null. */
export async function embedOne(text: string, opts: { signal?: AbortSignal } = {}): Promise<number[] | null> {
  const v = await embedTexts([text], opts);
  return v && v.length === 1 ? v[0] : null;
}
