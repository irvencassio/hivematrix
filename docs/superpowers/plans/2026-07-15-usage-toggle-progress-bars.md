# Header Usage Toggle — Visual Progress Bars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-07-15-usage-toggle-progress-bars-design.md`.

All three tasks touch `src/daemon/console.ts` + `src/daemon/console.test.ts`. Run
**sequentially**, not in parallel (they share the same functions/markup region — Task A
must land before B, B before C). Verification gates after each task and again at the
end: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

Frozen facts this plan depends on (verified against HEAD `97bb0b6c`):
- Toggle markup lives at `console.ts` inside `<header><div class="hzone">`, immediately
  after the `#live` span: `<span class="obs-win" id="usageWinToggle">` containing the
  `5h`/`7d` `<button>`s, followed by `<span class="muted" id="usageWinReadout" ...>`.
- `usageBarClass(util, resetsAt, durationMs)`, `fmtResets(iso)`, `_headerUsageWin`,
  `_lastClaudeWins`, `setHeaderUsageWindow(w)`, `renderHeaderUsageWindow()` all live
  together around `console.ts:5615-5723` ("Frontier usage indicator" section).
- `checkUsage()` already caches `_lastClaudeWins = claudeWins` and calls
  `renderHeaderUsageWindow()` at the end of every poll — no change needed there.
- CSS `.usage-bar-wrap` / `.usage-bar` / `.usage-bar-fill(.ok/.warn/.hi)` /
  `.usage-status-dot(.ok/.warn/.hi)` already exist (currently unused) around
  `console.ts:328-341`.

**Hard constraint for every markup change in this plan: use `<span>`, never `<div>`,
for anything added inside `<span class="obs-win" id="usageWinToggle">`.** The existing
test `"header Usage section is removed..."` (`console.test.ts:1655`) computes
`hzoneEnd = CONSOLE_HTML.indexOf("</div>", headerStart)` — the *first* `</div>` after
`<header>` — and slices `headerZone` up to it. That first `</div>` must stay the
`.hzone` div's own closing tag. A `<div>` added anywhere inside the toggle would move
`hzoneEnd` earlier and truncate `headerZone`, and — because there are no other divs
between `<header>` and `.hzone`'s close today — every assertion in that test would
fail loudly (not silently), which is *why* Task B's diff below adds an explicit
regression-guard assertion for this rather than leaving it to be discovered as
confusing collateral test failures.

---

## Task A — Extract `sevenDayCycleDay(resetsAt)` from `usageBarClass` (pure refactor)

Files: `src/daemon/console.ts`, `src/daemon/console.test.ts`. No markup changes.

- [ ] **Test first.** In `console.test.ts`, add a new test immediately after the
  existing `"5-hour usage bars can still use the warning color"` test (ends
  `console.test.ts:1788`) and before `function consoleHeaderUsageToggle()`
  (`console.test.ts:1790`):

  ```ts
  type SevenDayCycleDay = (resetsAt: string) => number | null;

  function consoleSevenDayCycleDay(): SevenDayCycleDay {
    const js = extractScript(CONSOLE_HTML);
    const body = js.match(/function sevenDayCycleDay\([\s\S]*?\n\}/)?.[0] ?? "";
    assert.ok(body.length > 30, "sevenDayCycleDay body extracted");
    return new Function(body + "\nreturn sevenDayCycleDay;")() as SevenDayCycleDay;
  }

  test("sevenDayCycleDay returns the 1-7 day-of-cycle usageBarClass keys its day-pacing off of", () => {
    const cycleDay = consoleSevenDayCycleDay();
    const now = Date.UTC(2026, 6, 1, 12, 0, 0);
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    withFrozenNow(now, () => {
      assert.equal(cycleDay(resetIn(now, 6 * day + 5 * hour)), 1, "6d+ left => day 1");
      assert.equal(cycleDay(resetIn(now, 5 * day + 5 * hour)), 2, "5d+ left => day 2");
      assert.equal(cycleDay(resetIn(now, (18 * 60 + 29) * 60 * 1000)), 7, "under 1d left => day 7");
      assert.equal(cycleDay(resetIn(now, -hour)), null, "already-expired reset => null");
      assert.equal(cycleDay(""), null, "no reset timestamp => null");
    });
  });
  ```

  Run `npm test` — confirm this new test fails RED (`sevenDayCycleDay` doesn't exist
  yet). The pre-existing day-pacing tests (`console.test.ts:1752`, `:1764`) should
  still be GREEN at this point — they don't exercise the new function yet.

