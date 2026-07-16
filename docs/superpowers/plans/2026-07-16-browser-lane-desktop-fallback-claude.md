# Browser Lane Desktop Fallback → Claude Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-browser-lane-desktop-fallback-claude-design.md` — read it first for the root-cause chain and the rejected alternatives (Approaches A/B). Do NOT release; the operator releases.

## Task 1 — `executeBrowserBeeRun` resolves the Desktop fallback to Claude, not a local model

**File:** `src/lib/orchestrator/lane-tools.ts` (fix) + `src/lib/orchestrator/lane-tools.test.ts` (test)

**Current code** (`lane-tools.ts`, inside `executeBrowserBeeRun`, immediately after the `resolveBrowserBeeBacking` call):
```ts
  let model: string;
  let description: string;
  if (decision.backing === "desktop_fallback") {
    const { getLocalModelConfig } = await import("@/lib/config/constants");
    const local = getLocalModelConfig();
    if (!local?.modelName) {
      return "Error: the Desktop Lane fallback needs a configured local model (config localModel.modelName), but none is set.";
    }
    model = local.modelName;
    description = buildBrowserBeeDesktopFallbackDescription(payload, { requestedProjectPath: ctx.projectPath });
  } else {
    model = CODEX_COMPUTER_USE_MODEL_ID;
    description = buildBrowserBeeTaskDescription(payload, { requestedProjectPath: ctx.projectPath });
  }
```

### Step 1a — RED: write the failing test first

Add to `src/lib/orchestrator/lane-tools.test.ts`, near the other `executeBrowserBeeRun` tests (after the "allows form_fill against a readwrite-access site" test, ~line 403). This file already imports `join`/`readFileSync`/`writeFileSync` and has `SKILL_HOME` in scope (see the top-of-file fixture) — reuse both rather than re-deriving paths.

```ts
test("executeBrowserBeeRun resolves the Desktop fallback to a Claude model, not a local model", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));

  // Force Codex into subscription (non-api-key) mode so resolveBrowserBeeBacking
  // cannot pick codex_computer_use — see src/lib/usage/codex.ts normalizeAuthMode:
  // auth_mode "chatgpt" + no OPENAI_API_KEY yields authMode "subscription".
  const codexAuthPath = join(SKILL_HOME, ".codex", "auth.json");
  const originalCodexAuth = readFileSync(codexAuthPath, "utf-8");
  writeFileSync(codexAuthPath, JSON.stringify({ auth_mode: "chatgpt", tokens: {} }));
  t.after(() => writeFileSync(codexAuthPath, originalCodexAuth));

  // Opt into the Desktop fallback for this test only.
  const configPath = join(SKILL_HOME, ".hivematrix", "config.json");
  const originalConfig = readFileSync(configPath, "utf-8");
  writeFileSync(configPath, JSON.stringify({ ...JSON.parse(originalConfig), browserLane: { desktopFallback: true } }));
  t.after(() => writeFileSync(configPath, originalConfig));

  let capturedBody: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.endsWith("/tasks") && init?.method === "POST") {
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ _id: "task-desktop-fallback-1", title: "stub" }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  upsertBrowserSite({
    id: "fallback-site-a",
    displayName: "Fallback Site A",
    homeUrl: "https://fallback-site-a.example.com/home",
    allowedDomains: ["fallback-site-a.example.com"],
    accessMode: "readwrite",
  } as never);

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "workflow",
    objective: "Log in and capture the account summary",
    startUrl: "https://fallback-site-a.example.com/login",
    jobType: "authenticated_research",
    requiresLogin: true,
  }, browserCtx());

  assert.match(out, /Created Browser Lane task/, "the Desktop fallback must dispatch, not error");
  assert.doesNotMatch(out, /configured local model/i, "must never require a local model");
  assert.ok(capturedBody, "the /tasks POST must have been captured");
  assert.match(String(capturedBody!.model), /^(sonnet|opus|haiku)$/, "the fallback must run on a Claude model id");
  assert.match(String(capturedBody!.description), /Claude/i, "the task description must name Claude, not a local model");
});
```

