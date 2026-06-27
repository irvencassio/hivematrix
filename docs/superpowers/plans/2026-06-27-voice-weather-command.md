# Voice Weather Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-voice-weather-command-design.md`.

## Task 1 — RED: failing tests

- [x] New `src/lib/voice/weather.test.ts`: `getWeather()` with an injected
      `fetchJson` returns a deterministic today report (location, tempNow, high,
      low, conditions, precipChance) and a tomorrow report from `daily[1]`;
      geocode miss → `{ ok:false, error:"geocode_failed" }`; `describeWeatherCode`
      maps known WMO codes; `weatherReply` (today + tomorrow) includes location,
      temp, conditions, rain chance, and an umbrella note when precip ≥ 50;
      `weatherNeedsLocationReply` names Settings, Personalization, and city.
- [x] Extend `src/lib/voice/command-intent.test.ts`: weather utterances →
      `{ kind:"weather", ... }`; "weather tomorrow"/"forecast" → tomorrow;
      "weather in Paris" → `weatherCity:"Paris"`; "create a task to check the
      weather" still → `createTask` (guard).
- [x] Extend `src/lib/voice/command-turn.test.ts`: weather override uses the
      injected `getLocation`, replies with the location + summary, sets
      `command.kind:"weather"`, and spawns **no** task (createTask spy untouched);
      missing location → `needs-location` reply naming Settings/Personalization,
      no fetch, no task; a guard test that `weather.ts`+`command-turn.ts` sources
      contain no `.claude/projects` / `MEMORY.md` reference.

## Task 2 — GREEN: weather service wrapper

- [x] Add `src/lib/voice/weather.ts`: `WeatherWhen`, `WeatherReport`,
      `WeatherResult`, `WeatherDeps`; `getWeather(location, when, deps)` (geocode
      then forecast via Open-Meteo, defensive boundary parsing, injectable
      `fetchJson`, default global `fetch` with an 8s timeout); `describeWeatherCode`;
      `weatherReply`; `weatherNeedsLocationReply`. Read-only, keyless, no secrets.

## Task 3 — GREEN: weather intent detection

- [x] Add `weather` to `CommandKind`; add `weatherWhen?` and `weatherCity?` to
      `CommandIntent`.
- [x] In `detectCommandIntent`, after the create-task/remind block, detect weather
      phrasings (today vs tomorrow/forecast) and an optional inline `in <city>`.

## Task 4 — GREEN: weather command execution

- [x] Add `getLocation?` and `fetchWeather?` to `CommandTurnDeps`.
- [x] Add the `weather` case to `runCommand`: resolve location (inline city ||
      `getLocation()`); missing → `weatherNeedsLocationReply()` with detail
      `needs-location`; else call the service, speak `weatherReply`, create no task.
- [x] Suppress generic-task creation at the source: `routeVoiceSession`
      (`session.ts`) returns `{kind:"none"}` for weather turns, so neither the
      realtime `/voice/session` handoff nor the `/voice/turn` escalation spawns an
      `executor:"agent"` task for weather (even when the sidecar escalates).

## Task 5 — Verify

- [x] Focused voice tests.
- [x] `npm run typecheck`.
- [x] `npm test`.
- [x] `node scripts/scope-wall.mjs`.
- [x] Commit and push to `main`.
