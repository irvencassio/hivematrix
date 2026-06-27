# Voice Weather Command Design

> Date: 2026-06-27 · Status: approved by operator request · Topic: voice-weather-command

## Problem

A spoken request from iOS — "What's the weather today?" — was not recognized by
the deterministic voice command layer. It fell through to the conversational
reply, which spawned a **generic agent task**. That agent then tried to read a
wrong Claude memory path
(`/Users/irvencassio/.claude/projects/-Users-irvencassio/memory/MEMORY.md`) and,
finding nothing, asked the operator: "I don't have your location saved. What city
are you in?"

This is wrong on three counts:

1. HiveMatrix **already stores the operator's location** in Settings →
   Personalization (`config.json` `location`, read via `getLocation()` in
   `src/lib/models/available.ts`). The Personalization field's own help text says
   it is "Shared with location-aware tasks (weather, 'near me', local time)".
2. Weather is a simple, deterministic lookup. Spawning a generic Codex/Claude
   agent for it is slow, costly, and non-deterministic.
3. Operator location must never come from Claude/agent memory. It comes from
   HiveMatrix settings.

## Decision

Add a deterministic **`weather`** intent to the existing voice command layer
(`command-intent.ts` → `command-turn.ts` → `commandTurnOverride`), the same
override pipeline already wired into the `/turn` endpoint that serves **both iOS
and desktop voice**. The command:

- Detects weather phrasings (today / tomorrow / forecast / umbrella / how cold).
- Reads the default location from `getLocation()` (HiveMatrix settings) — never
  from Claude memory or a generic agent.
- Calls a small, secret-free weather service wrapper (new `src/lib/voice/weather.ts`)
  with an **injectable fetcher** so tests are deterministic and offline.
- Speaks a concise answer inline (location, temp / high-low, conditions, rain
  chance, one practical note like "umbrella likely") — **without creating any
  board task**.

Critically, the original bug's generic task was spawned by `routeVoiceSession`
(`session.ts`), the shared chokepoint called by **both** the realtime
`/voice/session` handoff and the `/voice/turn` escalation block. When the sidecar
escalates on a weather utterance it returns `{kind:"task"}` → an `executor:"agent"`
task that read agent memory and asked for a location. We suppress that at the
chokepoint: `routeVoiceSession` returns `{kind:"none"}` for any weather turn, so
neither path spawns a generic agent task for weather (even when escalated).
- If no location is configured, returns a clear `needs-location` reply guiding the
  operator to Settings → Personalization, or to say a city. The operator may also
  say "weather in <city>" to override inline.

### Weather data source

There is no existing weather helper in the repo. We add a wrapper around
**Open-Meteo** (`geocoding-api.open-meteo.com` + `api.open-meteo.com`):

- **Keyless** — satisfies "secret-free"; no credentials enter logs or config.
- **Read-only** GET requests; no Browser Lane, no agent.
- Two calls: geocode the city string → lat/lon, then fetch `current` + 2-day
  `daily` forecast. WMO weather codes are mapped to plain English.

The default fetcher uses Node's global `fetch` (already used across the repo,
e.g. `youtube/api.ts`). Tests inject a fake `fetchJson` and never touch the
network.

## Scope

- `weather` intent detection (phrases, today/tomorrow, optional inline city).
- `src/lib/voice/weather.ts`: `getWeather()` service (injectable fetch), WMO code
  map, and the spoken-reply / needs-location string builders.
- `weather` case in `command-turn.ts` using `getLocation()` (injectable dep),
  answering inline, spawning no task.
- `routeVoiceSession` (`session.ts`) returns `none` for weather turns so no
  generic agent task is created via the realtime or escalation paths.
- Tests for detection, service, command override, missing-location, and a guard
  that the weather path never references the Claude memory path.

## Non-Goals

- No Browser Lane, no generic Codex/Claude agent for normal weather.
- No new secrets, API keys, or credential handling.
- No board task for a simple weather answer (answer inline only).
- No change to the degraded per-turn fallback path in `server.ts` (it already
  runs *no* command overrides; weather is consistent with every other command).
- No temperature-unit setting UI (default Fahrenheit; `units` is an injectable
  param for future use).

## Acceptance Criteria

- With location configured, "What's the weather today?" answers directly using
  that location — no task, no location question.
- "weather tomorrow" / "forecast" use forecast (daily) data.
- "do I need an umbrella" / "how cold is it" are detected as weather (today).
- With no location configured, the reply asks for location once, naming Settings →
  Personalization, and emits a `needs-location` signal; no fetch, no task.
- "weather in Paris" uses Paris inline without requiring settings.
- The weather code path contains no reference to `.claude/projects/.../MEMORY.md`.
- The weather service fetch is injectable and deterministic under test.
- No secrets in logs/output; iOS and desktop both work (shared `/turn` override).
- Existing approve/deny, create-task, Browser/Mail Lane voice intents unchanged.
