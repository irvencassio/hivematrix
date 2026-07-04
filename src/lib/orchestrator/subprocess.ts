import { spawn, execSync, spawnSync, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ALLOWED_TOOLS, getOpsAllowedTools, MAX_TURNS, getActiveProfile, getLocalModelConfig } from "@/lib/config/constants";
import { resolveProvider } from "@/lib/config/providers";
import { verificationGatePrompt } from "@/lib/orchestrator/verification-gate";
import { NO_REPO_LOCK_PROJECTS } from "@/lib/routing/aliases";
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
import { getAgentProfile } from "@/lib/config/agent-profiles";
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

function resolveClaudeBinary(): string {
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

/** Build a clean env for running claude CLI under a specific profile. */
function buildClaudeEnv(profile?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key !== "CLAUDECODE" && key !== "CLAUDE_CODE_ENTRYPOINT" && val !== undefined) {
      env[key] = val;
    }
  }
  const configDir = profile ? normalizeConfigDir(profile) : getActiveProfile();
  env.CLAUDE_CONFIG_DIR = `${process.env.HOME}/${configDir}`;
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
    if (!existsSync(configDir)) {
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

/** Attempt to refresh authentication (OAuth token refresh). */
export function refreshAuth(profile?: string): AuthStatus {
  const { binary } = resolveClaudeCommand();
  const env = buildClaudeEnv(profile);
  try {
    spawnSync(binary, ["auth", "login"], {
      env: env as NodeJS.ProcessEnv,
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return checkAuth(profile);
  } catch (err) {
    return { loggedIn: false, error: err instanceof Error ? err.message : "Auth refresh failed" };
  }
}

/** Resolve profile to actual email for logging. */
function profileLabel(profile?: string): string {
  const dir = profile ? normalizeConfigDir(profile) : getActiveProfile();
  return `${dir.replace(/^\.claude-?/, "") || "default"} (${dir})`;
}

/** Ensure auth is valid for a profile, refreshing if needed. Returns status. */
export function ensureAuth(profile?: string): AuthStatus {
  const label = profileLabel(profile);
  const status = checkAuth(profile);
  if (status.loggedIn) {
    console.log(`[auth] ${label}: authenticated as ${status.email}`);
    return status;
  }

  console.log(`[auth] ${label}: not logged in (${status.error}), attempting token refresh...`);
  const refreshed = refreshAuth(profile);
  if (refreshed.loggedIn) {
    console.log(`[auth] ${label}: token refreshed successfully (${refreshed.email})`);
    return refreshed;
  }

  // Token refresh failed — try opening browser-based login
  console.log(`[auth] ${label}: token refresh failed, attempting browser login...`);
  const browserResult = attemptBrowserLogin(profile);
  if (browserResult.loggedIn) {
    console.log(`[auth] ${label}: browser login succeeded (${browserResult.email})`);
    return browserResult;
  }

  console.error(`[auth] ${label}: all auth methods failed: ${browserResult.error}`);
  return browserResult;
}

/** Open browser for OAuth login and poll for completion. */
function attemptBrowserLogin(profile?: string): AuthStatus {
  const { binary } = resolveClaudeCommand();
  const env = buildClaudeEnv(profile);
  try {
    // `claude auth login` with inherited stdio can open a browser via the CLI's
    // built-in flow. We give it 30s to complete the OAuth round-trip.
    const result = spawnSync(binary, ["auth", "login"], {
      env: env as NodeJS.ProcessEnv,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["inherit", "pipe", "pipe"],
    });
    if (result.status === 0) {
      return checkAuth(profile);
    }
    return { loggedIn: false, error: result.stderr?.trim() || `login exited with code ${result.status}` };
  } catch (err) {
    return { loggedIn: false, error: err instanceof Error ? err.message : "Browser login failed" };
  }
}

export interface AgentProcess {
  proc: ChildProcess;
  pid: number;
  taskId: string;
  projectPath: string;
  worktreeName?: string | null;
  startedAt: Date;
  /** When the first token/text arrived — for time-to-first-token (TTFT). */
  firstTokenAt?: Date;
  textBuffer: string;
  modelsUsed: string[];
  launchCommand?: string;
  sessionId?: string;
  lastResult?: { cost: number; result: string; sessionId: string; turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; contextWindow: number; reasoningTokens?: number };
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

// Legacy fallback for tasks created before dynamic workflows
const LEGACY_PREFIXES: Record<string, string> = {
  brainstorm: "Use the /workflows:brainstorm skill. ",
  plan: "Use the /workflows:plan skill. ",
  work: "Use the /workflows:work skill. ",
  review: "Use the /workflows:review skill. ",
};

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

// Effort levels Claude Code accepts via --effort. Hive resolves "auto" to
// "max" before launch so default tasks do not run with a reasoning ceiling.
// "ultrathink" is also kept as an in-prompt keyword for Claude-specific behavior.
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** Remove NUL bytes — argv strings passed to child_process.spawn cannot contain them. */
export function stripNullBytes(s: string): string {
  return s.includes("\u0000") ? s.replace(/\u0000/g, "") : s;
}

export function buildClaudeSpawnArgs(input: {
  prompt: string;
  tools: string[];
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

  args.push(
    "--output-format",
    "stream-json",
    "--verbose",
    "--allowedTools",
    input.tools.join(","),
    "--max-turns",
    String(MAX_TURNS),
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
): Promise<AgentProcess> {
  // "mixed" is resolved through the role-based router + connectivity policy:
  // frontier for thinking-heavy work when available, local otherwise (with a
  // frontier-review debt). This wires the New-Task "Mixed" option into the
  // existing router rather than introducing a parallel path.
  if (model === "mixed") {
    const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
    const { routeByRole } = await import("@/lib/routing/router");
    const { resolveModelId } = await import("@/lib/routing/model-resolver");
    const route = routeByRole("code-critical", getConnectivityPolicy());
    // Honor role overrides, including local ones — Mixed mode explicitly allows
    // a local model as the Coding choice (see role-model-overrides design).
    const resolved = resolveModelId(route.tier);
    onEvent(taskId, { type: "log", content: `[mixed] routed code-critical → ${route.tier}${route.frontierReviewDebt ? " (frontier review queued)" : ""} → ${resolved ?? "unavailable"}` });
    if (route.frontierReviewDebt) {
      // Record the debt so it can be replayed as a frontier review when cloud-ok returns.
      const { enqueueFrontierDebt } = await import("@/lib/orchestrator/frontier-debt");
      enqueueFrontierDebt(taskId, project ?? null, projectPath);
    }
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
    const route = routeByRole("code-critical", policy, { noLocal: true });
    // noLocalOverrides: a local model configured as a role override must not
    // leak into the cloud-only posture.
    const resolved = resolveModelId(route.tier, { noLocalOverrides: true });
    onEvent(taskId, { type: "log", content: `[cloud-only] routed code-critical → ${route.tier} → ${resolved ?? "unavailable"}` });
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

  const isOps = project ? NO_REPO_LOCK_PROJECTS.has(project) : false;
  const { isChannelEnabled: isMailLaneEnabled } = await import("@/lib/mailbee/store");
  const { isChannelEnabled: isMessageLaneEnabled } = await import("@/lib/messagebee/store");
  const mailLaneEnabled = isMailLaneEnabled();
  const messageLaneEnabled = isMessageLaneEnabled();
  // First-class outbound tools (Message Lane/Mail Lane) via a bundled MCP server, so
  // SENDING is a real tool call the harness can't talk itself out of (it once
  // claimed "No SMS tool available" and punted). The server proxies the same
  // trust-gated daemon endpoints; auto-approve them since the gate is server-side.
  const outboundMcp = prepareOutboundMcp(process.env.HIVEMATRIX_PORT ?? "3747", process.execPath, { mailLaneEnabled, messageLaneEnabled });
  const tools = [...(isOps ? getOpsAllowedTools() : ALLOWED_TOOLS), ...outboundMcp.toolNames];

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
    tools,
    maxBudgetUsd,
    model,
    thinkingMode: effectiveThinkingMode,
    fastMode,
    resumeSessionId,
  });

  // Register the outbound MCP server (merges with any user-configured servers —
  // no --strict-mcp-config). Pairs with the tool names already in `tools`.
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

  // Video factory — only advertised when the operator enabled the `video` feature.
  try {
    const { isFeatureEnabled } = await import("@/lib/config/features");
    if (isFeatureEnabled("video")) {
      const { videoRoutingPrompt } = await import("./outbound-routing");
      const videoRouting = videoRoutingPrompt();
      args.push("--append-system-prompt", videoRouting);
      overheadBytes.agentGuide += Buffer.byteLength(videoRouting);
    }
  } catch { /* non-critical */ }

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

  // Inject agent profile system prompt for non-developer types
  if (agentType && agentType !== "developer" && agentType !== "auto") {
    const agentProfile = getAgentProfile(agentType);
    const profilePrompt = `\n\n--- Agent Role ---\n${agentProfile.systemPrompt}`;
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
  const proc = spawn(claudeBinary, spawnArgs, {
    cwd: projectPath,
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

export function killAgent(proc: ChildProcess): Promise<void> {
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
    }, 5000);

    proc.once("exit", () => {
      clearTimeout(forceTimeout);
      resolve();
    });

    proc.kill("SIGTERM");
  });
}
