# Scheduled-Only: Retire Directives & Morning Briefing — Design

> **Status:** Approved for implementation
> **Date:** 2026-06-29
> **Scope:** User-facing rename (Directive → Scheduled item) + Morning Briefing loop removal

---

## 1. Problem Statement

HiveMatrix currently surfaces two scheduling concepts to the operator:

| Concept | Where |
|---|---|
| "Directive" | Voice ("what are my directives"), delete confirm dialog, JS function names, `directivesReply()` text |
| "Scheduled" | Panel header (`<summary>Scheduled</summary>`), "New scheduled item" button, metrics card |
| "Morning Briefing" | `/settings/features` row, `/settings/briefing` API, `startMorningBriefingLoop()` in the daemon |

The Scheduled panel **already reads from `/directives`** internally; the confusion is purely product-layer naming and the existence of a parallel "Morning Briefing" system.

**Decision:** One concept only — "Scheduled item". The Morning Briefing automatic loop must stop.

---

## 2. Current State (what the code does today)

### 2.1 Scheduled panel (console.ts)
- Panel header: `<summary>Scheduled</summary>` ✅ already correct
- Add button: `New scheduled item` ✅ already correct
- Status card: `card("scheduled", dirActive)` ✅ already correct
- **Delete confirm:** `"Delete this directive and all its runs?"` ❌ user-facing "directive"
- **Auto-approval description:** `"non-content directive checkpoints"` ❌ user-facing "directive"

### 2.2 Morning Briefing settings row (console.ts ~line 5093–5134)
- Settings panel loads `/settings/briefing` alongside features + voice settings
- Renders a "Morning briefing" toggle row with hour picker and "Send test" link
- `toggleBriefing()`, `setBriefingHour()`, `sendTestBriefing()` JS functions exist
- **Must be removed from UI**

### 2.3 Daemon startup (index.ts)
- Lines 115–117: `startMorningBriefingLoop()` is imported and called unconditionally
- Loop self-gates on `config.enabled` in `morning-briefing.ts`, but is still **started** — the interval timer registers, the config is polled every minute
- **Must not be started**

### 2.4 Server routes (server.ts)
- `GET /settings/briefing` — returns enabled/hour/lastRunAt config
- `POST /settings/briefing` — updates config, including `enabled: true`
- `POST /briefing/test` — calls `runBriefingNow()` and sends APNs/notify push
- All three must be retired: re-enabling is not allowed, test push must not fire

### 2.5 Voice (command-intent.ts)
- `CommandKind = "directives"` — fine to keep as internal identifier
- `directivesReply()` returns:
  - "You have no standing directives." ❌ user-facing "directives"
  - "No active directives (N total, none running)." ❌
  - "1 active directive: goal." ❌
- Detection regex: `/\b(directives?|standing goals?|what.*standing|what are you watching)\b/` — also maps "what are my scheduled items" to nothing today

---

## 3. Decisions

### 3.1 DB / API layer — no migration required
The `directives` table name, `/directives` routes, SSE event names (`directives:created` etc.), and `directive_store.ts` type names **stay unchanged**. These are internal identifiers; renaming them would risk data loss and is not visible to the operator. A comment will clarify the naming gap.

### 3.2 Morning Briefing loop — do not start it
Remove the `startMorningBriefingLoop()` call from `src/daemon/index.ts`. The `morning-briefing.ts` module itself is not deleted — it can be reused when morning briefing is recreated as a normal Scheduled item. `runBriefingNow()` and `composeBriefing()` remain intact.

### 3.3 /settings/briefing — accept only disabled state
- `GET /settings/briefing` → continues to return the stored config (may say `enabled: false`)
- `POST /settings/briefing` with `{ enabled: true }` → returns `400 Bad Request` with `{ error: "Morning Briefing has been retired. Create a Scheduled item instead." }`
- `POST /settings/briefing` with `{ enabled: false }` or hour-only → still accepted (safe no-op / hour preservation)
- This is the safest compatibility path: existing callers that only read won't break; callers trying to re-enable get a clear error.

### 3.4 /briefing/test — return 410 Gone
`POST /briefing/test` returns `410 Gone` with body `{ error: "Morning Briefing retired. Use a Scheduled item instead." }`. Route is not removed (avoids 404 confusion for callers that cached the path) but sends no push.

### 3.5 Voice replies — rename to "scheduled items"
`directivesReply()` in `command-intent.ts` is updated. The `CommandKind = "directives"` identifier is kept internally but the spoken output says "scheduled items". The detection regex is broadened to also catch "what scheduled items" / "what are my scheduled items".

### 3.6 Settings UI Morning Briefing row — removed
The entire briefing block in the Settings panel (toggle, hour picker, test button) is removed from `console.ts`. The JS functions `toggleBriefing`, `setBriefingHour`, `sendTestBriefing` are also removed. The `/settings/briefing` fetch in the settings load call is removed.

---

## 4. File-by-File Change Map

