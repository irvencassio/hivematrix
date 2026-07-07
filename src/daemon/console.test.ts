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

function extractBetween(src: string, start: string, end: string): string {
  const startIx = src.indexOf(start);
  assert.notEqual(startIx, -1, `missing start marker: ${start}`);
  const endIx = src.indexOf(end, startIx + start.length);
  assert.notEqual(endIx, -1, `missing end marker: ${end}`);
  return src.slice(startIx, endIx);
}

function extractFunctionBlock(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = src.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `missing body for ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
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
  assert.match(html, /<pre class="mermaid">graph TD\n {2}A\[Start\] --&gt; B\[Done\]<\/pre>/);

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
  // Usage status is now shown via the usageStatusDot in the sidebar section header.
  assert.match(CONSOLE_HTML, /id="usageStatusDot"/, "usage status dot is present in the sidebar");
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

test("update indicator surfaces stale daemon restart state", () => {
  const js = extractScript(CONSOLE_HTML);
  const checkUpdate = js.match(/async function checkUpdate\(force\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(checkUpdate, /needsDaemonRestart/, "reads the stale-daemon status flag");
  assert.match(checkUpdate, /Finish update/, "shows an explicit finish-update action");
  assert.match(checkUpdate, /daemon restart needed|Restart the bundled daemon/, "explains daemon handoff problem");
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

test("settings tabs are in a defined order with Setup near the front", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /\["about", "setup", "features", "general", "models", "lanes", "remote", "license"\]/);
  assert.match(CONSOLE_HTML, /id="tab-about"[^>]*>About<\/div><div class="tab" id="tab-setup"[^>]*>Setup<\/div><div class="tab" id="tab-features"[^>]*>Features<\/div><div class="tab" id="tab-general"[^>]*>Personalization<\/div><div class="tab" id="tab-models"[^>]*>Models<\/div><div class="tab" id="tab-lanes"[^>]*>Lanes<\/div><div class="tab" id="tab-remote"[^>]*>Remote<\/div><div class="tab" id="tab-license"[^>]*>License<\/div>/);
  assert.doesNotMatch(CONSOLE_HTML, /id="tab-projects"/, "Projects is no longer a Settings tab");
  assert.doesNotMatch(CONSOLE_HTML, /id="tab-observability"/, "Observability now lives on the main screen, not Settings");
  assert.doesNotMatch(CONSOLE_HTML, /id="settingsObservability"/, "Settings Observability panel removed");
  assert.doesNotMatch(js, /tab === "observability"/, "Settings no longer routes to Observability");
});

test("Settings exposes Setup as a first-class actionable panel", () => {
  assert.match(CONSOLE_HTML, /id="tab-setup"/, "Setup tab present");
  assert.match(CONSOLE_HTML, /id="settingsSetup"/, "Setup panel present");
  assert.match(CONSOLE_HTML, /Open setup wizard/);
  assert.match(CONSOLE_HTML, /onclick="openObWizard\(\)"/, "Setup panel launches the existing wizard");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function renderSettingsSetup\(/, "Setup panel renderer exists");
  assert.match(js, /if \(tab === "setup"\) renderSettingsSetup\(\)/, "Setup tab refreshes its state");
  assert.match(js, /Settings → Setup/, "About summary points users to Settings Setup");
  assert.doesNotMatch(js, /see the Setup panel on the dashboard/, "About summary no longer points to the dashboard rail");
});

test("Settings Setup can open the Codex CLI setup guide", () => {
  const js = extractScript(CONSOLE_HTML);
  const wizardAction = extractBetween(js, "async function wizardAction(id)", "// ── Onboarding wizard");

  assert.match(wizardAction, /id === 'codex-cli'/, "Codex setup action is handled");
  assert.match(wizardAction, /openObWizard\(\)/, "Codex setup opens the setup wizard");
  assert.match(wizardAction, /_obStep = 1/, "Codex setup jumps to the model backend step");
  assert.match(wizardAction, /ob_codex_detail/, "Codex setup opens the Codex install guide");
});

test("Settings model controls are robust before and without model backends", () => {
  const js = extractScript(CONSOLE_HTML);
  const openSettings = extractBetween(js, "async function openSettings()", "function closeSettings()");
  const renderSettings = extractBetween(js, "function renderSettingsModelControls()", "function closeSettings()");
  const saveDefault = extractBetween(js, "async function saveDefault()", "async function saveFrontierProvider()");

  assert.match(openSettings, /if \(!models\)[\s\S]*await loadModels\(\)/, "opening Settings loads models when needed");
  assert.match(renderSettings, /\(no models configured\)/, "empty model list gets a clear option");
  assert.match(renderSettings, /sd\.disabled = !selectable\.length/, "default selector is disabled with no selectable model");
  assert.match(saveDefault, /if \(!modelId\)/, "saving a missing default model is guarded");
});

test("Settings frontier provider row handles Claude-only, Codex-only, and both", () => {
  const js = extractScript(CONSOLE_HTML);
  const renderSettings = extractBetween(js, "function renderSettingsModelControls()", "function closeSettings()");

  assert.match(renderSettings, /hasClaudeFrontier/);
  assert.match(renderSettings, /hasCodexFrontier/);
  assert.match(renderSettings, /hasAnyFrontier/);
  assert.match(renderSettings, /hasBothFrontier/);
  assert.match(renderSettings, /s_frontier_provider_row"\)\.style\.display = hasAnyFrontier \? "" : "none"/);
  assert.match(renderSettings, /frontierSelect\.disabled = !hasBothFrontier/);
  assert.match(renderSettings, /hasCodexFrontier && !hasClaudeFrontier \? "codex"/, "Codex-only state selects Codex");
  assert.match(renderSettings, /hasClaudeFrontier && !hasCodexFrontier \? "claude"/, "Claude-only state selects Claude");
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

test("app icon is a single fixed identity (no light/dark toggle)", () => {
  // The choice was removed — the icon is always the green-on-white hive mark.
  assert.doesNotMatch(CONSOLE_HTML, /id="s_app_icon"/);
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /saveAppIconChoice/);
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

test("onboarding wizard polls setup status instead of legacy onboarding details", () => {
  const js = extractScript(CONSOLE_HTML);
  const pollPerms = extractBetween(js, "async function _obPollPerms()", "// ── Step 1: model backends");
  const renderPerms = extractBetween(js, "function _obRenderSetupPerms(setup)", "async function obProbeFullDiskAccess()");

  assert.match(pollPerms, /api\('\/onboarding\/setup'\)/, "permission polling uses the setup status endpoint");
  assert.doesNotMatch(pollPerms, /api\('\/onboarding'\)/, "permission polling no longer derives state from legacy onboarding steps");
  assert.match(renderPerms, /fullDiskAccess/, "full disk access is read from setup permission items");
  assert.match(renderPerms, /desktopControl/, "desktop control is read from setup permission items");
  assert.match(renderPerms, /mailAutomation/, "mail automation is read from setup permission items");
  assert.match(renderPerms, /hm_ob_mic_opened/, "microphone remains a localStorage opened marker");
  assert.doesNotMatch(renderPerms, /chat\.db readable|Messages database readable|enabled; reading|enabled; watching|Mail controllable/, "setup marks do not use lane detail regexes");
});

test("onboarding wizard uses explicit permission probe and request routes", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(js, /\/onboarding\/setup\/full-disk-access\/probe/, "full disk access has an explicit probe");
  assert.match(js, /\/onboarding\/setup\/mail-automation\/probe/, "mail automation has an explicit probe");
  assert.match(js, /\/onboarding\/setup\/desktop-permissions\/request/, "desktop permission open path asks the helper to prompt/check");
  assert.match(CONSOLE_HTML, /onclick="obProbeFullDiskAccess\(\)"/, "Full Disk Access button checks the setup route");
  assert.match(CONSOLE_HTML, /onclick="obProbeMailAutomation\(\)"/, "Mail Automation button checks the setup route");
  assert.match(CONSOLE_HTML, /onclick="obRequestDesktopPerms\(\)"/, "Desktop Control button uses the setup request route");
});

test("onboarding wizard displays setup localModel status on the model card", () => {
  const js = extractScript(CONSOLE_HTML);
  const detectModels = extractBetween(js, "async function obDetectModels()", "function _obSetModelCard");

  assert.match(detectModels, /api\('\/onboarding\/setup'\)/, "model detection consults setup status");
  assert.match(detectModels, /localModel/, "local model card uses setup model id localModel");
  assert.match(detectModels, /localMod[^;]+detail/, "local model detail is displayed when available");
});

test("onboarding wizard exposes one-click local engine provisioning", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(CONSOLE_HTML, /id="ob_lm_provision"/, "first-run local model card has a provisioning button");
  assert.match(CONSOLE_HTML, /id="ob_lm_provision_log"/, "first-run local model card has provisioning status output");
  assert.match(js, /async function obProvisionLocalEngine\(/, "first-run provision action exists");
  assert.match(js, /\/local-engine\/provision/, "first-run provision action uses the shared provision endpoint");
});

test("onboarding wizard exposes persona birth ritual setup", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.match(CONSOLE_HTML, /id="ob_persona_status"/, "brain step has persona status");
  assert.match(CONSOLE_HTML, /id="ob_birth_ritual"/, "brain step has birth ritual action");
  assert.match(js, /function _obRenderPersonaSetup\(/, "persona setup renderer exists");
  assert.match(js, /async function obRunBirthRitual\(/, "birth ritual action exists");
  assert.match(js, /\/onboarding\/birth-ritual/, "birth ritual action uses existing endpoint");
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

test("Mixed-mode role-model defaults use version-agnostic Claude labels", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /Opus 4\.8/, "no pinned Opus version in role defaults");
  assert.doesNotMatch(js, /Sonnet 4\.6/, "no pinned Sonnet version in role defaults");
  assert.match(js, /"Default — Opus"/, "thinking default tracks the latest Opus");
  assert.match(js, /"Default — Sonnet"/, "coding default tracks the latest Sonnet");
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

test("observability by-provider table uses fmtNum for tok in/out (null Codex tokens render as —)", () => {
  const js = extractScript(CONSOLE_HTML);
  // Both renders (sidebar summary + full-dashboard modal) must pass inputTokens/outputTokens
  // through fmtNum so that null values (Codex with unavailable session-log tokens) show
  // "—" instead of the misleading "0 / 0". Count occurrences of the pattern.
  const matches = [...js.matchAll(/fmtNum\(p\.inputTokens\)[^;]+fmtNum\(p\.outputTokens\)/g)];
  assert.ok(matches.length >= 2, "both sidebar and dashboard table renders must use fmtNum for tok in/out");
});

test("Full dashboard opens dedicated Observability popup, not Settings", () => {
  const js = extractScript(CONSOLE_HTML);
  // openObsDashboard must open the dedicated overlay — not Settings.
  assert.doesNotMatch(js, /function openObsDashboard\(\)\s*\{[^}]*openSettings/, "openObsDashboard must not call openSettings");
  assert.match(js, /function openObsDashboard\(\)\s*\{[^}]*obsOverlay/, "openObsDashboard targets obsOverlay");
  // Dedicated popup, its container, and its dismiss handler.
  assert.match(CONSOLE_HTML, /id="obsOverlay"/, "obsOverlay element present");
  assert.match(CONSOLE_HTML, /id="obsDashModal"/, "obsDashModal container present");
  assert.match(js, /function closeObsDashboard\(/, "closeObsDashboard present");
});

test("remote access UI offers a Tailscale mesh and a named (durable) Cloudflare tunnel, not the throwaway temporary tunnel", () => {
  // Tailscale is the recommended private-mesh path; the named Cloudflare tunnel
  // remains for the Apple Watch / off-mesh devices. The throwaway trycloudflare
  // "temporary tunnel" was removed.
  assert.match(CONSOLE_HTML, /<span>Tailscale<\/span>/);
  assert.match(CONSOLE_HTML, /id="s_ts_url"/);
  assert.match(CONSOLE_HTML, /tailscale serve --bg 3747/);
  assert.match(CONSOLE_HTML, /Named tunnel/);
  assert.doesNotMatch(CONSOLE_HTML, /Temporary tunnel/, "the throwaway temporary tunnel UI must be gone");
  assert.doesNotMatch(CONSOLE_HTML, /trycloudflare/, "no trycloudflare quick-test tunnel");
  assert.doesNotMatch(CONSOLE_HTML, /Advanced: Named Cloudflare tunnel/, "named tunnel should not be hidden under an Advanced disclosure");
  assert.match(CONSOLE_HTML, /Cloudflare Access Client ID/);
  assert.match(CONSOLE_HTML, /Cloudflare Access Client Secret/);
  assert.match(CONSOLE_HTML, /\/tunnel\/configure-named/);
  assert.match(CONSOLE_HTML, /\/tunnel\/access-credentials/);
  // Remote setup lives on its own settings tab.
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

test("MessageBee setup exposes self handles separately from allowlisted senders", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="mb_self_handles"/);
  assert.match(CONSOLE_HTML, /id="mb_self_input"/);
  assert.match(CONSOLE_HTML, /Agent identities/);
  assert.match(js, /renderMessageBeeSelfHandles/);
  assert.match(js, /api\('\/messagebee\/self-handles'/);
});

test("MessageBee setup lets existing sender and self-handle chips be removed", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function mbJsArg\(/);
  assert.match(js, /function mbChip\(label, removeFn\)/);
  assert.match(js, /async function removeMessageBeeIdentity\(/);
  assert.match(js, /async function removeMessageBeeSelfHandle\(/);
  assert.ok(js.includes(`onclick="' + removeFn + '(\\'' + mbJsArg(label) + '\\')"`));
  assert.match(js, /mbChip\(h, 'removeMessageBeeSelfHandle'\)/);
  assert.match(js, /mbChip\(i\.address, 'removeMessageBeeIdentity'\)/);
  assert.match(js, /api\('\/messagebee\/identities'/);
  assert.match(js, /status:\s*'pending'/);
  assert.match(js, /api\('\/messagebee\/self-handles'/);
});

test("MessageBee setup lets ignored senders be permanently disallowed and later edited", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="mb_blocked"/);
  assert.match(js, /async function blockIgnored\(/);
  assert.match(js, /async function renderBlockedMessageBeeIdentities\(/);
  assert.match(js, /async function allowBlockedMessageBeeIdentity\(/);
  assert.match(js, /async function unblockMessageBeeIdentity\(/);
  assert.match(js, /blockIgnored\(/);
  assert.match(js, /status:\s*'blocked'/);
  assert.match(js, /status:\s*'allowed'/);
  assert.match(js, /status:\s*'pending'/);
  assert.match(js, /Disallowed senders/);
  assert.match(js, /renderBlockedMessageBeeIdentities\(ids/);
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
  assert.match(js, /function compatLabel\(/, "compatibility label helper present");
  assert.match(js, /function compatChips\(/, "compatibility chips helper present");
  assert.match(js, /Qwen\(local\)/, "Qwen local compatibility label present");
  assert.match(js, /ChatGPT/, "Codex compatibility is labeled as ChatGPT");
  assert.match(js, /compatSearchText\(it\)/, "compatibility participates in catalog search");
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
  assert.match(CONSOLE_HTML, /\.compat-chip \{[^}]*max-width:100%;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;/);
  assert.match(CONSOLE_HTML, /\.sk-row-right \{[^}]*max-width:48%;[^}]*overflow:hidden;/);
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /compatChips\(it\)/, "catalog rows render compatibility chips");
  assert.match(js, /compatChips\(\{ raw: s \}\)/, "library detail metadata renders compatibility chips");
  assert.match(js, /compatChips\(\{ raw: c \}\)/, "local command metadata renders compatibility chips");
});

test("skills compatibility helpers label, search, and render chips behaviorally", () => {
  const js = extractScript(CONSOLE_HTML);
  const esc = js.match(/function esc\(s\)\{[^\n]+\}/);
  assert.ok(esc, "console script must define esc");
  const factory = new Function([
    esc![0],
    extractFunctionBlock(js, "compatValues"),
    extractFunctionBlock(js, "compatLabel"),
    extractFunctionBlock(js, "compatSearchText"),
    extractFunctionBlock(js, "compatChips"),
    "return { compatLabel, compatSearchText, compatChips };",
  ].join("\n")) as () => {
    compatLabel: (value: string) => string;
    compatSearchText: (it: unknown) => string;
    compatChips: (it: unknown) => string;
  };
  const helpers = factory();
  assert.equal(helpers.compatLabel("codex"), "ChatGPT");
  assert.equal(helpers.compatLabel("qwen"), "Qwen(local)");
  assert.match(helpers.compatSearchText({ raw: { compat: ["codex"] } }), /codex ChatGPT/);
  const chips = helpers.compatChips({ raw: { compat: ["qwen"] } });
  assert.match(chips, /class="compat-chip"/);
  assert.match(chips, /Qwen\(local\)/);
});

test("header is grouped into zones with a theme toggle and grouped connectivity", () => {
  assert.match(CONSOLE_HTML, /class="hzone"/, "header uses zones");
  assert.match(CONSOLE_HTML, /class="hgroup"[\s\S]*id="modeSel"[\s\S]*id="modePill"/, "connectivity select + effective-mode pill grouped as one unit");
  assert.match(CONSOLE_HTML, /id="modeSel"[^>]*style="display:none"/, "manual connectivity override is hidden by default");
  assert.match(CONSOLE_HTML, /id="modePill"[^>]*onclick="toggleConnOverride\(\)"/, "clicking the pill reveals the override");
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

test("overview renders server-driven pack dashboard cards", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /packCards:\s*\[\]/, "state tracks pack dashboard cards");
  assert.match(js, /api\("\/packs\/dashboard-cards"\)/, "refresh fetches pack dashboard cards");
  assert.match(js, /function renderPackDashboardCards\(/, "generic pack card renderer exists");
  assert.match(js, /renderPackDashboardCards\(\)/, "overview includes pack cards");
  assert.match(js, /packMetricLabel/, "pack metrics render without pack-specific code");
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

test("review lane sorts tasks newest first, oldest last", () => {
  const js = extractScript(CONSOLE_HTML);
  // Verify the sort is applied only to the review lane and uses the best available timestamp.
  assert.match(js, /L\.key === "review"/, "sort is scoped to the review lane");
  assert.match(js, /reviewSortComparator/, "sort delegates to the named reviewSortComparator function");
  assert.match(js, /updatedAt.*createdAt|createdAt.*updatedAt/, "comparator falls back from updatedAt to createdAt");
  assert.match(js, /tb - ta/, "sort is descending (newest first)");
  // Verify the sort does not affect other lanes.
  const reviewSortBlock = js.match(/if \(L\.key === "review"\) \{([\s\S]*?)\}/);
  assert.ok(reviewSortBlock, "review sort block exists");
  const block = reviewSortBlock![1];
  assert.doesNotMatch(block, /in_progress|done|failed|queued/, "sort block is review-only");
});

function extractReviewSortComparator(html: string): (a: Record<string, string | undefined>, b: Record<string, string | undefined>) => number {
  const js = extractScript(html);
  const block = js.match(/\/\*__REVIEW_SORT_COMPARATOR_START__\*\/([\s\S]*?)\/\*__REVIEW_SORT_COMPARATOR_END__\*\//);
  assert.ok(block, "console must contain sentinel-wrapped reviewSortComparator");
  const factory = new Function(`${block![1]}\nreturn reviewSortComparator;`) as () => (a: Record<string, string | undefined>, b: Record<string, string | undefined>) => number;
  return factory();
}

test("reviewSortComparator: mixed timestamps — newest updatedAt sorts first", () => {
  const cmp = extractReviewSortComparator(CONSOLE_HTML);
  const tasks = [
    { _id: "oldest", createdAt: "2026-06-01T10:00:00Z" },
    { _id: "newest", updatedAt: "2026-06-30T10:00:00Z", createdAt: "2026-06-01T10:00:00Z" },
    { _id: "middle", createdAt: "2026-06-15T10:00:00Z" },
  ];
  const sorted = tasks.slice().sort(cmp);
  assert.equal(sorted[0]._id, "newest", "most recently updated task is first");
  assert.equal(sorted[1]._id, "middle", "middle-dated task is second");
  assert.equal(sorted[2]._id, "oldest", "oldest task is last");
});

test("reviewSortComparator: falls back to createdAt when updatedAt is absent", () => {
  const cmp = extractReviewSortComparator(CONSOLE_HTML);
  const tasks = [
    { _id: "old", createdAt: "2026-05-01T00:00:00Z" },
    { _id: "recent", createdAt: "2026-06-28T00:00:00Z" },
  ];
  const sorted = tasks.slice().sort(cmp);
  assert.equal(sorted[0]._id, "recent", "task with later createdAt sorts first when no updatedAt");
  assert.equal(sorted[1]._id, "old");
});

test("reviewSortComparator: updatedAt takes priority over a more recent createdAt", () => {
  const cmp = extractReviewSortComparator(CONSOLE_HTML);
  // taskA was created later but taskB was updated more recently — updatedAt wins.
  const taskA = { _id: "a", createdAt: "2026-06-20T00:00:00Z" };
  const taskB = { _id: "b", createdAt: "2026-06-10T00:00:00Z", updatedAt: "2026-06-29T00:00:00Z" };
  const sorted = [taskA, taskB].sort(cmp);
  assert.equal(sorted[0]._id, "b", "task with recent updatedAt sorts first even when created earlier");
  assert.equal(sorted[1]._id, "a");
});

test("reviewSortComparator: tasks with no timestamps sort below dated tasks", () => {
  const cmp = extractReviewSortComparator(CONSOLE_HTML);
  const tasks = [
    { _id: "no-dates" },
    { _id: "with-date", createdAt: "2026-06-15T00:00:00Z" },
  ];
  const sorted = tasks.slice().sort(cmp);
  assert.equal(sorted[0]._id, "with-date", "dated task floats above undated task");
  assert.equal(sorted[1]._id, "no-dates", "undated task sinks to bottom");
});

test("board task cards have stable width and height constraints across screen sizes", () => {
  // width: 100% + box-sizing: border-box prevent cards from overflowing or narrowing
  // inconsistently when the board column shrinks at medium/narrow viewports.
  assert.match(CONSOLE_HTML, /\.card\s*\{[^}]*width:\s*100%/, ".card fills its column width");
  assert.match(CONSOLE_HTML, /\.card\s*\{[^}]*box-sizing:\s*border-box/, ".card uses border-box so padding doesn't add to width");
  assert.match(CONSOLE_HTML, /\.card\s*\{[^}]*min-height/, ".card has a minimum height so short-content cards don't collapse");
  // Long task titles truncate instead of reflowing or pushing surrounding cards out of alignment.
  assert.match(CONSOLE_HTML, /\.card \.mdl-card-name\s*\{[^}]*text-overflow:\s*ellipsis/, ".card title truncates with ellipsis");
  assert.match(CONSOLE_HTML, /\.card \.mdl-card-name\s*\{[^}]*white-space:\s*nowrap/, ".card title stays on one line");
  assert.match(CONSOLE_HTML, /\.card \.mdl-card-name\s*\{[^}]*overflow:\s*hidden/, ".card title clips at boundary");
  // Responsive breakpoints narrow the board column at medium and small viewports.
  assert.match(CONSOLE_HTML, /@media \(min-width: 761px\) and \(max-width: 1080px\)/, "medium viewport narrows board rail");
  assert.match(CONSOLE_HTML, /@media \(max-width: 760px\)[\s\S]*grid-template-columns:\s*1fr/, "narrow viewport stacks to single column");
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

test("board column has Flash nav directly under New task", () => {
  assert.match(CONSOLE_HTML, /id="flashNav"/, "Flash nav control present");
  assert.match(CONSOLE_HTML, /id="flashNav"[^>]*onclick="showFlashPanel\(\)"/, "Flash nav opens center pane");
  const newTaskIdx = CONSOLE_HTML.indexOf("＋ New task");
  const flashIdx = CONSOLE_HTML.indexOf('id="flashNav"');
  const taskFormIdx = CONSOLE_HTML.indexOf('id="taskForm"');
  assert.ok(newTaskIdx >= 0 && flashIdx > newTaskIdx, "Flash sits below New task");
  assert.ok(taskFormIdx >= 0 && flashIdx < taskFormIdx, "Flash sits above the task form");
});

test("showFlashPanel renders Flash in the center column", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = js.match(/function showFlashPanel\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(body.length > 50, "showFlashPanel defined");
  assert.match(body, /state\.selected = null/, "clears selected task");
  assert.match(body, /renderFlashPanel\(\)/, "renders the center Flash panel");
  assert.match(body, /updateFlashNav\(\)/, "updates Flash nav state");
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
  assert.match(js, /optional preset/, "local engine card labels optional local model presets");
  assert.match(js, /Embeddings/, "embeddings group kept in Models");
  assert.match(js, /getElementById\("modelStatus"\)/, "checkModels still fills modelStatus");
});

test("Models panel renders the Rapid-MLX local engine", () => {
  const js = extractScript(CONSOLE_HTML);
  const checkModels = extractBetween(js, "async function checkModels()", "async function reindexEmbeddings()");

  assert.match(checkModels, /renderLocalEngine\(le, cap\)/, "local engine card renders");
  assert.doesNotMatch(checkModels, /renderLocalBackendChoice/, "no backend-specific local-model branch remains");
});

test("Settings Models renders local engine, health, and provisioning controls", () => {
  const js = extractScript(CONSOLE_HTML);
  const renderSettings = extractBetween(js, "function renderSettingsModelControls()", "function closeSettings()");

  assert.match(renderSettings, /renderLocalEngine\(m\.localEngine, m\.localEngineCapability\)/);
  assert.match(renderSettings, /renderLocalModelHealth\(m\.localModelHealth\)/);
  assert.match(renderSettings, /renderProvisionUI\(m\.localEngineCapability\)/);
  assert.doesNotMatch(renderSettings, /renderLocalBackendChoice/);
});

test("console generic local-model copy does not hardcode Qwen", () => {
  const genericQwenCopy = [
    "local Qwen",
    "Local Qwen",
    "Qwen (local)",
    "Default — local Qwen",
    "Local Model (LM Studio / Rapid-MLX)",
  ];
  for (const text of genericQwenCopy) {
    assert.doesNotMatch(CONSOLE_HTML, new RegExp(text.replace(/[()]/g, "\\$&")), `misleading copy remains: ${text}`);
  }
});

test("Settings Models includes configurable embedding model choices", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="s_embedding_model"/, "embedding model selector present");
  assert.match(CONSOLE_HTML, /Rapid-MLX Qwen3 Embedding 8B/, "Rapid-MLX Qwen preset is visible");
  assert.match(js, /function saveEmbeddingsSettings\(/, "embedding settings save handler present");
  assert.match(js, /applyEmbeddingChoice/, "embedding preset handler present");
});

test("usage section header has status dot, not a header pill", () => {
  // The old usagePill (⚡) in the header was removed; usage state is now shown
  // via the usageStatusDot coloured ● inside the Usage section summary.
  assert.doesNotMatch(CONSOLE_HTML, /id="usagePill"/, "header usage pill removed");
  assert.match(CONSOLE_HTML, /id="usageStatusDot"/, "usage status dot present in section summary");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function fmtResetsCompact\(/, "compact reset formatter present");
});

test("Usage UI introduces no dollar/cost copy", () => {
  const js = extractScript(CONSOLE_HTML);
  const checkUsage = js.match(/async function checkUsage\([\s\S]*?\n\}/)?.[0] ?? "";
  const card = js.match(/function usageProviderCard\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(checkUsage.length > 100 && card.length > 50, "usage function bodies extracted");
  assert.doesNotMatch(checkUsage + card, /\$\d|\bcost\b/i, "no dollar amounts or cost copy in the Usage UI");
});

type UsageBarClass = (util: number, resetsAt: string, durationMs: number) => "ok" | "warn" | "hi";

function consoleUsageBarClass(): UsageBarClass {
  const js = extractScript(CONSOLE_HTML);
  const body = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(body.length > 100, "usageBarClass body extracted");
  return new Function(body + "\nreturn usageBarClass;")() as UsageBarClass;
}

function withFrozenNow<T>(nowMs: number, run: () => T): T {
  const original = Date.now;
  Date.now = () => nowMs;
  try {
    return run();
  } finally {
    Date.now = original;
  }
}

function resetIn(nowMs: number, ms: number): string {
  return new Date(nowMs + ms).toISOString();
}

test("7-day usage bars are green on day 7 while sufficient daily budget remains", () => {
  const cls = consoleUsageBarClass();
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const daySevenReset = resetIn(now, (18 * 60 + 29) * 60 * 1000);
  withFrozenNow(now, () => {
    assert.equal(cls(69, daySevenReset, sevenDays), "ok");
    assert.equal(cls(85.7, daySevenReset, sevenDays), "ok");
    assert.equal(cls(86, daySevenReset, sevenDays), "hi");
  });
});

test("7-day usage bars turn red only after the current whole-day allowance is exceeded", () => {
  const cls = consoleUsageBarClass();
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const sevenDays = 7 * day;
  withFrozenNow(now, () => {
    const dayOneReset = resetIn(now, 6 * day + 5 * hour);
    assert.equal(cls(14, dayOneReset, sevenDays), "ok");
    assert.equal(cls(15, dayOneReset, sevenDays), "hi");

    const dayTwoReset = resetIn(now, 5 * day + 5 * hour);
    assert.equal(cls(28.6, dayTwoReset, sevenDays), "ok");
    assert.equal(cls(29, dayTwoReset, sevenDays), "hi");
  });
});

test("5-hour usage bars can still use the warning color", () => {
  const cls = consoleUsageBarClass();
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const fiveHours = 5 * 60 * 60 * 1000;
  withFrozenNow(now, () => {
    assert.equal(cls(65, resetIn(now, fiveHours / 2), fiveHours), "warn");
  });
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

test("settings includes a vault section for alias management without exposing values", () => {
  assert.match(CONSOLE_HTML, /id="vault_status"/, "vault status mount present");
  assert.match(CONSOLE_HTML, /id="s_vault_refs"/, "vault refs mount present");
  assert.match(CONSOLE_HTML, /id="s_vault_scope"/, "vault scope input present");
  assert.match(CONSOLE_HTML, /id="s_vault_name"/, "vault name input present");
  assert.match(CONSOLE_HTML, /id="s_vault_label"/, "vault label input present");
  assert.match(CONSOLE_HTML, /id="s_vault_value"/, "vault value input present");
  assert.match(CONSOLE_HTML, /id="s_vault_scope_filter"/, "vault scope filter present");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function renderVaultRefs\(/);
  assert.match(js, /function setVaultRef\(/);
  assert.match(js, /function removeVaultRef\(/);
  assert.match(js, /api\("\/vault\/refs"/, "uses vault list endpoint");
  assert.match(js, /["']\/vault\/refs\/["']\s*\+\s*encodeURIComponent\(scope\)\s*\+\s*["']\/["']\s*\+\s*encodeURIComponent\(name\)/, "remove uses encoded scope/name path");
  assert.match(js, /Scope, name, and value are required\./);
  const render = js.match(/async function renderVaultRefs\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(render.length > 50, "renderVaultRefs body extracted");
  assert.doesNotMatch(render, /entry\.value|value\)/, "list renderer does not print stored values");
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

test("material shell: wallpaper mode adds text-shadow to .status-card-name", () => {
  assert.match(CONSOLE_HTML, /html\[data-wallpaper="1"\] \.status-card-name/);
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
  assert.match(js, /--mat-wp-blur.*0px|0px.*--mat-wp-blur/s);
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

// ── Flash center-pane console tests ────────────────────────────────────

test("Flash center pane uses panel IDs and a large composer target", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /id="flashTranscript"/, "center panel transcript has a unique id");
  assert.match(js, /id="flashInput"/, "center panel textarea has a unique id");
  assert.match(js, /id="flashSendBtn"/, "center panel send button has a unique id");
  assert.match(CONSOLE_HTML, /\.oc-panel-composer-shell[^}]*min-height:\s*96px/, "center composer has a large click target");
  assert.match(js, /onclick="flashFocusInput\(\)"/, "composer shell focuses the textarea");
});

test("Flash center pane reserves bottom composer space while transcript scrolls", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /\.col\.session\.oc-session-mode[^}]*overflow:\s*hidden/, "Flash mode keeps the center column from page-scrolling past the composer");
  assert.match(js, /session\.parentElement\.classList\.toggle\("oc-session-mode", !!open\)/, "Flash mode is applied to the outer center column");
  assert.match(CONSOLE_HTML, /\.oc-center-pane[^}]*calc\(100vh - 68px\)/, "Flash workspace is bounded to the visible center column height");
  assert.match(CONSOLE_HTML, /\.oc-panel-body[^}]*min-height:\s*0/, "panel body can shrink inside the bounded center column");
  assert.match(CONSOLE_HTML, /\.oc-transcript[^}]*overflow-y:\s*auto/, "only the transcript scrolls");
  assert.match(CONSOLE_HTML, /\.oc-panel-composer-shell[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+88px/, "composer reserves a full-width input column and fixed action column");
  assert.match(CONSOLE_HTML, /\.oc-input[^}]*width:\s*100%/, "textarea fills the composer input column");
  assert.match(CONSOLE_HTML, /\.oc-input[^}]*min-width:\s*0/, "textarea can fit the grid without collapsing into vertical text");
});

test("Flash send posts to /flash/turn and streams SSE events", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function flashSend\(\)/, "flashSend function defined");
  assert.match(js, /fetch\('\/flash\/turn'/, "Flash posts turns to /flash/turn");
  assert.match(js, /evt === 'token'/, "token events are handled");
  assert.match(js, /evt === 'tool_start'/, "tool_start events are handled");
  assert.match(js, /evt === 'tool_result'/, "tool_result events are handled");
  assert.match(js, /evt === 'done'/, "done events are handled");
});

test("Flash send button is disabled for empty input and while in-flight", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /id="flashSendBtn"[^']*disabled/, "Send button starts disabled in the center panel");
  assert.match(js, /if \(!input \|\| !input\.value\.trim\(\) \|\| _flashState\.sending\) return/, "flashSend bails on empty or in-flight");
  assert.match(js, /_flashState\.sending = true/, "sending flag set before request");
  assert.match(js, /_flashState\.sending = false/, "sending flag cleared in finally block");
});

test("Flash feedback records bad turns", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function flashThumbsDown\(turnId\)/, "bad-turn feedback function exists");
  assert.match(js, /\/flash\/turns\/' \+ encodeURIComponent\(turnId\) \+ '\/feedback'/, "feedback endpoint is called with encoded turn id");
  assert.match(js, /rating: 'bad'/, "feedback payload marks the turn bad");
});

test("primary left nav uses a single active color convention", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="newTaskNav"/, "New task has a tracked nav id");
  assert.match(CONSOLE_HTML, /\.addbtn \{[^}]*color:\s*var\(--text\)/, "New task is neutral when inactive");
  assert.match(CONSOLE_HTML, /\.addbtn\.active[^}]*color:\s*var\(--accent\)/, "New task uses accent only when active");
  assert.match(js, /overviewActive = .* !_taskFormInSession/, "Overview is not active while New task is open");
  assert.match(js, /newTaskNav.*classList\.toggle\("active", _taskFormInSession\)/s, "New task active state follows the center form");
  assert.match(js, /flashNav.*classList\.toggle\('active', _flashState\.panelOpen\)/s, "Flash active state follows the center panel");
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
  assert.match(body, /in '\s*\+.*taskProject|'in '\s*\+\s*taskProject|in " \+ taskProject|"in " \+ taskProject|in\s+'\s*\+\s*taskProject|in.*taskProject.*board filter|in.*taskProject/, "mismatch message includes the task project");

  // The mismatch message must also name the active board filter so the operator
  // can reconcile which view they are looking at.
  assert.match(body, /current board filter is\s*'\s*\+\s*boardFilter|current board filter is\s*"\s*\+\s*boardFilter|boardFilter.*current board filter|board filter.*boardFilter/, "mismatch message includes the board filter name");

  // When no board filter is active the plain "see the board" fallback is used.
  assert.match(body, /see the board/, "default success message remains available for the no-filter case");
});

test("provisionLocalEngine surfaces a failed provision request and re-enables the button", async () => {
  const js = extractScript(CONSOLE_HTML);
  const src = fnBody(js, "provisionLocalEngine");

  const btn = { disabled: false };
  const log = { innerHTML: "" };
  const doc = { getElementById: (id: string) => (id === "provisionBtn" ? btn : id === "provisionLog" ? log : null) };
  let polled = 0;

  const run = new Function("document", "api", "pollProvision", `${src}; return provisionLocalEngine();`) as
    (document: unknown, api: unknown, pollProvision: unknown) => Promise<void>;
  await run(doc, async () => { throw new Error("daemon down"); }, () => { polled += 1; });

  assert.equal(btn.disabled, false, "button must be re-enabled after a failed provision request");
  assert.match(log.innerHTML, /failed/i, "the failure must be shown in the provision log");
  assert.equal(polled, 0, "status polling must not start after a failed provision request");
});

test("talk audio playback handles the async play() rejection (sync try/catch cannot see it)", () => {
  const js = extractScript(CONSOLE_HTML);
  // Audio.play() returns a promise; autoplay blocking rejects it AFTER the
  // sync try/catch has exited, so the rejection must be handled with .catch().
  assert.match(js, /\.play\(\)\.catch\(/, "Audio playback must attach a .catch to the play() promise");
});

test("command options picker: panels render options and Run assembles from picks", () => {
  const js = extractScript(CONSOLE_HTML);
  // Both command panels render the structured options block from c.options.
  const panels = js.match(/_cmdOptionsHtml\(c\.options\)/g) || [];
  assert.ok(panels.length >= 2, "both command renderers call _cmdOptionsHtml(c.options)");
  // The picker helpers exist and Run assembles the arg string from the picks.
  assert.match(js, /function _cmdOptionsHtml\(/);
  assert.match(js, /function _assembleCmdArgs\(/);
  assert.match(js, /function _optPick\(/, "pick-one groups are supported");
  assert.match(js, /const args = _assembleCmdArgs\(\);/, "runSelectedCommand assembles from the picker");
  // Raw box overrides the picks (backward compatible with /commands/run).
  assert.match(js, /if \(raw\) return raw;/);
});
