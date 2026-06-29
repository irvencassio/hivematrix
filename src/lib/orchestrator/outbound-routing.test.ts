import test from "node:test";
import assert from "node:assert/strict";
import { parseOutboundFields, outboundHttpRoutingPrompt, brainSearchRoutingPrompt, beeToolsRoutingPrompt } from "./outbound-routing";

test("parseOutboundFields reads form-urlencoded (the curl --data-urlencode shape)", () => {
  const raw = "to=bob%40x.com&subject=Hi%20there&body=line1%0Aline2";
  const f = parseOutboundFields("application/x-www-form-urlencoded", raw);
  assert.equal(f.to, "bob@x.com");
  assert.equal(f.subject, "Hi there");
  assert.equal(f.body, "line1\nline2");
});

test("parseOutboundFields reads JSON bodies", () => {
  const f = parseOutboundFields("application/json", JSON.stringify({ to: "a@b.com", subject: "S", body: "B" }));
  assert.deepEqual({ to: f.to, subject: f.subject, body: f.body }, { to: "a@b.com", subject: "S", body: "B" });
});

test("parseOutboundFields reads the messagebee 'text' field", () => {
  const f = parseOutboundFields("application/x-www-form-urlencoded", "to=%2B14155551234&text=hello");
  assert.equal(f.to, "+14155551234");
  assert.equal(f.text, "hello");
});

test("parseOutboundFields falls back to urlencoded when content-type is missing", () => {
  // curl --data-urlencode defaults to urlencoded; tolerate a missing/odd header.
  const f = parseOutboundFields(undefined, "to=a%40b.com&subject=x&body=y");
  assert.equal(f.to, "a@b.com");
  assert.equal(f.body, "y");
});

test("parseOutboundFields returns empty object on junk", () => {
  assert.deepEqual(parseOutboundFields("application/json", "not json at all {{{"), {});
});

test("outboundHttpRoutingPrompt names the endpoints, the token, and gates SENDING when Mail Lane is enabled", () => {
  const p = outboundHttpRoutingPrompt("3999", { mailLaneEnabled: true });
  assert.match(p, /\/mailbee\/send/);
  assert.match(p, /\/mailbee\/draft/);
  assert.match(p, /\/messagebee\/send/);
  assert.match(p, /127\.0\.0\.1:3999/);
  assert.match(p, /~\/\.hivematrix\/auth-token/);
  assert.match(p, /SENDING .* MUST go through the local HiveMatrix daemon/);
  assert.match(p, /data-urlencode/);
});

test("outboundHttpRoutingPrompt affirms the capability and forbids the 'no SMS tool / send it yourself' denial", () => {
  // Regression: a Claude-harness task that should have texted a result instead
  // said "No SMS tool available in this setup" and told the user to send it
  // themselves — a false denial of an existing, allowlisted Message Lane channel.
  const p = outboundHttpRoutingPrompt("3999", { mailLaneEnabled: true });
  assert.match(p, /You CAN send email and SMS\/iMessage/i);
  assert.match(p, /NEVER tell the user that no email\/SMS tool is available/i);
  assert.match(p, /send it themselves/i);
});

test("outboundHttpRoutingPrompt covers email management, attachments, and forbids interactive auth", () => {
  const p = outboundHttpRoutingPrompt("3999", { mailLaneEnabled: true });
  // Managing email = local Apple Mail, never a Gmail MCP.
  assert.match(p, /Reading & managing email/);
  assert.match(p, /do NOT use a Gmail\/Google MCP/i);
  assert.match(p, /Trash mailbox \(recoverable\)/);
  // Sending files via Mail Lane attachments — no external account.
  assert.match(p, /attachment=\/ABSOLUTE\/PATH/);
  assert.match(p, /do NOT need Gmail/i);
  assert.match(p, /Mail Lane attaches them through Apple Mail/);
  assert.doesNotMatch(p, /MailBee/);
  assert.doesNotMatch(p, /MessageBee/);
  // Never tell the user to run /mcp (headless daemon).
  assert.match(p, /never ask for interactive auth/i);
  assert.match(p, /NEVER tell the user to run `\/mcp`/);
});

