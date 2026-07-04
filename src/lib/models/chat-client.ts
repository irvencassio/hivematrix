/**
 * Keyless completion client over HiveMatrix's local-first backends.
 *
 * HARD CONSTRAINT (operator policy): NO cloud LLM API keys, ever — no Anthropic
 * key, no OpenAI/ChatGPT key. The only backends here are:
 *   - local Qwen over LM Studio HTTP (keyless), and
 *   - a keyless CLI session (codex `exec`; ChatGPT subscription login).
 * Claude/Anthropic is intentionally not invoked.
 *
 * Both the HTTP `fetch` and the CLI process runner are injectable so unit tests
 * touch neither the network nor a real subprocess.
 *
 * See docs/superpowers/specs/2026-06-27-model-advised-decomposition-design.md.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { getQwenProfile, isQwenEndpointLocal } from "@/lib/config/qwen-profile";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CliRunner = (
  binary: string,
  args: string[],
  opts?: { stdin?: string; timeoutMs?: number },
) => Promise<string>;

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
  runCli?: CliRunner;
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

/** Flatten chat messages into a single prompt for a one-shot CLI session. */
function flattenMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => (m.role === "system" ? m.content : m.role === "user" ? m.content : `Assistant: ${m.content}`))
    .join("\n\n");
}

/** Default CLI runner: spawn, write stdin, collect stdout. Replaceable in tests. */
const defaultRunCli: CliRunner = (binary, args, opts = {}) =>
  new Promise<string>((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error(`${binary} timed out`)); }, opts.timeoutMs ?? 60_000);
    proc.stdout.on("data", (d) => { out += String(d); });
    proc.stderr.on("data", (d) => { err += String(d); });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${binary} exited ${code}: ${err.slice(0, 200)}`));
    });
    if (opts.stdin) proc.stdin.write(opts.stdin);
    proc.stdin.end();
  });

/**
 * Keyless CLI completion (codex `exec` → ChatGPT subscription). The prompt is a
 * positional arg after `--` (codex exec rejects a leading `--- …` otherwise).
 */
export async function cliChatComplete(binary: string, messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const run = opts.runCli ?? defaultRunCli;
  const prompt = flattenMessages(messages);
  const args = ["exec", "--skip-git-repo-check"];
  if (opts.model) args.push("-m", opts.model);
  args.push("--", prompt);
  return run(binary, args, { timeoutMs: opts.timeoutMs ?? 60_000 });
}

const CODEX_SEARCH_PATHS = [
  "/usr/local/bin/codex",
  "/opt/homebrew/bin/codex",
];

function findCodexBinary(): string | null {
  for (const p of CODEX_SEARCH_PATHS) {
    try { if (existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

/**
 * Resolve the configured keyless completion backend, preferring local Qwen
 * (fast) and falling back to the codex/ChatGPT CLI. Returns null when none is
 * configured — the caller then uses the deterministic regex split. `offline`
 * disables the cloud CLI (Qwen may still be on-box, but MVP keeps offline
 * conservative and returns null from decompose instead).
 */
export function resolveCompletionClient(_mode?: string): ChatComplete | null {
  if (getQwenProfile()) {
    return (messages, opts) => localChatComplete(messages, opts);
  }
  const codex = findCodexBinary();
  if (codex) {
    return (messages, opts) => cliChatComplete(codex, messages, opts);
  }
  return null;
}

/**
 * True when a local, loopback-served completion model (e.g. DeepSeek/DwarfStar on
 * 127.0.0.1) is configured. Such a backend is keyless, free, and reachable even
 * fully offline — callers use this to decide whether model-advised work (goal
 * decomposition) may run without the flag and in offline mode.
 */
export function hasLocalCompletionModel(): boolean {
  const profile = getQwenProfile();
  if (!profile) return false;
  return isQwenEndpointLocal(profile.primary.endpoint);
}
