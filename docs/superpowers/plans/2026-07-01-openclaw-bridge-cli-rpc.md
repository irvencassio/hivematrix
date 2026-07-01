# OpenClaw Bridge CLI RPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

HiveMatrix's OpenClaw dock can now render, but `/openclaw/chat/history` still returns `OpenClaw returned an error.` Live OpenClaw logs show `invalid handshake ... ua=node` when HiveMatrix calls the gateway. The current bridge sends raw WebSocket frames shaped like `{ op: "chat.history" }`, while OpenClaw 2026.6.11 expects its authenticated gateway RPC protocol.

The installed `openclaw gateway call` command succeeds for `chat.history` and `chat.send` on this Mac, including the required device-auth handshake. HiveMatrix should use that server-side path by default and keep the current mock WebSocket seam only for unit tests.

## Tasks

- [x] Add a failing bridge test proving production calls use `openclaw gateway call <method> --params <json> --json`, not raw `op` frames.
- [x] Implement a default gateway caller in `src/lib/openclaw/bridge.ts` that invokes the OpenClaw CLI with bounded timeout and parses JSON even when warnings precede it.
- [x] Route `chat.history`, `chat.send`, and `chat.inject` through the new caller while preserving existing structured error results and no-secret response guarantees.
- [x] Run focused bridge tests, then `npm run typecheck`, then the OpenClaw route smoke checks against the running packaged daemon.
