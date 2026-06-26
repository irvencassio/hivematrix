import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("console exposes a structured COO routing rules editor", () => {
  const console = read("src/daemon/console.ts");

  assert.match(console, /COO routing rules/);
  assert.match(console, /id="coo_rules_lane_filter"/);
  assert.match(console, /id="coo_rules_list"/);
  assert.match(console, /id="coo_rules_result"/);
  assert.match(console, /renderCooRoutingRules\(/);

  // Existing routing-rule API surface only: list, save, delete, history, seed, resolve.
  assert.match(console, /api\("\/coo\/routing-rules"/);
  assert.match(console, /api\("\/coo\/routing-rules",\s*\{\s*method:\s*"POST"/);
  assert.match(console, /api\("\/coo\/routing-rules\/"\+encodeURIComponent\(id\),\s*\{\s*method:\s*"DELETE"/);
  assert.match(console, /api\("\/coo\/routing-rules\/"\+encodeURIComponent\(id\)\+"\/history"/);
  assert.match(console, /api\("\/coo\/routing-rules\/seed",\s*\{\s*method:\s*"POST"/);
  assert.match(console, /api\("\/coo\/routing-rules\/resolve",\s*\{\s*method:\s*"POST"/);

  // Structured controls rather than arbitrary SQL/prompt editing.
  for (const token of [
    "cooRuleEditor",
    "cooSaveRule",
    "cooDuplicateRule",
    "cooDeleteRule",
    "cooShowRuleHistory",
    "cooSeedDefaultRules",
    "cooResolveRuleTest",
    "backendPolicy",
    "modelPosture",
    "riskTier",
    "approvalPolicy",
    "verificationPolicy",
    "constraints",
    "phrases",
    "domains",
    "workflows",
    "enabled",
    "priority",
  ]) {
    assert.ok(console.includes(token), `console should include ${token}`);
  }

  // The editor has a UI-side secret-looking input refusal, but not secret-entry fields.
  assert.match(console, /cooSecretLike/);
  const start = console.indexOf("COO routing rules");
  const segment = console.slice(start, start + 9000);
  assert.doesNotMatch(segment, /credentialRef|id="[^"]*(password|cookie|token|secret)[^"]*"/i);
});
