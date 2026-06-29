# Terminal Lane Local Default Profile Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-29  
**Design doc:** `docs/superpowers/specs/2026-06-29-terminal-lane-local-default-design.md`  
**Branch:** work on current branch; no deploy.

---

## Summary

When a user submits an explicit Terminal Lane request without naming a host (e.g., "Check my system uptime by using Terminal Lane"), routing falls through to `needs_input / profile_missing` even though the built-in local profile exists.

Fix: after `hostHint === null` for an explicit request, check for local profiles before asking the user for input. Also default `open.ts` to `profileId = "local"` when no id is supplied.

Files changed:
- `src/lib/terminal-lane/route.ts` — primary fix (helper + wiring + reason taxonomy)
- `src/lib/terminal-lane/open.ts` — secondary fix (empty profileId defaults to "local")
- `src/lib/terminal-lane/route.test.ts` — new failing tests (write first)
- `src/lib/terminal-lane/open.test.ts` — new failing tests (write first)

---

## Task 1 — Write failing tests: `route.test.ts` (6 new cases)

**File:** `src/lib/terminal-lane/route.test.ts`  
**Approach:** RED — add tests that must fail before any production code changes.

Append after the existing tests:

```ts
// Local default profile fixtures
const LOCAL_BUILTIN = {
  id: "local", displayName: "Local", kind: "local",
  authMethod: "local", host: null, user: null, port: null,
  credentialPresent: false, autoConnect: true,
};
const LOCAL_HOME = {
  id: "home-mac", displayName: "Home Mac", kind: "local",
  authMethod: "local", host: null, user: null, port: null,
  credentialPresent: false, autoConnect: true,
};
const LOCAL_WORK = {
  id: "work-mac", displayName: "Work Mac", kind: "local",
  authMethod: "local", host: null, user: null, port: null,
  credentialPresent: false, autoConnect: true,
};

test("explicit Terminal Lane + uptime + no host → uses built-in local profile", () => {
  const r = routeTerminalLaneRequest({
    text: "Check my system uptime by using Terminal Lane",
    profiles: [LOCAL_BUILTIN, AISERVER],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.profile?.id, "local");
  assert.equal(r.reason, null);
  assert.match(r.suggestedCommand ?? "", /uptime/i);
  const t = r.transcript.join("\n");
  assert.match(t, /local/i);
  assert.match(t, /[Pp]repared/i);
});

test("explicit Terminal Lane + uptime + one custom local profile (no built-in) → uses it", () => {
  const r = routeTerminalLaneRequest({
    text: "Run uptime in Terminal Lane",
    profiles: [LOCAL_HOME, AISERVER],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.profile?.id, "home-mac");
  assert.equal(r.reason, null);
});

test("explicit Terminal Lane + local-Mac wording + no host hint → prepared with local profile", () => {
  const r = routeTerminalLaneRequest({
    text: "Use Terminal Lane to check disk space on this Mac",
    profiles: [LOCAL_BUILTIN],
  });
  assert.equal(r.status, "prepared");
  assert.equal(r.profile?.id, "local");
});

test("explicit Terminal Lane + no local profile → needs_input / local_profile_missing", () => {
  const r = routeTerminalLaneRequest({
    text: "Check my system uptime by using Terminal Lane",
    profiles: [AISERVER, PROD],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "local_profile_missing");
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /local Terminal Lane profile|Terminal Lane app/i);
  assert.doesNotMatch(r.needsInput.instructions, /target host/i);
});

test("explicit Terminal Lane + multiple local profiles, no built-in default → needs_input / ambiguous_local_profiles", () => {
  const r = routeTerminalLaneRequest({
    text: "Run uptime in Terminal Lane",
    profiles: [LOCAL_HOME, LOCAL_WORK],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "ambiguous_local_profiles");
  assert.ok(r.needsInput);
  // Copy must list profile names, not ask for a host.
  assert.match(r.needsInput.instructions, /Home Mac|Work Mac/i);
  assert.doesNotMatch(r.needsInput.instructions, /target host/i);
});

test("explicit Terminal Lane + SSH wording + no host hint → needs_input / remote_host_missing", () => {
  const r = routeTerminalLaneRequest({
    text: "SSH using Terminal Lane",
    profiles: [LOCAL_BUILTIN],
  });
  assert.equal(r.status, "needs_input");
  assert.equal(r.reason, "remote_host_missing");
  assert.ok(r.needsInput);
  assert.match(r.needsInput.instructions, /remote|host|profile/i);
});
```

**Verification:** `npm test -- --test-name-pattern "explicit Terminal"` should show 6 failures (type errors or runtime assertion errors). That's the RED state.

- [ ] Append the six test blocks above to `src/lib/terminal-lane/route.test.ts`
- [ ] Run `npm test` — confirm the 6 new tests fail (RED)

