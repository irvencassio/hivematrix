# Skills And Commands Sharing Implementation Plan

> ⚠️ **SUPERSEDED 2026-07-06 — DeepSeek/ds4 removed; the local stack is Qwen-only.**
> Retained as a historical record. See
> docs/superpowers/plans/2026-07-06-qwen-only-local-presets.md


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-05-skills-commands-sharing-design.md`

## Task 1: RED - Skill Harness Compatibility Includes DeepSeek

- [ ] File: `src/lib/skills/contracts.test.ts`.
- [ ] Add assertions that `deepseek` round-trips through `renderSkillFile()` and
  `parseSkillFile()`, and that `skillRunsOn()` accepts the DeepSeek harness.
- [ ] File: `src/lib/skills/fanout.test.ts`.
- [ ] Add assertions that `harnessTargets()` includes a `deepseek` target and
  `planFanout()` writes a DeepSeek-compatible skill only to that target plus
  `all` targets.

Code sample:

```ts
test("deepseek compat round-trips and gates by harness", () => {
  const s = skill({ compat: ["deepseek"] });
  const parsed = parseSkillFile(renderSkillFile(s))!;
  assert.deepEqual(parsed.compat, ["deepseek"]);
  assert.equal(skillRunsOn(parsed.compat, "deepseek"), true);
  assert.equal(skillRunsOn(parsed.compat, "qwen"), false);
});
```

Verification:

```bash
node --import tsx/esm --test src/lib/skills/contracts.test.ts src/lib/skills/fanout.test.ts
```

Expected RED: TypeScript/runtime failure because `deepseek` is not accepted yet
and no DeepSeek fan-out target exists.

## Task 2: GREEN - Add DeepSeek Skill Compatibility

- [ ] File: `src/lib/skills/contracts.ts`.
- [ ] Add `deepseek` to `SKILL_HARNESSES`.
- [ ] File: `src/lib/skills/fanout.ts`.
- [ ] Add `~/.deepseek/skills` as the DeepSeek local fan-out target.
- [ ] File: `src/lib/skills/search.ts`.
- [ ] Extend static compatibility entry typing to include optional DeepSeek flags
  without requiring every legacy JSON row to change immediately.
- [ ] File: `src/lib/skills/skill_compatibility.json`.
- [ ] Add `deepseek` to `knownHarnesses` and update the description.

Verification:

```bash
node --import tsx/esm --test src/lib/skills/contracts.test.ts src/lib/skills/fanout.test.ts src/lib/skills/search.test.ts
```

## Task 3: RED - Local Commands Expose Provider Compatibility

- [ ] File: `src/lib/commands/local-catalog.test.ts`.
- [ ] Add tests that parsed command frontmatter infers:
  - no `model` -> `["all"]`
  - `opus` -> `["claude"]`
  - `gpt-5` or `chatgpt` -> `["codex"]`
  - `qwen3` -> `["qwen"]`
  - `deepseek-v4` or `ds4` -> `["deepseek"]`
  - comma-separated values -> multiple compat entries.
- [ ] Assert scanned local commands include the `compat` metadata.

Code sample:

```ts
test("parseCommandFile infers model compatibility", () => {
  assert.deepEqual(parseCommandFile("---\nmodel: opus\n---\nbody", "c", "/p").compat, ["claude"]);
  assert.deepEqual(parseCommandFile("---\nmodel: qwen3, deepseek-v4\n---\nbody", "c", "/p").compat, ["qwen", "deepseek"]);
});
```

Verification:

```bash
node --import tsx/esm --test src/lib/commands/local-catalog.test.ts
```

Expected RED: `compat` is missing from `LocalCommand`.

## Task 4: GREEN - Implement Local Command Compatibility

- [ ] File: `src/lib/commands/contracts.ts`.
- [ ] Add `compat` to `LocalCommand`.
- [ ] Add a pure `inferLocalCommandCompat(model?: string)` helper.
- [ ] Use the helper in `parseCommandFile()` and `parseSkillManifest()`.

Verification:

```bash
node --import tsx/esm --test src/lib/commands/local-catalog.test.ts
```

## Task 5: RED - Console Browser Shows Compatibility Chips

- [ ] File: `src/daemon/console.test.ts`.
- [ ] Add assertions that the shipped console script contains:
  - `compatLabel`
  - `compatChips`
  - `Qwen(local)`
  - `DeepSeek(local)`
  - `ChatGPT`
- [ ] Assert row/detail metadata includes compatibility chips for both library
  skills and local commands.
- [ ] Assert chip CSS has `max-width:100%` and overflow protection.

Verification:

```bash
node --import tsx/esm --test src/daemon/console.test.ts --test-name-pattern "skills|compat"
```

Expected RED: helper names and labels are not present yet.

## Task 6: GREEN - Render Compatibility In The Catalog Browser

- [ ] File: `src/daemon/console.ts`.
- [ ] Add client-side helpers:
  - `compatValues(it)`
  - `compatLabel(value)`
  - `compatSearchText(it)`
  - `compatChips(it)`
- [ ] Include compatibility in the search haystack.
- [ ] Render chips in catalog rows, `libMetaLine()`, and `commandMetaChips()`.
- [ ] Ensure CSS keeps chips inside the context column.

Verification:

```bash
node --import tsx/esm --test src/daemon/console.test.ts --test-name-pattern "skills|compat"
```

## Task 7: RED - HTML Brain Doc Smoke Check

- [ ] Run a content smoke check before creating the doc.

Verification:

```bash
test -f docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Non-technical explanation" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Compatibility labels" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "All" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Claude" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "ChatGPT" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Qwen(local)" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "DeepSeek(local)" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Share out" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Import" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Catalog browser behavior" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Source map" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Verification checklist" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "src/lib/skills/sync.ts" docs/SKILLS-COMMANDS-BRAIN.html
```

Expected RED: the file does not exist yet.

## Task 8: GREEN - Create The HTML Brain Doc

- [ ] File: `docs/SKILLS-COMMANDS-BRAIN.html`.
- [ ] Include:
  - Non-technical explanation.
  - Compatibility labels.
  - Share out.
  - Import.
  - Catalog browser behavior.
  - Source map.
  - Verification checklist.

Verification:

```bash
test -f docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Non-technical explanation" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Compatibility labels" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "All" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Claude" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "ChatGPT" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Qwen(local)" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "DeepSeek(local)" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Share out" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Import" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Catalog browser behavior" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Source map" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "Verification checklist" docs/SKILLS-COMMANDS-BRAIN.html && \
  rg -Fq "src/lib/skills/sync.ts" docs/SKILLS-COMMANDS-BRAIN.html
```

## Task 9: Final Verification

- [ ] Run focused tests:

```bash
node --import tsx/esm --test src/lib/skills/contracts.test.ts src/lib/skills/fanout.test.ts src/lib/skills/search.test.ts src/lib/commands/local-catalog.test.ts src/daemon/console.test.ts
```

- [ ] Run gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

- [ ] Review `git diff --check`.
- [ ] Confirm `snake.py` remains untouched because it was pre-existing user work.
