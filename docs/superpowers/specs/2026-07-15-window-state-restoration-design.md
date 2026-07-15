# Window State Restoration — Design

## Problem (operator ask, dispatched task `8f2f049384564c148bbdc399`)

When HiveMatrix relaunches, restore the previous window state: window position (X/Y),
window size (width/height), active sidebar view (Chat/Roles/Tools/Goals/Board/etc.),
scroll position in the active view, and the active conversation/context if the active
view was Chat. Ticket suggests: save on quit or periodic background save, persist to
local storage, restore all of the above on launch, "use standard macOS window
restoration patterns (NSWindow.frameAutosaveName)."

Ticket note: this should land only after the state-corruption bug (task
`0091ba25fa4c49a4b8b084f0`) is fixed, so restoration doesn't preserve corrupted state.
**Verified before starting:** that task is the same bug as the already-committed fix
`3adf9120` ("Flash chat state corruption on sidebar navigation") — confirmed via the
board API (`GET /tasks`, task `0091ba25fa4c49a4b8b084f0`, `status: "review"`) and
`known-issues.md`'s matching RESOLVED entry for the identical repro. The prerequisite
is satisfied (fixed, committed to `main`, unreleased — normal for this loop).

No human is available to answer clarifying questions in this session (autonomous
self-improvement dispatch — see memory `project-hivematrix-self-improvement-loop`).
This doc records what was verified against the running code and the reasoning behind
each design choice made in place of a live back-and-forth.

## Current state (verified against HEAD `3adf9120`, working tree clean, 4 commits
ahead of origin)

- **This is a Tauri 2 app, not raw AppKit.** `src-tauri/` wraps a webview that loads
  `http://127.0.0.1:3747` (redirects to `/console`) served by the daemon — confirmed by
  `src-tauri/src/lib.rs`'s own header comment: "The window UI is served by the daemon
  over http... Tauri IPC isn't available" in that origin. The ticket's suggested
  `NSWindow.frameAutosaveName` mechanism doesn't apply: there is no NSWindow subclass to
  attach an autosave name to — the single window is declared statically in
  `src-tauri/tauri.conf.json`'s `app.windows` array (fixed `1280×840`, no position) and
  instantiated by the Tauri framework itself at startup.
