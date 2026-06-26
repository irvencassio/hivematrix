# Settings → Lanes Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-settings-lanes-cleanup-design.md`

All edits are in `src/daemon/console.ts` (markup + one new render function +
tab-switch wiring) and `src/daemon/console.test.ts` (tests). No server changes.

---

## Task 1 — RED: section label + ordering tests

- [ ] Add to `src/daemon/console.test.ts` a test
  `"settings lanes sections have distinct, non-duplicate labels"`:
  - `assert.match(CONSOLE_HTML, /Lane Apps/)`
  - `assert.match(CONSOLE_HTML, /Runtime Capabilities/)`
  - `assert.match(CONSOLE_HTML, /Browser Lane Sites &amp; Auth/)` (note: `&` is HTML-escaped in the template)
  - `assert.match(CONSOLE_HTML, /Terminal Lane Profiles &amp; Readiness/)`
  - `assert.doesNotMatch(CONSOLE_HTML, /Embedded capability lanes/)`
- [ ] Add a test `"Browser Lane Sites & Auth appears before Runtime Capabilities"`:
  compare `CONSOLE_HTML.indexOf("Browser Lane Sites")` `<` `indexOf("Runtime Capabilities")`,
  and `indexOf("Lane Apps") < indexOf("Browser Lane Sites")`.
- [ ] Run `npm test` — watch these fail (labels not yet renamed).

## Task 2 — RED: Terminal Lane readiness card test

- [ ] Add a test `"settings surfaces a real Terminal Lane readiness card with no secrets"`:
  - `assert.match(CONSOLE_HTML, /id="terminal_readiness"/)`
  - `const js = extractScript(CONSOLE_HTML)`
  - `assert.match(js, /async function renderTerminalReadiness\(/)`
  - `assert.match(js, /\/terminal-lane\/dashboard/)`
  - `assert.match(js, /\/terminal-lane\/readiness\/run/)`
  - secrets guard — the render must not surface credential refs/values:
    extract the function body and assert it does NOT match
    `/credentialRef|password|private_key|ssh_key_passphrase/`.
  - `assert.match(js, /renderTerminalReadiness\(\)/)` inside the lanes tab init.
- [ ] Run `npm test` — watch it fail (function/mount not present).

## Task 3 — GREEN: relabel + reorder + Terminal card markup

In `src/daemon/console.ts`, inside `#settingsLanes` (around lines 716–784):

- [ ] Rename the `Embedded capability lanes` label (line ~732) to
  `Runtime Capabilities`. Keep the `renderSettingsLanes()` refresh button and
  `#s_lanes` mount.
- [ ] Rename the `Browser Lane readiness` label (line ~779) to
  `Browser Lane Sites & Auth`. Keep `renderBrowserReadiness`/`runBrowserReadiness`
  and `#browser_readiness`.
- [ ] Move the Browser Lane Sites & Auth block (label + muted copy + Run button +
  `#browser_readiness` + its trailing `<hr>`) to sit immediately AFTER the Lane
  Apps block and BEFORE Runtime Capabilities.
- [ ] Insert a new Terminal Lane Profiles & Readiness block right after the
  Browser Lane Sites & Auth block:
  ```html
  <div class="row" style="justify-content:space-between;align-items:center">
    <label class="flbl" style="margin:0">Terminal Lane Profiles &amp; Readiness</label>
    <button class="copybtn" onclick="renderTerminalReadiness()">↻ Refresh</button>
  </div>
  <div class="muted" style="font-size:11px;margin:4px 0 6px">Per-profile readiness (local shell / SSH) with stale tracking. Run a check to probe each configured profile before routing terminal work. Credentials live in the macOS Keychain and are never shown here.</div>
  <div class="row" style="margin-top:4px"><button class="create" onclick="runTerminalReadiness()">Run readiness check</button></div>
  <div id="terminal_readiness" style="margin-top:8px"></div>
  <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
  ```
- [ ] Ensure the final ordering is: System Readiness → Lane Apps → Browser Lane
  Sites & Auth → Terminal Lane Profiles & Readiness → Runtime Capabilities →
  COO Dispatch → COO routing rules → HeyGen portal videos → Workflows → Safe senders.

## Task 4 — GREEN: renderTerminalReadiness + runTerminalReadiness functions

Add next to `renderBrowserReadiness` (after line ~4272), mirroring its shape but
exposing NO secret fields (only displayName, kind, readiness.status/color/stale):

```js
async function renderTerminalReadiness() {
  const el = document.getElementById("terminal_readiness");
  if (!el) return;
  el.innerHTML = '<div class="muted">Loading…</div>';
  const r = await api("/terminal-lane/dashboard");
  if (!r || !r.ok) { el.innerHTML = '<div class="muted">Readiness unavailable.</div>'; return; }
  const t = r.totals || { byColor: {} };
  const profiles = r.profiles || [];
  if (!profiles.length) { el.innerHTML = '<div class="muted" style="font-size:11px">No Terminal Lane profiles are configured.</div>'; return; }
  const m = (k,v) => '<div class="m" style="margin-top:2px"><span class="badge">'+esc(k)+'</span> '+esc(v)+'</div>';
  const head = m("profiles", t.profiles || 0) + m("needs attention", t.needsAttention || 0);
  const attention = profiles.filter(p => ['orange','red','gray'].includes(p.readiness.color));
  const shown = (attention.length ? attention : profiles).slice(0,5);
  const list = shown.map(p => {
    const lastRun = p.readiness.lastRunAt ? ' · ' + timeAgo(p.readiness.lastRunAt, Date.now()) : ' · never run';
    return '<div class="muted" style="font-size:11px">'+esc(p.displayName)+' <span class="badge">'+esc(p.kind)+'</span> — '+esc(p.readiness.status)+' ('+esc(p.readiness.color)+')'+lastRun+'</div>';
  }).join('');
  el.innerHTML = '<div class="card" style="cursor:default">'+head+'<div style="margin-top:6px">'+list+'</div></div>';
}
async function runTerminalReadiness() {
  const el = document.getElementById("terminal_readiness");
  if (el) el.innerHTML = '<div class="muted">Running readiness check…</div>';
  const r = await api("/terminal-lane/readiness/run", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ profileId: "all" }) });
  if (!r || !r.ok) { if (el) el.innerHTML = '<div class="errbox">'+esc((r&&r.error)||'Readiness run failed')+'</div>'; return; }
  renderTerminalReadiness();
}
```

(Note: the `m`/head/attention shape mirrors `renderBrowserReadiness`; only
non-secret fields are read. `timeAgo` already exists in the console script.)

## Task 5 — GREEN: wire the new render into the lanes tab init

- [ ] In `switchSettingsTab` (line ~3684), add `renderTerminalReadiness();` to the
  `if (tab === "lanes") { … }` call list, after `renderBrowserReadiness()`.

## Task 6 — Verify all gates

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all passing (new tests now green)
- [ ] `node scripts/scope-wall.mjs` — zero violations
- [ ] `npm run verify:portal` — passes

## Task 7 — Commit & push

- [ ] Stage `src/daemon/console.ts`, `src/daemon/console.test.ts`, and the two
  superpowers docs.
- [ ] Commit with a descriptive message (Co-Authored-By trailer).
- [ ] Push to `main`.
