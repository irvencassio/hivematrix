import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectivityPolicy } from "@/lib/connectivity/policy";
import {
  isLaneTool, availableLaneTools, executeLaneTool, LANE_TOOL_DEFINITIONS, resolveLaneToolName,
  capabilityRoutingGuide, executeMailBeeSend, executeMailBeeDraft, executeMessageBeeSend,
  type MailBeeSendIO, type MessageBeeSendIO, type LaneToolContext,
} from "./lane-tools";

function cloud() { return new ConnectivityPolicy(); }
function local() { const p = new ConnectivityPolicy(); p.setManualOverride("local-only"); return p; }
function offline() { const p = new ConnectivityPolicy(); p.setManualOverride("offline"); return p; }

// Point the brain root at a temp dir (skill_run reads/writes real skill files
// on disk via the skills store — same trick as skills/store.test.ts: a fake
// HOME + ~/.hivematrix/config.json, since configuredBrainRootDir() reads that
// file fresh on every call).
const SKILL_TMP = mkdtempSync(join(tmpdir(), "hm-lane-skills-"));
const SKILL_HOME = join(SKILL_TMP, "home");
const SKILL_BRAIN = join(SKILL_TMP, "brain");
mkdirSync(join(SKILL_HOME, ".hivematrix"), { recursive: true });
writeFileSync(join(SKILL_HOME, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: SKILL_BRAIN } }));
const origHome = process.env.HOME;
process.env.HOME = SKILL_HOME;

const { upsertSkill, readSkill } = await import("@/lib/skills/store");
const { setAutonomyLevel } = await import("@/lib/config/autonomy");

test.afterEach(() => {
  setAutonomyLevel("standard"); // restore the default between tests
});

test.after(() => {
  process.env.HOME = origHome;
  rmSync(SKILL_TMP, { recursive: true, force: true });
});

function ctx(): LaneToolContext {
  return { projectPath: "/tmp", project: "ops", requestedBy: "test" };
}

const names = (tools: { function: { name: string } }[]) => tools.map((t) => t.function.name).sort();

test("isLaneTool recognizes active lane tools and rejects removed browser aliases", () => {
  assert.equal(isLaneTool("hivematrix_browser"), true);
  assert.equal(isLaneTool("webbee_search"), false);
  assert.equal(isLaneTool("browserbee_run"), false);
  assert.equal(isLaneTool("desktopbee_action"), true);
  assert.equal(isLaneTool("mailbee_send"), true);
  assert.equal(isLaneTool("mailbee_draft"), true);
  assert.equal(isLaneTool("messagebee_send"), true);
  assert.equal(isLaneTool("brain_search"), true);
  assert.equal(isLaneTool("brain_read"), true);
  assert.equal(isLaneTool("skill_used"), true);
  assert.equal(isLaneTool("skill_run"), true);
  assert.equal(isLaneTool("digest_url"), true);
  assert.equal(isLaneTool("code_graph"), true);
  assert.equal(isLaneTool("bash"), false);
  assert.equal(isLaneTool("read_file"), false);
});

test("resolveLaneToolName maps legacy bee ids to their lane-native handler names", () => {
  assert.equal(resolveLaneToolName("desktopbee_action"), "desktop_action");
  assert.equal(resolveLaneToolName("mailbee_send"), "mail_send");
  assert.equal(resolveLaneToolName("mailbee_draft"), "mail_draft");
  assert.equal(resolveLaneToolName("messagebee_send"), "message_send");
  // Lane-native (advertised) names and unknowns resolve to themselves.
  assert.equal(resolveLaneToolName("mail_send"), "mail_send");
  assert.equal(resolveLaneToolName("bash"), "bash");
  // Removed legacy browser ids are not re-introduced as aliases.
  assert.equal(resolveLaneToolName("browserbee_run"), "browserbee_run");
});

test("isLaneTool accepts both the advertised lane ids and legacy bee aliases", () => {
  assert.equal(isLaneTool("mail_send"), true);
  assert.equal(isLaneTool("message_send"), true);
  assert.equal(isLaneTool("desktop_action"), true);
  // Legacy bee ids still resolve for older persisted calls.
  assert.equal(isLaneTool("mailbee_send"), true);
  assert.equal(isLaneTool("desktopbee_action"), true);
  // Still rejects the removed browser ids and non-lane tools.
  assert.equal(isLaneTool("browserbee_run"), false);
  assert.equal(isLaneTool("bash"), false);
});

