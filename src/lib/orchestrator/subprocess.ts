import { spawn, execSync, spawnSync, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getActiveProfile, configuredClaudeProfiles, getLocalModelConfig } from "@/lib/config/constants";
import { resolveProvider } from "@/lib/config/providers";
import type { ModelRole } from "@/lib/connectivity/policy";
import { verificationGatePrompt } from "@/lib/orchestrator/verification-gate";
import { getDb } from "@/lib/db";
import { buildBrainMemoryBundle } from "@/lib/brain/memory-bundle";
import { brainDocPolicyText } from "@/lib/brain/settings";
import { goalAncestryContext, scratchpadContext } from "./mission-prompts";
import { readScratchpad } from "./mission-engine";
import { type WorkflowDefinition, type WorkflowStep } from "@/lib/types/workflow";
import { StreamParser, type StreamEvent } from "./stream-parser";
import { generateHookSettings, cleanupHookFiles } from "./approval";
import { spawnGenericAgent } from "./generic-agent";
import { spawnCodexAgent } from "./codex-agent";
import { outboundHttpRoutingPrompt, brainSearchRoutingPrompt, beeToolsRoutingPrompt } from "./outbound-routing";
import { prepareOutboundMcp } from "./outbound-mcp";
import { spawnImageAgent } from "./image-agent";
import { getAgentProfile, type ProfileModelRole } from "@/lib/config/agent-profiles";
import { isCodexModel, isNanoBananaModel, claudeShortName } from "@/lib/models/catalog";
import { claudeEffortMode, hasBudgetCeiling, normalizeBudgetUsd, resolveThinkingMode } from "@/lib/config/budget-policy";

const CLAUDE_SEARCH_PATHS = [
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  join(homedir(), ".npm-global", "bin", "claude"),
  join(homedir(), ".claude", "bin", "claude"),
  join(homedir(), ".local", "bin", "claude"),
];

function resolveClaudeCommand(): { binary: string; extraArgs: string[] } {
  // Check config for a custom claude command (e.g. "claudew" or "claude --include plugin")
  try {
    const configPath = join(homedir(), ".hivematrix", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.claudeCommand && typeof config.claudeCommand === "string" && config.claudeCommand.trim()) {
      const parts = config.claudeCommand.trim().split(/\s+/);
      return { binary: parts[0], extraArgs: parts.slice(1) };
    }
  } catch {
    // no config
  }
  return { binary: resolveClaudeBinary(), extraArgs: [] };
}

export function resolveClaudeBinary(): string {
  // 1. Check config for cached path
  try {
    const configPath = join(homedir(), ".hivematrix", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.claudeBinaryPath && existsSync(config.claudeBinaryPath)) {
      return config.claudeBinaryPath;
    }
  } catch {
    // no config
  }

  // 2. Try which (works when PATH is set)
  try {
    const result = execSync("which claude", { encoding: "utf-8", timeout: 3000 }).trim();
    if (result && existsSync(result)) return result;
  } catch {
    // not on PATH
  }

  // 3. Check common install locations
  for (const p of CLAUDE_SEARCH_PATHS) {
    if (existsSync(p)) return p;
  }

  // 4. Fall back to bare "claude" and hope PATH resolves it
  return "claude";
}

/** Normalize a profile value to a dot-prefixed config directory name.
 *  Handles: ".claude-irv" → ".claude-irv", "claude-irv" → ".claude-irv" */
function normalizeConfigDir(profile: string): string {
  return profile.startsWith(".") ? profile : `.${profile}`;
}

/**
 * Resolve a Claude CLI config dir for a task, or null to leave the CLI on its
 * default — which is almost always what we want.
 *
 * Two unrelated things were being conflated here, and it broke every task's auth:
 *
 *  - `task.profile` is an AGENT PERSONA ("developer", "researcher", "qa", "coo"
 *    — see config/agent-profiles.ts). It has nothing to do with Claude accounts.
 *  - CLAUDE_CONFIG_DIR selects a Claude CLI CONFIG DIRECTORY, and the CLI derives
 *    a SEPARATE keychain credential per directory (hashing the path — the same
 *    scheme mirrored in usage/claude.ts).
 *
 * Passing the persona straight through produced CLAUDE_CONFIG_DIR=$HOME/.developer
 * etc. The CLI dutifully created those directories and minted a fresh credential
 * for each; they expired and nothing refreshes them, so every task died with
 * "OAuth session expired and could not be refreshed" while Flash chat — which
 * sets no env at all (flash/loop.ts) and therefore uses the default credential —
 * kept working. Terminal and browser were fine for the same reason.
 *
 * Setting the variable to "$HOME/.claude" is ALSO wrong: an explicit path hashes
 * to a suffixed keychain item, which is a different credential from the
 * unsuffixed default the CLI uses when the variable is absent. So the only safe
 * move is to omit it entirely unless a real, configured Claude profile applies.
 *
 * The multi-account feature this came from (transplanted from Hive 1, c657d90c)
 * is honoured but inert: `config.profiles` is read in three places and written
 * nowhere, so `getActiveProfile()` only ever returns a real profile if someone
 * populates it by hand. Until then, tasks use the same credential as everything
 * else on the machine.
 */
