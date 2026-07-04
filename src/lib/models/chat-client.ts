/**
 * Keyless, local-only completion client.
 *
 * HARD CONSTRAINT (operator policy): NO cloud LLM API keys, ever — no Anthropic
 * key, no OpenAI/ChatGPT key. The only backend is a local Qwen/DeepSeek model
 * over LM Studio HTTP on loopback (keyless). Claude/Anthropic is intentionally
 * not invoked, and no request ever leaves the machine.
 *
 * The HTTP `fetch` is injectable so unit tests touch neither the network nor a
 * real model.
 *
 * See docs/superpowers/specs/2026-06-27-model-advised-decomposition-design.md.
 */

import { getQwenProfile, isQwenEndpointLocal } from "@/lib/config/qwen-profile";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  model?: string;
  endpoint?: string;
  /**
   * DeepSeek/DwarfStar reasoning tier. The server defaults to high-effort
   * thinking; a lighter value cuts <think> tokens (and latency) for mechanical
   * calls. Ignored by backends that don't honor the field.
   */
  reasoningEffort?: "low" | "medium" | "high" | "max";
  fetchImpl?: typeof fetch;
}

export type ChatComplete = (messages: ChatMessage[], opts?: ChatOpts) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 12_000;

function normalizeBaseUrl(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}
function candidateUrls(endpoint: string, path: string): string[] {
  const base = normalizeBaseUrl(endpoint);
  const urls = [`${base}/${path}`];
  if (!base.endsWith("/v1")) urls.push(`${base}/v1/${path}`);
  return urls;
}

/** Local Qwen via LM Studio /chat/completions. Keyless. Tries /chat then /v1/chat. */
export async function localChatComplete(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const profile = getQwenProfile();
  const endpoint = opts.endpoint ?? profile?.primary.endpoint;
  const model = opts.model ?? profile?.primary.modelId;
  if (!endpoint || !model) throw new Error("local model not configured (no qwen profile / endpoint)");
  const doFetch = opts.fetchImpl ?? fetch;
  const body = JSON.stringify({
    model,
    messages,
    stream: false,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
  });

  let lastErr: unknown = null;
  for (const url of candidateUrls(endpoint, "chat/completions")) {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (res.status === 404) { lastErr = new Error("404"); continue; } // try the next candidate URL
      if (!res.ok) throw new Error(`local model HTTP ${res.status}`);
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("local model returned no content");
      return content;
    } catch (e) {
      lastErr = e;
      // On an abort/timeout or a real HTTP error, don't keep trying URLs.
      if (e instanceof Error && /HTTP \d|content/.test(e.message)) throw e;
    }
  }
  throw new Error(`local model completion failed: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/**
 * Resolve the keyless local completion backend (local Qwen/DeepSeek over HTTP).
 * Returns null when no model is configured — the caller then uses the
 * deterministic regex split. Local-only: there is no cloud fallback.
 */
export function resolveCompletionClient(): ChatComplete | null {
  if (!getQwenProfile()) return null;
  return (messages, opts) => localChatComplete(messages, opts);
}

/**
 * True when a local, loopback-served completion model (e.g. DeepSeek/DwarfStar on
 * 127.0.0.1) is configured. Such a backend is keyless, free, and reachable even
 * fully offline — callers use this to decide whether model-advised work (goal
 * decomposition) may run.
 */
export function hasLocalCompletionModel(): boolean {
  const profile = getQwenProfile();
  if (!profile) return false;
  return isQwenEndpointLocal(profile.primary.endpoint);
}
