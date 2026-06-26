# System Readiness + Result Quality Dashboard — Design

> Status: approved-by-operator ("go ahead and add")
> Date: 2026-06-26

## Problem

HiveMatrix now has many correct pieces: COO routing rules, Browser Lane site readiness,
workflow runs/actions, lane apps, local model readiness, and the HeyGen portal path. The
result-quality problem is that failures are scattered. When a task behaves oddly, the
operator has to inspect Settings, task errors, Browser Lane status, DB rules, and release
state separately.

Concrete examples from the live machine:

- the source has the Lane Apps manager, while the running daemon can lag until the app is
  restarted or updated;
- the live database can have a Browser Lane HeyGen site but zero COO routing rules/audit rows;
- stale legacy video review tasks can still show old `make-avatar.mjs` API-render errors even
  though current approval should route through Browser Lane;
- local Qwen readiness may be healthy, but that fact is not presented beside product
  blockers.

## Goal

Add one read-only "System Readiness" truth surface that answers:

1. what is healthy,
2. what needs attention,
3. what is stale legacy state,
4. what the operator should do next.

This slice must not mutate state. No seeding, migration, deleting, approving, launching, or
installing from this endpoint. Repair buttons can come later after this diagnostic layer
proves useful.

## Shape

### Backend module

Add `src/lib/system-readiness/index.ts`.

It returns:

```ts
type SystemReadinessSeverity = "ok" | "info" | "warn" | "critical";

interface SystemReadinessCheck {
  id: string;
  label: string;
  severity: SystemReadinessSeverity;
  summary: string;
  nextAction?: string;
  details?: Record<string, unknown>;
}

interface SystemReadinessReport {
  ok: boolean;
  generatedAt: string;
  summary: string;
  counts: Record<SystemReadinessSeverity, number>;
  checks: SystemReadinessCheck[];
}
```

Checks for this MVP:

- **daemon/version** — current bundled version and connectivity are informational.
- **local model** — cached local model health: ok when ready; warn when configured but not ready;
  info when no cached health exists.
- **COO routing rules** — warn when there are zero rules; ok otherwise. Include enabled count.
- **Browser Lane readiness** — ok when sites exist and no attention/stale; warn if no sites,
  stale sites, or attention sites.
- **Lane apps** — ok when all registered lane apps are installed; warn on missing/update;
  critical on invalid signature or launch failed.
- **workflow inbox** — ok/attention from the existing read-only inbox counts.
- **legacy video review tasks** — warn when active review/needs_input tasks still mention
  `make-avatar.mjs`, "HeyGen costs", or old render/publish copy.
- **recent failed tasks** — warn when failed tasks exist; include safe title/error snippets only.

Secret posture:

- No task output blobs, workflow artifact values, cookies, Keychain material, tokens, or
  credential values.
- Details are counts, ids, labels, statuses, and short redacted snippets only.

### Endpoint

Add:

- `GET /system/readiness`

It is token-gated like normal daemon data routes and returns the report. No CORS exception.

### Console

Add a compact card at the top of Settings -> Lanes:

- title: `System Readiness`
- summary line
- count chips for ok/info/warn/critical
- top checks in severity order
- `Refresh` button
- no repair button in this slice

This placement is intentional: it appears before Lane Apps, embedded lanes, COO Dispatch,
COO rules, Browser Lane readiness, and workflows.

## Non-goals

- No auto-repair or seed buttons.
- No release/autoupdate publication.
- No local-model benchmark run.
- No Browser Lane probe execution.
- No migration of old tasks; only detection.
- No iOS changes in this slice.

## Acceptance Criteria

- `getSystemReadinessReport()` reports warn when COO routing rules are empty.
- It reports Browser Lane readiness attention/stale/no-sites clearly.
- It reports lane app missing/update/broken states without launching apps.
- It reports active legacy video review tasks with old API-render copy.
- It reports recent failed tasks with redacted snippets.
- `/system/readiness` is wired in the daemon.
- Settings -> Lanes has a System Readiness card backed by `/system/readiness`.
- All gates pass: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`,
  `npm run verify:portal`.
