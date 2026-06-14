# HiveMatrix Model Routing Reference

Date: 2026-06-13
Status: Canonical reference. Source of truth = `src/lib/connectivity/policy.ts`
(role→tier tables) + `src/lib/routing/model-resolver.ts` (tier→model id) +
`src/lib/routing/router.ts` (noLocal / frontier-review-debt).

## The model is chosen by ROLE, not by task type

Every unit of work is tagged with a **role**. The router resolves
`role + connectivity mode → tier`, then `model-resolver` turns the tier into a
concrete model id from config. Roles:

| Role | What it's for |
|------|---------------|
| `think` | planning, review, architecture, directive planning |
| `code-critical` | final implementation / UI — the code that ships |
| `execute` | bulk coding, file ops, extraction — the operational workhorse |
| `cheap-web` | WebBee summarization |
| `image` | image generation |

## Mixed mode (the default — frontier reachable, `cloud-ok`)

This is what runs when the cloud is available and you haven't forced Local or
Cloud-only.

| Role | Tier | Concrete model (default) |
|------|------|--------------------------|
| **think** (thinking) | frontier-premium | **Claude Opus** (`claude-opus-4-8`, or `thinkModel` from config) |
| **code-critical** (final coding) | frontier | **Claude Sonnet** (`claude-sonnet-4-6`, or `frontierModel` from config) |
| **execute** (operational tasks) | local-secondary | **local Qwen** (profile `secondary` model, else `primary`) |
| **cheap-web** | local-secondary | **local Qwen** |
| **image** | nanai | **Nano Banana** (cloud) |

So, answering the common question directly:
- **Thinking → Claude Opus (frontier).**
- **Final/critical coding → Claude Sonnet (frontier).**
- **Operational tasks (bulk coding, file ops, extraction, cheap web) → local Qwen**, even when the cloud is up. This is deliberate: keep the expensive frontier for judgement-heavy work, run the high-volume grind locally.

If `frontierProvider: "codex"` is set in config, the two frontier tiers resolve
to `codex:gpt-5.5-codex` instead of Claude.

## Without frontier (Local or Cloud-unreachable: `local-only` / `offline`)

When no frontier is available, **everything runs on local Qwen** — nothing is
silently dropped:

| Role | Tier | Concrete model |
|------|------|----------------|
| **think** | local-primary | Qwen **primary** (default `Qwen3-Coder-Next-80B-A3B`) |
| **code-critical** | local-primary | Qwen **primary** — *plus frontier-review debt queued* |
| **execute** | local-secondary | Qwen **secondary** (falls back to primary if unset) |
| **cheap-web** | local-secondary | Qwen secondary/primary |
| **image** | unavailable | (mflux local fallback if configured) |

**Frontier-review debt:** code-critical work that had to run locally is recorded
so it gets a frontier review pass when `cloud-ok` returns
(`router.ts` → `frontierReviewDebt`, `orchestrator/frontier-debt.ts`). The local
result is used now; it isn't thrown away when the cloud comes back.

**primary vs secondary:** if you only configure one local model, set `primary`
and leave `secondary` null — `local-secondary` automatically falls back to
`primary` (`model-resolver.ts:55`). Two entries only matter if you want a
smaller/cheaper model for the `execute`/`cheap-web` grind.

## Cloud-only mode (`noLocal`)

A third macro posture: every role runs on frontier and the local model is never
spawned. When the cloud is unreachable a cloud-only task is **left to retry**,
not downgraded to local (`router.ts` `RouteOptions.noLocal`).

## Running without frontier — what's guaranteed

- The local Qwen server is **owned by the daemon** when `qwen.location: "local"`:
  it's launched, health-probed, and relaunched on crash
  (`src/lib/local-model/serving.ts`).
- Tasks dispatched while the server is briefly down (cold start / relaunch
  throttle) now **wait for it** instead of failing — see
  `waitForServerReady` (serving.ts) + the pre-flight in
  `orchestrator/generic-agent.ts`. Up to ~45s; then a clear actionable error.
- Embedded capability lanes that work with no cloud: **TermBee, DesktopBee,
  MailBee, MessageBee** (all driven by local osascript / shells / chat.db). Web
  lanes (WebBee, cloud BrowserBee) are disabled offline by the connectivity
  matrix.

## Config knobs (`~/.hivematrix/config.json`)

```jsonc
{
  "frontierProvider": "claude",          // or "codex"
  "thinkModel": "claude-opus-4-8",       // optional override for think tier
  "frontierModel": "claude-sonnet-4-6",  // optional override for code-critical
  "qwen": {
    "location": "local",                 // local | lan | public
    "primary":   { "modelId": "...", "endpoint": "http://localhost:8080", "provider": "mlx", "contextLimit": 131072 },
    "secondary": { "modelId": "...", "endpoint": "http://localhost:8080", "provider": "mlx", "contextLimit": 131072 },
    "serveCommand": ["mlx_lm.server", "--model", "...", "--port", "8080"]  // optional override
  }
}
```

> ⚠️ Set `contextLimit` to the value the loaded model actually supports. The
> default (`32768` for a partial config) is conservative; an oversized limit
> surfaces as intermittent `413`/context-overflow errors on large tasks — one of
> the "Qwen sometimes fails" causes.
