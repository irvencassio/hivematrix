# Frontier Provider Toggles (Claude / Codex) Design

## Context

HiveMatrix supports two frontier providers — **Claude** (Claude Code CLI) and
**Codex** (OpenAI/ChatGPT CLI) — plus a local Qwen tier. Today a provider is
"available" purely as a side effect of its CLI binary being found on disk
(`findBinary("claude" | "codex")` in `src/lib/config/binary-detection.ts`), and
the only operator control is a single either/or **primary provider** dropdown
(`#s_frontier_provider_row`, `console.ts:947-956`) that is enabled only when
*both* CLIs are already configured. There is no way to deliberately turn a
provider on or off as a first-class choice.

Two structural facts shape this work:

1. **Providers are hardcoded to exactly two everywhere.** The union types
   `FrontierProvider = "claude" | "codex"` (`available.ts:259`) and
   `BackendId = "local" | "claude" | "codex"` (`backends.ts:20`) thread through
   Usage (two hardcoded cards + two subscription blocks, `console.ts:5014-5063`),
   backend detection (`backends.ts:68-85`), the model registry
   (`available.ts:80-147`), and routing (`model-resolver.ts:45-54`). The Usage
   summary and the onboarding detail-string regex (`console.ts:4203-4204`) both
   assume the two literal providers.

2. **There is no installer, and install ≠ auth.** Nothing in the codebase runs
   `npm install -g`. Claude has an in-app *login* launcher that writes a zsh
   script and opens it in Terminal (`src/lib/usage/claude-auth-login.ts`,
   endpoint `POST /claude/auth/login`, `server.ts:774-776`); **Codex has no
   equivalent** — only instructional text. Installing a CLI does not
   authenticate it: without `claude auth login` / `codex login`, Usage reads
   0% and every frontier task fails. So "toggle on → it gets installed" must
   mean **install *and* prompt login**, and login is an interactive step the
   operator completes in Terminal.

The one piece of existing machinery we reuse rather than reinvent: skills and
commands already carry a per-provider compatibility tag —
`SkillHarness = "claude" | "codex" | "qwen" | "all"` (`skills/contracts.ts:13-14`,
`skillRunsOn()` at `98-99`) and `LocalCommandCompat` (`commands/contracts.ts:21`).
"Hide Codex-only skills when Codex is off" is therefore a catalog filter, not a
new tagging axis.

## Approved Approach

Introduce **two independent per-provider toggles** (Claude, Codex) in
Settings → Models. Toggling is the operator's explicit enable/disable of a
provider *within HiveMatrix*; it is separate from — and layered on top of —
binary detection.

Decisions locked with the operator (2026-07-09):

- **Toggle ON, CLI missing** → write a script that runs the install **and** the
  login, open it in Terminal (reusing the existing Claude-login pattern), and
  flip the provider to "on" once binary + auth are detected. Requires adding a
  **Codex install+login launcher** mirroring the Claude one.
- **Toggle OFF** → **disable in HiveMatrix only.** Gate the provider out of
  Usage, Observability, Models, Skills & Commands, and routing. The global CLI
  stays installed and logged in for the operator's own terminal use. Fully
  reversible by re-toggling — no reinstall.
- **Both ON** → keep an explicit **primary-provider selector** to arbitrate,
  with role→model overrides on top (today's `frontierProvider` semantics,
  surfaced only when both are enabled).
- **Both OFF** → local-only (Qwen) mode; frontier surfaces degrade cleanly to
  "no frontier provider enabled" rather than showing empty/zeroed cards.

The toggle is an **enablement gate**, not an install-state mirror. A provider
can be "enabled" but not-yet-installed (mid-setup) or "disabled" but still
installed. The UI must render all four quadrants honestly.

---

## 0. Verified facts (resolved before implementation — do not re-litigate)

These were checked against the codebase on 2026-07-09. An implementer should
treat them as given.

- **`POST /claude/auth/login` has exactly one caller** — `console.ts:5179`
  (internal). No Swift/iOS/external caller (`grep -rn "claude/auth/login"`
  across `src/` and all `*.swift` returns only the server route + this one
  console call). ⇒ **Rename it to `POST /providers/:id/setup` outright; no
  back-compat alias is needed.** Update the single console caller.

