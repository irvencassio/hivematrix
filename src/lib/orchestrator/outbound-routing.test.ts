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

test("outboundHttpRoutingPrompt names the endpoints, the token, and forbids osascript", () => {
  const p = outboundHttpRoutingPrompt("3999");
  assert.match(p, /\/mailbee\/send/);
  assert.match(p, /\/mailbee\/draft/);
  assert.match(p, /\/messagebee\/send/);
  assert.match(p, /127\.0\.0\.1:3999/);
  assert.match(p, /~\/\.hivematrix\/auth-token/);
  assert.match(p, /do NOT use osascript/i);
  assert.match(p, /data-urlencode/);
});

test("brainSearchRoutingPrompt points at the /brain/search endpoint with auth", () => {
  const p = brainSearchRoutingPrompt("3999");
  assert.match(p, /\/brain\/search\?q=/);
  assert.match(p, /127\.0\.0\.1:3999/);
  assert.match(p, /~\/\.hivematrix\/auth-token/);
  assert.match(p, /durable memory|brain/i);
});

test("beeToolsRoutingPrompt routes web/browser/desktop/terminal through /bee/<tool>", () => {
  const p = beeToolsRoutingPrompt("3999");
  assert.match(p, /\/bee\/<tool>/);
  assert.match(p, /webbee_search/);
  assert.match(p, /browserbee_run/);
  assert.match(p, /desktopbee_action/);
  assert.match(p, /termbee_run/);
  assert.match(p, /127\.0\.0\.1:3999/);
  assert.match(p, /do NOT improvise/i);
});
