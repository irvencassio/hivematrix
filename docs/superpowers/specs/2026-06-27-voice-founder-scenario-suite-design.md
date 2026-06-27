# Voice Founder Scenario Suite + Weather Geocode Fix - Design

> Date: 2026-06-27 · Status: approved by operator request · Topic: voice-founder-scenario-suite

## Context

The iOS Talk surface sends recognized text to the daemon's `/voice/turn` endpoint.
The spoken request "what's the weather today" reached the daemon command layer, but
the saved Settings location `Kings Mills, OH` produced:

> I couldn't get the weather for Kings Mills, OH right now.

The current Settings diagnostic is too small to catch this. It runs eight canned
scenarios and stubs weather success, so it validates routing but not realistic
weather resolution or founder/personal voice coverage.

## Problem

Open-Meteo geocoding returns no hits when the full query includes a comma and US
state abbreviation, such as `Kings Mills, OH`, `Cincinnati, OH`, or
`San Francisco, CA`. The provider expects the city name as the search term and
then returns `admin1`/state metadata for selection.

## Approach

1. Normalize common US state-suffixed locations before geocoding:
   - `Kings Mills, OH` -> search `Kings Mills`, prefer `admin1=Ohio`, `country_code=US`
   - `San Francisco, CA` -> search `San Francisco`, prefer `admin1=California`
   - fallback remains the original query if no normalized match works
2. Keep weather keyless and read-only.
3. Expand the no-audio diagnostic suite to at least 50 scenarios shaped around a
   solo founder / personal operator:
   - daily briefing, board, approvals, directives, usage, analytics
   - weather and local-life questions
   - browser research, mail delete review, release checks
   - personal reminders and task creation
   - safe handoffs for broader asks
4. Preserve safety boundaries:
   - no mic, STT, or TTS playback
   - no real task creation, approval resolution, email deletion, or directive edits
   - live weather is read-only and can be disabled/injected for deterministic tests

## Acceptance

- `getWeather("Kings Mills, OH", "today")` succeeds with injected geocode data
  that only returns hits for the city-only query.
- The diagnostic runner executes at least 50 scenarios and reports per-scenario
  route, reply, audio bytes, and side effects.
- The daemon endpoint can run the full suite from Settings.
- Automated tests prove the broad suite passes without audio and without secret
  leakage.
