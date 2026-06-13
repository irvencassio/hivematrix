/**
 * Content rendition backend: an OpenAI-chat-compatible completion, configured
 * the same way image-gen's nanai endpoint is (config.content.{endpoint,model,
 * apiKeyEnv}). Returns an honest "not configured" result when absent, so the
 * pipeline degrades gracefully exactly like W5.1 image generation. fetch is
 * injectable for tests.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface ContentRenderResult {
  ok: boolean;
  text: string;
  detail: string;
}

interface ContentEndpointConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

function readContentConfig(): ContentEndpointConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const c = cfg?.content ?? {};
    const endpoint = typeof c.endpoint === "string" ? c.endpoint : "";
    const apiKey = (typeof c.apiKeyEnv === "string" ? process.env[c.apiKeyEnv] : undefined) ?? process.env.OPENAI_API_KEY ?? "";
    const model = typeof c.model === "string" ? c.model : "gpt-4o-mini";
    if (!endpoint || !apiKey) return null;
    return { endpoint, apiKey, model };
  } catch {
    return null;
  }
}

export async function renderViaCompletion(prompt: string, fetchImpl: typeof fetch = fetch): Promise<ContentRenderResult> {
  const cfg = readContentConfig();
  if (!cfg) return { ok: false, text: "", detail: "content endpoint not configured (config.content.endpoint + key)" };
  try {
    const base = cfg.endpoint.replace(/\/+$/, "");
    const url = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { ok: false, text: "", detail: `content endpoint HTTP ${res.status}` };
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false, text: "", detail: "no content returned" };
    return { ok: true, text, detail: "ok" };
  } catch (e) {
    return { ok: false, text: "", detail: e instanceof Error ? e.message : String(e) };
  }
}
