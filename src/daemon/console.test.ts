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

test("settings surfaces the no-audio voice logic diagnostic", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /Voice logic test/, "Settings has a voice logic diagnostic row");
  assert.match(js, /function runVoiceLogicTest\(/, "has a Settings action for the diagnostic");
  assert.match(js, /\/settings\/voice\/test-scenarios/, "calls the no-audio diagnostic endpoint");
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
  assert.match(js, /class="primary-action"[^>]*>Reply</);
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

test("task-detail action rows use the standardized .action-bar token set", () => {
  // Reusable pattern + role classes are defined once in CSS.
  assert.match(CONSOLE_HTML, /\.action-bar\s*\{/, ".action-bar defined");
  assert.match(CONSOLE_HTML, /\.primary-action\b/, ".primary-action defined");
  assert.match(CONSOLE_HTML, /\.secondary-action\b/, ".secondary-action defined");
  assert.match(CONSOLE_HTML, /\.danger-action\b/, ".danger-action defined");
  assert.match(CONSOLE_HTML, /\.ghost-action\b/, ".ghost-action defined");
  // Consistent sizing tokens + accessible focus on every bar button.
  assert.match(CONSOLE_HTML, /\.action-bar > button[^}]*min-height/, "buttons share a min-height");
  assert.match(CONSOLE_HTML, /\.action-bar > button[^}]*min-width/, "buttons share a min-width");
  assert.match(CONSOLE_HTML, /\.action-bar > button:focus-visible/, "visible focus ring for accessibility");
  const js = extractScript(CONSOLE_HTML);
  // Task detail emits the standardized bar, not the old ad-hoc .actions row.
  assert.match(js, /class="action-bar"/, "taskActionsHtml uses .action-bar");
  assert.doesNotMatch(js, /class="actions"/, "old .actions row removed from task detail");
});