test("outboundHttpRoutingPrompt omits Mail Lane instructions when Mail Lane is disabled", () => {
  const p = outboundHttpRoutingPrompt("3999", { mailLaneEnabled: false });
  assert.match(p, /Mail Lane is disabled/i);
  assert.match(p, /\/messagebee\/send/);
  assert.doesNotMatch(p, /\/mailbee\/send/);
  assert.doesNotMatch(p, /\/mailbee\/draft/);
  assert.doesNotMatch(p, /Reading & managing email/);
  assert.doesNotMatch(p, /drive the local Apple Mail app directly/i);
  assert.doesNotMatch(p, /Mail Lane attaches them through Apple Mail/);
});

test("outboundHttpRoutingPrompt omits Message Lane instructions when Message Lane is disabled", () => {
  const p = outboundHttpRoutingPrompt("3999", { messageLaneEnabled: false });
  assert.match(p, /Message Lane is disabled/i);
  assert.match(p, /\/mailbee\/send/);
  assert.doesNotMatch(p, /\/messagebee\/send/);
  assert.doesNotMatch(p, /Send an SMS\/iMessage/);
});

test("outboundHttpRoutingPrompt omits both outbound lanes when both are disabled", () => {
  const p = outboundHttpRoutingPrompt("3999", { mailLaneEnabled: false, messageLaneEnabled: false });
  assert.match(p, /Mail Lane is disabled/i);
  assert.match(p, /Message Lane is disabled/i);
  assert.doesNotMatch(p, /\/mailbee\/send/);
  assert.doesNotMatch(p, /\/mailbee\/draft/);
  assert.doesNotMatch(p, /\/messagebee\/send/);
});

test("parseOutboundFields collects attachments (form-repeated + JSON array)", () => {
  const form = parseOutboundFields(
    "application/x-www-form-urlencoded",
    "to=a@b.com&subject=s&body=hi&attachment=%2Fa%2Fx.png&attachment=%2Fa%2Fy.png",
  );
  assert.deepEqual(form.attachments, ["/a/x.png", "/a/y.png"]);
  const json = parseOutboundFields("application/json", JSON.stringify({ to: "a@b.com", body: "hi", attachments: ["/p/1", "/p/2"] }));
  assert.deepEqual(json.attachments, ["/p/1", "/p/2"]);
  // none → undefined (not an empty array that downstream must special-case)
  assert.equal(parseOutboundFields("application/json", '{"to":"a@b.com","body":"hi"}').attachments, undefined);
});

test("brainSearchRoutingPrompt points at the /brain/search endpoint with auth", () => {
  const p = brainSearchRoutingPrompt("3999");
  assert.match(p, /\/brain\/search\?q=/);
  assert.match(p, /127\.0\.0\.1:3999/);
  assert.match(p, /~\/\.hivematrix\/auth-token/);
  assert.match(p, /durable memory|brain/i);
});

test("beeToolsRoutingPrompt routes browser through /lane/browser and keeps other lanes explicit", () => {
  const p = beeToolsRoutingPrompt("3999");
  assert.match(p, /\/lane\/browser/);
  assert.match(p, /\/bee\/<tool>/);
  assert.match(p, /"mode":"search"/);
  assert.match(p, /"mode":"workflow"/);
  assert.doesNotMatch(p, /webbee_search/);
  assert.doesNotMatch(p, /browserbee_run/);
  assert.match(p, /desktop_action/);
  assert.match(p, /terminal_run/);
  assert.match(p, /Desktop Lane/);
  assert.match(p, /Terminal Lane/);
  assert.doesNotMatch(p, /DesktopBee/);
  assert.doesNotMatch(p, /TermBee/);
  assert.match(p, /HiveMatrix-owned persistent shell/i);
  assert.match(p, /Do NOT pass passwords or secrets/i);
  // Terminal Lane is the canonical lane for shell/SSH; explicit requests must use it.
  assert.match(p, /Terminal Lane is the canonical/i);
  assert.match(p, /explicit(ly)?[^\n]*Terminal Lane[^\n]*HiveMatrix/i);
  // Canopy may be named ONLY as an optional/legacy backend — never the default.
  assert.match(p, /Canopy[^\n]*(legacy|optional)/i);
  assert.doesNotMatch(p, /Canopy is the preferred|prefer Canopy|use Canopy by default/i);
  assert.match(p, /127\.0\.0\.1:3999/);
  assert.match(p, /do NOT improvise/i);
});
