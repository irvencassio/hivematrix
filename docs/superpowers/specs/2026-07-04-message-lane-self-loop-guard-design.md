# Message Lane Self Loop Guard Design

## Problem

When the daemon and operator use the same Apple ID or iMessage handle, a HiveMatrix
standby/needs-input reply can appear back in `chat.db` as an inbound message. The
Message Lane poller then treats the daemon's own text as a new operator message,
creating a circular loop.

## Goal

Provide an immediate operator workaround and permanent guard:

- Store the daemon/operator's own iMessage handles as `selfHandles`.
- Never route inbound messages from self handles.
- Never send outbound Message Lane texts to self handles.
- Expose self handles through daemon status and a small authenticated update
  endpoint so the operator can configure the guard without editing SQLite.

## Approach

The current work-in-progress already adds `selfHandles` to Message Lane metadata
and guards the poller. Finish the surface by returning self handles from
`GET /messagebee`, adding `POST /messagebee/self-handles`, carrying the setting
through guided setup, and blocking direct lane-tool sends to self handles.

## Verification

- Focused store/status/onboarding tests prove self handles round-trip.
- Focused lane-tool tests prove direct sends refuse before allowlist/send.
- Focused daemon tests prove the HTTP endpoint is usable.
- Run the Message Lane focused test set before handoff.