test("executeLaneTool dispatches a legacy bee alias to its real handler", async () => {
  // The legacy id reaches the mail handler (required-field error) rather than
  // the "Unknown lane tool" path — proving mailbee_send resolved to mail_send.
  // When the lane is gated off it returns the capability error; neither is the
  // unknown-tool error, so the alias resolution holds regardless of policy.
  const out = await executeLaneTool("mailbee_send", {}, { projectPath: "/tmp", project: "p", requestedBy: "t" });
  assert.doesNotMatch(out, /Unknown lane tool/);
  assert.match(out, /required to send an email|unavailable in the current connectivity mode/);
});

test("all bee tools are defined with required schemas", () => {
  assert.equal(LANE_TOOL_DEFINITIONS.length, 22); // 13 lanes (incl. brain_read) + 5 PIM tools + 4 goals tools
  for (const t of LANE_TOOL_DEFINITIONS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name.length > 0);
    assert.ok(t.function.description.length > 0);
    assert.ok(t.function.parameters);
  }
});

test("lane tools advertise lane-native names and descriptions, not bee brands", () => {
  const prose = LANE_TOOL_DEFINITIONS.map((t) => JSON.stringify({
    description: t.function.description,
    parameters: t.function.parameters,
  })).join("\n");

  assert.match(prose, /Desktop Lane/);
  assert.match(prose, /Mail Lane/);
  assert.match(prose, /Message Lane/);
  assert.doesNotMatch(prose, /DesktopBee/);
  assert.doesNotMatch(prose, /TermBee/);
  assert.doesNotMatch(prose, /MailBee/);
  assert.doesNotMatch(prose, /MessageBee/);
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "desktop_action"));
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "mail_send"));
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "message_send"));
  // The advertised surface no longer carries bee-branded ids.
  assert.ok(!LANE_TOOL_DEFINITIONS.some((t) => /bee_|bee$/.test(t.function.name)));
});

// PIM tools ride the "brain" capability — local osascript, present in every mode.
const PIM_NAMES = ["calendar_create", "calendar_today", "contacts_lookup", "reminder_create", "reminders_list"];
// Goals tools ride the "brain" capability too — local SQLite, present in every mode.
const GOALS_NAMES = ["goals_list", "goal_upsert", "goal_checkin", "daily_review"];

test("cloud-ok advertises every lane (web, browser, desktop, mail, message, brain, skill, digest, pim, goals)", () => {
  assert.deepEqual(names(availableLaneTools(cloud())),
    ["brain_search", "brain_read", ...PIM_NAMES, ...GOALS_NAMES, "code_graph", "coo_dispatch", "desktop_action", "digest_url", "hivematrix_browser", "mail_draft", "mail_send", "message_send", "skill_used", "skill_run", "workflow_inbox"].sort());
});

test("digest_url is web-gated: absent offline (no internet to fetch)", () => {
  assert.ok(!names(availableLaneTools(offline())).includes("digest_url"));
  assert.ok(!names(availableLaneTools(local())).includes("digest_url"));
});

test("local-only drops web lanes but keeps Desktop Lane + outbound channels + brain/skill/codegraph/pim/goals + COO routing", () => {
  assert.deepEqual(names(availableLaneTools(local())),
    ["brain_search", "brain_read", ...PIM_NAMES, ...GOALS_NAMES, "code_graph", "coo_dispatch", "desktop_action", "mail_draft", "mail_send", "message_send", "skill_used", "skill_run", "workflow_inbox"].sort());
});

test("offline keeps the offline workhorses + outbound channels + brain/skill/codegraph/pim/goals + COO routing (all local)", () => {
  assert.deepEqual(names(availableLaneTools(offline())),
    ["brain_search", "brain_read", ...PIM_NAMES, ...GOALS_NAMES, "code_graph", "coo_dispatch", "desktop_action", "mail_draft", "mail_send", "message_send", "skill_used", "skill_run", "workflow_inbox"].sort());
});

