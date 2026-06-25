import { homedir } from "os";
import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";

export type VoiceBrowserLaneIntent =
  | { mode: "search"; query: string }
  | { mode: "read"; url: string; query?: string }
  | { mode: "open"; url: string; objective: string };

export interface VoiceBrowserLaneTask {
  title: string;
  description: string;
  project: string;
  projectPath: string;
  status: "backlog";
  executor: "agent";
  source: "browser-lane";
  output: {
    voice?: Record<string, unknown>;
    browserLaneVoice: { args: VoiceBrowserLaneIntent };
  };
}

const SECRETISH = /\b(password|passcode|secret|token|cookie|api[-_\s]?key|bearer)\b/i;

function clean(value: string): string {
  return value.replace(/[.?!,\s]+$/g, "").trim();
}

function stripLeadIn(text: string): string | null {
  const trimmed = clean(text);
  const match = trimmed.match(/^(?:please\s+)?(?:use\s+)?(?:the\s+)?browser\s+lane(?:\s+to)?\s+(.+)$/i);
  return match ? clean(match[1]) : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function detectVoiceBrowserLaneIntent(text: string): VoiceBrowserLaneIntent | null {
  const rest = stripLeadIn(text);
  if (!rest || SECRETISH.test(rest)) return null;

  const search = rest.match(/^(?:search|look\s*up|lookup|google|find)\s+(.+)$/i);
  if (search && clean(search[1])) {
    return { mode: "search", query: clean(search[1]) };
  }

  const read = rest.match(/^(?:read|summarize)\s+(\S+)(?:\s+(.+))?$/i);
  if (read && isHttpUrl(read[1])) {
    const query = clean(read[2] ?? "");
    return { mode: "read", url: read[1], ...(query ? { query } : {}) };
  }

  const open = rest.match(/^(?:open|go\s+to|navigate\s+to)\s+(\S+)(?:\s+(.+))?$/i);
  if (open && isHttpUrl(open[1])) {
    const extra = clean(open[2] ?? "");
    return { mode: "open", url: open[1], objective: extra || `Open ${open[1]}` };
  }

  return null;
}

export function buildVoiceBrowserLaneTask(
  args: VoiceBrowserLaneIntent,
  opts: { titlePrefix?: string; projectPath?: string; voice?: Record<string, unknown> } = {},
): VoiceBrowserLaneTask {
  const label = args.mode === "search"
    ? args.query
    : args.mode === "read"
      ? args.url
      : args.objective;
  const title = `${opts.titlePrefix ?? "Browser Lane"}: Browser Lane ${args.mode} ${label}`.slice(0, 100);
  const json = JSON.stringify({ args }, null, 2);
  return {
    title,
    description: [
      "Explicit voice request: use Browser Lane.",
      "",
      "Do not use WebSearch, Chrome MCP, or ad-hoc browser tools for this task.",
      "Call HiveMatrix's Browser Lane endpoint and report the returned result:",
      "",
      "```bash",
      `curl -s -X POST "http://127.0.0.1:\${HIVEMATRIX_PORT:-3747}/lane/browser" \\`,
      `  -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${JSON.stringify({ args })}'`,
      "```",
      "",
      "Equivalent model tool: hivematrix_browser",
      "",
      "Browser Lane args:",
      "```json",
      json,
      "```",
    ].join("\n"),
    project: DEFAULT_TASK_PROJECT,
    projectPath: opts.projectPath ?? homedir(),
    status: "backlog",
    executor: "agent",
    source: "browser-lane",
    output: {
      ...(opts.voice ? { voice: opts.voice } : {}),
      browserLaneVoice: { args },
    },
  };
}
