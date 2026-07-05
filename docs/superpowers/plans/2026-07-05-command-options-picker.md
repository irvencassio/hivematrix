# Command Options Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-05-command-options-picker-design.md`. TDD the pure parsers first.

## 1. Model + parsers — `src/lib/commands/options.ts` (TDD)

- [ ] RED `src/lib/commands/options.test.ts`:
  - `parseArgumentHint("--flag")` → one `flag`.
  - `parseArgumentHint("--marketing-version X.Y.Z")` → `value`, placeholder `X.Y.Z`.
  - `parseArgumentHint("[--skip-notarize]")` → optional `flag`.
  - `parseArgumentHint("--priority high|medium|low")` → `choice` choices `[high,medium,low]`.
  - `parseArgumentHint("--release | --verify-only | --build-only")` → 3 flags, one shared `group`.
  - `parseArgumentHint("<pr-number> [assignee]")` → positionals (req, opt).
  - `parseArgumentHint("")` → `source:"none"`, empty.
  - `parseOptionsFrontmatter("--release (mode) Full …\n--marketing-version=X.Y.Z Set …")` → flag w/ group+desc, value w/ placeholder+desc.
  - `parseOptionsFrontmatter("--priority=low|med|high Prio")` → choice.
  - `resolveCommandOptions({options, argumentHint})`: frontmatter wins; else hint; else none.
- [ ] GREEN implement pure functions. Never throw; unknown tokens ignored.

## 2. Wire into `LocalCommand` — `src/lib/commands/contracts.ts`

- [ ] Add `options: CommandOptionsSpec` to `LocalCommand`.
- [ ] In `parseCommandFile` + `parseSkillManifest`: `options: resolveCommandOptions({ optionsRaw: fm["options"], argumentHint })`. Keep `argumentHint` as-is.
- [ ] Update `local-catalog.test.ts` / `contracts.test.ts` expectations (new field).

## 3. Console picker — `src/daemon/console.ts`

- [ ] `_cmdOptionsHtml(spec)` (pure JS string builder): segmented groups, toggle chips, value inputs, choice selects, positional inputs. Returns '' when spec empty.
- [ ] Insert into `_localCmdPanelHtml` above the raw "Arguments" input; relabel raw input "Advanced (raw args — overrides picks)".
- [ ] `_assembleCmdArgs()`: if raw non-empty → use it; else build from controls (group radios, active chips, value/choice inputs, positionals in order).
- [ ] `runSelectedCommand()` uses `_assembleCmdArgs()`.
- [ ] console.test.ts: assert the panel renders option controls when `options` present and that assembly wiring exists (source-guard style).

## 4. Showcase — `.claude/skills/developer-id-release/SKILL.md`

- [ ] Add `argument-hint` + `options:` frontmatter enumerating `--verify-only|--build-only|--release` (group mode), `--marketing-version=X.Y.Z`, `--skip-notarize`, `--note=…`.

## 5. Gates

- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` all green.