test("capabilityRoutingGuide lists email/message/brain lanes in cloud, drops web lanes offline", () => {
  const cloudGuide = capabilityRoutingGuide(cloud());
  assert.match(cloudGuide, /mail_send/);
  assert.match(cloudGuide, /message_send/);
  assert.match(cloudGuide, /brain_search/);
  assert.match(cloudGuide, /brain_read/);
  assert.match(cloudGuide, /hivematrix_browser/);
  assert.doesNotMatch(cloudGuide, /webbee_search/);
  assert.doesNotMatch(cloudGuide, /browserbee_run/);
  assert.match(cloudGuide, /do not improvise/i);

  const offlineGuide = capabilityRoutingGuide(offline());
  assert.match(offlineGuide, /mail_send/);   // still routable offline
  assert.match(offlineGuide, /brain_search/);   // brain is local, still routable
  assert.doesNotMatch(offlineGuide, /hivematrix_browser/); // browser lane gone offline
});

test("executeLaneTool refuses an unknown lane tool", async () => {
  const out = await executeLaneTool("nopebee", {}, { projectPath: "/tmp", project: "ops", requestedBy: "test" });
  assert.match(out, /Unknown lane tool/);
});

test("executeLaneTool: brain_read returns a doc's full content for a valid in-root path", async () => {
  mkdirSync(SKILL_BRAIN, { recursive: true });
  writeFileSync(join(SKILL_BRAIN, "goals.md"), "# Goals\nShip the thing.");
  const out = await executeLaneTool("brain_read", { path: "goals.md" }, ctx());
  assert.match(out, /Ship the thing/);
});

test("executeLaneTool: brain_read rejects a `..` escape from the brain root", async () => {
  const out = await executeLaneTool("brain_read", { path: "../../../../etc/passwd" }, ctx());
  assert.match(out, /Error:.*escapes the brain root/);
});

test("executeLaneTool: brain_read requires a path", async () => {
  const out = await executeLaneTool("brain_read", {}, ctx());
  assert.match(out, /'path' is required for brain_read/);
});

test("isLaneTool recognizes all four goals tools", () => {
  assert.equal(isLaneTool("goals_list"), true);
  assert.equal(isLaneTool("goal_upsert"), true);
  assert.equal(isLaneTool("goal_checkin"), true);
  assert.equal(isLaneTool("daily_review"), true);
});

test("executeLaneTool: goals_list reports no active goals in a fresh store", async () => {
  const out = await executeLaneTool("goals_list", {}, ctx());
  assert.match(out, /No active goals yet/);
});

test("executeLaneTool: goal_upsert creates a goal, then goals_list shows it", async () => {
  const created = await executeLaneTool("goal_upsert", { title: "Run 5k", category: "health", cadence: "weekly" }, ctx());
  assert.match(created, /Created goal "Run 5k"/);

  const listed = await executeLaneTool("goals_list", {}, ctx());
  assert.match(listed, /Run 5k/);
  assert.match(listed, /health/);
});

test("executeLaneTool: goals_list surfaces description + target so a nudge can propose a next step", async () => {
  await executeLaneTool("goal_upsert", {
    title: "Pass the annuities exam",
    category: "income",
    cadence: "weekly",
    target: "70% on a practice exam",
    description: "Ohio combined Life + A&H license — study 30 min/day, sit a practice exam weekly",
  }, ctx());
  const listed = await executeLaneTool("goals_list", {}, ctx());
  assert.match(listed, /Pass the annuities exam/);
  assert.match(listed, /target: 70% on a practice exam/, "target is shown so the model knows 'done' looks like what");
  assert.match(listed, /Ohio combined Life/, "description gives the model enough to propose a concrete next step");
});

test("executeLaneTool: goal_upsert stores a next action and goals_list surfaces it as the step to take", async () => {
  await executeLaneTool("goal_upsert", {
    title: "Ship the AI-consulting site",
    category: "income",
    nextAction: "draft the landing-page hero copy",
  }, ctx());
  const listed = await executeLaneTool("goals_list", {}, ctx());
  assert.match(listed, /→ next: draft the landing-page hero copy/, "the explicit next step is surfaced for a nudge");
});

test("executeLaneTool: goal_checkin resolves by fuzzy title and records progress", async () => {
  await executeLaneTool("goal_upsert", { title: "Italian practice", cadence: "daily" }, ctx());
  const out = await executeLaneTool("goal_checkin", { goal: "italian", note: "20 minutes on Duolingo" }, ctx());
  assert.match(out, /Logged progress on "Italian practice"/);
  assert.match(out, /20 minutes on Duolingo/);
});

