import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve, relative } from "path";
import { AGENT_PROFILE_IDS } from "@/lib/config/agent-profiles";

/**
 * Tool definitions in OpenAI function-calling format.
 * These are sent to the model so it knows what tools are available.
 */
export const TOOL_DEFINITIONS = [
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
export function executeTool(
  name: string,
  argsJson: string,
  projectPath: string,
  context?: ToolContext
): string {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return `Error: Invalid JSON arguments: ${argsJson.slice(0, 200)}`;
  }

  try {
    switch (name) {
      case "bash":
        return executeBash(args, projectPath);
      case "read_file":
        return executeReadFile(args, projectPath);
      case "write_file":
        return executeWriteFile(args, projectPath);
      case "edit_file":
        return executeEditFile(args, projectPath);
      case "search":
        return executeSearch(args, projectPath);
      case "list_files":
        return executeListFiles(args, projectPath);
      case "create_task":
        return executeCreateTask(args, context);
      default:
        return `Error: Unknown tool "${name}"`;
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

function executeBash(args: Record<string, unknown>, projectPath: string): string {
  const command = args.command as string;
  if (!command) return "Error: No command provided";

  try {
    const output = execSync(command, {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 120_000, // 2 min timeout
      maxBuffer: 1024 * 1024 * 10, // 10MB
      env: { ...process.env, HIVE_AGENT: "1" },
    });
    return output.slice(0, 50_000); // Cap output at 50KB
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    const stdout = (execErr.stdout ?? "").slice(0, 20_000);
    const stderr = (execErr.stderr ?? "").slice(0, 20_000);
    return `Exit code: ${execErr.status ?? "unknown"}\nStdout: ${stdout}\nStderr: ${stderr}`;
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

function executeSearch(args: Record<string, unknown>, projectPath: string): string {
  const pattern = args.pattern as string;
  if (!pattern) return "Error: No pattern provided";

  const searchPath = args.path ? resolvePath(args.path as string, projectPath) : projectPath;
  const globFilter = (args.glob as string) ?? "";

  // Use grep for search (faster than walking the tree)
  const globArg = globFilter ? `--include="${globFilter}"` : "";
  try {
    const output = execSync(
      `grep -rn ${globArg} -E ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>/dev/null | head -100`,
      { encoding: "utf-8", timeout: 30_000, maxBuffer: 1024 * 1024 * 5 }
    );
    return output.slice(0, 50_000) || "No matches found";
  } catch {
    return "No matches found";
  }
}

const MAX_SUBTASK_DEPTH = 2;
const MAX_SUBTASKS_PER_PARENT = 10;

function executeCreateTask(args: Record<string, unknown>, context?: ToolContext): string {
  const description = args.description as string;
  const agentType = args.agentType as string;
  const project = (args.project as string) || context?.parentProject || "ops";
  const parentTaskId = context?.parentTaskId ?? null;
  const source = context?.currentAgentType ? `agent:${context.currentAgentType}` : "agent";

  if (!description || !agentType) {
    return "Error: description and agentType are required";
  }

  // Safety: check subtask depth (max 2 levels)
  if (parentTaskId) {
    try {
      const depthResult = execSync(
        `curl -s http://localhost:4000/api/tasks/${parentTaskId}`,
        { encoding: "utf-8", timeout: 5_000 }
      );
      const parentTask = JSON.parse(depthResult);
      if (parentTask.parentTaskId) {
        // Parent already has a parent → this would be depth 3 — reject
        return "Error: Maximum subtask depth (2 levels) reached. A subtask cannot create subtasks.";
      }
    } catch {
      // If we can't verify depth, proceed cautiously
    }

    // Safety: check subtask count (max 10 per parent)
    try {
      const countResult = execSync(
        `curl -s "http://localhost:4000/api/tasks?parentTaskId=${parentTaskId}"`,
        { encoding: "utf-8", timeout: 5_000 }
      );
      const siblings = JSON.parse(countResult);
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
    const result = execSync(
      `curl -s -X POST http://localhost:4000/api/tasks -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8", timeout: 10_000 }
    );
    const task = JSON.parse(result);
    return `Created task ${task._id}: "${task.title}" (agent: ${agentType}, project: ${project})`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error creating task: ${msg}`;
  }
}

function executeListFiles(args: Record<string, unknown>, projectPath: string): string {
  const pattern = args.pattern as string;
  if (!pattern) return "Error: No pattern provided";

  const basePath = args.path ? resolvePath(args.path as string, projectPath) : projectPath;

  // Use find + glob pattern via bash
  try {
    const output = execSync(
      `find ${JSON.stringify(basePath)} -path "*/${pattern}" -o -name "${pattern}" 2>/dev/null | head -200`,
      { encoding: "utf-8", timeout: 15_000, maxBuffer: 1024 * 1024 }
    );
    return output.slice(0, 50_000) || "No files found";
  } catch {
    return "No files found";
  }
}
