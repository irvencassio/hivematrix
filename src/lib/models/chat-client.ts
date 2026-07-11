/**
 * Operational completion client.
 *
 * Operator policy (2026-07-11 Claude-native cutover): cloud inference via the
 * subscription-OAuth `claude` CLI is ALLOWED — requests go to Anthropic under
 * the operator's own Claude subscription, invoked as a local subprocess that
 * uses the CLI's own login session. What remains HARD-FORBIDDEN is API keys
 * and the `@anthropic-ai` SDK: no `ANTHROPIC_API_KEY`, no direct HTTP calls to
 * an Anthropic endpoint, ever. `haikuChatComplete()` is the default backend
 * for ambient/operational work (day-brief, ratchet, weaver-audit, distill,
 * loop-closer, enhance-prompt, learning-loop, persona-evolution) — see
 * docs/superpowers/plans/2026-07-11-claude-native-cutover.md.
 *
 * The CLI subprocess call is injectable so unit tests touch
 * neither the network nor a real model/binary.
 *
 * See docs/superpowers/specs/2026-06-27-model-advised-decomposition-design.md.
 */

import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import { resolveClaudeBinary } from "@/lib/orchestrator/subprocess";
import { backendConfigured } from "@/lib/models/backends";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  model?: string;
  endpoint?: string;
  /** Logical reasoning budget used by higher-level planners; Qwen receives a portable prompt + token budget. */
  reasoningEffort?: "off" | "low" | "medium" | "high" | "max";
  fetchImpl?: typeof fetch;
}

export type ChatComplete = (messages: ChatMessage[], opts?: ChatOpts) => Promise<string>;

// ---------------------------------------------------------------------------
// Claude CLI (subscription OAuth) — the default operational backend.
// ---------------------------------------------------------------------------

const HAIKU_DEFAULT_TIMEOUT_MS = 60_000; // CLI process startup is slower than a warm HTTP call
const HAIKU_MAX_BUFFER = 4 * 1024 * 1024;
const VALID_CLI_MODELS = /^(opus|sonnet|haiku)$/;

type ExecFileFn = (
  file: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

const realExecFile = promisify(execFileCb) as unknown as ExecFileFn;

// Node's built-in child_process module exports are non-configurable, so
// test-runner mock.method() can't patch execFile directly — this thin
// swappable reference is the DI seam tests use instead (mirrors this
// codebase's _setXDepsForTests convention, e.g. orchestrator/intent-classifier.ts).
let _execFileImpl: ExecFileFn = realExecFile;
export function _setExecFileForTests(fn: ExecFileFn | null): void {
  _execFileImpl = fn ?? realExecFile;
}

/** Pure: build the argv for a one-shot `claude -p` completion call. Never shell-interpolated. */
export function buildHaikuCliArgs(messages: ChatMessage[], opts: ChatOpts = {}): { args: string[]; model: string } {
  const model = opts.model && VALID_CLI_MODELS.test(opts.model) ? opts.model : "haiku";
  const prompt = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const args = ["-p", prompt, "--model", model, "--max-turns", "1", "--output-format", "text"];
  if (system) args.push("--append-system-prompt", system);
  return { args, model };
}

/**
 * Cloud completion via the subscription-OAuth `claude` CLI — the default
 * operational backend post-cutover. Spawns `claude -p <prompt> --model
 * <opus|sonnet|haiku> --max-turns 1 --output-format text` with `execFile`
 * (argv array, never shell interpolation — prompts contain operator text).
 * `opts.maxTokens` / `opts.temperature` are accepted for interface
 * compatibility with `localChatComplete` but ignored — the CLI has no such
 * flags. Rejects on a non-zero exit or empty stdout.
 */
export async function haikuChatComplete(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const binary = resolveClaudeBinary();
  const { args } = buildHaikuCliArgs(messages, opts);
  let stdout: string;
  try {
    ({ stdout } = await _execFileImpl(binary, args, {
      timeout: opts.timeoutMs ?? HAIKU_DEFAULT_TIMEOUT_MS,
      maxBuffer: HAIKU_MAX_BUFFER,
      env: process.env,
    }));
  } catch (err) {
    throw new Error(`claude CLI completion failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("claude CLI completion returned no output");
  return trimmed;
}

/** Thin wrapper: same as `haikuChatComplete` but defaults to Opus — the
 * thinking-role completer (see models/deep-think.ts). An explicit
 * `opts.model` still wins, matching `haikuChatComplete`'s own precedence. */
export async function opusChatComplete(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  return haikuChatComplete(messages, { ...opts, model: opts.model ?? "opus" });
}

/**
 * Resolve the default operational completion backend: the Claude CLI when
 * configured (installed + enabled), else null. Callers fall back to their
 * own deterministic path when this returns null (usage exhausted, offline,
 * or the CLI isn't set up).
 */
export function resolveCompletionClient(): ChatComplete | null {
  if (!backendConfigured("claude")) return null;
  return (messages, opts) => haikuChatComplete(messages, opts);
}

/**
 * True when the Claude CLI (subscription OAuth) is configured — installed
 * and enabled as a frontier provider. Unlike the old local-only check, this
 * backend is metered against the subscription and needs connectivity;
 * callers use this to decide whether model-advised work (goal decomposition,
 * prompt enhancement) may run.
 */
export function hasCompletionModel(): boolean {
  return backendConfigured("claude");
}
