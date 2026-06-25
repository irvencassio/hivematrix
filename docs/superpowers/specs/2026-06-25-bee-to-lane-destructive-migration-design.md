# Bee→Lane Destructive Migration Design

## Context

The Bee→Lane rename has been taken as far as it can go *additively*. Already shipped
(all behaviour-preserving, full suite green, scope-wall clean):

- Operator/console/voice copy → lane wording; user guide + whole brain guide set refreshed.
- Kind-level service layer moved to `src/lib/lanes/*` with `src/lib/bees/*` alias facades.
- Config writes `laneServices`, reads `laneServices ?? beeServices`.
- Tool ids advertised as lane-native (`desktop_action`, `terminal_run`, `mail_send`,
  `message_send`, …); legacy bee ids accepted on dispatch via `LANE_TOOL_ALIASES` and the
  `/bee/:tool` route.
- Central worker protocol accepts lane vocabulary on input: `normalizeWorkerKind` maps
  `message`/`mail`/`browser`/`desktop`/`terminal`/`memory`/`review` → the persisted kind,
  and the external parsers read `lane ?? bee`.

What remains is **destructive and touches a live system** (persisted DB rows, a signed +
notarized app bundle, auto-update). These were deliberately deferred by the original handoff
("only then consider removing old names in a later migration") and should NOT be done as a
blind sweep. This doc is the plan; **execution needs explicit sign-off** because each item is
hard to reverse on the running daemon.

## Out of scope here (the safe additive work is done)

- Renaming internal `src/lib/<x>bee/` module directories (mailbee, messagebee, termbee, …) to
  lane names. This is large but non-destructive (code organization only; persisted `kind`
  string literals stay). It can follow the proven `lib/bees → lib/lanes` facade pattern at any
  time and does not need this migration's data/bundle caution. Track separately if desired.

## Item 1 — Persisted `WorkerKind` value rename (`messagebee` → `message`, …)

### Why it's destructive
`WORKER_KINDS` values are persisted as the `bee` field on worker tokens, central task
create/lease payloads, and events (`src/lib/central/contracts.ts`), and appear as `source`
values and route segments (`/messagebee`, `/mailbee`, …) and tool-capability ids. Old rows in
`~/.hivematrix/hivematrix.db` already contain the legacy strings. Flipping the canonical value
without a migration orphans those rows and breaks any worker still sending the old strings.

### Staged approach (read-new-and-old, write-old, then flip)
1. **Read both (DONE for input):** `normalizeWorkerKind` already accepts lane ids. Extend the
   same dual-read to every place that *compares* a kind string (route matchers, capability
   gate keys, `STATUS_KIND_TO_LANE`) so both forms resolve.
2. **Dual-write window:** when persisting, write the legacy kind (unchanged) but also surface a
   `lane` field on outgoing payloads so new consumers can prefer it. No row rewrite yet.
3. **Backfill migration:** a one-shot, idempotent migration that, on daemon boot at a new
   `CENTRAL_PROTOCOL_VERSION`, maps stored legacy `bee` values to the new canonical lane value
   in `hivematrix.db` (worker tokens + task rows + events), guarded by a version flag so it
   runs once. Keep a reversible mapping table.
4. **Flip canonical:** make the lane value the stored canonical; keep legacy strings accepted on
   read indefinitely (cheap) so any stale worker/persisted reference still resolves.
5. **Routes:** add `/lane/<lane>` route aliases alongside the existing `/<kind>bee` routes
   (mirror the `/lanes` vs `/bees` pattern already in place); never remove the old routes in
   this pass — old console/iOS builds call them.

### Acceptance
- Existing `hivematrix.db` rows still load and display after upgrade (test with a fixture DB).
- A worker sending only legacy strings still registers/leases; one sending lane ids also works.
- Migration is idempotent (run twice = no-op) and covered for old-only / new-only / mixed rows.
- All existing `/messagebee`, `/mailbee`, … routes still answer; `/lane/*` aliases added.

### Risk / rollback
Highest-risk item: it mutates the user's live DB. Gate behind a backup of `hivematrix.db` taken
at migration start; keep legacy-read forever so a downgrade still functions.

## Item 2 — `DesktopBeeHelper.app` bundle rename

### Why it's destructive
The Swift helper bundle is **signed and notarized** and launched via launchd; the build/sign
pipeline and `desktopbee-helper/` Swift package, `Info.plist`, entitlements, launchd template,
and `scripts/sign-bundled-machos.sh` all reference `DesktopBeeHelper.app`. The bundle name is
also notarization identity surface. Renaming risks breaking signing, notarization, the launchd
agent, and therefore auto-update.

### Recommendation: keep the bundle name; rename only the user-visible product label
- The bundle id / `.app` name is an internal/compatibility identifier — treat it like the
  persisted kind strings and **leave it `DesktopBeeHelper.app`**. The current copy already
  describes it as the "Desktop Lane helper compatibility bundle" (see `docs/RELEASE.md`,
  `scripts/sign-bundled-machos.sh`, and the `service-build-lane-copy` test), which is the right
  end state.
- If a true rename is still wanted later, it is a dedicated build-system task: new Swift target
  name + `Info.plist` `CFBundleName`/`CFBundleExecutable`, launchd label, sign+notarize the
  renamed bundle, and ship a migration that removes the old LaunchAgent and installs the new one
  on update. Validate end-to-end through `scripts/release.mjs` (see notary-profile + bundled-
  python-notarization gotchas) before publishing. This must not be bundled with Item 1.

### Acceptance
- No change to signing/notarization/auto-update in the default path (bundle name retained), OR
- if renamed: a release built via `scripts/release.mjs` installs, passes notarization, the new
  LaunchAgent loads, the old one is removed, and auto-update from a prior version still works.

## Sequencing

Do Item 1 on its own branch with a backed-up fixture DB and ship it before touching Item 2.
Item 2's default recommendation is "no code change" — only schedule the real bundle rename if
the product label genuinely needs it, as an isolated, release-validated change.
