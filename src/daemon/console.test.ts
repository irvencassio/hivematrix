import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("settings surfaces conservative voice auto-approval controls", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /\/settings\/voice\/auto-approval/, "loads and saves voice auto-approval policy");
  assert.match(js, /function toggleAutoApproval\(/, "has a settings toggle handler");
  assert.match(js, /Content, external, stuck, and tool approvals stay manual/, "documents manual approval boundaries");
});

test("settings binary controls use the standardized readable switch component", () => {
  const js = extractScript(CONSOLE_HTML);
  const renderFeatures = js.match(/async function renderFeatures\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(CONSOLE_HTML, /\.settings-switch\b/, "settings switch style exists");
  assert.match(js, /function settingsSwitch\(/, "shared switch renderer exists");
  assert.match(js, /role="switch"/, "switch uses accessible role");
  assert.match(js, /aria-checked="/, "switch exposes checked state");
  assert.match(js, /Enabled/, "active state uses readable copy");
  assert.match(js, /Off/, "inactive state uses readable copy");
  assert.match(js, /Unavailable/, "disabled state stays explicit");
  assert.doesNotMatch(renderFeatures, /reply-toggle/, "feature settings no longer reuse reply/retry button styles");
});

test("main screen usage shows no dollar amounts (counts/tokens only)", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /HiveMatrix spend/, "no spend tooltip");
  assert.doesNotMatch(js, /No frontier spend/, "no spend placeholder");
  assert.doesNotMatch(js, /\bspent\b/, "no 'spent' labels");
  // The Frontier Usage pill fallback shows a task count, never a dollar total.
  assert.match(js, /pill\.textContent = "⚡ " \+ \(u\.taskCount/, "pill fallback is task count");
});

test("observability does not surface cost (Claude-only, removed)", () => {
  const js = extractScript(CONSOLE_HTML);
  // Cost is reported only by Claude (not Codex/local), so it was removed from the UI.
  assert.doesNotMatch(js, /_obsCost/, "cost toggle state removed");
  assert.doesNotMatch(js, /hm_obs_cost/, "cost persistence removed");
  assert.doesNotMatch(CONSOLE_HTML, /obs-costtgl/, "cost toggle control removed");
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
  assert.match(js, /const canReply = !steerable && t\.reviewState !== "needs_input" && \(t\.pendingQuestion \|\| retryable\)/);
  assert.match(js, /if \(canReply\) b\.push/);
  // Two visual treatments: the standout "needs" card vs the subtle box.
  assert.match(js, /' open needs':' subtle'/);
  assert.match(js, /reply-subhead/);
  assert.match(CONSOLE_HTML, /\.reply-section\.subtle\.open/, "subtle reply style present");
  // Distinct from the needs_input standout header.
  assert.match(js, /✋ Awaiting your reply/);
});

test("live steerable tasks do not render Reply controls", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /const steerable = t\.status === "in_progress"/);
  assert.match(js, /if \(steerable\) \{[\s\S]*submitSteer/, "steer form remains available");
  assert.match(js, /if \(!steerable\) \{\s*const isOpen = t\.reviewState === "needs_input"/, "Reply section is skipped for live steerable runs");
  assert.match(js, /const canReply = !steerable &&/, "Reply toggle is skipped for live steerable runs");
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
  assert.match(js, /\["about", "features", "general", "models", "observability", "lanes", "remote"\]/);
  assert.match(CONSOLE_HTML, /id="tab-about"[^>]*>About<\/div><div class="tab" id="tab-features"[^>]*>Features<\/div><div class="tab" id="tab-general"[^>]*>Personalization<\/div><div class="tab" id="tab-models"[^>]*>Models<\/div><div class="tab" id="tab-observability"[^>]*>Observability<\/div><div class="tab" id="tab-lanes"[^>]*>Lanes<\/div><div class="tab" id="tab-remote"[^>]*>Remote<\/div>/);
  assert.doesNotMatch(CONSOLE_HTML, /id="tab-projects"/, "Projects is no longer a Settings tab");
});

test("settings lane setup surfaces use lane names instead of bee product names", () => {
  assert.match(CONSOLE_HTML, /Set up Message Lane/);
  assert.match(CONSOLE_HTML, /Set up Mail Lane/);
  assert.match(CONSOLE_HTML, /Enable Mail Lane/);
  assert.match(CONSOLE_HTML, /Message Lane — iMessage \/ SMS/);
  assert.match(CONSOLE_HTML, /Mail Lane — Email/);

  assert.doesNotMatch(CONSOLE_HTML, /Set up MessageBee/);
  assert.doesNotMatch(CONSOLE_HTML, /Set up MailBee/);
  assert.doesNotMatch(CONSOLE_HTML, /Enable MailBee/);
  assert.doesNotMatch(CONSOLE_HTML, /MessageBee — iMessage \/ SMS/);
  assert.doesNotMatch(CONSOLE_HTML, /MailBee — Email/);

  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /return "Review Lane \/ directive"/);
  assert.match(js, /return "Message Lane"/);
  assert.match(js, /return "Mail Lane"/);
  assert.doesNotMatch(js, /return "ManagerBee \/ directive"/);
  assert.doesNotMatch(js, /return "MessageBee"/);
  assert.doesNotMatch(js, /return "MailBee"/);
});

test("compatibility bees endpoint returns lane-shaped status", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

  assert.match(server, /GET \/bees — compatibility status for older clients\./);
  assert.match(server, /const \{ listLaneServiceStatuses \} = await import\("@\/lib\/lanes\/status"\);/);
  assert.match(server, /json\(res, 200, \{ bees: await listLaneServiceStatuses\(\) \}\);/);
  assert.doesNotMatch(server, /urlPath === "\/bees"[\s\S]{0,160}listBeeServiceStatuses/);
});

