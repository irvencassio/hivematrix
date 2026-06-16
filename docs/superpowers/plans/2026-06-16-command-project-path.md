# Command Project Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local command tasks use the selected user-home project path and never fall back to `/`.

**Architecture:** Keep local command discovery unchanged. Send the console's existing `#t_path` value to `/commands/run`, then normalize and validate it server-side before task creation.

**Tech Stack:** TypeScript, Node built-in `path` and `os`, Node test runner.

---

### Task 1: Command Project Path Tests

**Files:**
- Modify: `src/daemon/server.test.ts`
- Test: `src/daemon/server.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that import `normalizeHomeProjectPath` and `CONSOLE_HTML`, then assert:

```ts
assert.equal(normalizeHomeProjectPath("~/hivematrix", "/Users/example"), "/Users/example/hivematrix");
assert.equal(normalizeHomeProjectPath("$HOME/hivematrix", "/Users/example"), "/Users/example/hivematrix");
assert.throws(() => normalizeHomeProjectPath("/", "/Users/example"), /cannot be root/);
assert.throws(() => normalizeHomeProjectPath("/tmp/hivematrix", "/Users/example"), /must be under/);
assert.match(CONSOLE_HTML, /projectPath:\s*projectPath/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/daemon/server.test.ts
```

Expected: fails because `normalizeHomeProjectPath` does not exist and/or the command payload does not include `projectPath`.

### Task 2: Server Normalization and Command Route

**Files:**
- Modify: `src/daemon/server.ts`

- [ ] **Step 1: Implement normalization helper**

Add an exported helper that expands `~` and `$HOME`, resolves the path, rejects `/`, and requires `$HOME` containment.

- [ ] **Step 2: Use helper in `/commands/run`**

Read `body.projectPath`, normalize it, return `400` on validation errors, and pass the normalized path into `Task.create`.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/daemon/server.test.ts
```

Expected: all tests in `server.test.ts` pass.

### Task 3: Console Payload

**Files:**
- Modify: `src/daemon/console.ts`
- Test: `src/daemon/server.test.ts`

- [ ] **Step 1: Include selected path in command launches**

In `runCommand()`, read `document.getElementById("t_path").value.trim()` and include it in the `/commands/run` JSON body.

- [ ] **Step 2: Verify the console HTML assertion passes**

Run:

```bash
npm test -- src/daemon/server.test.ts
```

Expected: `server.test.ts` passes.

### Task 4: Full Verification, Commit, Release

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run repo gates**

Run:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

Expected: all pass.

- [ ] **Step 2: Commit and push fix**

Run:

```bash
git add docs/superpowers/specs/2026-06-16-command-project-path-design.md docs/superpowers/plans/2026-06-16-command-project-path.md src/daemon/server.ts src/daemon/server.test.ts src/daemon/console.ts
git commit -m "fix: keep command tasks on selected home project path"
git push origin main
```

- [ ] **Step 3: Release so installed apps see update**

Run:

```bash
node scripts/release.mjs 0.1.35 "fix: command launches use selected home project path"
```

Expected: release script bumps versions, commits, pushes, builds signed/notarized artifacts, publishes GitHub release, and verifies the update feed.