---

## Task 2 — Write failing tests: `open.test.ts` (2 new cases)

**File:** `src/lib/terminal-lane/open.test.ts`  
**Approach:** RED — empty `profileId` currently throws; test expects it to resolve to `"local"`.

Append after the existing tests:

```ts
test("empty profileId defaults to built-in local profile (no throw)", () => {
  const r = resolveTerminalOpenRequest({ profileId: "" }, { getProfile: lookup(PROFILES) });
  assert.equal(r.ok, true);
  assert.equal(r.profileId, "local");
  assert.equal(r.autoConnect, true);
  assert.doesNotMatch(JSON.stringify(r), /error/i);
});

test("unknown profileId still returns profile_not_found (no regression)", () => {
  const r = resolveTerminalOpenRequest({ profileId: "does-not-exist" }, { getProfile: lookup(PROFILES) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "profile_not_found");
});
```

**Verification:** First new test must fail (currently throws). Second must pass already.

- [ ] Append the two test blocks to `src/lib/terminal-lane/open.test.ts`
- [ ] Run `npm test` — confirm the first new open.test case fails, second passes (RED for case 1)

---

## Task 3 — Expand `TerminalRouteReason` type in `route.ts`

**File:** `src/lib/terminal-lane/route.ts` line 11  
**Approach:** Type change only — no logic yet. GREEN for typecheck; tests still red.

Change:

```ts
// Before:
export type TerminalRouteReason = null | "profile_missing" | "auth_not_ready" | "execution_unavailable" | "stale_app";

// After:
export type TerminalRouteReason =
  | null
  | "profile_missing"
  | "local_profile_missing"
  | "ambiguous_local_profiles"
  | "remote_host_missing"
  | "auth_not_ready"
  | "execution_unavailable"
  | "stale_app";
```

- [ ] Apply the type change to `src/lib/terminal-lane/route.ts`
- [ ] Run `npm run typecheck` — zero errors

---

## Task 4 — Add `resolveLocalProfile` and `isRemoteTerminalIntent` helpers in `route.ts`

**File:** `src/lib/terminal-lane/route.ts`  
**Approach:** Add two pure helpers after the `project()` function (line 64). No callers yet; tests still red.

Insert after the closing brace of `project()`:

```ts
// SSH-specific keywords imply a remote connection even when no host is named.
const SSH_KEYWORD_RE = /\b(ssh|sftp|scp)\b/i;

/** True when text suggests SSH/remote intent even without a resolved host token. */
function isRemoteTerminalIntent(text: string): boolean {
  return SSH_KEYWORD_RE.test(text);
}

type LocalProfileResult =
  | { status: "found"; profile: ProfileLike }
  | { status: "ambiguous"; profiles: ProfileLike[] }
  | { status: "none" };

/**
 * Among the supplied profiles, find the best local (kind="local") candidate.
 * Priority: built-in id="local" > single local profile > ambiguous.
 */
function resolveLocalProfile(profiles: ProfileLike[]): LocalProfileResult {
  const locals = profiles.filter((p) => p.kind === "local");
  if (locals.length === 0) return { status: "none" };
  const builtin = locals.find((p) => p.id === "local");
  if (builtin) return { status: "found", profile: builtin };
  if (locals.length === 1) return { status: "found", profile: locals[0] };
  return { status: "ambiguous", profiles: locals };
}
```

- [ ] Insert both helpers into `src/lib/terminal-lane/route.ts` after `project()`
- [ ] Run `npm run typecheck` — zero errors

---

## Task 5 — Wire new logic into `routeTerminalLaneRequest` in `route.ts`

**File:** `src/lib/terminal-lane/route.ts`  
**Approach:** Replace the existing `needs_input` fallback block with the new three-way branching. This is the GREEN step for the 6 `route.test.ts` tests.

Replace the current block starting at line 112 (`const missing = hostHint || "profile";` through the final `return`):

