# System Readiness Repair Actions — Design

> Status: approved-by-continuation
> Date: 2026-06-26

## Problem

The System Readiness dashboard now surfaces what is wrong, but the most common safe
repairs still require the operator to know which lower-level button or route to call.
The next useful step is explicit, narrow repair actions for issues the dashboard can
diagnose confidently.

There is one important safety trap: the HeyGen seed path is older than the operator's
real Browser Lane setup. The live machine has HeyGen as Google SSO with Google auth
domains. A naive `seedHeyGenBrowserSite()` call can overwrite that with a generic
manual session and narrower domains. Before exposing a repair action that calls the
seed, the seed must preserve stronger existing auth metadata.

## Approach

Add explicit operator-triggered repairs to the readiness system:

- `seed_coo_rules` — idempotently seed canonical COO routing rules.
- `seed_heygen_browser_site` — idempotently seed HeyGen site/probe/rule while preserving
  existing auth strategy, provider account, credential ref, notes, and unioning domains.
- `refresh_legacy_video_reviews` — refresh active legacy video review tasks so their
  prompt uses the current Browser Lane wording and clears stale API-render errors. This
  only touches active review/needs_input video-review tasks with an existing
  `output.reviewScript`; it never approves, renders, creates Browser Lane tasks, or
  publishes.

No "repair all" button. Each action is one explicit operator click.

## Backend

Add to `src/lib/system-readiness/index.ts`:

- `SystemReadinessRepairAction`
- optional `repairActions` on `SystemReadinessCheck`
- `performSystemReadinessRepair({ action })`

Return shape:

```ts
{
  ok: true,
  action: "seed_coo_rules",
  message: "Seeded 7 COO routing rules.",
  changed: number,
  report: SystemReadinessReport
}
```

Unknown actions return a validation error at the endpoint.

## Endpoint

Add:

- `POST /system/readiness/repair`

The endpoint is token-gated and accepts only:

```json
{ "action": "seed_coo_rules" }
```

No path or arbitrary SQL is accepted.

## Console

The System Readiness card renders repair buttons only for checks that advertise
`repairActions`. Clicking a button calls `/system/readiness/repair`, shows the returned
message, and refreshes the report.

## Acceptance Criteria

- Empty COO rules check advertises `seed_coo_rules`; executing it creates canonical rules.
- HeyGen seed repair preserves existing Google SSO provider account and unions Google auth
  domains instead of downgrading the site.
- Legacy video review repair rewrites old API-render copy to current Browser Lane copy and
  clears stale render errors without approving or creating child tasks.
- Unknown repair action is rejected by the endpoint.
- Console renders explicit repair buttons and never has a "repair all" path.
- Gates pass.
