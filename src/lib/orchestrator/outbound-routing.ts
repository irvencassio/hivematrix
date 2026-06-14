/**
 * Outbound-channel bridge for the CLI executors (Claude Code, Codex).
 *
 * The local/generic (Qwen) agent gets first-class `mailbee_send` / `mailbee_draft`
 * / `messagebee_send` function tools (see bee-tools.ts). The Claude Code and Codex
 * harnesses run their OWN toolset and never see those — which is exactly why an
 * "send this email" task historically got improvised with osascript instead of
 * going through MailBee.
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
}

function pickString(o: Record<string, unknown>, k: string): string | undefined {
  return typeof o[k] === "string" ? (o[k] as string) : undefined;
}

/**
 * Parse an outbound request body that may arrive as JSON OR as
 * application/x-www-form-urlencoded. `curl --data-urlencode` (the form we tell
 * the agent to use, because it sidesteps all JSON shell-escaping) defaults to
 * urlencoded, so both shapes must work.
 */
export function parseOutboundFields(contentType: string | undefined, raw: string): OutboundFields {
  const ct = (contentType ?? "").toLowerCase();
  const fromParams = (p: URLSearchParams): OutboundFields => ({
    to: p.get("to") ?? undefined,
    subject: p.get("subject") ?? undefined,
    body: p.get("body") ?? undefined,
    text: p.get("text") ?? undefined,
  });

  if (ct.includes("application/x-www-form-urlencoded")) {
    return fromParams(new URLSearchParams(raw));
  }

  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    return { to: pickString(o, "to"), subject: pickString(o, "subject"), body: pickString(o, "body"), text: pickString(o, "text") };
  } catch {
    // No/!json content-type and not valid JSON — fall back to urlencoded parse
    // (covers a curl --data-urlencode call whose header we didn't match), but
    // only when a recognized field is actually present so junk maps to {}.
    const p = new URLSearchParams(raw);
    const hasKnown = ["to", "subject", "body", "text"].some((k) => p.has(k));
    return hasKnown ? fromParams(p) : {};
  }
}

/** Daemon port the spawned CLI agent should call (loopback). */
export function daemonPort(): string {
  return process.env.HIVEMATRIX_PORT ?? "3747";
}

/**
 * The system-prompt block injected into the Claude Code / Codex agent so it
 * routes outbound email + messaging through MailBee/MessageBee instead of
 * improvising. Mirrors the local agent's capabilityRoutingGuide, but expressed
 * as loopback HTTP calls the CLI harness can make with its Bash tool.
 */
export function outboundHttpRoutingPrompt(port = daemonPort()): string {
  return [
    "--- Outbound Channels (HiveMatrix) ---",
    "To send an email or an SMS/iMessage you MUST go through the local HiveMatrix daemon — do NOT use osascript, the Mail/Messages apps directly, AppleScript, or any other interface. The daemon enforces the safety gate: email is sent only to trusted recipients and is otherwise saved as a Mail draft for approval; iMessage is sent only to allowlisted handles. Call it with your Bash tool (the token file is readable only by you):",
    "",
    "Send an email:",
    `  curl -s -X POST "http://127.0.0.1:${port}/mailbee/send" \\`,
    `    -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" \\`,
    `    --data-urlencode "to=RECIPIENT@EXAMPLE.COM" \\`,
    `    --data-urlencode "subject=SUBJECT" \\`,
    `    --data-urlencode "body=BODY TEXT"`,
    "",
    "Save an email as a draft only (never sends): identical, but POST to /mailbee/draft.",
    "",
    "Send an SMS/iMessage:",
    `  curl -s -X POST "http://127.0.0.1:${port}/messagebee/send" \\`,
    `    -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" \\`,
    `    --data-urlencode "to=+1XXXXXXXXXX" \\`,
    `    --data-urlencode "text=MESSAGE TEXT"`,
    "",
    'Each call returns JSON {"ok", "message"}. Read "message" and relay the outcome verbatim (it tells you whether the email was sent or drafted-for-approval, or whether a recipient was refused). For a long body with newlines or quotes, write it to a temp file and pass --data-urlencode "body@/tmp/hive_body.txt".',
  ].join("\n");
}

/**
 * Routing block giving the CLI agent parity with the local agent for the
 * remaining capability lanes (web / browser / desktop / terminal) via the
 * generic /bee/<tool> endpoint. The daemon enforces the same connectivity gate,
 * so an unavailable lane returns a clear error rather than improvising.
 */
export function beeToolsRoutingPrompt(port = daemonPort()): string {
  return [
    "--- More Capabilities (HiveMatrix lanes via loopback) ---",
    "For these, POST to the daemon's generic lane endpoint with your Bash tool — do NOT improvise with raw web requests, AppleScript, or ad-hoc browser scripting:",
    `  curl -s -X POST "http://127.0.0.1:${port}/bee/<tool>" \\`,
    `    -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)" \\`,
    `    -H "Content-Type: application/json" -d '{"args": { ... }}'`,
    "Tools and their args:",
    '- Fresh web search/answer with citations → tool `webbee_search`, args {"query":"..."}',
    '- Logged-in or multi-step browser workflow (e.g. LinkedIn) → tool `browserbee_run`, args {"objective":"...","startUrl":"https://..."}',
    '- Native macOS app control → tool `desktopbee_action`, args {"action":"desktop.script.run","params":{...}}',
    '- Persistent terminal command → tool `termbee_run`, args {"sessionId":"s1","command":"..."}',
    '- Find a symbol\'s definition + EVERY usage (deterministic — verify you changed all call sites) → tool `code_graph`, args {"symbol":"...","path":"/repo"}',
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
    "Before assuming something isn't written down, search the brain (durable memory: past decisions, analyses, playbooks, runbooks, references). Use your Bash tool:",
    `  curl -s "http://127.0.0.1:${port}/brain/search?q=YOUR+QUERY" \\`,
    `    -H "Authorization: Bearer $(cat ~/.hivematrix/auth-token)"`,
    'It returns JSON with a "hits" array (each {path, score, snippet}); the path is relative to the brain root. Read the full doc if a hit looks relevant.',
    'Reusable SKILLS (recipes distilled from past work) live under the brain root\'s skills/ folder and are included in brain_search results — before solving a recurring task, search for an applicable skill and follow it.',
  ].join("\n");
}
