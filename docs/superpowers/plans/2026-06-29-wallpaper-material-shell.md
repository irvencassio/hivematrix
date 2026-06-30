# Wallpaper Material Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-29
**Design doc:** `docs/superpowers/specs/2026-06-29-wallpaper-material-shell-design.md`
**Scope:** `src/daemon/console.ts`, `src/daemon/console.test.ts`

---

## Context

HiveMatrix's `src/daemon/console.ts` contains all shell CSS as a self-contained `String.raw` template. Three independent `backdrop-filter` values are hard-coded in three places (header: `blur(24px) saturate(180%)`, `.col`: `blur(20px) saturate(160%)`, wallpaper override: `blur(var(--wp-blur, 6px)) saturate(160%)`). Panels (`--panel`, `--panel-2`) carry ad-hoc RGBA values per theme. There is no shared token layer.

This plan replaces all of that with a composable `--mat-*` token system from the design spec, without touching any non-CSS logic and without breaking the no-wallpaper light/dark/matrix states.

---

## Task 1 — RED: write failing CSS-token tests

**File:** `src/daemon/console.test.ts`

Add a new `test` block that reads `CONSOLE_HTML` as a string and asserts on substring presence. These must **fail before Task 2**.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { CONSOLE_HTML } from "./console";

test("material shell: base blur tokens defined", () => {
  assert.match(CONSOLE_HTML, /--mat-blur-chrome:\s*24px/);
  assert.match(CONSOLE_HTML, /--mat-blur-regular:\s*20px/);
  assert.match(CONSOLE_HTML, /--mat-blur-thick:\s*14px/);
  assert.match(CONSOLE_HTML, /--mat-blur-thin:\s*8px/);
});

test("material shell: backdrop-filter shorthands defined", () => {
  assert.match(CONSOLE_HTML, /--mat-chrome:\s*blur\(var\(--mat-blur-chrome\)\)/);
  assert.match(CONSOLE_HTML, /--mat-regular:\s*blur\(var\(--mat-blur-regular\)\)/);
});

test("material shell: header uses var(--mat-chrome)", () => {
  assert.match(CONSOLE_HTML, /header\s*\{[^}]*backdrop-filter:\s*var\(--mat-chrome\)/s);
});

test("material shell: .col uses var(--mat-regular)", () => {
  assert.match(CONSOLE_HTML, /\.col\s*\{[^}]*backdrop-filter:\s*var\(--mat-regular\)/s);
});

test("material shell: --panel references mat-tint-regular in all three themes", () => {
  const occurrences = (CONSOLE_HTML.match(/--panel:\s*var\(--mat-tint-regular\)/g) || []).length;
  assert.ok(occurrences >= 3, `expected --panel to reference --mat-tint-regular in all 3 themes, got ${occurrences}`);
});

test("material shell: wallpaper override uses --mat-wp-blur and --mat-wp-sat", () => {
  assert.match(CONSOLE_HTML, /blur\(var\(--mat-wp-blur\)\)\s+saturate\(var\(--mat-wp-sat\)\)/);
});

test("material shell: --mat-wp-opacity token present in :root", () => {
  assert.match(CONSOLE_HTML, /--mat-wp-opacity:/);
});

