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

test("window title does not redundantly repeat the in-page HiveMatrix logo", () => {
  assert.doesNotMatch(
    CONSOLE_HTML,
    /<title>HiveMatrix<\/title>/,
    "tab title should not literally duplicate the page header's HiveMatrix logo",
  );
  assert.match(CONSOLE_HTML, /<title>Console<\/title>/);
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
  assert.match(CONSOLE_HTML, /id="t_project_rescan"[^>]*onclick="refreshProjects\(\)"/, "empty dropdown rescan button present");
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function refreshProjects\(\)[\s\S]*loadProjects\(true\)/, "refresh bypasses the project cache");
});

test("header project-filter dropdown is removed", () => {
  // The top nav's "(all projects)" board-filter dropdown was removed — see
  // docs/superpowers/specs/2026-07-15-console-header-cleanup-design.md item 2.
  assert.doesNotMatch(CONSOLE_HTML, /id="projectSel"/, "project-filter select is gone from the header");
  assert.doesNotMatch(CONSOLE_HTML, /\(all projects\)/, "the '(all projects)' option text is gone");
  // Regression guard for the top-level-addEventListener-on-a-missing-element
  // crash risk called out in the design doc: the script must still parse.
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotThrow(() => new Function(js), SyntaxError, "console script still parses as valid JS");
});

test("app icon is a single fixed identity (no light/dark toggle)", () => {
  // The choice was removed — the icon is always the green-on-white hive mark.
  assert.doesNotMatch(CONSOLE_HTML, /id="s_app_icon"/);
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /saveAppIconChoice/);
});

