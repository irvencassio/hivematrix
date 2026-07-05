# Update Daemon Handoff Design

## Problem

The HiveMatrix update flow can install a new app bundle while the UI still shows
the same update as available or installing forever.

The observed machine state after installing `0.1.137`:

```text
/Applications/HiveMatrix.app Info.plist: 0.1.137
Live latest.json feed:                0.1.137 build 682
GET /health:                          0.1.136
GET /update/status:                   current=0.1.136 latest=0.1.137 applying=true
Port 3747 owner:                      node --import tsx/esm src/daemon/index.ts
launchctl com.hivematrix.daemon:      not loaded
```

So the updater did replace the app bundle, but a detached development/hotfix
daemon continued serving the old source checkout on `127.0.0.1:3747`. The Tauri
updater logged success after `download_and_install()` and attempted
`launchctl kickstart`, but that target was not loaded, and no later gate verified
that the running daemon had actually moved to the installed bundle version.

## Goal

Make update completion depend on the running daemon serving the installed app
version, not merely on replacing the `.app` bundle.

## Approaches

### Approach A - Honest Daemon Handoff Gate

Add explicit daemon handoff logic after update install:

- Determine whether `127.0.0.1:3747` is serving a stale HiveMatrix daemon.
- If launchd is not loaded but the plist exists, bootstrap it before kickstart.
- If a known stale source/dev daemon owns the port, terminate only that known
  HiveMatrix daemon process.
- Start or kickstart the bundled daemon.
- Probe `/health` until its version matches the installed app version.
- Keep logging every decision.

Pros: fixes the real failure mode at the point where update success is claimed.
Cons: Rust-side process inspection is more platform-specific.

### Approach B - Daemon-side Status Honesty

Improve `GET /update/status` so stale apply markers do not present as an endless
install. If the feed/latest version is still newer than the daemon but an apply
marker has aged or the app bundle is already current, report a repair-needed
state instead of generic "installing".

Pros: improves UI truthfulness and avoids confusing repeated install clicks.
Cons: does not by itself restart the correct daemon.

### Approach C - Remove Dev Daemon Support From Update Machines

Manually stop all source daemons and require launchd-only operation after
packaged app setup.

Pros: simple operationally.
Cons: does not protect against the next hotfix or detached dev process.

## Recommendation

Implement Approach A and the minimal part of Approach B.

The root fix is the handoff gate: after install, the updater must ensure the
correct daemon owns the port and reports the app version. The status endpoint
should also make the stuck state explicit so operators see "daemon restart
needed" rather than an endless "installing".

## Acceptance Criteria

- A stale `node --import tsx/esm src/daemon/index.ts` owner on `:3747` is detected
  as a replaceable HiveMatrix source daemon.
- An arbitrary unknown process on `:3747` is not killed silently.
- If the LaunchAgent plist exists but is not loaded, the updater bootstraps it
  before kickstarting.
- After install, update success is not logged unless `/health.version` matches
  the app version.
- `GET /update/status` can distinguish an in-progress install from a stale
  daemon handoff problem.
- Tests cover stale source-daemon detection and the stuck applying marker.

## Verification

- Focused tests:
  - `src/lib/updater/feed-check.test.ts`
  - new/update tests around the daemon handoff helper
- Standard gates:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
