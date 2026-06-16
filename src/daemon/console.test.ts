import test from "node:test";
import assert from "node:assert/strict";
import { CONSOLE_HTML } from "./console";

/**
 * The console ships as a String.raw template — the browser <script> is a raw
 * string, so `tsc` does NOT type-check (or syntax-check) the JS inside it. A
 * stray TypeScript-ism (e.g. `x as HTMLTextAreaElement`) parses fine in the .ts
 * file but is a SyntaxError in the browser, which kills the ENTIRE console
 * script — blank board, dead buttons. This test parses the served script the
 * way a browser would, so that class of bug fails CI instead of the UI.
 */
function extractScript(html: string): string {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, "console must contain a <script> block");
  return m![1];
}

function extractMdToHtml(html: string): (src: string) => string {
  const js = extractScript(html);
  const esc = js.match(/function esc\(s\)\{[^\n]+\}/);
  const md = js.match(/\/\*__MARKDOWN_RENDERER_START__\*\/([\s\S]*?)\/\*__MARKDOWN_RENDERER_END__\*\//);
  assert.ok(esc, "console script must define esc");
  assert.ok(md, "console script must define the markdown renderer block");
  const factory = new Function(`${esc![0]}\n${md![1]}\nreturn mdToHtml;`) as () => (src: string) => string;
  return factory();
}

test("console browser script is valid JavaScript (no TypeScript leaks)", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.ok(js.length > 1000, "script block should be substantial");
  // new Function parses (but does not run) the body — throws SyntaxError on
  // any non-JS syntax like `as Type`, type annotations, generics, interfaces.
  assert.doesNotThrow(() => new Function(js), SyntaxError);
});

test("console script has no obvious TS-only syntax", () => {
  const js = extractScript(CONSOLE_HTML);
  // Guard the specific footguns: `x as Type` casts and `: Type` annotations.
  assert.doesNotMatch(js, /\bas\s+(HTML[A-Za-z]+|string|number|boolean|any)\b/, "found a TS `as Type` cast");
});

test("result markdown renders pipe tables as real tables", () => {
  const mdToHtml = extractMdToHtml(CONSOLE_HTML);
  const html = mdToHtml(`Here are the **6 open Demo Lite tickets**:

| Ticket ID | Created | Store | Customer | Status | Days Open | Category |
|-----------|---------|-------|----------|--------|-----------|----------|
| A4541175L | 05/16 | SGH-4199 | Sunglass Hut 4199 - Galleria Ft Lauderdale | Testing Resolution | 30 | Glasses |
| A4555606L | 05/20 | RB-P650 | P650 - Roosevelt Field Ray-Ban | In progress | 26 | Smartphone |

6 tickets total.`);

  assert.match(html, /<table class="md-table">/, "pipe table rendered as table");
  assert.match(html, /<th>Ticket ID<\/th>/);
  assert.match(html, /<td>A4541175L<\/td>/);
  assert.match(html, /<td>Testing Resolution<\/td>/);
  assert.doesNotMatch(html, /\| Ticket ID \| Created \|/, "raw table markup is not shown");
});

test("result markdown prepares Mermaid fences for client-side rendering", () => {
  const mdToHtml = extractMdToHtml(CONSOLE_HTML);
  const html = mdToHtml("```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```");
  assert.match(html, /<pre class="mermaid">graph TD\n  A\[Start\] --&gt; B\[Done\]<\/pre>/);

  assert.match(CONSOLE_HTML, /src="\/assets\/mermaid\.min\.js"/, "console loads bundled Mermaid");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function renderMermaidBlocks\(/, "console renders Mermaid blocks after refresh");
  assert.match(js, /mermaid\.run/, "console delegates rendering to Mermaid");
});

