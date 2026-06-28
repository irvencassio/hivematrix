# iOS Goal Flights And Settings Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design:
- docs/superpowers/specs/2026-06-28-ios-goal-flights-consistency-design.md

Target repo:
- `/Users/irvencassio/hivematrix-ios`

## Guardrails

- Preserve the iOS app's current daemon compatibility.
- Prefer additive Codable fields with optional decoding.
- If adding Swift files, update `project.yml` and run `xcodegen generate`.
- Keep desktop daemon as source of truth for orchestration.
- Do not require live audio/mic flows for tests.

## Tasks

- [ ] Add model tests for Goal Flight metadata.
  - Files:
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Models/Models.swift`
    - `/Users/irvencassio/hivematrix-ios/HiveMatrixTests/SmokeTests.swift`
  - RED: decode a Flight detail JSON payload containing `intake.goalFlight` and
    assert goal metadata is available.
  - GREEN: add optional Codable types and computed helpers.

- [ ] Add Goal Flight presentation to Board/detail.
  - Files:
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Views/FlightsView.swift`
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Services/DemoData.swift`
  - RED: source/dataset test expects a visible Goal section and demo Goal Flight.
  - GREEN: render goal, criteria, autonomy, and constraints when present.

- [ ] Add loop/pass API support where available.
  - Files:
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Services/APIClient.swift`
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Models/Models.swift`
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Views/FlightsView.swift`
  - RED: API client tests/source checks expect `/work-packages/:id/loop` and
    `/loop/passes` support.
  - GREEN: fetch loop status opportunistically and hide controls on 404.

- [ ] Update status labels and progress semantics.
  - Files:
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Models/Models.swift`
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Views/FlightsView.swift`
  - RED: label tests expect `done_with_skips`, `archived`, and `skipped`.
  - GREEN: add labels and progress count behavior that matches desktop.

- [ ] Align Settings order with desktop.
  - Files:
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Views/SettingsView.swift`
    - `/Users/irvencassio/hivematrix-ios/HiveMatrixTests/SmokeTests.swift`
  - RED: smoke test expects order General, Projects, Models, Lanes, Workflows,
    Features, Remote, About and initial active tab General.
  - GREEN: reorder enum cases and initial state.

- [ ] Verification gates.
  - Commands:
    - `cd /Users/irvencassio/hivematrix-ios && xcodegen generate`
    - `cd /Users/irvencassio/hivematrix-ios && xcodebuild -project HiveMatrix.xcodeproj -scheme HiveMatrix -destination 'generic/platform=iOS' build`
    - any existing test target command available in the repo.
