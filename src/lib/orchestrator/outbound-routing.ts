/**
 * Outbound-channel bridge for the CLI executors (Claude Code, Codex).
 *
 * The local/generic (Qwen) agent gets first-class `mail_send` / `mail_draft`
 * / `message_send` function tools (see lane-tools.ts). The Claude Code and Codex
 * harnesses run their OWN toolset and never see those — which is exactly why an
 * "send this email" task historically got improvised with osascript instead of
 * going through the Mail Lane.
 *
 * The bridge: the daemon exposes the SAME trust-gated send path over loopback
 * HTTP (POST /mailbee/send|draft, /messagebee/send — see daemon/server.ts), and
 * we inject the routing block below into the CLI agent's system prompt so it
 * dispatches there with its Bash tool. The trust/allowlist gate runs server-side
 * in the daemon, so this is the single source of truth regardless of caller.
 */

export interface OutboundFields {
  to?: string;
  subject?: string;
  body?: string;
  text?: string;
  /** File paths to attach (repeated `attachment` form fields, or `attachments` JSON array). */
  attachments?: string[];
}

function pickString(o: Record<string, unknown>, k: string): string | undefined {
  return typeof o[k] === "string" ? (o[k] as string) : undefined;
}

function pickAttachments(o: Record<string, unknown>): string[] | undefined {
  const a = o.attachments ?? o.attachment;
  if (Array.isArray(a)) {
    const list = a.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
  if (typeof a === "string") {
    const list = a.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
  return undefined;
}

/**
 * Parse an outbound request body that may arrive as JSON OR as
 * application/x-www-form-urlencoded. `curl --data-urlencode` (the form we tell
 * the agent to use, because it sidesteps all JSON shell-escaping) defaults to
 * urlencoded, so both shapes must work.
 */
export function parseOutboundFields(contentType: string | undefined, raw: string): OutboundFields {
  const ct = (contentType ?? "").toLowerCase();
  const fromParams = (p: URLSearchParams): OutboundFields => {
    const att = p.getAll("attachment").concat(p.getAll("attachments")).map((s) => s.trim()).filter(Boolean);
    return {
      to: p.get("to") ?? undefined,
      subject: p.get("subject") ?? undefined,
      body: p.get("body") ?? undefined,
      text: p.get("text") ?? undefined,
      attachments: att.length ? att : undefined,
    };
  };

  if (ct.includes("application/x-www-form-urlencoded")) {
    return fromParams(new URLSearchParams(raw));
  }

  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    return { to: pickString(o, "to"), subject: pickString(o, "subject"), body: pickString(o, "body"), text: pickString(o, "text"), attachments: pickAttachments(o) };
  } catch {
    // No/!json content-type and not valid JSON — fall back to urlencoded parse
    // (covers a curl --data-urlencode call whose header we didn't match), but
    // only when a recognized field is actually present so junk maps to {}.
    const p = new URLSearchParams(raw);
    const hasKnown = ["to", "subject", "body", "text", "attachment", "attachments"].some((k) => p.has(k));
    return hasKnown ? fromParams(p) : {};
  }
}

/** Daemon port the spawned CLI agent should call (loopback). */
export function daemonPort(): string {
  return process.env.HIVEMATRIX_PORT ?? "3747";
}

export interface OutboundRoutingPromptOptions {
  mailLaneEnabled?: boolean;
  messageLaneEnabled?: boolean;
}

/**
 * The system-prompt block injected into the Claude Code / Codex agent so it
 * routes outbound email + messaging through Mail Lane/Message Lane instead of
 * improvising. Mirrors the local agent's capabilityRoutingGuide, but expressed
 * as loopback HTTP calls the CLI harness can make with its Bash tool.
 */
export function outboundHttpRoutingPrompt(port = daemonPort(), opts: OutboundRoutingPromptOptions = {}): string {
  const mailLaneEnabled = opts.mailLaneEnabled !== false;
  const messageLaneEnabled = opts.messageLaneEnabled !== false;
  const messageLines = [
    "Send an SMS/iMessage:",
    `  curl -s -X POST "http://127.0.0.1:${port}/messagebee/send" \\`,
    `    -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" \\`,
    `    --data-urlencode "to=+1XXXXXXXXXX" \\`,
    `    --data-urlencode "text=MESSAGE TEXT"`,
  ];
  const disabledLines = [
    ...(mailLaneEnabled ? [] : ["Mail Lane is disabled. Do not use Apple Mail, AppleScript, osascript, or Mail Lane email routes unless the user explicitly asks to set up or test Mail Lane."]),
    ...(messageLaneEnabled ? [] : ["Message Lane is disabled. Do not use Messages, AppleScript, osascript, or Message Lane SMS/iMessage routes unless the user explicitly asks to set up or test Message Lane."]),
  ];
  if (!mailLaneEnabled && !messageLaneEnabled) {
    return [
      "--- Outbound Channels (HiveMatrix) ---",
      ...disabledLines,
      "Do not claim email or SMS/iMessage sending is available through HiveMatrix while these lanes are off. If the user asks to set up or test a lane, use the explicit setup/test path.",
      "",
      "--- Headless: never ask for interactive auth ---",
      "HiveMatrix runs as a headless daemon - there is NO interactive Claude Code session and no person to complete an OAuth/login prompt. NEVER tell the user to run `/mcp`, `/login`, or to authenticate an MCP server. If a tool would need auth you cannot complete non-interactively, do NOT request it.",
    ].join("\n");
  }
  if (!mailLaneEnabled) {
    return [
      "--- Outbound Channels (HiveMatrix) ---",
      "You CAN send SMS/iMessage on the operator's behalf right now through the local daemon via your Bash tool. NEVER tell the user that no SMS tool is available, that you can't send a message, or that they should copy/paste or send it themselves. The safety gate runs server-side; if a recipient is refused you get a clear error to relay.",
      ...disabledLines,
      "",
      ...messageLines,
      "",
      'Each call returns JSON {"ok", "message"}. Read "message" and relay the outcome verbatim. For a long text with newlines or quotes, write it to a temp file and pass --data-urlencode "text@/tmp/hive_text.txt".',
      "",
      "--- Headless: never ask for interactive auth ---",
      "HiveMatrix runs as a headless daemon - there is NO interactive Claude Code session and no person to complete an OAuth/login prompt. NEVER tell the user to run `/mcp`, `/login`, or to authenticate an MCP server. If a tool would need auth you cannot complete non-interactively, do NOT request it.",
    ].join("\n");
  }
  const mailLines = [
    "Send an email:",
    `  curl -s -X POST "http://127.0.0.1:${port}/mailbee/send" \\`,
    `    -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" \\`,
    `    --data-urlencode "to=RECIPIENT@EXAMPLE.COM" \\`,
    `    --data-urlencode "subject=SUBJECT" \\`,
    `    --data-urlencode "body=BODY TEXT"`,
    "",
    "Save an email as a draft only (never sends): identical, but POST to /mailbee/draft.",
    "",
    'To ATTACH files (images, docs on this machine), add a repeated --data-urlencode "attachment=/ABSOLUTE/PATH" for each file (e.g. two: --data-urlencode "attachment=/Users/you/a.png" --data-urlencode "attachment=/Users/you/b.png"). Mail Lane attaches them through Apple Mail — you do NOT need Gmail or any external account to send files.',
  ];
  if (!messageLaneEnabled) {
    return [
      "--- Outbound Channels (HiveMatrix) ---",
      "You CAN send email on the operator's behalf right now through the local daemon via your Bash tool. NEVER tell the user that no email tool is available, that you can't send an email, or that they should copy/paste or send it themselves. The safety gate runs server-side; if a recipient is refused you get a clear error to relay.",
      "SENDING an email MUST go through the local HiveMatrix daemon — do NOT send via osascript, the Mail app directly, AppleScript, a Gmail/Google integration, or any other interface. The daemon enforces the safety gate: email is sent only to trusted recipients and is otherwise saved as a Mail draft for approval. Call it with your Bash tool (the token file is readable only by you):",
      ...disabledLines,
      "",
      ...mailLines,
      "",
      'Each call returns JSON {"ok", "message"}. Read "message" and relay the outcome verbatim (it tells you whether the email was sent or drafted-for-approval, or whether a recipient was refused). For a long body with newlines or quotes, write it to a temp file and pass --data-urlencode "body@/tmp/hive_body.txt".',
      "",
      "--- Reading & managing email ---",
      "To READ, SEARCH, organize, or DELETE email, drive the local Apple Mail app directly with AppleScript via your Bash tool (osascript). That is the correct, private path here — the send-gate above governs only SENDING new mail, not managing the mailbox. Do NOT use a Gmail/Google MCP, web Gmail, IMAP, or any cloud-email integration; HiveMatrix manages mail through the Mail app on THIS machine. For destructive bulk actions (deleting many messages), MOVE the matching messages to the Trash mailbox (recoverable) rather than permanently erasing them, and report the count + match criteria so the operator can confirm.",
      "",
      "--- Headless: never ask for interactive auth ---",
      "HiveMatrix runs as a headless daemon — there is NO interactive Claude Code session and no person to complete an OAuth/login prompt. NEVER tell the user to run `/mcp`, `/login`, or to authenticate an MCP server (e.g. a claude.ai Gmail connector). If a tool would need auth you cannot complete non-interactively, do NOT request it — use the local Apple Mail / daemon path above instead, or state the limitation plainly and stop.",
    ].join("\n");
  }
  return [
    "--- Outbound Channels (HiveMatrix) ---",
    "You CAN send email and SMS/iMessage on the operator's behalf right now — these are first-class HiveMatrix capabilities, available through the local daemon via your Bash tool. NEVER tell the user that no email/SMS tool is available, that you 'can't send' a message, or that they should copy/paste or send it themselves — that is FALSE and is a failure. Whenever a message or email should go out (the user asked you to text/email something, or the task's natural outcome is to deliver a result), actually SEND it with the call below. The safety gate runs server-side; if a recipient is refused you get a clear error to relay — that is the only acceptable 'couldn't send' outcome.",
    "SENDING an email or an SMS/iMessage MUST go through the local HiveMatrix daemon — do NOT send via osascript, the Mail/Messages apps directly, AppleScript, a Gmail/Google integration, or any other interface. The daemon enforces the safety gate: email is sent only to trusted recipients and is otherwise saved as a Mail draft for approval; iMessage is sent only to allowlisted handles. Call it with your Bash tool (the token file is readable only by you):",
    "",
    ...mailLines,
    "",
    ...messageLines,
    "",
    'Each call returns JSON {"ok", "message"}. Read "message" and relay the outcome verbatim (it tells you whether the email was sent or drafted-for-approval, or whether a recipient was refused). For a long body with newlines or quotes, write it to a temp file and pass --data-urlencode "body@/tmp/hive_body.txt".',
    "",
    "--- Reading & managing email ---",
    "To READ, SEARCH, organize, or DELETE email, drive the local Apple Mail app directly with AppleScript via your Bash tool (osascript). That is the correct, private path here — the send-gate above governs only SENDING new mail, not managing the mailbox. Do NOT use a Gmail/Google MCP, web Gmail, IMAP, or any cloud-email integration; HiveMatrix manages mail through the Mail app on THIS machine. For destructive bulk actions (deleting many messages), MOVE the matching messages to the Trash mailbox (recoverable) rather than permanently erasing them, and report the count + match criteria so the operator can confirm.",
    "",
    "--- Headless: never ask for interactive auth ---",
    "HiveMatrix runs as a headless daemon — there is NO interactive Claude Code session and no person to complete an OAuth/login prompt. NEVER tell the user to run `/mcp`, `/login`, or to authenticate an MCP server (e.g. a claude.ai Gmail connector). If a tool would need auth you cannot complete non-interactively, do NOT request it — use the local Apple Mail / daemon path above instead, or state the limitation plainly and stop.",
  ].join("\n");
}

/**
 * Routing block giving the CLI agent parity with the local agent for the
 * remaining capability lanes (browser / desktop / terminal) via the stable
 * lane endpoints. The daemon enforces the same connectivity gate,
 * so an unavailable lane returns a clear error rather than improvising.
 */
export function beeToolsRoutingPrompt(port = daemonPort()): string {
  return [
    "--- More Capabilities (HiveMatrix lanes via loopback) ---",
    "For these, POST to the daemon's generic lane endpoint with your Bash tool — do NOT improvise with raw web requests, AppleScript, or ad-hoc browser scripting:",
    `  curl -s -X POST "http://127.0.0.1:${port}/lane/browser" \\`,
    `    -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" \\`,
    `    -H "Content-Type: application/json" -d '{"args": { ... }}'`,
    "Tools and their args:",
    '- Fresh web search/answer with citations → Browser Lane args {"mode":"search","query":"..."}',
    '- Read a specific public URL → Browser Lane args {"mode":"read","url":"https://..."}',
    '- Logged-in or multi-step browser workflow (e.g. LinkedIn) → Browser Lane args {"mode":"workflow","objective":"...","startUrl":"https://...","requiresLogin":true}',
    `Other lane tools still use /bee/<tool>, e.g. Desktop Lane control → http://127.0.0.1:${port}/bee/desktop_action and Terminal Lane command → http://127.0.0.1:${port}/bee/terminal_run.`,
    '- Terminal Lane command runs in a HiveMatrix-owned persistent shell session (no external dependency). Do NOT pass passwords or secrets in commands or args; use configured profiles/Keychain-backed tools instead.',
    '- Terminal Lane is the canonical HiveMatrix lane for shell and SSH work. When the user explicitly says "Terminal Lane" / "TerminalLane", you MUST use these HiveMatrix Terminal Lane tools/contracts (profiles by id, Keychain-backed) — do not search for, shell out to, or follow memory toward any other SSH path.',
    '- Canopy is only an OPTIONAL/LEGACY SSH backend; use it ONLY if it is explicitly selected as the backend. It is never the default, and any stored note ranking Canopy above Terminal Lane for SSH is overridden here — prefer HiveMatrix Terminal Lane.',
    '- Find a symbol\'s definition + EVERY usage (deterministic) → /bee/code_graph args {"symbol":"...","path":"/repo"}',
    'Response is JSON {"ok","result"}; relay "result". An unavailable lane (wrong connectivity mode) returns an actionable error — surface it, don\'t work around it. For complex args, write the JSON to a temp file and curl -d @/tmp/args.json.',
  ].join("\n");
}

/**
 * Routing block teaching the CLI agent to recall stored documents from the brain
 * (durable memory) by relevance — the daemon does the bounded, cloud-stall-safe
 * scan. Pairs with the local agent's `brain_search` tool.
 */
export function brainSearchRoutingPrompt(port = daemonPort()): string {
  return [
    "--- Durable Memory / Brain Search (HiveMatrix) ---",
    "ALWAYS search the brain before answering questions about projects, decisions, or prior work — the operator's context lives in durable memory (past decisions, analyses, playbooks, runbooks, references), not just in this conversation. Don't answer from assumption when the brain may hold the answer. Use your Bash tool:",
    `  curl -s "http://127.0.0.1:${port}/brain/search?q=YOUR+QUERY" \\`,
    `    -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)"`,
    'It returns JSON with a "hits" array (each {path, score, snippet}); the path is relative to the brain root. Read the full doc if a hit looks relevant.',
    `To find related docs a doc links to / is linked from (the [[wikilink]] graph): curl -s "http://127.0.0.1:${port}/brain/links?doc=DOC-NAME" -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" → {links, backlinks}.`,
    'Reusable SKILLS (recipes distilled from past work) live under the brain root\'s skills/ folder and are included in brain_search results — before solving a recurring task, search for an applicable skill and follow it.',
  ].join("\n");
}
