# Command Shell Layout Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Commands card inside the right context column for commands with long metadata, while preserving the existing compact command-shell UI.

**Architecture:** Fix the root cause at the CSS boundary by allowing command shell grid and flex descendants to shrink. Keep command discovery, metadata generation, API payloads, and action behavior unchanged.

**Tech Stack:** TypeScript, Node `node:test`, raw HTML/CSS/JavaScript template in `src/daemon/console.ts`.

## Global Constraints

- Keep the existing compact command-shell UI.
- Do not change command API, catalog, launch payloads, or metadata content.
- Long command metadata remains visible through each chip's existing `title` tooltip.
- The Run and Inspect buttons must remain visible regardless of selected command metadata length.
- No local-model readiness gate is required because this change does not touch local-model paths.

---

## File Structure

- Modify `src/daemon/console.test.ts`: add a string-level CSS regression test near the existing command launcher test.
- Modify `src/daemon/console.ts`: add command-shell shrink/containment CSS.

### Task 1: Contain Long Command Metadata

**Files:**
- Modify: `src/daemon/console.test.ts`
- Modify: `src/daemon/console.ts`

**Interfaces:**
- Consumes: `CONSOLE_HTML` from `src/daemon/console.ts`.
- Produces: CSS rules that keep `.command-shell` and its metadata row inside the existing context column.

- [x] **Step 1: Write the failing test**

In `src/daemon/console.test.ts`, add this test after `command launcher renders as a compact command shell`:

```ts
test("command launcher contains long metadata inside the context column", () => {
  assert.match(CONSOLE_HTML, /\.command-shell \{[^}]*min-width:0;[^}]*max-width:100%;/);
  assert.match(CONSOLE_HTML, /\.command-grid \{[^}]*min-width:0;/);
  assert.match(CONSOLE_HTML, /\.command-grid > \* \{[^}]*min-width:0;/);
  assert.match(CONSOLE_HTML, /\.command-meta \{[^}]*min-width:0;[^}]*overflow:hidden;/);
  assert.match(CONSOLE_HTML, /\.command-chip \{[^}]*min-width:0;[^}]*max-width:100%;[^}]*display:inline-block;/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected: FAIL because the command-shell CSS does not yet include these shrink/containment rules.

- [x] **Step 3: Write minimal implementation**

In `src/daemon/console.ts`, replace the command-shell CSS block with:

```css
  .command-shell { min-width:0; max-width:100%; border:1px solid var(--border); border-radius:8px; background:var(--panel-2); overflow:hidden; margin-bottom:8px; }
  .command-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 10px; border-bottom:1px solid var(--border); }
  .command-title { min-width:0; }
  .command-title b { display:block; font-size:12px; line-height:1.2; }
  .command-title span { display:block; font-size:10.5px; color:var(--muted); line-height:1.25; margin-top:2px; }
  .command-import { flex:none; border:1px solid var(--border); background:var(--panel); color:var(--accent); border-radius:6px; padding:4px 7px; font-size:11px; font-weight:700; cursor:pointer; }
  .command-import:hover { border-color:var(--accent); }
  .command-grid { min-width:0; padding:10px; display:grid; gap:8px; }
  .command-grid > * { min-width:0; }
  .command-grid select, .command-grid input { width:100%; margin:0; }
  .command-meta { display:flex; flex-wrap:wrap; gap:4px; min-height:22px; min-width:0; overflow:hidden; align-items:center; }
  .command-chip { min-width:0; max-width:100%; display:inline-block; border:1px solid var(--border); background:var(--panel); color:var(--muted); border-radius:999px; padding:2px 7px; font-size:10.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
```

Leave the remaining command CSS unchanged:

```css
  .command-chip.primary { color:var(--accent-2); border-color:color-mix(in srgb, var(--accent-2) 42%, var(--border)); }
  .command-project-row { display:grid; grid-template-columns:minmax(86px,.72fr) minmax(0,1.28fr); gap:6px; }
  .command-actions { display:flex; gap:6px; }
```

- [x] **Step 4: Run targeted test to verify it passes**

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected: PASS.

- [x] **Step 5: Run required verification**

Run:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

Expected: all commands exit 0.

- [x] **Step 6: Commit**

Run:

```bash
git status --short
git add docs/superpowers/specs/2026-06-19-command-shell-layout-containment-design.md docs/superpowers/plans/2026-06-19-command-shell-layout-containment.md src/daemon/console.test.ts src/daemon/console.ts
git commit -m "fix(console): contain command metadata layout"
```