test("daemon runtime diagnostics use lane names", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

  assert.match(server, /Desktop Lane helper unreachable on :3748/);
  assert.doesNotMatch(server, /DesktopBee helper unreachable/);
});

test("project selectors expose a visible re-scan action", () => {
  assert.match(CONSOLE_HTML, /id="projectRescanBtn"[^>]*onclick="refreshProjects\(\)"/, "header project rescan button present");
  assert.match(CONSOLE_HTML, /id="t_project_rescan"[^>]*onclick="refreshProjects\(\)"/, "empty dropdown rescan button present");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function refreshProjects\(\)[\s\S]*loadProjects\(true\)/, "refresh bypasses the project cache");
});

test("Personalization settings include app icon choice", () => {
  assert.match(CONSOLE_HTML, /id="settingsGeneral"/);
  assert.match(CONSOLE_HTML, /App icon/);
  assert.match(CONSOLE_HTML, /id="s_app_icon"/);
  assert.match(CONSOLE_HTML, /value="dark-green">Dark green<\/option>/);
  assert.match(CONSOLE_HTML, /value="white">White<\/option>/);
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function saveAppIconChoice\(/);
  assert.match(js, /appIconChoice/);
});

test("in-app Talk button is gated by the voice feature flag", () => {
  assert.match(CONSOLE_HTML, /id="talkBtn" style="display:none"/, "Talk button hidden by default");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function initVoiceFeature\(/);
  assert.match(js, /f\.key === "voice" && f\.enabled/, "shown only when the voice flag is on");
  assert.match(js, /async function toggleTalk\(/);
  assert.match(js, /\/voice\/turn/, "posts a turn to the daemon");
  assert.match(js, /MediaRecorder/, "captures the mic");
});

test("Features tab lists optional capabilities with on/off toggles", () => {
  assert.match(CONSOLE_HTML, /id="tab-features"/, "Features tab present");
  assert.match(CONSOLE_HTML, /id="settingsFeatures"/, "Features panel present");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function renderFeatures\(/);
  assert.match(js, /api\("\/settings\/features"\)/, "fetches the feature flags");
  assert.match(js, /async function toggleFeature\(/);
  assert.match(js, /settingsSwitch\(/, "renders standard settings switches");
  assert.match(js, /\/settings\/features.*method: "POST"/s, "toggles via POST");
});

test("Mixed-mode role models keep Thinking/Coding visible when the frontier provider is Codex", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /fRows\.style\.display = codex \? "none"/);
  assert.doesNotMatch(js, /s_role_codex_note/);
  assert.match(js, /roleModelOptions/);
});

test("right-panel sections are collapsible <details> with persisted open state", () => {
  // Each context section is a <details class="ctx-sec"> so the long panel can be tidied.
  for (const id of ["modelsSec", "obsSec", "connSec", "dirSec", "skillsSec", "mcpSec"]) {
    assert.match(CONSOLE_HTML, new RegExp('<details class="ctx-sec" id="' + id + '"'), id + " is a collapsible section");
  }
  // Actionable sections default open; info-heavy ones default collapsed.
  assert.match(CONSOLE_HTML, /id="connSec" open/);
  assert.match(CONSOLE_HTML, /id="skillsSec" open/);
  assert.doesNotMatch(CONSOLE_HTML, /id="obsSec" open/, "info sections default collapsed");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function wireCtxSections\(/);
  assert.match(js, /hm_sec_/, "per-section open state persisted");
  assert.match(js, /wireCtxSections\(\);/, "wired on init");
  // In-summary controls don't toggle the section.
  assert.match(CONSOLE_HTML, /event\.stopPropagation\(\);refreshModelsNow\(\)/);
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

test("server retry/reply routes format structured attachments server-side", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

  assert.match(server, /@\/lib\/tasks\/attachments/);
  assert.match(server, /normalizeTaskAttachments/);
  assert.match(server, /prependAttachmentBlock/);
  assert.match(server, /appendReplyContinuation\(String\(cur\.description \?\? ""\), text, attachments\)/);
  assert.match(server, /resolveStuck\(tid, req2\.timestamp, "reply", "console", prependAttachmentBlock\(text, attachments\)\)/);
  assert.match(server, /renderAttachmentBlock\(attachments\)/);
});

test("server task creation formats structured attachments into the description", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

  assert.match(server, /const attachments = normalizeTaskAttachments\(Array\.isArray\(body\.attachments\)/);
  assert.match(server, /const description = typeof body\.description === "string" \? body\.description : ""/);
  assert.match(server, /body\.description = appendAttachmentBlock\(description, attachments\)/);
});

test("console uploads selected task files before creating a task", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.doesNotMatch(js, /f\.path \|\| f\.name/, "browser File.path fallback should not be the attachment contract");
  assert.match(js, /async function uploadAttachmentFile\(file\)/);
  assert.match(js, /api\("\/uploads", \{ method:"POST"/);
  assert.match(js, /filename: file\.name \|\| "upload"/);
  assert.match(js, /dataBase64/);
  assert.match(js, /let _attachments = \[\]/);
  assert.match(js, /let _attachUploading = 0/);
  assert.match(js, /function setAttachmentSubmitDisabled\(/);
  assert.match(js, /btn\.disabled = _attachUploading > 0 \|\| !!_attachError/);
  assert.match(js, /if \(_attachError\) \{ err\.textContent = "Try attaching failed files again before creating the task\."; return; \}/);
  assert.match(js, /const attachments = _attachments\.slice\(\)/);
  assert.match(js, /JSON\.stringify\(\{ title: title \|\| undefined, description, attachments,/);
});

test("console sends reply and retry attachments as structured records", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(js, /const attachments = _ctxAttach\.retry\.slice\(\)/);
  assert.match(js, /if \(_ctxAttachError\.retry\) \{ hmAlert\("Try attaching failed files again before retrying\."\); return; \}/);
  assert.match(js, /body: JSON\.stringify\(\{ steer, attachments \}\)/);
  assert.match(js, /const attachments = _ctxAttach\.reply\.slice\(\)/);
  assert.match(js, /if \(_ctxAttachError\.reply\) \{ hmAlert\("Try attaching failed files again before replying\."\); return; \}/);
  assert.match(js, /body: JSON\.stringify\(\{ text, attachments \}\)/);
  assert.doesNotMatch(js, /Attached files:\\n" \+ attachments\.map\(p => "- " \+ p\)\.join\("\\n"\)/);
});

test("console ignores late reply/retry uploads after switching tasks", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(js, /let _ctxAttachNonce = 0/);
  assert.match(js, /_ctxAttachNonce \+= 1/);
  assert.match(js, /const attachNonce = _ctxAttachNonce/);
  assert.match(js, /if \(attachNonce !== _ctxAttachNonce\) continue/);
  assert.match(js, /if \(attachNonce === _ctxAttachNonce\) \{/);
});

test("console can clear failed optional attachment uploads", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(js, /function clearAttachError\(\)/);
  assert.match(js, /function clearCtxAttachError\(ctx\)/);
  assert.match(js, /Continue without failed file/);
});

test("frontier usage panel renders a separate Codex usage section", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /codexSubscription/);
  assert.match(js, /Codex subscription/);
  assert.match(js, /renderCodexBar/);
});

test("models panel has a manual refresh that bypasses cached auth state", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /usageRefresh/);
  assert.match(js, /function refreshModelsNow/);
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

function extractExecutionHelpers(html: string): {
  executionProviderLabel: (model: string | null | undefined) => string;
  executionRoleLabel: (task: Record<string, unknown>, output: Record<string, unknown>) => string;
  taskExecutionPanel: (task: Record<string, unknown>, output: Record<string, unknown>) => string;
} {
  const js = extractScript(html);
  const esc = js.match(/function esc\(s\)\{[^\n]+\}/);
  const block = js.match(/\/\*__EXECUTION_HELPERS_START__\*\/([\s\S]*?)\/\*__EXECUTION_HELPERS_END__\*\//);
  assert.ok(esc, "console script must define esc");
  assert.ok(block, "console script must define execution helper block");
  const factory = new Function(`${esc![0]}\n${block![1]}\nreturn { executionProviderLabel, executionRoleLabel, taskExecutionPanel };`) as () => {
    executionProviderLabel: (model: string | null | undefined) => string;
    executionRoleLabel: (task: Record<string, unknown>, output: Record<string, unknown>) => string;
    taskExecutionPanel: (task: Record<string, unknown>, output: Record<string, unknown>) => string;
  };
  return factory();
}

test("skills & commands render in one unified, searchable section", () => {
  // Skills and Commands are a single section over both catalogs (lib skills +
  // local commands), with a live-search list and a per-item detail panel —
  // replacing the old dropdown-plus-button-wall.
  assert.match(CONSOLE_HTML, /id="skillsSec"[^>]*><summary>Skills &amp; Commands<\/summary>/, "unified section present");
  assert.match(CONSOLE_HTML, /id="skQuery"/, "live search input present");
  assert.match(CONSOLE_HTML, /id="skList" class="sk-list"/, "catalog list present");
  assert.match(CONSOLE_HTML, /id="skDetail" class="sk-detail"/, "detail panel present");
  // Imports are unified into one Add modal with source tabs.
  assert.match(CONSOLE_HTML, /id="addSkillOverlay"/, "unified Add modal present");
  assert.match(CONSOLE_HTML, /onclick="addTab\('shared'\)"/, "Add modal has a shared-scope source tab");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function renderSkillCatalog\(/, "catalog loader present");
  assert.match(js, /function commandMetaChips\(/, "metadata chips helper present");
  assert.match(js, /catalog: local profile catalog/, "command inspect copy is provider-neutral");
  assert.doesNotMatch(js, /catalog: Claude local profile/, "command inspect copy does not overclaim Claude execution");
  // The old separate Commands section / dropdown is gone.
  assert.doesNotMatch(CONSOLE_HTML, /id="commandsSec"/, "no separate Commands section");
  assert.doesNotMatch(CONSOLE_HTML, /id="skillSelect"/, "no bare skill dropdown");
});

test("unified skills section contains long metadata inside the context column", () => {
  // The list rows and chips must not overflow the narrow context column.
  assert.match(CONSOLE_HTML, /\.sk-list \{[^}]*overflow:auto;/);
  assert.match(CONSOLE_HTML, /\.sk-row \.sk-desc \{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;/);
  assert.match(CONSOLE_HTML, /\.command-chip \{[^}]*min-width:0;[^}]*max-width:100%;[^}]*display:inline-block;/);
});

test("header is grouped into zones with a theme toggle and grouped connectivity", () => {
  assert.match(CONSOLE_HTML, /class="hzone"/, "header uses zones");
  assert.match(CONSOLE_HTML, /class="hgroup"[\s\S]*id="modeSel"[\s\S]*id="modePill"/, "connectivity select + effective-mode pill grouped as one unit");
  assert.match(CONSOLE_HTML, /id="themeToggle"[^>]*onclick="toggleThemeQuick\(\)"/, "header has a quick theme toggle");
  assert.match(CONSOLE_HTML, /@media \(max-width: 760px\)[\s\S]*\.hlabel \{ display: none/, "header labels hide on narrow widths");
});

test("settings auto-save with toast feedback and open on Models", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="s_default"[^>]*onchange="saveDefault\(\)"/, "default model auto-saves on change");
  assert.match(CONSOLE_HTML, /id="s_endpoint"[^>]*onchange="saveEndpoint\(\)"/, "endpoint auto-saves on change");
  assert.doesNotMatch(CONSOLE_HTML, /onclick="saveDefault\(\)"/, "no separate Save-default button");
  assert.doesNotMatch(CONSOLE_HTML, /onclick="saveEndpoint\(\)"/, "no separate Save-endpoint button");
  assert.match(js, /function hmToast\(/, "toast helper present");
  assert.match(js, /function openSettings\(\)[\s\S]*switchSettingsTab\("models"\)/, "settings lands on Models, not About");
});

test("center column shows an overview when no task is selected", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function renderOverview\(/, "overview renderer present");
  assert.match(js, /else renderOverview\(\)/, "refresh shows the overview when nothing is selected");
});

test("execution provenance covers Claude, ChatGPT/Codex, and Qwen/local modes", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /taskExecutionPanel\(t, out\)/, "task detail view renders execution provenance");

  const helpers = extractExecutionHelpers(CONSOLE_HTML);
  assert.equal(helpers.executionProviderLabel("claude-opus-4-8"), "Claude");
  assert.equal(helpers.executionProviderLabel("codex:gpt-5.4"), "ChatGPT/Codex");
  assert.equal(helpers.executionProviderLabel("qwen/qwen3.6-27b"), "Qwen/local");

  const claude = helpers.taskExecutionPanel(
    { model: "claude-opus-4-8", profile: "developer", agentType: "auto", source: "dashboard" },
    { modelsUsed: ["claude-opus-4-8"], routedTier: "frontier-premium" },
  );
  assert.match(claude, /Claude/);
  assert.match(claude, /Thinking/);
  assert.match(claude, /frontier-premium/);

  const codex = helpers.taskExecutionPanel(
    { model: "codex:gpt-5.4", profile: "developer", agentType: "auto", source: "command" },
    { modelsUsed: ["codex:gpt-5.4"], command: "import-vodafone" },
  );
  assert.match(codex, /ChatGPT\/Codex/);
  assert.match(codex, /Coding/);
  assert.match(codex, /Command launcher/);

  const qwen = helpers.taskExecutionPanel(
    { model: "qwen\/qwen3.6-27b", profile: "developer", agentType: "auto", source: "directive" },
    { modelsUsed: ["qwen\/qwen3.6-27b"], routedTier: "local-secondary", directivePhase: "executor" },
  );
  assert.match(qwen, /Qwen\/local/);
  assert.match(qwen, /Executor/);
  assert.match(qwen, /local-secondary/);
});

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

test("settings lanes sections have distinct, non-duplicate labels", () => {
  // The duplicate-feeling pair was "Lane Apps" (installable apps) vs "Embedded
  // capability lanes" (daemon runtime). The latter is relabeled so it no longer
  // reads as a second app inventory.
  assert.match(CONSOLE_HTML, /Lane Apps/, "Lane Apps card kept as the app installer");
  assert.match(CONSOLE_HTML, /Runtime Capabilities/, "embedded lanes relabeled to Runtime Capabilities");
  assert.match(CONSOLE_HTML, /Browser Lane Sites &amp; Auth/, "browser readiness relabeled to Sites & Auth");
  assert.match(CONSOLE_HTML, /Terminal Lane Profiles &amp; Readiness/, "matching Terminal Lane readiness card added");
  assert.doesNotMatch(CONSOLE_HTML, /Embedded capability lanes/, "old duplicate-feeling label is gone");
});

test("Lane Apps still names both Browser Lane and Terminal Lane", () => {
  // Lane Apps is the canonical install/update/verify/launch surface for both apps.
  const start = CONSOLE_HTML.indexOf("Lane Apps");
  const end = CONSOLE_HTML.indexOf("Runtime Capabilities");
  assert.ok(start >= 0 && end > start, "Lane Apps precedes Runtime Capabilities");
  const laneAppsCopy = CONSOLE_HTML.slice(start, end);
  assert.match(laneAppsCopy, /Browser Lane and Terminal Lane are standalone signed apps/, "Lane Apps copy names both apps");
});

test("readiness cards sit directly under Lane Apps, before Runtime Capabilities", () => {
  const laneApps = CONSOLE_HTML.indexOf("Lane Apps");
  const browserSites = CONSOLE_HTML.indexOf("Browser Lane Sites &amp; Auth");
  const terminalReadiness = CONSOLE_HTML.indexOf("Terminal Lane Profiles &amp; Readiness");
  const runtime = CONSOLE_HTML.indexOf("Runtime Capabilities");
  assert.ok(laneApps >= 0 && browserSites > laneApps, "Browser Lane Sites & Auth follows Lane Apps");
  assert.ok(terminalReadiness > browserSites, "Terminal readiness follows Browser readiness");
  assert.ok(runtime > terminalReadiness, "Runtime Capabilities comes after both readiness cards");
});

test("board no longer renders the hardcoded AI-news video shortcut", () => {
  assert.doesNotMatch(CONSOLE_HTML, /AI-news video/, "bespoke AI-news video board button removed");
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /draftVideoNow/, "no board shortcut wiring or unused draftVideoNow function");
});