function resolveClaudeConfigDir(profile?: string): string | null {
  const configured = configuredClaudeProfiles();
  if (configured.length === 0) return null;

  // Only a value that names an actual configured Claude profile may select one.
  // A persona name must never be interpreted as a config dir.
  if (profile) {
    const normalized = normalizeConfigDir(profile);
    if (configured.includes(normalized)) return `${process.env.HOME}/${normalized}`;
    return null;
  }
  const active = getActiveProfile();
  return configured.includes(active) ? `${process.env.HOME}/${active}` : null;
}

/** Test seam for buildClaudeEnv — the auth-critical logic needs direct coverage. */
export function buildClaudeEnvForTests(profile?: string): Record<string, string> {
  return buildClaudeEnv(profile);
}

/** Build a clean env for running claude CLI, optionally under a configured profile. */
function buildClaudeEnv(profile?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key !== "CLAUDECODE" && key !== "CLAUDE_CODE_ENTRYPOINT" && val !== undefined) {
      env[key] = val;
    }
  }
  const configDir = resolveClaudeConfigDir(profile);
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  else delete env.CLAUDE_CONFIG_DIR; // inherited value must not leak a stale dir in
  return env;
}

/**
 * True when the model should be served from the local provider endpoint
 * (ANTHROPIC_BASE_URL override). Claude models may be bare aliases
 * ("sonnet"/"opus") that don't start with "claude-" — never point those at the
 * local endpoint, or the CLI reports the model as nonexistent/inaccessible
 * when the local server rejects it.
 */
export function isLocalEndpointModel(model: string | undefined): boolean {
  return Boolean(model && claudeShortName(model) === null && !model.startsWith("claude-"));
}

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
  error?: string;
}