test("voice input is the composer dictation mic (Talk button removed), gated by the voice flag", () => {
  // The old header "Talk" push-to-talk button was removed; the only desktop
  // voice input is the dictation mic in the chat composer (above Send), and it
  // is still gated by the voice feature flag.
  assert.doesNotMatch(CONSOLE_HTML, /id="talkBtn"/, "header Talk button removed");
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /function toggleTalk\(/, "toggleTalk removed");
  assert.match(CONSOLE_HTML, /id="flashMicBtn"/, "composer dictation mic present");
  assert.match(js, /async function initVoiceFeature\(/);
  assert.match(js, /f\.key === "voice" && f\.enabled/, "shown only when the voice flag is on");
  assert.match(js, /async function flashDictate\(/, "composer dictation handler present");
  assert.match(js, /\/voice\/transcribe/, "dictation posts audio to the transcribe route");
  assert.match(js, /MediaRecorder/, "captures the mic");
});

test("onboarding wizard polls setup status instead of legacy onboarding details", () => {
  const js = extractScript(CONSOLE_HTML);
  const pollPerms = extractBetween(js, "async function _obPollPerms()", "// ── Step 1: model backends");
  const renderPerms = extractBetween(js, "function _obRenderSetupPerms(setup)", "async function obProbeFullDiskAccess()");

  assert.match(pollPerms, /\/onboarding\/setup\/full-disk-access\/probe/, "permission polling forces the FDA probe (silent gate) so already-granted access isn't shown as unchecked");
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

test("onboarding wizard detects frontier CLI backends only — no local model card (Claude-native cutover Phase 5)", () => {
  const js = extractScript(CONSOLE_HTML);
  const detectModels = extractBetween(js, "async function obDetectModels()", "function _obSetModelCard");

  assert.match(detectModels, /api\('\/providers'\)/, "model detection consults the providers endpoint");
  assert.doesNotMatch(detectModels, /localModel/, "no local model card wiring remains");
  assert.doesNotMatch(js, /async function obSetupLocalModel\(/, "manual local-model connect flow removed");
  assert.doesNotMatch(js, /async function obSetCloudOnly\(/, "cloud-only local-model flow removed");
});

test("onboarding wizard no longer offers local-model provisioning at all (Claude-native cutover Phase 5)", () => {
  const js = extractScript(CONSOLE_HTML);

  assert.doesNotMatch(CONSOLE_HTML, /id="ob_lm_provision"/, "provisioning button removed");
  assert.doesNotMatch(CONSOLE_HTML, /id="ob_lm_provision_log"/, "provisioning status output removed");
  assert.doesNotMatch(CONSOLE_HTML, /id="ob_model_lmstudio"/, "local model card removed");
  assert.doesNotMatch(js, /async function obProvisionLocalEngine\(/, "provision action removed");
  assert.doesNotMatch(js, /\/local-engine\/provision/, "no client code calls the removed provision endpoint");
  assert.doesNotMatch(js, /\/onboarding\/local-model/, "no client code calls the removed onboarding local-model endpoint");
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
  for (const id of ["connSec", "dirSec", "skillsSec", "mcpSec"]) {
    assert.match(CONSOLE_HTML, new RegExp('<details class="ctx-sec" id="' + id + '"'), id + " is a collapsible section");
  }
  // Actionable sections default open; info-heavy ones default collapsed.
  assert.match(CONSOLE_HTML, /id="connSec" open/);
  assert.match(CONSOLE_HTML, /id="skillsSec" open/);
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function wireCtxSections\(/);
  assert.match(js, /hm_sec_/, "per-section open state persisted");
  assert.match(js, /wireCtxSections\(\);/, "wired on init");
});

test("task session view still renders the per-task telemetry strip (unrelated to the Observability dashboard/modal)", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function taskTelemetryStrip\(/);
  assert.match(js, /taskTelemetryStrip\(t, out\)/, "still wired into the task session view");
  // The strip honors unavailable-not-zero for Codex. This assertion used to live in
  // the deleted mini-widget test, but the pattern was never actually inside
  // renderObservability — verified empirically (grep across the whole script) it
  // only ever appears inside taskTelemetryStrip itself, so its real coverage home
  // is here, not a "point it at renderObsDashboard" fallback.
  assert.match(js, /prov === "Codex" && !inTok && !outTok/);
});

test("observability by-provider table uses fmtNum for tok in/out (null Codex tokens render as —)", () => {
  const js = extractScript(CONSOLE_HTML);
  // The dashboard/modal table must pass inputTokens/outputTokens through fmtNum so
  // that null values (Codex with unavailable session-log tokens) show "—" instead of
  // the misleading "0 / 0". The sidebar mini-widget's own copy of this render was
  // removed along with renderObservability(), so only the dashboard/modal table
  // remains — verified by running this test after that deletion (count dropped
  // from 2 to 1, confirmed empirically rather than assumed).
  const matches = [...js.matchAll(/fmtNum\(p\.inputTokens\)[^;]+fmtNum\(p\.outputTokens\)/g)];
  assert.ok(matches.length >= 1, "the dashboard/modal table must use fmtNum for tok in/out");
});

test("observability model label maps Claude ids to their tier (Opus/Sonnet/Haiku) and strips the internal codex: prefix", () => {
  const js = extractScript(CONSOLE_HTML);
  const fnTier = js.match(/function obsModelTier\(model\) \{[\s\S]*?\n\}/);
  const fnLabel = js.match(/function obsModelLabel\(model\) \{[\s\S]*?\n\}/);
  assert.ok(fnTier, "console script must define obsModelTier");
  assert.ok(fnLabel, "console script must define obsModelLabel");
  const factory = new Function(`${fnTier![0]}\n${fnLabel![0]}\nreturn obsModelLabel;`) as () => (model: string) => string;
  const obsModelLabel = factory();
  assert.equal(obsModelLabel("codex:gpt-5.5"), "gpt-5.5", "codex: is execution-only, stripped for display");
  assert.equal(obsModelLabel("claude-opus-4-8[1m]"), "Opus (1M ctx)", "[1m] expands to a readable suffix on the tier name, not merged into the plain-Opus row");
  assert.equal(obsModelLabel("claude-opus-4-8"), "Opus", "a resolved Claude id collapses to its tier name");
  assert.equal(obsModelLabel("opus"), "Opus", "the bare CLI alias also maps to its tier name");
  assert.equal(obsModelLabel("claude-sonnet-5"), "Sonnet");
  assert.equal(obsModelLabel("claude-haiku-4-5-20251001"), "Haiku");
  assert.equal(obsModelLabel("qwen3.6-35b-4bit"), "qwen3.6-35b-4bit", "unclassified (e.g. historical local) ids pass through unchanged");
});

test("dashboard offers a provider/model group-by toggle for the breakdown table", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /id="obs_group_panel"/, "group toggle present in the center panel");
  assert.match(js, /onclick="setObsGroupPanel\(\\?'provider\\?'\)"/);
  assert.match(js, /onclick="setObsGroupPanel\(\\?'model\\?'\)"/);
  assert.match(js, /function setObsGroupPanel\(g\) \{ _obsGroup = g;/);
  const renderObsDashboard = extractBetween(js, "async function renderObsDashboard(target)", "function renderConn()");
  assert.match(renderObsDashboard, /const groupByModel = _obsGroup === "model"/);
  assert.match(renderObsDashboard, /detail\.totals\.byModel/, "model mode reads the same totals payload — no second query");
  // by-model draws grouped side-by-side bars so usage is comparable at a glance.
  assert.match(js, /function obsGroupedBars\(/, "grouped bars for the by-model view");
});

test("Observability modal: overlay markup, reuses dashboard rendering, click-outside + button close", () => {
  const html = CONSOLE_HTML;
  assert.match(html, /<div class="overlay" id="obsOverlay"/, "modal overlay exists");
  assert.match(html, /id="obsOverlay"[^>]*onclick="if\(event\.target===this\)closeObsModal\(\)"/, "backdrop click closes");
  assert.match(html, /<span class="x" onclick="closeObsModal\(\)">✕<\/span>/, "explicit close button");
  // The modal must reuse the existing dashboard renderer/target id, not a new one.
  assert.match(html, /id="obsDashPanel"/, "reuses the existing dashboard mount point");
  const js = extractScript(html);
  assert.match(js, /function openObsModal\(\)/);
  assert.match(js, /function closeObsModal\(\)/);
  const openObsModal = fnBody(js, "openObsModal");
  assert.match(openObsModal, /getElementById\('obsOverlay'\)\.classList\.add\('open'\)/);
  assert.match(openObsModal, /obsPanelToggles\(\)/, "reuses the existing toggle-row builder, not a new one");
  assert.match(openObsModal, /renderObsDashboard\('obsDashPanel'\)/, "reuses the existing dashboard renderer, not a new one");
  const closeObsModal = fnBody(js, "closeObsModal");
  assert.match(closeObsModal, /getElementById\('obsOverlay'\)\.classList\.remove\('open'\)/);
});

test("Observability modal opens from the progress-bar visual, not the whole 5h/7d toggle button", () => {
  const js = extractScript(CONSOLE_HTML);
  // Both bar wraps must carry a click trigger that stops propagation before it can
  // reach the button's own onclick (setHeaderUsageWindow) — clicking the bar opens
  // the modal *instead of* toggling the window; clicking the "5h"/"7d" text still
  // toggles the window exactly as before this change.
  const bar5h = extractBetween(CONSOLE_HTML, 'id="usageBtn5h"', '</button>');
  const bar7d = extractBetween(CONSOLE_HTML, 'id="usageBtn7d"', '</button>');
  for (const bar of [bar5h, bar7d]) {
    assert.match(bar, /usage-bar-wrap[^>]*onclick="event\.stopPropagation\(\);openObsModal\(\)"/, "bar span opens the modal and stops propagation");
  }
  // Regression guard: the pre-existing window-toggle handler on the outer button
  // must still be exactly what it was before this change.
  assert.match(CONSOLE_HTML, /onclick="setHeaderUsageWindow\('5h'\)"/);
  assert.match(CONSOLE_HTML, /onclick="setHeaderUsageWindow\('7d'\)"/);
});

test("center-panel Observability takeover is fully removed — the modal replaced it, no orphaned code", () => {
  const js = extractScript(CONSOLE_HTML);
  for (const name of ["showObs", "renderObsPanel", "openObsDashboard", "updateObsNav"]) {
    assert.doesNotMatch(js, new RegExp("function " + name + "\\("), name + " should be deleted, not left dead");
  }
  assert.doesNotMatch(js, /_obsState/, "the center-panel panelOpen flag is gone from every sibling panel function too");
});

test("PROVIDERS section shows installed/not-set-up status with an Install affordance, no on/off toggle", () => {
  assert.doesNotMatch(CONSOLE_HTML, /Turn a provider on or off within HiveMatrix/, "the on/off explainer copy is gone");
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /function toggleProvider\(/, "the enable/disable toggle handler is removed");
  assert.doesNotMatch(js, /providers\/[^"']*\/enabled/, "the console no longer POSTs providers/:id/enabled");
  const renderProviderStatus = fnBody(js, "renderProviderStatus");
  assert.match(renderProviderStatus, /runProviderSetup/, "install/sign-in reuses the existing setup flow");
  assert.doesNotMatch(renderProviderStatus, /settingsSwitch/, "no switch control in the provider status cards");
  assert.match(renderProviderStatus, /mdl-card/, "styled like the Backends cards, not a separate toggle-row list");
});

test("dashboard offers a 1h window with 5-minute bucket ticks", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /const wins = \["1h",/, "1h window offered in the center panel toggles");
  assert.match(js, /setObsWindowPanel\(/, "window buttons wire to setObsWindowPanel");
  const obsBucketLabel = extractFunctionBlock(js, "obsBucketLabel");
  assert.match(obsBucketLabel, /if \(unit === "minute"\) return \(t \|\| ""\)\.slice\(11, 16\)/, "minute-unit ticks render HH:MM, not the date");
});

test("prompt cache section shows the Claude 5m/1h write split and a token-based net benefit, never a dollar figure", () => {
  const js = extractScript(CONSOLE_HTML);
  const renderObsDashboard = extractBetween(js, "async function renderObsDashboard(target)", "function renderConn()");
  assert.match(renderObsDashboard, /c\.cacheCreate5mTokens != null && c\.cacheCreate1hTokens != null/, "the split is only rendered when known, never guessed");
  assert.match(renderObsDashboard, /c\.netBenefitTokens/);
  // The CACHE section specifically must stay token-based — no dollar pricing.
  // (The separate Model scorecard legitimately shows $/task cost per model.)
  const cacheSection = extractBetween(renderObsDashboard, "Prompt cache", "groupRows");
  assert.doesNotMatch(cacheSection, /\$/, "cache economics are token-based — no dollar-sign pricing in the cache section");
  // Local providers (historical telemetry rows only, e.g. "local-qwen") are
  // excluded from the DB-cache loop entirely — no live local-engine section exists anymore.
  assert.match(renderObsDashboard, /dbCacheRows = crows\.filter\(function \(c\) \{ return c\.provider\.indexOf\("local-"\) !== 0; \}\)/);
});

test("dashboard modal no longer renders a local-engine cache section (Claude-native cutover Phase 5)", () => {
  const js = extractScript(CONSOLE_HTML);
  const renderObsDashboard = extractBetween(js, "async function renderObsDashboard(target)", "function renderConn()");
  assert.doesNotMatch(renderObsDashboard, /Local engine cache/);
  assert.doesNotMatch(renderObsDashboard, /s\.localEngineCache/);
  assert.doesNotMatch(renderObsDashboard, /engine offline/);
  assert.doesNotMatch(renderObsDashboard, /pressure evictions/);
});

test("remote access UI is two toggles — Tailscale for iPhone, Cloudflare for Apple Watch — not the throwaway temporary tunnel", () => {
  // Each transport is a switch that drives the daemon (starts/stops the real
  // process) and reveals its settings only when on. The throwaway trycloudflare
  // "temporary tunnel" was removed in full.
  assert.match(CONSOLE_HTML, /Tailscale <span class="badge">iPhone/);
  assert.match(CONSOLE_HTML, /Cloudflare <span class="badge">Apple Watch/);
  assert.match(CONSOLE_HTML, /id="s_ts_switch"/);
  assert.match(CONSOLE_HTML, /id="s_cf_switch"/);
  assert.match(CONSOLE_HTML, /id="s_ts_body"/);
  assert.match(CONSOLE_HTML, /id="s_cf_body"/);
  assert.match(CONSOLE_HTML, /id="s_ts_url"/);
  assert.match(CONSOLE_HTML, /id="s_qr"/);
  // The toggle now runs `tailscale serve --bg 3747` itself instead of telling
  // the operator to type it — that instruction string is gone from the copy.
  assert.doesNotMatch(CONSOLE_HTML, /tailscale serve --bg 3747/, "the manual instruction is gone now that the toggle runs it");
  assert.doesNotMatch(CONSOLE_HTML, /id="s_tunnel_live"/, "s_tunnel_live's children now live inside their own cards");
  assert.doesNotMatch(CONSOLE_HTML, /Temporary tunnel/, "the throwaway temporary tunnel UI must be gone");
  assert.doesNotMatch(CONSOLE_HTML, /trycloudflare/, "no trycloudflare quick-test tunnel");
  assert.doesNotMatch(CONSOLE_HTML, /Advanced: Named Cloudflare tunnel/, "named tunnel should not be hidden under an Advanced disclosure");
  assert.match(CONSOLE_HTML, /Cloudflare Access Client ID/);
  assert.match(CONSOLE_HTML, /Cloudflare Access Client Secret/);
  assert.match(CONSOLE_HTML, /\/tunnel\/configure-named/);
  assert.match(CONSOLE_HTML, /\/tunnel\/access-credentials/);
  assert.match(CONSOLE_HTML, /\/remote\/tailscale\/enabled/);
  assert.match(CONSOLE_HTML, /\/remote\/cloudflare\/enabled/);
  // Remote setup lives on its own settings tab.
  assert.match(CONSOLE_HTML, /id="settingsRemote"/);
  assert.match(CONSOLE_HTML, /switchSettingsTab\('remote'\)/);
});

test("settings expose per-role Claude models for thinking, coding, and operational", () => {
  for (const id of ["s_role_thinking", "s_role_coding", "s_role_operational"]) {
    assert.match(CONSOLE_HTML, new RegExp('id="' + id + '"'), id + " selector present");
  }
  // onchange handlers live in the HTML attributes; the function lives in the script.
  assert.match(CONSOLE_HTML, /saveRoleModel\('thinking'/);
  assert.match(CONSOLE_HTML, /saveRoleModel\('coding'/);
  assert.match(CONSOLE_HTML, /saveRoleModel\('operational'/);
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /async function saveRoleModel\(/);
  // The role-model block is always shown now — every role routes to Claude.
  assert.doesNotMatch(js, /mixedAvailable/);
});

test("renderMessageBeeState renders a skipped chat.db probe as neutral, distinct from a genuine denial", () => {
  // Regression: a probe result of "skipped" (channel not yet enabled, so no
  // probe ran) rendered identically to a genuine open_failed denial (red
  // mark) — both just showed the FDA mark as "no". Skipped must be a
  // distinct neutral state, mirroring setup-status.ts's buildFullDiskAccess()
  // treatment of chatDbProbeSkipped.
  const js = extractScript(CONSOLE_HTML);
  const src = extractFunctionBlock(js, "renderMessageBeeState");
  const factory = new Function(
    "document",
    "mbStep",
    "renderBlockedMessageBeeIdentities",
    "renderMessageBeeSelfHandles",
    `${src}\nreturn renderMessageBeeState;`,
  ) as (
    doc: unknown,
    mbStep: () => null,
    renderBlockedMessageBeeIdentities: (ids: unknown) => void,
    renderMessageBeeSelfHandles: (handles: unknown) => void,
  ) => (data: unknown) => void;

  const run = (data: unknown) => {
    const els: Record<string, { textContent: unknown; className: unknown }> = {};
    const doc = { getElementById: (id: string) => (els[id] ||= { textContent: "", className: "" }) };
    factory(doc, () => null, () => {}, () => {})(data);
    return els;
  };

  const skipped = run({
    chatDbReadable: false, chatDbProbeSkipped: true, chatDbDetail: "Message Lane disabled",
    enabled: false, identities: [], selfHandles: [],
  });
  assert.equal(skipped["mb_fda_mark"].className, "mb-mark skip");

  const denied = run({
    chatDbReadable: false, chatDbProbeSkipped: false, chatDbDetail: "Cannot open Messages database...",
    enabled: false, identities: [], selfHandles: [],
  });
  assert.equal(denied["mb_fda_mark"].className, "mb-mark no");

  const granted = run({
    chatDbReadable: true, chatDbProbeSkipped: false, chatDbDetail: "Messages database readable",
    enabled: true, identities: [], selfHandles: [],
  });
  assert.equal(granted["mb_fda_mark"].className, "mb-mark ok");
});

test("renderMailBeeState leaves the automation mark untouched when a passive poll skips the probe, but still updates channel/identity marks", () => {
  // Regression (Bug A, 2026-07-15 lane-setup-modal-permission-staleness): while
  // Mail Lane's modal is open, pollMl() re-renders from a passive GET
  // /mailbee every 3s forever, and while the channel is off that passive
  // fetch always comes back mailProbeSkipped: true (no probe ran). The active
  // mlRetryAutomationProbe() loop stops itself the moment a probe succeeds,
  // so the very next passive tick — carrying skip data, not a denial — used
  // to clobber a correctly-green automation mark back to red, and nothing
  // was left running to flip it back. Mirrors renderMessageBeeState's
  // fdaSkipped handling above: a skip is neither granted nor denied and must
  // not overwrite a real result.
  const js = extractScript(CONSOLE_HTML);
  const src = extractFunctionBlock(js, "renderMailBeeState");
  const esc = js.match(/function esc\(s\)\{[^\n]+\}/);
  assert.ok(esc, "console script must define esc");
  const factory = new Function(
    "document",
    `${esc![0]}\n${src}\nreturn renderMailBeeState;`,
  ) as (doc: unknown) => (data: unknown) => void;

  const els: Record<string, { textContent: unknown; className: unknown; innerHTML: unknown }> = {};
  const doc = { getElementById: (id: string) => (els[id] ||= { textContent: "", className: "", innerHTML: "" }) };
  const render = factory(doc);

  // A genuine successful probe: automation granted, channel still off.
  render({ mailControllable: true, enabled: false, identities: [] });
  assert.equal(els["ml_auto_mark"].className, "mb-mark ok", "granted probe marks automation ok");

  // The next passive tick: channel got enabled and a trusted sender showed
  // up, but this fetch was a skip (no probe ran) — it must not downgrade the
  // automation mark already proven true, while the channel/identity marks
  // (the actual purpose of the passive poll) must still update normally.
  render({
    mailControllable: false, mailProbeSkipped: true, mailProbeReason: "channel_disabled",
    enabled: true, identities: [{ address: "a@b.com", status: "allowed" }],
  });
  assert.equal(els["ml_auto_mark"].className, "mb-mark ok", "skip must not downgrade a previously granted automation mark");
  assert.equal(els["ml_chan_mark"].className, "mb-mark ok", "channel mark must still update on a passive tick");
  assert.match(String(els["ml_identities"].innerHTML), /a@b\.com/, "identity chips must still update on a passive tick");
});

test("Message Lane setup offers real FDA remediation: reveal the daemon binary and restart it", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /onclick="revealMessageBeeDaemon\(\)"/);
  assert.match(CONSOLE_HTML, /onclick="restartMessageBeeDaemon\(\)"/);
  assert.match(js, /async function revealMessageBeeDaemon\(\)/);
  assert.match(js, /api\('\/messagebee\/reveal-daemon'/);
  assert.match(js, /async function restartMessageBeeDaemon\(\)/);
  assert.match(js, /api\('\/messagebee\/restart-daemon'/);
});

test("restart daemon action re-probes and re-renders the Message Lane setup modal after the daemon comes back up, not just the board", () => {
  // Regression (Bug B, 2026-07-15 lane-setup-modal-permission-staleness):
  // restartMessageBeeDaemon() exists specifically for "grant FDA to the
  // daemon binary, then restart it so the grant takes effect." Only calling
  // refresh() afterward re-renders the board/onboarding/etc — refresh()
  // never touches mb_fda_mark or renderMessageBeeState, and the setup modal
  // has no poll loop of its own, so the modal's own mark stayed frozen at
  // its pre-restart value even when the restart genuinely fixed access.
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "restartMessageBeeDaemon");
  // Scope to the successful-restart branch (after the "re-checking access…"
  // status text is set) so a probe/render call added to some other branch
  // (e.g. the error paths) would not satisfy this.
  const successBranchStart = body.indexOf("re-checking access");
  assert.notEqual(successBranchStart, -1, "restart daemon still sets the re-checking-access status text");
  const successBranch = body.slice(successBranchStart);
  assert.match(
    successBranch,
    /api\('\/messagebee\/probe',\s*\{\s*method:\s*'POST'\s*\}\)/,
    "restartMessageBeeDaemon must re-probe Message Lane once the daemon is back up, the same probe openMessageBeeSetup() uses"
  );
  assert.match(
    successBranch,
    /renderMessageBeeState\(/,
    "restartMessageBeeDaemon must re-render the setup modal's own marks with the fresh probe result, not rely on setTimeout(refresh, 3000) alone"
  );
  assert.match(
    successBranch,
    /refresh\(\)/,
    "refresh() must still run so the rest of the UI (board/onboarding/etc.) keeps working"
  );
});

test("MessageBee modal fetches structured status before reporting readability", () => {
  const js = extractScript(CONSOLE_HTML);
  // Uses the probe endpoint (forces a chat.db read) rather than the passive GET
  // that skips the probe while the channel is disabled — otherwise an
  // already-granted FDA shows as "not readable" on the setup screen.
  assert.match(js, /const r = await api\('\/messagebee\/probe', \{ method: 'POST' \}\)/);
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

test("frontier usage panel exposes Claude auth login action", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function runClaudeAuthLogin/);
  assert.match(js, /\/providers\/claude\/setup/);
  assert.match(js, /claudeAuthLogin/);
  assert.match(js, /Run Claude login/);
});

test("Brain / Memory Review nav opens a three-pane read-only screen wired to the Phase-1 endpoints", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="brainNav"[^>]*onclick="showBrain\(\)"/, "nav button present");
  assert.match(js, /function showBrain\(/);
  assert.match(js, /function brainPanelHtml\(/);
  assert.match(js, /function renderBrainPanel\(/);
  assert.match(fnBody(js, "syncNav"), /brainNav:\s*_brainState\.panelOpen/, "Brain nav active state follows its panel");
  assert.match(js, /overviewActive = .* !panelOpen/, "Overview is not active while a panel (incl. Brain) is open");
  // Wired to the Phase-1 server endpoints, not mocked data.
  assert.match(js, /api\('\/brain\/projects'\)/);
  assert.match(js, /api\('\/brain\/docs\?project='/);
  assert.match(js, /api\('\/brain\/doc\?project='/);
  // Mutual exclusivity with the other center-pane surfaces (Flash, task select, skill panel, new task).
  const closers = ["selectTask", "_closeSkillPanel"];
  for (const fn of closers) {
    const body = fnBody(js, fn);
    assert.match(body, /_brainState\.panelOpen = false/, `${fn} must close the Brain panel`);
  }
  // Rendered/Raw toggle + status legend + badges, matching the mockup taxonomy.
  assert.match(js, /function setBrainViewMode\(/);
  assert.match(js, /Main brief.*In task ctx.*Indexed only.*Orphaned.*Stale/s);
});

test("Brain Review: Exclude from context is a real toolbar action wired to POST /brain/doc/exclude", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /id="brainExcludeBtn"/);
  assert.match(js, /function toggleBrainDocSelected\(/);
  assert.match(js, /function runBrainExcludeAction\(/);
  const body = fnBody(js, "runBrainExcludeAction");
  assert.match(body, /\/brain\/doc\/exclude/);
  assert.match(body, /method:\s*'POST'/);
  assert.match(body, /allExcluded/);
  // The button label/action flips to "Restore" when everything selected is already excluded.
  const toggleBody = fnBody(js, "updateBrainToolbar");
  assert.match(toggleBody, /excludeBtn\.disabled = n === 0/);
  assert.match(toggleBody, /archiveBtn\.disabled = n === 0/);
  assert.match(toggleBody, /Restore to context/);
  // A real .html brain doc renders as HTML (sandboxed), not through the markdown escaper.
  const bodyFn = fnBody(js, "renderBrainPaneBody");
  assert.match(bodyFn, /\.html\?\$\/i\.test\(_brainState\.doc\)/);
  assert.match(bodyFn, /setAttribute\('sandbox', ''\)/, "iframe must be maximally sandboxed (no script execution)");
  assert.match(bodyFn, /\.srcdoc = /);
});

test("Brain Review: Archive/Restore is enforced by a real move, with an extra confirm for a live brief", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /id="brainArchiveBtn"/);
  assert.match(js, /function runBrainArchiveAction\(/);
  assert.match(js, /function runBrainRestoreOne\(/);
  const archiveBody = fnBody(js, "runBrainArchiveAction");
  assert.match(archiveBody, /\/brain\/doc\/archive/);
  assert.match(archiveBody, /method:\s*'POST'/);
  assert.match(archiveBody, /await hmConfirm\(/, "archive is destructive — must confirm, not fire-and-forget");
  assert.match(archiveBody, /includesLiveBrief/, "extra-confirm guard when the selection includes the live main brief");
  const restoreBody = fnBody(js, "runBrainRestoreOne");
  assert.match(restoreBody, /\/brain\/doc\/restore/);
  // Archived rows render struck-through under a divider, with disabled selection.
  const rowsFn = fnBody(js, "renderBrainDocs");
  assert.match(rowsFn, /archived-divider/);
  assert.match(rowsFn, /disabled = isArchived \|\| isPinnedProject/);
});

test("Brain Review: permanent Delete only ever targets an already-archived doc, and requires its own confirm", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /function runBrainDeleteOne\(/);
  const rowsFn = fnBody(js, "renderBrainDocs");
  assert.match(rowsFn, /runBrainDeleteOne/, "Delete is only rendered inside the archived-row branch");
  const deleteBody = fnBody(js, "runBrainDeleteOne");
  assert.match(deleteBody, /\/brain\/doc\/delete/);
  assert.match(deleteBody, /method:\s*'POST'/);
  assert.match(deleteBody, /await hmConfirm\(/, "permanent delete must confirm, not fire-and-forget");
  assert.match(deleteBody, /permanently/i);
});

test("Brain Review: pinned 'Always loaded' row is styled distinctly and its docs can't be selected/mutated", () => {
  const js = extractScript(CONSOLE_HTML);
  const projFn = fnBody(js, "renderBrainProjects");
  assert.match(projFn, /'__pinned__'/);
  assert.match(projFn, /pinned/);
  const rowsFn = fnBody(js, "renderBrainDocs");
  assert.match(rowsFn, /isPinnedProject = _brainState\.project === '__pinned__'/);
  assert.match(rowsFn, /disabled = isArchived \|\| isPinnedProject \|\| isConfig/);
});

test("Roles screen nav opens a three-pane read-only screen wired to the real /agents/profiles endpoints", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="rolesNav"[^>]*onclick="showRoles\(\)"/, "nav button present");
  assert.match(js, /function showRoles\(/);
  assert.match(js, /function rolesPanelHtml\(/);
  assert.match(js, /function renderRolesPanel\(/);
  assert.match(fnBody(js, "syncNav"), /rolesNav:\s*_rolesState\.panelOpen/, "Roles nav active state follows its panel");
  assert.match(js, /overviewActive = .* !panelOpen/, "Overview is not active while a panel (incl. Roles) is open");
  // Wired to the real Spec2-Phase1 server endpoints, not mocked data.
  assert.match(js, /api\('\/agents\/profiles'\)/);
  assert.match(js, /api\('\/agents\/profiles\/' \+ encodeURIComponent\(id\)\)/);
  assert.match(js, /api\('\/agents\/profiles\/' \+ encodeURIComponent\(id\) \+ '\/stats'\)/);
  // Mutual exclusivity with every other center-pane surface.
  for (const fn of ["selectTask", "_closeSkillPanel", "showSkillPanel", "showNewTaskPanel", "showOverview", "showFlashPanel", "showBrain"]) {
    const body = fnBody(js, fn);
    assert.match(body, /_rolesState\.panelOpen = false/, `${fn} must close the Roles panel`);
  }
  // And Roles itself closes Flash + Brain when opened.
  const showRolesBody = fnBody(js, "showRoles");
  assert.match(showRolesBody, /_flashState\.panelOpen = false/);
  assert.match(showRolesBody, /_brainState\.panelOpen = false/);
  assert.match(js, /function setRolesViewMode\(/);
});

test("Roles screen: roster is grouped by tier (Core/Coordinator/Domain), mirroring the New Task role picker's boundary", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "renderRolesRoster");
  assert.match(body, /byTier\[tier\]\.map\(row\)/);
  assert.match(body, /\['core', 'coordinator', 'domain'\]/);
});

test("Roles screen: the Insight panel is honest about a never-run role — never fabricates a rate", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "renderRoleDossier");
  assert.match(body, /totalRuns === 0/);
  assert.match(body, /has never run/);
  assert.match(body, /Enable.*Specialist agents/);
  assert.match(body, /successRate == null \? 'not enough data'/, "successRate:null renders as an honest label, not 0%");
});

test("Roles screen: the Learned panel shows real attributed skills, with an honest empty state when there are none", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "renderRoleDossier");
  assert.match(body, /_rolesState\.skills/, "reads real skills from state, not a hardcoded placeholder");
  assert.match(body, /No skills learned yet/, "empty state still shown honestly when sk.length === 0");
  assert.match(body, /sk\.map\(s => /, "non-empty skills render each attributed skill");
  assert.match(body, /untrusted — review/, "an untrusted (retrospective-distilled) skill carries a visible review chip");
});

test("Roles screen: loadRoleDetail fetches /agents/profiles/:id/skills alongside profile+stats", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "loadRoleDetail");
  assert.match(body, /\/agents\/profiles\/'\s*\+\s*encodeURIComponent\(id\)\s*\+\s*'\/skills'/);
  assert.match(body, /_rolesState\.skills = /);
});

test("Roles screen: prompt viewer Rendered/Raw toggle mirrors the Brain screen's pattern exactly", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "renderRolesPromptBody");
  assert.match(body, /_rolesState\.viewMode === 'raw'/);
  assert.match(body, /body\.textContent = d\.systemPrompt/, "raw mode shows the literal prompt text");
  assert.match(body, /mdToHtml\(d\.systemPrompt\)/, "rendered mode goes through the same markdown pipeline as everything else");
});

test("Roles screen: Edit mode replaces the render pane with a seeded textarea, never shown at the same time as the Rendered/Raw toggle", () => {
  const js = extractScript(CONSOLE_HTML);
  const bodyFn = fnBody(js, "renderRolesPromptBody");
  assert.match(bodyFn, /_rolesState\.editing/);
  assert.match(bodyFn, /id="rolesEditTextarea"/);
  assert.match(bodyFn, /ta\.value = _rolesState\.draft != null \? _rolesState\.draft : d\.systemPrompt/, "seeded from the draft if one exists, else the real current prompt");
  const paneFn = fnBody(js, "renderRolesPromptPane");
  assert.match(paneFn, /showControls = !!d && !_rolesState\.editing/, "view controls (toggle/Edit/Reset) are mutually exclusive with the edit textarea");
});

test("Roles screen: Reset to default is only offered for a custom override, and requires confirmation", () => {
  const js = extractScript(CONSOLE_HTML);
  const paneFn = fnBody(js, "renderRolesPromptPane");
  assert.match(paneFn, /showControls && d\.isCustom/, "Reset only shown for a custom (isCustom) profile");
  const resetFn = fnBody(js, "resetRoleToDefault");
  assert.match(resetFn, /await hmConfirm\(/, "destructive — must confirm, not fire-and-forget");
  assert.match(resetFn, /method: 'DELETE'/);
  assert.match(resetFn, /cannot be undone/i);
});

test("Roles screen: Save PUTs the edited prompt and refreshes the roster so the New Task role picker's isCustom chip updates without a restart", () => {
  const js = extractScript(CONSOLE_HTML);
  const saveFn = fnBody(js, "saveRoleEdit");
  assert.match(saveFn, /method: 'PUT'/);
  assert.match(saveFn, /systemPrompt\.trim\(\)/, "rejects an empty/whitespace-only prompt client-side too");
  assert.match(saveFn, /await loadAgentProfiles\(\)/, "refreshes the shared roster state (New Task picker + roles roster list)");
  assert.match(saveFn, /await loadRoleDetail\(id\)/, "reloads this role's own detail so the dossier/prompt reflect the save immediately");
});

test("Roles screen: switching to a different role cancels any in-progress, unsaved edit", () => {
  const js = extractScript(CONSOLE_HTML);
  const selectFn = fnBody(js, "selectRole");
  assert.match(selectFn, /_rolesState\.editing = false/);
  assert.match(selectFn, /_rolesState\.draft = null/);
});

test("Brain Review: Claude Code config files (CLAUDE.md/settings.json/.mcp.json) render read-only and settings/mcp JSON gets a novice-friendly summary, not raw JSON", () => {
  const js = extractScript(CONSOLE_HTML);
  const rowsFn = fnBody(js, "renderBrainDocs");
  assert.match(rowsFn, /isConfig = !!d\.configFile/);
  assert.match(rowsFn, /disabled = isArchived \|\| isPinnedProject \|\| isConfig/, "config files can't be selected for Archive/Exclude");
  assert.ok(rowsFn.includes("claude-code"), "the claude-code/ prefix is stripped for display");

  const paneBody = fnBody(js, "renderBrainPaneBody");
  assert.match(paneBody, /renderBrainJsonFriendly/);

  const friendlyBody = fnBody(js, "renderBrainJsonFriendly");
  assert.match(friendlyBody, /renderSettingsJsonFriendly/);
  assert.match(friendlyBody, /renderMcpJsonFriendly/);

  const settingsBody = fnBody(js, "renderSettingsJsonFriendly");
  assert.match(settingsBody, /Allowed without asking/);
  assert.match(settingsBody, /permissions\.allow/);
  assert.doesNotMatch(settingsBody, /JSON\.stringify\(data\)/, "must not just dump raw JSON back out");

  const mcpBody = fnBody(js, "renderMcpJsonFriendly");
  assert.match(mcpBody, /mcpServers/);
});

test("Brain Review: brain:changed SSE event re-fetches without a manual refresh", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /es\.addEventListener\("brain:changed", onBrainChanged\)/);
  const body = fnBody(js, "onBrainChanged");
  assert.match(body, /if \(!_brainState\.panelOpen\) return/, "a no-op when the Brain screen isn't open");
  assert.match(body, /api\('\/brain\/projects'\)/);
  assert.match(body, /loadBrainDocs\(_brainState\.project\)/);
});

test("Brain Review: network/API failures show a retry affordance instead of hanging on 'Loading…' forever", () => {
  const js = extractScript(CONSOLE_HTML);
  const loadProjects = fnBody(js, "loadBrainProjects");
  assert.match(loadProjects, /catch \(e\)/, "loadBrainProjects must not let a thrown fetch go uncaught");
  const projRender = fnBody(js, "renderBrainProjects");
  assert.match(projRender, /projectsError/);
  assert.match(projRender, /Retry/);

  const loadDocs = fnBody(js, "loadBrainDocs");
  assert.match(loadDocs, /catch \(e\)/, "loadBrainDocs must not let a thrown fetch go uncaught");
  const docsRender = fnBody(js, "renderBrainDocs");
  assert.match(docsRender, /docsError/);
  assert.match(docsRender, /Retry/);
  // The pinned pseudo-project gets an honest, specific empty-state message.
  assert.match(docsRender, /No ~\/\.claude\/CLAUDE\.md found/);

  const loadContent = fnBody(js, "loadBrainDocContent");
  assert.match(loadContent, /catch \(e\)/, "loadBrainDocContent must not let a thrown fetch go uncaught");
  const paneBody = fnBody(js, "renderBrainPaneBody");
  assert.match(paneBody, /docContentError/);
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
  assert.equal(helpers.compatLabel("claude"), "Claude");
  assert.match(helpers.compatSearchText({ raw: { compat: ["codex"] } }), /codex ChatGPT/);
  const chips = helpers.compatChips({ raw: { compat: ["codex"] } });
  assert.match(chips, /class="compat-chip"/);
  assert.match(chips, /ChatGPT/);
});

test("header is grouped into zones with a theme toggle; connectivity folds into the single ● live indicator, not a redundant pill", () => {
  assert.match(CONSOLE_HTML, /class="hzone"/, "header uses zones");
  assert.match(CONSOLE_HTML, /id="live"[^>]*onclick="toggleConnOverride\(\)"/, "clicking the live indicator reveals the connectivity override");
  assert.match(CONSOLE_HTML, /class="hgroup"[\s\S]*id="modeSel"/, "connectivity override select still present");
  assert.match(CONSOLE_HTML, /id="modeSel"[^>]*style="display:none"/, "manual connectivity override is hidden by default");
  assert.doesNotMatch(CONSOLE_HTML, /id="modePill"/, "the redundant cloud-ok/local-only/offline header pill is removed");
  assert.doesNotMatch(CONSOLE_HTML, /\.pill\.cloud-ok/, "the now-unused .pill.cloud-ok CSS is removed with it");
  assert.match(CONSOLE_HTML, /id="themeToggle"[^>]*onclick="toggleThemeQuick\(\)"/, "header has a quick theme toggle");
  assert.match(CONSOLE_HTML, /@media \(max-width: 760px\)[\s\S]*\.hlabel \{ display: none/, "header labels hide on narrow widths");
});

test("renderConn folds connectivity mode into the live indicator's color/text/tooltip instead of a second pill", () => {
  const js = extractScript(CONSOLE_HTML);
  const fn = fnBody(js, "renderConn");
  assert.match(fn, /getElementById\("live"\)/, "renderConn updates the live indicator");
  assert.doesNotMatch(fn, /modePill/, "renderConn no longer writes a separate connectivity pill");
  assert.match(fn, /classList\.contains\("stale"\)/, "SSE-down state (set by connectSSE) takes priority over a connectivity-mode update");
});

test("settings auto-save with toast feedback and open on About", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="s_default"[^>]*onchange="saveDefault\(\)"/, "default model auto-saves on change");
  assert.doesNotMatch(CONSOLE_HTML, /onclick="saveDefault\(\)"/, "no separate Save-default button");
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

test("Flash composer accepts images via paste and drag-drop, not just the file picker", () => {
  const js = extractScript(CONSOLE_HTML);
  // The three attach paths share one File→pendingImages helper.
  assert.match(js, /function flashAddImageFile\(f\)/, "shared image-file reader exists");
  assert.match(js, /function flashPaste\(e\)/, "paste handler exists");
  assert.match(js, /function flashDrop\(e\)/, "drop handler exists");
  // Paste pulls image blobs off the clipboard and adds them.
  assert.match(js, /flashPaste[\s\S]*clipboardData[\s\S]*getAsFile\(\)[\s\S]*flashAddImageFile/, "paste reads clipboard image files");
  // The composer wires onpaste on the input and ondrop on the shell.
  assert.match(CONSOLE_HTML, /id="flashInput"[^>]*onpaste="flashPaste\(event\)"/, "textarea has onpaste");
  assert.match(CONSOLE_HTML, /oc-panel-composer-shell[^>]*ondrop="flashDrop\(event\)"/, "composer shell has ondrop");
});

test("setup permissions step actively probes Full Disk Access (silent gate) so an already-granted daemon isn't shown as 'not checked'", () => {
  const js = extractScript(CONSOLE_HTML);
  // The permissions-step poll must force the chat.db probe, not the passive GET
  // that skips it while Message Lane is disabled.
  const poll = js.slice(js.indexOf("async function _obPollPerms"), js.indexOf("async function _obPollPerms") + 900);
  assert.match(poll, /\/onboarding\/setup\/full-disk-access\/probe/, "_obPollPerms forces the FDA probe");
  assert.doesNotMatch(poll, /api\('\/onboarding\/setup'\)/, "_obPollPerms no longer uses the passive setup GET that hides granted FDA");
});

test("board status colors: review-state drives a persistent card tone, selection is a separate ring", () => {
  const js = extractScript(CONSOLE_HTML);
  // needs_input → amber "attention"; ready_for_review / needs_parent_decision → green "review".
  assert.match(js, /needs_input[\s\S]*tone:\s*"attention"/, "needs_input maps to attention tone");
  assert.match(js, /ready_for_review[\s\S]*tone:\s*"review"/, "ready_for_review maps to review tone");
  assert.match(js, /needs_parent_decision[\s\S]*tone:\s*"review"/, "needs_parent_decision groups with review");
  // Card gets tone-<tone> class from reviewStateMeta, on EVERY such card (not just selected).
  assert.match(js, /reviewStateMeta\(t\.reviewState\)/, "card build calls reviewStateMeta");
  assert.match(js, /' tone-'\+rsm\.tone/, "card class includes tone-<tone> when a review state is present");
  // Tone tokens exist and selection is a ring, not a border-color (avoids the theme collision).
  assert.match(CONSOLE_HTML, /\.card\.tone-attention\s*\{[^}]*border-color:\s*var\(--warn\)/, "attention tone borders with --warn");
  assert.match(CONSOLE_HTML, /\.card\.tone-review\s*\{[^}]*border-color:\s*var\(--ok\)/, "review tone borders with --ok");
  assert.match(CONSOLE_HTML, /\.card\.sel\s*\{[^}]*box-shadow:\s*0 0 0 2px var\(--accent\)/, "selection is an additive ring, not border-color");
  assert.doesNotMatch(CONSOLE_HTML, /\.card\.sel\s*\{[^}]*border-color/, "selection no longer overrides border-color (would collide with status)");
});

test("settings lanes sections have distinct, non-duplicate labels", () => {
  // The duplicate-feeling pair was "Lane Apps" (installable apps) vs "Embedded
  // capability lanes" (daemon runtime). The latter is relabeled so it no longer
  // reads as a second app inventory.
  assert.match(CONSOLE_HTML, /Lane Apps/, "Lane Apps card kept as the app installer");
  assert.match(CONSOLE_HTML, /Runtime Capabilities/, "embedded lanes relabeled to Runtime Capabilities");
  assert.match(CONSOLE_HTML, /Browser Lane Sites &amp; Auth/, "browser readiness relabeled to Sites & Auth");
  assert.doesNotMatch(CONSOLE_HTML, /Terminal Lane Profiles &amp; Readiness/, "Terminal Lane readiness card retired");
  assert.doesNotMatch(CONSOLE_HTML, /Embedded capability lanes/, "old duplicate-feeling label is gone");
});

test("Lane Apps still names Browser Lane", () => {
  // Lane Apps is the canonical install/update/verify/launch surface for the app.
  const start = CONSOLE_HTML.indexOf("Lane Apps");
  const end = CONSOLE_HTML.indexOf("Runtime Capabilities");
  assert.ok(start >= 0 && end > start, "Lane Apps precedes Runtime Capabilities");
  const laneAppsCopy = CONSOLE_HTML.slice(start, end);
  assert.match(laneAppsCopy, /Browser Lane is a standalone signed app/, "Lane Apps copy names the app");
  assert.doesNotMatch(laneAppsCopy, /Terminal Lane/, "Terminal Lane no longer named here");
});

test("readiness card sits directly under Lane Apps, before Runtime Capabilities", () => {
  const laneApps = CONSOLE_HTML.indexOf("Lane Apps");
  const browserSites = CONSOLE_HTML.indexOf("Browser Lane Sites &amp; Auth");
  const runtime = CONSOLE_HTML.indexOf("Runtime Capabilities");
  assert.ok(laneApps >= 0 && browserSites > laneApps, "Browser Lane Sites & Auth follows Lane Apps");
  assert.ok(runtime > browserSites, "Runtime Capabilities comes after the readiness card");
});

test("the lane 'update' action targets the real install endpoint (not a dead /update route)", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = js.match(/function laneActionCall\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(body.length > 20, "laneActionCall extracted");
  const laneActionCall = new Function(body + "\nreturn laneActionCall;")() as (id: string, action: string) => string;
  // The bug: "update" mapped to laneAppAction(id,'update') → POST /lane-apps/:id/update (404).
  assert.equal(laneActionCall("browser-lane", "update"), "laneAppAction('browser-lane','install')");
  assert.equal(laneActionCall("browser-lane", "install"), "laneAppAction('browser-lane','install')");
  assert.equal(laneActionCall("browser-lane", "open"), "laneAppAction('browser-lane','launch')");
  assert.equal(laneActionCall("browser-lane", "repair"), "laneRepairApplications('browser-lane')");
  assert.equal(laneActionCall("browser-lane", "run_readiness"), "laneRunReadiness('browser-lane')");
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

test("subordinate readiness section remains below the Lane Apps card", () => {
  assert.match(CONSOLE_HTML, /Browser Lane Sites &amp; Auth/, "browser drill-down kept");
  assert.doesNotMatch(CONSOLE_HTML, /Terminal Lane Profiles &amp; Readiness/, "terminal drill-down retired");
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

test("header Usage section is removed; both 5h and 7d toggle buttons render visual progress bars", () => {
  // The sidebar Usage <details> section was replaced by a compact header toggle —
  // see docs/superpowers/specs/2026-07-15-console-header-cleanup-design.md item 3.
  // The toggle then grew inline progress bars — see
  // docs/superpowers/specs/2026-07-15-usage-toggle-progress-bars-design.md.
  assert.doesNotMatch(CONSOLE_HTML, /id="usageSec"/, "standalone Usage section is gone");
  assert.doesNotMatch(CONSOLE_HTML, /id="usageDetailsSec"/, "per-window details disclosure is gone");

  const headerStart = CONSOLE_HTML.indexOf("<header>");
  const hzoneEnd = CONSOLE_HTML.indexOf("</div>", headerStart);
  const headerZone = CONSOLE_HTML.slice(headerStart, hzoneEnd);
  assert.match(headerZone, /id="live"/, "live indicator stays in the header's first zone");
  assert.match(headerZone, /class="obs-win usage-win-bars" id="usageWinToggle"/, "reuses the existing .obs-win segmented toggle, no new toggle component");
  assert.match(headerZone, /data-w="5h" class="on" id="usageBtn5h"/, "5-hour is active by default");
  assert.match(headerZone, />5h</, "5-hour button label present");
  assert.match(headerZone, /id="usageBar5h"/, "5-hour bar track mount present");
  assert.match(headerZone, /id="usageBar5hFill"/, "5-hour bar fill mount present");
  assert.match(headerZone, /data-w="7d" id="usageBtn7d"/, "7-day button identifiable for tooltip/tick wiring");
  assert.match(headerZone, />7d</, "7-day button label present (shortened from '7 day' to make room for its tick bar)");
  assert.match(headerZone, /id="usageBar7d"/, "7-day tick track mount present");
  const dayTickCount = (headerZone.match(/class="usage-bar-day"/g) || []).length;
  assert.equal(dayTickCount, 7, "exactly 7 day ticks are pre-rendered in markup");
  assert.match(headerZone, /id="usageWinReadout"/, "readout text mount present");

  const toggleMarkup = CONSOLE_HTML.slice(CONSOLE_HTML.indexOf('id="usageWinToggle"'), CONSOLE_HTML.indexOf("</span>", CONSOLE_HTML.indexOf("usageWinReadout")));
  assert.doesNotMatch(toggleMarkup, /<div/, "toggle internals use span, not div, so the header's first </div> stays .hzone's own close");

  const js = extractScript(CONSOLE_HTML);
  assert.doesNotThrow(() => new Function(js), SyntaxError, "console script still parses as valid JS");
});

function consoleUsageBars() {
  const js = extractScript(CONSOLE_HTML);
  const usageBarClassSrc = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
  const cycleDaySrc = js.match(/function sevenDayCycleDay\([\s\S]*?\n\}/)?.[0] ?? "";
  const fmtResetsSrc = js.match(/function fmtResets\([\s\S]*?\n\}/)?.[0] ?? "";
  const winState = js.match(/let _headerUsageWin[^\n]+/)?.[0] ?? "";
  const cacheState = js.match(/let _lastClaudeWins[^\n]+/)?.[0] ?? "";
  const findWinSrc = js.match(/function findUsageWin\([\s\S]*?\n\}/)?.[0] ?? "";
  const setSrc = js.match(/function setHeaderUsageWindow\([^\n]+/)?.[0] ?? "";
  const render5hSrc = js.match(/function renderUsage5hBar\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  const render7dSrc = js.match(/function renderUsage7dBar\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  const renderSrc = js.match(/function renderHeaderUsageWindow\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(
    usageBarClassSrc.length > 50 && cycleDaySrc.length > 30 && fmtResetsSrc.length > 30
      && winState.length > 10 && cacheState.length > 10 && findWinSrc.length > 20
      && setSrc.length > 20 && render5hSrc.length > 30 && render7dSrc.length > 30 && renderSrc.length > 50,
    "usage bar state + functions extracted",
  );

  const combined = [usageBarClassSrc, cycleDaySrc, fmtResetsSrc, winState, cacheState, findWinSrc, setSrc, render5hSrc, render7dSrc, renderSrc].join("\n");
  const factory = new Function(
    "document",
    `${combined}\nreturn { setHeaderUsageWindow, renderHeaderUsageWindow, seed: function (w) { _lastClaudeWins = w; } };`,
  ) as (doc: unknown) => {
    setHeaderUsageWindow: (w: string) => void;
    renderHeaderUsageWindow: () => void;
    seed: (wins: unknown) => void;
  };

  function makeToggleBtn(w: string) {
    const classList = { on: false, toggle: (_cls: string, v: boolean) => { classList.on = v; } };
    return { dataset: { w }, classList };
  }
  function makeTick(day: number) {
    return { dataset: { day: String(day) }, className: "usage-bar-day" };
  }
  const toggleButtons = [makeToggleBtn("5h"), makeToggleBtn("7d")];
  const ticks = Array.from({ length: 7 }, (_, i) => makeTick(i + 1));
  const els: Record<string, any> = {
    usageWinReadout: { textContent: "", className: "muted" },
    usageBar5hFill: { style: { width: "" }, className: "" },
    usageBtn5h: { title: "" },
    usageBtn7d: { title: "" },
    usageBar7d: { querySelectorAll: (sel: string) => (sel === ".usage-bar-day" ? ticks : []) },
  };
  const doc = {
    getElementById: (id: string) => els[id],
    querySelectorAll: (sel: string) => (sel.indexOf("usageWinToggle") >= 0 ? toggleButtons : []),
  };
  const control = factory(doc);
  return { ...control, toggleButtons, ticks, els };
}

test("5-hour toggle button renders a visual progress bar (fill width + status color), independent of which window is active", () => {
  const ub = consoleUsageBars();
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const original = Date.now;
  Date.now = () => now;
  try {
    ub.seed([
      { label: "5-hour", remaining: 10, utilization: 90, resetsAt: new Date(now + 3600000).toISOString(), durationMs: 18000000 },
      { label: "7-day", remaining: 90, utilization: 10, resetsAt: new Date(now + 3 * 86400000).toISOString(), durationMs: 604800000 },
    ]);
    ub.setHeaderUsageWindow("7d");
    assert.equal(ub.els.usageBar5hFill.style.width, "90%", "fill width tracks 5-hour utilization");
    assert.equal(ub.els.usageBar5hFill.className, "usage-bar-fill hi", "90% utilization on a 5h window is the hi status color");
    assert.equal(ub.els.usageBtn5h.title, "10% left · resets in 1h 0m", "tooltip carries the exact detail regardless of active state");
  } finally {
    Date.now = original;
  }
});

test("5-hour bar resets to empty when there is no 5-hour window in the cached data", () => {
  const ub = consoleUsageBars();
  ub.seed([{ label: "7-day", remaining: 90, utilization: 10, resetsAt: new Date(Date.now() + 86400000).toISOString(), durationMs: 604800000 }]);
  ub.renderHeaderUsageWindow();
  assert.equal(ub.els.usageBar5hFill.style.width, "0%");
  assert.equal(ub.els.usageBar5hFill.className, "usage-bar-fill");
  assert.equal(ub.els.usageBtn5h.title, "");
});

test("7-day toggle button fills ticks up to the current cycle day, green when within the day-paced allowance", () => {
  const ub = consoleUsageBars();
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const original = Date.now;
  Date.now = () => now;
  try {
    ub.seed([
      { label: "7-day", remaining: 72, utilization: 28, resetsAt: new Date(now + 5 * day + 5 * hour).toISOString(), durationMs: 604800000 },
    ]);
    ub.renderHeaderUsageWindow();
    const filled = ub.ticks.filter((t: { className: string }) => t.className.indexOf("filled") >= 0);
    assert.equal(filled.length, 2, "day 2 of 7 (reset in 5d 5h) fills exactly 2 ticks");
    assert.ok(filled.every((t: { className: string }) => t.className.indexOf(" ok") >= 0), "28% used on day 2 (allowance 28.6%) is within pace — filled ticks are ok/green");
    assert.equal(ub.els.usageBtn7d.title, "Day 2 of 7 · 72% left · resets in 5d 5h", "tooltip states day progress + exact time");
  } finally {
    Date.now = original;
  }
});

test("7-day ticks turn red when utilization exceeds the current day's allowance, tick count unchanged", () => {
  const ub = consoleUsageBars();
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const original = Date.now;
  Date.now = () => now;
  try {
    ub.seed([
      { label: "7-day", remaining: 71, utilization: 29, resetsAt: new Date(now + 5 * day + 5 * hour).toISOString(), durationMs: 604800000 },
    ]);
    ub.renderHeaderUsageWindow();
    const filled = ub.ticks.filter((t: { className: string }) => t.className.indexOf("filled") >= 0);
    assert.equal(filled.length, 2, "still day 2 — tick count reflects elapsed days, not usage");
    assert.ok(filled.every((t: { className: string }) => t.className.indexOf(" hi") >= 0), "29% used on day 2 exceeds the 28.6% allowance — filled ticks turn hi/red");
  } finally {
    Date.now = original;
  }
});

test("7-day ticks clear when there is no 7-day window in the cached data", () => {
  const ub = consoleUsageBars();
  ub.seed([{ label: "5-hour", remaining: 50, utilization: 50, resetsAt: new Date(Date.now() + 3600000).toISOString(), durationMs: 18000000 }]);
  ub.renderHeaderUsageWindow();
  assert.ok(ub.ticks.every((t: { className: string }) => t.className === "usage-bar-day"), "no filled ticks without 7-day data");
  assert.equal(ub.els.usageBtn7d.title, "");
});

test("the sidebar Models panel (embeddings-only after Phase 4) is removed entirely — redundant with Settings > Models routing summary", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(CONSOLE_HTML, /id="modelsSec"/, "sidebar Models <details> section removed");
  assert.doesNotMatch(CONSOLE_HTML, /id="modelStatus"/, "modelStatus mount point removed");
  assert.doesNotMatch(js, /function checkModels\(/, "checkModels (embeddings-only render) removed");
  assert.doesNotMatch(js, /function reindexEmbeddings\(/, "reindexEmbeddings removed with its only caller");
  assert.doesNotMatch(js, /function refreshModelsNow\(/, "refreshModelsNow removed with its only caller");
  assert.doesNotMatch(js, /Local · on-device/, "local-engine group stays gone");
});

test("embeddings settings UI is hidden (deferred — no Claude equivalent); backend routes are untouched by the console", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(CONSOLE_HTML, /id="s_embedding_/, "no embeddings fields in Settings > Models");
  assert.doesNotMatch(js, /function renderEmbeddingSettings\(/);
  assert.doesNotMatch(js, /function saveEmbeddingsSettings\(/);
  assert.doesNotMatch(js, /function applyEmbeddingChoice\(/);
  assert.doesNotMatch(js, /Rapid-MLX Qwen3 Embedding/);
});

test("Settings Models no longer renders local-engine provisioning controls", () => {
  const js = extractScript(CONSOLE_HTML);
  const renderSettings = extractBetween(js, "function renderSettingsModelControls()", "function closeSettings()");

  assert.doesNotMatch(renderSettings, /renderLocalEngine\(/);
  assert.doesNotMatch(renderSettings, /renderProvisionUI\(/);
  assert.doesNotMatch(renderSettings, /s_endpoint/);
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


test("Usage UI introduces no dollar/cost copy", () => {
  const js = extractScript(CONSOLE_HTML);
  const checkUsage = js.match(/async function checkUsage\([\s\S]*?\n\}/)?.[0] ?? "";
  const render = js.match(/function renderHeaderUsageWindow\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(checkUsage.length > 100 && render.length > 50, "usage function bodies extracted");
  assert.doesNotMatch(checkUsage + render, /\$\d|\bcost\b/i, "no dollar amounts or cost copy in the Usage UI");
});

type UsageBarClass = (util: number, resetsAt: string, durationMs: number) => "ok" | "warn" | "hi";

function consoleUsageBarClass(): UsageBarClass {
  const js = extractScript(CONSOLE_HTML);
  const cycleDaySrc = js.match(/function sevenDayCycleDay\([\s\S]*?\n\}/)?.[0] ?? "";
  const body = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(cycleDaySrc.length > 30, "sevenDayCycleDay body extracted");
  assert.ok(body.length > 100, "usageBarClass body extracted");
  return new Function(cycleDaySrc + "\n" + body + "\nreturn usageBarClass;")() as UsageBarClass;
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

type SevenDayCycleDay = (resetsAt: string) => number | null;

function consoleSevenDayCycleDay(): SevenDayCycleDay {
  const js = extractScript(CONSOLE_HTML);
  const body = js.match(/function sevenDayCycleDay\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(body.length > 30, "sevenDayCycleDay body extracted");
  return new Function(body + "\nreturn sevenDayCycleDay;")() as SevenDayCycleDay;
}

test("sevenDayCycleDay returns the 1-7 day-of-cycle usageBarClass keys its day-pacing off of", () => {
  const cycleDay = consoleSevenDayCycleDay();
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  withFrozenNow(now, () => {
    assert.equal(cycleDay(resetIn(now, 6 * day + 5 * hour)), 1, "6d+ left => day 1");
    assert.equal(cycleDay(resetIn(now, 5 * day + 5 * hour)), 2, "5d+ left => day 2");
    assert.equal(cycleDay(resetIn(now, (18 * 60 + 29) * 60 * 1000)), 7, "under 1d left => day 7");
    assert.equal(cycleDay(resetIn(now, -hour)), null, "already-expired reset => null");
    assert.equal(cycleDay(""), null, "no reset timestamp => null");
  });
});

test("renderHeaderUsageWindow shows remaining% + reset time colored via the real usage-status-dot ok/warn/hi classes", () => {
  // Uses the consoleUsageBars() harness (above) rather than a dedicated toggle harness —
  // renderHeaderUsageWindow's dependency list grows every time a new bar is added
  // (Task A: sevenDayCycleDay, Task B: findUsageWin/renderUsage5hBar, Task C:
  // renderUsage7dBar), and consoleUsageBars() already tracks all of them, so this test
  // reuses that shared scaffolding instead of hand-maintaining a second, parallel
  // new Function(...) harness that needs the same fix every time.
  const ub = consoleUsageBars();
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const original = Date.now;
  Date.now = () => now;
  try {
    ub.seed([
      { label: "5-hour", remaining: 40, utilization: 60, resetsAt: new Date(now + 2 * 3600000).toISOString(), durationMs: 18000000 },
      { label: "7-day", remaining: 90, utilization: 10, resetsAt: new Date(now + 3 * 86400000).toISOString(), durationMs: 604800000 },
    ]);
    ub.renderHeaderUsageWindow();
    assert.equal(ub.els.usageWinReadout.textContent, "40% left · resets in 2h 0m", "5-hour window is the default");
    assert.equal(ub.els.usageWinReadout.className, "usage-status-dot warn", "reuses the real usage-status-dot + warn class, not an invented one");
    assert.equal(ub.toggleButtons[0].classList.on, true, "5-hour button marked active");
    assert.equal(ub.toggleButtons[1].classList.on, false, "7-day button not active");

    ub.setHeaderUsageWindow("7d");
    assert.equal(ub.els.usageWinReadout.textContent, "90% left · resets in 3d 0h", "switching windows re-renders instantly from cached data");
    assert.equal(ub.els.usageWinReadout.className, "usage-status-dot ok");
    assert.equal(ub.toggleButtons[0].classList.on, false, "5-hour button loses active state");
    assert.equal(ub.toggleButtons[1].classList.on, true, "7-day button gains active state");
  } finally {
    Date.now = original;
  }
});

test("checkUsage caches claudeWins for the header toggle and repaints it on every poll, without the old sidebar-only DOM writes", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = js.match(/async function checkUsage\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(body.length > 50, "checkUsage body extracted");
  assert.match(body, /_lastClaudeWins\s*=\s*claudeWins/, "caches claudeWins so the toggle can re-render without re-fetching");
  assert.match(body, /renderHeaderUsageWindow\(\)/, "repaints the header readout on every poll, not just on click");
  assert.doesNotMatch(body, /getElementById\("usageStatusDot"\)/, "sidebar status-dot write is gone");
  assert.doesNotMatch(body, /getElementById\("usageSummary"\)/, "sidebar summary write is gone");
  assert.doesNotMatch(body, /getElementById\("usage"\)/, "sidebar per-window breakdown write is gone");
});

test("Usage sidebar cleanup leaves no dangling references to the removed section or its renderers", () => {
  for (const deadId of ["usageSec", "usageStatusDot", "usageSummary", "usageDetailsSec", "usageRefresh"]) {
    assert.doesNotMatch(CONSOLE_HTML, new RegExp('id="' + deadId + '"'), deadId + " markup is gone");
  }
  const js = extractScript(CONSOLE_HTML);
  for (const deadFn of ["refreshUsageNow", "usageProviderCard", "renderSubBar", "renderCodexBar", "dayTicksHtml", "usagePlanLabel"]) {
    assert.doesNotMatch(js, new RegExp("\\b" + deadFn + "\\b"), deadFn + " has no remaining references");
  }
  // usageBarClass stays — it's the color logic the header readout reuses.
  assert.match(js, /function usageBarClass\(/, "usageBarClass is kept for the header readout's other caller");
});

function consoleTaskProvenancePills(): (t: unknown, out: unknown, logs: unknown, childTasks?: unknown) => string {
  const js = extractScript(CONSOLE_HTML);
  const esc = js.match(/function esc\(s\)\{[^\n]+\}/)?.[0] ?? "";
  const agentProfileById = js.match(/const agentProfileById = \{\};[^\n]*/)?.[0] ?? "";
  const roleLabel = js.match(/const ROLE_PROVENANCE_LABEL = \{[^\n]+\};/)?.[0] ?? "";
  const renderRolePills = js.match(/function renderRolePills\([\s\S]*?\n\}/)?.[0] ?? "";
  const body = js.match(/function taskProvenancePills\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(esc.length > 10 && agentProfileById.length > 5 && roleLabel.length > 10 && renderRolePills.length > 20 && body.length > 20,
    "esc + agentProfileById + ROLE_PROVENANCE_LABEL + renderRolePills + taskProvenancePills bodies extracted");
  return new Function(esc + "\n" + agentProfileById + "\n" + roleLabel + "\n" + renderRolePills + "\n" + body + "\nreturn taskProvenancePills;")() as (t: unknown, out: unknown, logs: unknown, childTasks?: unknown) => string;
}

// Same extraction as consoleTaskProvenancePills, but for cardRoleBadge (the
// board-card equivalent) and lets a test seed agentProfileById.
function consoleCardRoleBadge(profileFixtures: Record<string, { icon?: string; name: string }>): (t: unknown) => string {
  const js = extractScript(CONSOLE_HTML);
  const esc = js.match(/function esc\(s\)\{[^\n]+\}/)?.[0] ?? "";
  const body = js.match(/function cardRoleBadge\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(esc.length > 10 && body.length > 20, "esc + cardRoleBadge bodies extracted");
  const seededProfiles = "const agentProfileById = " + JSON.stringify(profileFixtures) + ";";
  return new Function(esc + "\n" + seededProfiles + "\n" + body + "\nreturn cardRoleBadge;")() as (t: unknown) => string;
}

// Same extraction as consoleTaskProvenancePills, but exposes renderRolePills
// directly and lets a test seed agentProfileById (normally populated by
// loadAgentProfiles() from GET /agents/profiles at boot) with fixture data.
function consoleRenderRolePills(profileFixtures: Record<string, { icon?: string; name: string }>): (task: unknown, childTasks: unknown) => string {
  const js = extractScript(CONSOLE_HTML);
  const esc = js.match(/function esc\(s\)\{[^\n]+\}/)?.[0] ?? "";
  const roleLabel = js.match(/const ROLE_PROVENANCE_LABEL = \{[^\n]+\};/)?.[0] ?? "";
  const renderRolePills = js.match(/function renderRolePills\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(esc.length > 10 && roleLabel.length > 10 && renderRolePills.length > 20, "esc + ROLE_PROVENANCE_LABEL + renderRolePills bodies extracted");
  const seededProfiles = "const agentProfileById = " + JSON.stringify(profileFixtures) + ";";
  return new Function(esc + "\n" + seededProfiles + "\n" + roleLabel + "\n" + renderRolePills + "\nreturn renderRolePills;")() as (task: unknown, childTasks: unknown) => string;
}

test("taskProvenancePills renders nothing for a queued task with no run data yet", () => {
  const pills = consoleTaskProvenancePills();
  assert.equal(pills({}, {}, []), "", "no models, no MCP tool_use logs, no skill → empty");
});

test("taskProvenancePills renders one role pill per distinct model actually used", () => {
  const pills = consoleTaskProvenancePills();
  const html = pills({}, { modelsUsed: ["claude-sonnet-4.5", "qwen3.6-27b-4bit", "claude-sonnet-4.5"] }, []);
  const matches = [...html.matchAll(/class="prov-pill role"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(matches, ["claude-sonnet-4.5", "qwen3.6-27b-4bit", "claude-sonnet-4.5"],
    "one pill per modelsUsed entry, in order — dedup is the caller's concern if ever needed, not silently hidden here");
});

test("taskProvenancePills derives MCP server pills from mcp__<server>__<tool> tool_use log entries", () => {
  const pills = consoleTaskProvenancePills();
  const logs = [
    { type: "text", content: "not a tool call" },
    { type: "tool_use", content: "mcp__brain__search: {\"q\":\"decisions\"}" },
    { type: "tool_use", content: "mcp__brain__links: {\"doc\":\"x\"}" },
    { type: "tool_use", content: "Read: /some/file.ts" },
  ];
  const html = pills({}, {}, logs);
  const matches = [...html.matchAll(/class="prov-pill mcp"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(matches, ["brain"], "same server deduped across multiple tool calls; non-mcp tool_use entries ignored");
});

test("taskProvenancePills shows the entry-point skill/command from out.command", () => {
  const pills = consoleTaskProvenancePills();
  const html = pills({}, { command: "release-hivematrix" }, []);
  assert.match(html, /class="prov-pill skill"[^>]*>release-hivematrix</);
});

test("taskProvenancePills combines all three categories with distinct pill classes", () => {
  const pills = consoleTaskProvenancePills();
  const html = pills({}, { modelsUsed: ["claude-sonnet-4.5"], command: "release-hivematrix" },
    [{ type: "tool_use", content: "mcp__brain__search: {}" }]);
  assert.match(html, /<div class="prov-pills">/);
  assert.match(html, /prov-pill role"[^>]*>claude-sonnet-4\.5</);
  assert.match(html, /prov-pill mcp"[^>]*>brain</);
  assert.match(html, /prov-pill skill"[^>]*>release-hivematrix</);
});

test("renderRolePills: no agentType (or 'auto') and no children ⇒ empty, never invents a role", () => {
  const render = consoleRenderRolePills({});
  assert.equal(render({}, []), "");
  assert.equal(render({ agentType: "auto" }, []), "");
});

test("renderRolePills: known profile shows icon + name, distinct 'agent' pill class from the model pill", () => {
  const render = consoleRenderRolePills({ designer: { icon: "🎨", name: "UX / UI Designer" } });
  const html = render({ agentType: "designer" }, []);
  assert.match(html, /class="prov-pill agent"/);
  assert.match(html, />🎨 UX \/ UI Designer</);
});

test("renderRolePills: unknown id (not yet loaded/custom-deleted) falls back to the raw id, not a blank pill", () => {
  const render = consoleRenderRolePills({});
  const html = render({ agentType: "some-custom-role" }, []);
  assert.match(html, /class="prov-pill agent"/);
  assert.match(html, />some-custom-role</);
});

test("renderRolePills: tooltip states how the role was chosen from output.roleProvenance", () => {
  const render = consoleRenderRolePills({ qa: { icon: "🔍", name: "QA" } });
  const explicit = render({ agentType: "qa", output: { roleProvenance: { agentType: "qa", source: "explicit" } } }, []);
  assert.match(explicit, /title="you picked it"/);
  const classifier = render({ agentType: "qa", output: { roleProvenance: { agentType: "qa", source: "classifier" } } }, []);
  assert.match(classifier, /title="auto-classified"/);
  const asString = render({ agentType: "qa", output: JSON.stringify({ roleProvenance: { agentType: "qa", source: "default" } }) }, []);
  assert.match(asString, /title="default \(Specialist agents is off\)"/, "task.output as a raw JSON string is parsed, not just a live object");
});

test("renderRolePills: a stale roleProvenance for a DIFFERENT agentType is never shown as this task's reason", () => {
  const render = consoleRenderRolePills({ developer: { icon: "💻", name: "Developer" } });
  // e.g. a task whose role was later overridden — the recorded provenance no longer describes agentType.
  const html = render({ agentType: "developer", output: { roleProvenance: { agentType: "qa", source: "explicit" } } }, []);
  assert.match(html, /title="Agent role"/, "falls back to the generic tooltip rather than claiming a mismatched reason");
});

test("renderRolePills: distinct roles among childTasks each get their own pill, deduped, primary first", () => {
  const render = consoleRenderRolePills({
    coo: { icon: "🧭", name: "COO" }, designer: { icon: "🎨", name: "Designer" }, qa: { icon: "🔍", name: "QA" },
  });
  const html = render(
    { agentType: "coo" },
    [{ agentType: "designer" }, { agentType: "qa" }, { agentType: "designer" }, { agentType: "auto" }],
  );
  const order = [...html.matchAll(/>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(order, ["🧭 COO", "🎨 Designer", "🔍 QA"], "primary role first, then each distinct child role once, auto children ignored");
});

test("taskProvenancePills threads childTasks through to renderRolePills — a coordinator's detail view shows every role that helped", () => {
  const pills = consoleTaskProvenancePills();
  const html = pills({ agentType: "coo" }, {}, [], [{ agentType: "designer" }, { agentType: "qa" }]);
  const roles = [...html.matchAll(/class="prov-pill agent"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(roles, ["coo", "designer", "qa"]);
});

test("cardRoleBadge: a plain task with no children shows just its own role badge (unchanged single-pill behavior)", () => {
  const badge = consoleCardRoleBadge({ developer: { icon: "💻", name: "Developer" } });
  assert.match(badge({ agentType: "developer" }), /class="badge"[^>]*>💻 Developer</);
  assert.equal(badge({ agentType: "developer", childAgentTypes: [] }), badge({ agentType: "developer" }));
});

test("cardRoleBadge: a coordinator's board card shows its own badge plus one per distinct child role (server-enriched childAgentTypes)", () => {
  const badge = consoleCardRoleBadge({
    coo: { icon: "🧭", name: "COO" }, designer: { icon: "🎨", name: "Designer" }, qa: { icon: "🔍", name: "QA" },
  });
  const html = badge({ agentType: "coo", childAgentTypes: ["designer", "qa", "designer"] });
  const roles = [...html.matchAll(/class="badge"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(roles, ["🧭 COO", "🎨 Designer", "🔍 QA"], "primary first, each distinct child once — deduped even though designer repeats");
});

test("cardRoleBadge: no agentType and no children ⇒ empty, never invents a badge", () => {
  const badge = consoleCardRoleBadge({});
  assert.equal(badge({}), "");
  assert.equal(badge({ agentType: "auto", childAgentTypes: [] }), "");
});

test("selectTask fetches this task's children (for plural role pills) and passes them into taskProvenancePills", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "selectTask");
  assert.match(body, /\/tasks\?parentTaskId="\s*\+\s*id/);
  assert.match(body, /taskProvenancePills\(t, out, logs, children\)/);
});

test("roleSelectOptionsHtml groups every role select by tier (Auto/core flat, Coordinator + Domain as separate optgroups, explicit-pick only)", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "roleSelectOptionsHtml");
  assert.match(body, /filter\(p => \(p\.tier \|\| "core"\) === "core"\)/, "core roles are the flat, Auto-eligible list");
  assert.match(body, /filter\(p => p\.tier === "coordinator"\)/);
  assert.match(body, /filter\(p => p\.tier === "domain"\)/);
  assert.match(body, /optgroup label="Coordinator \(explicit only\)"/);
  assert.match(body, /optgroup label="Domain \(explicit only\)"/);
});

test("loadAgentProfiles populates BOTH the main role select and the wizard preview's suggestion select from the same shared options, so they can never drift", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "loadAgentProfiles");
  assert.match(body, /populateRoleSelect\("t_role"\)/);
  assert.match(body, /populateRoleSelect\("t_enhanced_role"\)/);
});

test("provenance pills are wired into the task detail view, right after the status line", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "selectTask");
  assert.match(body, /taskProvenancePills\(t, out, logs, children\)/, "selectTask renders the pills (with fetched children for plural role pills)");
});

test("Terminal Lane readiness card and endpoints are fully retired", () => {
  assert.doesNotMatch(CONSOLE_HTML, /id="terminal_readiness"/, "Terminal readiness mount point removed");
  const js = extractScript(CONSOLE_HTML);
  assert.doesNotMatch(js, /renderTerminalReadiness/, "Terminal readiness renderer removed");
  assert.doesNotMatch(js, /\/terminal-lane\/dashboard/, "terminal-lane dashboard endpoint no longer called");
  assert.doesNotMatch(js, /\/terminal-lane\/readiness\/run/, "terminal-lane run-probe endpoint no longer called");
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

test("New task uses one Project control with derived path as secondary text, and it's optional", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, /<label class="flbl">Project /, "a single 'Project' label");
  assert.match(slice, /\(optional/i, "project is explicitly marked optional — operational tasks don't need one");
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

test("board card title has a native tooltip so a truncated title stays readable on hover", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "renderBoard");
  assert.match(body, /<span class="mdl-card-name" style="min-width:0" title="'\+esc\(t\.title\|\|t\._id\)\+'">/,
    "card title span carries a title= tooltip with the full (untruncated) task name");
});

test("createTask builds the payload from the selection, falling back to Inbox when nothing is picked (no freeform path/search read)", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "createTask");
  // Project is optional: an operational task with no directory of its own
  // must still be creatable, so createTask falls back to the built-in Inbox
  // catch-all rather than requiring a selection.
  assert.match(body, /projectDropdownItems\.find\(p => p\.name === "inbox"\)/, "falls back to the Inbox project when none is selected");
  assert.match(body, /const projectPath = projSel\.path/, "project path comes from the (possibly-fallback) selection state");
  assert.match(body, /const projectName = projSel\.name/, "project name comes from the (possibly-fallback) selection state");
  assert.match(body, /project: projectName/, "payload project is the selected name, not the search box");
  assert.doesNotMatch(body, /getElementById\("t_project_search"\)\.value/, "never reads the freeform filter text into the payload");
});

test("createTask never blocks Create on a missing project", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "createTask");
  assert.match(body, /Please describe what the agent should do\./, "description required");
  assert.match(body, /Please choose a model before creating the task\./, "model required");
  // The old hard block on project selection is gone — project is optional.
  assert.doesNotMatch(body, /Please choose a project/, "no longer blocks Create for a missing project");
  // Old technical phrasing is gone.
  assert.doesNotMatch(body, /Description and project path are required\./, "stale technical error removed");
});

test("New task keeps the model selector and attachments controls", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, /<select id="t_model">/, "model selector kept");
  assert.match(slice, /id="t_attach_input"/, "attachment input kept");
  assert.match(slice, /onclick="createTask\(\)"/, "Create task button kept");
});

test("Enhanced-prompt preview includes an editable task-name field", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, /id="t_enhanced_title"/, "title input present in the preview box");
  assert.match(slice, /id="t_enhanced_title"[^>]*maxlength="60"/, "title input capped to the board's title budget");
});

test("enhanceTaskPrompt populates the preview's title field from the wizard result", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "enhanceTaskPrompt");
  assert.match(body, /getElementById\("t_enhanced_title"\)\.value = \(result && typeof result\.title === "string"\) \? result\.title : ""/,
    "title field is set from result.title, empty string when absent");
});

test("acceptEnhancedPrompt copies the wizard title into the hidden t_title field", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "acceptEnhancedPrompt");
  assert.match(body, /getElementById\("t_enhanced_title"\)\.value\.trim\(\)/,
    "reads the (possibly edited) title from the preview");
  assert.match(body, /if \(title\) document\.getElementById\("t_title"\)\.value = title/,
    "only overwrites t_title when a non-empty title was produced — no title falls back to server-side deriveTaskTitle");
});

test("Enhanced-prompt preview includes an editable, freely-overridable role suggestion select", () => {
  const slice = taskFormSlice(CONSOLE_HTML);
  assert.match(slice, /id="t_enhanced_role"/, "role select present in the preview box");
});

test("enhanceTaskPrompt pre-fills the preview's role select from result.agentType, falling back to auto for anything not in the loaded roster", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "enhanceTaskPrompt");
  assert.match(body, /getElementById\("t_enhanced_role"\)/);
  assert.match(body, /agentProfileById\[result && result\.agentType\] \? result\.agentType : "auto"/,
    "never trusts an unrecognized agentType verbatim — client-side defense in depth alongside the server's own validation");
});

test("acceptEnhancedPrompt copies the (possibly operator-corrected) suggested role into the real t_role select that Create actually reads", () => {
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "acceptEnhancedPrompt");
  assert.match(body, /getElementById\("t_enhanced_role"\)/);
  assert.match(body, /if \(roleSel && suggestedRole\) roleSel\.value = suggestedRole/,
    "writes into t_role — the same field createTask() reads — so the wizard's suggestion (or the operator's override of it) actually takes effect");
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
  // Bails when there's nothing to send (no text AND no attached photo) or in-flight.
  assert.match(js, /if \(!input \|\| \(!input\.value\.trim\(\) && !images\.length\) \|\| _flashState\.sending\) return/, "flashSend bails on empty (no text+no image) or in-flight");
  assert.match(js, /_flashState\.sending = true/, "sending flag set before request");
  assert.match(js, /_flashState\.sending = false/, "sending flag cleared in finally block");
});

test("Flash chat has no thumbs-down button; assistant is labeled with the cyclone sigil", () => {
  const js = extractScript(CONSOLE_HTML);
  // The 👎 feedback button + its handler were removed (the /flash/turns/:id/feedback
  // endpoint stays for programmatic use, but the UI no longer surfaces it).
  assert.doesNotMatch(js, /flashThumbsDown/, "thumbs-down handler is gone");
  assert.ok(!js.includes("👎"), "no thumbs-down button in the chat");
  // The assistant is marked with the cyclone sigil (🌀) alone — the persona name is
  // scope-walled out of public/user-facing surfaces (DECISIONS.md Q18), so just the icon.
  assert.match(js, /'🌀'/, "assistant messages are labeled with the cyclone sigil");
});

test("primary left nav uses a single active color convention", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(CONSOLE_HTML, /id="newTaskNav"/, "New task has a tracked nav id");
  assert.match(CONSOLE_HTML, /\.addbtn \{[^}]*color:\s*var\(--text\)/, "New task is neutral when inactive");
  assert.match(CONSOLE_HTML, /\.addbtn\.active[^}]*color:\s*var\(--accent\)/, "New task uses accent only when active");
  // Nav highlight funnels through a single syncNav() so exactly one item is lit.
  const sync = fnBody(js, "syncNav");
  assert.match(js, /overviewActive = .* !_taskFormInSession/, "Overview is not active while New task is open");
  assert.match(sync, /newTaskNav:\s*_taskFormInSession/, "New task active state follows the center form");
  assert.match(sync, /flashNav:\s*_flashState\.panelOpen/, "Flash active state follows the center panel");
  // Regression guard for the double-highlight bug: Roles must be in the single
  // sync (it was omitted before), and showOverview must call syncNav so a stale
  // panel nav can't stay lit after returning to Overview.
  assert.match(sync, /rolesNav:\s*_rolesState\.panelOpen/, "Roles is included in the single nav sync");
  assert.match(fnBody(js, "showOverview"), /syncNav\(\)/, "showOverview re-syncs the nav (no stale highlight)");
  assert.match(fnBody(js, "showOverview"), /if \(_taskFormInSession\) _closeNewTaskPanel\(\)/, "showOverview closes an open New Task form so its nav can't stay lit");
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

test("runSelectedCommand success message is the plain unconditional form now that the board filter is gone", () => {
  // The project board-filter dropdown (and state.selectedProject as a board
  // filter) was removed — see
  // docs/superpowers/specs/2026-07-15-console-header-cleanup-design.md item 2.
  // The old mismatch-message branching here depended entirely on
  // state.selectedProject, which can now never be set, so it was dead code
  // and has been deleted; only the plain success message remains.
  const js = extractScript(CONSOLE_HTML);
  const body = fnBody(js, "runSelectedCommand");

  assert.match(body, /see the board/, "plain success message is shown on launch");
  assert.doesNotMatch(body, /state\.selectedProject/, "no longer reads the removed board filter");
  assert.doesNotMatch(body, /boardFilter/, "board-filter mismatch branching is gone");
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

test("goal card surfaces the next-action hook and an affordance to set it", () => {
  const js = extractScript(CONSOLE_HTML);
  const row = fnBody(js, "goalRowHtml");
  // The '→ next: …' step when set, and a '+ set next step' affordance when not.
  assert.match(row, /→ next: /, "the concrete next step is rendered");
  assert.match(row, /\+ set next step/, "empty goals offer a way to set the next step");
  assert.match(row, /goalSetNext\(/, "clicking routes to goalSetNext");
  // goalSetNext upserts nextAction by id via POST /goals.
  const setNext = fnBody(js, "goalSetNext");
  assert.match(setNext, /nextAction: next/, "it saves the entered next step");
  assert.match(setNext, /'\/goals'/, "it upserts via the goals endpoint");
});