test("executeLaneTool: goal_checkin reports no match instead of guessing", async () => {
  const out = await executeLaneTool("goal_checkin", { goal: "a goal that does not exist anywhere" }, ctx());
  assert.match(out, /no goal matching/);
  assert.match(out, /goals_list/);
});

test("executeLaneTool: daily_review reflects a freshly upserted, never-checked-in goal as due", async () => {
  await executeLaneTool("goal_upsert", { title: "Daily review target goal", cadence: "daily" }, ctx());
  const out = await executeLaneTool("daily_review", {}, ctx());
  assert.match(out, /Daily review target goal/);
});

test("executeLaneTool rejects removed BrowserBee/WebBee aliases", async () => {
  assert.match(
    await executeLaneTool("webbee_search", { query: "x" }, { projectPath: "/tmp", project: "ops", requestedBy: "test" }),
    /Unknown lane tool/,
  );
  assert.match(
    await executeLaneTool("browserbee_run", { objective: "x" }, { projectPath: "/tmp", project: "ops", requestedBy: "test" }),
    /Unknown lane tool/,
  );
});

// ── Outbound safety: the trust/allowlist gate lives inside the tool ───────────

function mailIO(over: Partial<MailBeeSendIO> & { trusted: boolean }): { io: MailBeeSendIO; calls: string[] } {
  const calls: string[] = [];
  const io: MailBeeSendIO = {
    isChannelEnabled: () => true,
    isTrustedRecipient: () => over.trusted,
    sendMail: async () => { calls.push("send"); return true; },
    draftMail: async () => { calls.push("draft"); return true; },
    ...over,
  };
  return { io, calls };
}

test("mailbee_send SENDS to a trusted recipient", async () => {
  const { io, calls } = mailIO({ trusted: true });
  const out = await executeMailBeeSend({ to: "boss@known.com", subject: "Hi", body: "yo" }, io);
  assert.deepEqual(calls, ["send"]);
  assert.match(out, /Email sent to boss@known.com/);
});

test("mailbee_send DRAFTS (does not send) for an untrusted recipient", async () => {
  const { io, calls } = mailIO({ trusted: false });
  const out = await executeMailBeeSend({ to: "stranger@nope.com", subject: "Hi", body: "yo" }, io);
  assert.deepEqual(calls, ["draft"]); // crucially NOT "send"
  assert.match(out, /not on the Mail Lane trusted allowlist/);
  assert.doesNotMatch(out, /MailBee/);
  assert.match(out, /saved to Mail Drafts/);
  // Default autonomy (standard) shouldn't mention the dial at all.
  assert.doesNotMatch(out, /autonomy/i);
});

test("mailbee_send still DRAFTS (does not send) to an untrusted recipient under autonomous autonomy — the allowlist is a hard floor, not the dial", async () => {
  setAutonomyLevel("autonomous");
  const { io, calls } = mailIO({ trusted: false });
  const out = await executeMailBeeSend({ to: "stranger@nope.com", subject: "Hi", body: "yo" }, io);
  assert.deepEqual(calls, ["draft"]); // crucially NOT "send" — autonomy never bypasses the allowlist floor
  assert.match(out, /not on the Mail Lane trusted allowlist/);
  // The message should name the allowlist (not the autonomy dial) as the blocker.
  assert.match(out, /autonomy is set to autonomous/i);
  assert.match(out, /hard safety floor/i);
  assert.match(out, /autonomy dial does not bypass/i);
});

