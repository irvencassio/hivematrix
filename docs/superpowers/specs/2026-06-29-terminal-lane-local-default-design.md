# Terminal Lane Local Default Profile Resolution — Design

**Date:** 2026-06-29  
**Status:** Draft  
**Area:** `src/lib/terminal-lane/`

---

## Problem

When a user submits an explicit Terminal Lane request without naming a host (e.g., "Check my system uptime by using Terminal Lane"), the router correctly classifies it as an explicit Terminal Lane intent but then returns `needs_input` / `profile_missing` because no host hint is present to look up a profile.

The system asks: _"Name the target host or add a Terminal Lane profile in the Terminal Lane app, then retry."_

This is wrong. Local-machine commands don't have a remote host. The system should default to the built-in local profile (`kind: "local"`, `id: "local"`) automatically.

---

## Root Causes

### 1. `route.ts` — profile resolution gated on `hostHint`

```ts
// route.ts (current)
const hostHint = detectTerminalHostHint(text);
const profile = hostHint ? resolveTerminalProfileForQuery(hostHint, input.profiles) : null;
```

When `hostHint` is `null`, `profile` is always `null`. The fallback at the bottom of `routeTerminalLaneRequest` then unconditionally returns `status: "needs_input"` — even when `explicit === true`.

### 2. `open.ts` — empty `profileId` treated as not-found

`resolveTerminalOpenRequest({ profileId: "" })` calls `getTerminalProfile("")`, which returns `null`, causing `error: "profile_not_found"` instead of silently defaulting to `"local"`.

### 3. No canonical "give me the default local profile" helper

Nothing in `contracts.ts` or `store.ts` provides a function that returns the built-in local profile when no profile is specified. Every call site has to rediscover this.

### 4. `needs_input` copy doesn't distinguish local-missing vs remote-missing

The error message says "name the target host" regardless of whether the problem is a missing local profile, ambiguous local profiles, or a missing remote host — three different situations that need three different user actions.

---

## Goals

1. Explicit Terminal Lane requests with no host hint should resolve the local/default profile automatically.
2. If exactly one ready local profile exists, use it silently.
3. If a configured default exists among multiple local profiles, use it silently.
4. If multiple local profiles exist with no default, ask the user to **choose a profile** (not "name a host").
5. If no local profile exists at all, guide the user to **create a local Terminal Lane profile** (not "name a host").
6. Remote-host requests (naming a host/profile or clearly SSH-oriented) are unchanged.
7. Falling back to the generic frontier agent when Terminal Lane is explicit is forbidden.

---

## Non-Goals

- No changes to SSH/remote profile resolution.
- No changes to readiness probes or the terminal session/run tools (`lane-tools.ts`).
- No DB schema changes.

---

## Key Files

| File | Role |
|---|---|
| `src/lib/terminal-lane/route.ts` | Central routing logic — primary fix site |
| `src/lib/terminal-lane/intent.ts` | Pure intent detection (`isTerminalLaneRequest`, `detectTerminalHostHint`) |
| `src/lib/terminal-lane/contracts.ts` | Types + `terminalAuthCapability` + `buildTerminalOpenCommand` |
| `src/lib/terminal-lane/store.ts` | DB access — `listTerminalProfileSummaries`, `getTerminalProfile` |
| `src/lib/terminal-lane/open.ts` | `/terminal-lane/open` request resolution |
| `src/daemon/server.ts` | POST /tasks routing (line ~3706) + POST /terminal-lane/open (~1613) |
| `src/lib/terminal-lane/route.test.ts` | Unit tests for routing |
| `src/lib/terminal-lane/open.test.ts` | Unit tests for open resolution |

---

## Decision Points

### D1 — Where to resolve "no host, explicit intent"

**Option A: Fix in `route.ts` only.**  
When `explicit === true` and `hostHint === null`, scan `input.profiles` for local profiles and pick the default. All routing callers benefit automatically.

**Option B: Fix in `route.ts` and also in `open.ts`.**  
`open.ts` is called separately (POST /terminal-lane/open). It can independently default to `"local"` when `profileId` is falsy, making the two callers consistent.

**Decision: Option B.** Both callers need the fix independently; they can reach different states.

---

### D2 — "Local profile" definition

A profile is _local_ when `kind === "local"`. The built-in profile has `id === "local"`. User-created local profiles may have other IDs. The fix should treat **any profile with `kind === "local"`** as a local profile candidate.

---

### D3 — Default selection among multiple local profiles

Priority order (first match wins):
1. A profile whose `id === "local"` (the built-in default).
2. A profile explicitly marked as default (`isDefault: true` — if this field exists; skip if not).
3. The single local profile if exactly one exists.
4. If multiple local profiles exist with no clear default → `needs_input` / `ambiguous_local_profiles`.

**Decision:** Use priority order above. Do not add `isDefault` field in this change — use `id === "local"` as the tiebreaker for now.

---

### D4 — `needs_input` reason taxonomy

Replace the single `"profile_missing"` reason with a three-way split:

| `reason` | When | User-facing copy |
|---|---|---|
| `"local_profile_missing"` | No local profile found at all | "No local Terminal Lane profile exists. Open the Terminal Lane app to create one, then retry." |
| `"ambiguous_local_profiles"` | Multiple local profiles, no clear default | "Multiple local Terminal Lane profiles found. Choose one: [list names]" |
| `"remote_host_missing"` | Request appears SSH/remote but no host given | "This looks like a remote connection. Name the target host or profile, then retry." |

The old `"profile_missing"` reason is kept as a fallback for any other edge case to avoid breaking consumers that inspect the string.

---

## Implementation Plan (High Level)

### Step 1 — Add `resolveLocalProfile` helper in `route.ts`

```ts
function resolveLocalProfile(profiles: ProfileLike[]): 
  | { status: "found"; profile: ProfileLike }
  | { status: "ambiguous"; profiles: ProfileLike[] }
  | { status: "none" }
{
  const locals = profiles.filter(p => p.kind === "local");
  if (locals.length === 0) return { status: "none" };
  const builtin = locals.find(p => p.id === "local");
  if (builtin) return { status: "found", profile: builtin };
  if (locals.length === 1) return { status: "found", profile: locals[0] };
  return { status: "ambiguous", profiles: locals };
}
```

### Step 2 — Wire into `routeTerminalLaneRequest` in `route.ts`

After the existing `hostHint`-based profile lookup fails (i.e., `profile === null`):

```
if explicit && !hostHint:
  result = resolveLocalProfile(input.profiles)
  if result.status === "found"  → status: "prepared", profile: result.profile
  if result.status === "ambiguous" → needs_input, reason: "ambiguous_local_profiles"
  if result.status === "none"   → needs_input, reason: "local_profile_missing"
else if !profile && hostHint:
  → needs_input, reason: "profile_missing" (host was named but didn't match)
else if !explicit && !hostHint && !profile:
  keep existing fallback
```

Transcript lines must be updated to reflect the new path (e.g., `"Profile resolution: using local profile (no host specified)."`).

### Step 3 — Update `open.ts` to default `profileId` to `"local"`

```ts
// Before the getProfile() call:
const profileId = (typeof input.profileId === "string" && input.profileId.trim()) || "local";
```

### Step 4 — Improve `needs_input` copy in `route.ts`

Three distinct copy strings keyed to the three new reasons (see D4 table above).

### Step 5 — Tests (TDD — write first)

Failing tests to write before any implementation:

| Test | File |
|---|---|
| explicit + "uptime" + no host + one local profile → `prepared`, uses local profile | `route.test.ts` |
| explicit + "uptime" + no host + local profile `id !== "local"` (one only) → `prepared` | `route.test.ts` |
| explicit + local-Mac wording + no host hint → `prepared`, local profile | `route.test.ts` |
| explicit + no local profile → `needs_input` / `local_profile_missing` | `route.test.ts` |
| explicit + multiple local profiles no default → `needs_input` / `ambiguous_local_profiles` | `route.test.ts` |
| explicit + named remote host, no matching profile → `needs_input` / `profile_missing` (unchanged) | `route.test.ts` |
| explicit + remote wording, no host → `needs_input` / `remote_host_missing` | `route.test.ts` |
| generic routing behavior unchanged (no Terminal Lane intent) | `route.test.ts` |
| `open.ts`: empty profileId → defaults to local, resolves correctly | `open.test.ts` |
| `open.ts`: unknown profileId → `profile_not_found` (unchanged) | `open.test.ts` |

---

## Transcript Strings

The `transcript` array in `TerminalLaneRoute` surfaces routing reasoning in the UI. Updated lines:

```
Profile resolution: using built-in local profile (no host specified).
Prepared: Terminal Lane work item for local machine.
```

```
Profile resolution: no local Terminal Lane profile found.
needs_input: local_profile_missing — Open the Terminal Lane app to create a local profile, then retry.
```

```
Profile resolution: multiple local Terminal Lane profiles found with no clear default.
needs_input: ambiguous_local_profiles — Choose a profile: [<name1>, <name2>].
```

---

## Acceptance Criteria

1. `"Check my system uptime by using Terminal Lane"` → task `status: "prepared"`, `profile.id === "local"`, `reviewState` not `"needs_input"`.
2. `"Run uptime in Terminal Lane"` → same as above.
3. `"Use Terminal Lane to check disk space on this Mac"` → same as above.
4. No local profile in DB → `needs_input` with `reason: "local_profile_missing"`, copy mentions "create a local Terminal Lane profile."
5. Multiple local profiles, no `id === "local"` → `needs_input` with `reason: "ambiguous_local_profiles"`, copy lists profile names.
6. `"SSH into myserver using Terminal Lane"` with no matching profile → `needs_input` with `reason: "profile_missing"` or `"remote_host_missing"` (remote path unchanged).
7. Non-Terminal-Lane task → routes normally through generic agent (unchanged).
8. `npm run typecheck` passes.
9. `npm test` passes.
10. `node scripts/scope-wall.mjs` passes.
