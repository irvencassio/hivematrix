# Scheduled-Only: Retire Directives & Morning Briefing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design doc:** `docs/superpowers/specs/2026-06-29-scheduled-only-retire-directives-design.md`  
**Date:** 2026-06-29  
**TDD order:** Every task writes the failing test(s) first, confirms they fail, then writes the minimum code to make them pass.

---

## Scope summary

Four files change; two are no-ops (internal only):

| File | Changes |
|---|---|
| `src/lib/voice/command-intent.ts` | Rename voice reply strings; broaden detection regex |
| `src/daemon/server.ts` | Guard `POST /settings/briefing` (400 on enabled:true); `POST /briefing/test` → 410 |
| `src/daemon/console.ts` | Fix two user-facing strings; remove Morning Briefing settings block + JS functions |
| `src/daemon/index.ts` | Remove `startMorningBriefingLoop` import + call |
| `src/lib/briefing/morning-briefing.ts` | **No changes** |
| `src/lib/orchestrator/directive-store.ts` | **No changes** |
| `src/lib/orchestrator/directive-engine.ts` | **No changes** |

---

## Task 1 — Failing tests: voice reply renames + new intent detection

**File:** `src/lib/voice/command-intent.test.ts`  
**Estimated time:** 3 min

### What to add

Find the existing `directivesReply` tests (they currently assert "standing directives" language) and update/add:

```ts
// UPDATE: empty list reply
it('directivesReply: empty list uses "scheduled items" wording', async () => {
  const result = await directivesReply([]);
  expect(result).toMatch(/no scheduled items/i);
  expect(result).not.toMatch(/standing directive/i);
});

// UPDATE: active item reply
it('directivesReply: active item uses "scheduled item" singular', async () => {
  const rows = [{ goal: "ship news", status: "active" as const }];
  const result = await directivesReply(rows);
  expect(result).toMatch(/1 active scheduled item/i);
  expect(result).not.toMatch(/active directive/i);
});

// UPDATE: none running reply
it('directivesReply: none-running reply uses "scheduled items" wording', async () => {
  const rows = [{ goal: "ship news", status: "idle" as const }];
  const result = await directivesReply(rows);
  expect(result).toMatch(/no active scheduled items/i);
  expect(result).not.toMatch(/active directive/i);
});

// ADD: new detection phrases
it('detectCommandIntent maps "what are my scheduled items" to directives kind', () => {
  expect(detectCommandIntent("what are my scheduled items").kind).toBe("directives");
});

it('detectCommandIntent maps "what scheduled items are active" to directives kind', () => {
  expect(detectCommandIntent("what scheduled items are active").kind).toBe("directives");
});

// KEEP: backward compat
it('detectCommandIntent still maps "what are my directives" to directives kind', () => {
  expect(detectCommandIntent("what are my directives").kind).toBe("directives");
});
```

**RED gate:** Run `npm test -- --testPathPattern command-intent` — these tests must fail before proceeding.

---

## Task 2 — Failing tests: server briefing guards

**File:** `src/daemon/server.test.ts`  
**Estimated time:** 3 min

### What to add

```ts
describe('/settings/briefing retirement guards', () => {
  it('GET /settings/briefing still returns 200 with config', async () => {
    const res = await request(app).get('/settings/briefing');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
  });

  it('POST /settings/briefing with enabled:true returns 400', async () => {
    const res = await request(app)
      .post('/settings/briefing')
      .send({ enabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/retired/i);
  });

  it('POST /settings/briefing with enabled:false returns 200', async () => {
    const res = await request(app)
      .post('/settings/briefing')
      .send({ enabled: false });
    expect(res.status).toBe(200);
  });

  it('POST /briefing/test returns 410 Gone', async () => {
    const res = await request(app).post('/briefing/test');
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/retired/i);
  });
});
```

**RED gate:** Run `npm test -- --testPathPattern server` — the new tests must fail before proceeding.

---

## Task 3 — Failing tests: console source string checks

**File:** `src/daemon/console.test.ts`  
**Estimated time:** 3 min

### What to add

```ts
import fs from 'fs';
import path from 'path';

describe('console.ts user-facing copy', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, 'console.ts'),
    'utf8'
  );

  it('does not contain user-facing "Delete this directive" string', () => {
    expect(src).not.toContain('Delete this directive');
  });

  it('does not contain "standing directive" string', () => {
    expect(src).not.toContain('standing directive');
  });

  it('contains "Delete this scheduled item" string', () => {
    expect(src).toContain('Delete this scheduled item');
  });

  it('does not contain "Morning briefing" in settings render block', () => {
    // The string "Morning briefing" should not appear in the UI HTML
    expect(src).not.toContain('Morning briefing');
  });

  it('does not contain toggleBriefing function', () => {
    expect(src).not.toContain('toggleBriefing');
  });

  it('does not contain sendTestBriefing function', () => {
    expect(src).not.toContain('sendTestBriefing');
  });
});
```

**RED gate:** Run `npm test -- --testPathPattern console` — the new tests must fail before proceeding.

---

## Task 4 — Failing test: morning briefing loop not started

**File:** `src/daemon/index.test.ts` (create if it does not exist)  
**Estimated time:** 2 min

### What to add

```ts
import fs from 'fs';
import path from 'path';

describe('src/daemon/index.ts startup safety', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, 'index.ts'),
    'utf8'
  );

  it('does not call startMorningBriefingLoop', () => {
    expect(src).not.toContain('startMorningBriefingLoop');
  });
});
```

