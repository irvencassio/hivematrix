import { homedir } from "os";
import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";

export type VoiceBrowserLaneIntent =
  | { mode: "search"; query: string }
  | { mode: "read"; url: string; query?: string }
  | { mode: "open"; url: string; objective: string }
  | { mode: "workflow"; objective: string; startUrl: string; requiresLogin: true };

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
  const direct = trimmed.match(/^(?:please\s+)?(?:use\s+)?(?:the\s+)?browser\s+lane(?:\s+to)?\s+(.+)$/i);
  if (direct) return clean(direct[1]);
  const infixAnd = trimmed.match(/^(.+?)\s+(?:in|with|using)\s+(?:the\s+)?browser\s+lane\s+(?:and|to)\s+(.+)$/i);
  if (infixAnd) return clean(`${infixAnd[1]} and ${infixAnd[2]}`);
  const trailing = trimmed.match(/^(.+?)\s+(?:in|with|using)\s+(?:the\s+)?browser\s+lane$/i);
  if (trailing) return clean(trailing[1]);
  const webSearch = trimmed.match(/^(?:please\s+)?search\s+the\s+web\s+(?:for\s+)?(.+)$/i);
  if (webSearch) return `search ${clean(webSearch[1])}`;
  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasWorkflowCue(value: string): boolean {
  return /\b(sign\s*in|signin|log\s*in|login|log\s*into|authenticated|auth|workflow|check|see\s+if|look\s+for|review|triage|status|requests?|invitations?|unread)\b/i.test(value);
}

function workflowIntent(rest: string): VoiceBrowserLaneIntent | null {
  const value = clean(rest);
  const lower = value.toLowerCase();
  if (!hasWorkflowCue(value)) return null;

  if (/\blinkedin\b/.test(lower)) {
    if (/\bconnection\s+requests?\b/.test(lower)) {
      return {
        mode: "workflow",
        objective: "Check LinkedIn connection requests",
        startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        requiresLogin: true,
      };
    }
    if (/\bfriend\s+requests?\b/.test(lower)) {
      return {
        mode: "workflow",
        objective: "Check LinkedIn friend requests",
        startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        requiresLogin: true,
      };
    }
    if (/\binvitations?\b/.test(lower)) {
      return {
        mode: "workflow",
        objective: "Check LinkedIn invitations",
        startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        requiresLogin: true,
      };
    }
    if (/\brequests?\b/.test(lower)) {
      return {
        mode: "workflow",
        objective: "Check LinkedIn requests",
        startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        requiresLogin: true,
      };
    }
    return {
      mode: "workflow",
      objective: "Open LinkedIn workflow",
      startUrl: "https://www.linkedin.com/feed/",
      requiresLogin: true,
    };
  }

  if (/\bgmail\b|\bgoogle\s+mail\b/.test(lower)) {
    if (/\bunread\b/.test(lower)) {
      return {
        mode: "workflow",
        objective: "Check Gmail unread mail",
        startUrl: "https://mail.google.com/mail/u/0/#inbox",
        requiresLogin: true,
      };
    }
    return {
      mode: "workflow",
      objective: "Check Gmail",
      startUrl: "https://mail.google.com/mail/u/0/#inbox",
      requiresLogin: true,
    };
  }

  if (/\bheygen\b/.test(lower)) {
    if (/\bvideo\b.*\bstatus\b|\bstatus\b.*\bvideo\b/.test(lower)) {
      return {
        mode: "workflow",
        objective: "Check HeyGen video status",
        startUrl: "https://app.heygen.com/home",
        requiresLogin: true,
      };
    }
    return {
      mode: "workflow",
      objective: "Run HeyGen workflow",
      startUrl: "https://app.heygen.com/home",
      requiresLogin: true,
    };
  }

  const urlMatch = value.match(/\bhttps?:\/\/\S+/i);
  if (urlMatch && isHttpUrl(urlMatch[0])) {
    return {
      mode: "workflow",
      objective: value,
      startUrl: urlMatch[0],
      requiresLogin: true,
    };
  }

  return null;
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

  const workflow = workflowIntent(rest);
  if (workflow) return workflow;

  const readSearch = rest.match(/^(?:read|summarize|research|check|inspect)\s+(.+)$/i);
  if (readSearch && clean(readSearch[1])) {
    return { mode: "search", query: clean(readSearch[1]) };
  }

  const open = rest.match(/^(?:open|go\s+to|navigate\s+to)\s+(\S+)(?:\s+(.+))?$/i);
  if (open && isHttpUrl(open[1])) {
    const extra = clean(open[2] ?? "");
    return { mode: "open", url: open[1], objective: extra || `Open ${open[1]}` };
  }
  if (open && clean(rest.replace(/^(?:open|go\s+to|navigate\s+to)\s+/i, ""))) {
    return { mode: "search", query: clean(rest.replace(/^(?:open|go\s+to|navigate\s+to)\s+/i, "")) };
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
      ...(args.mode === "workflow"
        ? [
            "This is a Browser Lane workflow task, not a generic code or research task.",
            `Requires login: ${args.requiresLogin ? "yes" : "no"}. If Browser Lane reports a missing session, sign-in prompt, or 2FA challenge, stop and report exactly what the operator must complete.`,
            "",
          ]
        : []),
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