/** Check if claude CLI is authenticated for the given profile. */
export function checkAuth(profile?: string): AuthStatus {
  const { binary } = resolveClaudeCommand();
  const env = buildClaudeEnv(profile);
  const configDir = env.CLAUDE_CONFIG_DIR;
  try {
    // buildClaudeEnv OMITS CLAUDE_CONFIG_DIR in the normal case (no configured
    // profile) so the CLI uses its DEFAULT credential — the same one Chat, the
    // terminal and the browser share. An undefined configDir is therefore
    // correct, not missing. The old guard did `existsSync(undefined)` → false
    // and reported "Config directory not found: undefined", failing auth for
    // every default-credential task even though the user was signed in. That
    // false failure drove the whole login cascade (two browser prompts) and,
    // with the scheduler's uncapped requeue, spammed it every ~2 minutes.
    // Only a profile that named an EXPLICIT dir can be genuinely missing.
    if (configDir && !existsSync(configDir)) {
      return { loggedIn: false, error: `Config directory not found: ${configDir}` };
    }
    const result = spawnSync(binary, ["auth", "status"], {
      env: env as NodeJS.ProcessEnv,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = (result.stdout || "").trim();
    try {
      const parsed = JSON.parse(output);
      return {
        loggedIn: parsed.loggedIn === true,
        email: parsed.email,
      };
    } catch {
      if (output.includes("loggedIn") && output.includes("true")) {
        return { loggedIn: true };
      }
      return { loggedIn: false, error: output || result.stderr?.trim() || "Unknown auth status" };
    }
  } catch (err) {
    return { loggedIn: false, error: err instanceof Error ? err.message : "Auth check failed" };
  }
}

/** Resolve profile to actual email for logging. */
function profileLabel(profile?: string): string {
  const dir = profile ? normalizeConfigDir(profile) : getActiveProfile();
  return `${dir.replace(/^\.claude-?/, "") || "default"} (${dir})`;
}

/** Human-facing instruction appended to every auth failure a task surfaces. */
const REAUTH_HINT = "Re-authenticate in Settings → Models (or run `claude auth login` in a terminal).";

/**
 * Confirm auth is valid for a profile before a task spawns. Returns status only
 * — it NEVER launches an interactive login.
 *
 * It used to, and that was the bug: on a false "not logged in" it ran
 * `claude auth login` TWICE (a misnamed "refresh" that is really `auth login`,
 * then an explicit browser login), so a single failing task popped two browser
 * authorize prompts, on a loop, from a background scheduler the operator wasn't
 * even looking at. A task runner must never hijack the browser. `auth login`
 * cannot silently refresh anyway — the CLI already refreshes a live token when
 * checkAuth() runs `auth status`; an expired *session* needs a human, and the
 * only correct move is to fail the task with a clear instruction. Interactive
 * sign-in stays where the operator asks for it: Settings → Models
 * (/providers/claude/setup), never here.
 */
export function ensureAuth(profile?: string): AuthStatus {
  const label = profileLabel(profile);
  const status = checkAuth(profile);
  if (status.loggedIn) {
    console.log(`[auth] ${label}: authenticated as ${status.email}`);
    return status;
  }
  console.error(`[auth] ${label}: not authenticated (${status.error}). ${REAUTH_HINT}`);
  return { ...status, error: `${status.error || "not logged in"} — ${REAUTH_HINT}` };
}

export interface AgentProcess {
  proc: ChildProcess;
  pid: number;
  taskId: string;
  projectPath: string;
  worktreeName?: string | null;
  /**
   * Set only when task-worktree isolation (agent-manager.ts, flag-gated,
   * default OFF) created a `.hive-worktrees/<taskId>` worktree for this run
   * and pointed cwd at it — lets handleExit clean it up on exit. Distinct
   * from `worktreeName`: that field drives the claude CLI's own `-w` flag
   * (see the `-w` push below) and is untouched by this feature.
   */
  taskWorktreeDir?: string | null;
  startedAt: Date;
  /** When the first token/text arrived — for time-to-first-token (TTFT). */
  firstTokenAt?: Date;
  textBuffer: string;
  modelsUsed: string[];
  launchCommand?: string;
  sessionId?: string;
  lastResult?: {
    cost: number; result: string; sessionId: string; turns: number; inputTokens: number; outputTokens: number;
    cacheReadTokens: number; cacheCreationTokens: number; cacheCreate5mTokens?: number; cacheCreate1hTokens?: number;
    contextWindow: number; reasoningTokens?: number;
    /**
     * Deterministic code-smoke verification-gate signal (generic/local-model agent
     * path only — the `claude -p` path has no such gate and never sets these).
     * smokeRan=false means the gate never fired (no runnable files touched, or the
     * harness was unavailable) — handleExit must not fabricate a verdict in that case.
     */
    smokeRan?: boolean;
    smokeOk?: boolean;
    smokeReport?: string;
  };
}

export type AgentEventHandler = (taskId: string, event: StreamEvent) => void;

// Load the Hive agent guide so spawned agents know how to manage projects, etc.
const AGENT_GUIDE_PATH = join(homedir(), ".hivematrix", "agent-guide.md");
function loadAgentGuide(): string {
  try {
    return readFileSync(AGENT_GUIDE_PATH, "utf-8");
  } catch {
    return "";
  }
}

// Despite the name this is NOT dead code: it is the only live path whenever
// config.json carries no workflowSteps/workflows (the common case). It used to
// say "Use the /workflows:<step> skill." for each step — but no such skills are
// installed, so every task's first action was a Skill call that returned
// "Unknown skill: workflows:work", after which the agent improvised (one run
// recovered by scanning the filesystem from /). Describe the step inline
// instead; never name a skill from here unless it is known to be installed.
const LEGACY_PREFIXES: Record<string, string> = {
  brainstorm:
    "Start in design mode: read the relevant code before proposing anything, lay out 2-3 approaches with their trade-offs, and settle on one before writing code. ",
  plan:
    "Break the approved design into small ordered steps, each naming exact file paths and each independently verifiable. Write the failing test before the change it covers. ",
  work:
    "Implement the plan step by step, running the tests as you go. Commit your work before you finish so it cannot be swept into another task's commit. ",
  review:
    "Review the diff for correctness bugs first, then for reuse and simplification. Report what you verified and what you only inspected. ",
};

/**
 * Connectivity-router role for a Mixed-mode task, derived from the agent's own
 * profile model role. "Mixed" is the default model for every task, so this is
 * the seam that decides whether the Settings role overrides
 * (Thinking/Coding/Operational/Writer) ever reach a task at all.
 *
 * Unknown or role-less agent types fall back to "code-critical" — the value
 * that used to be hardcoded here — so unclassified work behaves exactly as before.
 */
const ROUTING_ROLE_BY_MODEL_ROLE: Record<ProfileModelRole, ModelRole> = {
  thinking: "think",
  coding: "code-critical",
  operational: "execute",
  // Writer shows "Default — Sonnet" in Settings; code-critical is the frontier
  // tier that resolves there. "converse" would silently drop it to Haiku.
  writer: "code-critical",
};

export function routingRoleForAgentType(agentType?: string | null): ModelRole {
  const id = String(agentType ?? "").trim();
  if (!id) return "code-critical";
  try {
    const role = getAgentProfile(id)?.modelRole;
    return (role && ROUTING_ROLE_BY_MODEL_ROLE[role]) || "code-critical";
  } catch {
    return "code-critical";
  }
}

function resolvePromptPrefix(workflowId?: string, stepIndex?: number): string {
  if (!workflowId || workflowId === "standalone") return "";

  // Try loading from new config format (workflowSteps + workflows with stepIds)
  try {
    const configPath = join(homedir(), ".hivematrix", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));

    const stepLibrary = config.workflowSteps as WorkflowStep[] | undefined;
    const workflows = config.workflows as WorkflowDefinition[] | undefined;

    if (workflows && stepLibrary) {
      const wf = workflows.find((w) => w.id === workflowId);
      if (wf && wf.stepIds) {
        // New format: resolve stepId from the library
        const stepId = wf.stepIds[stepIndex ?? 0];
        const step = stepId ? stepLibrary.find((s) => s.id === stepId) : undefined;
        return step?.promptPrefix ?? "";
      }
      // Old format fallback (inline steps, pre-migration)
      const wfAny = wf as unknown as { steps?: WorkflowStep[] };
      if (wfAny?.steps) {
        const step = wfAny.steps[stepIndex ?? 0];
        return step?.promptPrefix ?? "";
      }
    }
  } catch {
    // config read failed
  }

  // Legacy fallback: workflowId is actually a step name (old format)
  return LEGACY_PREFIXES[workflowId] ?? "";
}

// Effort levels Claude Code accepts via --effort. "auto" is deliberately NOT in
// this set: claudeEffortMode returns "auto" for an unset/auto thinking mode, so
// the flag is omitted and the CLI picks its own effort per turn — the same
// adaptive behavior as a direct `claude` session. An explicit tier is passed
// through. "ultrathink" is kept as an in-prompt keyword for Claude-specific
// behavior.
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

// Runs the top-level CLI task like a direct interactive session: plan and
// review on the thinking tier, hand construction work off to Sonnet
// subagents via the Agent tool instead of doing every edit inline.
// Model-agnostic on purpose: the top-level model is chosen by the router
// (routeByRole/resolveModelId), so it is frequently NOT Opus — a live run was
// observed on `--model sonnet` while this prompt insisted it was "the top-level
// agent on Opus" delegating to "Sonnet subagents", i.e. telling Sonnet it was
// Opus and to hand work to itself. Naming tiers here can only ever drift from
// what the router actually picked.
const DELEGATION_SYSTEM_PROMPT =
  "You are the top-level agent for this task. Do the planning, decomposition, review, and delegation yourself; delegate construction and implementation work to subagents via the Agent tool rather than doing all the coding inline. Spawn subagents liberally for parallelizable or well-scoped build work.";

/** Remove NUL bytes — argv strings passed to child_process.spawn cannot contain them. */
export function stripNullBytes(s: string): string {
  // eslint-disable-next-line no-control-regex -- NUL is exactly the character being stripped
  return s.includes("\u0000") ? s.replace(/\u0000/g, "") : s;
}

export function buildClaudeSpawnArgs(input: {
  prompt: string;
  // No longer used for --allowedTools (see below) — kept so existing call
  // sites/tests can still pass a tool list without a signature change.
  tools?: string[];
  maxBudgetUsd?: number | null;
  model?: string | null;
  thinkingMode?: string | null;
  fastMode?: boolean;
  resumeSessionId?: string | null;
}): string[] {
  const args: string[] = [];

  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId, "-p", input.prompt);
  } else {
    args.push("-p", input.prompt);
  }

  // Run like a direct interactive session: full native tools, no turn cap.
  // --dangerously-skip-permissions grants every tool; the PreToolUse hook
  // written by approval.ts is the sole gate and still runs and can veto even
  // under this flag (autonomy-aware: auto-approves under `autonomous`,
  // routes to human approval under standard/manual, and always enforces the
  // release/deploy/destructive safety floor).
  args.push(
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  );

  if (hasBudgetCeiling(input.maxBudgetUsd)) {
    args.push("--max-budget-usd", String(normalizeBudgetUsd(input.maxBudgetUsd)));
  }

  if (input.model) {
    args.push("--model", input.model);
  }

  if (input.fastMode) {
    args.push("--settings", '{"fastMode":true}');
  }

  const effort = claudeEffortMode(input.thinkingMode);
  if (EFFORT_LEVELS.has(effort) && (!input.model || claudeShortName(input.model) !== null)) {
    args.push("--effort", effort);
  }

  return args;
}