- [ ] In `console.ts`, immediately above `function usageBarClass(...)`
  (`console.ts:5628`), add:

  ```js
  // Which day (1-7) of a live 7-day subscription window's cycle "now" falls on, per
  // docs/superpowers/specs/2026-07-01-usage-7-day-green-red-design.md. Shared by
  // usageBarClass (day-paced ok/hi color) and the header 7-day tick bar (fill count)
  // so the two can't disagree about what day it is. Null for an expired/invalid reset.
  function sevenDayCycleDay(resetsAt) {
    if (!resetsAt) return null;
    const timeUntilResetMs = new Date(resetsAt).getTime() - Date.now();
    if (timeUntilResetMs <= 0) return null;
    const dayMs = 24 * 60 * 60 * 1000;
    const wholeDaysLeft = Math.min(7, Math.max(1, Math.ceil(timeUntilResetMs / dayMs)));
    return 8 - wholeDaysLeft;
  }
  ```

- [ ] In `usageBarClass`, replace the inline day-math with a call to the new helper.
  Change:

  ```js
      if (Math.abs(durationMs - sevenDaysMs) < 1000) {
        const dayMs = 24 * 60 * 60 * 1000;
        const wholeDaysLeft = Math.min(7, Math.max(1, Math.ceil(timeUntilResetMs / dayMs)));
        const cycleDay = 8 - wholeDaysLeft;
        const allowedDays = Math.min(cycleDay, 6);
  ```

  to:

  ```js
      if (Math.abs(durationMs - sevenDaysMs) < 1000) {
        const cycleDay = sevenDayCycleDay(resetsAt);
        const allowedDays = Math.min(cycleDay, 6);
  ```

  (The outer `if (timeUntilResetMs > 0)` guard already active at this point in
  `usageBarClass` means `cycleDay` is never null here — `sevenDayCycleDay` re-checks
  the same condition internally so it stays correct as a standalone function too.)

- [ ] Run `npm test`. Expect **two new failures**, not just the new test staying red —
  this is the predicted side effect called out in the design doc: `usageBarClass` now
  references `sevenDayCycleDay`, but two existing test harnesses re-link
  `usageBarClass` via `new Function(...)` against a hand-picked list of extracted
  function bodies that doesn't yet include it, so any test that exercises the 7-day
  branch throws `ReferenceError: sevenDayCycleDay is not defined`:
  - `consoleUsageBarClass()` (`console.test.ts:1731`) — used by the two existing
    7-day-branch tests at `console.test.ts:1752` and `:1764`.
  - `consoleHeaderUsageToggle()` (`console.test.ts:1790`) — used by the
    `"renderHeaderUsageWindow shows remaining%..."` test, which toggles to a 7-day
    window.
  Fix both extraction helpers to also pull in and link `sevenDayCycleDay`:

  In `consoleUsageBarClass()` (`console.test.ts:1731-1736`), change:

  ```ts
  function consoleUsageBarClass(): UsageBarClass {
    const js = extractScript(CONSOLE_HTML);
    const body = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
    assert.ok(body.length > 100, "usageBarClass body extracted");
    return new Function(body + "\nreturn usageBarClass;")() as UsageBarClass;
  }
  ```

  to:

  ```ts
  function consoleUsageBarClass(): UsageBarClass {
    const js = extractScript(CONSOLE_HTML);
    const cycleDaySrc = js.match(/function sevenDayCycleDay\([\s\S]*?\n\}/)?.[0] ?? "";
    const body = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
    assert.ok(cycleDaySrc.length > 30, "sevenDayCycleDay body extracted");
    assert.ok(body.length > 100, "usageBarClass body extracted");
    return new Function(cycleDaySrc + "\n" + body + "\nreturn usageBarClass;")() as UsageBarClass;
  }
  ```

  In `consoleHeaderUsageToggle()` (`console.test.ts:1790` area), find:

  ```ts
    const usageBarClassSrc = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
    const fmtResetsSrc = js.match(/function fmtResets\([\s\S]*?\n\}/)?.[0] ?? "";
  ```

  and add a `cycleDaySrc` extraction right after `usageBarClassSrc`, then include it in
  the `combined` array:

  ```ts
    const usageBarClassSrc = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
    const cycleDaySrc = js.match(/function sevenDayCycleDay\([\s\S]*?\n\}/)?.[0] ?? "";
    const fmtResetsSrc = js.match(/function fmtResets\([\s\S]*?\n\}/)?.[0] ?? "";
  ```

  and change `const combined = [usageBarClassSrc, fmtResetsSrc, winState, cacheState, setSrc, renderSrc].join("\n");`
  to `const combined = [usageBarClassSrc, cycleDaySrc, fmtResetsSrc, winState, cacheState, setSrc, renderSrc].join("\n");`
  (also add `assert.ok(cycleDaySrc.length > 30, ...)` alongside the existing combined
  `assert.ok(...)` call in that function).

