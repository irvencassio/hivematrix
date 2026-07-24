# T6 — HiveMatrix is a client of the Canopy Browser app

**Landed 2026-07-24. Supersedes [browser-lane-claude-native.md](browser-lane-claude-native.md).**

Browser Lane's `open` / `snapshot` / `workflow` modes no longer dispatch a task to
a generic agent that drives Chrome or Safari. They run **in the standalone Canopy
Browser app** — a real WebKit browser that already holds the signed-in sessions
and already enforces the site policy — over loopback HTTP.

`search` / `read` are unchanged: they still go to the Browser Lane read service
(`POST /answer`, `:4011`). This cutover is only about the stateful/authenticated
modes.

## The integration

| | |
| --- | --- |
| Transport | **Loopback HTTP.** `POST {base}/act` |
| Base URL | `CANOPY_BROWSER_BASE_URL`, default `http://127.0.0.1:4021` |
| Envelope | `{ action, requester, steps }` |
| Client | `src/lib/browser-lane/canopy-client.ts` (modelled on `read-client.ts`) |
| Contract | `canopy-browser/docs/automation-api.md`, section "For HiveMatrix (T6)" |

**Not MCP, deliberately.** HiveMatrix carries no MCP client and no
`@modelcontextprotocol` dependency, and does not need one — the app's own
documentation names this endpoint as the HiveMatrix integration path. Do not add
an MCP client to satisfy this.

`action` is the policy verb. Browser Lane's `jobType` is passed straight through,
because the app's `PolicyEngine` recognises the same vocabulary:
`authenticated_research` / `capture` / `triage` are reads,
`form_fill` / `site_ops` are writes, and an unrecognised action **fails closed**
(treated as a write). So there is no translation layer to drift.

## Policy lives in the app. Do not re-check it.

HiveMatrix used to run its own read-only `accessMode` gate before dispatch
(DECISIONS.md Q20). **That gate was removed.** The app is the single enforcement
point: it knows the site list, the access modes, the domain scope and the
ownership rules, and it audits its own decisions.

A refusal comes back as `refusal: { code, siteId, siteName, message }`. The
`message` is surfaced **verbatim** — never paraphrased, never second-guessed,
never retried around.

### The audit event you must not drop

The removed gate was the **only** producer of the `browser:blocked` audit event on
this path. The Command Log's **Blocked** filter reads that event; delete the gate
without replacing the event and the filter silently goes empty — no error, just an
always-empty list.

So `executeCanopyBrowserRun` **re-emits `browser:blocked`** on receipt of a
refusal, with the app's message in the summary and the app's `siteId` as the
target. If you ever refactor this path, that event is load-bearing.

### `browser_sites` is still there — as a display cache

The `browser_sites` table and `src/lib/browser-lane/store.ts` are **kept**. They no
longer gate anything, but the console, system-readiness, lane-setup and
release-smoke all read them. Dropping them breaks those surfaces.

## Sign-in walls

`humanLoginRequired` is passed through **unchanged**, with `finalPage: null` — the
app never returns a logged-out page as the answer. Credentials are a human click
in the app, always. Nothing in this client can request, carry, or trigger a
credential fill.

## Board parity

A direct run happens in-process, so it would otherwise be invisible on the board.
It therefore writes its own task record:

- `status`: `done` (or `failed`) — the run already happened, so the record is
  history. The scheduler only claims `status: "backlog"`, so it can never be
  picked up and re-run.
- `source`: `browser-lane` — the board and `/browser-lane/health` filter on this.
- `output.canopyBrowserRun`: engine, per-step results, final page, and the full
  transcript.
- A `browser:job_created` audit entry, as a dispatch used to emit.

## Every door routes the same way

| Door | How it reaches the app |
| --- | --- |
| `hivematrix_browser` lane tool | `executeBrowserLane` → engine flag |
| `POST /lane/browser` (`server.ts`) | → `executeLaneTool` → same flag |
| Task-intake + voice routing (`voice/browser-lane-intent.ts`) | builds a task that calls `/lane/browser` → same flag |
| COO dispatch (`coo/dispatch.ts` → `server.ts` `createTask`) | under the canopy engine, builds `buildCanopyBrowserTaskDescription` — pointed at `/lane/browser` instead of `desktop_action` |

The COO door is the one that needed changing: it built the drive-Chrome-yourself
prompt directly. It still creates a board task (so its readiness gating, audit and
latency behaviour are unchanged) — the task just calls the lane instead of opening
Chrome.

## Rollback

One edit to `~/.hivematrix/config.json`:

```json
{ "browserLane": { "engine": "desktop" } }
```

`executeBrowserBeeRun`, `browser-lane-app/` and all packaging are intact and
reachable. Deleting them is a **separate, later step** and was deliberately not
done here.

**Known cost of the lever:** the desktop path has no Canopy Browser in the loop,
and HiveMatrix's own read-only gate is gone, so rolled back to `"desktop"` nothing
enforces read-only locally. Treat `"desktop"` as an emergency lever, not a
supported mode.

## What has actually been exercised

Be precise about this — the app is new.

**Exercised live** against the running app on `:4021`:
- `navigate` → `extract` against a real page, real WebKit, real content back.
- A real policy refusal: a write-shaped action against a read-only site returned
  `refusal.code = refusedReadOnly` with an operator-facing message.
- Malformed input (`{"steps":[]}`) returning HTTP 400 in the documented envelope.

**NOT exercised — do not claim it works:**
- The **authenticated multi-step path**. Canopy Browser sessions start empty, so
  no run has yet reached genuinely logged-in content. Until a site is signed into
  in the app and a multi-step run returns logged-in-only markup, the headline use
  case of this cutover is unproven end to end.
- `humanLoginRequired` from a real sign-in wall (only covered by a stubbed test).
- Prose `steps`: `/act` drives selectors, not natural language. Browser Lane's
  free-text `steps` are reported as **not executed** rather than silently dropped
  — which means multi-step workflows expressed in prose currently reduce to
  navigate + extract.
