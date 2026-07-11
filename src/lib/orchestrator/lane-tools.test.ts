import test from "node:test";
import assert from "node:assert/strict";
import { ConnectivityPolicy } from "@/lib/connectivity/policy";
import {
  isLaneTool, availableLaneTools, executeLaneTool, LANE_TOOL_DEFINITIONS, resolveLaneToolName,
  capabilityRoutingGuide, executeMailBeeSend, executeMailBeeDraft, executeMessageBeeSend,
  type MailBeeSendIO, type MessageBeeSendIO,
} from "./lane-tools";

function cloud() { return new ConnectivityPolicy(); }
function local() { const p = new ConnectivityPolicy(); p.setManualOverride("local-only"); return p; }
function offline() { const p = new ConnectivityPolicy(); p.setManualOverride("offline"); return p; }

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
  assert.equal(isLaneTool("skill_used"), true);
  assert.equal(isLaneTool("digest_url"), true);
  assert.equal(isLaneTool("code_graph"), true);
  assert.equal(isLaneTool("bash"), false);
  assert.equal(isLaneTool("read_file"), false);
});

test("resolveLaneToolName maps legacy bee ids to their lane-native handler names", () => {
  assert.equal(resolveLaneToolName("desktopbee_action"), "desktop_action");
  assert.equal(resolveLaneToolName("termbee_session"), "terminal_session");
  assert.equal(resolveLaneToolName("termbee_run"), "terminal_run");
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
  assert.equal(isLaneTool("terminal_run"), true);
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
  assert.equal(LANE_TOOL_DEFINITIONS.length, 18); // 13 lanes + 5 PIM tools
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
  assert.match(prose, /Terminal Lane/);
  assert.match(prose, /Mail Lane/);
  assert.match(prose, /Message Lane/);
  assert.doesNotMatch(prose, /DesktopBee/);
  assert.doesNotMatch(prose, /TermBee/);
  assert.doesNotMatch(prose, /MailBee/);
  assert.doesNotMatch(prose, /MessageBee/);
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "desktop_action"));
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "terminal_run"));
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "mail_send"));
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "message_send"));
  // The advertised surface no longer carries bee-branded ids.
  assert.ok(!LANE_TOOL_DEFINITIONS.some((t) => /bee_|bee$/.test(t.function.name)));
});

test("Terminal Lane tool descriptions identify a HiveMatrix-owned session (no external provider)", () => {
  const termRun = LANE_TOOL_DEFINITIONS.find((t) => t.function.name === "terminal_run");
  const termSession = LANE_TOOL_DEFINITIONS.find((t) => t.function.name === "terminal_session");
  assert.match(termRun?.function.description ?? "", /HiveMatrix-owned/i);
  assert.match(termSession?.function.description ?? "", /HiveMatrix-owned/i);
  assert.doesNotMatch(termRun?.function.description ?? "", /Canopy/i);
  assert.doesNotMatch(termSession?.function.description ?? "", /Canopy/i);
});

// PIM tools ride the "brain" capability — local osascript, present in every mode.
const PIM_NAMES = ["calendar_create", "calendar_today", "contacts_lookup", "reminder_create", "reminders_list"];

test("cloud-ok advertises every lane (web, browser, desktop, term, mail, message, brain, skill, digest, pim)", () => {
  assert.deepEqual(names(availableLaneTools(cloud())),
    ["brain_search", ...PIM_NAMES, "code_graph", "coo_dispatch", "desktop_action", "digest_url", "hivematrix_browser", "mail_draft", "mail_send", "message_send", "skill_used", "terminal_run", "terminal_session", "workflow_inbox"].sort());
});

test("digest_url is web-gated: absent offline (no internet to fetch)", () => {
  assert.ok(!names(availableLaneTools(offline())).includes("digest_url"));
  assert.ok(!names(availableLaneTools(local())).includes("digest_url"));
});

test("local-only drops web lanes but keeps Desktop Lane/Terminal Lane + outbound channels + brain/skill/codegraph/pim + COO routing", () => {
  assert.deepEqual(names(availableLaneTools(local())),
    ["brain_search", ...PIM_NAMES, "code_graph", "coo_dispatch", "desktop_action", "mail_draft", "mail_send", "message_send", "skill_used", "terminal_run", "terminal_session", "workflow_inbox"].sort());
});

test("offline keeps the offline workhorses + outbound channels + brain/skill/codegraph/pim + COO routing (all local)", () => {
  assert.deepEqual(names(availableLaneTools(offline())),
    ["brain_search", ...PIM_NAMES, "code_graph", "coo_dispatch", "desktop_action", "mail_draft", "mail_send", "message_send", "skill_used", "terminal_run", "terminal_session", "workflow_inbox"].sort());
});

test("capabilityRoutingGuide lists email/message/brain lanes in cloud, drops web lanes offline", () => {
  const cloudGuide = capabilityRoutingGuide(cloud());
  assert.match(cloudGuide, /mail_send/);
  assert.match(cloudGuide, /message_send/);
  assert.match(cloudGuide, /brain_search/);
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
