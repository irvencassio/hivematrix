# Browser Lane Trace Inspection Design

Date: 2026-06-25
Status: Follow-up implementation slice

## Context

Browser Lane readiness runs now persist `browser_trace_runs` and `browser_trace_events`, but operators cannot inspect those traces without SQLite. Troubleshooting was one of the original Browser Lane requirements: failures need enough context to debug authentication, selectors, backend availability, and human-required states.

## Scope

Add read-only trace inspection:

- `GET /browser-lane/traces`
- `GET /browser-lane/traces/latest`
- `GET /browser-lane/traces/:id`
- `hive browser trace list`
- `hive browser trace latest`
- `hive browser trace show <trace-id>`

Returned trace details include run metadata plus ordered events.

## Safety

Trace inspection must remain redacted. Even though Browser Lane readiness currently records only safe messages and metadata, the retrieval layer should defensively redact secret-looking keys:

- password
- secret
- token
- cookie
- totp

No Keychain reads happen in this flow.

## Deferred

- Opening trace directories in Finder.
- Exporting redacted trace bundles.
- Screenshot/DOM artifact browsing.
