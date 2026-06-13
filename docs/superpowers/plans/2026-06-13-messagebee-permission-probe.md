# MessageBee Permission Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Design Reference

- `docs/superpowers/specs/2026-06-13-messagebee-permission-probe-design.md`

## Task 1: Add Failing Chat DB Probe Tests

- [ ] Edit `src/lib/messagebee/imessage.test.ts`.
- [ ] Import `writeFileSync` from `node:fs`.
- [ ] Import `canReadChatDb` and `probeChatDbAccess` from `./imessage`.
- [ ] Add a helper that creates a sqlite database without a `message` table.
- [ ] Add tests before production code exists:

```ts
test("probeChatDbAccess reports a missing chat database", () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-missing-"));
  const path = join(dir, "chat.db");
  try {
    const probe = probeChatDbAccess(path);
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, "missing");
    assert.equal(canReadChatDb(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("probeChatDbAccess reports readable chat database", () => {
  const path = makeChatDb();
  try {
    const probe = probeChatDbAccess(path);
    assert.equal(probe.ok, true);
    assert.match(probe.detail, /readable/i);
    assert.equal(canReadChatDb(path), true);
  } finally {
    rmSync(join(path, ".."), { recursive: true, force: true });
  }
});

test("probeChatDbAccess distinguishes schema failures from permission failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-schema-"));
  const path = join(dir, "chat.db");
  const db = new Database(path);
  db.exec("CREATE TABLE not_message (id INTEGER PRIMARY KEY)");
  db.close();
  try {
    const probe = probeChatDbAccess(path);
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, "schema_failed");
    assert.match(probe.detail, /opened/i);
    assert.equal(canReadChatDb(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] Run `npm test -- src/lib/messagebee/imessage.test.ts` and confirm it fails because `probeChatDbAccess` is missing.

## Task 2: Implement Structured Chat DB Probe

- [ ] Edit `src/lib/messagebee/imessage.ts`.
- [ ] Add exported probe types:

```ts
export type ChatDbAccessReason = "missing" | "open_failed" | "schema_failed";

export type ChatDbAccessProbe =
  | { ok: true; detail: string }
  | { ok: false; reason: ChatDbAccessReason; detail: string };
```

- [ ] Implement `probeChatDbAccess(path = chatDbPath()): ChatDbAccessProbe`.
- [ ] Preserve `canReadChatDb(path = chatDbPath()): boolean` as `return probeChatDbAccess(path).ok`.
- [ ] Ensure schema failures happen only after the database opens successfully.
- [ ] Run `npm test -- src/lib/messagebee/imessage.test.ts` and confirm it passes.

## Task 3: Add Failing Onboarding Detail Tests

- [ ] Edit `src/lib/onboarding/onboarding.test.ts`.
- [ ] Add tests for structured MessageBee detail:

```ts
test("messagebee uses diagnostic chat.db detail when unreadable", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({
    now: "T",
    messagebee: {
      enabled: true,
      chatDbReadable: false,
      chatDbDetail: "Messages database opened, but the message table check failed: no such table: message",
    },
  }));
  const mb = step(status, "messagebee");
  assert.equal(mb.state, "incomplete");
  assert.match(mb.detail, /message table check failed/);
});

test("messagebee still reports channel disabled after readable chat.db", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({
    now: "T",
    messagebee: { enabled: false, chatDbReadable: true, chatDbDetail: "Messages database readable" },
  }));
  const mb = step(status, "messagebee");
  assert.equal(mb.state, "incomplete");
  assert.match(mb.detail, /channel disabled/);
});
```

- [ ] Run `npm test -- src/lib/onboarding/onboarding.test.ts` and confirm the new detail test fails at typecheck/runtime before implementation.

## Task 4: Wire Probe Detail Into Onboarding And APIs

- [ ] Edit `src/lib/onboarding/onboarding.ts`.
- [ ] Extend `opts.messagebee` to include optional `chatDbDetail?: string`.
- [ ] If `chatDbReadable` is false, prefer `chatDbDetail` over the generic Full Disk Access copy.
- [ ] Edit `src/daemon/server.ts`.
- [ ] Import/use `probeChatDbAccess()` in `GET /onboarding` and `GET /messagebee`.
- [ ] Preserve `chatDbReadable` in API responses and add `chatDbDetail`.
- [ ] Keep `POST /messagebee/enable` behavior unchanged except for optional clearer error text if the structured probe is used there.
- [ ] Run:

```bash
npm test -- src/lib/messagebee/imessage.test.ts src/lib/onboarding/onboarding.test.ts
```

## Task 5: Review And Full Verification

- [ ] Review changed diff for design compliance.
- [ ] Review changed diff for code quality.
- [ ] Run:

```bash
npm test
npm run typecheck
node scripts/scope-wall.mjs
```

- [ ] Do not run `npx tsx scripts/qwen-readiness.mts`; this change does not touch local-model paths.

## Task 6: Computer Use UI Check

- [ ] Use Computer Use to inspect the running HiveMatrix main screen.
- [ ] Confirm whether the MessageBee setup line now displays diagnostic readiness text instead of only claiming permissions are missing.
- [ ] If the app is not running or Computer Use cannot inspect it, report that limitation and rely on automated verification.