```ts
  // --- No profile matched by host hint ---

  // Case 1: explicit request, SSH/remote wording, but no host extracted.
  // → Ask the user to name the remote host/profile.
  if (explicit && !hostHint && isRemoteTerminalIntent(text)) {
    const instructions = "This looks like a remote connection. Name the target host or profile, then retry.";
    transcript.push("Profile resolution: SSH/remote intent detected but no host named.");
    transcript.push(`needs_input: remote_host_missing — ${instructions}`);
    return {
      lane: "terminal", intentDetected, explicit, hostHint, profile: null, suggestedCommand,
      status: "needs_input", reason: "remote_host_missing",
      needsInput: { missing: "host", instructions }, transcript,
    };
  }

  // Case 2: explicit request, no host hint, no remote wording → try local profiles.
  if (explicit && !hostHint) {
    const local = resolveLocalProfile(input.profiles);
    if (local.status === "found") {
      const p = project(local.profile);
      transcript.push(`Profile resolution: using local profile '${p.id}' (no host specified).`);
      const autoOk = p.autoConnect;
      const reason: TerminalRouteReason = autoOk ? null : "auth_not_ready";
      transcript.push(
        autoOk
          ? `Prepared: Terminal Lane work item for local machine${suggestedCommand ? ` — suggested command: ${suggestedCommand}` : ""}.`
          : `Prepared (auth not ready): local profile '${p.id}' is not connectable yet.`,
      );
      return { lane: "terminal", intentDetected, explicit, hostHint, profile: p, suggestedCommand, status: "prepared", reason, needsInput: null, transcript };
    }
    if (local.status === "ambiguous") {
      const names = local.profiles.map((p) => p.displayName).join(", ");
      const instructions = `Multiple local Terminal Lane profiles found. Choose one: ${names}.`;
      transcript.push("Profile resolution: multiple local profiles, no clear default.");
      transcript.push(`needs_input: ambiguous_local_profiles — ${instructions}`);
      return {
        lane: "terminal", intentDetected, explicit, hostHint, profile: null, suggestedCommand,
        status: "needs_input", reason: "ambiguous_local_profiles",
        needsInput: { missing: "profile", instructions }, transcript,
      };
    }
    // local.status === "none"
    const instructions = "No local Terminal Lane profile exists. Open the Terminal Lane app to create one, then retry.";
    transcript.push("Profile resolution: no local Terminal Lane profile found.");
    transcript.push(`needs_input: local_profile_missing — ${instructions}`);
    return {
      lane: "terminal", intentDetected, explicit, hostHint, profile: null, suggestedCommand,
      status: "needs_input", reason: "local_profile_missing",
      needsInput: { missing: "local_profile", instructions }, transcript,
    };
  }

  // Case 3: host was named (or implicit host-based route) but nothing matched.
  const missing = hostHint || "profile";
  const instructions = hostHint
    ? `No Terminal Lane profile matches '${hostHint}'. Add a Terminal Lane profile (host + user) for it in the Terminal Lane app, then retry.`
    : `Name the target host or add a Terminal Lane profile in the Terminal Lane app, then retry.`;
  transcript.push(hostHint ? `Profile resolution: no Terminal Lane profile matches '${hostHint}'.` : "Profile resolution: no target host given.");
  transcript.push(`needs_input: profile_missing — ${instructions}`);
  return { lane: "terminal", intentDetected, explicit, hostHint, profile: null, suggestedCommand, status: "needs_input", reason: "profile_missing", needsInput: { missing, instructions }, transcript };
```

- [ ] Replace the fallback block in `routeTerminalLaneRequest`
- [ ] Run `npm run typecheck` — zero errors
- [ ] Run `npm test -- src/lib/terminal-lane/route.test.ts` — all tests pass (GREEN)

---

## Task 6 — Update `open.ts` to default empty `profileId` to `"local"`

**File:** `src/lib/terminal-lane/open.ts` line 38–40  
**Approach:** Instead of throwing on empty profileId, fall back to `"local"`. GREEN for the open.test new case.

Replace:

```ts
  const profileId = typeof input.profileId === "string" ? input.profileId.trim() : "";
  if (!profileId) throw new Error("profileId is required");
```

With:

```ts
  const profileId = (typeof input.profileId === "string" && input.profileId.trim()) || "local";
```

- [ ] Apply the one-line change to `src/lib/terminal-lane/open.ts`
- [ ] Run `npm run typecheck` — zero errors
- [ ] Run `npm test -- src/lib/terminal-lane/open.test.ts` — all tests pass (GREEN)

---

## Task 7 — Verification gates

Run all three gates and confirm zero violations:

```sh
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all tests pass (no regressions)
- [ ] `node scripts/scope-wall.mjs` — zero violations

---

## Acceptance Criteria Mapping

| Criterion | Task(s) |
|---|---|
| "Check my system uptime by using Terminal Lane" → `prepared`, local profile | 1 + 5 |
| "Run uptime in Terminal Lane" → `prepared`, local profile | 1 + 5 |
| "Use Terminal Lane to check disk space on this Mac" → `prepared` | 1 + 5 |
| No local profile → `needs_input / local_profile_missing`, copy mentions create | 1 + 5 |
| Multiple local profiles, no default → `ambiguous_local_profiles`, lists names | 1 + 5 |
| SSH/remote wording without host → `remote_host_missing` | 1 + 5 |
| Existing remote host request unchanged | existing tests + 5 |
| empty profileId in open.ts → defaults to "local" | 2 + 6 |
| `npm run typecheck` passes | 3 + 4 + 5 + 6 |
| `npm test` all pass | 7 |
| `node scripts/scope-wall.mjs` zero violations | 7 |
