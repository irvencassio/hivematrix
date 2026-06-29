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

// Local profiles (kind:"local", host:null) for fallback resolution tests.
const LOCAL = {
  id: "local", displayName: "Local Mac", kind: "local", authMethod: "local",
  host: null, user: null, port: null, credentialRef: null, credentialPresent: false,
  autoConnect: true, openCommand: null, isDefault: false,
};
const LOCAL_ALT = {
  id: "local-alt", displayName: "Local Dev Shell", kind: "local", authMethod: "local",
  host: null, user: null, port: null, credentialRef: null, credentialPresent: false,
  autoConnect: true, openCommand: null, isDefault: false,
};
const LOCAL_DEFAULT = {
  id: "local-default", displayName: "Local Default", kind: "local", authMethod: "local",
  host: null, user: null, port: null, credentialRef: null, credentialPresent: false,
  autoConnect: true, openCommand: null, isDefault: true,
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

// ── Generic routing guard: SSH host hint wins even when local profiles exist ──
// Once local-profile fallback is implemented, it must only fire when there is NO
// resolved profile for the given host hint. A clear SSH host hint that resolves
// to a known profile must produce a "prepared" result — the local fallback must
// NOT override it. These tests currently PASS (no fallback logic exists yet) and
// must continue to pass after the new logic is added.

test("explicit Terminal Lane + SSH host hint that resolves + local profiles present → SSH profile wins", () => {
  // "on aiserver" is the last host-cue match; no "to <word>" follows so hostHint stays "aiserver".
  const r = routeTerminalLaneRequest({
    text: "run uptime on aiserver using Terminal Lane",
    profiles: [AISERVER, LOCAL],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.ok(r.profile);
  assert.equal(r.profile?.id, "aiserver");
  assert.equal(r.profile?.kind, "ssh");
});

test("explicit Terminal Lane + SSH host hint that resolves + multiple local profiles → SSH profile wins, no ambiguity", () => {
  const r = routeTerminalLaneRequest({
    text: "run df on aiserver using Terminal Lane",
    profiles: [AISERVER, LOCAL, LOCAL_ALT],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.ok(r.profile);
  assert.equal(r.profile?.id, "aiserver");
});

test("explicit Terminal Lane + SSH host hint that resolves + autoConnect=false → auth_not_ready even with local profiles present", () => {
  // Avoid "to <verb>" after the hostname — it would be picked up as the last host hint.
  const r = routeTerminalLaneRequest({
    text: "disk space on prod-db using Terminal Lane",
    profiles: [PROD, LOCAL, LOCAL_DEFAULT],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, "auth_not_ready");
  assert.ok(r.profile);
  assert.equal(r.profile?.id, "prod-db");
});

test("explicit Terminal Lane + SSH host hint resolved by IP + local profiles present → SSH profile wins", () => {
  const r = routeTerminalLaneRequest({
    text: "OS version on 10.80.114.11 using Terminal Lane",
    profiles: [AISERVER, LOCAL],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.ok(r.profile);
  assert.equal(r.profile?.id, "aiserver");
  assert.match(r.suggestedCommand ?? "", /os-release|uname/i);
});

test("resolveTerminalProfileForQuery still resolves SSH profiles when local profiles are in the list", () => {
  assert.equal(resolveTerminalProfileForQuery("aiserver", [AISERVER, LOCAL, LOCAL_ALT])?.id, "aiserver");
  assert.equal(resolveTerminalProfileForQuery("10.80.114.11", [AISERVER, LOCAL])?.id, "aiserver");
  assert.equal(resolveTerminalProfileForQuery("prod-db", [PROD, LOCAL_DEFAULT])?.id, "prod-db");
  // A query that matches nothing — even with local profiles present — returns null.
  assert.equal(resolveTerminalProfileForQuery("unknown-host", [AISERVER, LOCAL]), null);
});

// ── Local-profile fallback: no host hint, single or default local profile ──
// These tests describe the DESIRED behavior. They currently FAIL because
// routeTerminalLaneRequest sets profile=null whenever hostHint is null
// (line 93: `const profile = hostHint ? resolve(...) : null`).

test("explicit Terminal Lane + uptime + no host + single local profile → prepared with that profile", () => {
  const r = routeTerminalLaneRequest({
    text: "Check my system uptime by using Terminal Lane",
    profiles: [LOCAL],
  });
  assert.equal(r.lane, "terminal");
  assert.equal(r.explicit, true);
  assert.equal(r.hostHint, null);
  // Must resolve to the only available local profile, not fall through to needs_input.
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.ok(r.profile, "profile must be set");
  assert.equal(r.profile?.id, "local");
  assert.equal(r.profile?.kind, "local");
  // Uptime command should be suggested.
  assert.equal(r.suggestedCommand, "uptime");
  // Transcript should note that the only local profile was selected automatically.
  const t = r.transcript.join("\n");
  assert.match(t, /Profile resolution/i);
  assert.match(t, /[Pp]repared/);
});

test("explicit Terminal Lane + no host + single local profile among SSH profiles → uses the local profile", () => {
  const r = routeTerminalLaneRequest({
    text: "use Terminal Lane to check disk space on this Mac",
    profiles: [AISERVER, LOCAL, PROD],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.equal(r.hostHint, null);
  assert.ok(r.profile, "profile must be set");
  assert.equal(r.profile?.id, "local");
  assert.equal(r.profile?.kind, "local");
});

test("explicit Terminal Lane + no host + multiple local profiles, one isDefault → uses the default", () => {
  const r = routeTerminalLaneRequest({
    text: "run uptime using Terminal Lane",
    profiles: [LOCAL_ALT, LOCAL_DEFAULT],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.equal(r.hostHint, null);
  assert.ok(r.profile, "profile must be set");
  assert.equal(r.profile?.id, "local-default");
  assert.equal(r.profile?.kind, "local");
});

// ── Local Mac wording: explicit local-machine terms → local profile ──
// These tests describe the DESIRED behavior. They currently FAIL because the
// implementation does not recognise local-Mac terms ("MacBook", "iMac",
// "localhost", "Mac" against non-matching profile names) as local-profile
// signals. Instead it treats them as unresolved remote-host names and returns
// needs_input with reason "profile_missing".

test("explicit Terminal Lane + 'on MacBook' + single local profile → prepared with local profile", () => {
  // "on MacBook" sets hostHint="MacBook". "MacBook" does not substring-match
  // LOCAL's displayName "Local Mac", so the current router returns needs_input.
  const r = routeTerminalLaneRequest({
    text: "Run uptime on MacBook using Terminal Lane",
    profiles: [LOCAL],
  });
  assert.equal(r.lane, "terminal");
  assert.equal(r.explicit, true);
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.ok(r.profile, "profile must be set");
  assert.equal(r.profile?.kind, "local");
  assert.equal(r.suggestedCommand, "uptime");
});

test("explicit Terminal Lane + 'on localhost' + single local profile → prepared with local profile", () => {
  // "on localhost" sets hostHint="localhost". LOCAL_ALT (displayName "Local Dev Shell")
  // does not substring-match "localhost", so the current router returns needs_input.
  const r = routeTerminalLaneRequest({
    text: "Check disk space on localhost using Terminal Lane",
    profiles: [LOCAL_ALT],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.ok(r.profile, "profile must be set");
  assert.equal(r.profile?.kind, "local");
  assert.equal(r.suggestedCommand, "df -h");
});

test("explicit Terminal Lane + 'on iMac' among SSH profiles → uses the local profile, not SSH", () => {
  // "on iMac" sets hostHint="iMac". None of AISERVER, LOCAL, PROD match "iMac".
  // The router should still prefer the only local-kind profile (LOCAL).
  const r = routeTerminalLaneRequest({
    text: "Check OS version on iMac using Terminal Lane",
    profiles: [AISERVER, LOCAL, PROD],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.ok(r.profile, "profile must be set");
  assert.equal(r.profile?.kind, "local");
  assert.equal(r.profile?.id, "local");
});

test("explicit Terminal Lane + 'on Mac' + multiple local profiles, one isDefault → uses the default", () => {
  // "on Mac" sets hostHint="Mac". Neither LOCAL_ALT ("Local Dev Shell") nor
  // LOCAL_DEFAULT ("Local Default") substring-matches "mac", so currently needs_input.
  const r = routeTerminalLaneRequest({
    text: "Run df on Mac using Terminal Lane",
    profiles: [LOCAL_ALT, LOCAL_DEFAULT],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.reason, null);
  assert.ok(r.profile, "profile must be set");
  assert.equal(r.profile?.kind, "local");
  assert.equal(r.profile?.id, "local-default");
});

// ── No local profile: explicit Terminal Lane requests must return setup guidance ──
// When the user makes an explicit Terminal Lane request with local semantics but
// no local-kind profile exists, the router MUST return targeted setup guidance
// ("Create a local Terminal Lane profile") instead of the generic
// "Name the target host or add a Terminal Lane profile" message.
//
// These tests currently FAIL because routeTerminalLaneRequest always returns
// reason:"profile_missing" and instructions that say "Name the target host…"
// — they have no special handling for the no-local-profile case.

test("explicit Terminal Lane + no host + no profiles at all → needs_input with no_local_profile reason", () => {
  const r = routeTerminalLaneRequest({
    text: "Check my system uptime by using Terminal Lane",
    profiles: [],
  });
  assert.equal(r.lane, "terminal");
  assert.equal(r.explicit, true);
  assert.equal(r.status, "needs_input");
  // Must distinguish "no local profile configured" from "unknown remote host".
  assert.equal(r.reason, "no_local_profile");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput);
  // Instructions must guide the user to CREATE a local profile, not to name a host.
  assert.match(r.needsInput.instructions, /create|set up|add a local/i);
  assert.doesNotMatch(r.needsInput.instructions, /name the target host/i);
  // missing field must identify the local-profile gap, not a generic "profile".
  assert.match(r.needsInput.missing, /local/i);
});

test("explicit Terminal Lane + no host + only SSH profiles → needs_input with no_local_profile reason", () => {
  // The user wants to run a local command. SSH profiles exist, but none are local-kind.
  // The router must not invite the user to name a remote SSH host.
  const r = routeTerminalLaneRequest({
    text: "run uptime in Terminal Lane",
    profiles: [AISERVER, PROD],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "no_local_profile");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /create|set up|add a local/i);
  assert.doesNotMatch(r.needsInput.instructions, /name the target host/i);
  assert.match(r.needsInput.missing, /local/i);
});

test("explicit Terminal Lane + 'on Mac' + only SSH profiles → no_local_profile guidance, not host prompt", () => {
  // "on Mac" is a local-machine signal. Even though the current parser extracts
  // hostHint="Mac", the router must recognise it as local (not a real SSH host)
  // and return no_local_profile guidance instead of "add profile for host Mac".
  const r = routeTerminalLaneRequest({
    text: "Run df on Mac using Terminal Lane",
    profiles: [AISERVER, PROD],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "no_local_profile");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /create|set up|add a local/i);
  assert.doesNotMatch(r.needsInput.instructions, /name the target host/i);
});

test("explicit Terminal Lane + 'on localhost' + only SSH profiles → no_local_profile guidance", () => {
  // "localhost" is an unambiguous local-machine reference. The router must not
  // treat it as a missing SSH host and ask the user to configure an SSH profile.
  const r = routeTerminalLaneRequest({
    text: "Check disk space on localhost using Terminal Lane",
    profiles: [AISERVER],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "no_local_profile");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /create|set up|add a local/i);
  assert.doesNotMatch(r.needsInput.instructions, /name the target host/i);
  assert.match(r.needsInput.missing, /local/i);
});

test("explicit Terminal Lane + no host + no profiles → transcript notes no local profile, not 'no target host'", () => {
  const r = routeTerminalLaneRequest({
    text: "Check uptime using Terminal Lane",
    profiles: [],
  });
  const t = r.transcript.join("\n");
  assert.equal(r.status, "needs_input");
  // Transcript must reflect that a local profile is missing, not that a host was absent.
  assert.doesNotMatch(t, /no target host given/i);
  assert.match(t, /no local.*profile|local.*profile.*missing|local.*profile.*not configured/i);
});

// ── Multiple local profiles, none marked default → ask user to choose ──
// When there are 2+ local-kind profiles and none has isDefault:true, the router
// cannot auto-select one. It must return needs_input with reason "choose_local_profile"
// and list the candidates so the caller can present a pick prompt to the user.
//
// These tests FAIL today because routeTerminalLaneRequest has no "choose_local_profile"
// branch — it falls through to reason:"profile_missing" (no host hint) or returns
// needs_input with the wrong reason.

test("explicit Terminal Lane + no host + two local profiles (no default) → choose_local_profile", () => {
  const r = routeTerminalLaneRequest({
    text: "Run uptime using Terminal Lane",
    profiles: [LOCAL, LOCAL_ALT],
  });
  assert.equal(r.lane, "terminal");
  assert.equal(r.explicit, true);
  assert.equal(r.hostHint, null);
  assert.equal(r.status, "needs_input");
  // Must be "choose_local_profile", not "profile_missing" or "no_local_profile".
  assert.equal(r.reason, "choose_local_profile");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput, "needsInput must be present");
  // Instructions must ask the user to pick from the available local profiles.
  assert.match(r.needsInput.instructions, /which|choose|select/i);
  // Both profile display names must appear so the user knows what to pick from.
  assert.match(r.needsInput.instructions, /Local Mac/);
  assert.match(r.needsInput.instructions, /Local Dev Shell/);
  // choices must list the profile ids so the caller can wire up a follow-up request.
  assert.ok(Array.isArray((r.needsInput as any).choices), "needsInput.choices must be an array");
  const choices: string[] = (r.needsInput as any).choices;
  assert.ok(choices.includes("local"), "choices must include 'local'");
  assert.ok(choices.includes("local-alt"), "choices must include 'local-alt'");
});

test("explicit Terminal Lane + no host + three local profiles (no default) → choose_local_profile lists all", () => {
  const LOCAL_EXTRA = {
    id: "local-work", displayName: "Work Shell", kind: "local", authMethod: "local",
    host: null, user: null, port: null, credentialRef: null, credentialPresent: false,
    autoConnect: true, openCommand: null, isDefault: false,
  };
  const r = routeTerminalLaneRequest({
    text: "check disk space using Terminal Lane",
    profiles: [LOCAL, LOCAL_ALT, LOCAL_EXTRA],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "choose_local_profile");
  const choices: string[] = (r.needsInput as any).choices;
  assert.equal(choices.length, 3);
  assert.ok(choices.includes("local"));
  assert.ok(choices.includes("local-alt"));
  assert.ok(choices.includes("local-work"));
});

test("explicit Terminal Lane + 'on Mac' + two local profiles (no default) → choose_local_profile", () => {
  // "on Mac" is a local-machine signal. The router recognises no SSH host matches,
  // sees two local profiles with no default, and must ask the user to choose.
  const r = routeTerminalLaneRequest({
    text: "Run uptime on Mac using Terminal Lane",
    profiles: [LOCAL, LOCAL_ALT],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "choose_local_profile");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /which|choose|select/i);
  const choices: string[] = (r.needsInput as any).choices;
  assert.ok(choices.includes("local"));
  assert.ok(choices.includes("local-alt"));
});

test("explicit Terminal Lane + 'on localhost' + two local profiles (no default) → choose_local_profile", () => {
  const r = routeTerminalLaneRequest({
    text: "Check disk space on localhost using Terminal Lane",
    profiles: [LOCAL, LOCAL_ALT],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "choose_local_profile");
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /which|choose|select/i);
  const choices: string[] = (r.needsInput as any).choices;
  assert.ok(choices.includes("local"));
  assert.ok(choices.includes("local-alt"));
});

test("choose_local_profile + SSH profiles present → choices only contains local profiles", () => {
  // SSH profiles must not appear in the choices list — only local-kind profiles are candidates.
  const r = routeTerminalLaneRequest({
    text: "run uptime using Terminal Lane",
    profiles: [AISERVER, LOCAL, LOCAL_ALT, PROD],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "choose_local_profile");
  const choices: string[] = (r.needsInput as any).choices;
  // Only local-kind profiles should be offered.
  assert.ok(choices.includes("local"));
  assert.ok(choices.includes("local-alt"));
  assert.ok(!choices.includes("aiserver"), "SSH profile must not appear in local choices");
  assert.ok(!choices.includes("prod-db"), "SSH profile must not appear in local choices");
});

test("choose_local_profile transcript notes ambiguity, not missing host", () => {
  const r = routeTerminalLaneRequest({
    text: "Run uptime using Terminal Lane",
    profiles: [LOCAL, LOCAL_ALT],
  });
  const t = r.transcript.join("\n");
  assert.equal(r.status, "needs_input");
  // Must say "multiple" / "ambiguous" — not the host-missing wording.
  assert.match(t, /multiple local|ambiguous|choose|which local/i);
  assert.doesNotMatch(t, /no target host given/i);
  assert.doesNotMatch(t, /no local.*profile.*missing|local.*profile.*not configured/i);
});

// ── Explicit REMOTE intent: no host given, SSH profiles available ──
// When the user makes an explicit Terminal Lane request with a clear SSH/remote
// signal ("ssh", "sftp", "connect remotely", "remote server") but names NO
// specific host, and remote (SSH-kind) profiles ARE available, the router must
// ask the user to pick a remote profile. It must NOT:
//   - silently auto-select an SSH profile (unsafe when multiple exist)
//   - return no_local_profile guidance (wrong — the user wants SSH, not local setup)
//   - emit the generic "Name the target host" message (profiles exist; need selection)
//
// These tests FAIL today because routeTerminalLaneRequest has no remote-intent
// detection: it returns needs_input with reason "profile_missing" (or falls into
// the no_local_profile branch) for all no-host-hint cases, regardless of whether
// SSH profiles exist or the text contains an SSH/remote signal.

test("explicit remote Terminal Lane ('ssh using Terminal Lane') + no host + single SSH profile → choose_remote_profile", () => {
  const r = routeTerminalLaneRequest({
    text: "ssh using Terminal Lane",
    profiles: [AISERVER],
  });
  assert.equal(r.lane, "terminal");
  assert.equal(r.explicit, true);
  assert.equal(r.hostHint, null);
  assert.equal(r.status, "needs_input");
  // Must ask user to pick the remote profile — not complain about a missing local profile.
  assert.equal(r.reason, "choose_remote_profile");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /which|choose|select/i);
  assert.match(r.needsInput.instructions, /aiserver/i);
  const choices: string[] = (r.needsInput as any).choices;
  assert.ok(Array.isArray(choices));
  assert.ok(choices.includes("aiserver"));
});

test("explicit remote Terminal Lane ('connect remotely via Terminal Lane') + no host + multiple SSH profiles → choose_remote_profile lists all", () => {
  const r = routeTerminalLaneRequest({
    text: "connect remotely via Terminal Lane",
    profiles: [AISERVER, PROD],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "choose_remote_profile");
  assert.equal(r.profile, null);
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /which|choose|select/i);
  const choices: string[] = (r.needsInput as any).choices;
  assert.ok(Array.isArray(choices));
  assert.ok(choices.includes("aiserver"));
  assert.ok(choices.includes("prod-db"));
});

test("explicit remote Terminal Lane ('sftp via Terminal Lane') + no host + SSH profiles → choose_remote_profile", () => {
  const r = routeTerminalLaneRequest({
    text: "sftp via Terminal Lane",
    profiles: [AISERVER, PROD],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "choose_remote_profile");
  const choices: string[] = (r.needsInput as any).choices;
  assert.ok(Array.isArray(choices));
  assert.ok(choices.includes("aiserver") || choices.includes("prod-db"));
});

test("explicit remote Terminal Lane + no host + SSH profiles → does NOT return no_local_profile", () => {
  // Telling a user who wants SSH to "create a local profile" is wrong.
  const r = routeTerminalLaneRequest({
    text: "use Terminal Lane to ssh to the server",
    profiles: [AISERVER, PROD],
  });
  assert.notEqual(r.reason, "no_local_profile");
  assert.equal(r.status, "needs_input");
});

test("explicit remote Terminal Lane + no host + SSH AND local profiles → choose_remote_profile offers only SSH profiles", () => {
  // When the user's intent is remote (ssh), local-kind profiles must not appear in choices.
  const r = routeTerminalLaneRequest({
    text: "ssh via Terminal Lane",
    profiles: [AISERVER, LOCAL, PROD],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "choose_remote_profile");
  const choices: string[] = (r.needsInput as any).choices;
  assert.ok(choices.includes("aiserver"));
  assert.ok(choices.includes("prod-db"));
  assert.ok(!choices.includes("local"), "local-kind profile must not appear in remote choices");
});

test("explicit remote Terminal Lane + no host + no SSH profiles at all → profile_missing with SSH-profile setup guidance", () => {
  // No SSH profiles exist. Guide the user to add a remote/SSH profile — not to "name a host".
  const r = routeTerminalLaneRequest({
    text: "ssh using Terminal Lane",
    profiles: [],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "profile_missing");
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /add.*ssh|ssh.*profile|remote.*profile|configure.*ssh/i);
  assert.doesNotMatch(r.needsInput.instructions, /name the target host/i);
});

test("explicit remote Terminal Lane + no host + only local profiles → profile_missing with SSH-profile setup guidance", () => {
  // Local profiles exist but the user wants SSH. Must not auto-select the local profile
  // and must not tell the user to "name a host" — it should say to add an SSH profile.
  const r = routeTerminalLaneRequest({
    text: "connect remotely via Terminal Lane",
    profiles: [LOCAL],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "profile_missing");
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /add.*ssh|ssh.*profile|remote.*profile|configure.*ssh/i);
  assert.doesNotMatch(r.needsInput.instructions, /name the target host/i);
});

test("explicit remote Terminal Lane + no host → transcript notes remote-profile selection needed, not local-profile gap", () => {
  const r = routeTerminalLaneRequest({
    text: "connect remotely using Terminal Lane",
    profiles: [AISERVER],
  });
  const t = r.transcript.join("\n");
  assert.equal(r.status, "needs_input");
  // Transcript must NOT say "no local profile" — user wants remote, not local setup.
  assert.doesNotMatch(t, /no local.*profile|local.*profile.*missing|local.*profile.*not configured/i);
  // Transcript must reference the remote selection need.
  assert.match(t, /remote|ssh|choose|which/i);
});

test("explicit remote Terminal Lane + no host → does NOT emit generic 'Name the target host' instruction when profiles exist", () => {
  // "Name the target host" is wrong when SSH profiles are already configured —
  // the user should pick from the list, not go configure a new profile.
  const r = routeTerminalLaneRequest({
    text: "ssh using Terminal Lane",
    profiles: [AISERVER],
  });
  assert.ok(r.needsInput);
  assert.doesNotMatch(r.needsInput.instructions, /name the target host/i);
});
