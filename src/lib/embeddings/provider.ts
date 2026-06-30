/**
 * Embedding provider — local-first. Calls an OpenAI-compatible `/v1/embeddings`
 * endpoint, which the existing mlx/llama.cpp serving stack exposes, so embeddings
 * work in every connectivity mode and no brain-doc content leaves the box. A cloud
 * endpoint is configurable but not the default. Self-gates: returns null when
 * unconfigured or on any error, so every caller falls back to keyword retrieval.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { readToken } from "@/lib/auth/token";

export interface IndexConfig {
  driver: "sqlite";
  path: string;               // "~"-prefixed OK; callers must expand via indexDbPath()
  chunkWords: number;         // target chunk size in words (default 500)
  chunkOverlapWords: number;  // overlap between adjacent chunks (default 100)
}

export interface HybridConfig {
  enabled: boolean;
  textWeight: number;           // BM25 weight (default 0.45)
  vectorWeight: number;         // cosine weight (default 0.55)
  candidateMultiplier: number;  // oversample factor before reranking (default 4)
}

export interface MmrConfig {
  enabled: boolean;
  lambda: number; // relevance vs. diversity balance in [0, 1]; 1.0 = pure relevance (default 0.7)
}

export interface TemporalDecayConfig {
  enabled: boolean;
  halfLifeDays: number; // decay half-life for dated operational docs (default 30)
}

export interface EmbeddingsConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  provider: string;
  pollIntervalMinutes: number;
  index?: IndexConfig;
  hybrid?: HybridConfig;
  mmr?: MmrConfig;
  temporalDecay?: TemporalDecayConfig;
}

export interface EmbeddingModelChoice {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  provider: string;
  note?: string;
}

// Defaults aligned with Brainpower's existing pipeline so the two systems share
// ONE embedding model over the shared brain (Brainpower uses qwen3-embedding:8b-q8_0
// via Ollama). Enabling embeddings with just {enabled:true} matches Brainpower.
const DEFAULT_EMBEDDINGS_ENDPOINT = "http://localhost:11434/v1";
const DEFAULT_EMBEDDINGS_MODEL = "qwen3-embedding:8b-q8_0";
const DEFAULT_EMBEDDINGS_PROVIDER = "local";
const DEFAULT_POLL_INTERVAL_MINUTES = 60;

const DEFAULT_INDEX_PATH = "~/.hivematrix/brain-index.sqlite";
const DEFAULT_CHUNK_WORDS = 500;
const DEFAULT_CHUNK_OVERLAP_WORDS = 100;
const DEFAULT_HYBRID_TEXT_WEIGHT = 0.45;
const DEFAULT_HYBRID_VECTOR_WEIGHT = 0.55;
const DEFAULT_HYBRID_CANDIDATE_MULTIPLIER = 4;
const DEFAULT_MMR_LAMBDA = 0.7;
const DEFAULT_TEMPORAL_HALF_LIFE_DAYS = 30;

export const RAPID_MLX_QWEN3_EMBEDDING_ENDPOINT = "http://localhost:8002/v1";
export const RAPID_MLX_QWEN3_EMBEDDING_MODEL = "mlx-community/Qwen3-Embedding-8B-4bit-DWQ";

function configPath(): string {
  return join(homedir(), ".hivematrix", "config.json");
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configPath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeConfig(cfg: Record<string, unknown>): void {
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function normalizeIndexConfig(raw: unknown): IndexConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<IndexConfig>;
  return {
    driver: "sqlite",
    path: typeof r.path === "string" && r.path.trim() ? r.path.trim() : DEFAULT_INDEX_PATH,
    chunkWords: typeof r.chunkWords === "number" && r.chunkWords > 0 ? Math.round(r.chunkWords) : DEFAULT_CHUNK_WORDS,
    chunkOverlapWords: typeof r.chunkOverlapWords === "number" && r.chunkOverlapWords >= 0 ? Math.round(r.chunkOverlapWords) : DEFAULT_CHUNK_OVERLAP_WORDS,
  };
}

function normalizeHybridConfig(raw: unknown): HybridConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<HybridConfig>;
  return {
    enabled: r.enabled !== false,
    textWeight: typeof r.textWeight === "number" ? r.textWeight : DEFAULT_HYBRID_TEXT_WEIGHT,
    vectorWeight: typeof r.vectorWeight === "number" ? r.vectorWeight : DEFAULT_HYBRID_VECTOR_WEIGHT,
    candidateMultiplier: typeof r.candidateMultiplier === "number" && r.candidateMultiplier > 0
      ? Math.round(r.candidateMultiplier)
      : DEFAULT_HYBRID_CANDIDATE_MULTIPLIER,
  };
}

function normalizeMmrConfig(raw: unknown): MmrConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<MmrConfig>;
  return {
    enabled: r.enabled !== false,
    lambda: typeof r.lambda === "number" ? Math.min(1, Math.max(0, r.lambda)) : DEFAULT_MMR_LAMBDA,
  };
}

function normalizeTemporalDecayConfig(raw: unknown): TemporalDecayConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<TemporalDecayConfig>;
  return {
    enabled: r.enabled === true,
    halfLifeDays: typeof r.halfLifeDays === "number" && r.halfLifeDays > 0 ? r.halfLifeDays : DEFAULT_TEMPORAL_HALF_LIFE_DAYS,
  };
}

function normalizeEmbeddingsConfig(raw: Partial<EmbeddingsConfig> = {}): EmbeddingsConfig {
  const poll = typeof raw.pollIntervalMinutes === "number" && raw.pollIntervalMinutes > 0
    ? Math.max(1, Math.round(raw.pollIntervalMinutes))
    : DEFAULT_POLL_INTERVAL_MINUTES;
  const endpoint = typeof raw.endpoint === "string" && raw.endpoint.trim()
    ? raw.endpoint.trim().replace(/\/+$/, "")
    : DEFAULT_EMBEDDINGS_ENDPOINT;
  const cfg: EmbeddingsConfig = {
    enabled: raw.enabled === true,
    endpoint,
    model: typeof raw.model === "string" && raw.model.trim()
      ? raw.model.trim()
      : DEFAULT_EMBEDDINGS_MODEL,
    provider: typeof raw.provider === "string" && raw.provider.trim()
      ? raw.provider.trim()
      : DEFAULT_EMBEDDINGS_PROVIDER,
    pollIntervalMinutes: poll,
  };
  const rawAny = raw as Record<string, unknown>;
  const index = normalizeIndexConfig(rawAny.index);
  if (index !== undefined) cfg.index = index;
  const hybrid = normalizeHybridConfig(rawAny.hybrid);
  if (hybrid !== undefined) cfg.hybrid = hybrid;
  const mmr = normalizeMmrConfig(rawAny.mmr);
  if (mmr !== undefined) cfg.mmr = mmr;
  const temporalDecay = normalizeTemporalDecayConfig(rawAny.temporalDecay);
  if (temporalDecay !== undefined) cfg.temporalDecay = temporalDecay;
  return cfg;
}

export function embeddingModelChoices(): EmbeddingModelChoice[] {
  return [
    {
      id: "rapid-mlx-qwen3-8b",
      name: "Rapid-MLX Qwen3 Embedding 8B",
      endpoint: RAPID_MLX_QWEN3_EMBEDDING_ENDPOINT,
      model: RAPID_MLX_QWEN3_EMBEDDING_MODEL,
      provider: "rapid-mlx",
      note: "recommended local quality preset",
    },
    {
      id: "brainpower-ollama-qwen3-8b",
      name: "Brainpower / Ollama Qwen3 Embedding 8B",
      endpoint: DEFAULT_EMBEDDINGS_ENDPOINT,
      model: DEFAULT_EMBEDDINGS_MODEL,
      provider: "ollama",
      note: "legacy shared Brainpower default",
    },
  ];
}

export function getEmbeddingsConfig(): EmbeddingsConfig | null {
  try {
    const cfg = readConfig();
    const e = cfg?.embeddings;
    if (!e || typeof e !== "object") return null;
    return normalizeEmbeddingsConfig(e as Partial<EmbeddingsConfig>);
  } catch {
    return null;
  }
}

export function setEmbeddingsConfig(next: Partial<EmbeddingsConfig>): EmbeddingsConfig {
  const cfg = readConfig();
  const current = cfg.embeddings && typeof cfg.embeddings === "object"
    ? cfg.embeddings as Partial<EmbeddingsConfig>
    : {};
  const embeddings = normalizeEmbeddingsConfig({ ...current, ...next });
  cfg.embeddings = embeddings;
  writeConfig(cfg);
  return embeddings;
}

export function isEmbeddingsEnabled(): boolean {
  const c = getEmbeddingsConfig();
  return !!c && c.enabled && !!c.endpoint && !!c.model;
}

/** Resolve the brain index SQLite path, expanding `~` to the home directory. */
export function indexDbPath(cfg?: EmbeddingsConfig | null): string {
  const raw = cfg?.index?.path ?? getEmbeddingsConfig()?.index?.path ?? DEFAULT_INDEX_PATH;
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return raw;
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