test("desktop console surfaces the founder-in-the-loop approval queue (parity with mobile)", () => {
  // The bug: iOS rendered /approvals/pending but the desktop console never did.
  assert.match(CONSOLE_HTML, /id="approvals"/, "approvals mount point present");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function renderApprovals\(/);
  assert.match(js, /async function resolveApprovalItem\(/);
  assert.match(js, /api\("\/approvals\/pending"\)/, "fetches the unified queue");
  assert.match(js, /\/approvals\/resolve/, "resolves via the POST endpoint");
  assert.match(js, /renderApprovals\(\);/, "rendered on every refresh tick");
});

test("main screen usage shows no dollar amounts (counts/tokens only)", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /HiveMatrix spend/, "no spend tooltip");
  assert.doesNotMatch(js, /No frontier spend/, "no spend placeholder");
  assert.doesNotMatch(js, /\bspent\b/, "no 'spent' labels");
  // The Frontier Usage pill fallback shows a task count, never a dollar total.
  assert.match(js, /pill\.textContent = "⚡ " \+ \(u\.taskCount/, "pill fallback is task count");
});

test("observability cost is opt-in (off by default), not on the main board", () => {
  const js = extractScript(CONSOLE_HTML);
  // Cost figures only render when the _obsCost toggle is on.
  assert.match(js, /let _obsCost = false/, "cost defaults off");
  assert.match(js, /_obsCost && /, "cost rendering gated behind the toggle");
  assert.match(js, /hm_obs_cost/, "toggle persisted");
});

test("needs_input reply window stands out and uses a clear 'Reply' button", () => {
  const js = extractScript(CONSOLE_HTML);
  // The reply section is given the standout class + header when needs_input.
  assert.match(js, /reply-section'\+\(isOpen\?' open needs'/);
  assert.match(js, /✋ Awaiting your reply/);
  // The submit is a labeled primary "Reply" button, not a bare arrow glyph.
  assert.match(js, /class="reply-primary"[^>]*>Reply</);
  assert.doesNotMatch(js, /↩ Send Reply/, "old arrow-labeled button replaced");
  assert.match(CONSOLE_HTML, /\.reply-section\.needs/, "standout style present");
});

test("review/failed tasks get a subtle Reply box, distinct from the needs_input standout", () => {
  const js = extractScript(CONSOLE_HTML);
  // Reply is offered on review/failed/cancelled (retryable) tasks, not just needs_input.
  assert.match(js, /const canReply = t\.reviewState !== "needs_input" && \(t\.pendingQuestion \|\| retryable\)/);
  assert.match(js, /if \(canReply\) b\.push/);
  // Two visual treatments: the standout "needs" card vs the subtle box.
  assert.match(js, /' open needs':' subtle'/);
  assert.match(js, /reply-subhead/);
  assert.match(CONSOLE_HTML, /\.reply-section\.subtle\.open/, "subtle reply style present");
  // Distinct from the needs_input standout header.
  assert.match(js, /✋ Awaiting your reply/);
});

test("settings has an About tab with version/build/date and update status", () => {
  assert.match(CONSOLE_HTML, /id="tab-about"/);
  assert.match(CONSOLE_HTML, /id="settingsAbout"/);
  for (const id of ["ab_version", "ab_build", "ab_date", "ab_update"]) {
    assert.match(CONSOLE_HTML, new RegExp('id="' + id + '"'), id + " present");
  }
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function renderAbout\(/);
  assert.match(js, /if \(tab === "about"\)/, "About tab wired in switchSettingsTab");
});

test("settings tabs are in a defined order ending with About", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /\["models", "bees", "projects", "general", "remote", "about"\]/);
});

test("Mixed-mode role models hide Thinking/Coding when the frontier provider is Codex", () => {
  const js = extractScript(CONSOLE_HTML);
  // No more redundant disabled "Codex (provider override)" rows — they're hidden.
  assert.match(js, /fRows\.style\.display = codex \? "none"/);
  assert.match(js, /s_role_codex_note/);
  assert.doesNotMatch(js, /Codex \(provider override\)/, "duplicate-looking override rows removed");
});

