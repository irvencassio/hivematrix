import test from "node:test";
import assert from "node:assert/strict";
import { ConnectivityPolicy } from "@/lib/connectivity/policy";
import {
  isBeeTool, availableBeeTools, executeBeeTool, BEE_TOOL_DEFINITIONS,
  capabilityRoutingGuide, executeMailBeeSend, executeMailBeeDraft, executeMessageBeeSend,
  type MailBeeSendIO, type MessageBeeSendIO,
} from "./bee-tools";

function cloud() { return new ConnectivityPolicy(); }
function local() { const p = new ConnectivityPolicy(); p.setManualOverride("local-only"); return p; }
function offline() { const p = new ConnectivityPolicy(); p.setManualOverride("offline"); return p; }

const names = (tools: { function: { name: string } }[]) => tools.map((t) => t.function.name).sort();

test("isBeeTool recognizes active lane tools and rejects removed browser aliases", () => {
  assert.equal(isBeeTool("hivematrix_browser"), true);
  assert.equal(isBeeTool("webbee_search"), false);
  assert.equal(isBeeTool("browserbee_run"), false);
  assert.equal(isBeeTool("desktopbee_action"), true);
  assert.equal(isBeeTool("mailbee_send"), true);
  assert.equal(isBeeTool("mailbee_draft"), true);
  assert.equal(isBeeTool("messagebee_send"), true);
  assert.equal(isBeeTool("brain_search"), true);
  assert.equal(isBeeTool("skill_used"), true);
  assert.equal(isBeeTool("digest_url"), true);
  assert.equal(isBeeTool("code_graph"), true);
  assert.equal(isBeeTool("bash"), false);
  assert.equal(isBeeTool("read_file"), false);
});

test("all bee tools are defined with required schemas", () => {
  assert.equal(BEE_TOOL_DEFINITIONS.length, 11);
  for (const t of BEE_TOOL_DEFINITIONS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name.length > 0);
    assert.ok(t.function.description.length > 0);
    assert.ok(t.function.parameters);
  }
});

test("lane tool descriptions use lane names while keeping compatibility tool ids", () => {
  const prose = BEE_TOOL_DEFINITIONS.map((t) => JSON.stringify({
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
  assert.ok(BEE_TOOL_DEFINITIONS.some((t) => t.function.name === "desktopbee_action"));
  assert.ok(BEE_TOOL_DEFINITIONS.some((t) => t.function.name === "termbee_run"));
  assert.ok(BEE_TOOL_DEFINITIONS.some((t) => t.function.name === "mailbee_send"));
  assert.ok(BEE_TOOL_DEFINITIONS.some((t) => t.function.name === "messagebee_send"));
});

test("Terminal Lane tool descriptions identify Canopy as the preferred provider", () => {
  const termRun = BEE_TOOL_DEFINITIONS.find((t) => t.function.name === "termbee_run");
  const termSession = BEE_TOOL_DEFINITIONS.find((t) => t.function.name === "termbee_session");
  assert.match(termRun?.function.description ?? "", /Canopy-backed/i);
  assert.match(termSession?.function.description ?? "", /Canopy-backed/i);
});

test("cloud-ok advertises every lane (web, browser, desktop, term, mail, message, brain, skill, digest)", () => {
  assert.deepEqual(names(availableBeeTools(cloud())),
    ["brain_search", "code_graph", "desktopbee_action", "digest_url", "hivematrix_browser", "mailbee_draft", "mailbee_send", "messagebee_send", "skill_used", "termbee_run", "termbee_session"]);
});

test("digest_url is web-gated: absent offline (no internet to fetch)", () => {
  assert.ok(!names(availableBeeTools(offline())).includes("digest_url"));
  assert.ok(!names(availableBeeTools(local())).includes("digest_url"));
});

test("local-only drops web lanes but keeps Desktop Lane/Terminal Lane + outbound channels + brain/skill/codegraph", () => {
  assert.deepEqual(names(availableBeeTools(local())),
    ["brain_search", "code_graph", "desktopbee_action", "mailbee_draft", "mailbee_send", "messagebee_send", "skill_used", "termbee_run", "termbee_session"]);
});

test("offline keeps the offline workhorses + outbound channels + brain/skill/codegraph (all local)", () => {
  assert.deepEqual(names(availableBeeTools(offline())),
    ["brain_search", "code_graph", "desktopbee_action", "mailbee_draft", "mailbee_send", "messagebee_send", "skill_used", "termbee_run", "termbee_session"]);
});

test("capabilityRoutingGuide lists email/message/brain lanes in cloud, drops web lanes offline", () => {
  const cloudGuide = capabilityRoutingGuide(cloud());
  assert.match(cloudGuide, /mailbee_send/);
  assert.match(cloudGuide, /messagebee_send/);
  assert.match(cloudGuide, /brain_search/);
  assert.match(cloudGuide, /hivematrix_browser/);
  assert.doesNotMatch(cloudGuide, /webbee_search/);
  assert.doesNotMatch(cloudGuide, /browserbee_run/);
  assert.match(cloudGuide, /do not improvise/i);

  const offlineGuide = capabilityRoutingGuide(offline());
  assert.match(offlineGuide, /mailbee_send/);   // still routable offline
  assert.match(offlineGuide, /brain_search/);   // brain is local, still routable
  assert.doesNotMatch(offlineGuide, /hivematrix_browser/); // browser lane gone offline
});

test("executeBeeTool refuses an unknown bee tool", async () => {
  const out = await executeBeeTool("nopebee", {}, { projectPath: "/tmp", project: "ops", requestedBy: "test" });
  assert.match(out, /Unknown bee tool/);
});

test("executeBeeTool rejects removed BrowserBee/WebBee aliases", async () => {
  assert.match(
    await executeBeeTool("webbee_search", { query: "x" }, { projectPath: "/tmp", project: "ops", requestedBy: "test" }),
    /Unknown bee tool/,
  );
  assert.match(
    await executeBeeTool("browserbee_run", { objective: "x" }, { projectPath: "/tmp", project: "ops", requestedBy: "test" }),
    /Unknown bee tool/,
  );
});

// ── Outbound safety: the trust/allowlist gate lives inside the tool ───────────

function mailIO(over: Partial<MailBeeSendIO> & { trusted: boolean }): { io: MailBeeSendIO; calls: string[] } {
  const calls: string[] = [];
  const io: MailBeeSendIO = {
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

test("mailbee_draft never sends, always drafts", async () => {
  const { io, calls } = mailIO({ trusted: true });
  const out = await executeMailBeeDraft({ to: "anyone@x.com", subject: "x", body: "y" }, io);
  assert.deepEqual(calls, ["draft"]);
  assert.match(out, /Draft saved to Mail Drafts/);
});

test("mailbee_send forwards attachments to Apple Mail (no Gmail needed)", async () => {
  let gotAttachments: string[] | undefined;
  const io: MailBeeSendIO = {
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

test("messagebee_send forwards a voice-note attachment with no text required", async () => {
  let gotAttachments: string[] | undefined;
  const io: MessageBeeSendIO = {
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
