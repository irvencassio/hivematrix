# Flash task project/projectPath resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-16-flash-task-project-resolution-design.md`.
Read it first — it verifies the cited task against the live daemon (real, not a
stale/fabricated ID like a near-identical one from earlier today), reconstructs
the exact code path that broke, and finds two additional real bugs beyond the
3 originally cited (a self-improve regex boundary bug that would misroute
`hivematrix-watch`/`hivematrix-ios`/etc. into the *core* repo, and an unset
`selfImprove.repoPath` + packaged-app `cwd` interaction that would land
self-improvement escalations on bare `homedir()` too).

**Before running any test code below as the RED step: re-read the actual
current source of the function you're editing and confirm the test's
assertions match reality (imports, exact strings, current line shapes). Plan
code is a starting point, not a transcription to trust blindly.**

- [ ] Task 1: `resolveProjectByName` in `src/lib/routing/aliases.ts`

  This is the shared primitive both later tasks depend on — land it first,
  alone.

  File: `src/lib/routing/aliases.ts`. Add this import at the top (alongside
  the existing `fs`/`path`/`os` imports):
  ```ts
  import { discoverProjects } from "./project-discovery";
  ```
  Add this after `resolveProject`'s closing `}` (currently ends at line 73),
  before `parseProjectFromMessage`:
  ```ts

  export interface ResolvedProject {
    name: string;
    path: string;
  }

  /**
   * Resolve a project NAME (as typed by an operator or supplied by a model,
   * e.g. via escalate_to_task's `project` argument) to a real path. Tries the
   * alias/custom/system registry first (resolveProject), then falls back to
   * auto-discovered git repos (project-discovery.ts) by case-insensitive name
   * match — this is what lets "hivematrix-watch" resolve without ever being
   * added to projects.json. discoverProjects()'s result is already sorted
   * best-match-first (source count + manifest + recency), so the first
   * case-insensitive name match is correct even when a name collides across
   * mirrored directories. Returns null, never a guessed fallback, when
   * nothing matches — callers must not silently default to homedir() for a
   * name they were given but couldn't resolve.
   */
  export function resolveProjectByName(name: string): ResolvedProject | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const aliasPath = resolveProject(trimmed);
    if (aliasPath) return { name: trimmed, path: aliasPath };
    const lower = trimmed.toLowerCase();
    const discovered = discoverProjects().find((p) => p.name.toLowerCase() === lower);
    return discovered ? { name: discovered.name, path: discovered.path } : null;
  }
  ```

  Replace `src/lib/routing/aliases.test.ts` (currently 8 lines) in full:
  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { homedir } from "os";
  import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";

  // resolveProjectByName's discovery fallback reads $HOME (via
  // project-discovery.ts) — point HOME at a temp dir with one fake git repo,
  // same isolation pattern as project-discovery-cache.test.ts, so the scan is
  // deterministic and doesn't depend on this machine's real repos.
  const TMP = mkdtempSync(join(tmpdir(), "hm-aliases-test-"));
  process.env.HOME = TMP;
  mkdirSync(join(TMP, "SomeRepo", ".git"), { recursive: true });
  writeFileSync(join(TMP, "SomeRepo", ".git", "HEAD"), "ref: refs/heads/main");
  writeFileSync(join(TMP, "SomeRepo", "package.json"), JSON.stringify({ name: "SomeRepo" }));

  const { resolveProject, resolveProjectByName } = await import("./aliases");
  const { discoverProjectsFresh } = await import("./project-discovery");
  discoverProjectsFresh(); // populate the cache resolveProjectByName's fallback reads

  test.after(() => { delete process.env.HOME; rmSync(TMP, { recursive: true, force: true }); });

  test("resolveProject keeps legacy ops alias mapped to home", () => {
    assert.equal(resolveProject("ops"), homedir());
  });

  test("resolveProjectByName resolves a discovered git repo by case-insensitive name", () => {
    const resolved = resolveProjectByName("somerepo");
    assert.ok(resolved, "expected a match");
    assert.equal(resolved!.name, "SomeRepo");
    assert.equal(resolved!.path, join(TMP, "SomeRepo"));
  });

  test("resolveProjectByName returns null when nothing matches", () => {
    assert.equal(resolveProjectByName("no-such-project-anywhere"), null);
  });

  test("resolveProjectByName returns null for blank input", () => {
    assert.equal(resolveProjectByName("   "), null);
  });
  ```
  RED: run `NODE_ENV=test node --import tsx/esm --test src/lib/routing/aliases.test.ts`
  before the `aliases.ts` edit — expect a TS/import error (`resolveProjectByName`
  doesn't exist yet).
  GREEN: after the `aliases.ts` edit, re-run, expect all 4 tests to pass.

- [ ] Task 2: Tighten the self-improve regex + `selfImproveRepoPath`'s discovery fallback

  File: `src/lib/flash/flash-mcp.ts`. Depends on Task 1 (imports
  `resolveProjectByName`).

  Add to the top imports (currently `import { join } from "path";` at line 34
  and no `aliases` import):
  ```ts
  import { basename, join } from "path";
  ```
  (replaces the existing `import { join } from "path";` line) and add a new
  import line near the other `@/lib/...` imports (e.g. after the
  `getConnectivityPolicy` import at line 35):
  ```ts
  import { resolveProjectByName } from "@/lib/routing/aliases";
  ```

  Currently (line 298):
  ```ts
    const isSelfImprove = kind === "self-improvement" || /\bhive\s?matrix\b/i.test(`${title} ${description}`);
  ```
  Change to:
  ```ts
    const isSelfImprove = kind === "self-improvement" || /\bhive\s?matrix\b(?!-)/i.test(`${title} ${description}`);
  ```
  The `(?!-)` negative lookahead means "HiveMatrix-watch"/"hivematrix-ios"/etc.
  (a hyphen immediately after "matrix") no longer false-positive as the core
  repo, while "Hive Matrix", "HiveMatrix's", and sentence-final "HiveMatrix."
  still match exactly as before.

  Currently (lines 328-332):
  ```ts
  export function selfImproveRepoPath(): string {
    const cfg = loadHiveConfig().selfImprove as { repoPath?: unknown } | undefined;
    const configured = typeof cfg?.repoPath === "string" ? cfg.repoPath.trim() : "";
    return configured || process.cwd();
  }
  ```
  Change to:
  ```ts
  export function selfImproveRepoPath(): string {
    const cfg = loadHiveConfig().selfImprove as { repoPath?: unknown } | undefined;
    const configured = typeof cfg?.repoPath === "string" ? cfg.repoPath.trim() : "";
    if (configured) return configured;
    // In the packaged app, process.cwd() is the LaunchAgent's WorkingDirectory
    // (homedir() — see onboarding/actions.ts's plist), never a git checkout,
    // so try the auto-discovered "hivematrix" repo before falling back to cwd.
    const discovered = resolveProjectByName("hivematrix");
    return discovered?.path || process.cwd();
  }
  ```
  Also update its docstring comment (lines ~314-327, the block starting
  "Resolves the HiveMatrix repo path for self-improvement escalations...") —
  append one sentence after the existing "operator MUST set..." sentence:
  ```
   * Falls back further to an auto-discovered "hivematrix" repo (via
   * resolveProjectByName) before finally giving up and using cwd — this
   * makes the unconfigured packaged-app case land in the real checkout
   * instead of the LaunchAgent's homedir() working directory, without
   * removing the "operator should configure this" contract above.
  ```

  Add to `src/lib/flash/flash-mcp.test.ts` (find the existing regex-related
  tests near the `resolveEscalationTarget` block — the file already has tests
  asserting `isSelfImprove: true` for "HiveMatrix's voice loop-closer" and
  "Hive Matrix onboarding flow"; add these alongside them):
  ```ts
  test("resolveEscalationTarget: a hyphenated sibling repo name is NOT treated as core-repo self-improvement", () => {
    const watch = resolveEscalationTarget({
      title: "HiveMatrix-watch UX overhaul",
      description: "Improve voice dictation on the watch app.",
      argProjectPath: undefined,
      repoPath: "/Users/irvcassio/hivematrix",
    });
    assert.equal(watch.isSelfImprove, false, "hivematrix-watch is a different repo, not core self-improvement");
    assert.doesNotMatch(watch.description, /Superpowers pipeline/);

    const ios = resolveEscalationTarget({
      title: "fix a bug",
      description: "there's a crash in hivematrix-ios's onboarding flow",
      argProjectPath: undefined,
      repoPath: "/Users/irvcassio/hivematrix",
    });
    assert.equal(ios.isSelfImprove, false);
  });
  ```
  Also add a standalone test for the new `selfImproveRepoPath` tier (this
  needs the same temp-HOME + fake-repo + `discoverProjectsFresh()` isolation
  pattern as `aliases.test.ts` Task 1 — check how this file currently isolates
  `HOME`/config for existing `selfImproveRepoPath` coverage, if any, before
  writing this; if none exists yet, add a new isolated block similar to
  `self-improve-prover.test.ts`'s temp-HOME setup, but as a `test()` with its
  own inline temp dir + `test.after` cleanup rather than file-level module
  state, to avoid disturbing this file's other tests):
  ```ts
  test("selfImproveRepoPath: falls back to a discovered 'hivematrix' repo, not raw cwd, when unconfigured", async (t) => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const TMP = mkdtempSync(join(tmpdir(), "hm-selfimprove-repopath-"));
    const ORIGINAL_HOME = process.env.HOME;
    process.env.HOME = TMP;
    mkdirSync(join(TMP, "hivematrix", ".git"), { recursive: true });
    writeFileSync(join(TMP, "hivematrix", ".git", "HEAD"), "ref: refs/heads/main");
    writeFileSync(join(TMP, "hivematrix", "package.json"), JSON.stringify({ name: "hivematrix" }));
    t.after(() => {
      if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME; else delete process.env.HOME;
      rmSync(TMP, { recursive: true, force: true });
    });
    const { discoverProjectsFresh } = await import("@/lib/routing/project-discovery");
    discoverProjectsFresh();
    // No ~/.hivematrix/config.json written in TMP, so selfImprove.repoPath is unset.
    assert.equal(selfImproveRepoPath(), join(TMP, "hivematrix"));
  });
  ```
  RED: run `NODE_ENV=test node --import tsx/esm --test src/lib/flash/flash-mcp.test.ts`
  before the `flash-mcp.ts` edits — the hyphenated-repo test fails (`isSelfImprove`
  is currently `true`), the `selfImproveRepoPath` test fails (currently returns
  `process.cwd()`, not the discovered path — likely the repo's own cwd during
  test, not `TMP/hivematrix`).
  GREEN: after both edits, re-run, expect all pass, including the pre-existing
  "Hive Matrix"/"HiveMatrix's" tests (must still be `true`).

- [ ] Task 3: `resolveEscalationTarget` project-name resolution + tool schema + `handleEscalateToTask` wiring

  File: `src/lib/flash/flash-mcp.ts`. Depends on Tasks 1-2 landing first (same
  file — do this in the same sitting as Task 2 to avoid re-diffing).

  Currently (lines 270-286):
  ```ts
  export interface ResolveEscalationTargetOpts {
    title: string;
    description: string;
    /** Raw `kind` arg off the tool call, if any (e.g. "self-improvement"). */
    kind?: string;
    /** `projectPath` arg off the tool call, if any — used when NOT self-improvement. */
    argProjectPath?: string;
    /** The resolved HiveMatrix repo path — injected so this helper stays pure/testable
     *  (see `selfImproveRepoPath()` for how the real dispatch site resolves it). */
    repoPath: string;
  }

  export interface EscalationTarget {
    projectPath: string;
    description: string;
    isSelfImprove: boolean;
  }
  ```
  Change to:
  ```ts
  export interface ResolveEscalationTargetOpts {
    title: string;
    description: string;
    /** Raw `kind` arg off the tool call, if any (e.g. "self-improvement"). */
    kind?: string;
    /** `project` name arg off the tool call, if any (e.g. "hivematrix-watch") —
     *  resolved via resolveProjectByName. Takes priority over argProjectPath
     *  when both are given: a name is more robust than a guessed path. */
    argProject?: string;
    /** `projectPath` arg off the tool call, if any — used when NOT
     *  self-improvement and no (resolvable) argProject was given. */
    argProjectPath?: string;
    /** The resolved HiveMatrix repo path — injected so this helper stays pure/testable
     *  (see `selfImproveRepoPath()` for how the real dispatch site resolves it). */
    repoPath: string;
  }

  export interface EscalationTarget {
    project: string;
    projectPath: string;
    description: string;
    isSelfImprove: boolean;
    /** Set only when an explicit `project` name was given but couldn't be
     *  resolved — callers must surface this instead of creating a task (never
     *  silently fall back to homedir() for a name that was given but wrong).
     *  project/projectPath are "" in this case. */
    error?: string;
  }
  ```

  Currently (lines 296-312):
  ```ts
  export function resolveEscalationTarget(opts: ResolveEscalationTargetOpts): EscalationTarget {
    const { title, description, kind, argProjectPath, repoPath } = opts;
    const isSelfImprove = kind === "self-improvement" || /\bhive\s?matrix\b(?!-)/i.test(`${title} ${description}`);

    if (isSelfImprove) {
      return {
        projectPath: repoPath,
        description: SELF_IMPROVEMENT_PREFIX + description,
        isSelfImprove: true,
      };
    }
    return {
      projectPath: argProjectPath ?? homedir(),
      description,
      isSelfImprove: false,
    };
  }
  ```
  (Note: the regex here already reflects Task 2's edit — if you're doing Tasks
  2 and 3 in one sitting as recommended, this is what you'll see; if Task 2
  hasn't landed yet, do it first.)

  Change to:
  ```ts
  export function resolveEscalationTarget(opts: ResolveEscalationTargetOpts): EscalationTarget {
    const { title, description, kind, argProject, argProjectPath, repoPath } = opts;
    const isSelfImprove = kind === "self-improvement" || /\bhive\s?matrix\b(?!-)/i.test(`${title} ${description}`);

    if (isSelfImprove) {
      return {
        project: "hivematrix",
        projectPath: repoPath,
        description: SELF_IMPROVEMENT_PREFIX + description,
        isSelfImprove: true,
      };
    }

    const projectName = argProject?.trim();
    if (projectName) {
      const resolved = resolveProjectByName(projectName);
      if (!resolved) {
        return {
          project: "",
          projectPath: "",
          description,
          isSelfImprove: false,
          error: `Cannot find project "${projectName}" — it isn't a known alias or a discovered git repo. Check ~/.hivematrix/discovered-projects.json, or pass an explicit projectPath instead.`,
        };
      }
      return { project: resolved.name, projectPath: resolved.path, description, isSelfImprove: false };
    }

    if (argProjectPath) {
      return { project: basename(argProjectPath), projectPath: argProjectPath, description, isSelfImprove: false };
    }

    return { project: "hivematrix", projectPath: homedir(), description, isSelfImprove: false };
  }
  ```

  Tool schema — currently (lines ~124-140):
  ```ts
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title for the task" },
            description: { type: "string", description: "Full description of what needs to be done" },
            projectPath: { type: "string", description: "Absolute path to the project (optional)" },
            kind: {
              type: "string",
              enum: ["self-improvement"],
              description:
                "Set to 'self-improvement' when the task is about improving HiveMatrix's own code/features — " +
                "it will be routed to the HiveMatrix repo with the Superpowers workflow.",
            },
          },
          required: ["title", "description"],
        },
  ```
  Change to:
  ```ts
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title for the task" },
            description: { type: "string", description: "Full description of what needs to be done" },
            project: {
              type: "string",
              description:
                "Name of the target project/repo, e.g. \"hivematrix-watch\" or \"ohio-life-ace\" — resolved " +
                "automatically against known projects. Prefer this over projectPath when you know the project " +
                "by name but not its exact path. Omit only for tasks with no specific project (e.g. \"book a flight\").",
            },
            projectPath: {
              type: "string",
              description: "Absolute path to the project (optional) — only use this if you already know the exact path; prefer `project` otherwise.",
            },
            kind: {
              type: "string",
              enum: ["self-improvement"],
              description:
                "Set to 'self-improvement' when the task is about improving HiveMatrix's own code/features — " +
                "it will be routed to the HiveMatrix repo with the Superpowers workflow.",
            },
          },
          required: ["title", "description"],
        },
  ```

  `handleEscalateToTask` — currently (lines 345-383, the part before the
  trailing comment/return which stays untouched):
  ```ts
  async function handleEscalateToTask(args: Record<string, unknown>, sessionId: string, channel?: string): Promise<string> {
    const { Task, generateId } = await import("@/lib/db");
    const { markVoiceOrigin } = await import("@/lib/voice/loop-closer");

    const title = String(args.title ?? "Task");
    const kind = String(args.kind ?? "");
    const argProjectPath = typeof args.projectPath === "string" ? args.projectPath : undefined;

    const { projectPath, description } = resolveEscalationTarget({
      title,
      description: String(args.description ?? ""),
      kind,
      argProjectPath,
      repoPath: selfImproveRepoPath(),
    });

    // A task escalated from a voice-channel flash turn gets the same
    // voice-origin marker the /voice/session route uses, so the loop-closer
    // (src/lib/voice/loop-closer.ts) texts the outcome back once this task
    // reaches a terminal state.
    const isVoice = escalationIsVoice(channel);

    // Broad multi-step work dispatches as a SINGLE task that self-plans via
    // Superpowers: workflow:"work" triggers the "/workflows:work" skill prefix so
    // the frontier coding harness plans and executes its own subtasks. Self-improvement
    // tasks are normal tasks in every other respect — they flow through the same
    // approval queue and directive machinery.
    const task = await Task.create({
      _id: generateId(),
      title,
      description,
      project: "hivematrix",
      projectPath,
      executor: "agent",
      model: "mixed",
      workflow: "work",
      source: `flash:${sessionId}`,
      ...(isVoice ? { output: markVoiceOrigin() } : {}),
    });
  ```
  Change to:
  ```ts
  async function handleEscalateToTask(args: Record<string, unknown>, sessionId: string, channel?: string): Promise<string> {
    const { Task, generateId } = await import("@/lib/db");
    const { markVoiceOrigin } = await import("@/lib/voice/loop-closer");

    const title = String(args.title ?? "Task");
    const kind = String(args.kind ?? "");
    const argProject = typeof args.project === "string" ? args.project : undefined;
    const argProjectPath = typeof args.projectPath === "string" ? args.projectPath : undefined;

    const target = resolveEscalationTarget({
      title,
      description: String(args.description ?? ""),
      kind,
      argProject,
      argProjectPath,
      repoPath: selfImproveRepoPath(),
    });

    if (target.error) return `Error: ${target.error}`;

    const { project, projectPath, description } = target;

    // A task escalated from a voice-channel flash turn gets the same
    // voice-origin marker the /voice/session route uses, so the loop-closer
    // (src/lib/voice/loop-closer.ts) texts the outcome back once this task
    // reaches a terminal state.
    const isVoice = escalationIsVoice(channel);

    // Broad multi-step work dispatches as a SINGLE task that self-plans via
    // Superpowers: workflow:"work" triggers the "/workflows:work" skill prefix so
    // the frontier coding harness plans and executes its own subtasks. Self-improvement
    // tasks are normal tasks in every other respect — they flow through the same
    // approval queue and directive machinery.
    const task = await Task.create({
      _id: generateId(),
      title,
      description,
      project,
      projectPath,
      executor: "agent",
      model: "mixed",
      workflow: "work",
      source: `flash:${sessionId}`,
      ...(isVoice ? { output: markVoiceOrigin() } : {}),
    });
  ```
  (the rest of the function — the trailing comment and `return` — is
  unchanged.)

  Add to `src/lib/flash/flash-mcp.test.ts`:
  ```ts
  test("resolveEscalationTarget: explicit resolvable project name wins, with the resolved (not hardcoded) name", () => {
    const result = resolveEscalationTarget({
      title: "Fix a UI bug",
      description: "The share sheet is misaligned.",
      argProject: "ops",
      argProjectPath: undefined,
      repoPath: "/Users/irvcassio/hivematrix",
    });
    assert.equal(result.isSelfImprove, false);
    assert.equal(result.project, "ops");
    assert.equal(result.projectPath, homedir());
    assert.equal(result.error, undefined);
  });

  test("resolveEscalationTarget: unresolvable project name errors instead of guessing homedir()", () => {
    const result = resolveEscalationTarget({
      title: "Fix a UI bug",
      description: "The share sheet is misaligned.",
      argProject: "totally-made-up-project-xyz",
      argProjectPath: undefined,
      repoPath: "/Users/irvcassio/hivematrix",
    });
    assert.match(result.error ?? "", /Cannot find project "totally-made-up-project-xyz"/);
    assert.equal(result.projectPath, "");
    assert.notEqual(result.projectPath, homedir(), "must not silently fall back to homedir()");
  });

  test("resolveEscalationTarget: explicit projectPath with no project name derives a real name, not the hardcoded 'hivematrix'", () => {
    const result = resolveEscalationTarget({
      title: "Fix a UI bug",
      description: "The share sheet is misaligned.",
      argProjectPath: "/Users/irvcassio/ohio-life-ace",
      repoPath: "/Users/irvcassio/hivematrix",
    });
    assert.equal(result.project, "ohio-life-ace");
    assert.equal(result.projectPath, "/Users/irvcassio/ohio-life-ace");
  });
  ```
  Also update the existing test `"resolveEscalationTarget: neither kind nor
  HiveMatrix mention — projectPath falls back to arg or homedir, no prefix"`
  (around line 422) to also assert the new `project` field, e.g. add
  `assert.equal(withoutArg.project, "hivematrix");` and, for the `withArg`
  case (`argProjectPath: "/some/project"`), `assert.equal(withArg.project,
  "some-project")` (the `basename` of `/some/project`).

  In `src/lib/flash/self-improve-prover.test.ts`, add a third test after the
  existing "control" test, proving the actual `e238b04578fb48a39af66016`
  scenario is fixed end to end. This needs a discoverable sibling repo in
  `TEMP_HOME` — add setup for it near the top (after the existing
  `TEMP_HOME`/`TEMP_REPO` setup, before the `dispatchFlashOnlyTool` import):
  ```ts
  const TEMP_SIBLING_REPO_NAME = "hivematrix-watch";
  mkdirSync(join(TEMP_HOME, TEMP_SIBLING_REPO_NAME, ".git"), { recursive: true });
  writeFileSync(join(TEMP_HOME, TEMP_SIBLING_REPO_NAME, ".git", "HEAD"), "ref: refs/heads/main");
  writeFileSync(join(TEMP_HOME, TEMP_SIBLING_REPO_NAME, "package.json"), JSON.stringify({ name: TEMP_SIBLING_REPO_NAME }));
  ```
  and after the existing `detectCommandIntent`/`VOICE_ORIGIN` imports, add:
  ```ts
  const { discoverProjectsFresh } = await import("@/lib/routing/project-discovery");
  discoverProjectsFresh();
  ```
  New test, appended at the end of the file:
  ```ts
  test("escalate_to_task with an explicit sibling-repo project name resolves to that repo, not homedir() or the core repo (regression: e238b04578fb48a39af66016)", async () => {
    const session = createSession("chat", "prover-peer-3");

    const result = await dispatchFlashOnlyTool(
      "escalate_to_task",
      {
        title: "HiveMatrix-watch UX overhaul",
        description: "Improve voice dictation on the watch app.",
        project: "hivematrix-watch",
      },
      { brainRoot: null, sessionId: session.id, channel: "console" },
    );

    const match = result.match(/^Escalated to task (\S+):/);
    assert.ok(match, `expected "Escalated to task <id>:" prefix, got: ${result}`);
    const task = await Task.findById(match![1]);
    assert.ok(task);

    assert.equal(task!.project, "hivematrix-watch");
    assert.equal(task!.projectPath, join(TEMP_HOME, "hivematrix-watch"));
    assert.notEqual(task!.projectPath, homedir());
    assert.notEqual(task!.projectPath, TEMP_REPO, "must not land in the core hivematrix repo either");
  });

  test("escalate_to_task with an unresolvable project name returns an error and creates no task", async () => {
    const session = createSession("chat", "prover-peer-4");
    const before = (await Task.find({})).length;

    const result = await dispatchFlashOnlyTool(
      "escalate_to_task",
      { title: "X", description: "Y", project: "no-such-project-xyz" },
      { brainRoot: null, sessionId: session.id, channel: "console" },
    );

    assert.match(result, /^Error: Cannot find project "no-such-project-xyz"/);
    const after = (await Task.find({})).length;
    assert.equal(after, before, "no task row was created");
  });
  ```
  (Check `Task.find({})` is the right existing query shape for "all tasks" in
  this codebase's `db` module before using it verbatim — grep `Task.find(`
  call sites in existing tests; adjust to whatever the real API is if it
  differs.)

  RED: run both
  `NODE_ENV=test node --import tsx/esm --test src/lib/flash/flash-mcp.test.ts`
  and
  `NODE_ENV=test node --import tsx/esm --test src/lib/flash/self-improve-prover.test.ts`
  before these edits — expect failures (missing `project` field / hardcoded
  `"hivematrix"` / homedir() fallback / no error path).
  GREEN: after all edits in Tasks 2+3 land together, re-run both files, expect
  full pass, including every pre-existing test in both files (self-improve
  routing, voice-origin marking, the "control" no-project case must be
  byte-for-byte unchanged).
  Also run `npm run typecheck` — Task 1 must already be landed for this to
  pass (the new `argProject`/`project`/`error` fields and the `aliases.ts`
  import are compile-time dependencies).

- [ ] Task 4: `POST /tasks` resolves an explicit project name when `projectPath` is missing

  File: `src/daemon/server.ts`. Depends on Task 1.

  Currently (lines 4449-4469):
  ```ts
          // Title is optional — derive it from the instructions when absent/blank.
          const title = typeof body.title === "string" ? body.title.trim() : "";
          body.title = title || deriveTaskTitle(description);
          if (typeof body.project !== "string" || !body.project.trim()) body.project = "hivematrix";
          if (typeof body.projectPath !== "string" || !body.projectPath.trim()) {
            // No project/directory given (an "operations" task, e.g. a skill run
            // with nothing to check out) — fall back to the home dir rather than
            // an empty string, which crashes child_process.spawn's cwd option
            // (ENOENT) once the scheduler tries to spawn the agent.
            body.projectPath = homedir();
          } else {
            // Expand a leading "~" (the built-in Inbox project's path) so it's a real
            // absolute directory by the time the agent spawns — otherwise
            // join(projectPath, ".claude") produces a literal "~/.claude" that mkdir
            // can't create (ENOENT: no such file or directory, mkdir '~/.claude').
            // Unlike normalizeHomeProjectPath, this does not require the result to be
            // under $HOME — arbitrary absolute project paths are valid here.
            const raw = body.projectPath.trim();
            const home = homedir();
            body.projectPath = raw === "~" ? home : raw.startsWith("~/") ? join(home, raw.slice(2)) : raw;
          }
  ```
  Change to:
  ```ts
          // Title is optional — derive it from the instructions when absent/blank.
          const title = typeof body.title === "string" ? body.title.trim() : "";
          body.title = title || deriveTaskTitle(description);
          const explicitProjectName = typeof body.project === "string" ? body.project.trim() : "";
          if (typeof body.projectPath !== "string" || !body.projectPath.trim()) {
            if (explicitProjectName) {
              // A project NAME was given but no path — resolve it (alias/custom/
              // system registry, then auto-discovered git repos) instead of
              // silently guessing homedir(): a mismatched name+homedir() pairing
              // here is exactly what broke per-repo scheduler locking for
              // Flash-originated tasks (2026-07-16, see known-issues.md).
              const { resolveProjectByName } = await import("@/lib/routing/aliases");
              const resolved = resolveProjectByName(explicitProjectName);
              if (!resolved) {
                json(res, 400, { error: `Cannot find project "${explicitProjectName}" — it isn't a known alias or a discovered git repo. Check ~/.hivematrix/discovered-projects.json, or pass an explicit projectPath.` });
                return;
              }
              body.project = resolved.name;
              body.projectPath = resolved.path;
            } else {
              // No project/directory given at all (an "operations" task, e.g. a
              // skill run with nothing to check out) — fall back to the home dir
              // rather than an empty string, which crashes child_process.spawn's
              // cwd option (ENOENT) once the scheduler tries to spawn the agent.
              body.project = "hivematrix";
              body.projectPath = homedir();
            }
          } else {
            if (!explicitProjectName) body.project = "hivematrix";
            // Expand a leading "~" (the built-in Inbox project's path) so it's a real
            // absolute directory by the time the agent spawns — otherwise
            // join(projectPath, ".claude") produces a literal "~/.claude" that mkdir
            // can't create (ENOENT: no such file or directory, mkdir '~/.claude').
            // Unlike normalizeHomeProjectPath, this does not require the result to be
            // under $HOME — arbitrary absolute project paths are valid here.
            const raw = body.projectPath.trim();
            const home = homedir();
            body.projectPath = raw === "~" ? home : raw.startsWith("~/") ? join(home, raw.slice(2)) : raw;
          }
  ```
  Verify this block is still inside the same `async` route handler it was
  before (it is — surrounding code already does `await import(...)` a few
  lines above at "attachments").

  Add to `src/daemon/server.test.ts`, near the existing `"POST /tasks creates
  an operations task with no project"` test (~line 899) — use the exact same
  `withTempHome(t)` / `startServer(t)` / `getDb()` harness those neighboring
  tests use:
  ```ts
  test("POST /tasks resolves a project NAME to its real path when projectPath is omitted", async (t) => {
    withTempHome(t);
    const { _resetDbForTests, getDb } = await import("@/lib/db");
    _resetDbForTests();
    const home = process.env.HOME!;
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");
    mkdirSync(pathJoin(home, "some-real-repo", ".git"), { recursive: true });
    writeFileSync(pathJoin(home, "some-real-repo", ".git", "HEAD"), "ref: refs/heads/main");
    writeFileSync(pathJoin(home, "some-real-repo", "package.json"), JSON.stringify({ name: "some-real-repo" }));
    const { discoverProjectsFresh } = await import("@/lib/routing/project-discovery");
    discoverProjectsFresh();

    const { base, headers } = await startServer(t);
    const res = await fetch(`${base}/tasks`, {
      method: "POST", headers,
      body: JSON.stringify({ description: "Fix a bug.", project: "some-real-repo" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    const stored = getDb().prepare("SELECT project, projectPath FROM tasks WHERE _id = ?").get(body._id as string) as { project: string; projectPath: string };
    assert.equal(stored.project, "some-real-repo");
    assert.equal(stored.projectPath, pathJoin(home, "some-real-repo"));
  });

  test("POST /tasks rejects an unresolvable project name instead of guessing homedir()", async (t) => {
    withTempHome(t);
    const { _resetDbForTests, getDb } = await import("@/lib/db");
    _resetDbForTests();
    const { base, headers } = await startServer(t);

    const res = await fetch(`${base}/tasks`, {
      method: "POST", headers,
      body: JSON.stringify({ description: "Fix a bug.", project: "no-such-project-anywhere" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assert.match(String(body.error), /Cannot find project "no-such-project-anywhere"/);
    const rows = getDb().prepare("SELECT COUNT(*) as n FROM tasks").get() as { n: number };
    assert.equal(rows.n, 0, "no task row was created");
  });
  ```
  Before writing these, check `withTempHome`'s exact behavior (grep its
  definition in `server.test.ts` or a shared test-helpers file) — confirm it
  isolates `process.env.HOME` the same way `project-discovery-cache.test.ts`
  does, and whether `discoverProjectsFresh()`'s cache file
  (`~/.hivematrix/discovered-projects.json` under the *temp* home) needs any
  extra cleanup `withTempHome` doesn't already handle.

  RED: run `NODE_ENV=test node --import tsx/esm --test src/daemon/server.test.ts`
  before the `server.ts` edit — both new tests fail (first: 201 but wrong
  projectPath/homedir(); second: 201 with a bogus homedir()-based task instead
  of 400). This file is large — expect a long run; let it finish.
  GREEN: after the edit, re-run the full file (not a filtered subset — this
  route has ~15 other tests in the same file that must not regress, especially
  the `"~"` / `"~/sub"` / "operations task with no project" tests immediately
  above the new ones).

