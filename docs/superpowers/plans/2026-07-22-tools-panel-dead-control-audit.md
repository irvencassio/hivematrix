# Tools & Skill-Panel Dead-Control Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-22-tools-panel-dead-control-audit-design.md`.

## Per-control inventory (every interactive control, driven in jsdom)

Status: **works** (produced an effect unchanged) · **fixed** (was dead/misdirected,
now acts) · route-missing (n/a — none found).

### Tools panel — `renderToolsPanel` / Integrate card
- [x] Search box `toolsQueryInput` — works (filters rows in place)
- [x] Row expand `toggleToolExpand` — works (decodes attrEnc key; detail appears)
- [x] **Run `runToolFromCatalog`** — **FIXED**: rendered on cold open (0→N buttons); click opens the run panel
- [x] Retry link `loadCapabilities` — works
- [x] Integrate project `<select>` → `loadIntegrateBranches` — works (GET /integrate/branches)
- [x] Integrate branch `<select>` — works (value read by runIntegrate)
- [x] Integrate `runIntegrate` — works (hard-confirm → POST /integrate/run)

### lib-skill panel — `_libSkillPanelHtml`
- [x] Run `runSelectedSkill` — works (POST /skills/:name/run)
- [x] View `viewSkill` — works (GET, viewpane none→block)
- [x] **Copy `copySkill`** — works; **FIXED** status target (panel #skRunStatus, not sidebar)
- [x] Publish scope `<select id=skPubScope>` — works (read by publishSelected)
- [x] **Publish `publishSelected`** — works; **FIXED** status target
- [x] Trust `trustSelected` — works (POST /skills/:name/trust)
- [x] Delete `deleteSelected` — works (confirm → DELETE)
- [x] Option pills `_optToggle`/`_optPick` — works
- [x] Back/Cancel `_closeSkillPanel` — works

### local-command panel — `_localCmdPanelHtml`
- [x] Run `runSelectedCommand` — works (POST /commands/run with project path)
- [x] Option pills `_optToggle`/`_optPick` — works
- [x] Project search/dropdown `mpOpen`/`mpFilter`/`mpKeydown`/`mpPick` — works
- [x] Sort recent/name `mpSort` — works
- [x] "Use another folder" `mpToggleCustomFolder` — works
- [x] "Use this folder" `mpUseCustomFolder` — works (writes commandPath)
- [x] Back/Cancel `_closeSkillPanel` — works

## Tasks

- [x] **T1** Fix FINDING 1 in `loadCapabilities` (load skill catalog alongside
  `/capabilities`). Regression test `cold Tools open still renders — and runs —
  its Run buttons`: proven RED without the fix (0 buttons), GREEN with it.
- [x] **T2** Fix FINDING 2 in `copySkill`/`publishSelected` (prefer `#skRunStatus`).
  Regression test `Copy/Publish write their status into the skill panel`:
  proven RED without the fix, GREEN with it.
- [x] **T3** Durable driver test `the local-command panel Run posts the project path
  picked through the dropdown` — guards the picker→commandPath→run wiring the
  operator's way (belt-and-suspenders for the `mpRegister('cmd','commandPath')` seam).
- [x] **T4** Harness `mountConsole()` in `console.test.ts` — the reusable jsdom
  driver so the WHOLE class fails CI going forward, not one control per release.

## Verification gates
- [x] `npm run typecheck` — clean (added `@types/jsdom`)
- [x] `npm test` — console.test.ts 301/301; suite-wide the only failures are the
  4 pre-existing `scripts/icon-assets.test.mjs` cases (missing `assets/icon/.venv`
  python — fail identically on the clean tree; unrelated to this change)
- [x] `node scripts/scope-wall.mjs` — 0 violations
- [x] `npx eslint` on both files — clean