test("reply textarea is full-width/responsive, not a narrow inline box", () => {
  // The textarea fills the column at any width, with a stable min-height.
  assert.match(CONSOLE_HTML, /\.reply-input\s*\{[^}]*width:\s*100%/, ".reply-input is full width");
  assert.match(CONSOLE_HTML, /\.reply-input\s*\{[^}]*box-sizing:\s*border-box/, ".reply-input uses border-box");
  assert.match(CONSOLE_HTML, /\.reply-input\s*\{[^}]*min-height/, ".reply-input has a stable min-height");
  // No misleading flex:1 (a no-op outside a flex parent) and no inline fixed width.
  assert.doesNotMatch(CONSOLE_HTML, /\.reply-input\s*\{[^}]*flex:\s*1/, "drop the no-op flex:1");
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /reply-input"[^>]*style="[^"]*width/, "no inline fixed-width on reply textareas");
});

test("center column is a responsive container that stacks action bars when narrow", () => {
  assert.match(CONSOLE_HTML, /\.col\.session[^}]*container-type:\s*inline-size/, "session column is a query container");
  assert.match(CONSOLE_HTML, /@container[^{]*\{[\s\S]*?\.action-bar\s*\{[^}]*flex-direction:\s*column/, "action bars stack on narrow columns");
});

test("task-detail keeps one clear primary; toggles secondary, delete danger", () => {
  const js = extractScript(CONSOLE_HTML);
  // The submit buttons are the primary actions.
  assert.match(js, /class="primary-action"[^>]*onclick="replyTask/, "Reply submit is primary");
  assert.match(js, /class="primary-action"[^>]*onclick="submitRetry/, "Retry submit is primary");
  assert.match(js, /class="primary-action"[^>]*onclick="submitSteer/, "Steer submit is primary");
  // Top-bar toggles are secondary (keep reply-toggle for active highlight); Delete is danger.
  assert.match(js, /class="secondary-action reply-toggle"[^>]*onclick="toggleRetry/, "Retry toggle is secondary");
  assert.match(js, /class="secondary-action reply-toggle"[^>]*onclick="toggleReply/, "Reply toggle is secondary");
  assert.match(js, /class="danger-action"[^>]*onclick="deleteTask/, "Delete is a danger action");
  // No duplicated ad-hoc role class for the same (primary) role.
  assert.doesNotMatch(CONSOLE_HTML, /reply-primary/, "reply-primary consolidated into primary-action");
});

test("video review controls use the standardized action row with a single primary", () => {
  const js = extractScript(CONSOLE_HTML);
  const m = js.match(/executor === "video-review"\)\s*\{([\s\S]*?)\} else if \(!steerable\)/);
  assert.ok(m, "video-review branch present");
  const block = m![1];
  assert.match(block, /class="action-bar"/, "video review uses .action-bar");
  assert.match(block, /class="ghost-action"[^>]*loadDraftIntoReply/, "Edit script is a ghost action");
  assert.match(block, /class="danger-action"[^>]*videoReviewAction\([^)]*cancel/, "Cancel is a danger action");
  const primaries = block.match(/class="primary-action"/g) || [];
  assert.equal(primaries.length, 1, "exactly one primary action in the video review block");
});

test("upload-disable targets the primary submit button, not the first button in the row", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /setCtxSubmitDisabled[\s\S]*?querySelector\(".primary-action"\)/, "disable targets .primary-action");
  assert.doesNotMatch(js, /querySelector\(".reply-row button"\)/, "old .reply-row button selector removed");
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

test("loading models refreshes About version metadata", () => {
  const js = extractScript(CONSOLE_HTML);
  const loadModels = js.match(/async function loadModels\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(loadModels, /models = await api\("\/models"\)/, "loadModels fetches the version-bearing models payload");
  assert.match(loadModels, /renderAbout\(\)/, "About metadata re-renders after models load");
  assert.ok(
    loadModels.indexOf("renderAbout()") > loadModels.indexOf('models = await api("/models")'),
    "About should refresh after the models payload is assigned",
  );
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

test("server retry route clears queued delay fields", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

  assert.match(server, /status: "backlog", error: null, agentPid: null, startedAt: null, completedAt: null, reviewState: null,\s+delayUntil: null, delayReason: null,/);
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

test("settings auto-save with toast feedback and open on About", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="s_default"[^>]*onchange="saveDefault\(\)"/, "default model auto-saves on change");
  assert.match(CONSOLE_HTML, /id="s_endpoint"[^>]*onchange="saveEndpoint\(\)"/, "endpoint auto-saves on change");
  assert.doesNotMatch(CONSOLE_HTML, /onclick="saveDefault\(\)"/, "no separate Save-default button");
  assert.doesNotMatch(CONSOLE_HTML, /onclick="saveEndpoint\(\)"/, "no separate Save-endpoint button");
  assert.match(js, /function hmToast\(/, "toast helper present");
  assert.match(js, /function openSettings\(\)[\s\S]*switchSettingsTab\("about"\)/, "settings lands on About by default");
});

test("center column shows an overview when no task is selected", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function renderOverview\(/, "overview renderer present");
  assert.match(js, /else renderOverview\(\)/, "refresh shows the overview when nothing is selected");
});

test("task detail does not render an execution provenance panel", () => {
  const js = extractScript(CONSOLE_HTML);
  // The execution panel (provider / profile / models-used) was removed from the task detail
  // view — operators see status, result, transcript, and debug strip only.
  assert.doesNotMatch(js, /taskExecutionPanel\(t, out\)/, "execution panel must not be rendered in selectTask");
  assert.doesNotMatch(CONSOLE_HTML, /class="exec-panel"/, "exec-panel CSS class must be absent");
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

test("board renders Flight context for linked review cards only", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function flightContextBadge\(/, "board has a Flight context helper");
  assert.match(js, /Flight Review/, "review Flight items use review wording, not failure wording");
  assert.match(js, /awaiting accept/, "review Flight tooltip explains the operator action");
  assert.doesNotMatch(js, /Blocks Flight/, "review Flight items should not read like failure blockers");
  assert.match(js, /itemStatus/, "Flight chip includes the linked item status");
  assert.match(js, /landedCount/, "Flight chip includes landed count");
  assert.match(js, /flightContextBadge\(t\)/, "renderBoard appends the Flight context line per card");
  assert.match(js, /if \(!fc\) return "";/, "non-Flight cards render no extra Flight chip");
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

test("the lane 'update' action targets the real install endpoint (not a dead /update route)", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = js.match(/function laneActionCall\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(body.length > 20, "laneActionCall extracted");
  const laneActionCall = new Function(body + "\nreturn laneActionCall;")() as (id: string, action: string) => string;
  // The bug: "update" mapped to laneAppAction(id,'update') → POST /lane-apps/:id/update (404).
  assert.equal(laneActionCall("terminal-lane", "update"), "laneAppAction('terminal-lane','install')");
  assert.equal(laneActionCall("terminal-lane", "install"), "laneAppAction('terminal-lane','install')");
  assert.equal(laneActionCall("terminal-lane", "open"), "laneAppAction('terminal-lane','launch')");
  assert.equal(laneActionCall("terminal-lane", "repair"), "laneRepairApplications('terminal-lane')");
  assert.equal(laneActionCall("terminal-lane", "run_readiness"), "laneRunReadiness('terminal-lane')");
});

test("the lane primary action button is prominent and color-coded for updates", () => {
  // A globally-scoped style (not the form-only .create) + an amber 'update' variant.
  assert.match(CONSOLE_HTML, /\.lane-primary\b/, "lane-primary style defined");
  assert.match(CONSOLE_HTML, /\.lane-primary\.update\b/, "amber update variant defined");
  const js = extractScript(CONSOLE_HTML);
  const render = js.match(/async function renderLaneSetup\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(render, /lane-primary/, "card primary uses lane-primary");
  // The update color is applied for update/install/repair actions.
  assert.match(render, /install.*update.*repair|update.*install.*repair|"install"\s*\|\|\s*na\.action === "update"/, "update modifier gated on action");
  assert.match(render, /Update Lane Apps/, "banner button present");
});

test("Lane Apps cards are driven by the unified /lane-setup model", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function renderLaneSetup\(/, "unified Lane Setup renderer present");
  assert.match(js, /api\("\/lane-setup"\)/, "fetches the unified model");
  assert.match(js, /getElementById\("lane_apps"\)/, "fills the Lane Apps mount");
  assert.match(js, /renderLaneSetup\(\)/, "wired into the Lanes tab");
  // The old basic renderer is gone (replaced by the reliability model).
  assert.doesNotMatch(js, /async function renderLaneApps\(/, "old renderLaneApps replaced");
});

test("Lane Setup cards show install/signing/launch/daemon state and readiness", () => {
  const js = extractScript(CONSOLE_HTML);
  const render = js.match(/async function renderLaneSetup\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(render.length > 200, "renderLaneSetup body extracted");
  assert.match(render, /installState/, "renders install state");
  assert.match(render, /Signing/, "signing chip");
  assert.match(render, /Launch/, "launch chip");
  assert.match(render, /Daemon/, "daemon chip");
  assert.match(render, /nextAction/, "renders the single primary next action");
  assert.match(render, /readiness/, "renders the readiness summary");
});

test("Lane Setup buttons are never dead — disabled ones carry a visible reason", () => {
  const js = extractScript(CONSOLE_HTML);
  const render = js.match(/async function renderLaneSetup\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(render, /disabledReasons/, "uses the model's disabledReasons");
  // Buttons reuse the shared HiveMatrix styles via the laneBtn helper.
  assert.match(render, /"lane-primary"/, "primary uses the prominent lane-primary style");
  assert.match(render, /"copybtn"/, "secondary uses the shared .copybtn style");
  assert.match(js, /function laneBtn\([\s\S]*?<button class="'\s*\+\s*cls/, "laneBtn renders disabled buttons with a reason title");
  assert.match(js, /disabled title=/, "disabled buttons carry a reason title");
});

test("Browser Lane dashboard surfaces auth strategy and never claims to bypass human verification", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /authStrategy/, "auth strategy surfaced in the readiness dashboard");
  assert.match(js, /Google SSO|Microsoft SSO/, "named SSO strategies");
  // Honest session states.
  assert.match(js, /Logged-in session observed|Manual sign-in required/, "honest session-state copy");
  // Future-use + no-bypass hint (static copy).
  assert.match(CONSOLE_HTML, /persists in [^<]*WebKit/, "explains the WebKit session persists after closing");
  assert.match(CONSOLE_HTML, /CAPTCHA|2FA/, "states human verification still needed");
  assert.match(CONSOLE_HTML, /never bypass(es)? human verification|still need you/i, "no bypass claim");
});

test("Terminal Lane copy explains local vs SSH (local needs no key)", () => {
  assert.match(CONSOLE_HTML, /Local profiles run a shell on this Mac/, "local shell explained");
  assert.match(CONSOLE_HTML, /no key or login secret needed/i, "local needs no auth material");
  assert.match(CONSOLE_HTML, /Keychain/, "SSH secret lives in Keychain");
});

test("subordinate readiness sections remain below the Lane Apps cards", () => {
  assert.match(CONSOLE_HTML, /Browser Lane Sites &amp; Auth/, "browser drill-down kept");
  assert.match(CONSOLE_HTML, /Terminal Lane Profiles &amp; Readiness/, "terminal drill-down kept");
  const laneApps = CONSOLE_HTML.indexOf("Lane Apps");
  const browserSites = CONSOLE_HTML.indexOf("Browser Lane Sites &amp; Auth");
  assert.ok(laneApps >= 0 && browserSites > laneApps, "Lane Apps cards stay above the drill-downs");
});

test("board no longer renders the hardcoded AI-news video shortcut", () => {
  assert.doesNotMatch(CONSOLE_HTML, /AI-news video/, "bespoke AI-news video board button removed");
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /draftVideoNow/, "no board shortcut wiring or unused draftVideoNow function");
});

test("+ New task and task creation remain after removing the shortcut", () => {
  assert.match(CONSOLE_HTML, /＋ New task/, "+ New task button kept");
  assert.match(CONSOLE_HTML, /showNewTaskPanel\(\)/, "+ New task opens the center-column panel");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function createTask\(/, "task creation flow preserved");
  assert.match(js, /function showNewTaskPanel\(/, "center-column task panel flow preserved");
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
  assert.match(CONSOLE_HTML, /onclick="showNewTaskPanel\(\)"/, "+ New task opens the task form");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function createTask\(/, "createTask flow preserved");
  assert.match(js, /function _closeNewTaskPanel\(/, "task form can return to the board column");
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

test("Settings Models includes configurable embedding model choices", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="s_embedding_model"/, "embedding model selector present");
  assert.match(CONSOLE_HTML, /Rapid-MLX Qwen3 Embedding 8B/, "Rapid-MLX Qwen preset is visible");
  assert.match(js, /function saveEmbeddingsSettings\(/, "embedding settings save handler present");
  assert.match(js, /applyEmbeddingChoice/, "embedding preset handler present");
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

// ─── New Task project picker (2026-06-27) ────────────────────────────────────
// The New Task form must expose ONE searchable Project control; the working
// directory is derived from the selection (hidden), never a primary editable
// input. Path assertions are scoped to the task-form slice so the (out-of-scope)
// directive path field does not pollute results.
function taskFormSlice(html: string): string {
  const start = html.indexOf('id="taskForm"');
  const end = html.indexOf('id="board"');
  assert.ok(start >= 0 && end > start, "task form slice located");
  return html.slice(start, end);
}

function fnBody(js: string, name: string): string {
  const re = new RegExp("(?:async )?function " + name + "\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}");
  const m = js.match(re);
  assert.ok(m, name + " function present");
  return m![0];
}

test("New task path field is hidden, not a primary editable input", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, /id="t_path"[^>]*type="hidden"/, "path is a hidden derived store");
  assert.doesNotMatch(slice, /Project path \(working dir\)/, "stale raw-path placeholder removed");
  assert.doesNotMatch(slice, /placeholder="Project path/, "no visible project-path input in the task form");
});

test("New task uses one Project control with derived path as secondary text", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, />Project<\/label>/, "a single 'Project' label");
  assert.match(slice, /id="t_project_search"/, "searchable combobox kept");
  assert.match(slice, /id="t_project_selected"/, "selected-project row (name + muted path) present");
});

test("project selection routes through a single setTaskProject writer", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "setTaskProject");
  assert.match(body, /selectedProject = \(name \|\| path\) \? \{ name: name \|\| "", path: path \|\| "", custom: !!custom \} : null/, "writes the selected project object");
  assert.match(body, /getElementById\("t_path"\)/, "writes the derived path store");
  assert.match(body, /renderSelectedProject\(/, "refreshes the selected-project row");
  // The dropdown click path delegates to the single writer.
  assert.match(fnBody(js, "selectProjectFromDropdown"), /setTaskProject\(/);
});

test("project dropdown filters by name or path", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "renderProjectDropdown");
  assert.match(body, /\.name\.toLowerCase\(\)\.includes/, "matches on name");
  assert.match(body, /\.path\.toLowerCase\(\)\.includes/, "matches on path");
});

test("project picker supports keyboard nav (ArrowDown/ArrowUp/Enter/Escape)", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, /onkeydown="onProjectSearchKeydown/, "search input is wired to the keydown handler");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /projectHighlightIndex/, "tracks a keyboard highlight index");
  const body = fnBody(js, "onProjectSearchKeydown");
  assert.match(body, /ArrowDown/, "handles ArrowDown");
  assert.match(body, /ArrowUp/, "handles ArrowUp");
  assert.match(body, /e\.key === "Enter"/, "handles Enter");
  assert.match(body, /e\.key === "Escape"/, "handles Escape");
});

test("Use another folder is an explicit advanced disclosure", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, /Use another folder/, "explicit custom-folder action present");
  assert.match(slice, /id="t_custom_folder"/, "custom-folder disclosure block present");
  assert.match(slice, /id="t_custom_path"/, "one-off path input present");
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "useCustomFolder");
  assert.match(body, /setTaskProject\([^)]*true\)/, "custom folder sets the selection with the custom flag");
});

test("createTask builds the payload from the selection (no freeform path/search read)", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "createTask");
  assert.match(body, /const projectPath = selectedProject\.path/, "project path comes from the selection state");
  assert.match(body, /const projectName = selectedProject\.name/, "project name comes from the selection state");
  assert.match(body, /project: projectName/, "payload project is the selected name, not the search box");
  assert.doesNotMatch(body, /getElementById\("t_project_search"\)\.value/, "never reads the freeform filter text into the payload");
});

test("createTask validates with human-readable messages", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "createTask");
  assert.match(body, /Please describe what the agent should do\./, "description required");
  assert.match(body, /Please choose a project/, "project required");
  assert.match(body, /Please choose a model before creating the task\./, "model required");
  // Old technical phrasing is gone.
  assert.doesNotMatch(body, /Description and project path are required\./, "stale technical error removed");
});

test("New task keeps the model selector and attachments controls", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, /<select id="t_model">/, "model selector kept");
  assert.match(slice, /id="t_attach_input"/, "attachment input kept");
  assert.match(slice, /onclick="createTask\(\)"/, "Create task button kept");
});

test("Flight detail includes a Loop section with controls in the Flight view", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /flight-loop-sec/, "loop section class exists");
  assert.match(js, /function flightLoopSectionHtml\(/, "loop section renderer exists");
  assert.match(js, /async function wpRunPass\(/, "Run pass control exists");
  assert.match(js, /async function wpPauseLoop\(/, "Pause loop control exists");
  assert.match(js, /async function wpResumeLoop\(/, "Resume loop control exists");
  assert.match(js, /async function wpEditLoop\(/, "Edit loop control exists");
  assert.match(js, /async function wpSetupLoop\(/, "Setup loop control exists");
  // Loop section must be called from renderFlightDetail with the flight id
  assert.match(js, /flightLoopSectionHtml\(id,\s*loop,\s*passes\)/, "loop section wired into renderFlightDetail");
});

test("Flight detail renders pass history rows", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function flightPassRowHtml\(/, "pass row renderer exists");
  assert.match(js, /flight-pass-list/, "pass list class exists");
  assert.match(js, /flight-pass-row/, "pass row class exists");
  assert.match(js, /Pass History/, "pass history heading text exists");
  assert.match(js, /pass\.passNumber/, "pass number is displayed");
  assert.match(js, /pass\.summary/, "pass summary is displayed");
});

test("Flight loop controls are in the Flight detail, not a hidden Settings panel", () => {
  const js = extractScript(CONSOLE_HTML);
  // Setup loop button is emitted from flightLoopSectionHtml, not settings
  assert.match(js, /wpSetupLoop\(\\\''\+esc\(pkgId\)/, "setup loop button wired to pkgId in loop section");
  // Loop section fetches from the correct API paths
  assert.match(js, /\/loop\/run-pass/, "run-pass endpoint referenced");
  assert.match(js, /\/loop\/pause/, "pause endpoint referenced");
  assert.match(js, /\/loop\/resume/, "resume endpoint referenced");
  // Passes are fetched for the active loop
  assert.match(js, /\/loop\/passes/, "passes endpoint fetched in renderFlightDetail");
});

test("console flightLabel handles done_with_skips status as a done variant", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /done_with_skips/, "console handles done_with_skips status");
});

test("console flightLabel handles archived item status", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /archived/, "console handles archived item status");
});

test("console flight status badges are color-coordinated by status", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function flightBadgeClass/, "flightBadgeClass helper defined");
  // Status badges in the item head and flight header pull the semantic class.
  assert.match(js, /class="badge '\+flightBadgeClass\(it\.status\)/, "item status badge uses flightBadgeClass");
  assert.match(js, /class="badge '\+flightBadgeClass\(p\.status\)/, "flight header status badge uses flightBadgeClass");
  // Mapping mirrors the overview cards: active → warn, success/review → ok, failure → err.
  assert.match(js, /"running" \|\| status === "held"\) return "warn"/, "running/held → warn");
  assert.match(js, /"review"\) return "ok"/, "done/review → ok");
  assert.match(js, /"failed"\) return "err"/, "failed → err");
});

