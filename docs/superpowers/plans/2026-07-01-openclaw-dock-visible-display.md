# OpenClaw Dock Visible Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design source: `docs/superpowers/specs/2026-07-01-vale-voice-openclaw-return-path-design.md`

## Goal

Fix the enabled OpenClaw Chat Dock staying invisible even when `/openclaw/status` reports `enabled:true`, `available:true`, and `gateway.reachable:true`.

Superseded outcome: OpenClaw no longer renders as a visible bottom dock. The fix moved OpenClaw into a center-pane workspace selected from the left rail, which made the chat visible without preserving the fragile dock display path.

Live diagnosis on 2026-07-01:

- `/openclaw/status` reports OpenClaw installed, available, gateway reachable, enabled, and flagEnabled.
- The desktop app accessibility tree does not include OpenClaw dock nodes.
- `#openclawDock` has stylesheet default `display: none`.
- `initOpenclawDock()` uses `dock.style.display = ''`, which clears the inline value and falls back to stylesheet `display: none`.

## Tasks

- [x] Add regression coverage in `src/daemon/console.test.ts` proving OpenClaw is reachable from the left rail and no longer depends on the hidden bottom dock.
- [x] Update `src/daemon/console.ts` so enabled, unavailable, and status-error paths render in the center-pane OpenClaw workspace.
- [x] Run focused console tests covering OpenClaw center-pane behavior.
- [x] Verify the live app can show OpenClaw after restart/reload.
