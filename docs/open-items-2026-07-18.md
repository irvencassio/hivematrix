# Open items — 2026-07-18

Left over from the 0.1.214 → 0.1.220 run (plus iOS build 62). Each item says what
it is, why it matters, and where to start. Nothing here is broken-in-production;
these are the things we consciously deferred or discovered on the way.

## Needs a decision

### 1. Ship the updater cache fix (committed, unreleased)
`a214d20b` fixes the reason 0.1.220 looked "not staged": a transient feed
timeout was cached exactly like a success, so `updateAvailable:false` was served
for the full 60s TTL. Failed checks now expire in 5s.

The daemon is on **0.1.219**; **0.1.220 is available**. Either apply 0.1.220 now
and let the cache fix ride the next release, or cut 0.1.221 first and apply once.
The second is one restart instead of two.

### 2. `src-tauri/target` is 25G
Regenerable Rust build cache — the bulk of the repo's remaining ~29G (`.git` is
only 49M). `cargo clean` reclaims it at the cost of a full cold rebuild on the
next release. Pure judgment call; no correctness impact.

### 3. Browser Lane Keychain task (`bcbefda4b7c84c70ad7a75dd`) — close as superseded
Assessed against the code: item 1 (Keychain storage) shipped 7/16; items 3–5 are
delivered or bettered by the Readiness dashboard; **item 2 should be struck** —
it specifies silent re-auth, which contradicts the standing human-click-only rule
(your own reply on it was "surface the need to click").

The genuine remainder is small: there is **no automatic session-expiry
detection** — readiness is manual ("Run readiness" / "Mark needs reauth"). The
rule-respecting version is detect-expiry → surface a prompt → one click into the
existing `BrowserLaneSignIn.signIn`. Roughly a tenth of the original ticket.

## Cleanup / hygiene

### 4. The release script never prunes old build artifacts
`build/developer-id` had grown to **21G across 79 release dirs** (back to
0.1.138) — local copies of artifacts already published to GitHub. Manually pruned
to the last 6 (21G → 1.6G, repo 49G → 29G), but it regrows ~270MB per release.
Add a retention policy (keep last N) to `scripts/developer-id-release.sh`.

### 5. `/update/check` is a dead endpoint and a debugging trap
`src/lib/updater/daemon-update.ts` requires a `config.updater` block
(`channelUrl` + Ed25519 PEM) that **does not exist** on this machine, so it
always returns `{configured:false, available:false}`. It also expects a different
artifact (`manifest.json`) than the release publishes (`hivematrix-core.json`).

The live path — what the console AND the iOS app both call — is
**`/update/status`** (`src/lib/updater/feed-check.ts`), which has the correct
feed URL hardcoded and needs no config. Delete the dead mechanism or wire it up;
as-is it sends debugging down a false trail (it sent me down one).

### 6. Rebase the agent's task branch before integrating
`fix/task-reply-choice-buttons` holds the input-choice-buttons feature
(commit `c2a1e460`, task `dacbfe15f4b142779aea2761`, in review). It is 1 commit
ahead of main and several behind, so `scripts/integrate-task-branch.sh` correctly
refuses it as not fast-forwardable. Rebase, verify, then integrate.

## Unverified — needs a human in the loop

### 7. Apple login recipes are authored but never driven
Recipes exist for **Apple Developer** (new) and **App Store Connect** (existing),
with resilient selectors (Apple's stable ids plus attribute fallbacks) validated
against the recipe grammar, and `idmsa.apple.com` allow-listed for the
cross-origin iframe. But they have **never been run against Apple's live form** —
I could not drive a real sign-in without credentials, and 2FA needs you
regardless. Next time you sign in to App Store Connect from Browser Lane, watch
whether the recipe drives it. The focus/blur fill fix (0.1.217) is what should
make Apple's "Continue" button enable.

### 8. iOS: `DocumentsView.swift` was deleted, not demoted
The nav restructure task (Ready for Review) removed the Documents tab by
**deleting the view outright** — nothing references it, so brain-doc browsing is
gone from the phone entirely. The tab work itself is right (five tabs, Approvals
promoted with a live badge, which also fixes deep-linking into the old "More"
overflow). Restore `DocumentsView` reachable from Settings before accepting.

### 9. iOS build 62 is in TestFlight, not released
Carries the notification delegate, lock-screen Approve/Deny, deep-link, Watch
approvals screen and live complication. Needs a review/release decision.

## Partially done

### 10. "Agents commit their own work" is contract, not enforcement
`AGENTS.md` + the self-improvement task prefix now require explicit staging,
committing before finishing, and never merging (0.1.220). Nothing *checks* it —
a task can still reach review with changes loose in the tree. A completion-time
guard ("this task modified files it never committed") would close the gap.

## Notes worth keeping

- **`launchCommand` is persisted as a task COLUMN**, not inside `output` JSON.
  It captures the exact spawn args and is the fastest way to settle "what flags
  did this run actually get" — `ps` collapses argv and cannot be trusted for it.
- **Browser Lane site recipes live under `loginSteps`**, not `loginRecipe`.
  Probing the wrong key falsely reports "no recipes configured".
- **`xcodebuild -sdk iphonesimulator` fails** on the embedded watch target
  (`unable to resolve module dependency: 'WatchKit'`). Use
  `-destination 'generic/platform=iOS'`.