test("console flight rail cards are color-coded by status", () => {
  const js = extractScript(CONSOLE_HTML);
  // The rail card itself carries the semantic class so in-flight, staged,
  // landed and blocked Flights are visually distinct at a glance.
  assert.match(js, /class="flight-card '\+flightBadgeClass\(p\.status\)/, "flight-card pulls flightBadgeClass");
  // Tinted-border styles mirror the overview cards.
  assert.match(CONSOLE_HTML, /\.flight-card\.warn\b/, ".flight-card.warn style present");
  assert.match(CONSOLE_HTML, /\.flight-card\.ok\b/, ".flight-card.ok style present");
  assert.match(CONSOLE_HTML, /\.flight-card\.err\b/, ".flight-card.err style present");
});

test("console flightPassRowHtml handles skipped pass status", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /'skipped'|"skipped"/, "console references skipped pass status");
});

test("console flightProgress uses skippedCount from API to expose intentionally skipped scope", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /skippedCount/, "flightProgress reads skippedCount from the package detail");
});

test("console flight detail shows skipped-scope text when skippedCount > 0", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /skipped/, "flight detail mentions skipped scope for high-risk cancelled items");
});

test("server has GET /work-packages/:id/loop/summary route", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(server, /loop\/summary/, "summary route exists in server");
  assert.match(server, /recentPasses/, "summary response includes recentPasses");
});

// ── Goal Flight UX ───────────────────────────────────────────────────────────

test("console handles goal_quality profile label", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /goal_quality/, "console references goal_quality profile");
});

test("console renderFlightDetail shows Goal section when intake.goalFlight exists", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /goalFlight/, "console references goalFlight metadata from intake");
  assert.match(js, /successCriteria|success.criteria/i, "console shows success criteria for Goal Flights");
});

test("console Advance button is labeled as Repair / Nudge for Goal Flights", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /Repair.*Nudge|Nudge.*Repair/i, "console uses repair/nudge label for Goal Flight advance");
});

test("console flight list labels Goal Flights distinctly", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /Goal Flight|goal.flight.label|goal_flight/i, "console distinguishes Goal Flights in board/rail");
});

// ── advanceBlockerMsg ─────────────────────────────────────────────────────────

function extractAdvanceBlockerMsg(html: string): (bl: unknown) => string {
  const js = extractScript(html);
  const block = js.match(/\/\*__ADVANCE_BLOCKER_MSG_START__\*\/([\s\S]*?)\/\*__ADVANCE_BLOCKER_MSG_END__\*\//);
  assert.ok(block, "console script must define the advanceBlockerMsg block");
  const factory = new Function(`${block![1]}\nreturn advanceBlockerMsg;`) as () => (bl: unknown) => string;
  return factory();
}

test("advanceBlockerMsg: undefined blockers → Nothing eligible yet", () => {
  const fn = extractAdvanceBlockerMsg(CONSOLE_HTML);
  assert.equal(fn(undefined), "Nothing eligible yet");
});

test("advanceBlockerMsg: empty blocker summary → Nothing eligible yet", () => {
  const fn = extractAdvanceBlockerMsg(CONSOLE_HTML);
  assert.equal(fn({ review: [], held: [], dependency: [], activeWriter: [], noReadyItems: false }), "Nothing eligible yet");
});

test("advanceBlockerMsg: noReadyItems → mentions ready state", () => {
  const fn = extractAdvanceBlockerMsg(CONSOLE_HTML);
  const msg = fn({ review: [], held: [], dependency: [], activeWriter: [], noReadyItems: true });
  assert.match(msg, /ready/i, "should mention ready state");
});

test("advanceBlockerMsg: held items → shows count and held label", () => {
  const fn = extractAdvanceBlockerMsg(CONSOLE_HTML);
  const msg = fn({ review: [], held: ["a", "b"], dependency: [], activeWriter: [], noReadyItems: false });
  assert.ok(msg.includes("2"), "should mention count");
  assert.match(msg, /held/i, "should mention held");
});

test("advanceBlockerMsg: review items → shows awaiting review", () => {
  const fn = extractAdvanceBlockerMsg(CONSOLE_HTML);
  const msg = fn({ review: ["x"], held: [], dependency: [], activeWriter: [], noReadyItems: false });
  assert.match(msg, /review/i, "should mention review");
});

test("advanceBlockerMsg: dependency items → shows waiting on deps", () => {
  const fn = extractAdvanceBlockerMsg(CONSOLE_HTML);
  const msg = fn({ review: [], held: [], dependency: ["y"], activeWriter: [], noReadyItems: false });
  assert.match(msg, /dep/i, "should mention dependency");
});

test("advanceBlockerMsg: activeWriter items → shows blocked by active writer", () => {
  const fn = extractAdvanceBlockerMsg(CONSOLE_HTML);
  const msg = fn({ review: [], held: [], dependency: [], activeWriter: ["z"], noReadyItems: false });
  assert.match(msg, /writer|active/i, "should mention active writer");
});

test("advanceBlockerMsg: multiple categories → all listed in message", () => {
  const fn = extractAdvanceBlockerMsg(CONSOLE_HTML);
  const msg = fn({ review: ["r"], held: ["h"], dependency: [], activeWriter: [], noReadyItems: false });
  assert.match(msg, /held/i, "held present");
  assert.match(msg, /review/i, "review present");
});

// ── Flight detail observability ───────────────────────────────────────────────

test("flightPassRowHtml renders evidence state from pass.evidence.state", () => {
  const js = extractScript(CONSOLE_HTML);
  // evidence.state must appear in the meta line of a pass row.
  assert.match(js, /evidence.*state|state.*evidence/i, "flightPassRowHtml references evidence.state");
  assert.match(js, /evidenceState|evidence\.state/, "evidenceState label rendered in pass row");
});

test("flightPassRowHtml renders error block for failed passes", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /pass\.status.*failed.*pass\.error|pass\.error.*pass\.status.*failed/s,
    "flightPassRowHtml guards error rendering on failed status");
  assert.match(js, /errbox/, "flightPassRowHtml uses errbox class for pass errors");
});

