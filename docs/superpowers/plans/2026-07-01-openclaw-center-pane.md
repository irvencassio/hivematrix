# OpenClaw Center Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Tasks

- [x] Add failing console tests for a left-rail OpenClaw nav entry under New task and a `showOpenClawPanel()` center-column flow.
- [x] Add center-pane OpenClaw CSS with a full-height chat workspace and large composer hit target.
- [x] Add the left-rail OpenClaw nav button and render a center-column panel with unique element IDs.
- [x] Retire the visible bottom dock so OpenClaw has one primary operator surface.
- [x] Preserve feature-flag behavior by hiding/showing the left-rail OpenClaw entry from `initOpenclawDock()`.
- [x] Reserve bottom composer space so only the OpenClaw transcript scrolls through long output.
- [x] Use an explicit composer grid so the message textarea cannot collapse into vertical text.
- [x] Normalize left-nav colors so inactive items are neutral and the active item alone uses yellow.
- [x] Run focused console tests, typecheck, full test suite, rebuild daemon, hot-patch the installed app, and verify live UI health.