- `src-tauri/Cargo.toml` has no window-state plugin (`tauri = "2.11.2"`, sibling plugins
  already registered: `tauri-plugin-updater`, `-process`, `-deep-link`, `-log`, all via
  the same one-line `.plugin(...)` pattern in `src-tauri/src/lib.rs`'s `run()`).
- The entire client app is one big JS string (`CONSOLE_HTML` in
  `src/daemon/console.ts`, ~9741 lines), served raw and executed as browser JS — `tsc`
  never type-checks it, and it has zero Tauri API access (grepped `__TAURI__`/`tauri` —
  only prose comments, confirmed no `window.__TAURI__` calls exist).
- **No unified "current view" concept exists.** Six mutually-exclusive nav buttons
  (`console.ts:1795-1801`: Overview, Chat/Flash, Brain, Roles, Tools, Goals — "New task"
  is a transient form, not a view) each call a `show*()` function that flips five
  independent `_xState.panelOpen` booleans plus `state.selected`/
  `state.selectedSkillOrCommand`, then calls `syncNav()` (`console.ts:2112`) to
  re-derive which nav button is highlighted from that scattered state. There is no
  single variable holding "the active view" today.
  - Note on naming: the ticket's "Board" is not one of these six views — the task
    Kanban (`#board`, left rail) is *always* visible regardless of which of the six
    views is active in the center pane; "Overview" (`showOverview()`,
    `console.ts:2083`) is the actual default/no-selection center-pane state. Treating
    the ticket's "Board" as shorthand for "Overview" below.
- **No mechanism exists for client JS to learn the window/app is closing.** Grepped
  `console.ts` for `beforeunload|pagehide|visibilitychange|unload` — zero hits.
  Grepped `src-tauri/src/lib.rs` for `WindowEvent::CloseRequested|on_window_event` —
  zero hits; the Rust shell never forwards a close signal into the webview (and
  couldn't cheaply — no IPC channel exists into the plain-HTTP-origin webview content).
- `console.ts` already uses `localStorage` for exactly this class of UI-chrome
  preference (`hm_col_left`/`hm_col_right`, `hm_ctx_collapsed`, `hm_lanes_collapsed`,
  `hm_default_project`, per-section `hm_sec_<id>` toggles), all client-side,
  try/catch-wrapped, saved the instant the user changes something (not batched/on-quit).
- `_flashState.sessionId` (`console.ts:6829`) already IS "the active conversation" —
  `hydrateFlashThread()` (`console.ts:6823`) takes no session-id argument; it always
  fetches `GET /flash/session/current?peer=operator` (the server's own single-current-
  session model) and displays whatever that returns. There is no session picker UI and
  no client function to open an arbitrary *past* session — grepped `openFlashSession`,
  `switchFlashSession`, repo-wide: zero hits.
- Scrollable containers per view: Chat has one dedicated element
  (`#flashTranscript`, `console.ts:6767`). Tools and Goals both render into a `.tools-
  pane` div (`console.ts:7528`, `3111`) — unique in the DOM whenever either is open,
  since the two are mutually exclusive. Roles has *three* independently-scrollable
  sub-panes (`#rolesRosterList`, `#rolesDossierBody`, `#rolesPromptBody`). Overview and
  the always-visible Board both scroll via the same generic ancestor rule (`.col {
  overflow-y: auto }`, `console.ts:164`) with no per-view container to target.
- `console.test.ts` supports genuine behavioral TDD despite the no-jsdom, string-served
  script: `extractFunctionBlock(js, "name")` (`console.test.ts:38`) pulls one real
  function's source out of the script, `new Function(...)` rebuilds it with mocked
  globals passed as parameters (fake `document`, sibling functions as spies/stubs),
  and tests call the reconstructed function and assert on the mocks. Worked examples:
  `console.test.ts:681-726` (single function + mocked `document`),
  `console.test.ts:739-750` (function + a helper it depends on, both extracted
  together). This is the pattern all new client-side tests below will follow.
- Verification gates that actually cover this repo's TS/JS (`npm test`, `npm run
  typecheck`, `npm run scope-wall`) do **not** touch `src-tauri/` — grepped
  `scope-wall.mjs`, `package.json` scripts, `.github/workflows/*.yml` for
  `rust|cargo|src-tauri`: zero hits. The Rust change is verified separately via `cargo
  check`/`cargo build`, mirroring how the sibling plugins there (updater/process/
  deep-link) have no dedicated tests either — only pure helper functions in `lib.rs`
  (e.g. `is_replaceable_hivematrix_daemon_command`) get `#[cfg(test)]` coverage, and
  plugin *registration* is declarative wiring with nothing pure to unit-test.

## Design decisions

### 1. Window position/size mechanism

**Options considered:**
- (a) Hand-roll: Rust `WindowEvent` listener writes `{x,y,w,h}` JSON to the app's
  local-data dir on move/resize; read + apply on startup.
- (b) `tauri-plugin-window-state` — the official Tauri plugin for exactly this.
  Registering it (`.plugin(tauri_plugin_window_state::Builder::default().build())`,
  confirmed via the plugin's own README) automatically restores position/size/
  maximized state for every window declared in `tauri.conf.json` on next launch, no
  per-window code needed.
- (c) `NSWindow.frameAutosaveName` as the ticket suggests.

**Chosen: (b).** (c) doesn't apply to this app's architecture (no NSWindow to attach
to — see "Current state"). (a) reimplements what (b) already provides, adding new
Rust event-handling and file-I/O surface for a solved problem; the project's own
sibling plugins (updater/process/deep-link) already establish "register the official
plugin with `.build()`, one line" as the idiomatic pattern here. (b) is the standard
approach *for this codebase's actual stack*, matching the ticket's spirit ("use
standard... window restoration patterns") even though the concrete mechanism differs
from what the ticket assumed. Use plugin defaults (position + size + maximized) — no
`.with_state_flags()` customization; nothing in the ticket asks for tracking
decorations/fullscreen/visibility separately, and unused customization is exactly the
kind of unrequested complexity AGENTS.md asks to avoid.

Not a new "persistent store" requiring a DECISIONS.md entry: the plugin owns its own
UI-chrome state file (analogous to how `localStorage` already holds UI-chrome prefs
below, with no per-key DECISIONS.md entries) — it isn't a new domain concept under the
Event/Task/Directive/Policy/Persona kernel DECISIONS.md Q14 governs.

### 2. What counts as a restorable "view," and how is it saved

**Options considered:**
- (a) All six nav-triggered states (Overview, Chat, Brain, Roles, Tools, Goals).
- (b) Only the ones the ticket names literally ("Chat, Roles, Tools, Goals, Board") —
  drop Brain.
- (c) Also persist a *specific selected task/skill* within Overview.

**Chosen: (a), with (c) explicitly excluded.** Dropping Brain (b) would be an arbitrary
cut — it's wired through the exact same `show*()`/`panelOpen` mechanism as the other
four named views, at identical cost to include. (c) is excluded: it needs
still-exists/staleness validation for a persisted task id (the task could be completed,
deleted, or reassigned between sessions) that the other five views don't need, for a
capability the ticket doesn't ask for ("active sidebar view," not "active task
selection") — a clean candidate for a future follow-up if ever requested, not this one.

**Save mechanism options:**
- (a) Periodic snapshot (e.g. every 5s) plus best-effort on quit.
- (b) Write-through the instant the view changes.
- (c) Bridge a Tauri window-close event into the webview and save only then.

**Chosen: (b).** No close/quit signal reaches this webview today (see "Current state")
and building one (c) means new Rust→JS IPC plumbing (the webview runs in the daemon's
plain-HTTP origin, not a Tauri-IPC-enabled one) for a "nice-to-have" — real scope
creep. (a)'s periodic option adds a staleness window for no benefit once (b) is this
cheap: `localStorage.setItem` is synchronous, and every `show*()` function already
runs exactly when the view changes, so a one-line addition per function has strictly
better freshness than polling, at less complexity than either alternative. This also
matches the codebase's existing convention (`hm_ctx_collapsed` etc. save on the action,
not batched).

### 3. Scroll position

**Options considered:**
- (a) Uniformly, for all six views, via the generic `.col` ancestor.
- (b) Only for views with one unambiguous, dedicated scroll container: Chat
  (`#flashTranscript`), Tools and Goals (`.tools-pane`). Skip Roles (three candidate
  sub-panes — no single answer for "the" scroll position) and Overview/Board (both
  share the generic `.col` rule with no per-view element to target, and Overview is a
  small summary dashboard, not a long list — low value even if it were unambiguous).
- (c) Skip scroll restoration entirely, defer as follow-up.

**Chosen: (b).** (a) is genuinely ambiguous for two of six views (see above), not just
inconvenient. (c) drops an explicitly-requested capability without a forcing reason.
(b) delivers exactly what's unambiguous and cheap, via one small `view → CSS selector`
lookup table, and documents the Roles/Overview exclusion as a conscious, narrow cut
rather than an oversight.

**Timing options** (when is scroll position captured, and when is it safe to re-apply
on restore):
- (a) `scroll` event listener per container, save on every event (debounced).
- (b) Piggyback onto the existing `setInterval(refresh, 5000)` tick — refresh already
  runs every 5s regardless of view; save whichever view is currently active on each
  tick.

**Chosen: (b).** `scroll` events don't bubble, so a listener-per-container approach
means re-attaching a listener every time that panel's `innerHTML` is rebuilt (all three
targeted panels rebuild their DOM on every render) — real listener-lifecycle
complexity for marginal freshness gain over a 5s cadence, on a feature explicitly
scoped as "nice-to-have." (b) reuses scaffolding that already exists and runs on
exactly the right cadence, with zero new lifecycle management.

**Restore-timing problem:** Chat's content isn't in the DOM synchronously after
`showFlashPanel()` returns — `hydrateFlashThread()` is `async` (network round-trip)
and only calls `flashRenderMessages()` (which actually populates `#flashTranscript`)
once that resolves. Restoring `scrollTop` immediately after `showFlashPanel()` would
apply against an empty/short container and have no effect. Tools/Goals render
synchronously from already-loaded `state`, so they don't have this problem, but using
two different restore mechanisms (immediate for two views, deferred for one) is more
moving parts than one uniform mechanism.

**Chosen:** a single one-shot module-level flag, `_pendingScrollRestore` (same style
as the existing `_flashState`/`_rolesState` module-level state objects), set by the
boot-time `restoreLastView()` right before calling the view's `show*()` function, and
consumed (checked-and-cleared) at the tail of each of the three views' actual
content-render functions (`flashRenderMessages()`, `renderToolsPanel()`,
`renderGoalsPanel()` — the functions that run *after* data is ready, however long that
takes). This works identically for the sync and async cases, fires exactly once per
app launch (the flag is `null` the rest of the session, so normal mid-session
re-renders — e.g. every 5s Tools re-render, every SSE-pushed Chat message — are
untouched), and needs no `async`/`await` restructuring of `restoreLastView()` or the
existing `show*()` functions.

### 4. Active conversation restoration

**Options considered:**
- (a) Persist `_flashState.sessionId` to `localStorage`, and add a new client pathway
  to force-load that *specific* session's turns on restore (bypassing "current").
- (b) Do nothing new: rely on `hydrateFlashThread()`'s existing "current session"
  fetch, unconditionally invoked by `showFlashPanel()`.

**Chosen: (b) — no code.** There is no multi-conversation concept in this UI to
restore *among*: the server already exposes exactly one "current" session per operator
(`/flash/session/current?peer=operator`), and `_flashState.sessionId` is just a local
cache of whatever that endpoint last returned — it isn't an independent notion of
"the session the user picked." (a) would build a second, parallel "which session is
active" mechanism that duplicates, and could drift from, the server's own
already-correct "current" concept — a direct violation of "reuse the shared
scaffolding; don't re-roll it." Restoring to Chat on launch already means calling
`showFlashPanel()` like any other view-restore, and its existing
`hydrateFlashThread()` call already fetches the right (only) conversation. This
sub-requirement is satisfied by view restoration alone (design decision #2) with zero
additional code — worth stating plainly so it doesn't read as forgotten.

## Scope

**In scope:**
- `src-tauri/Cargo.toml` + `src-tauri/src/lib.rs`: register `tauri-plugin-window-state`
  (add via `cargo add` for a correctly resolved current version, not a hand-typed
  guess).
- `src/daemon/console.ts`:
  - `getStoredView()` / `setStoredView(view)` — read/write `hm_last_view`
    (validated against the six known view names, falling back to `"overview"`),
    plus updating an in-memory `_currentView` used by scroll save.
  - One-line `setStoredView(...)` call added to each of the six
    `show*()`/`showOverview()` functions.
  - `restoreLastView()` — boot-time dispatcher; reads the stored view and calls the
    matching `show*()` (no-op for `"overview"`, already the default render state).
    Wired into the top-level boot block (`console.ts:9718-9738`, inside `if
    (requireToken())`), placed after `refresh()` so board/task state is loaded first.
  - `SCROLL_TARGETS` lookup (`{flash: '#flashTranscript', tools: '.tools-pane', goals:
    '.tools-pane'}`), `saveScrollPosition(view)` / `restoreScrollPosition(view)`.
  - `_pendingScrollRestore` one-shot flag, set in `restoreLastView()`, consumed in
    `flashRenderMessages()` / `renderToolsPanel()` / `renderGoalsPanel()`.
  - `saveScrollPosition(_currentView)` added to the existing `refresh()` (5s tick).
- New tests in `src/daemon/console.test.ts` following the `extractFunctionBlock` +
  `new Function` + mocked-globals pattern for every new function above; boot-wiring
  and the six one-line `setStoredView` call-sites verified via source-text presence
  assertions (matching this file's existing lighter-weight regex-assertion style for
  simple wiring, e.g. the `hm_ob_mic_opened` marker check) rather than full behavioral
  extraction, since the boot block isn't inside a named function `extractFunctionBlock`
  can target.

**Explicitly out of scope** (see reasoning above): a specific selected task/skill
within Overview; Roles' three sub-pane scroll positions; Overview/Board scroll
position; a new "restore an arbitrary past Flash session" pathway; any Rust→JS
close/quit signal bridge; `.with_state_flags()` customization of the window-state
plugin.

**Verification limits, stated plainly:** this is a non-interactive, unattended
session. `cargo check`/`cargo build` confirms the Rust side compiles and the plugin is
correctly wired; the JS side gets real behavioral test coverage per above. What is
**not** done here: physically dragging/resizing the live app window, quitting, and
relaunching to eyeball the restored geometry. That would mean driving the operator's
actual Tauri window (built from this branch or not) with no one watching — plausible
to script via `osascript`/System Events, but risks visibly moving a real window and
touching live application state unattended for a "nice-to-have" feature. Left for the
operator to eyeball once after this ships, same as any other UI change in this loop
that isn't independently curl-verifiable against the daemon's own API.
