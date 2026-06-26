# Voice Mail Delete Design

> Date: 2026-06-26 · Status: approved by operator request · Topic: voice-mail-delete

## Problem

Voice can already queue tasks, resolve approvals, route Browser Lane work, and
summarize operational state. It does not understand spoken requests like
“delete that email” or “delete the latest email from X.” Today those either fall
through to chat or become a generic task with no Mail Lane-specific guardrails.

Deleting email is destructive and voice transcription can be wrong. Mail Lane
also reads Apple Mail message ids, but a spoken deletion request usually does
not carry an exact message id. Acting immediately from a fuzzy utterance would
be unsafe.

## Decision

Add a deterministic voice intent that captures mail-deletion requests and queues a
Mail Lane deletion review task. The task is structured, explicit, and safe:

- source: `mail-lane`
- status: `review`
- output: `mailDeleteVoiceRequest`
- description instructs the worker/operator to identify candidate messages,
  present them for review, and delete only after explicit confirmation.

The spoken reply should say it queued a deletion review, not that anything was
deleted.

## Scope

- Voice intent parsing.
- Voice command execution into a structured review task.
- Tests for detection, task payload, spoken copy, and no accidental approval/send.

## Non-Goals

- No immediate deletion from a spoken phrase.
- No bulk delete.
- No Gmail API or Gmail connector path.
- No new credential handling.
- No Apple Mail trash execution in this slice.

## Acceptance Criteria

- “delete the latest email from Stripe” is detected as a Mail Lane delete request.
- “trash emails from noreply@example.com about receipts” captures a useful query.
- The voice command queues exactly one review task with `source: "mail-lane"`.
- The task output includes only the deletion query and voice metadata, no secrets.
- The spoken response clearly says review is queued and no email has been deleted.
- Existing approve/deny and create-task intents still behave as before.