- [ ] Task 5: Full verification gates + known-issues.md entry (not delegated — run directly)

  From repo root:
  ```
  npm run typecheck
  npm test
  node scripts/scope-wall.mjs
  ```
  All three must be clean (typecheck zero errors; full test suite green modulo
  this repo's one pre-existing unrelated skip; scope-wall zero violations —
  this change adds no new persistent store or product concept, just extends
  `aliases.ts` and reuses `discoverProjects()`, so no DECISIONS.md entry is
  expected or needed).

  Then a live sanity check against the actual incident, mirroring the design
  doc's investigation method (query the running daemon, don't just trust the
  diff): the two real tasks found during investigation,
  `e238b04578fb48a39af66016` (broken) and `e7c6f88fef3a46b09f27c58e` (the
  model's own manual workaround), are historical — this fix doesn't rewrite
  them. Confirm instead that a *fresh* `escalate_to_task` call with
  `project:"hivematrix-watch"` and no `projectPath` now resolves correctly
  against the **real** live `~/.hivematrix/discovered-projects.json` (not a
  test fixture) — e.g. a throwaway Node one-liner importing
  `resolveProjectByName` from the built/compiled path this daemon actually
  runs, or (simpler and matches this repo's established live-check style) curl
  the running daemon's `POST /flash/tool/escalate_to_task` directly if a valid
  session token is available; otherwise note in the commit/known-issues entry
  that the live daemon (v0.1.209) predates this fix and won't reflect it until
  released — same "release-lag" caveat as most other entries in that file.

  Update `~/_GD/brain/projects/hive/known-issues.md` with a RESOLVED entry
  (match the file's existing entry style — see the `72f0b370`/`efc45b05`/
  `dbb7dd71` entries for the format): record the fix commit hash, the
  correction that the live-broken task predates the currently-unreleased
  self-improve regex/prefix machinery (so this isn't literally the same code
  path that broke, but is the same bug class, verified still present on
  current `main`), and the two additional bugs found and fixed beyond the
  dispatch's 3 citations (regex boundary, `selfImproveRepoPath` fallback) —
  so a future dispatch re-reporting a hivematrix-watch/-ios/-android task
  landing in the wrong place doesn't re-diagnose from scratch.

  Do NOT push, build, or release — commit to `main` only, per this task's
  explicit "operator releases" instruction.
