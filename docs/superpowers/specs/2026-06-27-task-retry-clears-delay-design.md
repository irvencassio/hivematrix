# Task Retry Clears Delay Design

## Context

Queued tasks can carry `delayUntil` and `delayReason` after a transient auto-retry. The iOS task detail screen now exposes Restart for queued tasks, and that action calls the daemon's existing `POST /tasks/:id/retry` endpoint.

## Problem

The retry endpoint resets status and process fields, but it does not clear `delayUntil` or `delayReason`. A manually requested restart can therefore leave a task invisible to the scheduler until the old delay expires.

## Decision

Treat explicit retry as an operator override of queue delay. When `POST /tasks/:id/retry` runs, clear `delayUntil` and `delayReason` alongside the existing reset fields.

## Scope

- Update `src/daemon/server.ts` retry updates.
- Add a focused regression assertion to the existing daemon source smoke tests.
- Do not change scheduler auto-retry behavior.