- **Install commands are asymmetric.** This is real, not an oversight to
  "fix":
  - **Codex** has a canonical npm install used in-app copy today:
    `npm install -g @openai/codex`, then `codex login` (`console.ts:1611`).
    Both are scriptable → Codex gets a full install+login `.command`.
  - **Claude** is *not* auto-installed today. `backends.ts:74` points the
    operator to `https://claude.com/claude-code` and the existing launcher
    only scripts `claude auth login` (`claude-auth-login.ts` `buildAuthScript`).
    The canonical package is `npm install -g @anthropic-ai/claude-code`, but
    because the current app deliberately does login-only, the Claude
    `.command` should: check for the binary; **if missing**, run
    `npm install -g @anthropic-ai/claude-code` (best-effort) *and* echo the
    website URL as the fallback; then run `claude auth login`. Preserve the
    exact working login invocation from `buildAuthScript`.

- **The existing Claude login script** (`claude-auth-login.ts`) is the
  template to generalize: it writes `~/.hivematrix/<...>.command` (mode 0700),
  sets `PATH` via `buildCliPath()`, runs the flow, waits on `read -r _`, and
  `open`s it. Keep this shape verbatim; only parameterize the install/login
  lines and the filename per provider.

---

## 1. Config schema & source of truth

Add a persisted per-provider enablement block to `~/.hivematrix/config.json`,
alongside the existing `features` and `frontierProvider` keys.

```jsonc
{
  "providers": {
    "claude": { "enabled": true },
    "codex":  { "enabled": false }
  },
  "frontierProvider": "claude"   // primary; only meaningful when >=2 enabled
}
```

New module `src/lib/config/providers.ts` (parallels `features.ts`):

- `type FrontierProviderId = "claude" | "codex"` (re-export the existing
  `FrontierProvider`; keep one canonical definition to avoid drift).
- `FRONTIER_PROVIDERS: FrontierProviderId[]` — the single ordered list every
  hardcoded two-provider site iterates instead of literals.
- `isProviderEnabled(id): boolean` — default when key absent:
  **enabled if the binary is currently detected, else disabled.** This makes
  first-run behavior identical to today (an already-installed `claude` shows
  up) without a migration, and means a fresh machine starts with both off until
  the operator toggles.
- `setProviderEnabled(id, enabled)` — atomic merge write (copy `features.ts`
  `setFeature` pattern, `features.ts:86-93`).
- `getEnabledProviders(): FrontierProviderId[]` — used by every gate below.

Default-resolution rule is deliberately "detected ⇒ enabled" only as the
*absent-key* fallback; once the operator toggles, the explicit stored value
wins regardless of detection, so a disabled-but-installed provider stays hidden.

## 2. Backend detection becomes enablement-aware

`detectBackends()` (`backends.ts:63-88`) today reports `configured` = binary
found. Extend each `BackendStatus` with:

- `installed: boolean` — the current `configured` meaning (binary on disk).
- `enabled: boolean` — from `isProviderEnabled(id)`.
- `configured: boolean` — **redefine as `installed && enabled`** so every
  existing downstream `.configured` check (model registry, routing) transparently
  respects the toggle with no call-site changes. This is the key leverage point:
  flip the definition once, and Models/routing/registry gate for free.

Keep `installed` separate so the Settings UI can distinguish "off" from
"not installed yet."

## 3. Install + login launchers (the net-new backend work)

### 3a. Generalize the Claude launcher

Refactor `src/lib/usage/claude-auth-login.ts` into a provider-parameterized
`src/lib/usage/provider-setup.ts`:

- `writeProviderSetupCommand(id, { install, login }): string` — writes
  `~/.hivematrix/<id>-setup.command`, a zsh script that:
  1. checks whether the binary is present (`findBinary`);
  2. if missing and `install` requested, runs the install command;
  3. runs the login command;
  4. prints a clear "you can close this window when done" footer.
