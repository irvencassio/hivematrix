import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from "fs";
import { dirname, resolve, relative, extname } from "path";
import { AGENT_PROFILE_IDS } from "@/lib/config/agent-profiles";
import { readToken } from "@/lib/auth/token";
import { validateDag } from "@/lib/orchestrator/dag-engine";

const execAsync = promisify(exec);

const DEFAULT_READ_LINE_LIMIT = 240;
const MAX_READ_LINE_LIMIT = 800;
const READ_FILE_MAX_CHARS = 20_000;
const TEXT_TOOL_MAX_CHARS = 20_000;
const GENERATED_DIR_EXCLUDES = [
  ".git",
  ".claude",
  "node_modules",
  "dist",
  "build",
  ".next",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".turbo",
  "coverage",
];
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".heic",
  ".avif",
  ".ico",
  ".icns",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".mp3",
  ".mp4",
  ".mov",
  ".m4a",
  ".wav",
  ".sqlite",
  ".db",
]);

/** OpenAI-style function tool definition shared by the local agent tool set. */
export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Tool definitions in OpenAI function-calling format.
 * These are sent to the model so it knows what tools are available.
 */
export const TOOL_DEFINITIONS: ChatTool[] = [
  {
    type: "function" as const,
    function: {
      name: "bash",
      description: "Execute a shell command and return its output. Use for git, npm, build tools, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the contents of a file. Returns the file content as text.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file (relative to project root or absolute)" },
          offset: { type: "number", description: "Line number to start reading from (1-based)" },
          limit: { type: "number", description: "Maximum number of lines to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write content to a file. Creates parent directories if needed. If your file is large, do not try to write it in one call — write the first chunk with mode=\"overwrite\" (the default), then write each following chunk with mode=\"append\". Keep each chunk well under your output budget.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          content: { type: "string", description: "Content to write" },
          mode: { type: "string", enum: ["overwrite", "append"], description: "overwrite (default) replaces the file; append adds to the end, creating the file if it doesn't exist yet." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description: "Replace an exact string in a file with new content. The old_string must appear exactly once in the file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          old_string: { type: "string", description: "The exact text to find and replace" },
          new_string: { type: "string", description: "The replacement text" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search",
      description: "Search file contents for a regex pattern. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Directory or file to search in (default: project root)" },
          glob: { type: "string", description: "File glob pattern to filter (e.g. '*.ts')" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List files matching a glob pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. 'src/**/*.ts')" },
          path: { type: "string", description: "Base directory (default: project root)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_task",
      description: "Create a subtask and delegate it to a specialist agent. Use this to break complex work into parts handled by the right expert.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Clear, specific task description with enough context for the agent to work independently",
          },
          agentType: {
            type: "string",
            enum: AGENT_PROFILE_IDS,
            description: "The specialist agent type to handle this subtask",
          },
          project: {
            type: "string",
            description: "Project name to run the task in (e.g., 'hive', 'ops'). Defaults to parent task's project.",
          },
          dependsOn: {
            type: "array",
            items: { type: "string" },
            description: "Optional: ids of this task's OWN sibling subtasks (created earlier in this same delegation) that must finish before this one is claimed. Only valid when creating a subtask; every id must be a real sibling.",
          },
        },
        required: ["description", "agentType"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "dispatch_capability",
      description: "Route a request to a HiveMatrix capability lane (browser, mail, message, desktop) via the typed COO dispatcher — for \"go do X in the world\" actions (browse a site, send an email), not for delegating to a specialist role (use create_task for that) and not for shell/terminal work (use Canopy for that). Honors real risk tiers and approval policy: mail/message/desktop actions always come back as approval_required and are never auto-approved; memory/review report as unsupported.",
      parameters: {
        type: "object",
        properties: {
          request: {
            type: "string",
            description: "What you want done, in plain language.",
          },
          domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional: target domain(s) for a browser request.",
          },
          project: {
            type: "string",
            description: "Optional project label.",
          },
        },
        required: ["request"],
      },
    },
  },
];

/** Context passed to tool execution for delegation safety. */
export interface ToolContext {
  parentTaskId?: string;
  parentProject?: string;
  currentAgentType?: string;
  /**
   * Absolute paths of files the agent has written or edited this run. Populated by
   * the write/edit tools so the verification gate can smoke-run exactly what changed.
   */
  touchedFiles?: Set<string>;
  /** Optional directive run ID for idempotent message/send guards. */
  runId?: string;
}