test("material shell: no-wallpaper tokens still present (regression guard)", () => {
  assert.match(CONSOLE_HTML, /--bg:/);
  assert.match(CONSOLE_HTML, /--text:/);
  assert.match(CONSOLE_HTML, /--accent:/);
  assert.match(CONSOLE_HTML, /--border:/);
});
```

Checklist:
- [ ] Append the tests above to `src/daemon/console.test.ts`
- [ ] Run `npm test` — confirm all new tests **fail** (existing tests still pass)

---

## Task 2 — GREEN: add `--mat-*` base token block to `:root`

**File:** `src/daemon/console.ts`

In the `:root { … }` CSS block (currently lines 19-32), prepend the entire base material token block **before** the existing semantic tokens. Do not remove any existing tokens — only add.

Insert after `color-scheme: dark;` and before `--bg:`:

```css
/* ── Material tier: blur radii ──────────────────────── */
--mat-blur-chrome:  24px;
--mat-blur-regular: 20px;
--mat-blur-thick:   14px;
--mat-blur-thin:     8px;
/* ── Saturation multipliers ─────────────────────────── */
--mat-sat-chrome:  180%;
--mat-sat-regular: 160%;
--mat-sat-thick:   140%;
--mat-sat-thin:    120%;
/* ── Backdrop-filter shorthands ─────────────────────── */
--mat-chrome:  blur(var(--mat-blur-chrome))  saturate(var(--mat-sat-chrome));
--mat-regular: blur(var(--mat-blur-regular)) saturate(var(--mat-sat-regular));
--mat-thick:   blur(var(--mat-blur-thick))   saturate(var(--mat-sat-thick));
--mat-thin:    blur(var(--mat-blur-thin))    saturate(var(--mat-sat-thin));
/* ── Tint alphas ─────────────────────────────────────── */
--mat-tint-alpha-chrome:  0.82;
--mat-tint-alpha-regular: 0.72;
--mat-tint-alpha-thick:   0.86;
--mat-tint-alpha-thin:    0.55;
/* ── Wallpaper participation ─────────────────────────── */
--mat-wp-blur:     6px;
--mat-wp-sat:      160%;
--mat-wp-opacity:  0.82;
```

Checklist:
- [ ] Insert the token block into `:root` in `src/daemon/console.ts`
- [ ] Run `npm test` — `--mat-blur-chrome`, `--mat-regular`, `--mat-wp-opacity` tests now pass

---

## Task 3 — GREEN: add `--mat-tint-*` per-theme tint tokens and wire `--panel`

**File:** `src/daemon/console.ts`

**3a. Dark theme (`:root` block)**

After the `--mat-wp-opacity` line (still in `:root`), add:

```css
/* ── Dark tints ─────────────────────────────────────── */
--mat-tint-chrome:    rgba(22,27,34,  var(--mat-tint-alpha-chrome));
--mat-tint-regular:   rgba(22,27,34,  var(--mat-tint-alpha-regular));
--mat-tint-thick:     rgba(28,34,48,  var(--mat-tint-alpha-thick));
--mat-tint-thin:      rgba(13,17,23,  var(--mat-tint-alpha-thin));
```

Then replace:
```css
--panel: rgba(22,27,34,.82); --panel-2: rgba(28,34,48,.72);
```
with:
```css
--panel: var(--mat-tint-regular); --panel-2: var(--mat-tint-thick);
```

**3b. Light theme (`html[data-theme="light"]` block)**

Add after `color-scheme: light;`:
```css
--mat-tint-chrome:    rgba(255,255,255, var(--mat-tint-alpha-chrome));
--mat-tint-regular:   rgba(255,255,255, var(--mat-tint-alpha-regular));
--mat-tint-thick:     rgba(240,243,246, var(--mat-tint-alpha-thick));
--mat-tint-thin:      rgba(255,255,255, var(--mat-tint-alpha-thin));
```

Replace:
```css
--panel: rgba(255,255,255,.85); --panel-2: rgba(240,243,246,.78);
```
with:
```css
--panel: var(--mat-tint-regular); --panel-2: var(--mat-tint-thick);
```

**3c. Matrix theme (`html[data-theme="matrix"]` block)**

Add after `color-scheme: dark;`:
```css
--mat-tint-alpha-regular: 0.85;
--mat-tint-chrome:    rgba(4,20,11,   var(--mat-tint-alpha-chrome));
--mat-tint-regular:   rgba(4,20,11,   var(--mat-tint-alpha-regular));
--mat-tint-thick:     rgba(10,33,19,  var(--mat-tint-alpha-thick));
--mat-tint-thin:      rgba(1,10,5,    var(--mat-tint-alpha-thin));
```

Replace:
```css
--panel: rgba(4,20,11,.85); --panel-2: rgba(10,33,19,.78);
```
with:
```css
--panel: var(--mat-tint-regular); --panel-2: var(--mat-tint-thick);
```

Checklist:
- [ ] Apply 3a, 3b, 3c in `src/daemon/console.ts`
- [ ] Run `npm test` — `--panel references mat-tint-regular in all three themes` test now passes

---

## Task 4 — GREEN: replace hard-coded `backdrop-filter` values

**File:** `src/daemon/console.ts`

**4a. Header** (currently line 83):
```css
/* before */
backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
/* after */
backdrop-filter: var(--mat-chrome); -webkit-backdrop-filter: var(--mat-chrome);
```

**4b. `.col`** (currently line 96):
```css
/* before */
backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);
/* after */
backdrop-filter: var(--mat-regular); -webkit-backdrop-filter: var(--mat-regular);
```

**4c. Wallpaper + matrix override** (currently lines 68-69):
```css
/* before */
backdrop-filter: blur(var(--wp-blur, 6px)) saturate(160%); -webkit-backdrop-filter: blur(var(--wp-blur, 6px)) saturate(160%);
/* after */
backdrop-filter: blur(var(--mat-wp-blur)) saturate(var(--mat-wp-sat)); -webkit-backdrop-filter: blur(var(--mat-wp-blur)) saturate(var(--mat-wp-sat));
```

Note: `--wp-blur` was a runtime-written CSS var with a fallback. After this change `--mat-wp-blur` is the sole source; see Task 5 for the TypeScript side.

Checklist:
- [ ] Apply 4a, 4b, 4c in `src/daemon/console.ts`
- [ ] Run `npm test` — header/col backdrop-filter token tests now pass

---

## Task 5 — GREEN: wire TypeScript to write `--mat-wp-opacity` on wallpaper change

**File:** `src/daemon/console.ts` — the inline `<script>` block

Search for the JavaScript that applies wallpaper settings (look for `wallpaperOpacity` or `wp-opacity` or where `data-wallpaper` attribute is set). Add the line:

```js
document.documentElement.style.setProperty('--mat-wp-opacity', (settings.wallpaperOpacity / 100).toFixed(2));
```

alongside wherever `--wp-opacity` is currently written. If the existing code wrote `--wp-opacity`, keep that write for any code still referencing it, but add the new `--mat-wp-opacity` write next to it.

Checklist:
- [ ] Locate wallpaper JS in the `<script>` block inside `CONSOLE_HTML`
- [ ] Add `--mat-wp-opacity` write next to any existing `--wp-opacity` write
- [ ] Run `npm test` — all 8 new tests pass, all pre-existing tests still pass

---

## Task 6 — REFACTOR: verify no orphaned hard-coded values remain

After all green tasks, do a final sweep:

```
grep -n "blur(24px)\|blur(20px)\|blur(6px)" src/daemon/console.ts
```

Expected: zero matches. If any remain, replace with the appropriate `var(--mat-*)` reference.

Checklist:
- [ ] Run grep; confirm zero matches
- [ ] Run `npm run typecheck` — zero errors
- [ ] Run `npm test` — all tests green
- [ ] Run `node scripts/scope-wall.mjs` — zero violations

---

## Task 7 — Finish

Checklist:
- [ ] All 8 new tests pass
- [ ] All pre-existing tests pass
- [ ] `npm run typecheck` clean
- [ ] `node scripts/scope-wall.mjs` clean
- [ ] No deployment — do NOT push or release; flag done to Flight coordinator

---

## Test Summary

| Test | What it guards |
|---|---|
| base blur tokens defined | `--mat-blur-{chrome,regular,thick,thin}` all present |
| backdrop-filter shorthands defined | `--mat-chrome`, `--mat-regular` compose via tokens |
| header uses var(--mat-chrome) | No hard-coded `blur(24px)` in header |
| .col uses var(--mat-regular) | No hard-coded `blur(20px)` in .col |
| --panel references mat-tint-regular in all three themes | All three themes unified |
| wallpaper override uses --mat-wp-blur and --mat-wp-sat | No hard-coded fallback `blur(6px)` |
| --mat-wp-opacity token present | TypeScript bridge token declared |
| no-wallpaper tokens still present | `--bg`, `--text`, `--accent`, `--border` not removed |

---

## Constraints

- Do NOT remove `apply_macos_vibrancy()` in `src-tauri/src/lib.rs` — native vibrancy is a separate layer.
- Do NOT introduce a build step or bundler. Console is a `String.raw` template; all CSS must remain inline.
- Do NOT change layout, spacing, or any non-material visual property.
- Do NOT deploy or push. Work completes when the three verification gates are green.