export async function spawnAgent(
  taskId: string,
  description: string,
  projectPath: string,
  maxBudgetUsd: number,
  onEvent: AgentEventHandler,
  onExit: (taskId: string, code: number | null, signal: string | null) => void,
  project?: string,
  workflow?: string,
  resumeSessionId?: string,
  model?: string,
  profile?: string,
  workflowStepIndex?: number,
  worktreeName?: string | null,
  agentType?: string,
  thinkingMode?: string,
  fastMode?: boolean,
  /**
   * Task-worktree isolation (agent-manager.ts, flag-gated, default OFF):
   * when set, the spawned process's cwd is this directory instead of
   * `projectPath`. Everything else (CLAUDE.md/MEMORY.md overhead reads,
   * agent-guide loading, the `-w` flag below, DB bookkeeping keyed by
   * `projectPath`) is untouched and keeps reading from the original
   * `projectPath` — only the child process's actual working directory
   * changes. Undefined by default, so omitting it (every caller today
   * except the worktree-isolation path) reproduces today's behavior
   * exactly: `cwd: projectPath`. Only wired into the primary `claude -p`
   * CLI path below — the codex/generic/image-agent branches above are
   * unaffected.
   */
  cwdOverride?: string,
): Promise<AgentProcess> {
  // Defense in depth: an empty/blank projectPath (a project-less "operations"
  // task, or any legacy caller that forgot to set one) must never reach
  // child_process.spawn's cwd option below — cwd:"" throws ENOENT rather than
  // inheriting the current directory. Callers should already default to a real
  // directory (see server.ts POST /tasks), but this is the last line of defense.
  if (!projectPath || !projectPath.trim()) projectPath = homedir();
  // "mixed" is resolved through the role-based router + connectivity policy:
  // frontier for thinking-heavy work when available, local otherwise (with a
  // frontier-review debt). This wires the New-Task "Mixed" option into the
  // existing router rather than introducing a parallel path.
  if (model === "mixed") {
    const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
    const { routeByRole } = await import("@/lib/routing/router");
    const { resolveModelId } = await import("@/lib/routing/model-resolver");
    // Route by the agent's own model role. This used to be a hardcoded
    // "code-critical", so EVERY Mixed task — the default for all tasks — was
    // routed as final implementation regardless of what it actually was. The
    // consequence: the Thinking/Operational/Writer settings had no effect on
    // any task (only Coding did, since code-critical resolves the frontier
    // tier), and a planning/architecture agent silently ran on the coding
    // model. Unknown or role-less agent types keep the previous behavior.
    const routingRole = routingRoleForAgentType(agentType);
    const route = routeByRole(routingRole, getConnectivityPolicy());
    // Honor role overrides, including local ones — Mixed mode explicitly allows
    // a local model as the Coding choice (see role-model-overrides design).
    const resolved = resolveModelId(route.tier);
    onEvent(taskId, { type: "log", content: `[mixed] routed ${routingRole} → ${route.tier} → ${resolved ?? "unavailable"}` });
    model = resolved ?? undefined;
    if (!model) {
      onEvent(taskId, { type: "error", content: "[mixed] no model available for the current connectivity mode" });
      onExit(taskId, 1, null);
      // Return a minimal already-exited process so the caller can proceed.
      const { EventEmitter } = await import("events");
      const dead = new EventEmitter() as unknown as import("child_process").ChildProcess;
      return { proc: dead, pid: -1, taskId, projectPath, startedAt: new Date(), textBuffer: "", modelsUsed: [] };
    }
  }

  // "cloud-only" is the no-local posture: every role resolves to frontier and
  // the local model is never spawned. If the cloud is unreachable the task is
  // NOT downgraded to local — it is left for retry when cloud-ok returns.
  if (model === "cloud-only") {
    const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
    const { routeByRole } = await import("@/lib/routing/router");
    const { resolveModelId } = await import("@/lib/routing/model-resolver");
    const policy = getConnectivityPolicy();
    // Same fix as the "mixed" branch above: this was hardcoded "code-critical",
    // so a cloud-only task ignored its agent role exactly like a Mixed one did.
    const routingRole = routingRoleForAgentType(agentType);
    const route = routeByRole(routingRole, policy, { noLocal: true });
    // noLocalOverrides: a local model configured as a role override must not
    // leak into the cloud-only posture.
    const resolved = resolveModelId(route.tier, { noLocalOverrides: true });
    onEvent(taskId, { type: "log", content: `[cloud-only] routed ${routingRole} → ${route.tier} → ${resolved ?? "unavailable"}` });
    model = resolved ?? undefined;
    if (!model) {
      onEvent(taskId, { type: "error", content: `[cloud-only] frontier unavailable in ${policy.mode} mode — not falling back to local; retry when cloud-ok is restored` });
      onExit(taskId, 1, null);
      const { EventEmitter } = await import("events");
      const dead = new EventEmitter() as unknown as import("child_process").ChildProcess;
      return { proc: dead, pid: -1, taskId, projectPath, startedAt: new Date(), textBuffer: "", modelsUsed: [] };
    }
  }

  if (isCodexModel(model)) {
    return spawnCodexAgent(
      taskId,
      description,
      projectPath,
      maxBudgetUsd,
      onEvent,
      onExit,
      model!,
      resumeSessionId,
      thinkingMode,
      fastMode,
    );
  }

  if (model && isNanoBananaModel(model)) {
    const provider = resolveProvider(model);
    if (provider) {
      return spawnImageAgent(
        taskId,
        description,
        projectPath,
        onEvent,
        onExit,
        provider,
        model,
      );
    }
  }

  // Route non-Claude models to the generic (direct API) agent
  if (model && !model.startsWith("claude-")) {
    const provider = resolveProvider(model);
    if (provider) {
      return spawnGenericAgent(
        taskId,
        description,
        projectPath,
        maxBudgetUsd,
        onEvent,
        onExit,
        provider,
        model,
        agentType ?? "developer",
        project,
        thinkingMode
      );
    }
    // If no provider resolved, fall through to Claude CLI path
    // (preserves existing local model behavior via ANTHROPIC_BASE_URL)
  }

  // Set up PreToolUse hook for approval interception
  generateHookSettings(taskId, projectPath);

  const { isChannelEnabled: isMailLaneEnabled } = await import("@/lib/mailbee/store");
  const { isChannelEnabled: isMessageLaneEnabled } = await import("@/lib/messagebee/store");
  const mailLaneEnabled = isMailLaneEnabled();
  const messageLaneEnabled = isMessageLaneEnabled();
  // First-class outbound tools (Message Lane/Mail Lane) via a bundled MCP server, so
  // SENDING is a real tool call the harness can't talk itself out of (it once
  // claimed "No SMS tool available" and punted). The server proxies the same
  // trust-gated daemon endpoints; auto-approve them since the gate is server-side.
  // projectPath/project ride along so lane tools (desktop_action, hivematrix_browser,
  // …) act in this task's directory rather than the daemon's cwd.
  const outboundMcp = prepareOutboundMcp(process.env.HIVEMATRIX_PORT ?? "3747", process.execPath, { mailLaneEnabled, messageLaneEnabled, projectPath, project });

  // Prepend workflow skill prefix if applicable
  const prefix = resolvePromptPrefix(workflow, workflowStepIndex).trimEnd();
  // "ultrathink" is a Claude Code in-context keyword that triggers deeper reasoning
  // for one turn. It is prepended to the prompt (not passed as a CLI flag).
  const effectiveThinkingMode = resolveThinkingMode(thinkingMode);
  const ultrathinkPrefix = effectiveThinkingMode === "ultrathink" ? "ultrathink\n\n" : "";
  const prompt = `${ultrathinkPrefix}${prefix ? `${prefix} ` : ""}${description}`;

  // Track prompt overhead bytes for each layer
  const overheadBytes = {
    workflowPrefix: Buffer.byteLength(prefix),
    description: Buffer.byteLength(description),
    agentGuide: 0,
    agentProfile: 0,
    missionContext: 0,
    claudeMd: 0,
    memoryMd: 0,
    total: 0,
    sources: {} as {
      claudeMd?: { label: string; path: string };
      memoryMd?: { label: string; path: string };
    },
  };

  const args = buildClaudeSpawnArgs({
    prompt,
    maxBudgetUsd,
    model,
    // RAW, not effectiveThinkingMode. resolveThinkingMode collapses "auto" to
    // "max", so passing the resolved value here meant claudeEffortMode never saw
    // "auto" and always pinned --effort max — silently defeating the adaptive
    // default at the only call site that matters. effectiveThinkingMode is still
    // the right thing for the ultrathink PREFIX decision above; it is the wrong
    // thing for the effort FLAG.
    thinkingMode,
    fastMode,
    resumeSessionId,
  });

  // Register the outbound MCP server (merges with any user-configured servers —
  // no --strict-mcp-config). --dangerously-skip-permissions above already
  // grants every tool; this just makes the outbound-channel tools reachable.
  args.push("--mcp-config", outboundMcp.configPath);

  // Inject the Hive agent guide so agents know how to manage projects
  const agentGuide = loadAgentGuide();
  if (agentGuide) {
    args.push("--append-system-prompt", agentGuide);
    overheadBytes.agentGuide = Buffer.byteLength(agentGuide);
  }

  const brainDocPolicy = `--- Brain Doc Policy ---\n${brainDocPolicyText()}`;
  args.push("--append-system-prompt", brainDocPolicy);
  overheadBytes.agentGuide += Buffer.byteLength(brainDocPolicy);

  // Code verification gate: generated code (any language) must be executed and
  // static-checked before the agent reports completion. Local quantized models
  // hallucinate API names; this layer makes the catch-and-correct pass mandatory.
  const verificationGate = verificationGatePrompt();
  args.push("--append-system-prompt", verificationGate);
  overheadBytes.agentGuide += Buffer.byteLength(verificationGate);

  // Outbound routing: teach the CLI agent to send email/SMS through the daemon's
  // trust-gated endpoints (its Bash tool can reach loopback) instead of
  // improvising with osascript. Mirrors the local agent's capability routing.
  const outboundRouting = outboundHttpRoutingPrompt(undefined, { mailLaneEnabled, messageLaneEnabled });
  args.push("--append-system-prompt", outboundRouting);
  overheadBytes.agentGuide += Buffer.byteLength(outboundRouting);

  // Durable-memory retrieval: let the CLI agent recall stored brain docs.
  const brainRouting = brainSearchRoutingPrompt();
  args.push("--append-system-prompt", brainRouting);
  overheadBytes.agentGuide += Buffer.byteLength(brainRouting);

  // Always front-load the brain INDEX (projects + recent docs) so EVERY task —
  // not just missions — knows the operator's brain exists and consults it. This
  // is the cheap, list-only counterpart to the full memory bundle below (which
  // stays mission-gated). Bounded + Drive-stall safe.
  try {
    const { buildBrainIndexBlock } = await import("@/lib/brain/memory-bundle");
    const brainIndex = await buildBrainIndexBlock();
    if (brainIndex) {
      args.push("--append-system-prompt", brainIndex);
      overheadBytes.agentGuide += Buffer.byteLength(brainIndex);
    }
  } catch { /* non-critical — don't block spawn */ }

  // Capability parity: web / browser / desktop / terminal via /bee/<tool>.
  const beeRouting = beeToolsRoutingPrompt();
  args.push("--append-system-prompt", beeRouting);
  overheadBytes.agentGuide += Buffer.byteLength(beeRouting);

  // Repo conventions: Claude Code reads CLAUDE.md natively but NOT AGENTS.md (the
  // converged standard). Inject it so coding tasks follow house style.
  try {
    const { readAgentsMd, formatAgentsMd } = await import("@/lib/conventions/agents-md");
    const agents = formatAgentsMd(await readAgentsMd(projectPath));
    if (agents) {
      args.push("--append-system-prompt", agents);
      overheadBytes.agentGuide += Buffer.byteLength(agents);
    }
  } catch { /* non-critical */ }

  // Direct-session parity: tell the top-level (thinking-tier) model to plan and
  // review itself and hand construction to Sonnet subagents.
  //
  // Scoped to SELF-PLANNING work only (workflow "work" — the broad-prompt path,
  // see LEGACY_PREFIXES). A narrow task previously got this too, which pushed
  // Opus to spawn subagents for work it could just do, adding round-trips and
  // indirection for no gain — a real part of why Hive-run generation felt more
  // roundabout than running `claude` directly. Broad work still benefits from
  // decomposition, so it keeps the directive.
  if (workflow === "work") {
    args.push("--append-system-prompt", DELEGATION_SYSTEM_PROMPT);
    overheadBytes.agentGuide += Buffer.byteLength(DELEGATION_SYSTEM_PROMPT);
  }

  // Inject agent profile system prompt for non-developer types
  if (agentType && agentType !== "developer" && agentType !== "auto") {
    const agentProfile = getAgentProfile(agentType);
    let profileText = agentProfile.systemPrompt;
    // Same live-roster injection as generic-agent.ts:buildSystemPrompt — the
    // coo profile deliberately doesn't hardcode a roster string, since a
    // hardcoded one goes stale the moment a role is added/cut/renamed. A coo
    // task can run through either harness, so both need this.
    if (agentType === "coo") {
      const { getCoreAgentProfiles } = await import("@/lib/config/agent-profiles");
      const roster = getCoreAgentProfiles().filter((p) => p.id !== "coo").map((p) => `- ${p.id}: ${p.description}`).join("\n");
      profileText += `\n\n--- Available agent types (create_task) ---\n${roster}`;
    }
    const profilePrompt = `\n\n--- Agent Role ---\n${profileText}`;
    args.push("--append-system-prompt", profilePrompt);
    overheadBytes.agentProfile = Buffer.byteLength(profilePrompt);
  }

  // Inject mission context (goal ancestry + scratchpad + playbooks) for mission tasks
  try {
    const db = getDb();
    const row = db.prepare("SELECT goalAncestry, missionId, project FROM tasks WHERE _id = ?").get(taskId) as { goalAncestry?: string; missionId?: string; project?: string } | undefined;
    if (row?.missionId) {
      try {
        const ancestry = JSON.parse(row.goalAncestry || "[]");
        if (Array.isArray(ancestry) && ancestry.length > 0) {
          const ctx = goalAncestryContext(ancestry);
          args.push("--append-system-prompt", ctx);
          overheadBytes.missionContext += Buffer.byteLength(ctx);
        }
      } catch { /* ignore parse errors */ }
      try {
        const entries = readScratchpad(row.missionId);
        if (entries.length > 0) {
          const ctx = scratchpadContext(entries);
          args.push("--append-system-prompt", ctx);
          overheadBytes.missionContext += Buffer.byteLength(ctx);
        }
      } catch { /* ignore */ }
      // Shared memory bundle: canonical Hive brain docs when available,
      // plus legacy role/project playbooks and recap excerpts.
      try {
        const pbRole = agentType && agentType !== "auto" ? agentType : "developer";
        const pb = await buildBrainMemoryBundle({
          project: row.project,
          role: pbRole,
          bee: "managerbee",
        });
        if (pb) {
          args.push("--append-system-prompt", pb);
          overheadBytes.missionContext += Buffer.byteLength(pb);
        }
      } catch { /* ignore */ }
    }
  } catch { /* non-critical — don't block spawn */ }

  // Read CLAUDE.md and MEMORY.md to measure their overhead (Claude Code loads these natively)
  try {
    const claudeMdPath = join(projectPath, "CLAUDE.md");
    if (existsSync(claudeMdPath)) {
      overheadBytes.claudeMd = Buffer.byteLength(readFileSync(claudeMdPath, "utf-8"));
      overheadBytes.sources.claudeMd = { label: "CLAUDE.md", path: claudeMdPath };
    }
  } catch { /* non-critical */ }
  try {
    const cfgDir = profile ? `.${profile}` : getActiveProfile();
    const encodedProject = projectPath.replace(/\//g, "-");
    const memoryMdPath = join(homedir(), cfgDir, "projects", encodedProject, "memory", "MEMORY.md");
    if (existsSync(memoryMdPath)) {
      overheadBytes.memoryMd = Buffer.byteLength(readFileSync(memoryMdPath, "utf-8"));
      overheadBytes.sources.memoryMd = { label: "MEMORY.md", path: memoryMdPath };
    }
  } catch { /* non-critical */ }

  overheadBytes.total = overheadBytes.workflowPrefix + overheadBytes.description +
    overheadBytes.agentGuide + overheadBytes.agentProfile + overheadBytes.missionContext +
    overheadBytes.claudeMd + overheadBytes.memoryMd;

  if (worktreeName) {
    args.push("-w", worktreeName);
  }

  const env = buildClaudeEnv(profile);
  env.HIVE_AGENT = "1"; // Lets build scripts detect and refuse to run inside a Hive agent
  env.HIVE_TASK_ID = taskId;
  env.HIVE_API = `http://localhost:${process.env.PORT || "4000"}`;
  // Per-process shared secret so only our spawned agents (which inherit it)
  // can call privileged inter-process endpoints like /api/tasks/:id/ask-human.
  env.HIVE_TASK_TOKEN = process.env.HIVE_TASK_TOKEN ?? "";
  env.HIVE_ARTIFACT_DIR = join(homedir(), ".hivematrix", "artifacts", "tasks", taskId);
  env.HIVE_ARTIFACT_EVENTS = join(env.HIVE_ARTIFACT_DIR, "events.jsonl");
  // Loopback daemon port for the outbound-channel curls in the routing prompt.
  env.HIVE_DAEMON_PORT = process.env.HIVEMATRIX_PORT ?? "3747";

  if (isLocalEndpointModel(model)) {
    const localConfig = getLocalModelConfig();
    if (localConfig?.endpoint) {
      env.ANTHROPIC_BASE_URL = localConfig.endpoint;
    }
  }

  const { binary: claudeBinary, extraArgs } = resolveClaudeCommand();
  // Strip NUL bytes from every argv string: Node's spawn rejects any argument
  // containing \u0000 ("must be a string without null bytes"). System-prompt
  // args carry verbatim file content (AGENTS.md, CLAUDE.md, scratchpad), and a
  // project file may contain a stray NUL — sanitize at the boundary so any
  // source is covered, not just one file.
  const spawnArgs = [...extraArgs, ...args].map(stripNullBytes);
  const launchCommand = [claudeBinary, ...spawnArgs].join(" ");
  // cwdOverride is only set by the task-worktree-isolation path (flag-gated,
  // default OFF) — see the parameter doc above. Every other caller leaves it
  // undefined, so `cwd` resolves to `projectPath` exactly as before.
  const proc = spawn(claudeBinary, spawnArgs, {
    cwd: cwdOverride || projectPath,
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"] as const,
  });

  const agent: AgentProcess = {
    proc,
    pid: proc.pid!,
    taskId,
    projectPath,
    worktreeName,
    startedAt: new Date(),
    textBuffer: "",
    modelsUsed: [],
    launchCommand,
  };

  // Store prompt overhead on the task record (non-blocking)
  try {
    const db = getDb();
    const row = db.prepare("SELECT output FROM tasks WHERE _id = ?").get(taskId) as { output?: string } | undefined;
    const existing = row?.output ? JSON.parse(row.output) : {};
    existing.promptOverhead = overheadBytes;
    db.prepare("UPDATE tasks SET output = ? WHERE _id = ?").run(JSON.stringify(existing), taskId);
  } catch { /* non-critical — don't block spawn */ }

  const parser = new StreamParser();
  let lineBuffer = "";

  proc.stdout?.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? ""; // keep incomplete line in buffer

    for (const line of lines) {
      const events = parser.parseLine(line);
      for (const event of events) {
        if (event.type === "init") {
          if (!agent.modelsUsed.includes(event.model)) {
            agent.modelsUsed.push(event.model);
          }
        } else if (event.type === "text") {
          if (!agent.firstTokenAt && event.content) agent.firstTokenAt = new Date();
          agent.textBuffer += event.content;
        } else if (event.type === "result") {
          agent.lastResult = {
            cost: event.cost,
            result: event.result,
            sessionId: event.sessionId,
            turns: event.turns,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheCreationTokens: event.cacheCreationTokens,
            cacheCreate5mTokens: event.cacheCreate5mTokens,
            cacheCreate1hTokens: event.cacheCreate1hTokens,
            contextWindow: event.contextWindow,
            reasoningTokens: event.reasoningTokens,
          };
        }
        onEvent(taskId, event);
      }
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const content = chunk.toString().trim();
    if (content) {
      onEvent(taskId, { type: "error", content });
    }
  });

  // Use "close" instead of "exit" — "exit" fires before stdio streams
  // are fully consumed, so the "result" event may not have been parsed yet.
  // "close" fires after all stdio streams have ended.
  proc.on("close", (code, signal) => {
    // Flush remaining buffer — update agent state directly (same as stdout handler)
    // so lastResult/textBuffer are populated before onExit reads them.
    if (lineBuffer.trim()) {
      const events = parser.parseLine(lineBuffer);
      for (const event of events) {
        if (event.type === "text") {
          if (!agent.firstTokenAt && event.content) agent.firstTokenAt = new Date();
          agent.textBuffer += event.content;
        } else if (event.type === "result") {
          agent.lastResult = {
            cost: event.cost,
            result: event.result,
            sessionId: event.sessionId,
            turns: event.turns,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheCreationTokens: event.cacheCreationTokens,
            cacheCreate5mTokens: event.cacheCreate5mTokens,
            cacheCreate1hTokens: event.cacheCreate1hTokens,
            contextWindow: event.contextWindow,
            reasoningTokens: event.reasoningTokens,
          };
        }
        onEvent(taskId, event);
      }
    }
    // Clean up hook files
    cleanupHookFiles(taskId);
    onExit(taskId, code, signal);
  });

  return agent;
}

/**
 * Terminate an agent gracefully: SIGTERM, then SIGKILL only if it is still
 * alive after `drainMs`. The drain window is a parameter so daemon shutdown can
 * choose how long it is willing to wait before launchd forces the issue.
 */
export function killAgent(proc: ChildProcess, drainMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (proc.killed || !proc.pid) {
      resolve();
      return;
    }

    const forceTimeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already dead
      }
      resolve();
    }, drainMs);

    proc.once("exit", () => {
      clearTimeout(forceTimeout);
      resolve();
    });

    proc.kill("SIGTERM");
  });
}
