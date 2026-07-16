# Tools Window: Search + Discoverable Params + Visual Run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-15-tools-window-search-and-run-design.md`. Read
it first — it explains why local-command is a new `/capabilities` group instead of a
new endpoint, why native/flash rows stay non-runnable, and why sidebar removal
(Task 5) is gated and optional-if-budget-tight.

Each task is independent enough to hand to a fresh subagent. Do them in order —
Tasks 3 and 4 both touch `renderToolsPanel`, and Task 4 depends on Task 1's new
group existing in `/capabilities`. Task 5 depends on 1-4 being green.

## Task 1 — `/capabilities` gains a `local-command` group

Files: `src/daemon/server.ts` (~line 435-493), `src/daemon/server.test.ts` (~line 2740).

- [ ] RED — edit the existing test at `server.test.ts:2740`
      (`"GET /capabilities returns exactly the four groups..."` →
      rename to `"...returns exactly the five groups..."`):
  ```ts
  assert.deepEqual(body.groups.map((g) => g.kind), ["native", "flash", "skill-tool", "skill-library", "local-command"]);
  ```
  Add a new test right after it:
  ```ts
  test("GET /capabilities: local-command group mirrors scanLocalCommands, one entry per slash command", async (t) => {
    withTempHome(t);
    const { base, headers } = await startServer(t);
    const res = await fetch(`${base}/capabilities`, { headers });
    const body = await res.json() as CapabilitiesResponse;
    const localCmd = body.groups.find((g) => g.kind === "local-command")!;
    assert.ok(Array.isArray(localCmd.tools));
    // scanLocalCommands() always finds at least the built-in commands under .claude/
    assert.ok(localCmd.tools.length > 0);
    const entry = localCmd.tools[0] as Record<string, unknown>;
    assert.equal(typeof entry.name, "string");       // invokeName
    assert.equal(typeof entry.description, "string");
    assert.ok(entry.options && typeof entry.options === "object"); // CommandOptionsSpec
    assert.equal(typeof entry.sourceRef, "string");   // sourcePath
  });
  ```
  Run `npm test -- server.test.ts` (or the project's test filter syntax) and confirm
  both fail — the first on the 4-vs-5 length mismatch, the second on `localCmd` being
  `undefined`.
- [ ] GREEN — in `server.ts`'s `/capabilities` handler, alongside the existing
      `listSkills`/`skillFilename` import line, add:
  ```ts
  const { scanLocalCommands } = await import("@/lib/commands/local-catalog");
  ```
  After building `skillLibrary`, add:
  ```ts
  const localCommands = (await scanLocalCommands()).map((c) => ({
    name: c.invokeName,
    description: c.description,
    options: c.options,
    argumentHint: c.argumentHint,
    sourceRef: c.sourcePath,
  }));
  ```
  Append `{ kind: "local-command", tools: localCommands }` to the `groups` array in
  the `json(res, 200, { groups: [...] })` call. Re-run both tests, confirm green.
- [ ] Update the doc comment above the route (`server.ts:427-434`) to mention the
      fifth group — it currently enumerates exactly four.
- [ ] Gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## Task 2 — required vs. optional positionals in `_cmdOptionsHtml`

Files: `src/daemon/console.ts` (`_cmdOptionsHtml` ~line 4026-4046, `_optChipHtml`
~line 4015-4025, `_assembleCmdArgs` ~line 4063-4076), `src/daemon/console.test.ts`.

Today every positional (`spec.positionals`) renders as a plain `<input class="opt-pos">`
regardless of `CommandOption.required`; only the placeholder text says "(required)".
The ticket wants required params as a plain mandatory input (fine, keep as-is) and
*optional* params as a greyed pill/toggle (not currently true for positionals).

- [ ] RED — add to `console.test.ts` (grep the file for how it imports/reads
      `CONSOLE_HTML` or the relevant functions and match that style — likely a
      plain string search against the console source, per this file's no-jsdom
      convention):
  ```ts
  test("_cmdOptionsHtml renders optional positionals as toggle pills, required ones as plain inputs", () => {
    // assert the function body contains distinct branches for p.required vs !p.required
    // when building the positionals block, e.g. by asserting the source contains
    // both an `opt-pos` (required, plain input) and an `opt-pos-toggle`-style pill
    // class used only when `!p.required`.
  });
  ```
  (Exact assertion shape: follow whatever pattern `console.test.ts` already uses to
  test other pure-JS-string-builder functions in this file — e.g. search for how
  `_cmdOptionsHtml`'s sibling `_optChipHtml` or `commandMetaChips` is tested, if at
  all; if nothing tests these builders directly today, add a small harness that
  `eval`s or `require`s the relevant IIFE/exported section the way the rest of the
  file does, or fall back to a source-text assertion consistent with the
  `window-title-cleanup` precedent's "regex against CONSOLE_HTML" style.) Confirm
  it fails against the current single-branch implementation.
- [ ] GREEN — in `_cmdOptionsHtml`, change the positionals block so:
  - `p.required` → unchanged: `<input class="opt-pos" data-pos="...">`.
  - `!p.required` → a toggle pill matching the existing flag-chip visual language
    (reuse `_optSetActive`'s active/inactive style, e.g. a `<button class="opt-chip
    opt-pos-toggle" data-pos="...">` that reveals a same-row `<input>` on activate,
    mirroring how `kind === 'value'` chips reveal `.opt-val` today).
  - Update `_assembleCmdArgs` to read optional-positional values only from toggled-on
    pills (mirrors how it already reads `.opt-chip.active` for flags/values/choices),
    and required positionals unconditionally from their plain input as before.
- [ ] Gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## Task 3 — search box on the Tools window

Files: `src/daemon/console.ts` (`renderToolsPanel` ~line 7560-7633, `TOOLS_GROUP_META`
~7544).

- [ ] RED — add a test to `console.test.ts` asserting `renderToolsPanel`'s emitted
      HTML includes a search `<input>` (e.g. `id="toolsQuery"`) and that a
      `toolsQueryInput()`-style handler function exists in the source (same
      source-text-assertion style as Task 2 / the `window-title-cleanup` precedent).
- [ ] GREEN:
  - Add `let _toolsQuery = '';` near `_toolsState`.
  - Add a search `<input id="toolsQuery" oninput="toolsQueryInput()" placeholder="Search tools…">`
    into the panel head markup (`oc-panel-head`), matching `#skQuery`'s existing
    placement/style in the sidebar (`renderSkillList`'s caller — grep for where
    `#skQuery` itself is rendered, likely a static template chunk, and mirror its
    CSS classes so this doesn't need new styles).
  - `function toolsQueryInput() { _toolsQuery = (document.getElementById('toolsQuery')||{}).value || ''; renderToolsPanel(); }`
  - In `renderToolsPanel`, before building `body`, filter each group's `tools` by
    `_toolsQuery` (lowercased, split into terms, `every` term matches
    name+description+kind — same predicate shape as `renderSkillList`'s filter at
    `console.ts:3598-3603`) and skip rendering a group entirely if it has zero
    matches after filtering (avoid an empty group header). Preserve `_toolsQuery`
    across re-renders (don't reset on every `renderToolsPanel()` call — only
    `toolsQueryInput` should update it) so the box doesn't lose focus/text on
    unrelated re-renders (e.g. `toggleToolExpand`).
- [ ] Gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## Task 4 — wire Run into Tools window rows

Files: `src/daemon/console.ts` (`renderToolsPanel`, `TOOLS_GROUP_META`).

Depends on Task 1 (local-command group must exist) and Task 3 (search reuses the
same render pass this touches).

- [ ] RED — add a test asserting that rows in `skill-tool`, `skill-library`, and
      `local-command` groups render a clickable element wired to open the existing
      run form (i.e. calls into `selectSkill(...)`/`showSkillPanel(...)` with a key
      matching `skCatalog()`'s `'lib:' + name` / `'local:' + invokeName` convention),
      while `native` and `flash` rows do not (no Run affordance, click still only
      toggles the detail expander).
- [ ] GREEN:
  - `TOOLS_GROUP_META` gains a `runnable: boolean` per kind: `true` for
    `skill-tool`/`skill-library`/`local-command`, `false` for `native`/`flash`.
  - For a runnable row, change the row's click handler from only
    `toggleToolExpand(key)` to also offer a "Run" affordance that calls
    `selectSkill('lib:' + t.name)` (skill-tool and skill-library both back onto the
    skill catalog — skill-tool's `t.name` is the promoted tool name, not necessarily
    the skill name; use `t.skillName` when present, matching the `/capabilities`
    shape's existing `skillName` field on skill-tool entries) or
    `selectSkill('local:' + t.name)` for `local-command` entries. Keep
    `toggleToolExpand` reachable too (e.g. the existing caret keeps expand/collapse;
    add a distinct "▶ Run" button/link per row for the run action so neither
    gesture shadows the other).
  - Confirm `skCatalog()` actually contains a matching key for every runnable Tools
    row before wiring — `skill-library` entries should already line up 1:1 with
    `_skills` (`/skills` data); `local-command` entries (new in Task 1) should line
    up 1:1 with `_commands` (`/commands` data) since both now come from
    `scanLocalCommands()`. If `_skills`/`_commands` haven't been fetched yet when
    the Tools window loads (`showTools()` never calls `renderSkillCatalog()`
    today), call it there too so `skCatalog()` is populated before a Run click needs
    it.
- [ ] Gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## Task 5 (conditional — only if Tasks 1-4 are fully green and budget remains)

Remove the right-sidebar skills/commands list now that the Tools window is a
superset entry point.

- [ ] Confirm every path that opened `showSkillPanel()`/`selectSkill()` from the
      sidebar (search `console.ts` for `onclick="selectSkill`, `skQueryInput`,
      `#skList`) has a Tools-window equivalent from Task 4 before deleting anything.
- [ ] Remove the sidebar's `#skList`/`#skQuery` DOM and its render call sites;
      remove now-dead sidebar-only helpers (`renderSkillList`'s DOM target, keyboard
      nav `skFocusNext`-style handlers if they have no other caller — grep before
      deleting, `_localCmdPanelHtml`/`_libSkillPanelHtml`/`runSelectedSkill`/
      `runSelectedCommand` themselves stay, they're now reached from the Tools
      window instead).
  - **Do not delete `skCatalog()`, `_libSkillPanelHtml`, `_localCmdPanelHtml`,
    `runSelectedSkill`, `runSelectedCommand`, or any `/skills`|`/commands` route** —
    Task 4 depends on all of them.
- [ ] Update/remove sidebar-specific tests in `console.test.ts`; keep or adapt any
      that exercise the run-panel functions themselves (still reachable, just from
      a new caller).
- [ ] If this task is skipped or only partially done, record exactly what's left in
      this file (mirroring the `2026-07-15-window-state-restoration.md` precedent
      for a budget-truncated task) so a future dispatch resumes here instead of
      redoing Tasks 1-4.
- [ ] Gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## Final gates (whole plan)

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — all passing (note exact pass/fail/skip counts in the finishing
      summary, don't just say "passed").
- [ ] `node scripts/scope-wall.mjs` — zero violations (no new persistent store or
      concept was introduced; `local-command` is a new `/capabilities` *group*, not
      a new store).