- [ ] Run `npm test` again — confirm all of: the new `sevenDayCycleDay` test, both
  previously-broken 7-day-branch tests, and the `renderHeaderUsageWindow` toggle test
  are GREEN. Confirm nothing else regressed.
- [ ] `npm run typecheck` clean, `node scripts/scope-wall.mjs` clean.

---

## Task B — 5-hour toggle button: continuous fill bar + tooltip

Files: `src/daemon/console.ts`, `src/daemon/console.test.ts`. 7-day button stays plain
text (`7 day`) — untouched by this task, changed in Task C.

- [ ] **Test first.** In `console.test.ts`, replace the entire existing test block
  titled `"header Usage section is removed; a 5h/7d toggle now sits in the header's
  live/toggle zone"` (`console.test.ts:1655-1677`) with:

  ```ts
  test("header Usage section is removed; the 5-hour toggle button grew a visual progress bar", () => {
    // The sidebar Usage <details> section was replaced by a compact header toggle —
    // see docs/superpowers/specs/2026-07-15-console-header-cleanup-design.md item 3.
    // The toggle then grew inline progress bars — see
    // docs/superpowers/specs/2026-07-15-usage-toggle-progress-bars-design.md.
    assert.doesNotMatch(CONSOLE_HTML, /id="usageSec"/, "standalone Usage section is gone");
    assert.doesNotMatch(CONSOLE_HTML, /id="usageDetailsSec"/, "per-window details disclosure is gone");

    const headerStart = CONSOLE_HTML.indexOf("<header>");
    const hzoneEnd = CONSOLE_HTML.indexOf("</div>", headerStart);
    const headerZone = CONSOLE_HTML.slice(headerStart, hzoneEnd);
    assert.match(headerZone, /id="live"/, "live indicator stays in the header's first zone");
    assert.match(headerZone, /class="obs-win usage-win-bars" id="usageWinToggle"/, "reuses the existing .obs-win segmented toggle, no new toggle component");
    assert.match(headerZone, /data-w="5h" class="on" id="usageBtn5h"/, "5-hour is active by default");
    assert.match(headerZone, />5h</, "5-hour button label present (shortened from '5 hour' to make room for its bar)");
    assert.match(headerZone, /id="usageBar5h"/, "5-hour bar track mount present");
    assert.match(headerZone, /id="usageBar5hFill"/, "5-hour bar fill mount present");
    assert.match(headerZone, />7 day</, "7-day button keeps its plain-text label for now (gets its own bar in a follow-up task)");
    assert.match(headerZone, /id="usageWinReadout"/, "readout text mount present");

    const toggleMarkup = CONSOLE_HTML.slice(CONSOLE_HTML.indexOf('id="usageWinToggle"'), CONSOLE_HTML.indexOf("</span>", CONSOLE_HTML.indexOf("usageWinReadout")));
    assert.doesNotMatch(toggleMarkup, /<div/, "toggle internals use span, not div, so the header's first </div> stays .hzone's own close");

    const js = extractScript(CONSOLE_HTML);
    assert.doesNotThrow(() => new Function(js), SyntaxError, "console script still parses as valid JS");
  });
  ```

  Run `npm test`, confirm RED (current markup has no `usage-win-bars` class, no
  `usageBtn5h`/`usageBar5h`/`usageBar5hFill`, and still says `5 hour` not `5h`).

