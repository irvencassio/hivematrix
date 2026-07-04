/**
 * DwarfStar native-agent harness (Phase B scaffold) — the optional *fourth*
 * peer harness alongside Claude Code, Codex, and Qwen Code.
 *
 * ds4's native `ds4-agent` controls DeepSeek V4 Flash/PRO inference from inside
 * the agent process (no HTTP/socket boundary): session state is an on-disk KV
 * cache, tool handling is native (no DSML↔JSON round-trip), and multi-turn
 * sessions persist and resume via `/save` + `/switch`. That is the lowest-latency
 * local coding path — but it is DeepSeek-only, its tools are fixed and vertical
 * to DeepSeek (it can NOT run HiveMatrix's lane tools — termbee/browserbee/vault),
 * and it is an interactive REPL with no headless API, so we puppet its stdin/
 * stdout the same way subprocess.ts drives the Claude/Codex CLIs.
 *
 * Because it bypasses HiveMatrix's per-tool safety gates, this harness is:
 *   • OFF by default (config `ds4Agent.enabled`, default false),
 *   • eligible ONLY for autonomous DeepSeek coding tasks that need no lane tools,
 *   • intended to run worktree-sandboxed with the verification gate re-run on the
 *     resulting diff (post-hoc, since we can't gate each internal tool call).
 *
 * ds4-agent is alpha; its exact prompt string and `/save` output format may
 * change. The live driver below therefore leans on an idle-output timer rather
 * than brittle prompt-string matching, and all format-coupled parsing is isolated
 * in the pure helpers so it is unit-tested and cheap to re-tune.
 */

import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import type { AgentProcess, AgentEventHandler } from "./subprocess";
import { findBinary, DS4_AGENT_BINARY_SEARCH_PATHS, buildCliPath } from "@/lib/config/binary-detection";

let fakePidCounter = -7000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface Ds4AgentConfig {
  /** Master switch. Default false — the harness is inert until an operator opts in. */
  enabled: boolean;
  /** Explicit path to the `ds4-agent` binary; null → resolve from the search paths. */
  binary: string | null;
  /** How long stdout must be silent (ms) before a turn is considered complete. */
  idleMs: number;
}

const DEFAULT_IDLE_MS = 4000;

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

/** The `ds4Agent` config block, merged over defaults. Pure (config injectable). */
export function ds4AgentConfig(config: Record<string, unknown> = readConfig()): Ds4AgentConfig {
  const raw = (config.ds4Agent ?? {}) as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    binary: typeof raw.binary === "string" && raw.binary ? raw.binary : null,
    idleMs: typeof raw.idleMs === "number" && raw.idleMs > 0 ? raw.idleMs : DEFAULT_IDLE_MS,
  };
}

// ---------------------------------------------------------------------------
// Eligibility — the routing gate that keeps this harness in its lane
// ---------------------------------------------------------------------------

/** Agent profiles that are plain autonomous coding (no lane-tool expectations). */
const CODING_AGENT_TYPES = new Set(["auto", "developer", "coder", "code", "generic"]);

export interface Ds4AgentEligibility {
  /** Config `ds4Agent.enabled`. */
  enabled: boolean;
  /** The resolved provider name for the task's model. Only "dwarfstar" (DeepSeek) qualifies. */
  providerName: string | null | undefined;
  /** The task's agent profile/type. */
  agentType: string | null | undefined;
  /**
   * Whether the task needs HiveMatrix lane tools (mail/message/browser/terminal/
   * vault). ds4-agent's tools are fixed and can't run these, so a task that needs
   * them must stay on the HTTP generic-agent path.
   */
  laneToolsRequired: boolean;
}

/**
 * True when the native ds4-agent harness may handle this task. Conservative by
 * design: DeepSeek model + coding profile + no lane tools + the operator opt-in.
 * Everything else (Qwen, Codex, Claude, lane work, image, etc.) falls through to
 * the existing paths unchanged.
 */
export function ds4AgentEligible(e: Ds4AgentEligibility): boolean {
  if (!e.enabled) return false;
  if (e.providerName !== "dwarfstar") return false;
  if (e.laneToolsRequired) return false;
  const type = (e.agentType ?? "auto").toLowerCase();
  return CODING_AGENT_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// Pure parsing helpers (format-coupled → isolated + unit-tested)
// ---------------------------------------------------------------------------

/**
 * Extract the session SHA that `/save` prints. ds4 keys sessions by the SHA1 of
 * the rendered prefix and stores `<sha1>.kv` under ~/.ds4/kvcache, echoing the
 * hash on save. We accept any 8–40 hex run near a "save"/"session"/"kvcache"
 * cue so minor wording changes in the alpha CLI don't break capture.
 */
export function parseSavedSessionSha(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (!/save|session|kvcache|\.kv/i.test(line)) continue;
    const m = line.match(/\b([0-9a-f]{8,40})\b/i);
    if (m) return m[1].toLowerCase();
  }
  // Fallback: a bare `<sha>.kv` anywhere in the output.
  const kv = output.match(/\b([0-9a-f]{8,40})\.kv\b/i);
  return kv ? kv[1].toLowerCase() : null;
}

/** A ds4 session SHA is 8–40 lowercase hex chars (SHA1 prefix or full). */
export function isValidSessionSha(sha: string | null | undefined): sha is string {
  return typeof sha === "string" && /^[0-9a-f]{8,40}$/.test(sha);
}