test("right-panel sections are collapsible <details> with persisted open state", () => {
  // Each context section is a <details class="ctx-sec"> so the long panel can be tidied.
  for (const id of ["healthSec", "usageSec", "obsSec", "connSec", "dirSec", "skillsSec", "mcpSec"]) {
    assert.match(CONSOLE_HTML, new RegExp('<details class="ctx-sec" id="' + id + '"'), id + " is a collapsible section");
  }
  // Actionable sections default open; info-heavy ones default collapsed.
  assert.match(CONSOLE_HTML, /id="connSec" open/);
  assert.match(CONSOLE_HTML, /id="skillsSec" open/);
  assert.doesNotMatch(CONSOLE_HTML, /id="usageSec" open/, "info sections default collapsed");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function wireCtxSections\(/);
  assert.match(js, /hm_sec_/, "per-section open state persisted");
  assert.match(js, /wireCtxSections\(\);/, "wired on init");
  // In-summary controls don't toggle the section.
  assert.match(CONSOLE_HTML, /event\.stopPropagation\(\);refreshUsageNow\(\)/);
});

test("console surfaces observability: per-task strip + totals across providers", () => {
  assert.match(CONSOLE_HTML, /id="observability"/, "totals mount point");
  assert.match(CONSOLE_HTML, /<summary>Observability/);
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function renderObservability\(/);
  assert.match(js, /function taskTelemetryStrip\(/, "per-task telemetry strip");
  assert.match(js, /api\("\/observability/, "fetches the observability endpoint");
  assert.match(js, /renderObservability\(\);/, "rendered on refresh");
  // The strip honors unavailable-not-zero for Codex.
  assert.match(js, /prov === "Codex" && !inTok && !outTok/);
});

test("remote access UI offers both a temporary and a named (durable) tunnel with Access credentials", () => {
  // Both setup paths are present, not buried behind a collapsed disclosure.
  assert.match(CONSOLE_HTML, /Temporary tunnel/);
  assert.match(CONSOLE_HTML, /Named tunnel/);
  assert.doesNotMatch(CONSOLE_HTML, /Advanced: Named Cloudflare tunnel/, "named tunnel should not be hidden under an Advanced disclosure");
  assert.match(CONSOLE_HTML, /Cloudflare Access Client ID/);
  assert.match(CONSOLE_HTML, /Cloudflare Access Client Secret/);
  assert.match(CONSOLE_HTML, /\/tunnel\/configure-named/);
  assert.match(CONSOLE_HTML, /\/tunnel\/access-credentials/);
  // Remote setup lives on its own settings tab now.
  assert.match(CONSOLE_HTML, /id="settingsRemote"/);
  assert.match(CONSOLE_HTML, /switchSettingsTab\('remote'\)/);
});

test("settings expose Mixed-mode role models for thinking, coding, and operational", () => {
  for (const id of ["s_role_thinking", "s_role_coding", "s_role_operational"]) {
    assert.match(CONSOLE_HTML, new RegExp('id="' + id + '"'), id + " selector present");
  }
  // onchange handlers live in the HTML attributes; the function lives in the script.
  assert.match(CONSOLE_HTML, /saveRoleModel\('thinking'/);
  assert.match(CONSOLE_HTML, /saveRoleModel\('coding'/);
  assert.match(CONSOLE_HTML, /saveRoleModel\('operational'/);
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function saveRoleModel\(/);
  // The role-model block is gated on a Mixed posture being available.
  assert.match(js, /m\.id === "mixed"/);
});

test("MessageBee modal fetches structured status before reporting readability", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /const r = await api\('\/messagebee'\)/);
  assert.doesNotMatch(js, /!\s*\/Full Disk Access\/i\.test/);
});

test("reply and retry drafts survive live detail refreshes", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.ok(js.includes("onCtxDraft(\\'reply\\',this)"));
  assert.ok(js.includes("onCtxDraft(\\'retry\\',this)"));
  assert.match(js, /syncCtxState\(\)/);
  assert.match(js, /restoreCtxState\(\)/);
  assert.match(js, /document\.activeElement/);
  assert.match(js, /setSelectionRange/);
  assert.match(js, /_ctxDraft\.reply = ""/);
});

test("reply focus restoration does not steal focus outside task detail", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function shouldRestoreCtxFocus/);
  assert.match(js, /document\.getElementById\("session"\)/);
  assert.match(js, /return active === document\.body \|\| session\.contains\(active\)/);
  assert.match(js, /_ctxFocus = \{ active: null, start: null, end: null \}/);
});

test("console sends reply bodies as JSON", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /"Content-Type": "application\/json"/);
  assert.match(js, /\/tasks\/"\+id\+"\/reply/);
});