### `src/daemon/index.ts`
- **Remove** the two lines that import and call `startMorningBriefingLoop()` (lines 116–117)
- The `morning-briefing.ts` import is entirely removed from this file

### `src/daemon/server.ts`
- `POST /settings/briefing`: add guard — if `patch.enabled === true`, return `json(res, 400, { error: "..." })`
- `POST /briefing/test`: replace body with `json(res, 410, { error: "Morning Briefing retired. Use a Scheduled item instead." })`

### `src/daemon/console.ts`
- **Delete confirm dialog** (line ~6737): `"Delete this directive and all its runs?"` → `"Delete this scheduled item and all its runs?"`
- **Auto-approval description** (line ~5113): `"non-content directive checkpoints"` → `"non-content scheduled item checkpoints"`
- **Settings panel** (lines ~5093, ~5122–5134): remove `/settings/briefing` from the `Promise.all` fetch; remove the entire Morning Briefing row render block; remove `toggleBriefing`, `setBriefingHour`, `sendTestBriefing` functions

### `src/lib/voice/command-intent.ts`
- `directivesReply()`: update three string literals:
  - `"You have no standing directives."` → `"You have no scheduled items."`
  - `"No active directives (${rows.length} total, none running)."` → `"No active scheduled items (${rows.length} total, none running)."`
  - `plural(active.length, "active directive")` → `plural(active.length, "active scheduled item")`
- Detection regex (line ~217): extend to catch "what scheduled items are active" / "what are my scheduled items":
  ```ts
  if (/\b(directives?|standing goals?|what.*standing|what are you watching|scheduled items?)\b/.test(t))
    return { kind: "directives" };
  ```

### `src/lib/briefing/morning-briefing.ts`
- No changes required. The module remains for `runBriefingNow` / `composeBriefing` reuse.

### `src/lib/orchestrator/directive-store.ts`
- No changes required (internal identifiers only).

### `src/lib/orchestrator/directive-engine.ts`
- No changes required (internal identifiers only).

---

## 5. Tests to Add / Update

### `src/lib/voice/command-intent.test.ts`
- Update existing: `directivesReply([])` should match `"no scheduled items"` (not "no standing directives")
- Update existing: `directivesReply([{ goal: "ship news", status: "active" }])` should match `"1 active scheduled item: ship news"`
- Add: `detectCommandIntent("what are my scheduled items").kind === "directives"`
- Add: `detectCommandIntent("what scheduled items are active").kind === "directives"`
- Keep: `detectCommandIntent("what are my directives").kind === "directives"` (backward compat detection)

### `src/daemon/server.test.ts`
- Add: `POST /settings/briefing { enabled: true }` → 400
- Add: `POST /settings/briefing { enabled: false }` → 200 (accepted)
- Add: `POST /briefing/test` → 410
- Add: `GET /settings/briefing` → 200 (still readable)

### `src/daemon/console.test.ts`
- Add: console source string search confirms no `"Delete this directive"` in user-facing confirm text
- Add: console source confirms no `"standing directive"` string
- Add: console source confirms no `"Morning briefing"` in the settings render block (confirm the row was removed)
- Add: console source confirms `"Delete this scheduled item"` is present

### `src/daemon/index.test.ts` (if it exists) or new grep-based test
- Add: source of `src/daemon/index.ts` does not call `startMorningBriefingLoop`

---

## 6. Acceptance Criteria

| # | Criterion | How verified |
|---|---|---|
| 1 | Scheduled panel renders from existing DB rows | Existing render test + manual check |
| 2 | "New scheduled item" button opens form | Existing UI path unchanged |
| 3 | Delete confirm says "Delete this scheduled item and all its runs?" | console.test.ts grep |
| 4 | Voice "what are my directives" → "You have no scheduled items." | command-intent.test.ts |
| 5 | Voice "what scheduled items are active" → `kind: "directives"` | command-intent.test.ts |
| 6 | Morning briefing loop not started in daemon | index.ts grep test |
| 7 | Settings panel has no Morning Briefing row | console.test.ts grep |
| 8 | `POST /settings/briefing { enabled: true }` → 400 | server.test.ts |
| 9 | `POST /briefing/test` → 410 | server.test.ts |
| 10 | `npm run typecheck` passes | CI gate |
| 11 | `npm test` passes | CI gate |
| 12 | `node scripts/scope-wall.mjs` passes | CI gate |

---

## 7. Non-Goals

- Renaming the `directives` DB table or `/directives` API routes
- Renaming TypeScript types in `directive-store.ts`
- Replacing Morning Briefing with a Scheduled item (that is a follow-up)
- Changing SSE event names (`directives:created` etc.)
- Any DB migration

---

## 8. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Existing scheduled items stop rendering | Low | Panel still reads `/directives` unchanged |
| `POST /settings/briefing` callers break | Low | Only `enabled: true` is rejected; read path + `enabled: false` still work |
| Morning briefing fires after change | None | Loop is not started; `enabled: false` is already in config as fallback |
| console.ts edit introduces HTML parse error | Low | Targeted string replacements; test suite covers render paths |