test("renderFlightDetail item rows reference taskStatus", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /it\.taskStatus|taskStatus/, "item row renders taskStatus");
  assert.match(js, /taskStatus.*badge|badge.*taskStatus/, "taskStatus is wrapped in a badge");
});

test("renderFlightDetail shows completedAt for terminal flights", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /completedAt/, "renderFlightDetail references completedAt");
  assert.match(js, /completed\s+/, "completedAt rendered with 'completed' label");
});

test("renderFlightDetail uses inlined p.loop instead of a separate /loop GET", () => {
  const js = extractScript(CONSOLE_HTML);
  // The optimisation: use p.loop from the main response, not an extra api("/loop") GET.
  assert.match(js, /p\.loop/, "console uses p.loop from main response");
  // The old pattern was `const loopResp = await api("...\/loop"); const loop = loopResp.loop`.
  // After the change, renderFlightDetail should not call api() solely to obtain the loop object.
  assert.doesNotMatch(js, /loopResp\s*=\s*await\s+api\(/, "no separate loopResp await call");
});

test("GET /work-packages/:id response shape includes loop and recentPasses", async () => {
  // Guard the server source: the response must carry these fields.
  const { readFileSync } = await import("node:fs");
  const store = readFileSync(new URL("../lib/work-packages/store.ts", import.meta.url), "utf8");
  assert.match(store, /recentPasses/, "WorkPackageDetail declares recentPasses");
  assert.match(store, /failedCount/, "WorkPackageDetail declares failedCount");
  assert.match(store, /reviewCount/, "WorkPackageDetail declares reviewCount");
  assert.match(store, /loop.*FlightLoop|FlightLoop.*loop/, "WorkPackageDetail declares loop");
  assert.match(store, /taskStatus/, "WorkPackageItem declares taskStatus");
});

// ── Accept / Land operator action ────────────────────────────────────────────

test("flightItemActions shows Accept / Land button only for review items", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /Accept \/ Land/, "Accept / Land button text exists in flightItemActions");
  assert.match(js, /it\.status\s*===\s*['"]review['"]/, "Accept button is conditional on review status");
  assert.match(js, /wpAccept\(/, "wpAccept is called from item actions");
});

test("wpAccept posts to the /accept endpoint and refreshes the flight detail", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function wpAccept\(/, "wpAccept async function defined");
  assert.match(js, /\/accept/, "wpAccept posts to the /accept endpoint");
  assert.match(js, /renderFlightDetail\(pkgId/, "wpAccept refreshes the flight detail on success");
  assert.match(js, /Item accepted/, "wpAccept shows a confirmation toast on success");
});

test("server has POST /work-packages/:id/items/:itemId/accept route wired to acceptWorkPackageItem", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(server, /\/accept/, "accept route pattern exists in server");
  assert.match(server, /acceptWorkPackageItem/, "server imports and calls acceptWorkPackageItem");
});

// ── Goal summary section ──────────────────────────────────────────────────────

function extractFlightGoalSectionHtml(html: string): (intake: unknown) => string {
  const js = extractScript(html);
  const esc = js.match(/function esc\(s\)\{[^\n]+\}/);
  const block = js.match(/\/\*__FLIGHT_GOAL_SECTION_START__\*\/([\s\S]*?)\/\*__FLIGHT_GOAL_SECTION_END__\*\//);
  assert.ok(esc, "console must define esc");
  assert.ok(block, "console must contain sentinel-wrapped flightGoalSectionHtml");
  const factory = new Function(`${esc![0]}\n${block![1]}\nreturn flightGoalSectionHtml;`) as () => (intake: unknown) => string;
  return factory();
}

test("flightGoalSectionHtml: returns empty string when no intake", () => {
  const fn = extractFlightGoalSectionHtml(CONSOLE_HTML);
  assert.equal(fn(null), "");
  assert.equal(fn(undefined), "");
  assert.equal(fn({}), "");
});

test("flightGoalSectionHtml: renders .flight-goal-sec wrapper with Goal heading", () => {
  const fn = extractFlightGoalSectionHtml(CONSOLE_HTML);
  const html = fn({ goalFlight: { goal: "Build a marketing site", successCriteria: [] } });
  assert.match(html, /class="flight-goal-sec"/, "wrapper has .flight-goal-sec class");
  assert.match(html, /<h2>Goal<\/h2>/, "Goal h2 heading present");
  assert.match(html, /Build a marketing site/, "goal text rendered");
});

test("flightGoalSectionHtml: renders Success criteria list when criteria present", () => {
  const fn = extractFlightGoalSectionHtml(CONSOLE_HTML);
  const html = fn({ goalFlight: { goal: "Build a site", successCriteria: ["Pages load under 2s", "Passes Lighthouse audit"] } });
  assert.match(html, /<h3>Success criteria<\/h3>/, "Success criteria h3 heading");
  assert.match(html, /<ul>/, "criteria rendered as list");
  assert.match(html, /<li>Pages load under 2s<\/li>/, "first criterion rendered");
  assert.match(html, /<li>Passes Lighthouse audit<\/li>/, "second criterion rendered");
});

test("flightGoalSectionHtml: omits Success criteria section when list is empty", () => {
  const fn = extractFlightGoalSectionHtml(CONSOLE_HTML);
  const html = fn({ goalFlight: { goal: "Build a site", successCriteria: [] } });
  assert.doesNotMatch(html, /<h3>Success criteria<\/h3>/, "no criteria heading when list empty");
  assert.doesNotMatch(html, /<ul>/, "no list when no criteria");
});

test("flightGoalSectionHtml: escapes HTML in goal text and criteria", () => {
  const fn = extractFlightGoalSectionHtml(CONSOLE_HTML);
  const html = fn({ goalFlight: { goal: "<script>xss</script>", successCriteria: ["<b>bold</b>"] } });
  assert.doesNotMatch(html, /<script>/, "script tag escaped in goal");
  assert.match(html, /&lt;script&gt;/, "goal text HTML-escaped");
  assert.doesNotMatch(html, /<b>bold<\/b>/, "criteria HTML-escaped");
});

// ── computeNextWake / loop status ─────────────────────────────────────────────

function extractComputeNextWake(html: string): (loop: Record<string, unknown>, nowMs: number) => string {
  const js = extractScript(html);
  const block = js.match(/\/\*__FLIGHT_NEXT_WAKE_START__\*\/([\s\S]*?)\/\*__FLIGHT_NEXT_WAKE_END__\*\//);
  assert.ok(block, "console must contain sentinel-wrapped computeNextWake");
  const factory = new Function(`${block![1]}\nreturn computeNextWake;`) as () => (loop: Record<string, unknown>, nowMs: number) => string;
  return factory();
}

const NOW = Date.parse("2026-06-28T12:00:00Z");

test("computeNextWake: paused loop → 'paused'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  assert.equal(fn({ status: "paused", mode: "fixed", nextRunAt: null, stopReason: null }, NOW), "paused");
});

test("computeNextWake: stopped loop without reason → 'stopped'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  assert.equal(fn({ status: "stopped", mode: "fixed", nextRunAt: null, stopReason: null }, NOW), "stopped");
});

test("computeNextWake: stopped loop with reason → 'stopped · <reason>'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  assert.equal(fn({ status: "stopped", mode: "fixed", nextRunAt: null, stopReason: "max passes reached" }, NOW), "stopped · max passes reached");
});