/**
 * Execute a tool call and return the result string.
 */
export async function executeTool(
  name: string,
  argsJson: string,
  projectPath: string,
  context?: ToolContext
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    // An unterminated string or unbalanced braces at end-of-input is the
    // signature of a call cut off by max_tokens, not a malformed-but-complete
    // payload — the two need different guidance for the model to recover.
    const looksTruncated = argsJson.length > 0 && !argsJson.trimEnd().endsWith("}");
    if (looksTruncated) {
      return `Error: tool arguments were cut off mid-JSON and were NOT executed (received ${argsJson.length} chars). Nothing changed on disk. If you are writing a large file, split it: write_file with mode="overwrite" for the first chunk, then mode="append" for each subsequent chunk.`;
    }
    return `Error: Invalid JSON arguments (${argsJson.length} chars): ${argsJson.slice(0, 200)}`;
  }

  try {
    switch (name) {
      case "bash":
        return await executeBash(args, projectPath);
      case "read_file":
        return executeReadFile(args, projectPath);
      case "write_file":
        return executeWriteFile(args, projectPath, context);
      case "edit_file":
        return executeEditFile(args, projectPath, context);
      case "search":
        return await executeSearch(args, projectPath);
      case "list_files":
        return await executeListFiles(args, projectPath);
      case "create_task":
        return await executeCreateTask(args, context);
      case "dispatch_capability":
        return await executeDispatchCapability(args);
      default: {
        // Embedded capability lanes (Browser Lane / Desktop Lane) are
        // resolved by the lane-tools module, which enforces the connectivity
        // policy gate before dispatching.
        const { isLaneTool, executeLaneTool } = await import("./lane-tools");
        if (isLaneTool(name)) {
          return await executeLaneTool(name, args, {
            projectPath,
            project: context?.parentProject ?? "ops",
            requestedBy: context?.parentTaskId ? `task:${context.parentTaskId}` : "hive",
            runId: context?.runId,
          });
        }
        return `Error: Unknown tool "${name}"`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: ${msg}`;
  }
}

function resolvePath(p: string, projectPath: string): string {
  if (p.startsWith("/")) return p;
  return resolve(projectPath, p);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${shellQuote(command)} >/dev/null 2>&1`, { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

function rgExcludeArgs(): string {
  return GENERATED_DIR_EXCLUDES.map((dir) => `-g ${shellQuote(`!**/${dir}/**`)}`).join(" ");
}

function findPruneExpression(): string {
  return GENERATED_DIR_EXCLUDES.map((dir) => `-name ${shellQuote(dir)}`).join(" -o ");
}

function cappedTextOutput(output: string, maxChars = TEXT_TOOL_MAX_CHARS): string {
  if (output.length <= maxChars) return output;
  return `${output.slice(0, maxChars)}\n\n[truncated: tool output exceeded ${maxChars} chars; narrow the path, glob, or query to continue.]`;
}

function safePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const byte of sample) {
    const isAllowedControl = byte === 9 || byte === 10 || byte === 12 || byte === 13;
    if (byte < 32 && !isAllowedControl) suspicious += 1;
  }
  return suspicious / sample.length > 0.03;
}

async function executeBash(args: Record<string, unknown>, projectPath: string): Promise<string> {
  const command = args.command as string;
  if (!command) return "Error: No command provided";

  // Async exec — must NOT block the daemon event loop. A synchronous execSync
  // here freezes the HTTP server, scheduler, and every other in-flight task for
  // the command's duration (up to the timeout); fatal for a 24x7 daemon.
  // `killSignal: SIGKILL` ensures a hung command is actually torn down at the
  // timeout rather than lingering as a detached child.
  try {
    const { stdout } = await execAsync(command, {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 120_000, // 2 min timeout
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024 * 10, // 10MB
      env: { ...process.env, HIVE_AGENT: "1" },
    });
    return stdout.slice(0, 50_000); // Cap output at 50KB
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; signal?: string };
    if (execErr.killed || execErr.signal) {
      return `Error: command timed out or was killed (signal ${execErr.signal ?? "?"}) after 120s`;
    }
    const stdout = (execErr.stdout ?? "").slice(0, 20_000);
    const stderr = (execErr.stderr ?? "").slice(0, 20_000);
    return `Exit code: ${execErr.code ?? "unknown"}\nStdout: ${stdout}\nStderr: ${stderr}`;
  }
}

function executeReadFile(args: Record<string, unknown>, projectPath: string): string {
  if (typeof args.path !== "string" || !args.path) return "Error: No path provided";
  const filePath = resolvePath(args.path as string, projectPath);
  if (!existsSync(filePath)) return `Error: File not found: ${filePath}`;
  if (!statSync(filePath).isFile()) return `Error: Not a regular file: ${filePath}`;

  const relPath = relative(projectPath, filePath) || filePath;
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return `Error: File appears to be binary or image data and cannot be read as text: ${relPath}. Use a visual inspection/OCR path or ask for a textual description instead.`;
  }

  const buffer = readFileSync(filePath);
  if (looksBinary(buffer)) {
    return `Error: File appears to be binary or image data and cannot be read as text: ${relPath}. Use a visual inspection/OCR path or ask for a textual description instead.`;
  }

  const content = buffer.toString("utf-8");
  const lines = content.split("\n");

  const offsetLine = safePositiveInteger(args.offset, 1);
  const offset = offsetLine - 1; // Convert to 0-based
  const requestedLimit = safePositiveInteger(args.limit, DEFAULT_READ_LINE_LIMIT);
  const limit = Math.min(requestedLimit, MAX_READ_LINE_LIMIT);
  const sliced = lines.slice(Math.max(0, offset), offset + limit);

  // Format with line numbers
  let output = sliced
    .map((line, i) => `${offset + i + 1}\t${line}`)
    .join("\n");

  const truncatedByLines = offset + sliced.length < lines.length;
  const truncatedByLimitClamp = requestedLimit > MAX_READ_LINE_LIMIT;
  let truncatedByChars = false;
  if (output.length > READ_FILE_MAX_CHARS) {
    output = output.slice(0, READ_FILE_MAX_CHARS);
    truncatedByChars = true;
  }

  if (truncatedByLines || truncatedByLimitClamp || truncatedByChars) {
    const nextOffset = offset + sliced.length + 1;
    output += `\n\n[truncated: showing lines ${offset + 1}-${offset + sliced.length} of ${lines.length}; ask for a narrower read with offset=${nextOffset} and limit=${Math.min(DEFAULT_READ_LINE_LIMIT, Math.max(1, lines.length - offset - sliced.length))} to continue.]`;
  }

  return output;
}

function executeWriteFile(args: Record<string, unknown>, projectPath: string, context?: ToolContext): string {
  const filePath = resolvePath(args.path as string, projectPath);
  const content = args.content as string;
  if (content === undefined) return "Error: No content provided";

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const append = args.mode === "append";
  if (append) {
    appendFileSync(filePath, content);
    context?.touchedFiles?.add(filePath);
    return `File appended: ${relative(projectPath, filePath)} (+${content.length} bytes)`;
  }

  writeFileSync(filePath, content);
  context?.touchedFiles?.add(filePath);
  return `File written: ${relative(projectPath, filePath)} (${content.length} bytes)`;
}

function executeEditFile(args: Record<string, unknown>, projectPath: string, context?: ToolContext): string {
  const filePath = resolvePath(args.path as string, projectPath);
  if (!existsSync(filePath)) return `Error: File not found: ${filePath}`;

  const oldStr = args.old_string as string;
  const newStr = args.new_string as string;
  if (!oldStr) return "Error: old_string is required";

  const content = readFileSync(filePath, "utf-8");
  const count = content.split(oldStr).length - 1;

  if (count === 0) return `Error: old_string not found in ${relative(projectPath, filePath)}`;
  if (count > 1) return `Error: old_string found ${count} times — must be unique`;

  writeFileSync(filePath, content.replace(oldStr, newStr));
  context?.touchedFiles?.add(filePath);
  return `Edited: ${relative(projectPath, filePath)}`;
}

async function executeSearch(args: Record<string, unknown>, projectPath: string): Promise<string> {
  const pattern = args.pattern as string;
  if (!pattern) return "Error: No pattern provided";

  const searchPath = args.path ? resolvePath(args.path as string, projectPath) : projectPath;
  const globFilter = (args.glob as string) ?? "";

  try {
    if (await commandExists("rg")) {
      const globArg = globFilter ? `-g ${shellQuote(globFilter)}` : "";
      const { stdout } = await execAsync(
        `rg --line-number --hidden --no-heading ${globArg} ${rgExcludeArgs()} -e ${shellQuote(pattern)} ${shellQuote(searchPath)} 2>/dev/null | head -100`,
        { encoding: "utf-8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 * 5 }
      );
      return cappedTextOutput(stdout) || "No matches found";
    }

    const includeArg = globFilter ? `--include=${shellQuote(globFilter)}` : "";
    const excludeArgs = GENERATED_DIR_EXCLUDES.map((dir) => `--exclude-dir=${shellQuote(dir)}`).join(" ");
    const { stdout } = await execAsync(
      `grep -rn ${includeArg} ${excludeArgs} -E ${shellQuote(pattern)} ${shellQuote(searchPath)} 2>/dev/null | head -100`,
      { encoding: "utf-8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 * 5 }
    );
    return cappedTextOutput(stdout) || "No matches found";
  } catch {
    return "No matches found";
  }
}

const MAX_SUBTASKS_PER_PARENT = 10;

async function executeCreateTask(args: Record<string, unknown>, context?: ToolContext): Promise<string> {
  const description = args.description as string;
  const agentType = args.agentType as string;
  const project = (args.project as string) || context?.parentProject || "ops";
  const parentTaskId = context?.parentTaskId ?? null;
  const source = context?.currentAgentType ? `agent:${context.currentAgentType}` : "agent";
  const dependsOn = Array.isArray(args.dependsOn)
    ? args.dependsOn.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    : [];

  if (!description || !agentType) {
    return "Error: description and agentType are required";
  }

  // Subtask delegation goes through the daemon's task API on the local port,
  // authenticated with the daemon shared-secret token.
  const base = `http://127.0.0.1:${process.env.HIVEMATRIX_PORT ?? "3747"}`;
  const token = readToken("auth-token") ?? "";
  const authArg = `-H "Authorization: Bearer ${token}"`;

  let siblings: Array<{ _id: string; dependsOn: string[] }> = [];

  if (parentTaskId) {
    // Safety: check subtask depth (max 2 levels). Fails CLOSED — if the
    // check itself can't be verified (network blip, malformed response),
    // the create is refused rather than allowed through, or a transient
    // failure would let a coordinator exceed its depth cap undetected.
    try {
      const { stdout } = await execAsync(
        `curl -s ${authArg} ${base}/tasks/${parentTaskId}`,
        { encoding: "utf-8", timeout: 5_000, killSignal: "SIGKILL" }
      );
      const parentTask = JSON.parse(stdout);
      if (!parentTask || typeof parentTask !== "object" || typeof parentTask._id !== "string") {
        return "Error: Could not verify subtask depth — refusing to create a subtask.";
      }
      if (parentTask.parentTaskId) {
        // Parent already has a parent → this would be depth 3 — reject
        return "Error: Maximum subtask depth (2 levels) reached. A subtask cannot create subtasks.";
      }
    } catch {
      return "Error: Could not verify subtask depth — refusing to create a subtask.";
    }

    // Safety: check subtask count (max 10 per parent), and fetch real
    // siblings (for dependsOn validation below). Fails CLOSED for the same
    // reason as the depth check.
    try {
      const { stdout } = await execAsync(
        `curl -s ${authArg} "${base}/tasks?parentTaskId=${parentTaskId}"`,
        { encoding: "utf-8", timeout: 5_000, killSignal: "SIGKILL" }
      );
      const raw = JSON.parse(stdout);
      const rows: Array<Record<string, unknown>> | null = Array.isArray(raw)
        ? raw
        : (raw && Array.isArray(raw.tasks) ? raw.tasks : null);
      if (!rows) {
        return "Error: Could not verify sibling count — refusing to create a subtask.";
      }
      siblings = rows.map((r) => ({
        _id: String(r._id),
        dependsOn: parseDependsOnColumn(r.dependsOn),
      }));
      if (siblings.length >= MAX_SUBTASKS_PER_PARENT) {
        return `Error: Maximum subtasks per parent (${MAX_SUBTASKS_PER_PARENT}) reached.`;
      }
    } catch {
      return "Error: Could not verify sibling count — refusing to create a subtask.";
    }
  }

  if (dependsOn.length > 0) {
    if (!parentTaskId) {
      return "Error: dependsOn is only valid when creating a subtask (a top-level task has no siblings to depend on).";
    }
    const siblingIds = new Set(siblings.map((s) => s._id));
    const unknownIds = dependsOn.filter((id) => !siblingIds.has(id));
    if (unknownIds.length > 0) {
      return `Error: dependsOn references task(s) that are not siblings of this subtask: ${unknownIds.join(", ")}`;
    }
    const dagCheck = validateDag([
      ...siblings.map((s) => ({ _id: s._id, status: "backlog", dependsOn: s.dependsOn })),
      { _id: "__pending_new_task__", status: "backlog", dependsOn },
    ]);
    if (!dagCheck.valid) {
      return "Error: dependsOn would create a dependency cycle.";
    }
  }

  try {
    const body = JSON.stringify({
      description,
      agentType,
      project,
      source,
      parentTaskId,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
    });
    const { stdout } = await execAsync(
      `curl -s -X POST ${authArg} ${base}/tasks -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8", timeout: 10_000, killSignal: "SIGKILL" }
    );
    const task = JSON.parse(stdout);
    return `Created task ${task._id}: "${task.title}" (agent: ${agentType}, project: ${project})`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error creating task: ${msg}`;
  }
}

function parseDependsOnColumn(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Routes through the daemon's existing typed COO dispatcher (POST
 * /coo/dispatch, prepare-only — no `create`) rather than reimplementing
 * routing/risk-tier/approval logic here. Gives delegation the same risk
 * tiers and approval gates create_task bypasses: browser comes back
 * "prepared" (a real work item), mail/message/desktop always come back
 * "approval_required" (never auto-approved), memory/review come back
 * "unsupported", and the caller must report that honestly rather than
 * improvising with bash.
 */
async function executeDispatchCapability(args: Record<string, unknown>): Promise<string> {
  const request = typeof args.request === "string" ? args.request.trim() : "";
  if (!request) return "Error: request is required";
  const domains = Array.isArray(args.domains)
    ? args.domains.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    : undefined;
  const project = typeof args.project === "string" && args.project.trim() ? args.project.trim() : undefined;

  const base = `http://127.0.0.1:${process.env.HIVEMATRIX_PORT ?? "3747"}`;
  const token = readToken("auth-token") ?? "";
  const authArg = `-H "Authorization: Bearer ${token}"`;

  try {
    const body = JSON.stringify({ text: request, domains, project });
    const { stdout } = await execAsync(
      `curl -s -X POST ${authArg} ${base}/coo/dispatch -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8", timeout: 15_000, killSignal: "SIGKILL" }
    );
    const parsed = JSON.parse(stdout) as { ok?: boolean; error?: string; result?: {
      status: string; lane: string | null; capability: string | null; reason: string;
      approval: { required: boolean; trust: string } | null;
    } };
    if (!parsed.ok || !parsed.result) {
      return `Error dispatching capability: ${parsed.error ?? "unknown error"}`;
    }
    const r = parsed.result;
    switch (r.status) {
      case "no_match":
        return `No capability route matched this request. ${r.reason}`;
      case "unsupported":
        return `Unsupported — no execution bridge for this yet. ${r.reason}`;
      case "approval_required":
        return `APPROVAL REQUIRED — not executed. This must be surfaced to the operator, never treated as done. ${r.reason} Trust boundary: ${r.approval?.trust ?? "n/a"}`;
      case "needs_input":
        return `Needs more input before this can route: ${r.reason}`;
      case "prepared":
        return `Prepared (lane: ${r.lane}, capability: ${r.capability}). ${r.reason}`;
      default:
        return r.reason;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error dispatching capability: ${msg}`;
  }
}

async function executeListFiles(args: Record<string, unknown>, projectPath: string): Promise<string> {
  const pattern = args.pattern as string;
  if (!pattern) return "Error: No pattern provided";

  const basePath = args.path ? resolvePath(args.path as string, projectPath) : projectPath;

  try {
    if (await commandExists("rg")) {
      const { stdout } = await execAsync(
        `rg --files --hidden -g ${shellQuote(pattern)} ${rgExcludeArgs()} ${shellQuote(basePath)} 2>/dev/null | head -200`,
        { encoding: "utf-8", timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }
      );
      return cappedTextOutput(stdout) || "No files found";
    }

    const prune = findPruneExpression();
    const { stdout } = await execAsync(
      `find ${shellQuote(basePath)} \\( ${prune} \\) -prune -o -type f -path ${shellQuote(`*/${pattern}`)} -print 2>/dev/null | head -200`,
      { encoding: "utf-8", timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }
    );
    return cappedTextOutput(stdout) || "No files found";
  } catch {
    return "No files found";
  }
}
