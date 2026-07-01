# OpenClaw Voice Return Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

Live HiveMatrix history shows the operator's weather prompt and OpenClaw's final answer both reached the HiveMatrix OpenClaw bridge. The missing piece is the voice return loop. OpenClaw may emit assistant-role scratch/tool messages before the final natural-language answer, including empty content, skill frontmatter, command output, or raw JSON. The current poller returns the earliest assistant message after the send cursor, so it can stop before the speakable answer exists.

## Tasks

- [x] Add a failing bridge test proving `pollForAssistantReply` ignores empty/tool/raw assistant messages and returns the final speakable assistant text.
- [x] Add small content classification in `src/lib/openclaw/bridge.ts` so the voice poller waits for non-empty, speakable assistant content.
- [x] Keep older polling behavior for normal multi-assistant replies by returning the earliest speakable candidate after `sentAfter`.
- [x] Run the focused bridge test, typecheck, and a live poll against the current weather history.