/**
 * Build the first REPL input for a task. When resuming, `/switch <sha>` restores
 * the KV session before the new instruction; otherwise the instruction stands
 * alone (a fresh session). Slash commands and the prompt are newline-separated
 * because the REPL reads one line at a time.
 */
export function buildDs4AgentTurns(description: string, resumeSessionSha?: string | null): string[] {
  const turns: string[] = [];
  if (isValidSessionSha(resumeSessionSha)) turns.push(`/switch ${resumeSessionSha}`);
  turns.push(description);
  return turns;
}

// ---------------------------------------------------------------------------
// Live harness
// ---------------------------------------------------------------------------

/**
 * Drive `ds4-agent` for one task and adapt it to the AgentProcess/event model.
 *
 * Flow: spawn → (optional `/switch <sha>`) → send the instruction → stream stdout
 * as text events → when stdout goes idle for `idleMs`, persist with `/save`,
 * capture the session SHA, then `/quit`. The session SHA is surfaced on
 * `agent.sessionId` and the result event so a later task can resume it.
 *
 * NOTE: unverified against a live binary (ds4-agent is alpha and not present in
 * CI). The pure helpers above are the tested surface; this orchestration is the
 * thin, opt-in shell around them.
 */
export function spawnDs4Agent(
  taskId: string,
  description: string,
  projectPath: string,
  onEvent: AgentEventHandler,
  onExit: (taskId: string, code: number | null, signal: string | null) => void,
  model: string,
  resumeSessionSha?: string | null,
  config: Ds4AgentConfig = ds4AgentConfig(),
): AgentProcess {
  const binary = config.binary && findBinary(config.binary) ? config.binary : findBinary("ds4-agent", DS4_AGENT_BINARY_SEARCH_PATHS);
  if (!binary) {
    throw new Error("[ds4-agent] ds4-agent binary not found — install DwarfStar (ds4) or set config ds4Agent.binary.");
  }

  const proc = spawn(binary, [], {
    cwd: projectPath,
    env: { ...process.env, PATH: buildCliPath(), HIVE_DAEMON_PORT: process.env.HIVEMATRIX_PORT ?? "3747" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pid = proc.pid ?? fakePidCounter--;
  const agent: AgentProcess = {
    proc,
    pid,
    taskId,
    projectPath,
    startedAt: new Date(),
    textBuffer: "",
    modelsUsed: [model],
    launchCommand: `${binary} (native ds4-agent${isValidSessionSha(resumeSessionSha) ? `, resume ${resumeSessionSha}` : ""})`,
    sessionId: isValidSessionSha(resumeSessionSha) ? resumeSessionSha : undefined,
  };

  onEvent(taskId, { type: "init", model });

  // The turn/session lifecycle is a tiny state machine over the idle timer so we
  // never block forever on a REPL that has no explicit "done" marker.
  let phase: "working" | "saving" | "quitting" | "done" = "working";
  let savedSha: string | null = agent.sessionId ?? null;
  let idleTimer: NodeJS.Timeout | null = null;
  let sawOutput = false;

  const write = (line: string) => { try { proc.stdin?.write(`${line}\n`); } catch { /* stdin may be closed */ } };

  const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };
  const armIdle = () => {
    clearIdle();
    idleTimer = setTimeout(onIdle, config.idleMs);
  };

  function onIdle() {
    if (phase === "working") {
      // The model finished the turn — persist the session, then read back its SHA.
      phase = "saving";
      write("/save");
      armIdle();
    } else if (phase === "saving") {
      savedSha = parseSavedSessionSha(agent.textBuffer) ?? savedSha;
      if (isValidSessionSha(savedSha)) agent.sessionId = savedSha;
      phase = "quitting";
      write("/quit");
      // If /quit doesn't close the process promptly, force it.
      setTimeout(() => { if (phase !== "done") { try { proc.kill(); } catch { /* ignore */ } } }, 1500).unref?.();
    }
  }

  // Kick off the task: replay /switch (if resuming) then the instruction.
  for (const line of buildDs4AgentTurns(description, resumeSessionSha)) write(line);
  armIdle();

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    if (!agent.firstTokenAt && text) agent.firstTokenAt = new Date();
    sawOutput = true;
    agent.textBuffer += text;
    if (phase === "working") onEvent(taskId, { type: "text", content: text });
    armIdle();
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    onEvent(taskId, { type: "error", content: chunk.toString("utf-8").slice(0, 500) });
  });

  proc.on("error", (err) => {
    clearIdle();
    phase = "done";
    onEvent(taskId, { type: "error", content: `ds4-agent spawn error: ${err.message}` });
    onExit(taskId, 1, null);
  });

  proc.on("close", (code, signal) => {
    clearIdle();
    phase = "done";
    if (!isValidSessionSha(savedSha)) savedSha = parseSavedSessionSha(agent.textBuffer);
    if (isValidSessionSha(savedSha)) agent.sessionId = savedSha;
    const result = agent.textBuffer.slice(-2000);
    agent.lastResult = {
      cost: 0, result, sessionId: agent.sessionId ?? taskId, turns: 1,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextWindow: 0,
    };
    onEvent(taskId, {
      type: "result", sessionId: agent.sessionId ?? taskId, cost: 0, result, turns: 1,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextWindow: 0,
    });
    onExit(taskId, sawOutput ? (code ?? 0) : (code ?? 1), signal ?? null);
  });

  return agent;
}