**RED gate:** Run `npm test -- --testPathPattern 'daemon/index'` — the test must fail before proceeding.

---

## Task 5 — Implement: voice reply renames + detection regex

**File:** `src/lib/voice/command-intent.ts`  
**Estimated time:** 4 min

### Changes

**a) Detection regex** — find the line containing `/\b(directives?|standing goals?|what.*standing|what are you watching)\b/` and extend it:

```ts
// Before
if (/\b(directives?|standing goals?|what.*standing|what are you watching)\b/.test(t))

// After
if (/\b(directives?|standing goals?|what.*standing|what are you watching|scheduled items?)\b/.test(t))
```

**b) `directivesReply()` empty list** — find:

```ts
return "You have no standing directives.";
```

Replace with:

```ts
return "You have no scheduled items.";
```

**c) `directivesReply()` none-running branch** — find:

```ts
return `No active directives (${rows.length} total, none running).`;
```

Replace with:

```ts
return `No active scheduled items (${rows.length} total, none running).`;
```

**d) `directivesReply()` active items branch** — find usage of `plural(active.length, "active directive")` and replace:

```ts
// Before
plural(active.length, "active directive")

// After
plural(active.length, "active scheduled item")
```

**GREEN gate:** Run `npm test -- --testPathPattern command-intent` — Task 1 tests must now pass.

---

## Task 6 — Implement: server briefing guards

**File:** `src/daemon/server.ts`  
**Estimated time:** 4 min

### Changes

**a) `POST /settings/briefing` guard**

Find the handler body for `POST /settings/briefing`. Before writing the patch to config, add:

```ts
if (patch.enabled === true) {
  return json(res, 400, {
    error: "Morning Briefing has been retired. Create a Scheduled item instead."
  });
}
```

**b) `POST /briefing/test` retirement**

Find the handler for `POST /briefing/test`. Replace the entire handler body with:

```ts
return json(res, 410, {
  error: "Morning Briefing retired. Use a Scheduled item instead."
});
```

(`json` is already the local helper that writes the status code and body; use whatever response helper `server.ts` uses consistently.)

**GREEN gate:** Run `npm test -- --testPathPattern server` — Task 2 tests must now pass.

---

## Task 7 — Implement: console.ts string fixes + briefing settings removal

**File:** `src/daemon/console.ts`  
**Estimated time:** 5 min

This is the largest single file change. Work in three targeted sub-steps.

### 7a — Delete confirm dialog string

Search for:

```
Delete this directive and all its runs?
```

Replace with:

```
Delete this scheduled item and all its runs?
```

### 7b — Auto-approval description string

Search for:

```
non-content directive checkpoints
```

Replace with:

```
non-content scheduled item checkpoints
```

### 7c — Remove Morning Briefing settings block

Locate the block that:
1. Fetches `/settings/briefing` in the `Promise.all` settings load
2. Renders the "Morning briefing" toggle row, hour picker, and "Send test" link
3. Declares `toggleBriefing`, `setBriefingHour`, `sendTestBriefing` JS functions

Remove all of the above. The `Promise.all` should drop the `/settings/briefing` fetch; the index of remaining results must be adjusted if briefing result was consumed positionally. The settings panel render block for briefing is deleted entirely. The three JS functions are deleted entirely.

**GREEN gate:** Run `npm test -- --testPathPattern console` — Task 3 tests must now pass.

---

## Task 8 — Implement: remove morning briefing startup call

**File:** `src/daemon/index.ts`  
**Estimated time:** 2 min

### Changes

Remove the import line:

```ts
import { startMorningBriefingLoop } from "../lib/briefing/morning-briefing.js";
```

Remove the call site (typically one or two lines around line 115–117):

```ts
startMorningBriefingLoop();
```

No other changes to `index.ts`.

**GREEN gate:** Run `npm test -- --testPathPattern 'daemon/index'` — Task 4 test must now pass.

---

## Task 9 — Verification gates

Run all three gates in sequence:

```bash
npm run typecheck
```

Fix any type errors introduced (most likely: a positional index into a `Promise.all` array if the briefing fetch was removed — adjust the destructure accordingly).

```bash
npm test
```

All tests must pass — Tasks 1–4 green checks, plus no regressions in existing directive-store/engine/scheduled-runner tests.

```bash
node scripts/scope-wall.mjs
```

Zero violations expected (no new imports of retired modules).

---

## Acceptance checklist

- [ ] Task 1 tests pass: voice replies say "scheduled items", detection catches new phrases
- [ ] Task 2 tests pass: `POST /settings/briefing {enabled:true}` → 400; `POST /briefing/test` → 410
- [ ] Task 3 tests pass: no "Delete this directive", no "Morning briefing" in console source
- [ ] Task 4 test passes: `startMorningBriefingLoop` not in index.ts source
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all passing
- [ ] `node scripts/scope-wall.mjs` — zero violations
- [ ] Existing scheduled-runner / directive-engine tests untouched and green

---

## Non-goals (do not touch)

- `src/lib/briefing/morning-briefing.ts` — keep for future reuse
- `src/lib/orchestrator/directive-store.ts` — internal identifiers only
- `src/lib/orchestrator/directive-engine.ts` — internal identifiers only
- `directives` DB table, `/directives` routes, SSE event names
- Any DB migration
