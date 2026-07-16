# Skills & Commands catalog: dedupe managed local mirrors — Design

## Dispatch as received

"Two identical 'brain-chat' entries in Skills & Commands: 1) brain-chat (skill) -
canonical version, 2) brain-chat (folder) - duplicate/leftover variant. Remove the
folder variant, keep the skill version. Verify no other duplicates exist."

## Investigation — the dispatch's own diagnosis and proposed fix are wrong

Verified against the live daemon (`GET /skills`, `GET /commands` on `:3747`), not
just source reading:

- `GET /skills` (53 entries) is the **brain-library** catalog:
  `<brain>/skills/*.md`, read via `src/lib/skills/store.ts#listSkills`.
- `GET /commands` (46 entries) is the **local profile catalog**: flat
  `~/.claude/commands/**/*.md` + folder `~/.claude/skills/<name>/SKILL.md`, read
  via `src/lib/commands/local-catalog.ts#scanLocalCommands`. This is documented in
  the file's own header as deliberately **separate** from the brain library:
  "these are pre-existing assets the profile runtime already resolves as `/name`
  slash commands... optionally import[able] into the brain library."
- `src/daemon/console.ts#skCatalog()` (~line 3661) builds the unified "Skills &
  Commands" list by `lib.concat(loc)` — a straight concatenation of both API
  responses, with **no de-duplication**.