test("mailbee_send requires to + body", async () => {
  const { io, calls } = mailIO({ trusted: true });
  const out = await executeMailBeeSend({ to: "", subject: "x", body: "y" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /'to' and 'body' are required/);
});

test("mailbee_send refuses while Mail Lane is disabled before send or draft IO", async () => {
  const { io, calls } = mailIO({ trusted: true, isChannelEnabled: () => false });
  const out = await executeMailBeeSend({ to: "boss@known.com", subject: "Hi", body: "yo" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /Mail Lane is disabled/i);
});

test("mailbee_draft never sends, always drafts", async () => {
  const { io, calls } = mailIO({ trusted: true });
  const out = await executeMailBeeDraft({ to: "anyone@x.com", subject: "x", body: "y" }, io);
  assert.deepEqual(calls, ["draft"]);
  assert.match(out, /Draft saved to Mail Drafts/);
});

test("mailbee_draft refuses while Mail Lane is disabled before draft IO", async () => {
  const { io, calls } = mailIO({ trusted: true, isChannelEnabled: () => false });
  const out = await executeMailBeeDraft({ to: "anyone@x.com", subject: "x", body: "y" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /Mail Lane is disabled/i);
});

test("mailbee_send forwards attachments to Apple Mail (no Gmail needed)", async () => {
  let gotAttachments: string[] | undefined;
  const io: MailBeeSendIO = {
    isChannelEnabled: () => true,
    isTrustedRecipient: () => true,
    sendMail: async (_t, _s, _b, att) => { gotAttachments = att; return true; },
    draftMail: async () => true,
  };
  const out = await executeMailBeeSend(
    { to: "boss@known.com", subject: "files", body: "here", attachments: ["/a/x.png", "/a/y.png"] },
    io,
  );
  assert.deepEqual(gotAttachments, ["/a/x.png", "/a/y.png"]);
  assert.match(out, /with 2 attachment\(s\)/);
});

test("readAttachments accepts an array or a comma/newline list", async () => {
  const { readAttachments } = await import("./bee-tools");
  assert.deepEqual(readAttachments({ attachments: ["/a", "/b"] }), ["/a", "/b"]);
  assert.deepEqual(readAttachments({ attachment: "/a, /b\n/c" }), ["/a", "/b", "/c"]);
  assert.deepEqual(readAttachments({}), []);
});

function msgIO(allowed: boolean): { io: MessageBeeSendIO; calls: string[] } {
  const calls: string[] = [];
  const io: MessageBeeSendIO = {
    isSelf: () => false,
    isAllowed: () => allowed,
    sendIMessage: async () => { calls.push("send"); return true; },
    recordOutbound: () => { calls.push("record"); },
  };
  return { io, calls };
}

test("messagebee_send sends to an allowlisted handle and records outbound", async () => {
  const { io, calls } = msgIO(true);
  const out = await executeMessageBeeSend({ to: "+14155551234", text: "hi" }, io);
  assert.deepEqual(calls, ["send", "record"]);
  assert.match(out, /Message sent to \+14155551234/);
});

test("messagebee_send refuses a non-allowlisted handle (no send)", async () => {
  const { io, calls } = msgIO(false);
  const out = await executeMessageBeeSend({ to: "+19998887777", text: "hi" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /not on the Message Lane allowlist/);
  assert.doesNotMatch(out, /MessageBee/);
  // Default autonomy (standard) shouldn't mention the dial at all.
  assert.doesNotMatch(out, /autonomy/i);
});

test("messagebee_send still refuses a non-allowlisted handle under autonomous autonomy — the allowlist is a hard floor, not the dial", async () => {
  setAutonomyLevel("autonomous");
  const { io, calls } = msgIO(false);
  const out = await executeMessageBeeSend({ to: "+19998887777", text: "hi" }, io);
  assert.deepEqual(calls, []); // crucially no send — autonomy never bypasses the allowlist floor
  assert.match(out, /not on the Message Lane allowlist/);
  assert.match(out, /autonomy is set to autonomous/i);
  assert.match(out, /hard safety floor/i);
  assert.match(out, /autonomy dial does not bypass/i);
});

test("messagebee_send refuses while Message Lane is disabled before sending", async () => {
  const calls: string[] = [];
  const io: MessageBeeSendIO = {
    isChannelEnabled: () => false,
    isAllowed: () => { calls.push("allow"); return true; },
    sendIMessage: async () => { calls.push("send"); return true; },
    recordOutbound: () => { calls.push("record"); },
  };
  const out = await executeMessageBeeSend({ to: "+14155551234", text: "hi" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /Message Lane is disabled/i);
});

test("messagebee_send refuses a configured self handle before allowlist/send", async () => {
  const calls: string[] = [];
  const io: MessageBeeSendIO = {
    isSelf: () => true,
    isAllowed: () => { calls.push("allow"); return true; },
    sendIMessage: async () => { calls.push("send"); return true; },
    recordOutbound: () => { calls.push("record"); },
  };
  const out = await executeMessageBeeSend({ to: "+14155551234", text: "standby" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /self handle/i);
  assert.match(out, /loop/i);
});

test("messagebee_send forwards a voice-note attachment with no text required", async () => {
  let gotAttachments: string[] | undefined;
  const io: MessageBeeSendIO = {
    isSelf: () => false,
    isAllowed: () => true,
    sendIMessage: async (_h, _t, attachments) => { gotAttachments = attachments; return true; },
    recordOutbound: () => {},
  };
  const out = await executeMessageBeeSend({ to: "+14155551234", attachments: ["/tmp/voice-x.m4a"] }, io);
  assert.deepEqual(gotAttachments, ["/tmp/voice-x.m4a"]);
  assert.match(out, /with 1 attachment/);
});

test("messagebee_send requires either text or an attachment", async () => {
  const { io, calls } = msgIO(true);
  const out = await executeMessageBeeSend({ to: "+14155551234" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /required/);
});

// ── skill_run: run a skill from the library live, in this turn ───────────────

test("skill_run requires a name", async () => {
  const out = await executeLaneTool("skill_run", {}, ctx());
  assert.match(out, /'name'.*required/);
});

test("skill_run errors on an unknown skill name", async () => {
  const out = await executeLaneTool("skill_run", { name: "Totally Made Up Skill" }, ctx());
  assert.match(out, /no skill named "Totally Made Up Skill"/);
});

test("skill_run: instruction skill returns the body (params substituted) and records a use", async () => {
  await upsertSkill({ name: "Greet Someone", description: "d", body: "Say hello to {{who}}.", source: "test" });
  const out = await executeLaneTool("skill_run", { name: "Greet Someone", params: { who: "Ada" } }, ctx());
  assert.match(out, /Greet Someone/);
  assert.match(out, /Say hello to Ada\./);
  const s = await readSkill("Greet Someone");
  assert.equal(s?.useCount, 1);
});

test("skill_run: trusted script skill runs in the sandbox and returns stdout; records a use", async () => {
  await upsertSkill({ name: "Echo Hello", description: "d", body: "echo hello", source: "test", kind: "script", trusted: true });
  const out = await executeLaneTool("skill_run", { name: "Echo Hello" }, ctx());
  assert.match(out, /hello/);
  const s = await readSkill("Echo Hello");
  assert.equal(s?.useCount, 1);
  assert.equal(s?.failures, 0);
});

test("skill_run: untrusted, non-probation script skill is refused and NOT run", async () => {
  await upsertSkill({ name: "Untrusted Script", description: "d", body: "echo should-not-run", source: "test", kind: "script", trusted: false });
  const out = await executeLaneTool("skill_run", { name: "Untrusted Script" }, ctx());
  assert.match(out, /untrusted script/i);
  assert.match(out, /Trust it in the Skills view|probation/i);
  const s = await readSkill("Untrusted Script");
  assert.equal(s?.useCount, 0);
  assert.equal(s?.failures, 0);
});

test("skill_run: probationary script skill runs AND the reply is prefixed with the learned-recently announcement", async () => {
  await upsertSkill({ name: "Probation Script", description: "d", body: "echo probationary-output", source: "test", kind: "script", trusted: false, probation: true });
  const out = await executeLaneTool("skill_run", { name: "Probation Script" }, ctx());
  assert.match(out, /\(using a skill I learned recently\)/);
  assert.match(out, /probationary-output/);
  const s = await readSkill("Probation Script");
  assert.equal(s?.useCount, 1);
});

test("skill_run: scanVerdict block refuses a script skill without running it", async () => {
  await upsertSkill({ name: "Blocked Script", description: "d", body: "echo nope", source: "test", kind: "script", trusted: true, scanVerdict: "block" });
  const out = await executeLaneTool("skill_run", { name: "Blocked Script" }, ctx());
  assert.match(out, /blocked by the content scanner/);
  const s = await readSkill("Blocked Script");
  assert.equal(s?.useCount, 0);
  assert.equal(s?.failures, 0);
});

test("skill_run: a failing script gets an honest failure reply and increments failures", async () => {
  await upsertSkill({ name: "Failing Script", description: "d", body: "exit 3", source: "test", kind: "script", trusted: true });
  const out = await executeLaneTool("skill_run", { name: "Failing Script" }, ctx());
  assert.match(out, /fail/i);
  assert.match(out, /3/);
  const s = await readSkill("Failing Script");
  assert.equal(s?.useCount, 0);
  assert.equal(s?.failures, 1);
});
