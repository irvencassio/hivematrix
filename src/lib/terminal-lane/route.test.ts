import assert from "node:assert/strict";
import test from "node:test";

import { resolveTerminalProfileForQuery, routeTerminalLaneRequest } from "./route";

// Non-secret profile summaries shaped like listTerminalProfileSummaries().
const AISERVER = {
  id: "aiserver", displayName: "aiserver", kind: "ssh", authMethod: "ssh_key_agent",
  host: "10.80.114.11", user: "istai", port: 22, credentialRef: null, credentialPresent: false,
  autoConnect: true, openCommand: "ssh -p 22 istai@10.80.114.11",
};
const PROD = {
  id: "prod-db", displayName: "Prod Database", kind: "ssh", authMethod: "password_keychain",
  host: "10.0.0.5", user: "ops", port: 22, credentialRef: "hivematrix.terminal.prod-db", credentialPresent: true,
  autoConnect: false, openCommand: "ssh ops@10.0.0.5",
};

test("resolveTerminalProfileForQuery matches by id, displayName, and host", () => {
  assert.equal(resolveTerminalProfileForQuery("aiserver", [AISERVER, PROD])?.id, "aiserver");
  assert.equal(resolveTerminalProfileForQuery("Prod Database", [AISERVER, PROD])?.id, "prod-db");
  assert.equal(resolveTerminalProfileForQuery("10.80.114.11", [AISERVER, PROD])?.id, "aiserver");
  assert.equal(resolveTerminalProfileForQuery("nonexistent", [AISERVER, PROD]), null);
});

test("the matched profile projection carries no secret material", () => {
  const p = resolveTerminalProfileForQuery("prod-db", [PROD]);
  assert.ok(p);
  assert.doesNotMatch(JSON.stringify(p), /\bpassword\b|\bpassphrase\b|private_key|credentialRef/i);
  // It still reports that a credential is configured (a boolean, not the value).
  assert.equal(p.credentialPresent, true);
});

test("'use TerminalLane and check the OS version of aiserver' prepares the aiserver profile", () => {
  const r = routeTerminalLaneRequest({ text: "use TerminalLane and check the OS version of aiserver", profiles: [AISERVER, PROD] });
  assert.equal(r.lane, "terminal");
  assert.equal(r.intentDetected, true);
  assert.equal(r.explicit, true);
  assert.equal(r.hostHint, "aiserver");
  assert.equal(r.profile?.id, "aiserver");
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  // A read-only OS-version command is suggested (never executed here).
  assert.match(r.suggestedCommand ?? "", /os-release|uname/i);
  // Structured transcript: intent → route → profile → prepared.
  const t = r.transcript.join("\n");
  assert.match(t, /Intent detected/i);
  assert.match(t, /Route selected: Terminal Lane/i);
  assert.match(t, /aiserver/);
  assert.match(t, /[Pp]repared/);
});

test("an explicit Terminal Lane request with no matching profile returns structured needs_input", () => {
  const r = routeTerminalLaneRequest({ text: "use TerminalLane and run uptime on aiserver", profiles: [PROD] });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "profile_missing");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /Terminal Lane profile|add a profile/i);
  assert.match(r.needsInput.missing, /aiserver|profile/i);
});

test("the route never mentions Canopy or leaks secrets", () => {
  const blob = JSON.stringify(routeTerminalLaneRequest({ text: "use TerminalLane and run df on prod-db", profiles: [PROD] }));
  assert.doesNotMatch(blob, /canopy/i);
  assert.doesNotMatch(blob, /\bpassword\b|\bpassphrase\b|private_key|sshpass|credentialRef/i);
});