Run `npx tsx --test src/lib/orchestrator/lane-tools.test.ts` (or the project's usual single-file test invocation — check `package.json`'s `test` script if `npx tsx --test` isn't it). Confirm this test **fails** against the current code with the old error message (`"...needs a configured local model..."`), not a setup/fixture error. If it fails for a different reason (e.g. the codex-auth or config fixture didn't take effect, or `desktopbee` capability isn't available), fix the fixture before touching production code — the RED must be the real regression, not a broken test.

### Step 1b — GREEN: make it pass

Edit `executeBrowserBeeRun` in `lane-tools.ts` to:

```ts
  let model: string;
  let description: string;
  if (decision.backing === "desktop_fallback") {
    const { getRoleModels, CLAUDE_SONNET_ID } = await import("@/lib/models/available");
    model = getRoleModels().coding.trim() || CLAUDE_SONNET_ID;
    description = buildBrowserBeeDesktopFallbackDescription(payload, { requestedProjectPath: ctx.projectPath });
  } else {
    model = CODEX_COMPUTER_USE_MODEL_ID;
    description = buildBrowserBeeTaskDescription(payload, { requestedProjectPath: ctx.projectPath });
  }
```

Also update, in the same file:
- The `laneLabel` line a few lines below: `"Desktop fallback — local model"` → `"Desktop fallback — Claude"`.
- Run `grep -n "local model" src/lib/orchestrator/lane-tools.ts` and update every remaining comment referencing "the local model" for this branch (the "Decide which engine drives the browser" comment above the `resolveBrowserBeeBacking` call, and the "the local model (which carries the desktop_action tool) for the fallback path" comment above the `/tasks` POST) to describe Claude instead.

Re-run the test — confirm GREEN. Run the full `lane-tools.test.ts` file to confirm no other test regressed (the file-scoped Codex-auth and config fixtures are restored in `t.after()`, so ordering shouldn't matter, but verify).

**Two-stage review before moving to Task 2:**
1. *Spec compliance* — does the fix match the design doc's Approach C exactly (no hardcoded model string, no new config key, `getRoleModels().coding` with the `CLAUDE_SONNET_ID` fallback idiom)? Does the old error string no longer exist anywhere in the branch?
2. *Code quality* — no leftover unused imports (`getLocalModelConfig` import in this function should be gone entirely, not just unused), no stray console logs, the dynamic `import()` idiom matches the surrounding code's existing style (this function already dynamically imports its other dependencies at the top).

---

## Task 2 — Update fallback prose from "local model" to "Claude"

**Files:** `src/lib/browser-lane/jobs.ts` (fix) + `src/lib/browser-lane/jobs.test.ts` (test) + `docs/BRINGUP-CHECKLIST.md` (doc, no test)

### Step 2a — RED: write the failing test first

`jobs.test.ts` already has a test building `buildBrowserBeeDesktopFallbackDescription`'s output (search the file for its name) and separately covers `resolveBrowserBeeBacking`'s reason strings (~line 453-485 region in `jobs.ts`, per the design doc). Add assertions to (or extend) those existing tests rather than duplicating fixture setup:

```ts
// Inside (or alongside) the existing buildBrowserBeeDesktopFallbackDescription test:
assert.match(description, /Claude/, "the fallback description must name Claude");
assert.doesNotMatch(description, /local model/i, "the fallback description must not call this a local-model path");
```

```ts
// A new small test near the existing resolveBrowserBeeBacking coverage:
test("resolveBrowserBeeBacking's opt-in-suggestion reason names Claude, not a local model", () => {
  const decision = resolveBrowserBeeBacking({
    codexAuthMode: "subscription",
    desktopFallbackEnabled: false,
    desktopBeeAvailable: true,
  });
  assert.equal(decision.backing, null);
  assert.match(decision.reason, /Claude/);
  assert.doesNotMatch(decision.reason, /local model/i);
});
```

Run the file's tests, confirm these fail against current prose (which says "local model").

### Step 2b — GREEN: make it pass

Run `grep -n "local model" src/lib/browser-lane/jobs.ts` and update every hit:
- The doc comment above `buildBrowserBeeDesktopFallbackDescription` ("driven by the local model through Desktop Lane" → "driven by Claude through Desktop Lane").
- The function's own "Note that this ran on the Desktop Lane fallback (local model)..." output-expectations bullet → "(Claude)".
- `resolveBrowserBeeBacking`'s refusal-reason string ("...drive a real desktop browser with the local model instead" → "...drive a real desktop browser with Claude instead").

Re-run, confirm GREEN.

### Step 2c — Docs (no test surface; edit directly)

`docs/BRINGUP-CHECKLIST.md:46` currently reads:
```
- [ ] **Browser Lane**: Codex Computer Use auth for the frontier backend, or enable the Desktop Lane fallback for local-only.
```
Change the trailing clause so it no longer says "local-only" (the fallback now runs on Claude via Desktop Lane, still opt-in, still lower reliability than Codex Computer Use).

**Two-stage review:**
1. *Spec compliance* — every "local model" reference in the two touched files is gone; no behavior changed, only prose (confirm with a diff review, not just the grep re-run).
2. *Code quality* — comment wording reads naturally in context (not a mechanical find/replace that leaves an awkward sentence); no unrelated prose nearby was touched.

---

## Task 3 — Finish

Not a subagent task — run directly:

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

All three must be clean. Then:
- `rg -n "needs a configured local model" src` → zero hits.
- `rg -n "local model" src/lib/orchestrator/lane-tools.ts src/lib/browser-lane/jobs.ts` → zero hits (everything in scope for this plan updated).
- Re-read the diff end-to-end once against the design doc's "Design" section (not just each task's own review) to catch anything a per-task review missed in isolation.

Report status to the operator. No commit, no PR, no release step — the operator decides what to do with the diff and the two new docs.