test("computeNextWake: manual mode → 'on demand'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  assert.equal(fn({ status: "active", mode: "manual", nextRunAt: null, stopReason: null }, NOW), "on demand");
});

test("computeNextWake: self_paced with no nextRunAt → 'after next item'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  assert.equal(fn({ status: "active", mode: "self_paced", nextRunAt: null, stopReason: null }, NOW), "after next item");
});

test("computeNextWake: nextRunAt in past → 'imminent'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  const pastTime = new Date(NOW - 5000).toISOString();
  assert.equal(fn({ status: "active", mode: "fixed", nextRunAt: pastTime, stopReason: null }, NOW), "imminent");
});

test("computeNextWake: nextRunAt 30s away → 'in 30s'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  const soonTime = new Date(NOW + 30000).toISOString();
  assert.equal(fn({ status: "active", mode: "fixed", nextRunAt: soonTime, stopReason: null }, NOW), "in 30s");
});

test("computeNextWake: nextRunAt 3 min away → 'in 3m'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  const laterTime = new Date(NOW + 180000).toISOString();
  assert.equal(fn({ status: "active", mode: "fixed", nextRunAt: laterTime, stopReason: null }, NOW), "in 3m");
});

test("computeNextWake: no nextRunAt and not self_paced → '—'", () => {
  const fn = extractComputeNextWake(CONSOLE_HTML);
  assert.equal(fn({ status: "idle", mode: "fixed", nextRunAt: null, stopReason: null }, NOW), "—");
});

// ── Loop section metadata rendering ──────────────────────────────────────────

test("flightLoopSectionHtml renders mode label, profile label, pass counter, next wake", () => {
  const js = extractScript(CONSOLE_HTML);
  // Mode labels map
  assert.match(js, /self_paced.*Self-paced|Self-paced.*self_paced/, "self_paced → Self-paced label");
  assert.match(js, /goal_quality.*Goal quality|Goal quality.*goal_quality/, "goal_quality → Goal quality label");
  // Pass counter format
  assert.match(js, /passCount.*\+.*'.*of.*'.*\+.*maxPasses|passCount.*of.*maxPasses/, "pass counter uses N of M format");
  // Status badge with warn class for active/running
  assert.match(js, /status.*active.*warn|active.*running.*warn/, "active/running get warn badge class");
  // Status badge with err class for stopped
  assert.match(js, /stopped.*err|err.*stopped/, "stopped gets err badge class");
});

test("flightLoopSectionHtml renders next wake label from computeNextWake", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /next:.*nextWake|nextWake.*next:/, "next wake label renders with 'next:' prefix");
  assert.match(js, /computeNextWake\(/, "flightLoopSectionHtml calls computeNextWake");
});

// ── Advance button: repair/nudge for Goal Flights ────────────────────────────