- [ ] Add a second new test right after it:

  ```ts
  function consoleUsageBars() {
    const js = extractScript(CONSOLE_HTML);
    const usageBarClassSrc = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
    const cycleDaySrc = js.match(/function sevenDayCycleDay\([\s\S]*?\n\}/)?.[0] ?? "";
    const fmtResetsSrc = js.match(/function fmtResets\([\s\S]*?\n\}/)?.[0] ?? "";
    const winState = js.match(/let _headerUsageWin[^\n]+/)?.[0] ?? "";
    const cacheState = js.match(/let _lastClaudeWins[^\n]+/)?.[0] ?? "";
    const findWinSrc = js.match(/function findUsageWin\([\s\S]*?\n\}/)?.[0] ?? "";
    const setSrc = js.match(/function setHeaderUsageWindow\([^\n]+/)?.[0] ?? "";
    const render5hSrc = js.match(/function renderUsage5hBar\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    const renderSrc = js.match(/function renderHeaderUsageWindow\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    assert.ok(
      usageBarClassSrc.length > 50 && cycleDaySrc.length > 30 && fmtResetsSrc.length > 30
        && winState.length > 10 && cacheState.length > 10 && findWinSrc.length > 20
        && setSrc.length > 20 && render5hSrc.length > 30 && renderSrc.length > 50,
      "usage bar state + functions extracted",
    );

    const combined = [usageBarClassSrc, cycleDaySrc, fmtResetsSrc, winState, cacheState, findWinSrc, setSrc, render5hSrc, renderSrc].join("\n");
    const factory = new Function(
      "document",
      `${combined}\nreturn { setHeaderUsageWindow, renderHeaderUsageWindow, seed: function (w) { _lastClaudeWins = w; } };`,
    ) as (doc: unknown) => {
      setHeaderUsageWindow: (w: string) => void;
      renderHeaderUsageWindow: () => void;
      seed: (wins: unknown) => void;
    };

    function makeToggleBtn(w: string) {
      const classList = { on: false, toggle: (_cls: string, v: boolean) => { classList.on = v; } };
      return { dataset: { w }, classList };
    }
    const toggleButtons = [makeToggleBtn("5h"), makeToggleBtn("7d")];
    const els: Record<string, any> = {
      usageWinReadout: { textContent: "", className: "muted" },
      usageBar5hFill: { style: { width: "" }, className: "" },
      usageBtn5h: { title: "" },
    };
    const doc = {
      getElementById: (id: string) => els[id],
      querySelectorAll: (sel: string) => (sel.indexOf("usageWinToggle") >= 0 ? toggleButtons : []),
    };
    const control = factory(doc);
    return { ...control, toggleButtons, els };
  }

  test("5-hour toggle button renders a visual progress bar (fill width + status color), independent of which window is active", () => {
    const ub = consoleUsageBars();
    const now = Date.UTC(2026, 6, 1, 12, 0, 0);
    const original = Date.now;
    Date.now = () => now;
    try {
      ub.seed([
        { label: "5-hour", remaining: 10, utilization: 90, resetsAt: new Date(now + 3600000).toISOString(), durationMs: 18000000 },
        { label: "7-day", remaining: 90, utilization: 10, resetsAt: new Date(now + 3 * 86400000).toISOString(), durationMs: 604800000 },
      ]);
      ub.setHeaderUsageWindow("7d");
      assert.equal(ub.els.usageBar5hFill.style.width, "90%", "fill width tracks 5-hour utilization");
      assert.equal(ub.els.usageBar5hFill.className, "usage-bar-fill hi", "90% utilization on a 5h window is the hi status color");
      assert.equal(ub.els.usageBtn5h.title, "10% left · resets in 1h 0m", "tooltip carries the exact detail regardless of active state");
    } finally {
      Date.now = original;
    }
  });

  test("5-hour bar resets to empty when there is no 5-hour window in the cached data", () => {
    const ub = consoleUsageBars();
    ub.seed([{ label: "7-day", remaining: 90, utilization: 10, resetsAt: new Date(Date.now() + 86400000).toISOString(), durationMs: 604800000 }]);
    ub.renderHeaderUsageWindow();
    assert.equal(ub.els.usageBar5hFill.style.width, "0%");
    assert.equal(ub.els.usageBar5hFill.className, "usage-bar-fill");
    assert.equal(ub.els.usageBtn5h.title, "");
  });
  ```

  Run `npm test`, confirm both fail RED (`findUsageWin`/`renderUsage5hBar` don't exist
  yet, so `consoleUsageBars()`'s own `assert.ok` fails first).

- [ ] In `console.ts`, update the CSS. Find:

  ```
    .usage-bar-wrap { display: flex; align-items: center; gap: 6px; margin: 2px 0 4px; }
    .usage-bar { position: relative; height: 6px; border-radius: 3px; background: var(--border); flex: 1; overflow: hidden; }
    .usage-bar-fill { height: 100%; border-radius: 3px; transition: width .3s; }
  ```

  replace with (adds `display` so these work as `<span>` instead of the sidebar's
  original `<div>` — needed once they're nested inside a `<button>`, see design doc):

  ```
    .usage-bar-wrap { display: flex; align-items: center; gap: 6px; margin: 2px 0 4px; }
    .usage-bar { display: inline-block; position: relative; height: 6px; border-radius: 3px; background: var(--border); flex: 1; overflow: hidden; }
    .usage-bar-fill { display: block; height: 100%; border-radius: 3px; transition: width .3s; }
  ```

  Then find:

  ```
    .usage-status-dot.hi   { color: #e05b2c; }
  ```

  and add immediately after it:

  ```
    .usage-status-dot.hi   { color: #e05b2c; }
    .usage-win-bars button { display: inline-flex; align-items: center; gap: 4px; }
    .usage-win-bars .usage-bar-wrap { margin: 0; }
    .usage-win-bars .usage-bar { width: 26px; flex: none; }
  ```

- [ ] In `console.ts`, update the header markup. Find (`console.ts:1064-1068`):

  ```html
      <span class="obs-win" id="usageWinToggle">
        <button data-w="5h" class="on" onclick="setHeaderUsageWindow('5h')">5 hour</button>
        <button data-w="7d" onclick="setHeaderUsageWindow('7d')">7 day</button>
      </span>
      <span class="muted" id="usageWinReadout" style="font-size:11px"></span>
  ```

  replace with:

  ```html
      <span class="obs-win usage-win-bars" id="usageWinToggle">
        <button data-w="5h" class="on" id="usageBtn5h" onclick="setHeaderUsageWindow('5h')">5h<span class="usage-bar-wrap"><span class="usage-bar" id="usageBar5h"><span class="usage-bar-fill" id="usageBar5hFill"></span></span></span></button>
        <button data-w="7d" onclick="setHeaderUsageWindow('7d')">7 day</button>
      </span>
      <span class="muted" id="usageWinReadout" style="font-size:11px"></span>
  ```

- [ ] In `console.ts`, add `findUsageWin` + `renderUsage5hBar`, and wire the latter
  into `renderHeaderUsageWindow`. Find (`console.ts:5676-5687`):

  ```js
  function renderHeaderUsageWindow() {
    document.querySelectorAll("#usageWinToggle button").forEach(function (b) { b.classList.toggle("on", b.dataset.w === _headerUsageWin); });
    const el = document.getElementById("usageWinReadout");
    if (!el) return;
    const label = _headerUsageWin === "5h" ? "5-hour" : "7-day";
    const win = (_lastClaudeWins || []).find(function (w) { return w.label === label; });
    if (!win) { el.textContent = ""; return; }
    const remaining = Math.max(0, Math.min(100, win.remaining));
    const cls = usageBarClass(win.utilization, win.resetsAt, win.durationMs || 0);
    el.textContent = remaining.toFixed(0) + "% left · resets " + fmtResets(win.resetsAt);
    el.className = "usage-status-dot " + cls;
  }
  ```

  replace with:

  ```js
  function findUsageWin(label) { return (_lastClaudeWins || []).find(function (w) { return w.label === label; }); }

  function renderUsage5hBar() {
    const fill = document.getElementById("usageBar5hFill");
    const btn = document.getElementById("usageBtn5h");
    const win = findUsageWin("5-hour");
    if (!win) {
      if (fill) { fill.style.width = "0%"; fill.className = "usage-bar-fill"; }
      if (btn) btn.title = "";
      return;
    }
    const used = Math.max(0, Math.min(100, win.utilization));
    const cls = usageBarClass(win.utilization, win.resetsAt, win.durationMs || 0);
    if (fill) { fill.style.width = used + "%"; fill.className = "usage-bar-fill " + cls; }
    if (btn) btn.title = Math.max(0, Math.min(100, win.remaining)).toFixed(0) + "% left · resets " + fmtResets(win.resetsAt);
  }

  function renderHeaderUsageWindow() {
    document.querySelectorAll("#usageWinToggle button").forEach(function (b) { b.classList.toggle("on", b.dataset.w === _headerUsageWin); });
    renderUsage5hBar();
    const el = document.getElementById("usageWinReadout");
    if (!el) return;
    const label = _headerUsageWin === "5h" ? "5-hour" : "7-day";
    const win = findUsageWin(label);
    if (!win) { el.textContent = ""; return; }
    const remaining = Math.max(0, Math.min(100, win.remaining));
    const cls = usageBarClass(win.utilization, win.resetsAt, win.durationMs || 0);
    el.textContent = remaining.toFixed(0) + "% left · resets " + fmtResets(win.resetsAt);
    el.className = "usage-status-dot " + cls;
  }
  ```

- [ ] Run `npm test` — confirm all new tests GREEN, and the pre-existing
  `"renderHeaderUsageWindow shows remaining%..."` test (`console.test.ts:1822`ish, now
  shifted) still passes unchanged (it only reads `usageWinReadout`, unaffected by the
  bar addition). Confirm nothing else regressed.
- [ ] `npm run typecheck` clean, `node scripts/scope-wall.mjs` clean.

---

## Task C — 7-day toggle button: 7-tick bar + tooltip

Files: `src/daemon/console.ts`, `src/daemon/console.test.ts`.

- [ ] **Test first.** In `console.test.ts`, replace the test added by Task B
  (`"header Usage section is removed; the 5-hour toggle button grew a visual progress
  bar"`) with the final version covering both buttons:

  ```ts
  test("header Usage section is removed; both 5h and 7d toggle buttons render visual progress bars", () => {
    assert.doesNotMatch(CONSOLE_HTML, /id="usageSec"/, "standalone Usage section is gone");
    assert.doesNotMatch(CONSOLE_HTML, /id="usageDetailsSec"/, "per-window details disclosure is gone");

    const headerStart = CONSOLE_HTML.indexOf("<header>");
    const hzoneEnd = CONSOLE_HTML.indexOf("</div>", headerStart);
    const headerZone = CONSOLE_HTML.slice(headerStart, hzoneEnd);
    assert.match(headerZone, /id="live"/, "live indicator stays in the header's first zone");
    assert.match(headerZone, /class="obs-win usage-win-bars" id="usageWinToggle"/, "reuses the existing .obs-win segmented toggle, no new toggle component");
    assert.match(headerZone, /data-w="5h" class="on" id="usageBtn5h"/, "5-hour is active by default");
    assert.match(headerZone, />5h</, "5-hour button label present");
    assert.match(headerZone, /id="usageBar5h"/, "5-hour bar track mount present");
    assert.match(headerZone, /id="usageBar5hFill"/, "5-hour bar fill mount present");
    assert.match(headerZone, /data-w="7d" id="usageBtn7d"/, "7-day button identifiable for tooltip/tick wiring");
    assert.match(headerZone, />7d</, "7-day button label present (shortened from '7 day' to make room for its tick bar)");
    assert.match(headerZone, /id="usageBar7d"/, "7-day tick track mount present");
    const dayTickCount = (headerZone.match(/class="usage-bar-day"/g) || []).length;
    assert.equal(dayTickCount, 7, "exactly 7 day ticks are pre-rendered in markup");
    assert.match(headerZone, /id="usageWinReadout"/, "readout text mount present");

    const toggleMarkup = CONSOLE_HTML.slice(CONSOLE_HTML.indexOf('id="usageWinToggle"'), CONSOLE_HTML.indexOf("</span>", CONSOLE_HTML.indexOf("usageWinReadout")));
    assert.doesNotMatch(toggleMarkup, /<div/, "toggle internals use span, not div, so the header's first </div> stays .hzone's own close");

    const js = extractScript(CONSOLE_HTML);
    assert.doesNotThrow(() => new Function(js), SyntaxError, "console script still parses as valid JS");
  });
  ```

  Run `npm test`, confirm RED (no `usageBtn7d`/`usageBar7d`/ticks yet, still `7 day`
  not `7d`).

- [ ] Replace the entire `consoleUsageBars()` function added in Task B with this
  extended version (adds `render7dSrc` extraction + 7-day mock elements):

  ```ts
  function consoleUsageBars() {
    const js = extractScript(CONSOLE_HTML);
    const usageBarClassSrc = js.match(/function usageBarClass\([\s\S]*?\n\}/)?.[0] ?? "";
    const cycleDaySrc = js.match(/function sevenDayCycleDay\([\s\S]*?\n\}/)?.[0] ?? "";
    const fmtResetsSrc = js.match(/function fmtResets\([\s\S]*?\n\}/)?.[0] ?? "";
    const winState = js.match(/let _headerUsageWin[^\n]+/)?.[0] ?? "";
    const cacheState = js.match(/let _lastClaudeWins[^\n]+/)?.[0] ?? "";
    const findWinSrc = js.match(/function findUsageWin\([\s\S]*?\n\}/)?.[0] ?? "";
    const setSrc = js.match(/function setHeaderUsageWindow\([^\n]+/)?.[0] ?? "";
    const render5hSrc = js.match(/function renderUsage5hBar\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    const render7dSrc = js.match(/function renderUsage7dBar\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    const renderSrc = js.match(/function renderHeaderUsageWindow\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    assert.ok(
      usageBarClassSrc.length > 50 && cycleDaySrc.length > 30 && fmtResetsSrc.length > 30
        && winState.length > 10 && cacheState.length > 10 && findWinSrc.length > 20
        && setSrc.length > 20 && render5hSrc.length > 30 && render7dSrc.length > 30 && renderSrc.length > 50,
      "usage bar state + functions extracted",
    );

    const combined = [usageBarClassSrc, cycleDaySrc, fmtResetsSrc, winState, cacheState, findWinSrc, setSrc, render5hSrc, render7dSrc, renderSrc].join("\n");
    const factory = new Function(
      "document",
      `${combined}\nreturn { setHeaderUsageWindow, renderHeaderUsageWindow, seed: function (w) { _lastClaudeWins = w; } };`,
    ) as (doc: unknown) => {
      setHeaderUsageWindow: (w: string) => void;
      renderHeaderUsageWindow: () => void;
      seed: (wins: unknown) => void;
    };

    function makeToggleBtn(w: string) {
      const classList = { on: false, toggle: (_cls: string, v: boolean) => { classList.on = v; } };
      return { dataset: { w }, classList };
    }
    function makeTick(day: number) {
      return { dataset: { day: String(day) }, className: "usage-bar-day" };
    }
    const toggleButtons = [makeToggleBtn("5h"), makeToggleBtn("7d")];
    const ticks = Array.from({ length: 7 }, (_, i) => makeTick(i + 1));
    const els: Record<string, any> = {
      usageWinReadout: { textContent: "", className: "muted" },
      usageBar5hFill: { style: { width: "" }, className: "" },
      usageBtn5h: { title: "" },
      usageBtn7d: { title: "" },
      usageBar7d: { querySelectorAll: (sel: string) => (sel === ".usage-bar-day" ? ticks : []) },
    };
    const doc = {
      getElementById: (id: string) => els[id],
      querySelectorAll: (sel: string) => (sel.indexOf("usageWinToggle") >= 0 ? toggleButtons : []),
    };
    const control = factory(doc);
    return { ...control, toggleButtons, ticks, els };
  }
  ```

- [ ] Add two new tests after it:

  ```ts
  test("7-day toggle button fills ticks up to the current cycle day, green when within the day-paced allowance", () => {
    const ub = consoleUsageBars();
    const now = Date.UTC(2026, 6, 1, 12, 0, 0);
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    const original = Date.now;
    Date.now = () => now;
    try {
      ub.seed([
        { label: "7-day", remaining: 72, utilization: 28, resetsAt: new Date(now + 5 * day + 5 * hour).toISOString(), durationMs: 604800000 },
      ]);
      ub.renderHeaderUsageWindow();
      const filled = ub.ticks.filter((t: { className: string }) => t.className.indexOf("filled") >= 0);
      assert.equal(filled.length, 2, "day 2 of 7 (reset in 5d 5h) fills exactly 2 ticks");
      assert.ok(filled.every((t: { className: string }) => t.className.indexOf(" ok") >= 0), "28% used on day 2 (allowance 28.6%) is within pace — filled ticks are ok/green");
      assert.equal(ub.els.usageBtn7d.title, "Day 2 of 7 · 72% left · resets in 5d 5h", "tooltip states day progress + exact time");
    } finally {
      Date.now = original;
    }
  });

  test("7-day ticks turn red when utilization exceeds the current day's allowance, tick count unchanged", () => {
    const ub = consoleUsageBars();
    const now = Date.UTC(2026, 6, 1, 12, 0, 0);
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    const original = Date.now;
    Date.now = () => now;
    try {
      ub.seed([
        { label: "7-day", remaining: 71, utilization: 29, resetsAt: new Date(now + 5 * day + 5 * hour).toISOString(), durationMs: 604800000 },
      ]);
      ub.renderHeaderUsageWindow();
      const filled = ub.ticks.filter((t: { className: string }) => t.className.indexOf("filled") >= 0);
      assert.equal(filled.length, 2, "still day 2 — tick count reflects elapsed days, not usage");
      assert.ok(filled.every((t: { className: string }) => t.className.indexOf(" hi") >= 0), "29% used on day 2 exceeds the 28.6% allowance — filled ticks turn hi/red");
    } finally {
      Date.now = original;
    }
  });

  test("7-day ticks clear when there is no 7-day window in the cached data", () => {
    const ub = consoleUsageBars();
    ub.seed([{ label: "5-hour", remaining: 50, utilization: 50, resetsAt: new Date(Date.now() + 3600000).toISOString(), durationMs: 18000000 }]);
    ub.renderHeaderUsageWindow();
    assert.ok(ub.ticks.every((t: { className: string }) => t.className === "usage-bar-day"), "no filled ticks without 7-day data");
    assert.equal(ub.els.usageBtn7d.title, "");
  });
  ```

  Run `npm test`, confirm all three fail RED.

- [ ] In `console.ts`, add 7-day tick CSS. Find the block added in Task B:

  ```
    .usage-win-bars button { display: inline-flex; align-items: center; gap: 4px; }
    .usage-win-bars .usage-bar-wrap { margin: 0; }
    .usage-win-bars .usage-bar { width: 26px; flex: none; }
  ```

  and add immediately after it:

  ```
    .usage-bar-days { display: inline-flex; align-items: center; }
    .usage-bar-day { display: inline-block; width: 3px; height: 6px; border-radius: 1px; background: var(--border); margin-right: 1px; }
    .usage-bar-day:last-child { margin-right: 0; }
    .usage-bar-day.filled.ok { background: var(--ok, #4caf50); }
    .usage-bar-day.filled.hi { background: #e05b2c; }
  ```

- [ ] In `console.ts`, update the header markup (the 7-day button only — the 5-hour
  button from Task B is unchanged). Find:

  ```html
        <button data-w="7d" onclick="setHeaderUsageWindow('7d')">7 day</button>
  ```

  replace with:

  ```html
        <button data-w="7d" id="usageBtn7d" onclick="setHeaderUsageWindow('7d')">7d<span class="usage-bar-wrap"><span class="usage-bar-days" id="usageBar7d"><span class="usage-bar-day" data-day="1"></span><span class="usage-bar-day" data-day="2"></span><span class="usage-bar-day" data-day="3"></span><span class="usage-bar-day" data-day="4"></span><span class="usage-bar-day" data-day="5"></span><span class="usage-bar-day" data-day="6"></span><span class="usage-bar-day" data-day="7"></span></span></span></button>
  ```

- [ ] In `console.ts`, add `renderUsage7dBar` and wire it into `renderHeaderUsageWindow`.
  Find:

  ```js
  function renderHeaderUsageWindow() {
    document.querySelectorAll("#usageWinToggle button").forEach(function (b) { b.classList.toggle("on", b.dataset.w === _headerUsageWin); });
    renderUsage5hBar();
    const el = document.getElementById("usageWinReadout");
  ```

  replace with:

  ```js
  function renderUsage7dBar() {
    const track = document.getElementById("usageBar7d");
    const btn = document.getElementById("usageBtn7d");
    const win = findUsageWin("7-day");
    const ticks = track ? track.querySelectorAll(".usage-bar-day") : [];
    if (!win) {
      ticks.forEach(function (t) { t.className = "usage-bar-day"; });
      if (btn) btn.title = "";
      return;
    }
    const cycleDay = sevenDayCycleDay(win.resetsAt) || 7;
    const cls = usageBarClass(win.utilization, win.resetsAt, win.durationMs || 0);
    ticks.forEach(function (t) {
      const day = Number(t.dataset.day);
      t.className = "usage-bar-day" + (day <= cycleDay ? " filled " + cls : "");
    });
    if (btn) btn.title = "Day " + cycleDay + " of 7 · " + Math.max(0, Math.min(100, win.remaining)).toFixed(0) + "% left · resets " + fmtResets(win.resetsAt);
  }

  function renderHeaderUsageWindow() {
    document.querySelectorAll("#usageWinToggle button").forEach(function (b) { b.classList.toggle("on", b.dataset.w === _headerUsageWin); });
    renderUsage5hBar();
    renderUsage7dBar();
    const el = document.getElementById("usageWinReadout");
  ```

- [ ] Run `npm test` — confirm every test in `console.test.ts` is GREEN (full suite,
  not just the new tests — this is the last task touching this area).
- [ ] `npm run typecheck` clean, `node scripts/scope-wall.mjs` clean.

---

## Finishing

- [ ] Full verification gate: `npm run typecheck`, `npm test`,
  `node scripts/scope-wall.mjs`.
- [ ] Manual sanity read: open the diff for `console.ts`'s header markup + CSS block
  and confirm it reads as one coherent feature, not three disjoint patches (the three
  tasks above intentionally leave small connective tissue like `usage-win-bars` and
  `usageWinReadout` untouched across all three — verify nothing was left half-renamed).
- [ ] Commit to `main` directly (normal for this loop per
  `project-hivematrix-self-improvement-loop` memory) — small, well-tested diff. Do NOT
  run any release script/skill. Leave the commit unpushed (ahead of origin), consistent
  with precedent (`92856f1b`, `909b1939`) — the operator pushes + releases together.
- [ ] Check `~/_GD/brain/projects/hive/known-issues.md` for anything this resolves
  before updating it — this was a fresh UI enhancement ask, likely nothing to close.
