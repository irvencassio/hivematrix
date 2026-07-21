# HiveMatrix Model Routing Reference

Date: 2026-06-19 · Revised 2026-07-11 (Claude-native cutover), doc refreshed 2026-07-21
Status: Canonical reference. Source of truth = `src/lib/connectivity/policy.ts`
(role→tier tables) + `src/lib/routing/model-resolver.ts` (tier→model id) +
`src/lib/routing/router.ts` (noLocal / frontier-review-debt).

> **Claude-native since 2026-07-11 (0.1.176).** The local Qwen / LM Studio /
> Rapid-MLX plane was removed: there is no `src/lib/local-model/`, no local
> serving supervisor, and no `local-primary`/`local-secondary` tier. Every text
> role runs on a Claude model invoked through the `claude` CLI on the operator's
> subscription — no API key and no `@anthropic-ai` SDK. Historical record of the
> change: `docs/superpowers/plans/2026-07-11-claude-native-cutover.md`.

## The model is chosen by ROLE, not by task type

Every unit of work is tagged with a **role**. The router resolves
`role + connectivity mode → tier`, then `model-resolver` turns the tier into a
concrete model id from config. Roles:

| Role | What it's for |
|------|---------------|
| `think` | planning, review, architecture, directive planning, deep-think |
| `code-critical` | final implementation / UI — the code that ships |
| `execute` | bulk coding, file ops, extraction — the operational workhorse |
| `cheap-web` | Browser Lane web summarization |
| `converse` | Flash Lane chat / voice turns (latency-optimized) |
| `image` | image generation |

## Frontier reachable (`cloud-ok` — the normal posture)

| Role | Tier | Concrete model (default) |
|------|------|--------------------------|
| **think** | frontier-premium | **Claude Opus** (alias `opus` → latest, or `thinkModel` from config) |
| **code-critical** | frontier | **Claude Sonnet** (alias `sonnet` → latest, or `frontierModel` from config) |
| **execute** | operational | **Claude Haiku** (alias `haiku`, or `operationalModel` from config) |
| **cheap-web** | operational | **Claude Haiku** |
| **converse** | operational | **Claude Haiku** (the Flash loop escalates to frontier on tool depth > 3) |
| **image** | nanai | **Nano Banana** (cloud) |

So, answering the common question directly:
- **Thinking → Claude Opus.**
- **Final/critical coding → Claude Sonnet.**
- **Operational work (bulk coding, file ops, extraction, cheap web, Flash chat) → Claude Haiku.** This is deliberate: keep the expensive tiers for judgement-heavy work and run the high-volume grind on the cheap tier.

The `opus` / `sonnet` / `haiku` aliases are the CLI's version-agnostic names
(`src/lib/models/available.ts`), so nothing needs a bump when a new model of a
tier ships.

If `frontierProvider: "codex"` is set in config (and the `codex` CLI is
installed), the default tiers resolve to:

- Thinking: `codex:gpt-5.5`
- Coding: `codex:gpt-5.3-codex-spark`
- Operational: `codex:gpt-5.3-codex-spark` (Codex-only installs)

The provider is a default-family hint, not a lock, and resolution is
backend-aware: a configured model whose CLI is not installed is ignored rather
than dispatched into a failure (`modelSupportedByBackends`,
`model-resolver.ts`). Settings → Models can override each role independently:

| Role | Config key | Default |
|------|-----------|---------|
| Thinking | `thinkModel` | Opus (or GPT-5.5 under the Codex provider) |
| Coding | `frontierModel` | Sonnet (or Spark) |
| Operational | `operationalModel` | Haiku (or Spark) |

## Without frontier (`local-only` / `offline`)

There is no local inference plane, so **both no-cloud modes route every text role
to `unavailable`** — one shared table in `policy.ts` so the two modes can never
silently drift apart:

| Role | Tier | Concrete model |
|------|------|----------------|
| **think** | unavailable | — (queued) |
| **code-critical** | unavailable | — (queued) |
| **execute** | unavailable | — (queued) |
| **cheap-web** | unavailable | — (queued) |
| **converse** | unavailable | — (Flash gated off; `policy.ts` capability reason: "no cloud connectivity; Claude required") |
| **image** | unavailable | (mflux local fallback if configured) |

Work is **queued, never silently downgraded**. `resolveModelId("unavailable")`
returns `null` and the caller queues or skips.

**Frontier-review debt:** the mechanism that recorded code-critical work executed
on a weaker tier so it got a frontier review pass later
(`router.ts` → `frontierReviewDebt`, `orchestrator/frontier-debt.ts`) still
exists, but with no local tier nothing routes into it in normal operation.

## Cloud-only mode (`noLocal`)

Every role runs on frontier and no non-frontier override is honored
(`RouteOptions.noLocal` → `resolveModelId({ noLocalOverrides: true })`, which
drops any role override that doesn't look like a frontier model id — see
`isFrontierOverride`). When the cloud is unreachable a cloud-only task is **left
to retry**.

## What still works with no cloud

Inference does not, but the local-only capability lanes do: **Desktop Lane, Mail
Lane, Message Lane** (osascript / shells / chat.db), plus brain docs and the
local symbol index. The **Browser Lane** web/authenticated modes need the
internet, so the connectivity matrix disables them offline.

## Config knobs (`~/.hivematrix/config.json`)

```jsonc
{
  "frontierProvider": "claude",          // or "codex"
  "thinkModel": "opus",                  // optional override for think (alias → latest; full ids like "claude-opus-4-8" still accepted)
  "frontierModel": "sonnet",             // optional override for code-critical
  "operationalModel": "haiku"            // optional override for the operational tier
}
```

> The retired `qwen`, `localModel` and `localEngine` blocks are dead keys. Old
> configs are cleaned up automatically on load by `src/lib/config/migrate.ts`;
> stale non-frontier role overrides are dropped there too.