function extractFlightAdvanceLabel(html: string): (intake: unknown) => string {
  const js = extractScript(html);
  const block = js.match(/\/\*__FLIGHT_ADVANCE_LABEL_START__\*\/([\s\S]*?)\/\*__FLIGHT_ADVANCE_LABEL_END__\*\//);
  assert.ok(block, "console must contain sentinel-wrapped flightAdvanceLabel");
  const factory = new Function(`${block![1]}\nreturn flightAdvanceLabel;`) as () => (intake: unknown) => string;
  return factory();
}

test("flightAdvanceLabel: Goal Flight → 'Repair / Nudge'", () => {
  const fn = extractFlightAdvanceLabel(CONSOLE_HTML);
  assert.equal(fn({ goalFlight: { goal: "Build a site" } }), "Repair / Nudge");
});

test("flightAdvanceLabel: checklist Flight (no goalFlight) → 'Advance'", () => {
  const fn = extractFlightAdvanceLabel(CONSOLE_HTML);
  assert.equal(fn({}), "Advance");
  assert.equal(fn(null), "Advance");
  assert.equal(fn(undefined), "Advance");
});

// ── Stuck-state detector UI ───────────────────────────────────────

test("stuckStateBannerHtml and wpReconcile are present in the console script", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function stuckStateBannerHtml\(/, "stuckStateBannerHtml function present");
  assert.match(js, /wpReconcile/, "wpReconcile function wired");
  assert.match(js, /\/reconcile/, "reconcile endpoint referenced");
  assert.match(js, /Reconcile Flight/, "Reconcile Flight CTA present");
  assert.match(js, /stuckState/, "stuckState read from flight detail response");
  assert.match(js, /stuck-banner/, "stuck-banner CSS class used");
  assert.match(CONSOLE_HTML, /\.stuck-banner\s*\{/, "stuck-banner CSS defined");
});

function extractStuckBannerFn(html: string) {
  const js = extractScript(html);
  const block = js.match(/\/\*__RECONCILE_START__\*\/([\s\S]*?)\/\*__RECONCILE_END__\*\//);
  assert.ok(block, "console must contain sentinel-wrapped wpReconcile");
  return block![1];
}

test("stuckStateBannerHtml: returns empty string for null stuckState", () => {
  const js = extractScript(CONSOLE_HTML);
  const fn = new Function("esc", `${js.match(/function stuckStateBannerHtml[\s\S]*?\n\}/)?.[0] ?? "throw new Error('not found')"}\nreturn stuckStateBannerHtml;`)(
    (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;"),
  ) as (pkgId: string, ss: unknown) => string;
  assert.equal(fn("pkg1", null), "");
  assert.equal(fn("pkg1", undefined), "");
});

test("stuckStateBannerHtml: renders reason, stuck items, canAutoRepair badge, and Reconcile button", () => {
  const js = extractScript(CONSOLE_HTML);
  const fn = new Function("esc", `${js.match(/function stuckStateBannerHtml[\s\S]*?\n\}/)?.[0] ?? "throw new Error('not found')"}\nreturn stuckStateBannerHtml;`)(
    (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;"),
  ) as (pkgId: string, ss: unknown) => string;

  const ss = {
    reason: "1 item appears active but its linked task is terminal — 1 dependent item cannot start",
    stuckItems: [{ itemTitle: "Step A", itemStatus: "running", taskId: "t1", taskStatus: "archived" }],
    readyDependentIds: ["item-b"],
    canAutoRepair: true,
    suggestedAction: "Reconcile Flight to land stuck items as done and start ready dependents",
  };

  const html = fn("pkg-x", ss);
  assert.match(html, /Flight stalled/, "reason prefix present");
  assert.match(html, /1 item appears active/, "reason text included");
  assert.match(html, /Step A/, "stuck item title present");
  assert.match(html, /running/, "stuck item status present");
  assert.match(html, /archived/, "stuck item taskStatus present");
  assert.match(html, /auto-repair/, "canAutoRepair badge present");
  assert.match(html, /Reconcile Flight/, "CTA button present");
  assert.match(html, /wpReconcile\('pkg-x'\)/, "CTA calls wpReconcile with pkgId");
});

test("stuckStateBannerHtml: canAutoRepair false shows 'operator review' badge", () => {
  const js = extractScript(CONSOLE_HTML);
  const fn = new Function("esc", `${js.match(/function stuckStateBannerHtml[\s\S]*?\n\}/)?.[0] ?? "throw new Error('not found')"}\nreturn stuckStateBannerHtml;`)(
    (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;"),
  ) as (pkgId: string, ss: unknown) => string;

  const ss = {
    reason: "1 item appears active but its linked task is terminal — 1 dependent item cannot start",
    stuckItems: [{ itemTitle: "Step A", itemStatus: "running", taskId: "t1", taskStatus: "failed" }],
    readyDependentIds: ["item-b"],
    canAutoRepair: false,
    suggestedAction: "Reconcile Flight to sync item states from their linked tasks, then review dependents",
  };

  const html = fn("pkg-y", ss);
  assert.match(html, /operator review/, "operator review badge shown when canAutoRepair is false");
  assert.doesNotMatch(html, /auto-repair/, "auto-repair badge absent when canAutoRepair is false");
});

test("translucency row syncs to wallpaper/theme state without reopening settings", () => {
  // Regression: after choosing a wallpaper the panel-translucency slider stayed
  // hidden until Settings was closed and reopened, because only openSettings()
  // toggled the row. The set/clear handlers now call syncWallpaperOpacityRow().
  const js = extractScript(CONSOLE_HTML);
  const src = js.match(/function syncWallpaperOpacityRow\(\)[\s\S]*?\n\}/)?.[0];
  assert.ok(src, "syncWallpaperOpacityRow must be defined");

  const factory = new Function("document", "models", `${src}\nreturn syncWallpaperOpacityRow;`) as (
    doc: unknown,
    models: unknown,
  ) => () => void;
  const run = (m: unknown) => {
    const els: Record<string, { style: { display?: string }; value: unknown; textContent: unknown }> = {};
    const doc = { getElementById: (id: string) => (els[id] ||= { style: {}, value: "", textContent: "" }) };
    factory(doc, m)();
    return els;
  };

  // Wallpaper present -> row revealed and slider reflects the saved opacity.
  let els = run({ hasWallpaper: true, theme: "light", wallpaperOpacity: 40 });
  assert.equal(els["wallpaper_opacity_row"].style.display, "", "row shown when a wallpaper is set");
  assert.equal(els["s_wp_opacity"].value, 40);
  assert.equal(els["s_wp_opacity_val"].textContent, "40%");

  // No wallpaper, ordinary theme -> row hidden.
  els = run({ hasWallpaper: false, theme: "light" });
  assert.equal(els["wallpaper_opacity_row"].style.display, "none", "row hidden with no wallpaper");

  // Matrix theme uses the same slider even without a wallpaper image.
  els = run({ hasWallpaper: false, theme: "matrix" });
  assert.equal(els["wallpaper_opacity_row"].style.display, "", "row shown for the Matrix theme");

  // Every handler that mutates wallpaper state must re-sync the row.
  for (const fn of ["onWallpaperFileSelected", "saveWallpaperPath", "clearWallpaper"]) {
    const start = js.search(new RegExp("(async\\s+)?function\\s+" + fn + "\\b"));
    assert.ok(start >= 0, fn + " must be defined");
    const after = js.slice(start + 1);
    const nextDecl = after.search(/\n(async\s+)?function\s+[A-Za-z]/);
    const region = nextDecl >= 0 ? after.slice(0, nextDecl) : after;
    assert.match(region, /syncWallpaperOpacityRow\(\)/, fn + " must re-sync the translucency row");
  }
});

// ── _computeReviewReasonJs — review reason for manual items ──────────────────

function extractComputeReviewReasonJs(
  html: string,
): (it: Record<string, unknown>, loop: Record<string, unknown> | null) => string | null {
  const js = extractScript(html);
  const block = js.match(/\/\*__REVIEW_REASON_START__\*\/([\s\S]*?)\/\*__REVIEW_REASON_END__\*\//);
  assert.ok(block, "console must contain sentinel-wrapped _computeReviewReasonJs");
  const factory = new Function(
    `${block![1]}\nreturn _computeReviewReasonJs;`,
  ) as () => (it: Record<string, unknown>, loop: Record<string, unknown> | null) => string | null;
  return factory();
}

test("_computeReviewReasonJs: needs_input → 'Agent is waiting for your input'", () => {
  const fn = extractComputeReviewReasonJs(CONSOLE_HTML);
  assert.equal(fn({ taskStatus: "needs_input", risk: "low", blocker: null }, null), "Agent is waiting for your input");
});

test("_computeReviewReasonJs: medium risk → 'Medium-risk change — operator sign-off required'", () => {
  const fn = extractComputeReviewReasonJs(CONSOLE_HTML);
  const result = fn({ taskStatus: "review", risk: "medium", blocker: null }, null);
  assert.match(result!, /Medium-risk change/);
  assert.match(result!, /operator sign-off required/);
});

test("_computeReviewReasonJs: high risk → 'High-risk change — operator sign-off required'", () => {
  const fn = extractComputeReviewReasonJs(CONSOLE_HTML);
  const result = fn({ taskStatus: "review", risk: "high", blocker: null }, null);
  assert.match(result!, /High-risk change/);
});

test("_computeReviewReasonJs: release loop → 'Release sign-off required'", () => {
  const fn = extractComputeReviewReasonJs(CONSOLE_HTML);
  const result = fn({ taskStatus: "review", risk: "low", blocker: null }, { profile: "release" });
  assert.equal(result, "Release sign-off required");
});

test("_computeReviewReasonJs: clean low-risk item no loop → null (no reason banner needed)", () => {
  const fn = extractComputeReviewReasonJs(CONSOLE_HTML);
  assert.equal(fn({ taskStatus: "review", risk: "low", blocker: null }, null), null);
});

test("flightItemActions: review-reason class and _computeReviewReasonJs wired into flightItemActions", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /review-reason/, "review-reason class used for reason banner");
  assert.match(js, /_computeReviewReasonJs\(it,\s*p\.loop\)/, "_computeReviewReasonJs called with item and package loop");
});

test("flightItemActions: Accept / Land button shown only for review-status items (done items excluded)", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /it\.status\s*===\s*['"]review['"]/, "Accept button gated on review status — done items never show it");
});

// ─── Wallpaper material shell tokens (2026-06-29) ────────────────────────────

test("material shell: base blur tokens defined", () => {
  assert.match(CONSOLE_HTML, /--mat-blur-chrome:\s*24px/);
  assert.match(CONSOLE_HTML, /--mat-blur-regular:\s*20px/);
  assert.match(CONSOLE_HTML, /--mat-blur-thick:\s*14px/);
  assert.match(CONSOLE_HTML, /--mat-blur-thin:\s*8px/);
});

test("material shell: backdrop-filter shorthands defined", () => {
  assert.match(CONSOLE_HTML, /--mat-chrome:\s*blur\(var\(--mat-blur-chrome\)\)/);
  assert.match(CONSOLE_HTML, /--mat-regular:\s*blur\(var\(--mat-blur-regular\)\)/);
});

test("material shell: header uses var(--mat-chrome)", () => {
  assert.match(CONSOLE_HTML, /header\s*\{[^}]*backdrop-filter:\s*var\(--mat-chrome\)/s);
});

test("material shell: .col uses var(--mat-regular)", () => {
  assert.match(CONSOLE_HTML, /\.col\s*\{[^}]*backdrop-filter:\s*var\(--mat-regular\)/s);
});

test("material shell: --panel references mat-tint-regular in all three themes", () => {
  const occurrences = (CONSOLE_HTML.match(/--panel:\s*var\(--mat-tint-regular\)/g) || []).length;
  assert.ok(occurrences >= 3, `expected --panel to reference --mat-tint-regular in all 3 themes, got ${occurrences}`);
});

test("material shell: wallpaper override uses --mat-wp-blur and --mat-wp-sat", () => {
  assert.match(CONSOLE_HTML, /blur\(var\(--mat-wp-blur\)\)\s+saturate\(var\(--mat-wp-sat\)\)/);
});

test("material shell: --mat-wp-opacity token present in :root", () => {
  assert.match(CONSOLE_HTML, /--mat-wp-opacity:/);
});

test("material shell: no-wallpaper tokens still present (regression guard)", () => {
  assert.match(CONSOLE_HTML, /--bg:/);
  assert.match(CONSOLE_HTML, /--text:/);
  assert.match(CONSOLE_HTML, /--accent:/);
  assert.match(CONSOLE_HTML, /--border:/);
});

// ─── Wallpaper material shell: panel uniformity ───────────────────────────────

test("material shell: .col.board uses background: var(--panel) (same token as right panel)", () => {
  assert.match(CONSOLE_HTML, /\.col\.board \{[^}]*background: var\(--panel\)/);
});

test("material shell: .col.context uses background: var(--panel) (same token as left panel)", () => {
  assert.match(CONSOLE_HTML, /\.col\.context \{[^}]*background: var\(--panel\)/);
});

test("material shell: .col.session uses background: var(--panel) (center shares material)", () => {
  assert.match(CONSOLE_HTML, /\.col\.session \{[^}]*background: var\(--panel\)/);
});

test("material shell: left and right panels share the same backdrop-filter via .col", () => {
  // Both .col.board and .col.context carry the .col class, so both inherit
  // the shared backdrop-filter: var(--mat-regular) rule — verified by checking
  // that the .col rule applies to both specific column selectors.
  assert.match(CONSOLE_HTML, /\.col\s*\{[^}]*backdrop-filter:\s*var\(--mat-regular\)/s);
  assert.match(CONSOLE_HTML, /\.col\.board/);
  assert.match(CONSOLE_HTML, /\.col\.context/);
});

test("material shell: side panel borders both use var(--border)", () => {
  assert.match(CONSOLE_HTML, /\.col\.board \{[^}]*var\(--border\)/);
  assert.match(CONSOLE_HTML, /\.col\.context \{[^}]*var\(--border\)/);
});

// ─── Wallpaper material shell: text readability ───────────────────────────────

test("material shell: wallpaper mode adds text-shadow to h2 section headings", () => {
  assert.match(CONSOLE_HTML, /html\[data-wallpaper="1"\] h2/);
  assert.match(CONSOLE_HTML, /html\[data-wallpaper="1"\] h2[^}]*\{[^}]*text-shadow/s);
});

test("material shell: wallpaper mode adds text-shadow to .lane-title", () => {
  assert.match(CONSOLE_HTML, /html\[data-wallpaper="1"\] \.lane-title/);
});

test("material shell: wallpaper mode adds text-shadow to .mdl-grp (model group labels)", () => {
  assert.match(CONSOLE_HTML, /html\[data-wallpaper="1"\] \.mdl-grp/);
});

test("material shell: wallpaper mode adds text-shadow to .ctx-sec summary (inspector section labels)", () => {
  assert.match(CONSOLE_HTML, /html\[data-wallpaper="1"\] \.ctx-sec > summary/);
});

test("material shell: wallpaper mode adds text-shadow to .dir-group-hdr (directive group headers)", () => {
  assert.match(CONSOLE_HTML, /html\[data-wallpaper="1"\] \.dir-group-hdr/);
});

test("material shell: wallpaper dark-mode heading shadow is black-tinted", () => {
  // rgba(0,0,0,…) shadow darkens text halos on bright/busy wallpaper.
  assert.match(CONSOLE_HTML, /html\[data-wallpaper="1"\] h2[^{]*\{[^}]*text-shadow:\s*0 1px 4px rgba\(0,0,0,\.55\)/s);
});

test("material shell: wallpaper light-mode heading shadow is white-tinted", () => {
  // Light theme inverts the halo so text lifts off bright backgrounds.
  assert.match(CONSOLE_HTML, /html\[data-theme="light"\]\[data-wallpaper="1"\] h2[^{]*\{[^}]*text-shadow:\s*0 1px 4px rgba\(255,255,255,\.80\)/s);
});

test("material shell: .text-on-material utility class defined with text-shadow", () => {
  assert.match(CONSOLE_HTML, /\.text-on-material \{[^}]*text-shadow/);
});

test("material shell: light theme .text-on-material uses white halo", () => {
  assert.match(CONSOLE_HTML, /html\[data-theme="light"\] \.text-on-material \{[^}]*text-shadow:\s*0 1px 4px rgba\(255,255,255/);
});

// ─── Wallpaper material shell: opacity contract ───────────────────────────────

test("material shell: tint alpha tokens drive panel overlay opacity (not background-image opacity)", () => {
  // The tint overlay (rgba + alpha) protects text contrast independently of the wallpaper image.
  // This means legibility doesn't depend on the image being dim — the tint layer guarantees it.
  assert.match(CONSOLE_HTML, /--mat-tint-alpha-regular:\s*0\.\d+/);
  assert.match(CONSOLE_HTML, /rgba\([^)]+var\(--mat-tint-alpha-regular\)\)/);
});

test("material shell: JS sets --mat-wp-opacity on the tint alpha, not on body opacity", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /setProperty\("--mat-wp-opacity"/);
  assert.doesNotMatch(js, /document\.body\.style\.opacity\s*=/, "body opacity must never be set");
});

test("material shell: --mat-wp-blur is set to 0px when opacity is zero (blur follows tint)", () => {
  // When the user zeros out translucency, blur is also removed — both track together.
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /--wp-blur.*0px|0px.*--wp-blur/s);
});

// ─── No-wallpaper mode regression: per-theme bg values unchanged ──────────────

test("material shell: dark mode --bg is still solid #0d1117 (no-wallpaper regression guard)", () => {
  assert.match(CONSOLE_HTML, /--bg: #0d1117/);
});

test("material shell: light theme --bg is still solid #f6f8fa (no-wallpaper regression guard)", () => {
  assert.match(CONSOLE_HTML, /html\[data-theme="light"\][^{]*\{[^}]*--bg: #f6f8fa/s);
});

test("material shell: at least 3 columns all use background: var(--panel) (no orphan surface)", () => {
  const count = (CONSOLE_HTML.match(/background: var\(--panel\)/g) || []).length;
  assert.ok(count >= 3, `expected at least 3 background:var(--panel) declarations, got ${count}`);
});

// ─── Morning Briefing retirement: settings UI source guards ───────────────────

test("console source has no Morning Briefing toggle", () => {
  const src = readFileSync(new URL("./console.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("Morning briefing"), "Morning Briefing settings toggle removed from UI source");
  assert.ok(!src.includes("toggleBriefing"), "toggleBriefing function removed from console source");
  assert.ok(!src.includes("sendTestBriefing"), "sendTestBriefing function removed from console source");
});

test("console source uses scheduled item copy instead of directive copy for deletes", () => {
  const src = readFileSync(new URL("./console.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("Delete this directive"), "'Delete this directive' string removed");
  assert.ok(src.includes("Delete this scheduled item"), "Uses 'Delete this scheduled item' copy");
});

test("Scheduled panel section header says 'Scheduled' not 'Directives'", () => {
  assert.match(CONSOLE_HTML, /<summary>Scheduled<\/summary>/, "panel <summary> says Scheduled");
  assert.doesNotMatch(CONSOLE_HTML, /<summary>Directives?<\/summary>/, "panel <summary> must not say Directive/Directives");
});

test("Scheduled add-item button uses 'New scheduled item' copy", () => {
  assert.match(CONSOLE_HTML, /New scheduled item/, "add button says 'New scheduled item'");
  assert.doesNotMatch(CONSOLE_HTML, /New directive/i, "add button must not say 'New directive'");
});

// ── OpenClaw Chat Dock console tests ─────────────────────────────────────────

test("openclaw.chatDock feature toggle is off by default", () => {
  // renderFeatures treats a feature as off when f.enabled !== true.
  // The incapable branch (capable === false) uses a disabled switch;
  // the normal off branch uses a clickable off switch.
  // Either way the switch must NOT appear as aria-checked="true" by default.
  const js = extractScript(CONSOLE_HTML);
  // renderFeatures reads enabled via `f.enabled === true`
  assert.match(js, /const on = f\.enabled === true/, "feature on state uses strict equality");
  // The incapable guard means no toggle if openclaw is absent
  assert.match(js, /const incapable = f\.capable === false/, "incapable guard checks capable flag");
  // When incapable, settingsSwitch gets disabled:true and produces aria-disabled
  assert.match(js, /settingsSwitch\(false, '', \{ disabled: true/, "disabled switch rendered for incapable features");
});

test("openclaw.chatDock toggle is greyed out when OpenClaw is not installed", () => {
  const js = extractScript(CONSOLE_HTML);
  // settingsSwitch(…, {disabled:true}) adds aria-disabled="true" and is-disabled class.
  assert.match(js, /aria-disabled="true"/, "disabled switch carries aria-disabled");
  assert.match(js, /is-disabled/, "disabled switch gets is-disabled CSS class");
  // The incapable path passes an empty onclick, preventing any toggle call.
  assert.match(js, /settingsSwitch\(false, '', \{ disabled: true, title: f\.reason \|\| 'not available' \}\)/, "incapable feature renders non-clickable switch");
});

test("openclaw.chatDock feature appears in the Settings features list", () => {
  // The feature definition in features.ts must include the openclaw.chatDock key
  // and a label that surfaces in the rendered features panel.
  const js = extractScript(CONSOLE_HTML);
  // renderFeatures maps over features and renders esc(f.label) — the feature
  // registry must contain this key for it to appear.
  assert.match(js, /async function renderFeatures\(/, "renderFeatures function exists");
  assert.match(CONSOLE_HTML, /OpenClaw Chat Dock/, "Features panel mentions OpenClaw Chat Dock label");
});

test("dock element structure is present in the console HTML", () => {
  assert.match(CONSOLE_HTML, /id="openclawDock"/, "openclawDock mount point present");
  assert.match(CONSOLE_HTML, /id="ocAvailDot"/, "availability dot element present");
  assert.match(CONSOLE_HTML, /id="ocTranscript"/, "transcript element present");
  assert.match(CONSOLE_HTML, /id="ocInput"/, "composer textarea present");
  assert.match(CONSOLE_HTML, /id="ocSendBtn"/, "Send button present");
  assert.match(CONSOLE_HTML, /id="ocTaskBtn"/, "Create-Task button present");
  assert.match(CONSOLE_HTML, /id="ocSessionSel"/, "session selector present");
  assert.match(CONSOLE_HTML, /id="ocCollapseArrow"/, "collapse arrow present");
});

test("dock defaults to collapsed with availability dot in off state", () => {
  // The dock starts collapsed and the dot is off until initOpenclawDock runs.
  assert.match(CONSOLE_HTML, /id="openclawDock" class="collapsed"/, "dock starts collapsed");
  assert.match(CONSOLE_HTML, /class="oc-avail-dot off" id="ocAvailDot"/, "availability dot starts off");
});

test("dock session selector offers both default sessions", () => {
  assert.match(CONSOLE_HTML, /value="agent:main:main"/, "default agent:main:main session present");
  assert.match(CONSOLE_HTML, /value="agent:main:hivematrix"/, "agent:main:hivematrix session present");
});

test("dock is absent (display:none) when the feature is disabled", () => {
  const js = extractScript(CONSOLE_HTML);
  // initOpenclawDock hides the dock when the status response reports enabled:false.
  assert.match(js, /if \(!enabled\) \{ dock\.style\.display = 'none'; return; \}/, "dock hidden when disabled");
});

test("dock becomes visible when feature is enabled and OpenClaw is available", () => {
  const js = extractScript(CONSOLE_HTML);
  // When enabled, display is cleared; when available, oc-unavail-state is removed.
  assert.match(js, /dock\.style\.display = '';/, "dock display cleared when enabled");
  assert.match(js, /dock\.classList\.remove\('oc-unavail-state'\)/, "unavail class removed when available");
  assert.match(js, /await ocRefresh\(\)/, "history fetched after dock becomes available");
});

test("unavailable state hides the composer and shows a warning panel", () => {
  const js = extractScript(CONSOLE_HTML);
  // When enabled but gateway is unreachable, the composer is hidden and a warn panel is shown.
  assert.match(js, /if \(comp\) comp\.style\.display = 'none'/, "composer hidden when unavailable");
  assert.match(js, /dock\.classList\.add\('oc-unavail-state'\)/, "unavail class set when not reachable");
  assert.match(js, /function ocWarnPanel\(reason\)/, "ocWarnPanel helper defined");
  assert.match(js, /oc-warn-panel/, "warn panel markup is produced");
  assert.match(js, /OpenClaw unavailable/, "unavailable title in warn panel");
});

test("unavailable state includes a Settings link in the warning panel", () => {
  const js = extractScript(CONSOLE_HTML);
  // The warn panel offers a Settings → Features link so the user can check status.
  assert.match(js, /openSettings\(\);switchSettingsTab\(\\'features\\'/, "warn panel links to Settings → Features");
  assert.match(js, /Settings → Features/, "warn panel button copy is 'Settings → Features'");
});

test("Send button is disabled for empty input", () => {
  const js = extractScript(CONSOLE_HTML);
  // ocInputResize disables the button when the textarea is empty.
  assert.match(js, /sendBtn\.disabled = !el\.value\.trim\(\)/, "send button disabled when input is empty");
  // The button starts disabled in HTML.
  assert.match(CONSOLE_HTML, /id="ocSendBtn"[^>]*disabled/, "Send button starts disabled in HTML");
});

test("Send button is disabled while a message is in-flight", () => {
  const js = extractScript(CONSOLE_HTML);
  // ocSend guards against concurrent sends via _ocState.sending.
  assert.match(js, /if \(!input \|\| !input\.value\.trim\(\) \|\| _ocState\.sending\) return/, "ocSend bails on empty or in-flight");
  assert.match(js, /_ocState\.sending = true/, "sending flag set before request");
  assert.match(js, /if \(sendBtn\) sendBtn\.disabled = true/, "send button explicitly disabled during flight");
  assert.match(js, /_ocState\.sending = false/, "sending flag cleared in finally block");
});

test("Send failure restores the draft message", () => {
  const js = extractScript(CONSOLE_HTML);
  // If the send API returns !r.ok or throws, the message is put back into the input.
  assert.match(js, /input\.value = msg; ocInputResize\(input\)/, "draft restored on send failure");
});

test("create-task calls the handoff endpoint with session key and text", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function ocCreateTask\(\)/, "ocCreateTask function defined");
  assert.match(js, /\/openclaw\/chat\/create-hivematrix-task/, "calls the create-hivematrix-task endpoint");
  assert.match(js, /sessionKey: _ocState\.session/, "includes the active session key");
  assert.match(js, /text/, "includes the message text in request body");
});

test("create-task prefers user-selected transcript text over last message", () => {
  const js = extractScript(CONSOLE_HTML);
  // The function first checks window.getSelection() inside the transcript element.
  assert.match(js, /window\.getSelection\(\)/, "reads window selection");
  assert.match(js, /transcript\.contains\(sel\.anchorNode\)/, "selection must be inside the transcript");
  assert.match(js, /sel\.toString\(\)\.trim\(\)/, "uses selection text when present");
  // Falls back to the last message in _ocState.messages.
  assert.match(js, /_ocState\.messages\[_ocState\.messages\.length - 1\]\.content/, "falls back to last message content");
});

test("create-task displays the returned HiveMatrix task ID in a toast", () => {
  const js = extractScript(CONSOLE_HTML);
  // On success, a toast shows "HiveMatrix task created — <taskId>".
  assert.match(js, /hmToast\('HiveMatrix task created'/, "success toast says 'HiveMatrix task created'");
  assert.match(js, /r\.taskId/, "task ID from response is used in the toast");
});

test("create-task shows an error toast on failure without crashing", () => {
  const js = extractScript(CONSOLE_HTML);
  // On API error or network failure, an error toast is shown.
  assert.match(js, /hmToast\([^)]*'Task creation failed\.', 'err'\)/, "error toast shown on create-task failure");
});

test("create-task re-enables its button in all paths via finally", () => {
  const js = extractScript(CONSOLE_HTML);
  // The create-task button is disabled before the call and re-enabled in finally.
  assert.match(js, /if \(btn\) btn\.disabled = true/, "task button disabled before request");
  assert.match(js, /finally \{ if \(btn\) btn\.disabled = false;/, "task button re-enabled in finally");
});

test("initOpenclawDock is called when the openclaw.chatDock flag is toggled", () => {
  const js = extractScript(CONSOLE_HTML);
  // toggleFeature dispatches to initOpenclawDock after saving the flag.
  assert.match(js, /if \(key === 'openclaw\.chatDock'\) initOpenclawDock\(\)/, "toggleFeature calls initOpenclawDock for chatDock key");
});

test("dock CSS is responsive and hidden on narrow screens", () => {
  // The dock is hidden via media query on narrow viewports (mobile).
  assert.match(CONSOLE_HTML, /@media \(max-width:760px\)[^{]*\{[^}]*#openclawDock[^}]*display:none !important/, "dock hidden on narrow screens");
  assert.match(CONSOLE_HTML, /#openclawDock\.collapsed[^{]*\{[^}]*height: 38px/, "collapsed dock is a fixed-height header strip");
});

test("runSelectedCommand sends both project and projectPath from the cmd multi-picker state", () => {
  // Regression guard: the command launcher must forward the operator's selected
  // project name alongside the path so that server-created tasks land under the
  // right project rather than always defaulting to "ops".
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "runSelectedCommand");

  // projectPath must come from the commandPath hidden input (registered to the
  // cmd multi-picker via mpRegister('cmd', 'commandPath')).
  assert.match(body, /commandPath/, "projectPath is read from the commandPath hidden input");
  assert.match(body, /projectPath/, "projectPath is included in the payload");

  // Project identity must come from _mpS('cmd'), the cmd-picker state — not
  // from _mpS('d') (the New Task picker) or any other source.
  assert.match(body, /_mpS\('cmd'\)/, "project name is sourced from the cmd multi-picker state");
  assert.doesNotMatch(body, /_mpS\('d'\)/, "project name does not bleed from the New Task picker");

  // The payload must conditionally include project when a name is present.
  assert.match(body, /payload\.project\s*=\s*project/, "project field is set on the payload when a project name is selected");

  // /commands/run is the target endpoint.
  assert.match(body, /\/commands\/run/, "payload is posted to /commands/run");
});

test("runSelectedCommand success message reports project mismatch when board filter differs from task project", () => {
  // Regression guard: after a successful command launch the operator must see
  // a clear message when the newly-created task lands in a project that is
  // different from the currently active board filter.  Without this guard the
  // board appears empty and the operator has no hint about where the task went.
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "runSelectedCommand");

  // The function must read the active board filter from state.selectedProject.
  assert.match(body, /state\.selectedProject/, "board filter is read from state.selectedProject");

  // It must also read the project from the returned task object.
  assert.match(body, /d\.task\.project/, "task project is read from the API response");

  // When the filter is set and differs from the task project the message must
  // mention the task project ("in <project>") so the operator knows where to look.
  assert.match(body, /in '\s*\+.*taskProject|'in '\s*\+\s*taskProject|in " \+ taskProject|"in " \+ taskProject|in\s+\'\s*\+\s*taskProject|in.*taskProject.*board filter|in.*taskProject/, "mismatch message includes the task project");

  // The mismatch message must also name the active board filter so the operator
  // can reconcile which view they are looking at.
  assert.match(body, /current board filter is\s*'\s*\+\s*boardFilter|current board filter is\s*"\s*\+\s*boardFilter|boardFilter.*current board filter|board filter.*boardFilter/, "mismatch message includes the board filter name");

  // When no board filter is active the plain "see the board" fallback is used.
  assert.match(body, /see the board/, "default success message remains available for the no-filter case");
});
