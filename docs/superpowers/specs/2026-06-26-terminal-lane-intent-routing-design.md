# Terminal Lane intent routing — Design

> Date: 2026-06-26
> Status: Approved (fixes the brain note: terminal-lane-issues.md)

## Problem

A task "use TerminalLane and check the OS version of aiserver" was created via
`POST /tasks`, which never consults lane intent — it became a generic
`executor: "agent"` task. The scheduler claimed it, `subprocess.ts` hard-routed
`mixed → "code-critical" → frontier → claude-sonnet`, and the spawned agent then
leaned on a stale memory doc (`reference_canopy_agent_bridge.md`: "Canopy is the
preferred path for SSH") and went into a **Canopy discovery loop** — searching
for TerminalLane, probing the Canopy CLI — instead of using HiveMatrix's Terminal
Lane. An `aiserver` Terminal Lane profile *exists* (host 10.80.114.11), so the
work could have been prepared immediately. The transcript reads like Canopy, not
Terminal Lane, making Terminal Lane feel fake/bypassed.

Separately, Terminal Lane app version/install identity confusion (0.1.1 (2) vs a
newer profile-management build) was **already fixed** in commit `b622b53` (bump
to 0.1.2 (3), `HMBuildId` build identity, stale `/Applications` shadow detection,
repair action). This slice keeps/strengthens those tests; the new work is intent
routing.

## What exists

- `POST /tasks` (server.ts) has an AI-news short-circuit
  (`isAiNewsVideoRequest` → `executor: "video-review"`) but no terminal route.
- The scheduler only claims `executor: "agent"` tasks (scheduler.ts:267,301), so
  a non-agent executor is never auto-run by the generic agent (how video-review
  avoids it).
- `news-intent.ts` is the pure keyword-detector pattern to mirror.
- Terminal profiles: `listTerminalProfileSummaries()` → `{id, displayName, host,
  user, port, authMethod, credentialRef, credentialPresent, autoConnect,
  readiness?…}` — **no secret values**, no alias field.
- The agent's Terminal Lane guidance lives in `beeToolsRoutingPrompt()`
  (orchestrator/outbound-routing.ts); Canopy appears only in code comments, but
  the *agent's user-level memory* steers it to Canopy.

## Decisions

### 1. Pure intent detector — `src/lib/terminal-lane/intent.ts`

- `isTerminalLaneRequest(text)`: true when the text explicitly names the lane —
  `TerminalLane`, `Terminal Lane`, `use terminal lane`, `use TerminalLane to …`.
- `detectTerminalHostHint(text)`: extracts a likely host token from
  host-targeted phrasing — "OS version of aiserver", "on aiserver", "ssh to
  aiserver", "@aiserver" → `"aiserver"`. Pure, returns `string | null`.

### 2. Profile resolution — `src/lib/terminal-lane/route.ts`

- `resolveTerminalProfileForQuery(query, profiles)`: case-insensitive match by
  **id**, **displayName**, **host**, and **user** (substring + exact), preferring
  exact id/displayName/host over substring. For "aiserver" → the profile whose
  id/displayName/host includes "aiserver". Returns a **non-secret** projection
  `{id, displayName, host, user, port, authMethod, credentialPresent,
  autoConnect}` or null.

### 3. Structured route — `routeTerminalLaneRequest({ text, profiles })`

Returns a structured, secret-free result the task transcript renders:

```ts
{
  lane: "terminal",
  intentDetected: boolean,
  explicit: boolean,            // the text named the lane
  hostHint: string | null,
  profile: NonSecretProfile | null,
  suggestedCommand: string | null,   // only for well-known read-only intents (OS version → "cat /etc/os-release 2>/dev/null || uname -a")
  status: "prepared" | "needs_input",
  reason: null | "profile_missing" | "auth_not_ready" | "execution_unavailable" | "stale_app",
  needsInput: { missing: string; instructions: string } | null,
  transcript: string[],         // intent detected → route selected → profile resolution → prepared/needs_input
}
```

Rules:
- A request routes to Terminal Lane when it is **explicit**, OR when a
  `hostHint` matches a **configured** profile (so it never hijacks unrelated
  tasks). Pure detector `isTerminalLaneRequest` handles the explicit gate in
  `POST /tasks`.
- Matched profile → `status: "prepared"`, work item keyed by **profileId** (never
  raw ssh creds). If the profile needs a credential that isn't ready →
  `reason: "auth_not_ready"`. If there's no configured profile for the host →
  `status: "needs_input"`, `reason: "profile_missing"`, with exact setup
  instructions.
- The result and transcript **never** mention Canopy and **never** carry a
  password/passphrase/private key (a no-secret + no-Canopy regression test
  enforces this).

### 4. Wire into `POST /tasks`

After the video check, if `body.executor` isn't already terminal and
`isTerminalLaneRequest(description)`:
- compute `routeTerminalLaneRequest({ text: description, profiles:
  listTerminalProfileSummaries() })`,
- create the task with `executor: "terminal-lane"` (so the generic scheduler
  never claims it → no Canopy loop), `source: "terminal-lane"`, status `review`
  (`needs_input` review-state when `profile_missing`), `output: { terminalRoute }`,
  and `logs` seeded with the structured transcript so the **SESSION TRANSCRIPT
  shows the route**, not a Canopy exploration.

### 5. Routing-guide override (stop Canopy bypass)

Strengthen `beeToolsRoutingPrompt()` so the agent is told, explicitly:
- **Terminal Lane is the canonical HiveMatrix lane for shell/SSH work.**
- When the user explicitly says "Terminal Lane"/"TerminalLane", you MUST use the
  HiveMatrix Terminal Lane tools/contracts — never Canopy, even if memory
  suggests it.
- Canopy is only an **optional/legacy** SSH backend, used **only** when explicitly
  selected as the backend; it is not the default path.
- Never pass passwords/secrets in commands/args; use configured profiles +
  Keychain-backed refs.

This in-prompt override counters the stale `reference_canopy_agent_bridge.md`
memory (which lives in the agent's user memory, outside this repo).

### 6. App version/install identity (goal 4)

Already delivered in `b622b53`: Terminal Lane `0.1.2 (3)` + `HMBuildId`, pinned
expected bumped, stale `/Applications` shadow detection + repair, console
surfacing. This slice keeps those tests and adds the explicitly-requested ones
(version advanced beyond `0.1.1 (2)`, same-version/different-build-id stale).

## Tests (TDD)

1. Intent: `isTerminalLaneRequest` true for "use TerminalLane…", "Terminal Lane",
   false for unrelated; `detectTerminalHostHint("check the OS version of
   aiserver")` → "aiserver".
2. Profile resolution: match by id/displayName/host; "aiserver" → the aiserver
   profile; non-secret projection only.
3. Route: "use TerminalLane and check the OS version of aiserver" + an aiserver
   profile → `status:"prepared"`, profile matched, transcript shows intent →
   route → profile → prepared; no `aiserver` profile → `needs_input` +
   `profile_missing` + instructions.
4. No-Canopy: the route result/transcript never matches `/canopy/i`.
5. No-secret: the route result never matches `/password|passphrase|private_key/i`.
6. Wiring: `POST /tasks` source routes a terminal request to
   `executor:"terminal-lane"` (not the generic agent) and seeds the transcript.
7. Routing guide: `beeToolsRoutingPrompt` says Terminal Lane is canonical and
   Canopy is optional/legacy-only.
8. App identity (kept/added): version advanced beyond `0.1.1 (2)`; stale-copy +
   shadow tests (from `b622b53`) stay green.

## Non-goals honored

No password autotyping; no credentials outside Keychain; no arbitrary shell
endpoint (the route only *prepares* a profileId-keyed work item); Canopy support
is not removed (kept as optional/legacy); Browser Lane unchanged except shared
lane status code (none needed here). iOS untouched (no consumed contract changes).

## Gates

- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- Build/package Terminal Lane; install locally; verify Settings shows `0.1.2 (3)`.
- Manual smoke: create "use TerminalLane and check the OS version of aiserver";
  confirm it routes to Terminal Lane (prepared, aiserver profile) and shows no
  Canopy discovery loop.
