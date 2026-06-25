# Browser Lane Readiness Endpoint Design

Date: 2026-06-25
Status: Follow-up implementation slice

## Context

`/browser-lane/probe` currently returns `501`, so the CLI and future Browser Lane app cannot exercise the stored site/probe schema. The database tables already exist for `browser_sites`, `browser_credentials`, `browser_readiness_probes`, `browser_readiness_runs`, `browser_trace_runs`, and `browser_trace_events`.

The immediate goal is not to finish browser automation. It is to replace the stub with a real registry-backed orchestration path that:

- loads configured sites and enabled readiness probes from SQLite;
- runs probes through an injected Browser Lane adapter;
- writes readiness runs and trace events;
- never reads or logs Keychain secret values;
- reports clearly when the browser backend is not wired.

## Design

Add a small `src/lib/browser-lane/store.ts` module that owns Browser Lane SQL shape. It should expose typed functions for:

- upserting browser site metadata;
- upserting readiness probes;
- listing sites and enabled probes;
- recording readiness runs;
- recording trace events.

Add `src/lib/browser-lane/probe-service.ts` as the orchestration layer. It should:

- accept `siteId: "all"` or one site id;
- create a trace run per probe;
- call `runBrowserReadinessProbe`;
- persist each result;
- return a JSON-safe summary suitable for CLI, daemon, and native app use.

The default adapter is intentionally unavailable until Browser Lane has a wired browser engine. That means the endpoint can return useful persisted diagnostics while honestly marking runs `blocked` with an error such as `Browser Lane backend agent_browser is not wired yet`.

## Response Shape

```json
{
  "ok": true,
  "lane": "browser",
  "siteId": "all",
  "backendReady": false,
  "runs": [
    {
      "siteId": "heygen",
      "probeId": "heygen-home",
      "status": "blocked",
      "color": "red",
      "traceRunId": "abc123",
      "error": "Browser Lane backend agent_browser is not wired yet"
    }
  ]
}
```

If no matching site is configured, return `ok: false` with a clear error. This keeps the CLI honest while still proving the endpoint is live.

## Deferred

- Browser Lane app UI for site/probe maintenance.
- Real browser adapter implementation.
- Visual/OCR/vision assertions.
- Human-auth maintenance flow for 2FA/CAPTCHA.