test("+ New task and task creation remain after removing the shortcut", () => {
  assert.match(CONSOLE_HTML, /＋ New task/, "+ New task button kept");
  assert.match(CONSOLE_HTML, /toggleForm\('taskForm'\)/, "+ New task still toggles the form");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function createTask\(/, "task creation flow preserved");
});

test("board column has an Overview nav above + New task", () => {
  assert.match(CONSOLE_HTML, /id="overviewNav"/, "Overview nav control present");
  assert.match(CONSOLE_HTML, /class="ov-nav"[^>]*id="overviewNav"|id="overviewNav"[^>]*class="ov-nav"/, "uses the compact ov-nav style");
  assert.ok(
    CONSOLE_HTML.indexOf('id="overviewNav"') < CONSOLE_HTML.indexOf("＋ New task"),
    "Overview sits above the + New task button",
  );
  assert.match(CONSOLE_HTML, /id="overviewNav"[^>]*onclick="showOverview\(\)"/, "clicking it returns to overview");
});

test("showOverview clears the selected task and renders the overview", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = js.match(/function showOverview\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(body.length > 20, "showOverview defined");
  assert.match(body, /state\.selected = null/, "clears the selected task");
  assert.match(body, /renderOverview\(\)/, "renders the overview state");
  // Active-state sync lives in renderBoard via updateOverviewNav.
  assert.match(js, /function updateOverviewNav\(/, "active-state helper present");
});

test("task detail renders a Back to overview action", () => {
  const js = extractScript(CONSOLE_HTML);
  const selectTask = js.match(/async function selectTask\(id\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(selectTask.length > 100, "selectTask body extracted");
  assert.match(selectTask, /ov-back/, "detail header has a back-to-overview control");
  assert.match(selectTask, /showOverview\(\)/, "the back control calls showOverview");
});

test("Escape returns to Overview only outside editable fields", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function isEditableTarget\(/, "editable-focus guard present");
  assert.match(js, /isContentEditable/, "guards contenteditable focus");
  assert.match(js, /e\.key !== "Escape"/, "only acts on the Escape key");
  assert.match(js, /\.overlay\.open/, "does not steal Escape from open modals");
  assert.match(js, /addEventListener\("keydown"/, "a keydown listener is registered");
});

test("new task and task selection remain intact", () => {
  assert.match(CONSOLE_HTML, /toggleForm\('taskForm'\)/, "+ New task still toggles the task form");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function createTask\(/, "createTask flow preserved");
  assert.match(js, /onclick="selectTask\(/, "task cards remain selectable in renderBoard");
});

test("frontier usage has its own Usage section above Models", () => {
  assert.match(CONSOLE_HTML, /id="usageSec"/, "standalone Usage section present");
  assert.match(CONSOLE_HTML, /<details class="ctx-sec" id="usageSec" open>/, "Usage is a collapsible ctx-sec, open by default");
  assert.ok(
    CONSOLE_HTML.indexOf('id="usageSec"') < CONSOLE_HTML.indexOf('id="modelsSec"'),
    "Usage section sits above the Models section",
  );
});

test("Usage section renders Claude and Codex provider cards", () => {
  assert.match(CONSOLE_HTML, /id="usageSummary"/, "at-a-glance summary mount present");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /getElementById\("usageSummary"\)/, "checkUsage fills the summary");
  assert.match(js, /usageProviderCard\("Claude"/, "Claude card rendered");
  assert.match(js, /usageProviderCard\("Codex"/, "Codex card rendered");
  assert.match(js, /function usageProviderCard\(/, "compact provider card renderer present");
});

test("per-window usage details remain available but secondary", () => {
  assert.match(CONSOLE_HTML, /id="usageDetailsSec"/, "per-window details disclosure present");
  const usageSec = CONSOLE_HTML.indexOf('id="usageSec"');
  const usage = CONSOLE_HTML.indexOf('id="usage"');
  const modelsSec = CONSOLE_HTML.indexOf('id="modelsSec"');
  assert.ok(usageSec >= 0 && usage > usageSec && usage < modelsSec, "#usage detail lives inside the Usage section, not Models");
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /Frontier · cloud/, "usage no longer buried under a Models 'Frontier · cloud' header");
});

test("Models panel still shows local engine and embeddings", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /Local · on-device/, "local engine group kept in Models");
  assert.match(js, /Embeddings/, "embeddings group kept in Models");
  assert.match(js, /getElementById\("modelStatus"\)/, "checkModels still fills modelStatus");
});

test("header usage pill shows a concise percent-and-reset summary", () => {
  assert.match(CONSOLE_HTML, /id="usagePill"/, "header usage pill kept");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function fmtResetsCompact\(/, "compact reset formatter present");
  assert.match(js, /"% · "/, "pill uses the '<pct>% · <reset>' format");
  // Regression guard: the no-subscription fallback line is preserved verbatim.
  assert.match(js, /pill\.textContent = "⚡ " \+ \(u\.taskCount/, "task-count fallback preserved");
});

test("Usage UI introduces no dollar/cost copy", () => {
  const js = extractScript(CONSOLE_HTML);
  const checkUsage = js.match(/async function checkUsage\([\s\S]*?\n\}/)?.[0] ?? "";
  const card = js.match(/function usageProviderCard\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(checkUsage.length > 100 && card.length > 50, "usage function bodies extracted");
  assert.doesNotMatch(checkUsage + card, /\$\d|\bcost\b/i, "no dollar amounts or cost copy in the Usage UI");
});

test("settings surfaces a real Terminal Lane readiness card with no secrets", () => {
  assert.match(CONSOLE_HTML, /id="terminal_readiness"/, "Terminal readiness mount point present");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function renderTerminalReadiness\(/, "Terminal readiness renderer present");
  assert.match(js, /api\("\/terminal-lane\/dashboard"\)/, "uses the existing daemon dashboard endpoint");
  assert.match(js, /\/terminal-lane\/readiness\/run/, "uses the existing daemon run-probe endpoint");
  assert.match(js, /renderTerminalReadiness\(\);/, "rendered when the Lanes tab opens");
  // No fabricated readiness: honest empty state when nothing is configured.
  assert.match(js, /No Terminal Lane profiles are configured\./, "honest empty state, no fake green");
  // Secrets guard: the readiness render must not surface any credential ref/value.
  const render = js.match(/async function renderTerminalReadiness\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(render.length > 50, "renderTerminalReadiness body extracted");
  assert.doesNotMatch(render, /credentialRef|password|private_key|ssh_key_passphrase/, "no secrets surfaced in the UI");
});
