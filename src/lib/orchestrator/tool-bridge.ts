import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve, relative } from "path";
import { AGENT_PROFILE_IDS } from "@/lib/config/agent-profiles";
import { readToken } from "@/lib/auth/token";

const execAsync = promisify(exec);

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
      description: "Write content to a file. Creates parent directories if needed. Overwrites existing files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          content: { type: "string", description: "Content to write" },
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
        },
        required: ["description", "agentType"],
      },
    },
  },
];

/** Context passed to tool execution for delegation safety. */
export interface ToolContext {
  parentTaskId?: string;
  parentProject?: string;
  currentAgentType?: string;
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
    return `Error: Invalid JSON arguments: ${argsJson.slice(0, 200)}`;
  }

  try {
    switch (name) {
      case "bash":
        return await executeBash(args, projectPath);
      case "read_file":
        return executeReadFile(args, projectPath);
      case "write_file":
        return executeWriteFile(args, projectPath);
      case "edit_file":
        return executeEditFile(args, projectPath);
      case "search":
        return await executeSearch(args, projectPath);
      case "list_files":
        return await executeListFiles(args, projectPath);
      case "create_task":
        return await executeCreateTask(args, context);
      default: {
        // Embedded capability lanes (Browser Lane / DesktopBee) are
        // resolved by the bee-tools module, which enforces the connectivity
        // policy gate before dispatching.
        const { isBeeTool, executeBeeTool } = await import("./bee-tools");
        if (isBeeTool(name)) {
          return await executeBeeTool(name, args, {
            projectPath,
            project: context?.parentProject ?? "ops",
            requestedBy: context?.parentTaskId ? `task:${context.parentTaskId}` : "hive",
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
  const filePath = resolvePath(args.path as string, projectPath);
  if (!existsSync(filePath)) return `Error: File not found: ${filePath}`;

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const offset = ((args.offset as number) ?? 1) - 1; // Convert to 0-based
  const limit = (args.limit as number) ?? lines.length;
  const sliced = lines.slice(Math.max(0, offset), offset + limit);

  // Format with line numbers
  return sliced
    .map((line, i) => `${offset + i + 1}\t${line}`)
    .join("\n")
    .slice(0, 100_000); // Cap at 100KB
}

function executeWriteFile(args: Record<string, unknown>, projectPath: string): string {
  const filePath = resolvePath(args.path as string, projectPath);
  const content = args.content as string;
  if (content === undefined) return "Error: No content provided";

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(filePath, content);
  return `File written: ${relative(projectPath, filePath)} (${content.length} bytes)`;
}

function executeEditFile(args: Record<string, unknown>, projectPath: string): string {
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
  return `Edited: ${relative(projectPath, filePath)}`;
}

async function executeSearch(args: Record<string, unknown>, projectPath: string): Promise<string> {
  const pattern = args.pattern as string;
  if (!pattern) return "Error: No pattern provided";

  const searchPath = args.path ? resolvePath(args.path as string, projectPath) : projectPath;
  const globFilter = (args.glob as string) ?? "";

  // Use grep for search (faster than walking the tree). Async so a grep over a
  // large tree never blocks the daemon event loop.
  const globArg = globFilter ? `--include="${globFilter}"` : "";
  try {
    const { stdout } = await execAsync(
      `grep -rn ${globArg} -E ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>/dev/null | head -100`,
      { encoding: "utf-8", timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 * 5 }
    );
    return stdout.slice(0, 50_000) || "No matches found";
  } catch {
    return "No matches found";
  }
}

const MAX_SUBTASK_DEPTH = 2;
const MAX_SUBTASKS_PER_PARENT = 10;

async function executeCreateTask(args: Record<string, unknown>, context?: ToolContext): Promise<string> {
  const description = args.description as string;
  const agentType = args.agentType as string;
  const project = (args.project as string) || context?.parentProject || "ops";
  const parentTaskId = context?.parentTaskId ?? null;
  const source = context?.currentAgentType ? `agent:${context.currentAgentType}` : "agent";

  if (!description || !agentType) {
    return "Error: description and agentType are required";
  }

  // Subtask delegation goes through the daemon's task API on the local port,
  // authenticated with the daemon shared-secret token.
  const base = `http://127.0.0.1:${process.env.HIVEMATRIX_PORT ?? "3747"}`;
  const token = readToken("auth-token") ?? "";
  const authArg = `-H "Authorization: Bearer ${token}"`;

  // Safety: check subtask depth (max 2 levels)
  if (parentTaskId) {
    try {
      const { stdout } = await execAsync(
        `curl -s ${authArg} ${base}/tasks/${parentTaskId}`,
        { encoding: "utf-8", timeout: 5_000, killSignal: "SIGKILL" }
      );
      const parentTask = JSON.parse(stdout);
      if (parentTask.parentTaskId) {
        // Parent already has a parent → this would be depth 3 — reject
        return "Error: Maximum subtask depth (2 levels) reached. A subtask cannot create subtasks.";
      }
    } catch {
      // If we can't verify depth, proceed cautiously
    }

    // Safety: check subtask count (max 10 per parent)
    try {
      const { stdout } = await execAsync(
        `curl -s ${authArg} "${base}/tasks?parentTaskId=${parentTaskId}"`,
        { encoding: "utf-8", timeout: 5_000, killSignal: "SIGKILL" }
      );
      const siblings = JSON.parse(stdout);
      const siblingCount = Array.isArray(siblings) ? siblings.length : (siblings.tasks?.length ?? 0);
      if (siblingCount >= MAX_SUBTASKS_PER_PARENT) {
        return `Error: Maximum subtasks per parent (${MAX_SUBTASKS_PER_PARENT}) reached.`;
      }
    } catch {
      // If we can't verify count, proceed cautiously
    }
  }

  try {
    const body = JSON.stringify({
      description,
      agentType,
      project,
      source,
      parentTaskId,
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

async function executeListFiles(args: Record<string, unknown>, projectPath: string): Promise<string> {
  const pattern = args.pattern as string;
  if (!pattern) return "Error: No pattern provided";

  const basePath = args.path ? resolvePath(args.path as string, projectPath) : projectPath;

  // Use find + glob pattern; async so a find over a large tree never blocks.
  try {
    const { stdout } = await execAsync(
      `find ${JSON.stringify(basePath)} -path "*/${pattern}" -o -name "${pattern}" 2>/dev/null | head -200`,
      { encoding: "utf-8", timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }
    );
    return stdout.slice(0, 50_000) || "No files found";
  } catch {
    return "No files found";
  }
}