**This is not brain-chat-specific.** `src/lib/skills/fanout.ts#fanOutSkills`
mirrors *every* trusted, compat-matched brain-library skill out to
`~/.claude/skills/<slug>/SKILL.md` (tracked in `~/.claude/skills/.hivematrix-managed.json`)
so Claude Code sessions can invoke them natively — that's its documented purpose
("portable, distilled recipes... writing the canonical skill to each compatible
target"). Cross-checking the live catalogs: **45 of 53 lib skills currently have a
same-named local-folder mirror and show as duplicate rows** — brain-chat is one
instance of a systemic display bug, not an isolated leftover. (8 lib skills have no
local mirror; 1 local skill, `developer-id-release`, has no lib counterpart — both
of those correctly show once today and must keep doing so.)

**The dispatch's proposed fix (delete the folder variant) would not hold and would
regress real functionality:**
1. `fanOutSkills` regenerates any managed mirror it no longer sees on the next
   `POST /skills/sync` or `POST /skills/fanout` run — a one-time file delete would
   silently reappear, so the "fix" wouldn't survive the system's own normal
   operation.
2. Until regenerated, deleting `~/.claude/skills/brain-chat/` breaks the *live*,
   already-working ability to invoke `/brain-chat` as a native Claude Code skill —
   confirmed: this very self-improvement session's own skill list includes
   `brain-chat`, sourced from that exact folder.
3. It doesn't generalize — the dispatch only names brain-chat, but the same
   "fix" would need to be repeated for the other 44 currently-duplicated skills,
   each one a live regression while it's missing.

The two rows are also not functionally identical while both exist — they drive
different run paths:
- **lib row → `POST /skills/:name/run`**: for instruction skills, creates a
  generic Task hardcoded to `project: "ops"`, `projectPath: process.cwd()`,
  description `"Apply this skill:\n\n<body>"` — the skill body is pasted into a
  task prompt for *some* agent to follow.
- **local row → `POST /commands/run`**: creates a Task whose description is
  literally `"/brain-chat <args>"`, with an operator-chosen `project`/
  `projectPath` — this is a genuine native slash-invocation, resolved by the
  Claude Code CLI itself against that project's `.claude/skills`.

This looked like it might make "just hide the local row" a real capability loss
(losing the only place to get a project-scoped *native* run). Checked directly
(background investigation, not assumed): **it is not.** There is no slash-command
detection gate anywhere in this codebase — `subprocess.ts` passes a standalone
task's `description` to the Claude Code CLI **verbatim** as the `-p` prompt,
against whatever `projectPath` was chosen; the CLI itself (not HiveMatrix) resolves
a prompt starting with `/<name>` against that project's `.claude/commands` /
`.claude/skills`. The plain New Task composer (`t_desc` textarea → `createTask()` →
`POST /tasks`) has no slash interception either. So typing `/brain-chat some args`
directly into the ordinary New Task box, with any project selected, reproduces
`/commands/run`'s exact mechanism today, with or without a dedicated "local" row in
this catalog. The Skills & Commands panel's local-row Run button is a convenience
shortcut (pre-filled project picker), not the only path to native project-scoped
execution.

## Root cause

`skCatalog()` merges two catalogs that are allowed by design to contain the same
skill under two provenances (brain-library-authored-then-fanned-out, or
local-authored-then-imported-via-`POST /skills/import-local`), with no awareness
of that overlap. The bug is the **display layer**, not the presence of both files.

## Approaches considered

**A. Delete the local mirror file(s).** Rejected — see above: doesn't hold
(fan-out regenerates it), breaks live skill invocation in the gap, doesn't
generalize past brain-chat without repeating the same regression 44 more times.

**B. Dedupe in `skCatalog()`: when a local `kind:"skill"` entry is a
HiveMatrix-managed mirror (present in `.hivematrix-managed.json` for that skills
dir) of a lib skill that's still visible in the catalog, drop the local row and
keep the lib row.** Reuses the manifest concept `fanout.ts` already owns (no new
persistent store — satisfies AGENTS.md's complexity budget); zero files deleted,
so nothing to regenerate-and-reappear; generalizes to all 45 current instances at
the root cause instead of one at a time. Since (confirmed above) the local row's
distinct capability — native project-scoped run — remains fully reachable via the
plain New Task composer regardless of whether this catalog shows a dedicated row
for it, this loses no real functionality, only a convenience shortcut for the
managed-mirror case specifically (the 8 lib-only and 1 local-only skills are
untouched and keep their single row, including its Run button, exactly as today).

**C. Same as B, but also surface a secondary "Run natively as /name (choose
project)…" control inside the surviving lib row's panel**, reusing
`_localCmdPanelHtml`'s existing project-picker markup. Zero convenience loss too,
but touches more surface (both panel-render functions, plus wiring a second run
path into one panel) for a capability that's already one text field away in the
New Task composer. Given B already has no functional regression, C's extra
surface isn't earning its complexity — AGENTS.md: "extend an existing primitive
instead of adding one," not add UI surface nothing in the dispatch asked for.

## Decision: Approach B

Dedupe `skCatalog()` by dropping a local `kind:"skill"` row when it is
HiveMatrix-managed **and** a same-named lib row is present. Implementation:

1. `src/lib/skills/fanout.ts`: export the existing `readManifest(dir)` (already
   implemented, currently module-private) — no behavior change, just visibility.
2. `src/lib/commands/contracts.ts`: add `managed: boolean` to `LocalCommand`;
   thread it as a new required parameter into `parseSkillManifest` (same style as
   the existing `bundledFileCount` parameter — pure function, no I/O). Flat
   commands (`parseCommandFile`) always pass/set `managed: false` — fan-out never
   targets flat commands, only folder skills.
3. `src/lib/commands/local-catalog.ts`: `scanSkills(root, out)` reads
   `readManifest(root)` once (same `root` it already scans — the profile's
   `<configDir>/skills`, which for the default profile is exactly the dir
   `fanOutSkills`'s `"claude"` target writes), builds a `Set`, and passes
   `managedSlugs.has(d.name)` into `parseSkillManifest`. Missing manifest (no
   fan-out has ever run against this profile) → empty set → `managed: false`
   everywhere, same graceful-degradation behavior `readManifest` already has.
4. `src/daemon/console.ts`: `skCatalog()` — before mapping `_commands` into `loc`
   rows, filter out any `c.kind === 'skill' && c.managed && libNames.has(name)`
   where `libNames` is the lowercased set of current `_skills[].name`. This is the
   one place that actually removes a row from what the operator sees; everything
   upstream (both APIs, both files on disk) is untouched.

No DECISIONS.md entry needed — no new persistent store, no new orchestration
primitive, no new product concept. `.hivematrix-managed.json` already exists and
is already the authoritative "HiveMatrix owns this local file" signal; this reuses
it for a second read-only purpose.

## Non-goals / explicitly out of scope

- Not changing what `/skills/:name/run` or `/commands/run` do.
- Not merging the two run affordances into one panel (Approach C, rejected above).
- Not touching `fanOutSkills`, `/skills/import-local`, or the manifest format.
- Not addressing the 8 lib-only or 1 local-only skills — they already show once
  today and this change must not affect them (covered by a regression test).

## Verification plan

- New unit tests: `fanout.ts` export visibility (trivial), `contracts.ts`
  `parseSkillManifest` `managed` threading, `local-catalog.ts` `scanSkills`
  manifest-driven `managed` flag (managed dir present / absent / partial).
  `console.test.ts`: `skCatalog()` source-structure assertions (this repo's
  established static-assertion pattern — no jsdom) proving (a) a
  `managed:true` local skill with a matching lib name is filtered out, (b) a
  local skill with `managed:false` (untouched user skill, e.g.
  `developer-id-release`) is kept, (c) a lib skill with no local mirror is kept,
  unaffected.
- Manual live check post-fix: re-run the same `GET /skills` + `GET /commands`
  overlap script used during investigation against the merged `skCatalog()`
  logic (port the filter into a throwaway Node check) — expect the 45-row
  overlap to collapse to 0, `developer-id-release` and the 8 lib-only skills
  still present exactly once each.
- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` — all zero
  errors/violations, independently re-run (not trusted from a subagent's
  self-report).