- Per-provider command table (see §0 — the two are deliberately asymmetric):
  - **codex**: install `npm install -g @openai/codex`; login `codex login`.
    Full install+login script.
  - **claude**: if binary missing, best-effort `npm install -g
    @anthropic-ai/claude-code` **and** echo `https://claude.com/claude-code`
    as the manual fallback; login `claude auth login` (preserve the exact
    invocation from today's `buildAuthScript`). Login-first is the primary
    path since most operators already have Claude installed.
- `openProviderSetup(id)` — `open`s the `.command` in Terminal (reuse the
  existing `open` path, `claude-auth-login.ts:71`).

### 3b. Endpoints

- Replace `POST /claude/auth/login` (`server.ts:774-776`) with
  `POST /providers/:id/setup` (accept `{ install?: boolean }`; server decides
  install-needed by detection if omitted). **No back-compat alias** — the only
  caller is `console.ts:5179` (verified, §0); update it in the same change.
- `GET /providers` — returns, per provider: `{ id, installed, enabled,
  authPresent }`. `authPresent` reuses the existing auth probes
  (`readCodexAuthState`, `server.ts:1808`; Anthropic OAuth via the subscription
  reader). This is what the toggle UI polls to flip from "enabling…" to "on."
- `POST /providers/:id/enabled` `{ enabled }` → `setProviderEnabled`, then
  broadcast a `providers:changed` event so Usage/Models/Skills re-render.

### 3c. Toggle-on orchestration

When the operator flips a provider ON:

1. `POST /providers/:id/enabled {enabled:true}` persists intent immediately
   (UI shows the toggle on, with an "installing / sign in in Terminal" sub-state).
2. If `!installed || !authPresent`, client calls `POST /providers/:id/setup`
   → Terminal opens.
3. Client polls `GET /providers` (or listens for a detection refresh) until
   `installed && authPresent`; then the sub-state clears and Usage/Models light
   up. If the operator never completes login, the provider stays "enabled but
   not ready" and frontier surfaces show a "finish setup" affordance rather than
   a zeroed card.

Toggle-off is synchronous: persist `enabled:false`, broadcast, done. **No
uninstall, no logout** — the binary and its credentials are left untouched.

## 4. Settings → Models UI

Replace the single `#s_frontier_provider_row` select with a
**`#s_provider_toggles`** block: one row per `FRONTIER_PROVIDERS` entry, each a
standardized toggle (follow `2026-06-25-settings-toggle-standardization` and the
`settingsFeatures` toggle markup, `console.ts:1140-1147`). Each row shows:

- provider name + toggle;
- a status chip driven by `GET /providers`: `On`, `Off`, `Enabling — sign in
  in Terminal`, `On — needs sign-in`, `Not installed`.

The **primary-provider select** (today's `frontierProvider` dropdown) is
retained but shown **only when ≥2 providers are enabled** — its job is now
purely arbitration between enabled providers, not enable/disable. Reuse the
existing visibility helper (`console.ts:6086-6094`), re-keyed off
`getEnabledProviders().length >= 2` instead of `hasBothFrontier` (binary
presence).

Role→model selectors (`#s_role_models`, `console.ts:958-971`) filter their
options to enabled providers via `buildRoleModelOptions`
(`available.ts:335-358`) — a role pinned to a now-disabled provider falls back
to the primary enabled provider (or local, if none), surfaced with a small
"was <provider>, now <fallback>" note rather than silently.

Fix the fragile onboarding detection at `console.ts:4203-4204` (regex over the
detail string) to read structured `GET /providers` instead.

## 5. Usage screen gating

`console.ts:5010-5077` renders two hardcoded provider cards and two hardcoded
subscription blocks. Rewrite as an **iteration over `getEnabledProviders()`**:

- For each enabled provider, render its usage card
  (`usageProviderCard(name, win, statusNote)`, `console.ts:4910-4922`) and
  detailed subscription rows. A provider that is enabled-but-not-ready renders a
  "finish sign-in" card instead of a percentage.
- Disabled providers render nothing — no card, no breakdown row.
- `getFrontierUsage()` (`src/lib/usage/frontier-usage.ts:33-39`) should only
  gather subscription data for enabled providers (skip `readCodexUsageProfile`
  when Codex is disabled, skip the Anthropic subscription read when Claude is
  disabled) so we don't do work or leak a disabled provider's numbers.
- **Both-off:** render a single "No frontier provider enabled — running local
  (Qwen) only. Enable Claude or Codex in Settings → Models." panel.

`u.byModel` task rows (`console.ts:5066-5071`) filter to models whose provider
is enabled (map model id → provider via `catalog.ts` `isCodexModel` /
`claudeAliasId`).

## 6. Observability gating

Per-run telemetry already carries `provider` (`observability/store.ts:28,58-62`)
and rolls up by `(provider, project, day)` (`71-86`). The store keeps recording
everything (historical integrity), but the **rendered** views filter to enabled
providers:

- Route scorecard (`console.ts:2741-2770`) and the obs dashboard
  (`console.ts:2873`, `/observability/series`) exclude rows whose `provider` is
  disabled.
- A disabled provider's historical rows are retained on disk and reappear if it
  is re-enabled — disabling is a view filter, never a data delete.

## 7. Skills & Commands catalog gating

Reuse the existing `compat` machinery. Define provider-eligibility as:

> A skill/command is shown if its `compat` includes at least one currently
> **enabled** harness, treating `qwen`/local and `"all"` as always eligible.

- Skills: extend `listSkills()` / `listSkillsFor()` (`skills/store.ts:38,64-66`)
  with a catalog-level filter `skillEnabledByProviders(compat, enabledProviders)`
  built on `skillRunsOn` (`contracts.ts:98-99`). A `compat:["claude","codex"]`
  skill survives while either is on; a `compat:["codex"]` skill disappears when
  Codex is off; a `compat:[]`/`["all"]`/`["qwen"]` skill always stays.
- Commands: same filter over `LocalCommandCompat` in `scanLocalCommands`
  (`commands/local-catalog.ts:98`) / the catalog endpoints
  (`server.ts:3258/3285/3318`).
- Apply the filter at the **catalog-read layer** so every surface (New Task
  "Use a skill" picker `console.ts:1697-1702`, Settings → Skills & Commands, the
  local-agent skill filter `orchestrator/generic-agent.ts:133`) inherits it
  without per-caller changes.

## 8. Routing & model registry

- `buildAvailableModels(backends)` (`available.ts:80-147`) already keys off
  `backend.configured`; with §2's redefinition (`configured = installed &&
  enabled`), disabled providers automatically drop to greyed placeholders
  (`111-117`). Verify the `hasFrontier` computation (`available.ts:123`) uses the
  new `configured` so `mixed`/`cloud-only` models require an *enabled* frontier.
- `availableFrontierProvider(cfg, backends)` (`model-resolver.ts:45-54`): the
  claude→codex fallback chain must skip disabled providers and honor
  `frontierProvider` only among enabled ones. When both enabled, primary wins,
  then the other as fallback; when one enabled, it is forced; when none,
  frontier tiers resolve to local (`resolveModelId` returns the local model and
  routing stays on the Qwen tier).
- `routeByRole` (`router.ts:39`) / connectivity `mode`: both-off should behave
  like `local-only` mode without the operator having to set it — but do **not**
  silently overwrite an explicit `cloud-ok` setting; instead treat "no enabled
  frontier" as "no cloud capacity available" in `canUseCloud` (`router.ts:91`),
  the same branch used when usage is exhausted.

## 9. Both-off degradation checklist

Every frontier surface must have a defined empty state:

- Usage → single "local only" panel (§5).
- Observability → frontier rows empty; local rows still shown.
- Models → role selectors offer local models only; primary-provider select
  hidden; default-model list has no frontier entries (greyed placeholders OK).
- New Task → still works, routes to local; no "cloud-ok" pill implying frontier.
- Skills/Commands → only `qwen`/`all` entries.
- Top-of-console status pill → reads `local` (existing vocabulary), never
  `cloud-ok`.

---

## Files touched (map)

| Area | File | Change |
|---|---|---|
| Config | `src/lib/config/providers.ts` (new) | enablement store, `FRONTIER_PROVIDERS`, getters/setters |
| Config | `src/lib/config/binary-detection.ts` | unchanged (still the install probe) |
| Backends | `src/lib/models/backends.ts:20,63-88` | add `installed`/`enabled`; redefine `configured` |
| Setup | `src/lib/usage/provider-setup.ts` (new, from `claude-auth-login.ts`) | parameterized install+login launcher; add Codex |
| Registry | `src/lib/models/available.ts:80-147,123,259-270` | iterate `FRONTIER_PROVIDERS`; enabled-aware `hasFrontier` |
| Routing | `src/lib/routing/model-resolver.ts:45-54` | skip disabled in fallback chain |
| Routing | `src/lib/routing/router.ts:91` | both-off ⇒ no-cloud branch |
| Usage | `src/lib/usage/frontier-usage.ts:33-39` | gather only enabled providers |
| Skills | `src/lib/skills/store.ts:38,64-66` | provider-eligibility filter |
| Commands | `src/lib/commands/local-catalog.ts:98` | same filter |
| Server | `src/daemon/server.ts` | `GET /providers`, `POST /providers/:id/enabled`, `POST /providers/:id/setup`; **rename** `/claude/auth/login` (no alias); usage/obs/skills endpoints respect enablement |
| Console | `src/daemon/console.ts` | provider toggles UI (§4); usage iteration (§5); obs filter (§6); skill picker filter (§7); fix detection regex (§4); both-off states (§9) |

## Testing

- **Unit:** `providers.ts` default-resolution (absent key ⇒ detection; explicit
  value wins); `configured = installed && enabled` truth table;
  `availableFrontierProvider` across all four on/off quadrants; skill/command
  eligibility filter for `[]`,`["all"]`,`["qwen"]`,`["claude"]`,`["codex"]`,
  `["claude","codex"]` under each enablement combo.
- **Server (grep-invariant style, cf. `server.test.ts`):** `GET /providers`
  shape; `POST /providers/:id/enabled` persists + broadcasts; disabled provider
  absent from `/usage` and `/observability` render payloads; `/skills` catalog
  excludes single-provider skills when that provider is off.
- **Both-off:** frontier tiers resolve to local; New Task creates a local task;
  no zeroed frontier cards.
- **Setup launcher:** `writeProviderSetupCommand` emits the correct install +
  login lines per provider and is idempotent (skips install when binary present).

## Out of scope / non-goals

- **No uninstall / logout on toggle-off** (explicit decision) — disabling is a
  HiveMatrix-side gate only.
- **No silent in-app `npm install`** — install always runs visibly in Terminal
  so failures and auth are observable.
- **No third provider** — the code is generalized to iterate a provider list so
  a future provider is additive, but none is added here.
- Auth-state deep health (token expiry warnings, re-login nudges) beyond the
  existing `authPresent` probe — future work.

## Open risks

- **Detection latency after login:** the operator finishes `codex login` in
  Terminal but the daemon caches detection. Ensure `GET /providers` /
  `detectBackends()` are not over-cached, or add a "refresh" affordance next to
  the toggle (the Models panel already has `refreshModelsNow()`,
  `console.ts:5154`).
- **Role model pinned to a disabled provider** must fall back visibly (§4), not
  error at task-create time.
- **`frontierProvider` staleness:** if the primary points at a now-disabled
  provider, arbitration must fall back to the remaining enabled one and the
  stored primary should be corrected on next enable-state change.

---

## Build plan for the implementing session

Execute in this order. Each phase is independently committable, has a checkpoint
that must pass before moving on, and touches a bounded set of files. Do **not**
skip ahead — later phases assume earlier invariants hold. Run `npm run build` /
the test suite (`node --test` per repo convention) after every phase.

**Phase 1 — Config layer (no UI, no behavior change yet).**
- Create `src/lib/config/providers.ts` per §1: `FRONTIER_PROVIDERS`,
  `isProviderEnabled` (absent-key default = "detected ⇒ enabled"),
  `setProviderEnabled` (atomic merge, copy `features.ts:86-93`),
  `getEnabledProviders`.
- Unit tests: default-resolution truth table; explicit value overrides
  detection.
- **Checkpoint:** tests green; nothing else references the module yet.

**Phase 2 — Backend enablement (the leverage point).**
- Extend `BackendStatus` with `installed` + `enabled`; redefine
  `configured = installed && enabled` (§2). `installed` = the old binary probe.
- Unit test the truth table across all four (installed × enabled) combos.
- **Checkpoint:** existing model-registry / routing tests still pass with a
  provider *enabled* (i.e. no regression when both toggles default on because
  binaries are present). This proves the redefinition is transparent.

**Phase 3 — Setup launcher generalization.**
- Refactor `claude-auth-login.ts` → `src/lib/usage/provider-setup.ts` with
  `writeProviderSetupCommand(id, opts)` + `openProviderSetup(id)` (§3a, §0
  command table). Add the Codex script; keep Claude's login invocation verbatim.
- Unit test: emitted script contains the correct install + login lines per
  provider; idempotent (no install line when binary present).
- **Checkpoint:** tests green; old `startClaudeAuthLogin` behavior reproduced
  for `id="claude"`.

**Phase 4 — Server endpoints.**
- Add `GET /providers`, `POST /providers/:id/enabled` (persist + broadcast
  `providers:changed`), `POST /providers/:id/setup`. Rename
  `/claude/auth/login` → `/providers/:id/setup`; update `console.ts:5179`.
- Make `getFrontierUsage` gather only enabled providers (§5); make
  `/observability` + `/skills` + `/commands` catalog reads apply the enablement
  filter (§6, §7).
- Grep-invariant server tests (cf. `server.test.ts`): `/providers` shape;
  enable persists; disabled provider absent from `/usage` and `/skills`
  payloads.
- **Checkpoint:** with Codex disabled via config, `curl /usage` shows no Codex
  block and `/skills` drops `compat:["codex"]` entries; Claude unaffected.

**Phase 5 — Console UI.**
- Provider toggles block (§4) replacing `#s_frontier_provider_row`; primary
  select shown only when ≥2 enabled; role selectors + fallback notes; fix the
  `console.ts:4203-4204` detection regex to read `GET /providers`.
- Usage iteration over enabled providers (§5); obs filter (§6); skill-picker
  filter inherited from the catalog read (§7); every both-off empty state (§9).
- **Checkpoint (manual, in-app):** toggle Codex off → its Usage card, obs rows,
  and Codex-only skills disappear; toggle on → Terminal opens for
  install/login, and after sign-in + refresh the surfaces return. Toggle both
  off → single "local only" panel, status pill reads `local`, New Task still
  creates a local task.

**Phase 6 — Routing edges & polish.**
- `availableFrontierProvider` skips disabled + honors primary among enabled
  (§8); `router.ts` both-off ⇒ no-cloud branch; correct a stale
  `frontierProvider` on enable-state change (open risk #3).
- Tests for all four quadrants of provider enablement → resolved model/tier.
- **Checkpoint:** four-quadrant routing tests green; both-off resolves to the
  local model without an explicit `local-only` mode set.

### Global acceptance criteria (feature is done when all hold)

1. Two independent toggles in Settings → Models; state persists across daemon
   restart.
2. Toggling a provider ON with its CLI missing opens Terminal with the correct
   install + login; the toggle reaches steady "on" only after binary + auth are
   detected.
3. Toggling OFF removes the provider from Usage, Observability, Models role
   selectors + default list, and the Skills/Commands catalog (provider-only
   entries), and stops routing to it — **without** uninstalling the CLI or
   clearing its credentials.
4. Both ON → primary-provider selector visible and arbitrates; role overrides
   honored.
5. Both OFF → clean local-only degradation everywhere in the §9 checklist; no
   zeroed/empty frontier cards, no `cloud-ok` pill.
6. A `compat:["claude","codex"]` skill survives while either provider is on;
   `["qwen"]`/`["all"]`/`[]` skills always survive.
7. No regression for the current default state (both installed ⇒ both enabled
   ⇒ today's behavior).

### Guardrails for the implementer

- **Do not uninstall or log out** on toggle-off. Ever. (Explicit operator
  decision.)
- **Do not run `npm install` silently in-process** — install runs only inside
  the Terminal `.command` the operator can see.
- **Do not delete observability history** for a disabled provider — filter the
  view, keep the rows.
- **Do not invent a third provider or a new compat axis** — iterate
  `FRONTIER_PROVIDERS` and reuse the existing `compat` field.
- If any assumption here conflicts with what you find in the code, **stop and
  surface it** rather than guessing — this spec was written against the code as
  of commit `0da38a4` (0.1.159).