test("console can steer any live run, gated to in-progress tasks", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function submitSteer\(/);
  assert.match(js, /\/tasks\/"\+id\+"\/steer/);
  // Steer box appears for any in-progress task (no longer Codex-only).
  assert.ok(
    js.includes('const steerable = t.status === "in_progress";'),
    "steer gated to in-progress tasks",
  );
  assert.ok(
    !js.includes('(t.model||"").startsWith("codex:")'),
    "steer is no longer gated to Codex tasks",
  );
  // Its draft survives live refreshes like reply/retry do.
  assert.ok(js.includes("onCtxDraft(\\'steer\\',this)"), "steer textarea preserves its draft");
  assert.match(js, /_ctxDraft\.steer = ""/);
});

test("frontier usage panel renders a separate Codex usage section", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /codexSubscription/);
  assert.match(js, /Codex subscription/);
  assert.match(js, /renderCodexBar/);
});

test("frontier usage panel has a manual refresh that bypasses cached auth state", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /usageRefresh/);
  assert.match(js, /function refreshUsageNow/);
  assert.match(js, /checkUsage\(true\)/);
  assert.match(js, /\/usage\?refresh=1/);
});

test("frontier usage panel exposes Claude auth login action", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function runClaudeAuthLogin/);
  assert.match(js, /\/claude\/auth\/login/);
  assert.match(js, /claudeAuthLogin/);
  assert.match(js, /Run Claude login/);
});

// Pull the shipped browser `timeAgo` out of the console script and make it callable,
// so the actual rendered logic (not a copy) is what gets tested.
function extractTimeAgo(html: string): (value: string | null | undefined, nowMs: number) => string {
  const m = html.match(/\/\*__TIMEAGO_START__\*\/([\s\S]*?)\/\*__TIMEAGO_END__\*\//);
  assert.ok(m, "console must contain a sentinel-wrapped timeAgo function");
  const factory = new Function(m![1] + "; return timeAgo;") as () => (
    value: string | null | undefined,
    nowMs: number,
  ) => string;
  return factory();
}

test("console timeAgo humanizes BOTH daemon date formats as UTC", () => {
  const timeAgo = extractTimeAgo(CONSOLE_HTML);
  const now = Date.parse("2026-06-14T10:35:45Z");
  // SQLite datetime('now') — space separator, no T/Z — must be read as UTC, not local.
  assert.equal(timeAgo("2026-06-14 10:30:45", now), "5 min ago");
  // toISOString() form written on insert.
  assert.equal(timeAgo("2026-06-14T10:35:30.000Z", now), "just now");
  assert.equal(timeAgo("2026-06-14T09:35:45Z", now), "1 hr ago");
  assert.equal(timeAgo("2026-06-13T10:35:45Z", now), "1 day ago");
  assert.equal(timeAgo("2026-06-12T10:35:45Z", now), "2 days ago");
});

test("console timeAgo is null-safe and clamps clock skew", () => {
  const timeAgo = extractTimeAgo(CONSOLE_HTML);
  const now = Date.parse("2026-06-14T10:35:45Z");
  assert.equal(timeAgo("", now), "");
  assert.equal(timeAgo(null, now), "");
  assert.equal(timeAgo("not a date", now), "");
  // a future timestamp (clock skew) must not render "in N min" — clamp to "just now".
  assert.equal(timeAgo("2026-06-14T10:40:00Z", now), "just now");
});

test("board renders a per-task age chip from updatedAt", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function ageBadge\(/);
  assert.match(js, /ageBadge\(t\)/, "renderBoard appends the age chip per card");
  assert.match(js, /updatedAt/, "age chip is driven by updatedAt");
});
