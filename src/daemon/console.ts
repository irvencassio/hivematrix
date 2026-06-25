/**
 * HiveMatrix console — the centered operator shell, served by the daemon.
 *
 * Layout (per the plan): board left · session center · context/brain right.
 * A single self-contained HTML document (no build step) that talks to the
 * daemon's REST + SSE API on the same origin. This is the v1 shell; it is
 * structured to migrate to a Next.js app or be wrapped by Tauri later — the
 * data contract is the daemon API, not this file.
 */

export const CONSOLE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>HiveMatrix</title>
<script defer src="/assets/mermaid.min.js"></script>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --panel-2: #1c2230; --border: #2d333b;
    --text: #e6edf3; --muted: #8b949e; --accent: #d9a441; --accent-2: #58a6ff;
    --ok: #3fb950; --warn: #d29922; --err: #f85149;
    --code-bg: #0a0d12; --code-text: #e6edf3;
    --badge-bg: #21262d; --badge-text: #8b949e;
    --overlay-bg: rgba(0,0,0,.55);
    --reply-q-bg: rgba(88,166,255,.08);
    --hover-bg: rgba(255,255,255,.06);
    --card-shadow: none;
    --create-btn-text: #1a1a1a;
    --errbox-bg: rgba(248,81,73,.08);
  }
  html[data-theme="light"] {
    --bg: #f6f8fa; --panel: #ffffff; --panel-2: #f0f3f6; --border: #d0d7de;
    --text: #1f2328; --muted: #57606a; --accent: #9a6700; --accent-2: #0969da;
    --ok: #1a7f37; --warn: #9a6700; --err: #cf222e;
    --code-bg: #e8ecf1; --code-text: #1f2328;
    --badge-bg: #e8ecf1; --badge-text: #57606a;
    --overlay-bg: rgba(0,0,0,.25);
    --reply-q-bg: rgba(9,105,218,.08);
    --hover-bg: rgba(0,0,0,.04);
    --card-shadow: 0 1px 3px rgba(0,0,0,.06);
    --create-btn-text: #fff;
    --errbox-bg: rgba(207,34,46,.06);
  }
  /* Matrix: deep green-black palette with neon-green accents, behind an animated code-rain canvas. */
  html[data-theme="matrix"] {
    --bg: #010a05; --panel: #04140b; --panel-2: #0a2113; --border: #1d5a32;
    --text: #b9ffce; --muted: #57b074; --accent: #39ff7e; --accent-2: #6effa3;
    --ok: #39ff7e; --warn: #d2e022; --err: #ff5d6c;
    --code-bg: #03100a; --code-text: #b9ffce;
    --badge-bg: #0c2416; --badge-text: #57b074;
    --overlay-bg: rgba(0,10,4,.7);
    --reply-q-bg: rgba(57,255,126,.08);
    --hover-bg: rgba(57,255,126,.08);
    --card-shadow: 0 0 12px rgba(57,255,126,.07);
    --create-btn-text: #02160a;
    --errbox-bg: rgba(255,93,108,.1);
  }
  /* Code-rain canvas sits behind all content; only shown in the Matrix theme. */
  #matrixRain { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 0; pointer-events: none; display: none; }
  html[data-theme="matrix"] #matrixRain { display: block; }
  html[data-theme="matrix"] header, html[data-theme="matrix"] main { position: relative; z-index: 1; }
  /* Wallpaper / Matrix: panels go translucent so the backdrop shows through; text stays readable. */
  html[data-wallpaper="1"] body { background-size: cover; background-position: center; background-attachment: fixed; }
  html[data-wallpaper="1"] .col, html[data-wallpaper="1"] header,
  html[data-theme="matrix"] .col, html[data-theme="matrix"] header { background-color: color-mix(in srgb, var(--panel) var(--wp-opacity, 82%), transparent); backdrop-filter: blur(6px); }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 16px;
    background: var(--panel); border-bottom: 1px solid var(--border); height: 44px; }
  header .logo { font-weight: 700; color: var(--accent); letter-spacing: .5px; }
  header .mode { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600;
    border: 1px solid var(--border); background: var(--panel-2); }
  .pill.cloud-ok { color: var(--ok); border-color: var(--ok); }
  .pill.local-only { color: var(--warn); border-color: var(--warn); }
  .pill.offline { color: var(--err); border-color: var(--err); }
  select { background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 3px 8px; font-size: 11px; }
  main { display: grid; grid-template-columns: 300px 1fr 320px; height: calc(100vh - 44px); }
  .col { overflow-y: auto; padding: 12px; }
  .col.board { border-right: 1px solid var(--border); }
  .col.context { border-left: 1px solid var(--border); background: var(--panel); }
  main.ctx-collapsed { grid-template-columns: 300px 1fr; }
  main.ctx-collapsed .col.context { display: none; }
  /* Tablet / mid-size window: narrow the side rails so the center keeps usable
     width (the ◨ context toggle still reclaims it entirely). */
  @media (min-width: 761px) and (max-width: 1080px) {
    main { grid-template-columns: 240px 1fr 280px; }
    main.ctx-collapsed { grid-template-columns: 240px 1fr; }
  }
  /* Narrow screens (remote / iOS webview / small window): stack the three columns
     into one document-flow column instead of crushing the center. */
  @media (max-width: 760px) {
    body { height: auto; overflow: auto; }
    main, main.ctx-collapsed { grid-template-columns: 1fr; height: auto; }
    .col { height: auto; max-height: none; }
    .col.board { border-right: 0; border-bottom: 1px solid var(--border); }
    .col.context { border-left: 0; border-top: 1px solid var(--border); }
    .session { min-height: 180px; }
  }
  .ctx-sec { margin: 0; }
  .ctx-sec > summary { cursor: pointer; list-style: none; font-size: 14px; font-weight: 600; margin: 20px 0 6px; color: var(--text); }
  .ctx-sec > summary::-webkit-details-marker { display: none; }
  .ctx-sec > summary::before { content: '▾ '; color: var(--muted); }
  .ctx-sec:not([open]) > summary::before { content: '▸ '; }
  .mdl-grp { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 12px 0 4px; }
  .mdl-grp:first-child { margin-top: 2px; }
  .appr-wrap { margin: 0 0 6px; }
  .appr-head { font-size: 14px; font-weight: 700; margin: 4px 0 8px; color: var(--accent); display: flex; align-items: center; gap: 7px; }
  .appr-head .cnt { background: var(--accent); color: #1a1205; border-radius: 11px; padding: 0 7px; font-size: 11px; font-weight: 700; }
  .appr-item { border: 1px solid var(--accent); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; background: rgba(255,182,39,.06); }
  .appr-item .ak { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--accent); font-weight: 700; }
  .appr-item .at { font-size: 13px; font-weight: 600; margin: 2px 0; word-break: break-word; }
  .appr-item .ad { font-size: 11.5px; color: var(--muted); margin: 2px 0 8px; max-height: 64px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  .appr-item .arow { display: flex; flex-wrap: wrap; gap: 6px; }
  .appr-btn { border: 1px solid var(--border); border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; background: var(--panel-2); color: var(--text); }
  .appr-btn:hover { border-color: var(--accent); }
  .appr-btn.yes { background: var(--ok); color: #06281a; border-color: var(--ok); font-weight: 600; }
  .appr-btn.no { color: var(--accent-2); }
  .appr-btn[disabled] { opacity: .5; cursor: default; }
  .ctx-toggle.on { color: var(--accent); }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted);
    margin: 4px 0 10px; }
  .addbtn { width: 100%; text-align: left; background: var(--panel-2); color: var(--accent);
    border: 1px dashed var(--border); border-radius: 8px; padding: 7px 10px; cursor: pointer;
    font-size: 12px; font-weight: 600; margin-bottom: 10px; }
  .addbtn:hover { border-color: var(--accent); }
  .form { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px; margin-bottom: 12px; display: none; }
  .form.open { display: block; }
  .form input, .form textarea { width: 100%; box-sizing: border-box; background: var(--bg);
    color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
    font-size: 12px; margin-bottom: 6px; font-family: inherit; }
  .form textarea { resize: vertical; min-height: 48px; }
  .form .row { display: flex; gap: 6px; }
  .form button.create { background: var(--accent); color: var(--create-btn-text); border: 0; border-radius: 6px;
    padding: 6px 14px; font-weight: 700; cursor: pointer; font-size: 12px; }
  .form button.cancel { background: var(--panel-2); color: var(--muted); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
  .form button.cancel:hover { border-color: var(--text); color: var(--text); }
  .form .err { color: var(--err); font-size: 11px; margin-top: 4px; }
  .form select { width: 100%; margin-bottom: 6px; }
  .flbl { display: block; font-size: 10px; color: var(--muted); text-transform: uppercase;
    letter-spacing: .5px; margin: 2px 0 3px; }
  .gear { cursor: pointer; color: var(--muted); font-size: 16px; background: none; border: 0; }
  .gear:hover { color: var(--accent); }
  /* Header zones: brand · scope · actions, grouped + responsive */
  .hzone { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .hgroup { display: flex; align-items: center; gap: 6px; padding: 2px 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2); }
  .hsep { width: 1px; align-self: stretch; background: var(--border); margin: 5px 2px; }
  @media (max-width: 760px) {
    header { flex-wrap: wrap; height: auto; padding: 6px 10px; row-gap: 6px; }
    .hlabel { display: none; }
    header .mode, .hzone { flex-wrap: wrap; }
  }
  /* Toast (consistent save feedback) */
  #toastHost { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 60; display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
  .toast { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; padding: 7px 14px; font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.25); opacity: 0; transform: translateY(8px); transition: opacity .18s, transform .18s; }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.ok { border-left-color: var(--ok); } .toast.err { border-left-color: var(--err); }
  /* Center overview — shown when no task is selected (replaces the bare empty state) */
  .overview { max-width: 540px; margin: 28px auto 0; padding: 0 12px; }
  .ov-head { font-size: 13px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 12px; }
  .ov-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; }
  .ov-card { border: 1px solid var(--border); border-radius: 10px; background: var(--panel-2); padding: 12px 8px; text-align: center; }
  .ov-card.warn { border-color: color-mix(in srgb, var(--warn) 50%, var(--border)); }
  .ov-num { font-size: 22px; font-weight: 700; line-height: 1; }
  .ov-lbl { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .ov-hint { color: var(--muted); font-size: 12px; text-align: center; margin-top: 20px; }
  .usage-pill { background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 999px; padding: 3px 11px; font-size: 11px; font-weight: 600; white-space: nowrap; cursor: default; }
  .usage-breakdown { font-size: 11px; }
  .usage-breakdown .urow { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .usage-breakdown .urow .um { color: var(--muted); }
  .usage-breakdown .usep { border-top: 1px solid var(--border); margin: 5px 0 3px; }
  .usage-bar-wrap { display: flex; align-items: center; gap: 6px; margin: 2px 0 4px; }
  .usage-bar { height: 6px; border-radius: 3px; background: var(--border); flex: 1; overflow: hidden; }
  .usage-bar-fill { height: 100%; border-radius: 3px; transition: width .3s; }
  .usage-bar-fill.ok  { background: var(--ok,  #4caf50); }
  .usage-bar-fill.warn { background: #f0a500; }
  .usage-bar-fill.hi  { background: #e05b2c; }
  .usage-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:20px; }
  .usage-head h2 { margin:0 0 10px; }
  .obs-split { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:8px; }
  .obs-split .opill { font-size:11px; padding:2px 8px; border-radius:20px; border:1px solid var(--border); background:var(--panel-2); color:var(--muted); }
  .obs-split .opill.local { color:var(--ok); border-color:rgba(54,211,153,.4); }
  .obs-tbl { width:100%; border-collapse:collapse; font-size:11.5px; }
  .obs-tbl th { text-align:left; color:var(--muted); font-weight:600; padding:3px 6px; border-bottom:1px solid var(--border); }
  .obs-tbl td { padding:3px 6px; border-bottom:1px solid var(--border); }
  .obs-strip { display:flex; flex-wrap:wrap; gap:14px; margin:8px 0 4px; padding:8px 10px; background:var(--panel-2); border:1px solid var(--border); border-radius:8px; }
  .obs-cell { display:flex; flex-direction:column; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .obs-cell b { font-size:13px; color:var(--text); text-transform:none; letter-spacing:0; }
  .exec-panel { margin:10px 0 10px; border:1px solid var(--border); border-radius:8px; overflow:hidden; background:var(--panel-2); }
  .exec-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-bottom:1px solid var(--border); }
  .exec-title { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:700; }
  .exec-provider { font-size:11px; color:var(--accent-2); border:1px solid color-mix(in srgb, var(--accent-2) 45%, var(--border)); border-radius:999px; padding:1px 8px; background:color-mix(in srgb, var(--accent-2) 10%, transparent); }
  .exec-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--border); }
  .exec-cell { min-width:0; padding:7px 9px; background:var(--panel); }
  .exec-cell .ek { display:block; font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin-bottom:1px; }
  .exec-cell .ev { display:block; color:var(--text); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .exec-cell.wide { grid-column:1 / -1; }
  /* Observability dashboard (Settings tab) */
  .obs-win { display:inline-flex; border:1px solid var(--border); border-radius:7px; overflow:hidden; }
  .obs-win button { border:0; background:var(--panel-2); color:var(--muted); font-size:11px; padding:3px 9px; cursor:pointer; }
  .obs-win button + button { border-left:1px solid var(--border); }
  .obs-win button.on { background:var(--accent-2); color:#fff; }
  .obs-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px; margin:4px 0 14px; }
  .obs-kpi { border:1px solid var(--border); border-radius:8px; padding:9px 11px; background:var(--panel-2); }
  .obs-kpi .v { font-size:18px; font-weight:700; color:var(--text); }
  .obs-kpi .l { font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-top:1px; }
  .obs-chart { border:1px solid var(--border); border-radius:8px; padding:10px 12px; background:var(--panel-2); margin-bottom:12px; }
  .obs-chart h4 { margin:0 0 2px; font-size:12px; color:var(--text); font-weight:600; }
  .obs-chart .sub { font-size:10px; color:var(--muted); margin-bottom:8px; }
  .obs-chart svg { width:100%; height:auto; display:block; }
  .obs-legend { display:flex; flex-wrap:wrap; gap:12px; margin-top:8px; font-size:11px; color:var(--muted); }
  .obs-legend span { display:inline-flex; align-items:center; gap:5px; }
  .obs-legend i { width:10px; height:10px; border-radius:2px; display:inline-block; }
  .obs-cacherow { display:grid; grid-template-columns:84px 1fr auto; align-items:center; gap:10px; padding:7px 0; border-top:1px solid var(--border); font-size:12px; }
  .obs-cacherow:first-child { border-top:0; }
  .obs-cacherow .cprov { font-weight:600; color:var(--text); }
  .obs-cacherow .cbar { height:8px; border-radius:4px; background:var(--border); overflow:hidden; }
  .obs-cacherow .cbar > i { display:block; height:100%; border-radius:4px; }
  .obs-cacherow .cnum { font-size:11px; color:var(--muted); white-space:nowrap; }
  /* Command meta chips + inspect/run controls (reused by the unified detail panel) */
  .command-chip { min-width:0; max-width:100%; display:inline-block; border:1px solid var(--border); background:var(--panel); color:var(--muted); border-radius:999px; padding:2px 7px; font-size:10.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .command-chip.primary { color:var(--accent-2); border-color:color-mix(in srgb, var(--accent-2) 42%, var(--border)); }
  .command-run { background:var(--accent); color:var(--create-btn-text); border:0; flex:1; }
  .command-view { display:none; max-height:200px; overflow:auto; font-size:11px; background:var(--code-bg); color:var(--code-text); padding:8px; border-radius:6px; margin:0 10px 10px; white-space:pre-wrap; }
  /* Unified Skills & Commands section */
  .sk-toolbar { display:flex; gap:6px; align-items:center; margin-bottom:6px; }
  .sk-toolbar input { flex:1; min-width:80px; margin:0; }
  .sk-toolbar .addbtn { width:auto; flex:none; margin-bottom:0; white-space:nowrap; }
  .sk-list { max-height:230px; overflow:auto; border:1px solid var(--border); border-radius:8px; background:var(--panel-2); }
  .sk-list:empty { display:none; }
  .sk-row { padding:6px 8px; border-bottom:1px solid var(--border); cursor:pointer; }
  .sk-row:last-child { border-bottom:0; }
  .sk-row:hover { background:var(--panel); }
  .sk-row.sel { background:color-mix(in srgb, var(--accent) 16%, var(--panel-2)); }
  .sk-row b { font-size:12px; }
  .sk-row .sk-desc { color:var(--muted); font-size:11px; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sk-badge { display:inline-block; font-size:10px; color:var(--muted); border:1px solid var(--border); border-radius:999px; padding:0 5px; margin-left:4px; white-space:nowrap; }
  .sk-badge.src { color:var(--accent-2); border-color:color-mix(in srgb, var(--accent-2) 42%, var(--border)); }
  .sk-badge.warn { color:var(--warn); border-color:color-mix(in srgb, var(--warn) 45%, var(--border)); }
  .sk-badge.err { color:var(--err); border-color:color-mix(in srgb, var(--err) 45%, var(--border)); }
  .sk-detail { margin-top:8px; border:1px solid var(--border); border-radius:8px; background:var(--panel-2); padding:9px 10px; }
  .sk-detail .sk-dmeta { font-size:11px; color:var(--muted); margin:4px 0; }
  .sk-detail input, .sk-detail select { margin:0; }
  .sk-detail .sk-run-row { display:flex; gap:6px; margin-top:8px; }
  .sk-detail .sk-run-row .create, .sk-detail .sk-run-row .command-run { flex:1; }
  .sk-proj-row { display:grid; grid-template-columns:minmax(86px,.72fr) minmax(0,1.28fr); gap:6px; margin-top:6px; }
  .sk-more { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; padding-top:8px; border-top:1px solid var(--border); }
  .sk-more button { font-size:11px; }
  /* The .addbtn default is full-width; keep it inline inside skill controls/rows. */
  .sk-run-row .addbtn, .sk-more .addbtn, #addShared .addbtn, #skPrune .addbtn, #addSkillOverlay .addbtn { width:auto; flex:none; margin-bottom:0; }
  .sk-tabs { display:flex; gap:4px; margin-bottom:10px; }
  .sk-tab { flex:1; text-align:center; padding:6px 4px; font-size:12px; border:1px solid var(--border); border-radius:6px; cursor:pointer; color:var(--muted); }
  .sk-tab.active { color:var(--accent-2); border-color:color-mix(in srgb, var(--accent-2) 45%, var(--border)); background:var(--panel); }
  .linklike { background:none; border:0; color:var(--muted); text-decoration:underline; cursor:pointer; font-size:11px; padding:0; }
  .usage-refresh { border:1px solid var(--border); background:var(--panel-2); color:var(--muted);
    width:24px; height:24px; border-radius:6px; cursor:pointer; line-height:1; font-size:13px; }
  .usage-refresh:hover { color:var(--text); border-color:var(--text); }
  .usage-refresh[disabled] { opacity:.45; cursor:default; }
  .usage-action { border:1px solid var(--border); background:var(--panel-2); color:var(--text);
    border-radius:6px; cursor:pointer; font-size:11px; padding:4px 8px; margin-top:6px; }
  .usage-action:hover { border-color:var(--accent-2); }
  .usage-action[disabled] { opacity:.45; cursor:default; }
  .update-pill { cursor: pointer; background: var(--accent); color: var(--create-btn-text, #1a1a1a);
    border-radius: 999px; padding: 3px 11px; font-size: 11px; font-weight: 700; white-space: nowrap;
    animation: updatePulse 2s ease-in-out infinite; }
  .update-pill:hover { filter: brightness(1.08); }
  @keyframes updatePulse { 0%,100% { opacity: 1; } 50% { opacity: .72; } }
  .overlay { position: fixed; inset: 0; background: var(--overlay-bg); display: none;
    align-items: center; justify-content: center; z-index: 50; }
  .overlay.open { display: flex; }
  .modal { width: 640px; max-width: 92vw; max-height: 84vh; overflow-y: auto; background: var(--panel);
    border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .modal h1 { font-size: 16px; margin: 0 0 14px; display: flex; align-items: center; }
  .modal h1 .x { margin-left: auto; cursor: pointer; color: var(--muted); font-weight: 400; }
  /* Generic in-DOM dialogs (the Tauri/WKWebView webview has no native alert/confirm/prompt). */
  .modal.dialog { width: 420px; }
  .dialog-msg { font-size: 13px; line-height: 1.5; white-space: pre-wrap; margin-bottom: 12px; }
  .dialog-input { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 13px; margin-bottom: 12px; font-family: inherit; }
  .dialog-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .dialog-actions button { border-radius: 6px; padding: 7px 16px; font-size: 12px; cursor: pointer; font-weight: 600; }
  .dialog-actions .ok { background: var(--accent); color: var(--create-btn-text); border: 0; }
  .dialog-actions .ok.danger { background: var(--err); color: #fff; }
  .dialog-actions .cancel { background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); }
  .dialog-actions .cancel:hover { border-color: var(--text); color: var(--text); }
  /* Message Lane guided setup */
  .mb-step { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .mb-step .mb-mark { font-size: 13px; line-height: 1.4; }
  .mb-step .mb-mark.ok { color: var(--ok); } .mb-step .mb-mark.no { color: var(--err); }
  .mb-step .mb-body { flex: 1; }
  .mb-step .mb-body .t { font-weight: 600; margin-bottom: 2px; }
  .mb-step button { margin-top: 5px; font-size: 11px; padding: 3px 10px; border-radius: 6px; cursor: pointer;
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  .mb-chip { display: inline-block; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px;
    padding: 1px 9px; margin: 2px 4px 2px 0; font-size: 11px; }
  .mb-ignored-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 11px; }
  .ss-section { margin-top:12px; }
  .ss-section-hd { font-weight:600; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
  .ss-chip { display:inline-flex; align-items:center; background:var(--panel-2); border:1px solid var(--border); border-radius:12px; padding:1px 6px 1px 9px; margin:2px 4px 2px 0; font-size:11px; gap:3px; }
  .ss-chip .x { cursor:pointer; color:var(--muted); font-size:10px; line-height:1; }
  .ss-chip .x:hover { color:var(--err); }
  .mb-ignored-row .mb-ig-addr { font-weight: 600; }
  .mb-ignored-row .mb-ig-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: italic; }
  .mb-ignored-row button { font-size: 10px; padding: 2px 9px; border-radius: 6px; cursor: pointer;
    background: var(--accent); color: var(--create-btn-text, #1a1a1a); border: 0; font-weight: 700; }
  .tabs { display: flex; gap: 6px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
  .tab { padding: 6px 12px; cursor: pointer; font-size: 12px; color: var(--muted); border-bottom: 2px solid transparent; }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .backend { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .backend .nm { font-weight: 600; min-width: 150px; }
  .backend .st { font-size: 11px; }
  .backend .st.ok { color: var(--ok); } .backend .st.no { color: var(--muted); }
  .vinfo { font-size: 11px; color: var(--muted); margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
  .lane { margin-bottom: 16px; }
  .lane-title { font-size: 11px; color: var(--muted); margin-bottom: 6px; display: flex; gap: 6px; }
  .lane-title .count { color: var(--accent); }
  .card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: border-color .1s; position: relative;
    box-shadow: var(--card-shadow); }
  .card:hover { border-color: var(--accent-2); }
  .card.sel { border-color: var(--accent); }
  .card .t { font-weight: 600; margin-bottom: 2px; padding-right: 22px; }
  .card .m { font-size: 11px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; }
  .card .card-archive { position: absolute; top: 6px; right: 8px; font-size: 13px; line-height: 1;
    color: var(--muted); background: none; border: none; cursor: pointer; padding: 2px 4px;
    border-radius: 4px; opacity: 0; transition: opacity .1s; }
  .card:hover .card-archive { opacity: 1; }
  .card .card-archive:hover { color: var(--accent-2); background: var(--border); }
  .attach-row { display: flex; align-items: center; gap: 6px; }
  .attach-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .attach-chip { display: flex; align-items: center; gap: 4px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 4px; padding: 2px 6px; font-size: 11px; max-width: 260px; overflow: hidden; }
  .attach-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attach-chip .rm { cursor: pointer; color: var(--muted); font-size: 14px; flex-shrink: 0; }
  .attach-chip .rm:hover { color: var(--err); }
  .attach-clear { border: 0; background: none; color: var(--accent-2); padding: 0; margin-left: 6px; font: inherit; cursor: pointer; }
  .attach-clear:hover { text-decoration: underline; }
  .badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--badge-bg); color: var(--badge-text); }
  .badge.model { color: var(--accent-2); }
  .badge.age { opacity: .7; background: transparent; padding-left: 0; }
  .session-empty { color: var(--muted); text-align: center; margin-top: 40px; }
  .session h1 { font-size: 18px; margin: 0 0 4px; }
  .session .sub { color: var(--muted); margin-bottom: 16px; }
  .kv { display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px; margin-bottom: 16px; }
  .kv .k { color: var(--muted); }
  .desc, .journal { background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; white-space: pre-wrap; margin-bottom: 16px; }
  .journal .step { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--border); }
  .journal .step:last-child { border: 0; }
  .journal .s { color: var(--accent); min-width: 110px; font-weight: 600; }
  .directive { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; margin-bottom: 6px; }
  .directive .g { font-weight: 600; margin-bottom: 3px; }
  .directive .s { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .directive .directive-actions { margin-left: auto; display: flex; gap: 4px; }
  .sm { font-size: 10px; padding: 2px 7px; border-radius: 4px; border: 1px solid var(--border);
    background: var(--panel-2); color: var(--muted); cursor: pointer; }
  .sm:hover { border-color: var(--accent-2); color: var(--text); }
  .sm.err:hover { border-color: var(--err); color: var(--err); }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
  .dot.active { background: var(--ok); } .dot.done { background: var(--accent-2); }
  .dot.sleeping { background: var(--muted); } .dot.blocked, .dot.failed { background: var(--err); }
  .muted { color: var(--muted); }
  .live { font-size: 10px; color: var(--ok); }
  .live.stale { color: var(--err); }
  .archive-link { font-size: 11px; color: var(--accent-2); cursor: pointer; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .archive-link:hover { text-decoration: underline; }
  .actions { display: flex; gap: 6px; margin: 10px 0 16px; flex-wrap: wrap; }
  .actions button { background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 5px 12px; font-size: 11px; cursor: pointer; }
  .actions button:hover { border-color: var(--accent-2); }
  .actions button.danger:hover { border-color: var(--err); color: var(--err); }
  .reply-question { background: var(--reply-q-bg); border: 1px solid var(--accent-2); border-radius: 6px;
    padding: 8px 12px; font-size: 12px; color: var(--text); margin-bottom: 8px; }
  .reply-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 16px; }
  .reply-input { flex: 1; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); font: 12px/1.4 inherit; padding: 6px 10px; resize: vertical; }
  .reply-input:focus { outline: none; border-color: var(--accent-2); }
  .reply-row button { background: var(--accent-2); color: #fff; border: none; border-radius: 6px;
    padding: 6px 14px; font-size: 11px; cursor: pointer; white-space: nowrap; }
  .reply-row button:hover { opacity: .85; }
  .reply-section { display: none; }
  .reply-section.open { display: block; }
  /* needs_input: the reply window stands out so a waiting question is unmissable. */
  .reply-section.needs { display: block; border: 1.5px solid var(--accent-2); border-radius: 10px;
    padding: 12px 14px; background: var(--reply-q-bg); margin: 14px 0; box-shadow: 0 0 0 3px rgba(76,201,240,.10); }
  .reply-head { font-size: 13px; font-weight: 700; color: var(--accent-2); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
  /* review/failed reply: present but understated — a thin left rule, no glow/card. */
  .reply-section.subtle.open { display: block; border-left: 2px solid var(--border); padding: 8px 0 8px 12px; margin: 12px 0; }
  .reply-subhead { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
  .reply-row button.reply-primary { font-size: 13px; font-weight: 600; padding: 8px 18px; }
  .reply-toggle.active { border-color: var(--accent-2) !important; color: var(--accent-2) !important; }
  .transcript { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    max-height: 240px; overflow-y: auto; font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; margin-bottom: 16px; color: var(--code-text); }
  .transcript .ln { padding: 1px 0; }
  .transcript .ln.error { color: var(--err); }
  .transcript .ln.tool { color: var(--accent); }
  .transcript .ln.text { color: var(--text); }
  .errbox { background: var(--errbox-bg); border: 1px solid var(--err); border-radius: 8px;
    padding: 10px; color: var(--err); white-space: pre-wrap; margin-bottom: 16px; font-size: 12px; }
  .md h1,.md h2,.md h3 { color: var(--text); margin: 8px 0 4px; }
  .md h1 { font-size: 16px; } .md h2 { font-size: 14px; } .md h3 { font-size: 13px; }
  .md code { background: var(--code-bg); padding: 1px 4px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; color: var(--code-text); }
  .md pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px; overflow-x: auto; color: var(--code-text); }
  .md a { color: var(--accent-2); } .md ul { margin: 4px 0; padding-left: 18px; }
  .md-table-wrap { overflow-x: auto; margin: 8px 0 10px; border: 1px solid var(--border); border-radius: 8px; }
  .md-table { width: 100%; border-collapse: collapse; min-width: 520px; background: var(--panel-2); white-space: normal; }
  .md-table th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; background: var(--panel); }
  .md-table th, .md-table td { text-align: left; vertical-align: top; padding: 7px 9px; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); }
  .md-table th:last-child, .md-table td:last-child { border-right: 0; }
  .md-table tr:last-child td { border-bottom: 0; }
  .md pre.mermaid { background: var(--panel-2); border-color: var(--border); color: var(--text); text-align: center; white-space: pre; }
  .md .mermaid svg { max-width: 100%; height: auto; }
  .md .mermaid-pending { color: var(--muted); }
  .md .mermaid-error { border-color: var(--err); color: var(--err); text-align: left; }
  .streaming { font-size: 10px; color: var(--ok); margin-left: 6px; }
  .remote-status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; margin-top: 8px; }
  .remote-status .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .remote-status .dot.on { background: var(--ok); } .remote-status .dot.off { background: var(--muted); } .remote-status .dot.err { background: var(--err); }
  .remote-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-top: 12px; background: var(--panel-2); }
  .remote-card-h { display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 13px; }
  .role-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .role-row .role-name { font-size: 12px; display: flex; flex-direction: column; gap: 1px; }
  .role-row .role-name .muted { font-size: 10px; font-weight: 400; }
  .role-row select { width: 190px; flex: none; }
  .copybtn { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px 12px; font-size: 11px; cursor: pointer; }
  .copybtn:hover { border-color: var(--accent); }
  .posture { margin-top: 10px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--panel-2); }
  .posture-summary { padding: 8px 10px; font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--border); }
  .posture-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--border); font-size: 11px; }
  .posture-row:last-child { border-bottom: none; }
  .posture-row .pname { font-weight: 600; color: var(--text); }
  .posture-row .pnote { grid-column: 1 / -1; color: var(--muted); line-height: 1.35; }
  .disp { border-radius: 999px; padding: 1px 7px; font-size: 10px; font-weight: 700; align-self: start; }
  .disp.works { color: var(--ok); background: rgba(37, 211, 102, .12); }
  .disp.degraded { color: var(--warn); background: rgba(249, 174, 66, .14); }
  .disp.queued { color: var(--err); background: rgba(255, 92, 122, .12); }
  #s_qr svg { width: 100%; height: 100%; }
  /* Project search dropdown */
  .project-search { position: relative; margin-bottom: 6px; }
  .project-search input { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 12px; font-family: inherit; }
  .project-search input:focus { outline: none; border-color: var(--accent); }
  .project-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    margin-top: 2px; max-height: 240px; overflow-y: auto; box-shadow: 0 8px 24px var(--overlay-bg); }
  .project-dropdown.hidden { display: none; }
  .project-sort-row { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .project-sort-btn { font-size: 10px; padding: 2px 8px; border-radius: 999px; cursor: pointer;
    color: var(--muted); background: var(--panel-2); border: 1px solid var(--border); user-select: none; }
  .project-sort-btn.active { color: var(--accent); border-color: var(--accent); }
  .project-list { max-height: 200px; overflow-y: auto; }
  .project-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer;
    font-size: 12px; border-bottom: 1px solid var(--border); }
  .project-item:last-child { border-bottom: none; }
  .project-item:hover, .project-item.selected { background: var(--hover-bg); }
  .project-item .pname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .project-item .pstar { color: var(--ok); font-size: 11px; }
  .project-item .ptime { font-size: 10px; color: var(--muted); }
  .project-empty { padding: 12px 10px; font-size: 11px; color: var(--muted); text-align: center; }
  .project-empty.hidden { display: none; }
</style>
</head>
<body>
<canvas id="matrixRain" aria-hidden="true"></canvas>
<header>
  <div class="hzone">
    <span class="logo">HiveMatrix</span>
    <span class="live" id="live">● live</span>
  </div>
  <div class="hzone">
    <span class="muted hlabel">project</span>
    <select id="projectSel" style="max-width:200px">
      <option value="">(all projects)</option>
    </select>
    <button class="gear" id="projectRescanBtn" title="Re-scan projects" onclick="refreshProjects()">↻</button>
  </div>
  <div class="hzone mode" style="margin-left:auto">
    <span class="hgroup" title="Connectivity — the select is your preference; the pill is the current effective mode (e.g. what (auto) resolved to)">
      <span class="muted hlabel">connectivity</span>
      <select id="modeSel">
        <option value="">(auto)</option>
        <option value="cloud-ok">cloud-ok</option>
        <option value="local-only">local-only</option>
        <option value="offline">offline</option>
      </select>
      <span class="pill" id="modePill">…</span>
    </span>
    <span class="usage-pill" id="localPill" style="display:none" title="">🧠 local</span>
    <span class="usage-pill" id="usagePill" style="display:none" title="">⚡ —</span>
    <span class="update-pill" id="updatePill" style="display:none" onclick="applyUpdate()" title="Click to install and restart">⬆ Update</span>
    <span class="hsep"></span>
    <span class="muted" id="talkStatus" style="display:none;font-size:11px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
    <button class="gear" id="talkBtn" style="display:none" title="Push to talk" onclick="toggleTalk()">🎤 Talk</button>
    <button class="gear" id="themeToggle" title="Toggle light / dark theme" onclick="toggleThemeQuick()">🌗</button>
    <button class="gear ctx-toggle" id="ctxToggle" title="Hide / show the right panel" onclick="toggleContext()">◨</button>
    <button class="gear" title="Settings" onclick="openSettings()">⚙</button>
  </div>
</header>
<div id="toastHost"></div>

<div class="overlay" id="settingsOverlay">
  <div class="modal">
    <h1>Settings <span class="x" onclick="closeSettings()">✕</span></h1>
    <div class="tabs"><div class="tab active" id="tab-about" onclick="switchSettingsTab('about')">About</div><div class="tab" id="tab-features" onclick="switchSettingsTab('features')">Features</div><div class="tab" id="tab-general" onclick="switchSettingsTab('general')">Personalization</div><div class="tab" id="tab-models" onclick="switchSettingsTab('models')">Models</div><div class="tab" id="tab-observability" onclick="switchSettingsTab('observability')">Observability</div><div class="tab" id="tab-lanes" onclick="switchSettingsTab('lanes')">Lanes</div><div class="tab" id="tab-remote" onclick="switchSettingsTab('remote')">Remote</div></div>
    <div id="settingsModels" style="display:none">
      <label class="flbl">Default model</label>
      <select id="s_default" style="width:100%" onchange="saveDefault()"></select>

      <label class="flbl" style="margin-top:14px">Backends</label>
      <div id="s_backends"></div>

      <div id="s_frontier_provider_row" style="display:none;margin-top:14px">
        <label class="flbl">Frontier provider (Mixed / Cloud-only)</label>
        <div class="row" style="align-items:center;gap:8px">
          <select id="s_frontier_provider" onchange="saveFrontierProvider()" style="width:auto">
            <option value="claude">Claude (Sonnet / Opus)</option>
            <option value="codex">Codex (GPT-5.5 / Spark)</option>
          </select>
        </div>
        <div class="muted" style="font-size:11px;margin-top:2px">Which provider handles the frontier tier in Mixed and Cloud-only modes.</div>
      </div>

      <div id="s_role_models" style="display:none;margin-top:16px">
        <label class="flbl">Mixed-mode role models</label>
        <div class="muted" style="font-size:11px;margin-bottom:8px">In Mixed mode each kind of work routes to its own model. Pick which one — or leave on Default.</div>
        <div id="s_role_frontier_rows">
          <div class="role-row"><span class="role-name">🧠 Thinking <span class="muted">planning · architecture · review</span></span>
            <select id="s_role_thinking" onchange="saveRoleModel('thinking', this.value)"></select></div>
          <div class="role-row"><span class="role-name">⌨️ Coding <span class="muted">critical implementation · UI</span></span>
            <select id="s_role_coding" onchange="saveRoleModel('coding', this.value)"></select></div>
        </div>
        <div class="role-row"><span class="role-name">⚙️ Operational <span class="muted">bulk execution · file ops (on-device)</span></span>
          <select id="s_role_operational" onchange="saveRoleModel('operational', this.value)"></select></div>
        <div class="role-row"><span class="role-name">✍️ Writer <span class="muted">video scripts · briefings · summaries · drafts</span></span>
          <select id="s_role_writer" onchange="saveRoleModel('writer', this.value)"></select></div>
      </div>

      <label class="flbl" style="margin-top:16px">Local server endpoint</label>
      <input id="s_endpoint" placeholder="http://localhost:1234/v1" style="width:100%" onchange="saveEndpoint()" />
    </div>
    <div id="settingsObservability" style="display:none">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:4px">
        <label class="flbl" style="margin:0">Observability</label>
        <div class="row" style="gap:6px;align-items:center">
          <span class="obs-win" id="obs_win">
            <button data-w="24h" onclick="setObsWindow('24h')">24h</button>
            <button data-w="7d" class="on" onclick="setObsWindow('7d')">7d</button>
            <button data-w="30d" onclick="setObsWindow('30d')">30d</button>
          </span>
          <button class="copybtn" onclick="renderObsDashboard()">↻ Refresh</button>
        </div>
      </div>
      <div class="muted" style="font-size:11px;margin-bottom:10px">Tokens, tasks, latency and prompt-cache across Claude, Codex (ChatGPT) and local Qwen. All on-device.</div>
      <div id="obsDash"><div class="muted">Loading…</div></div>
    </div>
    <div id="settingsRemote" style="display:none">
      <div class="remote-status"><span class="dot" id="s_remote_dot"></span><span id="s_remote_label">…</span></div>
      <div id="s_tunnel_detail" class="muted" style="font-size:11px;margin-top:4px"></div>
      <div class="muted" style="font-size:11px;margin-top:6px">Reach this daemon from your phone over a Cloudflare tunnel. Two ways to set it up:</div>

      <div class="remote-card">
        <div class="remote-card-h"><span>Temporary tunnel</span><span class="badge">quick test</span></div>
        <div class="muted" style="font-size:11px;margin:4px 0 8px">A throwaway <code>trycloudflare.com</code> URL — fastest way to pair once. Goes away when you stop it.</div>
        <button class="create" id="s_tunnel_btn" onclick="toggleTunnel()">Start temporary tunnel</button>
      </div>

      <div class="remote-card">
        <div class="remote-card-h"><span>Named tunnel</span><span class="badge">durable · multi-user</span></div>
        <div class="muted" style="font-size:11px;margin:4px 0 8px">A stable hostname you control — survives restarts and is right for ongoing / shared access.</div>
        <label class="flbl" style="margin-top:0">Public hostname</label>
        <div class="row"><input id="s_named_host" placeholder="hivey.cassio.io" style="flex:1" />
          <button class="copybtn" onclick="configureNamedTunnel()">Save / show QR</button></div>
        <div class="muted" style="font-size:11px;margin-top:4px">A stable Cloudflare hostname for one-time mobile pairing.</div>

        <label class="flbl" style="margin-top:8px">Cloudflare Access Client ID</label>
        <input id="s_cf_access_id" placeholder="optional service-token client id for mobile" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
        <label class="flbl" style="margin-top:6px">Cloudflare Access Client Secret</label>
        <div class="row"><input id="s_cf_access_secret" type="password" placeholder="optional service-token client secret" style="flex:1;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
          <button class="copybtn" onclick="saveCloudflareAccessCredentials()">Save Access</button></div>
        <div class="muted" id="s_cf_access_detail" style="font-size:11px;margin-top:4px">Only needed when Cloudflare Access protects the hostname for iOS/API calls.</div>

        <label class="flbl" style="margin-top:8px">Connector token</label>
        <input id="s_named_token" type="password" placeholder="optional — only if HiveMatrix should start cloudflared" style="width:100%" />
        <div class="row" style="margin-top:6px"><button class="copybtn" onclick="startNamedTunnel()">Run with token</button></div>
        <div class="muted" style="font-size:11px;margin-top:4px">Leave blank when an existing Cloudflare connector is already running.</div>
      </div>

      <div id="s_tunnel_live" style="display:none;margin-top:10px">
        <label class="flbl">Public URL</label>
        <div class="row"><input id="s_tunnel_url" readonly style="flex:1;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
          <button class="copybtn" onclick="copyField('s_tunnel_url')">Copy</button></div>
        <label class="flbl" style="margin-top:10px">Scan to pair (iPhone)</label>
        <div id="s_qr" style="background:#fff;border-radius:8px;padding:8px;width:188px;height:188px"></div>
        <div class="muted" style="font-size:11px;margin-top:4px">Open HiveMatrix on iPhone → Scan QR. Encodes the URL + token (generated locally).</div>
      </div>

      <label class="flbl" style="margin-top:14px">Access token (manual pairing)</label>
      <div class="row"><input id="s_token" readonly style="flex:1;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
        <button class="copybtn" onclick="copyField('s_token')">Copy</button></div>

      <div class="muted" style="font-size:11px;margin-top:10px">⚠ A tunnel exposes the daemon to the internet; the access token is the only barrier — treat it like a password. The console never hands the token to tunneled visitors.</div>
    </div>
    <div id="settingsGeneral" style="display:none">
      <label class="flbl">Appearance</label>
      <div class="row" style="align-items:center; gap:10px">
        <span class="muted">Theme</span>
        <select id="s_theme" onchange="saveTheme()" style="width:auto">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="matrix">Matrix</option>
        </select>
      </div>
      <div class="row" style="align-items:center; gap:10px; margin-top:8px">
        <span class="muted">App icon</span>
        <select id="s_app_icon" onchange="saveAppIconChoice()" style="width:auto">
          <option value="dark-green">Dark green</option>
          <option value="white">White</option>
        </select>
      </div>
      <div id="app_icon_status" class="muted" style="font-size:11px;margin-top:3px;min-height:16px"></div>
      <label class="flbl" style="margin-top:10px">Wallpaper</label>
      <div id="wallpaper_preview" style="display:none;margin-bottom:6px">
        <img id="wallpaper_preview_img" style="width:100%;max-height:160px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" />
      </div>
      <div class="row" style="gap:6px">
        <input type="file" id="s_wallpaper_file" accept="image/*" style="display:none" onchange="onWallpaperFileSelected(this)" />
        <button class="create" onclick="document.getElementById('s_wallpaper_file').click()">📁 Choose image</button>
        <input id="s_wallpaper" placeholder="Or type a path…" style="flex:1" />
        <button class="sm" onclick="saveWallpaperPath()">Set path</button>
        <button class="sm" onclick="clearWallpaper()">Clear</button>
      </div>
      <div id="wallpaper_status" style="font-size:11px;margin-top:4px;min-height:16px"></div>
      <div id="wallpaper_opacity_row" style="display:none;margin-top:8px">
        <label class="flbl">Panel translucency over wallpaper</label>
        <div class="row" style="align-items:center;gap:10px">
          <input type="range" id="s_wp_opacity" min="0" max="100" step="1" style="flex:1" oninput="onOpacityInput(this.value)" onchange="saveOpacity(this.value)" />
          <span class="muted" id="s_wp_opacity_val" style="min-width:42px;text-align:right">82%</span>
        </div>
        <div class="muted" style="font-size:11px">Lower = more wallpaper shows through the panels.</div>
      </div>

      <label class="flbl" style="margin-top:16px">Location</label>
      <div class="row" style="gap:6px">
        <input id="s_location" placeholder="e.g. Cincinnati, OH" style="flex:1" />
        <button class="sm" onclick="saveLocation()">Save</button>
      </div>
      <div class="muted" style="font-size:11px;margin-top:2px">Shared with location-aware tasks (weather, "near me", local time) — e.g. texts to Message Lane.</div>

      <label class="flbl" style="margin-top:16px">Updates</label>
      <div class="row" style="align-items:center;gap:8px">
        <input type="checkbox" id="s_autoupdate" onchange="saveAutoUpdate()" style="width:auto" />
        <span class="muted">Automatically install updates on launch</span>
      </div>
      <div class="muted" style="font-size:11px;margin-top:2px">Off = you'll see an "Update" button in the header to install when you choose.</div>
    </div>
    <div id="settingsFeatures" style="display:none">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Optional capabilities</label>
        <button class="copybtn" onclick="renderFeatures()">↻ Refresh</button>
      </div>
      <div class="muted" style="font-size:11px;margin:6px 0 10px">Off by default. Turn on only the advanced capabilities you want.</div>
      <div id="s_features"></div>
    </div>
    <div id="settingsAbout">
      <h2 style="margin-top:4px">HiveMatrix</h2>
      <div class="muted" style="font-size:12px;margin-bottom:12px">The autonomous business operator.</div>
      <div class="kv">
        <span class="k">version</span><span id="ab_version">…</span>
        <span class="k">build</span><span id="ab_build">…</span>
        <span class="k">released</span><span id="ab_date">…</span>
        <span class="k">update status</span><span id="ab_update">checking…</span>
      </div>
      <div class="row" style="margin-top:12px;gap:6px">
        <button class="create" onclick="checkUpdate(true)">↻ Check for updates</button>
        <button class="sm" id="ab_update_btn" style="display:none" onclick="applyUpdate()">⬆ Install update</button>
        <button class="sm" onclick="openReleases()">📝 Release notes</button>
      </div>
      <div class="vinfo" id="s_version">…</div>
      <label class="flbl" style="margin-top:18px">Setup</label>
      <div id="ab_setup" class="muted" style="font-size:12px">…</div>
      <label class="flbl" style="margin-top:18px">Soak / Health</label>
      <div id="metrics"></div>
    </div>
    <div id="settingsProjects" style="display:none">
      <div class="kv"><span class="k">discovered</span><span id="s_proj_count">…</span></div>
      <div id="s_projects"></div>
      <div class="row" style="margin-top:10px"><button class="create" onclick="refreshProjects()">↻ Re-scan</button></div>
      <div class="muted" style="font-size:11px;margin-top:8px">Projects discovered from git repos, Claude Code history, and VS Code recents. ★ = pre-selected (active project).</div>
    </div>
    <div id="settingsLanes" style="display:none">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Embedded capability lanes</label>
        <button class="copybtn" onclick="renderSettingsLanes()">↻ Refresh</button>
      </div>
      <div id="s_lanes" style="margin-top:8px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">COO Dispatch</label>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 8px">Route a request through your COO rules. Browser Lane is the canonical browser automation path; risky lanes (mail, message, desktop, terminal) return approval-required and never act here.</div>
      <textarea id="coo_text" rows="2" placeholder="Objective — e.g. Upload today's script on the site" style="width:100%;box-sizing:border-box"></textarea>
      <input id="coo_domains" placeholder="Target domain(s), comma-separated — e.g. app.heygen.com" style="width:100%;box-sizing:border-box;margin-top:6px" />
      <input id="coo_project_path" placeholder="Project path (required to create a task) — e.g. ~/proj" style="width:100%;box-sizing:border-box;margin-top:6px" />
      <div class="row" style="margin-top:6px;gap:6px">
        <button class="copybtn" onclick="cooDispatchPrepare()">Prepare</button>
        <button class="create" id="coo_create_btn" style="display:none" onclick="cooDispatchCreate()">Create Browser Lane task</button>
      </div>
      <div id="coo_result" style="margin-top:8px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Safe senders</label>
        <button class="copybtn" onclick="renderSafeSenders()">↻</button>
      </div>
      <div id="s_safe_senders" style="margin-top:4px"></div>
      <div class="muted" style="font-size:11px;margin-top:10px">Embedded lanes run inside the daemon and follow the connectivity mode. Launch-agent lanes, when present, can be toggled on/off — that installs/removes their macOS LaunchAgent.</div>
    </div>
  </div>
</div>

<!-- Generic dialog (replaces native alert/confirm/prompt, which don't work in the webview). -->
<input type="file" id="skillFileInput" accept=".md,text/markdown,.txt" style="display:none" onchange="onSkillFileBrowsed(this)" />
<div class="overlay" id="dialogOverlay">
  <div class="modal dialog">
    <h1 id="dialogTitle">HiveMatrix</h1>
    <div class="dialog-msg" id="dialogMsg"></div>
    <input class="dialog-input" id="dialogInput" style="display:none" onkeydown="if(event.key==='Enter'){event.preventDefault();dialogResolve(true);}else if(event.key==='Escape'){event.preventDefault();dialogResolve(false);}" />
    <div class="dialog-actions">
      <button class="cancel" id="dialogCancel" onclick="dialogResolve(false)">Cancel</button>
      <button class="addbtn" id="dialogBrowse" style="display:none;margin-right:auto" onclick="document.getElementById('skillFileInput').click()">Browse…</button>
      <button class="ok" id="dialogOk" onclick="dialogResolve(true)">OK</button>
    </div>
  </div>
</div>

<!-- Release notes — browsable changelog (GET /releases). -->
<div class="overlay" id="releasesOverlay">
  <div class="modal">
    <h1>📝 Release notes<span class="x" onclick="closeReleases()">✕</span></h1>
    <div id="releasesBody"><div class="muted">Loading…</div></div>
  </div>
</div>

<!-- Add skills (unified import: URL/file · shared scope · local folders). -->
<div class="overlay" id="addSkillOverlay">
  <div class="modal" style="width:480px">
    <h1>Add skills <span class="x" onclick="closeAddSkills()">✕</span></h1>
    <div class="sk-tabs">
      <span class="sk-tab active" id="addTab_url" onclick="addTab('url')">URL / file</span>
      <span class="sk-tab" id="addTab_shared" onclick="addTab('shared')">Shared scope</span>
      <span class="sk-tab" id="addTab_local" onclick="addTab('local')">Local folders</span>
    </div>
    <div class="sk-pane" id="addPane_url">
      <div class="muted" style="font-size:12px;margin-bottom:6px">Import a shared skill from a raw <code>SKILL.md</code> URL, or browse to a local markdown file. Imported skills land untrusted until you review and trust them.</div>
      <input class="dialog-input" id="addUrl" placeholder="https://…/SKILL.md" />
      <div class="row" style="gap:6px;margin-top:8px">
        <button class="cancel" onclick="document.getElementById('skillFileInput').click()">Browse file…</button>
        <button class="ok" style="margin-left:auto" onclick="doImportUrl()">Import</button>
      </div>
      <div class="muted" id="addUrlFile" style="font-size:11px;margin-top:4px"></div>
    </div>
    <div class="sk-pane" id="addPane_shared" style="display:none">
      <div class="muted" style="font-size:12px;margin-bottom:6px">Browse skills already shared to a scope, preview them, and import the ones you want.</div>
      <div class="row" style="gap:6px">
        <select id="addScope" style="flex:1">
          <option value="personal">personal</option><option value="team" selected>team</option><option value="org">org</option><option value="public">public</option>
        </select>
        <button class="ok" onclick="doBrowseShared()">Browse</button>
      </div>
      <div id="addShared" style="margin-top:8px;max-height:240px;overflow:auto"></div>
    </div>
    <div class="sk-pane" id="addPane_local" style="display:none">
      <div class="muted" style="font-size:12px">Bulk-import the folder skills from your local harness profiles (Claude / Codex / Qwen) into the brain library so they can be shared and run as skills.</div>
      <button class="ok" style="margin-top:10px" onclick="doImportLocal()">Import local folder skills</button>
    </div>
    <div class="muted" id="addStatus" style="font-size:11px;margin-top:10px"></div>
  </div>
</div>

<!-- Message Lane guided setup. -->
<div class="overlay" id="mbOverlay">
  <div class="modal" style="width:460px">
    <h1>Set up Message Lane <span class="x" onclick="closeMessageBee()">✕</span></h1>
    <div class="muted" style="font-size:12px;margin-bottom:10px">Text HiveMatrix from your phone over iMessage/SMS. Three things get it running:</div>
    <div class="mb-step" id="mb_fda">
      <span class="mb-mark no" id="mb_fda_mark">○</span>
      <div class="mb-body">
        <div class="t">Full Disk Access</div>
        <div class="muted" id="mb_fda_detail">HiveMatrix needs Full Disk Access to read Messages (chat.db).</div>
        <button onclick="openFullDiskAccess()">Open Full Disk Access settings</button>
      </div>
    </div>
    <div class="mb-step">
      <span class="mb-mark no" id="mb_phone_mark">○</span>
      <div class="mb-body">
        <div class="t">Allowlist your phone</div>
        <div class="muted">Only allowlisted senders can drive HiveMatrix. Add your iMessage number or email.</div>
        <input class="dialog-input" id="mb_phone" placeholder="+15551234567 or you@icloud.com" style="margin-top:6px;margin-bottom:4px" />
        <div id="mb_identities"></div>
        <div id="mb_ignored" style="margin-top:6px"></div>
      </div>
    </div>
    <div class="mb-step" style="border-bottom:0">
      <span class="mb-mark no" id="mb_chan_mark">○</span>
      <div class="mb-body">
        <div class="t">Enable the channel</div>
        <div class="muted">Turning on the iMessage channel starts the inbound/outbound poller.</div>
      </div>
    </div>
    <div class="err" id="mb_err"></div>
    <div class="dialog-actions" style="margin-top:12px">
      <button class="cancel" onclick="closeMessageBee()">Close</button>
      <button class="ok" onclick="submitMessageBee()">Enable &amp; allowlist</button>
    </div>
    <div class="muted" id="mb_status" style="font-size:11px;margin-top:8px"></div>
  </div>
</div>

<!-- Mail Lane guided setup. -->
<div class="overlay" id="mailOverlay">
  <div class="modal" style="width:460px">
    <h1>Set up Mail Lane <span class="x" onclick="closeMailBee()">✕</span></h1>
    <div class="muted" style="font-size:12px;margin-bottom:10px">Watch email and draft/send replies via Apple Mail. Trusted senders auto-send; everyone else is draft-for-approval.</div>
    <div class="mb-step">
      <span class="mb-mark no" id="ml_auto_mark">○</span>
      <div class="mb-body">
        <div class="t">Apple Mail Automation</div>
        <div class="muted" id="ml_auto_detail">HiveMatrix needs permission to control Mail (read inbox + draft/send).</div>
        <button onclick="openSystemPane('automation')">Open Automation settings</button>
        <div class="muted" style="font-size:11px;margin-top:3px">Open Mail.app first so it appears in the Automation list.</div>
      </div>
    </div>
    <div class="mb-step">
      <span class="mb-mark no" id="ml_trust_mark">○</span>
      <div class="mb-body">
        <div class="t">Trusted senders (optional)</div>
        <div class="muted">Trusted senders get auto-sent replies; everyone else becomes a draft for your approval.</div>
        <input class="dialog-input" id="ml_email" placeholder="trusted@example.com" style="margin-top:6px;margin-bottom:4px" />
        <div id="ml_identities"></div>
      </div>
    </div>
    <div class="mb-step" style="border-bottom:0">
      <span class="mb-mark no" id="ml_chan_mark">○</span>
      <div class="mb-body">
        <div class="t">Enable the channel</div>
        <div class="muted">Starts watching new mail (existing inbox is not replayed).</div>
      </div>
    </div>
    <div class="err" id="ml_err"></div>
    <div class="dialog-actions" style="margin-top:12px">
      <button class="cancel" onclick="closeMailBee()">Close</button>
      <button class="ok" onclick="submitMailBee()">Enable Mail Lane</button>
    </div>
    <div class="muted" id="ml_status" style="font-size:11px;margin-top:8px"></div>
  </div>
</div>

<main>
  <section class="col board">
    <h2>Board <span id="archiveBtn" class="archive-link" onclick="archiveCompleted()" title="Archive review/done/failed tasks"></span></h2>
    <button class="addbtn" onclick="toggleForm('taskForm')">＋ New task</button>
    <button class="addbtn" onclick="draftVideoNow()" title="Draft today's AI-news video script and pause for your review">🎬 AI-news video</button>
    <div class="form" id="taskForm">
      <input id="t_title" placeholder="Title (optional — derived from instructions)" />
      <textarea id="t_desc" placeholder="What should the agent do? (be specific)"></textarea>
      <div class="row" style="gap:6px;margin-top:2px">
        <button type="button" class="addbtn" onclick="toggleTaskSkillPicker()" title="Pick an installed skill or command to use — no need to remember names">＋ Use a skill</button>
      </div>
      <div id="t_skill_picker" style="display:none">
        <input id="t_skill_q" placeholder="Search your skills & commands…" oninput="searchTaskSkills()" style="width:100%;margin-top:4px" />
        <div id="t_skill_results" style="max-height:170px;overflow:auto;margin-top:4px"></div>
      </div>
      <label class="flbl">Project</label>
      <div id="t_project_wrapper" class="project-search">
        <input id="t_project_search" type="text" placeholder="Search projects…" oninput="filterProjectDropdown()" onfocus="openProjectDropdown()" />
        <div id="t_project_dropdown" class="project-dropdown hidden">
          <div class="project-sort-row">
            <span class="project-sort-btn active" data-sort="recent" onclick="sortProjectsDropdown('recent')">Most recent</span>
            <span class="project-sort-btn" data-sort="name" onclick="sortProjectsDropdown('name')">Name A–Z</span>
          </div>
          <div id="t_project_list" class="project-list"></div>
          <div id="t_project_empty" class="project-empty hidden">No projects found <button class="copybtn" id="t_project_rescan" onclick="refreshProjects()">↻ Re-scan</button></div>
        </div>
      </div>
      <input id="t_path" placeholder="Project path (working dir)" value="/tmp" />
      <label class="flbl">Model</label>
      <select id="t_model"></select>
      <label class="flbl">Attachments (optional)</label>
      <div class="attach-row">
        <input type="file" id="t_attach_input" multiple style="display:none" onchange="onAttachFiles(this)">
        <button type="button" class="cancel" onclick="document.getElementById('t_attach_input').click()">⊕ Browse files</button>
        <span class="muted" id="t_attach_hint" style="font-size:11px">No files selected</span>
      </div>
      <div class="attach-chips" id="t_attach_chips"></div>
      <div class="row"><button class="create" onclick="createTask()">Create task</button><button class="cancel" onclick="cancelForm('taskForm')">Cancel</button></div>
      <div class="err" id="t_err"></div>
    </div>
    <div id="board"></div>
  </section>
  <section class="col session">
    <div id="session"><div class="session-empty">Select a task to inspect its session.</div></div>
  </section>
  <section class="col context">
    <div id="approvals"></div>
    <details class="ctx-sec" id="setupSec" open><summary id="setupSummary">Setup</summary>
    <div id="onboarding"></div></details>
    <details class="ctx-sec" id="modelsSec" open><summary>Models <button id="usageRefresh" class="usage-refresh" title="Refresh model status &amp; usage" onclick="event.stopPropagation();refreshModelsNow()">↻</button></summary>
    <div id="modelStatus"></div>
    <div id="usage"><div class="muted">No frontier usage yet.</div></div></details>
    <details class="ctx-sec" id="obsSec"><summary>Observability</summary>
    <div id="observability"><div class="muted">No task telemetry yet.</div></div></details>
    <details class="ctx-sec" id="connSec" open><summary>Connectivity</summary>
    <div id="conn"></div></details>
    <details class="ctx-sec" id="dirSec" open><summary>Directives</summary>
    <button class="addbtn" onclick="toggleForm('dirForm')">＋ New directive</button>
    <div class="form" id="dirForm">
      <input id="d_goal" placeholder="Standing goal" />
      <input id="d_path" placeholder="Project path" value="/tmp" />
      <input id="d_crit" placeholder="Success criterion (optional)" />
      <input id="d_interval" placeholder="Repeat interval (e.g. PT4H, P1D) — blank = manual" />
      <div class="row"><button class="create" onclick="createDirective()">Create directive</button><button class="cancel" onclick="cancelForm('dirForm')">Cancel</button></div>
      <div class="err" id="d_err"></div>
    </div>
    <div class="form" id="dirEditForm">
      <input id="de_id" type="hidden" />
      <input id="de_goal" placeholder="Standing goal" />
      <input id="de_path" placeholder="Project path" />
      <input id="de_interval" placeholder="Repeat interval (e.g. PT4H, P1D) — blank = manual" />
      <select id="de_status"><option value="active">active</option><option value="sleeping">sleeping</option><option value="blocked">blocked</option><option value="retired">retired</option></select>
      <div class="row"><button class="create" onclick="saveDirective()">Save changes</button><button class="cancel" onclick="cancelForm('dirEditForm')">Cancel</button></div>
      <div class="err" id="de_err"></div>
    </div>
    <div id="directives"></div></details>
    <details class="ctx-sec" id="skillsSec" open><summary>Skills &amp; Commands</summary>
    <div class="sk-toolbar">
      <input id="skQuery" placeholder="Search skills &amp; commands…" oninput="renderSkillList()" />
      <button class="addbtn" onclick="openAddSkills()" title="Import a skill from a URL, a file, a shared scope, or your local folders">＋ Add</button>
      <button class="addbtn" onclick="syncSkills()" title="Git-sync all scopes + write skills into the Claude/Codex/Qwen dirs">⇄ Sync</button>
    </div>
    <div id="skList" class="sk-list"></div>
    <div id="skDetail" class="sk-detail" style="display:none"></div>
    <div class="muted" id="skStatus" style="font-size:11px;margin-top:6px"></div>
    <div id="skPrune" style="font-size:11px;margin-top:4px"></div>
    <div style="margin-top:6px"><button class="linklike" onclick="loadSkillPrune()">Find unused skills…</button></div>
    </details>
    <details class="ctx-sec" id="mcpSec"><summary>MCP Servers</summary>
    <div id="mcp"></div></details>
  </section>
</main>
<script>
// Board lanes (display-only). The underlying task statuses are unchanged
// (no migration): "backlog" is shown as "queued", and "assigned" (a ~2s
// transient) is folded into the in-progress lane.
const LANE_DEFS = [
  { key: "queued",      label: "queued",      statuses: ["backlog"] },
  { key: "in_progress", label: "in progress", statuses: ["assigned", "in_progress"] },
  { key: "review",      label: "review",      statuses: ["review"] },
  { key: "done",        label: "done",        statuses: ["done"] },
  { key: "failed",      label: "failed",      statuses: ["failed"] },
];
// Token: injected by the daemon for loopback requests; for remote (tunnel)
// requests the daemon serves an empty value, so we fall back to a token the
// user pasted once (stored locally). See requireToken().
let HM_TOKEN = "%%HM_TOKEN%%" || localStorage.getItem("hm_token") || "";

function requireToken() {
  if (HM_TOKEN) { if ("%%HM_TOKEN%%") localStorage.setItem("hm_token", HM_TOKEN); return true; }
  // Remote with no stored token → prompt for it (obtained from local Settings).
  // Use CSS variables so the prompt respects the current theme.
  document.body.innerHTML = '<div id="tokenPrompt" style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:-apple-system,sans-serif;color:var(--text,#e6edf3);background:var(--bg,#0d1117)">'
    + '<div style="font-size:22px;font-weight:700;color:var(--accent,#d9a441)">HiveMatrix</div>'
    + '<div style="color:var(--muted,#8b949e)">Remote access — paste your access token</div>'
    + '<input id="lt" type="password" placeholder="access token" style="width:320px;padding:8px;border-radius:6px;border:1px solid var(--border,#2d333b);background:var(--panel-2,#1c2230);color:var(--text,#e6edf3)" />'
    + '<button onclick="(function(){var v=document.getElementById(\'lt\').value.trim();if(v){localStorage.setItem(\'hm_token\',v);location.reload();}})()" style="background:var(--accent,#d9a441);color:var(--create-btn-text,#1a1a1a);border:0;border-radius:6px;padding:8px 18px;font-weight:700;cursor:pointer">Connect</button>'
    + '<div style="color:var(--muted,#8b949e);font-size:11px;max-width:340px;text-align:center">Find this token in the local HiveMatrix console under Settings → Remote access.</div></div>';
  return false;
}
let state = { tasks: [], directives: [], conn: null, metrics: null, onboarding: null, selected: null, projects: [], selectedProject: "" };

async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, { "Authorization": "Bearer " + HM_TOKEN });
  const r = await fetch(path, opts);
  if (r.status === 204) return null;
  return r.json();
}
function esc(s){ return (s==null?"":String(s)).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
// Lightweight toast — consistent "it saved" feedback for auto-saving settings.
function hmToast(message, kind) {
  let host = document.getElementById("toastHost");
  if (!host) { host = document.createElement("div"); host.id = "toastHost"; document.body.appendChild(host); }
  const t = document.createElement("div");
  t.className = "toast" + (kind ? " " + kind : "");
  t.textContent = message;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 220); }, 1800);
}
// Header quick theme toggle — flips light/dark and persists (matrix/system stay in Settings).
async function toggleThemeQuick() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  try {
    models = await api("/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: next }) }) || models;
    applyTheme(next, !!(models && models.hasWallpaper));
    const sel = document.getElementById("s_theme"); if (sel) sel.value = next;
    hmToast("Theme: " + next, "ok");
  } catch (e) { hmToast("Couldn't change theme", "err"); }
}
// Center overview — at-a-glance board state when no task is selected, instead of
// leaving the widest column empty.
function renderOverview() {
  if (state.selected) return;
  const el = document.getElementById("session");
  if (!el) return;
  const statusToLane = {}; LANE_DEFS.forEach(L => L.statuses.forEach(s => statusToLane[s] = L.key));
  const counts = {}; LANE_DEFS.forEach(L => counts[L.key] = 0);
  const filtered = state.selectedProject ? state.tasks.filter(t => t.project === state.selectedProject) : state.tasks;
  for (const t of filtered) { const k = statusToLane[t.status]; if (k) counts[k]++; }
  const dirActive = (state.directives || []).filter(d => d.status === "active").length;
  const appr = (state.approvals || []).length;
  const card = (label, val, cls) => '<div class="ov-card ' + (cls || "") + '"><div class="ov-num">' + val + '</div><div class="ov-lbl">' + esc(label) + '</div></div>';
  el.innerHTML = '<div class="overview">'
    + '<div class="ov-head">Overview' + (state.selectedProject ? " · " + esc(state.selectedProject) : "") + '</div>'
    + '<div class="ov-grid">' + LANE_DEFS.map(L => card(L.label, counts[L.key])).join("") + '</div>'
    + '<div class="ov-grid" style="margin-top:8px">'
    + card("active directives", dirActive)
    + card("pending approvals", appr, appr ? "warn" : "")
    + '</div>'
    + '<div class="ov-hint">Select a task to inspect its session — or ＋ New task to start one.</div>'
    + '</div>';
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onloadend = () => resolve(String(fr.result || "").split(",")[1] || "");
    fr.onerror = () => reject(new Error("Attachment read failed"));
    fr.readAsDataURL(file);
  });
}
async function uploadAttachmentFile(file) {
  const dataBase64 = await fileToBase64(file);
  const saved = await api("/uploads", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ filename: file.name || "upload", dataBase64 }) });
  if (!saved || saved.error) throw new Error((saved && saved.error) || "Upload failed");
  return saved;
}
function attachmentName(a) {
  return (a && (a.filename || (a.path ? String(a.path).split("/").pop() : ""))) || "attachment";
}
function attachmentPath(a) {
  return (a && a.path) || "";
}
function attachmentKey(a) {
  const path = attachmentPath(a);
  return path ? "path:" + path : "name:" + attachmentName(a);
}
function pushAttachmentRecord(bucket, record) {
  if (!record || (!record.path && !record.filename)) return false;
  const out = { filename: record.filename || attachmentName(record), path: record.path || "", bytes: record.bytes };
  const key = attachmentKey(out);
  if (bucket.some(a => attachmentKey(a) === key)) return false;
  bucket.push(out);
  return true;
}

// --- In-DOM dialogs ---------------------------------------------------------
// The Tauri/WKWebView webview has no working native alert/confirm/prompt
// (prompt returns null, alert is a no-op), so these reimplement them in the DOM.
let _dialogResolver = null;
let _skillFileContent = null;
function dialogResolve(ok) {
  const ov = document.getElementById("dialogOverlay");
  const input = document.getElementById("dialogInput");
  const usesInput = input.style.display !== "none";
  ov.classList.remove("open");
  const r = _dialogResolver; _dialogResolver = null;
  if (r) r(usesInput ? (ok ? input.value : null) : ok);
}
function _openDialog(opts) {
  return new Promise((resolve) => {
    _dialogResolver = resolve;
    document.getElementById("dialogTitle").textContent = opts.title || "HiveMatrix";
    document.getElementById("dialogMsg").textContent = opts.message || "";
    const input = document.getElementById("dialogInput");
    if (opts.prompt) {
      input.style.display = ""; input.value = opts.defaultValue || "";
    } else { input.style.display = "none"; }
    const cancel = document.getElementById("dialogCancel");
    cancel.style.display = opts.hideCancel ? "none" : "";
    const ok = document.getElementById("dialogOk");
    ok.textContent = opts.okLabel || "OK";
    ok.classList.toggle("danger", !!opts.danger);
    const browse = document.getElementById("dialogBrowse");
    if (browse) browse.style.display = opts.browse ? "" : "none";
    document.getElementById("dialogOverlay").classList.add("open");
    if (opts.prompt) setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}
function hmAlert(message, title) { return _openDialog({ message, title, hideCancel: true }); }
function hmConfirm(message, opts) { return _openDialog(Object.assign({ message }, opts || {})); }
function hmPrompt(message, defaultValue, opts) { return _openDialog(Object.assign({ message, prompt: true, defaultValue }, opts || {})); }
async function onSkillFileBrowsed(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    _skillFileContent = await file.text();
    const f = document.getElementById('addUrlFile'); if (f) f.textContent = 'File ready to import: ' + file.name;
    const u = document.getElementById('addUrl'); if (u) u.value = '';
  } catch (e) { _skillFileContent = null; }
  input.value = '';
}

// Relative "time ago" for task timestamps. The daemon writes two formats: toISOString()
// on insert ("...T..Z") and SQLite datetime('now') on update ("YYYY-MM-DD HH:MM:SS",
// space-separated, UTC, no T/Z). Both must be read as UTC. Kept between sentinels so the
// test suite can extract and exercise the real shipped function.
/*__TIMEAGO_START__*/
function timeAgo(value, nowMs) {
  if (!value) return "";
  var s = String(value).trim();
  var m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  var iso = m ? (m[1] + "T" + m[2] + (m[3] || "") + (m[4] || "Z")) : s;
  var t = Date.parse(iso);
  if (isNaN(t)) return "";
  var now = (typeof nowMs === "number") ? nowMs : Date.now();
  var sec = Math.floor((now - t) / 1000);
  if (sec < 45) return "just now";
  if (sec < 90) return "1 min ago";
  if (sec < 3600) return Math.round(sec / 60) + " min ago";
  if (sec < 5400) return "1 hr ago";
  if (sec < 86400) return Math.round(sec / 3600) + " hr ago";
  if (sec < 151200) return "1 day ago";
  if (sec < 2592000) return Math.round(sec / 86400) + " days ago";
  if (sec < 3888000) return "1 mo ago";
  if (sec < 31536000) return Math.round(sec / 2592000) + " mo ago";
  return Math.round(sec / 31536000) + " yr ago";
}
/*__TIMEAGO_END__*/

function ageBadge(t) {
  var raw = (t && t.updatedAt) || (t && t.createdAt) || "";
  var label = timeAgo(raw, Date.now());
  return label ? '<span class="badge age" title="'+esc(raw)+'">'+esc(label)+'</span>' : "";
}

function renderBoard() {
  const statusToLane = {};
  LANE_DEFS.forEach(L => L.statuses.forEach(s => statusToLane[s] = L.key));
  const byLane = {}; LANE_DEFS.forEach(L => byLane[L.key] = []);
  // Filter by selected project if one is chosen
  const filtered = state.selectedProject
    ? state.tasks.filter(t => t.project === state.selectedProject)
    : state.tasks;
  for (const t of filtered) { const k = statusToLane[t.status]; if (k) byLane[k].push(t); }
  const el = document.getElementById("board");
  el.innerHTML = LANE_DEFS.map(L => {
    const items = byLane[L.key] || [];
    if (!items.length && (L.key==="done"||L.key==="failed")) return "";
    return '<div class="lane"><div class="lane-title">'+L.label+' <span class="count">'+items.length+'</span></div>'
      + items.map(t => '<div class="card'+(state.selected===t._id?' sel':'')+'" onclick="selectTask(\''+t._id+'\')">'
          + '<button class="card-archive" title="Archive" onclick="event.stopPropagation();cardArchive(\''+t._id+'\')">⌫</button>'
          + '<div class="t">'+esc(t.title||t._id)+'</div>'
          + '<div class="m">'+(t.model?'<span class="badge model">'+esc(t.model)+'</span>':'')
          + (t.reviewState?'<span class="badge">'+esc(t.reviewState)+'</span>':'')
          + (t.directiveId?'<span class="badge">directive</span>':'')+ageBadge(t)+'</div></div>').join("")
      + '</div>';
  }).join("") || '<div class="muted">No tasks.</div>';
  const archivable = state.tasks.filter(t => ["review","done","failed","cancelled"].includes(t.status)).length;
  const ab = document.getElementById("archiveBtn");
  if (ab) ab.textContent = archivable ? "· archive completed (" + archivable + ")" : "";
}

/*__MARKDOWN_RENDERER_START__*/
function stashMdBlock(blocks, html) {
  const key = "@@HM_MD_BLOCK_" + blocks.length + "@@";
  blocks.push(html);
  return key;
}

function restoreMdBlocks(blocks, html) {
  return html.replace(/@@HM_MD_BLOCK_(\d+)@@/g, (m, i) => blocks[Number(i)] || m);
}

function splitMarkdownTableRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map(c => c.trim());
}

function isMarkdownTableRow(line) {
  return /\|/.test(line || "") && line.trim().length > 0;
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || "");
}

function fitMarkdownTableCells(cells, width) {
  const out = cells.slice(0, width);
  while (out.length < width) out.push("");
  return out;
}

function renderMarkdownTable(header, rows) {
  const width = header.length;
  const th = fitMarkdownTableCells(header, width).map(c => "<th>" + c + "</th>").join("");
  const trs = rows.map(r => "<tr>" + fitMarkdownTableCells(r, width).map(c => "<td>" + c + "</td>").join("") + "</tr>").join("");
  return '<div class="md-table-wrap"><table class="md-table"><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table></div>';
}

function renderMarkdownTables(src, blocks) {
  const lines = String(src || "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length && isMarkdownTableRow(lines[i]) && isMarkdownTableSeparator(lines[i + 1])) {
      const header = splitMarkdownTableRow(lines[i]);
      const rows = [];
      i += 2;
      while (i < lines.length && isMarkdownTableRow(lines[i]) && !isMarkdownTableSeparator(lines[i])) {
        rows.push(splitMarkdownTableRow(lines[i]));
        i++;
      }
      i--;
      out.push(stashMdBlock(blocks, renderMarkdownTable(header, rows)));
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\n");
}

function mdCodeFenceToHtml(lang, code) {
  const language = String(lang || "").trim().toLowerCase();
  const body = String(code || "").replace(/^\n/, "").replace(/\n$/, "");
  if (language === "mermaid") return '<pre class="mermaid">' + body + '</pre>';
  return '<pre><code>' + body + '</code></pre>';
}

// Minimal, safe markdown → HTML (escapes first, then controlled block/inline rules).
function mdToHtml(src) {
  const blocks = [];
  let s = esc(src || "");
  s = s.replace(/\x60\x60\x60([A-Za-z0-9_-]+)?[ \t]*\n?([\s\S]*?)\x60\x60\x60/g, (m, lang, c)=>stashMdBlock(blocks, mdCodeFenceToHtml(lang, c)));
  s = renderMarkdownTables(s, blocks);
  s = s.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  s = s.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  return restoreMdBlocks(blocks, s.replace(/\n/g, '<br>'));
}
/*__MARKDOWN_RENDERER_END__*/

let _mermaidTheme = null;
function initMermaid() {
  const m = window.mermaid;
  if (!m) return false;
  const theme = document.documentElement.dataset.theme === "light" ? "default" : "dark";
  if (_mermaidTheme !== theme) {
    m.initialize({ startOnLoad: false, theme, securityLevel: "strict" });
    _mermaidTheme = theme;
  }
  return true;
}

function markMermaidError(blocks) {
  blocks.forEach(el => el.classList.add("mermaid-error"));
}

function renderMermaidBlocks(root) {
  const scope = root || document;
  const blocks = Array.from(scope.querySelectorAll(".mermaid:not([data-processed='true'])"));
  if (!blocks.length) return;
  if (!initMermaid()) {
    blocks.forEach(el => el.classList.add("mermaid-pending"));
    return;
  }
  blocks.forEach(el => el.classList.remove("mermaid-pending", "mermaid-error"));
  try {
    const r = window.mermaid.run({ nodes: blocks });
    if (r && typeof r.catch === "function") r.catch(() => markMermaidError(blocks));
  } catch (e) {
    markMermaidError(blocks);
  }
}
window.addEventListener("load", () => renderMermaidBlocks());

function renderTranscript(logs) {
  if (!Array.isArray(logs) || !logs.length) return '<div class="muted">No transcript yet.</div>';
  return '<div class="transcript">' + logs.slice(-400).map(l => {
    const cls = l.type === "error" ? "error" : (l.type === "tool_use" || l.type === "tool_result") ? "tool" : "text";
    const txt = typeof l.content === "string" ? l.content : JSON.stringify(l.content);
    return '<div class="ln '+cls+'">'+esc(txt)+'</div>';
  }).join("") + '</div>';
}

// Inline attachment picker shared by the retry-steer and reply forms. ctx scopes
// the element ids + state bucket ('retry' | 'reply').
function attachPickerHtml(ctx) {
  return '<div class="attach-row" style="margin-top:6px">'
    + '<input type="file" id="'+ctx+'AttachInput" multiple style="display:none" onchange="onCtxAttach(\''+ctx+'\',this)">'
    + '<button type="button" class="cancel" onclick="document.getElementById(\''+ctx+'AttachInput\').click()">⊕ Attach files</button>'
    + '<span class="muted" id="'+ctx+'AttachHint" style="font-size:11px">No files</span></div>'
    + '<div class="attach-chips" id="'+ctx+'AttachChips"></div>';
}

function taskActionsHtml(t) {
  const b = [];
  const running = ["backlog","assigned","in_progress"].includes(t.status);
  const retryable = ["failed","review","cancelled"].includes(t.status);
  // Steerable: any live run can be interrupted and resumed on the same session.
  const steerable = t.status === "in_progress";
  if (running) b.push('<button onclick="taskAction(\''+t._id+'\',\'cancel\')">■ Cancel</button>');
  if (retryable) b.push('<button class="reply-toggle" id="retryToggle_'+t._id+'" onclick="toggleRetry(\''+t._id+'\')">↻ Retry</button>');
  // Reply: answer the agent / continue a finished task (review, failed, cancelled)
  // — except needs_input, which already shows the fully-standout reply card.
  const canReply = !steerable && t.reviewState !== "needs_input" && (t.pendingQuestion || retryable);
  if (canReply) b.push('<button class="reply-toggle" id="replyToggle_'+t._id+'" onclick="toggleReply(\''+t._id+'\')">↩ Reply</button>');
  if (!running) b.push('<button onclick="taskAction(\''+t._id+'\',\'archive\')">⌫ Archive</button>');
  b.push('<button class="danger" onclick="deleteTask(\''+t._id+'\')">🗑 Delete</button>');
  let html = '<div class="actions">'+b.join("")+'</div>';
  // Retry-with-steer: optional guidance text + attachments fold out under Retry.
  if (retryable) {
    html += '<div id="retrySection_'+t._id+'" class="reply-section">'
      + '<textarea id="retryText" class="reply-input" placeholder="Optional: add guidance to steer the rerun…" rows="2" oninput="onCtxDraft(\'retry\',this)"></textarea>'
      + attachPickerHtml('retry')
      + '<div class="reply-row" style="margin-top:6px"><button onclick="submitRetry(\''+t._id+'\')">↻ Retry'+(t.status==='cancelled'?'':' with guidance')+'</button></div></div>';
  }
  // Steer a live run: always-visible box (the task is live-refreshing, so a
  // collapsible section would close mid-compose). Submitting interrupts the agent
  // and resumes the same session with the new instruction.
  if (steerable) {
    html += '<div id="steerSection_'+t._id+'" class="reply-section open">'
      + '<div class="reply-question">Steer this run — your instruction is added and the session resumes.</div>'
      + '<textarea id="steerText" class="reply-input" placeholder="Type a new instruction to steer this run…" rows="2" oninput="onCtxDraft(\'steer\',this)"></textarea>'
      + '<div class="reply-row" style="margin-top:6px"><button onclick="submitSteer(\''+t._id+'\')">⤳ Send Steer</button></div></div>';
  }
  // Reply box. needs_input → the fully-standout card (auto-open). Otherwise a
  // subtler "reply to continue" box (toggled open from the ↩ Reply button).
  if (!steerable && t.executor === "video-review") {
    // Dedicated script-review controls: edit + Save (stays in review), Approve to
    // render+publish, or Cancel. Explicit buttons so "submit" is unmissable and
    // editing never silently renders.
    html += '<div id="replySection_'+t._id+'" class="reply-section open needs">'
      + '<div class="reply-head">🎬 Review the script</div>'
      + '<div class="reply-subhead">Click <b>Edit script</b>, revise it, then <b>Save edits</b> (stays here to re-read) — or <b>Approve</b> to render + publish. A short note instead = rework.</div>'
      + '<div class="reply-row" style="margin-bottom:6px"><button class="reply-toggle" onclick="loadDraftIntoReply()">✎ Edit script</button></div>'
      + '<textarea id="replyText" class="reply-input" placeholder="Edit the script here (or type a short note like \'drop story 2\' to rework)…" rows="8" oninput="onCtxDraft(\'reply\',this)"></textarea>'
      + '<div class="reply-row" style="margin-top:8px;gap:8px;flex-wrap:wrap">'
      + '<button class="reply-primary" onclick="replyTask(\''+t._id+'\')">💾 Save edits / Send</button>'
      + '<button onclick="videoReviewAction(\''+t._id+'\',\'approve\')">✅ Approve &amp; render</button>'
      + '<button class="cancel" onclick="videoReviewAction(\''+t._id+'\',\'cancel\')">✕ Cancel</button>'
      + '</div></div>';
  } else if (!steerable) {
    const isOpen = t.reviewState === "needs_input";
    const q = t.pendingQuestion ? '<div class="reply-question">'+esc(t.pendingQuestion)+'</div>' : '';
    html += '<div id="replySection_'+t._id+'" class="reply-section'+(isOpen?' open needs':' subtle')+'">'
      + (isOpen
          ? '<div class="reply-head">✋ Awaiting your reply</div>'
          : '<div class="reply-subhead">↩ Reply — your message is added and the task re-runs</div>')
      + q
      + '<textarea id="replyText" class="reply-input" placeholder="'+(isOpen?'Type your reply…':'Reply to this task…')+'" rows="'+(isOpen?'7':'2')+'" oninput="onCtxDraft(\'reply\',this)"></textarea>'
      + attachPickerHtml('reply')
      + '<div class="reply-row" style="margin-top:6px">'
      + (_replyEditSource ? '<button class="reply-toggle" onclick="loadDraftIntoReply()" title="Load the current draft into the box to edit in place — no copy-paste">✎ Edit the draft</button> ' : '')
      + '<button class="reply-primary" onclick="replyTask(\''+t._id+'\')">Reply</button></div></div>';
  }
  return html;
}

async function selectTask(id) {
  state.selected = id;
  // Switching tasks clears half-composed retry/reply state; staying on the same
  // task across a live refresh keeps files and draft text.
  if (_ctxTask !== id) {
    _ctxAttach = { retry: [], reply: [] };
    _ctxUploading = { retry: 0, reply: 0 };
    _ctxAttachError = { retry: "", reply: "" };
    _ctxAttachNonce += 1;
    _ctxDraft = { retry: "", reply: "", steer: "" };
    _ctxFocus = { active: null, start: null, end: null };
    _ctxOpen = { retry: false, reply: false };
    _ctxReplyHeight = "";
    _ctxTask = id;
  } else {
    syncCtxState();
  }
  renderBoard();
  const t = await api("/tasks/"+id);
  if (!t || !t._id) { state.selected = null; return; }
  const out = t.output ? (typeof t.output==="string"?JSON.parse(t.output):t.output) : {};
  // The clean text the operator would edit: a review draft's script, else the result.
  _replyEditSource = (typeof out.reviewScript === "string" && out.reviewScript) || (typeof out.summary === "string" && out.summary) || "";
  const logs = typeof t.logs === "string" ? (()=>{try{return JSON.parse(t.logs)}catch{return[]}})() : (t.logs||[]);
  const live = ["assigned","in_progress"].includes(t.status);
  const el = document.getElementById("session");
  // Preserve scroll for non-live tasks — innerHTML rebuild resets scrollTop to 0.
  const prevScrollTop = live ? null : (el.querySelector(".transcript")?.scrollTop ?? null);
  el.innerHTML = '<div class="session"><h1>'+esc(t.title||t._id)+(live?'<span class="streaming">● running</span>':'')+'</h1>'
    + '<div class="sub">'+esc(t.project||"")+' · '+esc(t.status)+(t.reviewState?' · '+esc(t.reviewState):'')+'</div>'
    + taskActionsHtml(t)
    + taskExecutionPanel(t, out)
    + '<div class="kv">'
    + '<span class="k">project path</span><span>'+esc(t.projectPath||"—")+'</span>'
    + '<span class="k">directive</span><span>'+esc(t.directiveId||"—")+'</span>'
    + '<span class="k">completedBy</span><span>'+esc(t.completedBy||"—")+'</span>'
    + '<span class="k">prover</span><span>'+esc(t.proverType||"—")+'</span>'
    + '</div>'
    + taskTelemetryStrip(t, out)
    + '<h2>Description</h2><div class="desc md">'+mdToHtml(t.description||"")+'</div>'
    + (t.error?'<h2>Error</h2><div class="errbox">'+esc(t.error)+'</div>':'')
    + (out.summary?'<h2>Result <button class="linklike" onclick="copyEditSource()" title="Copy this text">⧉ Copy</button></h2><div class="desc md">'+mdToHtml(out.summary)+'</div>':'')
    + '<h2>Session transcript</h2>'+renderTranscript(logs)
    + '</div>';
  const tr = el.querySelector(".transcript");
  if (tr) {
    if (live) tr.scrollTop = tr.scrollHeight;
    else if (prevScrollTop !== null) tr.scrollTop = prevScrollTop;
  }
  // Restore form state after the innerHTML rebuild.
  restoreCtxState();
  renderCtxChips("retry"); renderCtxChips("reply");
  renderMermaidBlocks(el);
}

async function taskAction(id, action) {
  await api("/tasks/"+id+"/"+action, { method: "POST" });
  refresh();
}
async function deleteTask(id) {
  await api("/tasks/"+id, { method: "DELETE" });
  if (state.selected === id) { state.selected = null; renderOverview(); }
  refresh();
}
async function archiveCompleted() {
  const r = await api("/tasks/archive-completed", { method: "POST" });
  refresh();
}

async function cardArchive(id) {
  await api("/tasks/"+id+"/archive", { method: "POST" });
  if (state.selected === id) state.selected = null;
  refresh();
}

// Per-context draft/attachment state for the retry-steer + reply forms. Reset
// when a different task is selected (see selectTask), preserved across same-task
// re-renders so a live refresh doesn't drop files or text mid-compose.
let _ctxAttach = { retry: [], reply: [] };
let _ctxUploading = { retry: 0, reply: 0 };
let _ctxAttachError = { retry: "", reply: "" };
let _ctxAttachNonce = 0;
let _ctxDraft = { retry: "", reply: "", steer: "" };
let _ctxFocus = { active: null, start: null, end: null };
// Manual reply-box resize height (px), preserved across the 5s re-render so a
// dragged-taller editing box doesn't snap back. Cleared when switching tasks.
let _ctxReplyHeight = "";
// The current task's editable draft text (Result/reviewScript) — "Edit the draft"
// loads this into the reply box so edits are in-place, not copy-paste.
let _replyEditSource = "";
// Which toggle-opened sections are open — so a live refresh's re-render doesn't
// collapse the box mid-typing. (needs_input opens from task state, not this.)
let _ctxOpen = { retry: false, reply: false };
let _ctxTask = null;
function onCtxDraft(ctx, input) {
  _ctxDraft[ctx] = input.value;
  if (document.activeElement === input) {
    _ctxFocus = { active: ctx, start: input.selectionStart, end: input.selectionEnd };
  }
}
function syncCtxState() {
  const retry = document.getElementById("retryText");
  const reply = document.getElementById("replyText");
  const steer = document.getElementById("steerText");
  if (retry) _ctxDraft.retry = retry.value;
  if (reply) _ctxDraft.reply = reply.value;
  if (steer) _ctxDraft.steer = steer.value;
  if (reply && reply.style.height) _ctxReplyHeight = reply.style.height; // keep a dragged-taller box
  const active = document.activeElement;
  if (active === retry) _ctxFocus = { active: "retry", start: retry.selectionStart, end: retry.selectionEnd };
  else if (active === reply) _ctxFocus = { active: "reply", start: reply.selectionStart, end: reply.selectionEnd };
  else if (active === steer) _ctxFocus = { active: "steer", start: steer.selectionStart, end: steer.selectionEnd };
}
function restoreCtxState() {
  const retry = document.getElementById("retryText");
  const reply = document.getElementById("replyText");
  const steer = document.getElementById("steerText");
  if (retry) retry.value = _ctxDraft.retry;
  if (reply) reply.value = _ctxDraft.reply;
  if (steer) steer.value = _ctxDraft.steer;
  if (reply && _ctxReplyHeight) reply.style.height = _ctxReplyHeight; // restore the dragged height
  // Re-apply the open state so a toggled reply/retry box stays open across the
  // re-render (otherwise it collapses mid-typing on the 5s refresh).
  const reopen = (ctx, secPrefix, btnPrefix) => {
    if (!_ctxOpen[ctx] && !_ctxDraft[ctx]) return;
    const sec = document.getElementById(secPrefix + _ctxTask);
    const btn = document.getElementById(btnPrefix + _ctxTask);
    if (sec) sec.classList.add("open");
    if (btn) btn.classList.add("active");
  };
  reopen("retry", "retrySection_", "retryToggle_");
  reopen("reply", "replySection_", "replyToggle_");
  const restore = _ctxFocus.active === "retry" ? retry : _ctxFocus.active === "reply" ? reply : _ctxFocus.active === "steer" ? steer : null;
  if (restore && !shouldRestoreCtxFocus()) {
    _ctxFocus = { active: null, start: null, end: null };
    return;
  }
  if (restore) {
    restore.focus();
    if (_ctxFocus.start !== null && _ctxFocus.end !== null) {
      try { restore.setSelectionRange(_ctxFocus.start, _ctxFocus.end); } catch { /* ignore */ }
    }
  }
}
// Load the current draft (review script / result) into the reply box so the
// operator edits it IN PLACE and hits Reply — no copying out of the read-only
// Result section. A long multi-line reply is classified as an edit server-side.
function loadDraftIntoReply() {
  const ta = document.getElementById("replyText");
  if (!ta) return;
  if (!_replyEditSource) { hmToast("Nothing to edit yet.", "err"); return; }
  const sec = document.getElementById("replySection_" + _ctxTask);
  if (sec) sec.classList.add("open");
  _ctxOpen.reply = true;
  ta.value = _replyEditSource;
  _ctxDraft.reply = _replyEditSource;
  ta.style.height = "340px"; _ctxReplyHeight = "340px";
  ta.focus();
  try { ta.setSelectionRange(0, 0); ta.scrollTop = 0; } catch { /* ignore */ }
  hmToast("Draft loaded — edit it and hit Reply to use it as the new script.", "ok");
}
function copyEditSource() {
  if (!_replyEditSource) return;
  navigator.clipboard.writeText(_replyEditSource).then(
    () => hmToast("Copied.", "ok"),
    () => hmToast("Copy failed — select and ⌘C.", "err"),
  );
}
function shouldRestoreCtxFocus() {
  const active = document.activeElement;
  if (!active) return true;
  const session = document.getElementById("session");
  if (!session) return true;
  return active === document.body || session.contains(active);
}
async function onCtxAttach(ctx, input) {
  const files = Array.from(input.files || []);
  const attachNonce = _ctxAttachNonce;
  input.value = "";
  if (!files.length) return;
  _ctxAttachError[ctx] = "";
  _ctxUploading[ctx] = (_ctxUploading[ctx] || 0) + files.length;
  renderCtxChips(ctx);
  for (const f of files) {
    try {
      const saved = await uploadAttachmentFile(f);
      if (attachNonce !== _ctxAttachNonce) continue;
      pushAttachmentRecord(_ctxAttach[ctx], saved);
    } catch (e) {
      if (attachNonce === _ctxAttachNonce) _ctxAttachError[ctx] = "Upload failed";
    } finally {
      if (attachNonce === _ctxAttachNonce) {
        _ctxUploading[ctx] = Math.max(0, (_ctxUploading[ctx] || 0) - 1);
        renderCtxChips(ctx);
      }
    }
  }
}
function removeCtxAttach(ctx, idx) { _ctxAttach[ctx].splice(idx, 1); renderCtxChips(ctx); }
function clearCtxAttachError(ctx) {
  _ctxAttachError[ctx] = "";
  renderCtxChips(ctx);
}
function setCtxSubmitDisabled(ctx) {
  const sec = _ctxTask ? document.getElementById(ctx+"Section_"+_ctxTask) : null;
  const btn = sec ? sec.querySelector(".reply-row button") : null;
  if (btn) btn.disabled = (_ctxUploading[ctx] || 0) > 0 || !!_ctxAttachError[ctx];
}
function renderCtxChips(ctx) {
  const chips = document.getElementById(ctx+"AttachChips");
  const hint = document.getElementById(ctx+"AttachHint");
  if (!chips) return;
  setCtxSubmitDisabled(ctx);
  if (hint) {
    if ((_ctxUploading[ctx] || 0) > 0) hint.textContent = "Uploading…";
    else if (_ctxAttachError[ctx]) hint.innerHTML = esc(_ctxAttachError[ctx]) + ' <button type="button" class="attach-clear" onclick="clearCtxAttachError(\''+ctx+'\')">Continue without failed file</button>';
    else hint.textContent = _ctxAttach[ctx].length ? "" : "No files";
  }
  chips.innerHTML = _ctxAttach[ctx].map((a, i) => {
    const name = attachmentName(a);
    const path = attachmentPath(a);
    return '<div class="attach-chip" title="'+esc(path || name)+'"><span>'+esc(name)+'</span><span class="rm" onclick="removeCtxAttach(\''+ctx+'\','+i+')">×</span></div>';
  }).join("");
}

function toggleRetry(id) {
  const sec = document.getElementById("retrySection_"+id);
  const btn = document.getElementById("retryToggle_"+id);
  if (!sec) return;
  const opening = !sec.classList.contains("open");
  _ctxOpen.retry = opening;
  sec.classList.toggle("open", opening);
  if (btn) btn.classList.toggle("active", opening);
  if (opening) { const ta = document.getElementById("retryText"); if (ta) ta.focus(); }
}
async function submitRetry(id) {
  const ta = document.getElementById("retryText");
  const steer = ta ? ta.value.trim() : "";
  if ((_ctxUploading.retry || 0) > 0) { hmAlert("Wait for attachments to finish uploading."); return; }
  if (_ctxAttachError.retry) { hmAlert("Try attaching failed files again before retrying."); return; }
  const attachments = _ctxAttach.retry.slice();
  await api("/tasks/"+id+"/retry", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ steer, attachments }) });
  _ctxAttach.retry = [];
  _ctxAttachError.retry = "";
  _ctxDraft.retry = "";
  refresh();
}

async function submitSteer(id) {
  const ta = document.getElementById("steerText");
  const message = ta ? ta.value.trim() : "";
  if (!message) { ta && ta.focus(); return; }
  ta.disabled = true;
  const r = await api("/tasks/"+id+"/steer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
  if (r && r.ok) { _ctxDraft.steer = ""; if (ta) ta.value = ""; refresh(); selectTask(id); }
  else { hmAlert(r?.error || "Failed to steer task"); ta.disabled = false; }
}

async function replyTask(id) {
  const el = document.getElementById("replyText");
  let text = el ? el.value.trim() : "";
  if ((_ctxUploading.reply || 0) > 0) { hmAlert("Wait for attachments to finish uploading."); return; }
  if (_ctxAttachError.reply) { hmAlert("Try attaching failed files again before replying."); return; }
  const attachments = _ctxAttach.reply.slice();
  if (!text && !attachments.length) { el && el.focus(); return; }
  el.disabled = true;
  const r = await api("/tasks/"+id+"/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, attachments }) });
  if (r && r.ok) { _ctxAttach.reply = []; _ctxAttachError.reply = ""; _ctxDraft.reply = ""; if (el) el.value = ""; refresh(); selectTask(id); }
  else { hmAlert(r?.error || "Failed to send reply"); el.disabled = false; }
}

// One-click video-review decisions (approve renders + publishes — confirm first).
async function videoReviewAction(id, action) {
  if (action === "approve") {
    if (!await hmConfirm("Approve this script? It renders the HeyGen avatar (~$0.05/sec) and publishes to YouTube.")) return;
  } else if (action === "cancel") {
    if (!await hmConfirm("Cancel this video draft? Nothing is rendered or published.")) return;
  }
  const r = await api("/tasks/"+id+"/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: action }) });
  if (r && r.ok) { hmToast(action === "approve" ? "Approved — rendering + publishing in the background." : "Cancelled.", "ok"); refresh(); selectTask(id); }
  else { hmAlert((r && r.error) || "Action failed"); }
}

function toggleReply(id) {
  const sec = document.getElementById("replySection_"+id);
  const btn = document.getElementById("replyToggle_"+id);
  if (!sec) return;
  const opening = !sec.classList.contains("open");
  _ctxOpen.reply = opening;
  sec.classList.toggle("open", opening);
  if (btn) btn.classList.toggle("active", opening);
  if (opening) { const ta = document.getElementById("replyText"); if (ta) ta.focus(); }
}

// --- Observability (per-task telemetry + totals) ---
let _obsWindow = "7d";
const OBS_LABELS = { "anthropic": "Claude", "openai-codex": "Codex", "local-qwen": "Qwen (local)", "other": "other" };
const OBS_COLORS = { "anthropic": "#c8794f", "openai-codex": "#10a37f", "local-qwen": "#7a5cff", "other": "#8a93a6" };
const OBS_ORDER = { "anthropic": 0, "openai-codex": 1, "local-qwen": 2, "other": 3 };
function obsProvider(model) {
  const m = (model || "").toLowerCase().trim();
  if (/^(codex|chatgpt)/.test(m) || /^(gpt|o[0-9])/.test(m)) return "Codex";
  if (/^(claude|opus|sonnet|haiku)/.test(m)) return "Claude";
  if (/(qwen|mistral|llama|mlx|local|deepseek|gemma|phi|nan)/.test(m)) return "Qwen (local)";
  return "—";
}

/*__EXECUTION_HELPERS_START__*/
function firstText() {
  for (const v of arguments) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
function modelList(output) {
  const rows = output && Array.isArray(output.modelsUsed) ? output.modelsUsed : [];
  return rows.filter(m => typeof m === "string" && m.trim()).map(m => m.trim());
}
function executionModel(task, output) {
  const used = modelList(output);
  return firstText(task && task.model, used[used.length - 1], used[0]);
}
function executionProviderLabel(model) {
  const m = (model || "").toLowerCase().trim();
  if (!m) return "—";
  if (/^(codex|chatgpt)/.test(m) || /^(gpt|o[0-9])/.test(m)) return "ChatGPT/Codex";
  if (/^(claude|opus|sonnet|haiku)/.test(m)) return "Claude";
  if (/(qwen|mistral|llama|mlx|local|deepseek|gemma|phi)/.test(m)) return "Qwen/local";
  if (/(nano|banana|mflux|image)/.test(m)) return "Image";
  return "Other";
}
function titleCaseLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase())
    .trim();
}
function tierRoleLabel(tier) {
  switch (tier) {
    case "frontier-premium": return "Thinking";
    case "frontier": return "Coding";
    case "local-primary": return "Execution";
    case "local-secondary": return "Operational";
    case "nanai": return "Image";
    case "unavailable": return "Waiting";
    default: return "";
  }
}
function modelRoleLabel(model) {
  const m = (model || "").toLowerCase().trim();
  if (!m) return "";
  if (/opus/.test(m)) return "Thinking";
  if (/sonnet|codex|chatgpt|gpt|o[0-9]/.test(m)) return "Coding";
  if (/haiku/.test(m)) return "Lightweight";
  if (/qwen|mistral|llama|mlx|local|deepseek|gemma|phi/.test(m)) return "Operational";
  if (/nano|banana|mflux|image/.test(m)) return "Image";
  return "";
}
function executionRoleLabel(task, output) {
  output = output || {};
  const phase = firstText(output.directivePhase);
  if (phase) return titleCaseLabel(phase);
  const tierRole = tierRoleLabel(output.routedTier);
  if (tierRole) return tierRole;
  return modelRoleLabel(executionModel(task || {}, output)) || "Agent";
}
function executionCoordinatorLabel(task, output) {
  task = task || {}; output = output || {};
  if (output.directivePhase || task.directiveId || output.runId) return "Review Lane / directive";
  if (task.source === "command" || output.command) return "Command launcher";
  if (task.source === "skill" || output.skill) return "Skill launcher";
  if (task.source === "messagebee") return "Message Lane";
  if (task.source === "mailbee") return "Mail Lane";
  if (task.source === "digest") return "Digest";
  return "Standalone task";
}
function executionRow(label, value, wide) {
  return '<div class="exec-cell' + (wide ? ' wide' : '') + '"><span class="ek">' + esc(label)
    + '</span><span class="ev" title="' + esc(String(value || "—")) + '">' + esc(String(value || "—")) + '</span></div>';
}
function taskExecutionPanel(task, output) {
  task = task || {}; output = output || {};
  const model = executionModel(task, output);
  const provider = executionProviderLabel(model);
  const role = executionRoleLabel(task, output);
  const tier = firstText(output.routedTier);
  const roleTier = role + (tier ? " / " + tier : "");
  const models = modelList(output);
  const modelText = models.length ? models.join(" · ") : (model || "—");
  const profile = firstText(task.profile, task.agentType, "auto");
  const agentType = firstText(task.agentType, "auto");
  const coord = executionCoordinatorLabel(task, output);
  return '<section class="exec-panel"><div class="exec-head"><span class="exec-title">Execution</span>'
    + '<span class="exec-provider">' + esc(provider) + '</span></div><div class="exec-grid">'
    + executionRow("role / tier", roleTier, false)
    + executionRow("profile", profile, false)
    + executionRow("agent type", agentType, false)
    + executionRow("coordinator", coord, false)
    + executionRow("models used", modelText, true)
    + '</div></section>';
}
/*__EXECUTION_HELPERS_END__*/

function fmtMs(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return Math.round(ms) + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  return Math.floor(ms / 60000) + "m" + Math.round((ms % 60000) / 1000) + "s";
}
function fmtNum(n) { return n == null ? "—" : Number(n).toLocaleString(); }


// Per-task telemetry strip from the task's own data (no extra fetch). Honors the
// "unavailable not zero" rule: Codex tasks with 0/0 tokens show "—".
function taskTelemetryStrip(t, out) {
  out = out || {};
  const model = t.model || (out.modelsUsed && out.modelsUsed[0]) || "";
  const prov = obsProvider(model);
  let inTok = out.inputTokens, outTok = out.outputTokens;
  if (prov === "Codex" && !inTok && !outTok) { inTok = null; outTok = null; }
  let latency = null;
  if (t.startedAt && t.completedAt) {
    const a = Date.parse(t.startedAt), b = Date.parse(t.completedAt);
    if (!isNaN(a) && !isNaN(b)) latency = Math.max(0, b - a);
  }
  const tps = (outTok && latency) ? Math.round(outTok / (latency / 1000)) : null;
  const cells = [
    ["provider", prov],
    ["tokens", (inTok != null || outTok != null) ? (fmtNum(inTok || 0) + " in / " + fmtNum(outTok || 0) + " out") : "—"],
    ["latency", fmtMs(latency)],
    ["tok/s", tps != null ? tps : "—"],
    ["turns", out.turns != null ? out.turns : "—"],
  ];
  return '<div class="obs-strip">' + cells.map(c =>
    '<span class="obs-cell"><b>' + esc(String(c[1])) + '</b>' + esc(c[0]) + '</span>').join("") + '</div>';
}

async function renderObservability() {
  const el = document.getElementById("observability");
  if (!el) return;
  let data;
  try { data = await api("/observability?limit=1"); } catch (e) { return; }
  if (!data || !data.totals) return;
  const t = data.totals;
  if (!t.runs) { el.innerHTML = '<div class="muted">No task telemetry yet. <button class="linklike" onclick="openObsDashboard()">Open dashboard</button></div>'; return; }
  let html = '<div style="margin-bottom:6px"><button class="linklike" onclick="openObsDashboard()">↗ Full dashboard — graphs &amp; cache</button></div>'
    + '<div class="obs-split">'
    + '<span class="opill">' + t.split.frontier + ' frontier</span>'
    + '<span class="opill local">' + t.split.local + ' local</span>'
    + '<span class="opill">' + fmtNum(t.tokens.total) + ' tok</span>'
    + '</div>';
  html += '<table class="obs-tbl"><tr><th>provider</th><th>runs</th><th>tok in/out</th><th>p50</th><th>p95</th></tr>';
  for (const p of t.byProvider) {
    const label = OBS_LABELS[p.key] || p.key;
    html += '<tr><td>' + esc(label) + '</td><td>' + p.runs + '</td>'
      + '<td>' + fmtNum(p.inputTokens) + ' / ' + fmtNum(p.outputTokens) + '</td>'
      + '<td>' + fmtMs(p.latencyP50Ms) + '</td><td>' + fmtMs(p.latencyP95Ms) + '</td>'
      + '</tr>';
  }
  html += '</table>';
  el.innerHTML = html;
}

// --- Observability dashboard (full-width Settings tab) ---------------------
function openObsDashboard() { openSettings(); switchSettingsTab("observability"); }
function setObsWindow(w) { _obsWindow = w; renderObsDashboard(); }
function obsKpi(v, l) { return '<div class="obs-kpi"><div class="v">' + esc(String(v)) + '</div><div class="l">' + esc(l) + '</div></div>'; }

// Compact number for axes/tooltips (12.3k, 4.1M).
function obsShort(v) {
  v = Math.round(v || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(v);
}
// Round an axis max up to a clean 1/2/5 x 10^n value.
function obsNiceMax(v) {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
function obsBucketLabel(t, unit) {
  if (unit === "hour") return (t || "").slice(11, 13) + ":00";
  return (t || "").slice(5); // MM-DD
}
function obsLegend(providers) {
  return '<div class="obs-legend">' + providers.map(function (pr) {
    return '<span><i style="background:' + (OBS_COLORS[pr] || OBS_COLORS.other) + '"></i>' + esc(OBS_LABELS[pr] || pr) + '</span>';
  }).join("") + '</div>';
}

// Dependency-free stacked-bar SVG: one bar per time bucket, stacked by provider.
function obsStackedBars(points, providers, valueFn, unit) {
  const W = 720, H = 150, padL = 44, padR = 10, padT = 10, padB = 22;
  const n = points.length || 1;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const totals = points.map(function (p) { return providers.reduce(function (s, pr) { return s + (valueFn(p, pr) || 0); }, 0); });
  const niceMax = obsNiceMax(Math.max.apply(null, [1].concat(totals)));
  const bw = plotW / n;
  const barW = Math.max(1, Math.min(bw - 2, bw * 0.78));
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  for (let g = 0; g <= 2; g++) {
    const val = niceMax * g / 2;
    const y = padT + plotH - (val / niceMax) * plotH;
    svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" style="stroke:var(--border)" stroke-width="1"/>';
    svg += '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="9" style="fill:var(--muted)">' + esc(obsShort(val)) + '</text>';
  }
  for (let i = 0; i < n; i++) {
    const p = points[i];
    let acc = 0;
    const x = padL + i * bw + (bw - barW) / 2;
    for (const pr of providers) {
      const v = valueFn(p, pr) || 0;
      if (v <= 0) continue;
      const h = (v / niceMax) * plotH;
      const y = padT + plotH - acc - h;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0.6, h).toFixed(1) + '" fill="' + (OBS_COLORS[pr] || OBS_COLORS.other) + '"><title>' + esc((OBS_LABELS[pr] || pr) + " · " + obsBucketLabel(p.t, unit) + ": " + obsShort(v)) + '</title></rect>';
      acc += h;
    }
  }
  const idxs = n <= 1 ? [0] : [0, Math.floor(n / 2), n - 1];
  for (const i of idxs) {
    const x = padL + i * bw + bw / 2;
    svg += '<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" style="fill:var(--muted)">' + esc(obsBucketLabel(points[i].t, unit)) + '</text>';
  }
  return svg + '</svg>';
}

async function renderObsDashboard() {
  const el = document.getElementById("obsDash");
  if (!el) return;
  document.querySelectorAll("#obs_win button").forEach(function (b) { b.classList.toggle("on", b.dataset.w === _obsWindow); });
  el.innerHTML = '<div class="muted">Loading…</div>';
  let s, detail;
  try {
    const r = await Promise.all([api("/observability/series?window=" + _obsWindow), api("/observability?limit=1")]);
    s = r[0]; detail = r[1];
  } catch (e) { el.innerHTML = '<div class="muted">Could not load telemetry.</div>'; return; }
  if (!s || !s.totals || !s.totals.runs) { el.innerHTML = '<div class="muted">No tasks ran in this window yet.</div>'; return; }

  const providers = (s.providers || []).slice().sort(function (a, b) { return (OBS_ORDER[a] ?? 9) - (OBS_ORDER[b] ?? 9); });
  const tot = s.totals;

  let html = '<div class="obs-cards">'
    + obsKpi(fmtNum(tot.runs), "tasks")
    + obsKpi(obsShort(tot.tokens.input), "input tok")
    + obsKpi(obsShort(tot.tokens.output), "output tok")
    + obsKpi(obsShort(tot.tokens.total), "total tok")
    + '</div>';

  html += '<div class="obs-chart"><h4>Tokens over time</h4><div class="sub">input + output, stacked by provider</div>'
    + obsStackedBars(s.points, providers, function (p, pr) { const c = p.byProvider[pr]; return c ? c.inputTokens + c.outputTokens : 0; }, s.unit)
    + obsLegend(providers) + '</div>';

  html += '<div class="obs-chart"><h4>Tasks over time</h4><div class="sub">runs per ' + (s.unit === "hour" ? "hour" : "day") + ', stacked by provider</div>'
    + obsStackedBars(s.points, providers, function (p, pr) { const c = p.byProvider[pr]; return c ? c.runs : 0; }, s.unit)
    + obsLegend(providers) + '</div>';

  html += '<div class="obs-chart"><h4>Prompt cache</h4><div class="sub">cached input reuse — Claude &amp; Codex cache prompts; local Qwen runs on-device</div>';
  const crows = (s.cache || []).slice().sort(function (a, b) { return (OBS_ORDER[a.provider] ?? 9) - (OBS_ORDER[b.provider] ?? 9); });
  if (!crows.length) html += '<div class="muted">No cache data.</div>';
  for (const c of crows) {
    const label = OBS_LABELS[c.provider] || c.provider;
    if (!c.supported) {
      html += '<div class="obs-cacherow"><span class="cprov">' + esc(label) + '</span>'
        + '<span class="muted" style="font-size:11px">on-device — no prompt cache</span><span class="cnum"></span></div>';
      continue;
    }
    const pct = c.hitRatePct != null ? c.hitRatePct : 0;
    const col = pct >= 50 ? "var(--ok,#4caf50)" : pct >= 20 ? "#f0a500" : "#e05b2c";
    const written = c.cacheCreationTokens > 0 ? " · " + obsShort(c.cacheCreationTokens) + " written" : "";
    html += '<div class="obs-cacherow">'
      + '<span class="cprov">' + esc(label) + '</span>'
      + '<span class="cbar"><i style="width:' + Math.min(100, pct).toFixed(0) + '%;background:' + col + '"></i></span>'
      + '<span class="cnum">' + (c.hitRatePct != null ? c.hitRatePct.toFixed(0) + "% hit" : "—") + " · " + obsShort(c.cacheReadTokens) + " read" + written + '</span>'
      + '</div>';
  }
  html += '</div>';

  if (detail && detail.totals && detail.totals.byProvider && detail.totals.byProvider.length) {
    html += '<div class="obs-chart"><h4>By provider</h4><div class="sub">recent runs · latency percentiles · throughput</div>'
      + '<table class="obs-tbl"><tr><th>provider</th><th>runs</th><th>tok in/out</th><th>p50</th><th>p95</th><th>tok/s</th></tr>';
    for (const p of detail.totals.byProvider) {
      html += '<tr><td>' + esc(OBS_LABELS[p.key] || p.key) + '</td><td>' + p.runs + '</td>'
        + '<td>' + fmtNum(p.inputTokens) + ' / ' + fmtNum(p.outputTokens) + '</td>'
        + '<td>' + fmtMs(p.latencyP50Ms) + '</td><td>' + fmtMs(p.latencyP95Ms) + '</td>'
        + '<td>' + (p.avgTokensPerSec != null ? p.avgTokensPerSec : "—") + '</td></tr>';
    }
    html += '</table></div>';
  }

  el.innerHTML = html;
}

function renderConn() {
  const c = state.conn; if (!c) return;
  document.getElementById("modePill").className = "pill "+c.mode;
  document.getElementById("modePill").textContent = c.mode;
  const posture = c.posture && c.posture.current ? c.posture.current : null;
  const postureHtml = posture ? '<div class="posture">'
    + '<div class="posture-summary">'+esc(posture.summary)+' <span class="muted">('+esc(posture.counts.works)+' works, '+esc(posture.counts.degraded)+' degraded, '+esc(posture.counts.queued)+' queued)</span></div>'
    + posture.capabilities.map(p => '<div class="posture-row">'
      + '<span class="pname">'+esc(p.label || p.id)+'</span>'
      + '<span class="disp '+esc(p.disposition)+'">'+esc(p.disposition)+'</span>'
      + '<span class="pnote">'+esc(p.note)+'</span>'
      + '</div>').join("")
    + '</div>' : '';
  document.getElementById("conn").innerHTML = '<div class="kv">'
    + '<span class="k">mode</span><span>'+esc(c.mode)+'</span>'
    + '<span class="k">override</span><span>'+esc(c.manualOverride||"none")+'</span>'
    + '<span class="k">exhausted</span><span>'+esc((c.exhaustedProviders||[]).join(", ")||"none")+'</span>'
    + '<span class="k">probe fails</span><span>'+esc(c.probeFailures)+'</span>'
    + '<span class="k">reason</span><span>'+esc(c.reason)+'</span></div>'
    + postureHtml;
}

// --- Skills launcher (dropdown + text input + import) -----------------------
// --- Unified Skills & Commands catalog --------------------------------------
// One section over two catalogs: brain-library skills (/skills, run via
// /skills/:name/run) and local profile commands + folder skills (/commands, run
// via /commands/run). A live-search list + a per-item detail panel replace the
// old dropdown-plus-button-wall; import paths are unified into the Add modal.
let _skills = [];        // brain-library skills (/skills)
let _commands = [];      // local profile commands + folder skills (/commands)
let _cmdProjects = [];   // cached project list for the command project picker
let _skSel = '';         // selected catalog key: "lib:<name>" or "local:<invokeName>"
let _addSrc = 'url';     // active Add-modal source tab

async function renderSkillCatalog() {
  try {
    const [a, b] = await Promise.all([api('/skills'), api('/commands')]);
    _skills = (a && a.skills) || [];
    _commands = (b && b.commands) || [];
  } catch (e) { /* transient */ }
  renderSkillList();
  renderSkillDetail();
}
function skCatalog() {
  const lib = _skills.map(s => ({
    source: 'lib', key: 'lib:' + s.name, name: s.name, description: s.description || '',
    kind: s.kind, scope: s.scope, signed: s.signed, trusted: s.trusted, scan: s.scan,
    compat: s.compat, hasInput: s.hasInput, useCount: s.useCount || 0, raw: s,
  }));
  const loc = _commands.map(c => ({
    source: 'local', key: 'local:' + c.invokeName, name: c.displayName || c.invokeName,
    description: c.description || '', kind: c.kind, invokeName: c.invokeName, useCount: 0, raw: c,
  }));
  return lib.concat(loc);
}
function skBadges(it) {
  let b = '<span class="sk-badge src">'
    + (it.source === 'local' ? (it.kind === 'skill' ? 'folder' : 'command') : (it.kind === 'script' ? 'ops' : 'skill'))
    + '</span>';
  if (it.scope) b += '<span class="sk-badge">' + esc(it.scope) + (it.signed ? ' ✓' : '') + '</span>';
  if (it.scan === 'block') b += '<span class="sk-badge err" title="scan blocked — do not run">⛔</span>';
  else if (it.scan === 'warn') b += '<span class="sk-badge warn" title="scan: review">⚠</span>';
  if (it.trusted === false) b += '<span class="sk-badge warn" title="untrusted — trust before agents use it">untrusted</span>';
  if (it.useCount > 0) b += '<span class="sk-badge">' + it.useCount + '×</span>';
  return b;
}
function renderSkillList() {
  const box = document.getElementById('skList');
  if (!box) return;
  const q = ((document.getElementById('skQuery') || {}).value || '').toLowerCase().trim();
  let items = skCatalog();
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    items = items.filter(it => {
      const hay = (it.name + ' ' + it.description + ' ' + (it.kind || '')).toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }
  items.sort((x, y) => (y.useCount - x.useCount) || x.name.localeCompare(y.name));
  if (!items.length) {
    box.innerHTML = '<div class="muted" style="font-size:11px;padding:8px">No skills or commands' + (q ? ' match.' : ' yet — use ＋ Add to import.') + '</div>';
    return;
  }
  box.innerHTML = items.slice(0, 60).map(it => {
    const k = it.key.replace(/'/g, '&#39;');
    return '<div class="sk-row' + (it.key === _skSel ? ' sel' : '') + '" onclick="selectSkill(\'' + k + '\')">'
      + '<div><b>' + esc(it.name) + '</b>' + skBadges(it) + '</div>'
      + (it.description ? '<div class="sk-desc">' + esc(it.description) + '</div>' : '')
      + '</div>';
  }).join('');
}
function selectSkill(key) {
  _skSel = (_skSel === key) ? '' : key; // click selected row again to collapse
  renderSkillList();
  renderSkillDetail();
}
function skSelected() { return skCatalog().find(it => it.key === _skSel) || null; }
function renderSkillDetail() {
  const d = document.getElementById('skDetail');
  if (!d) return;
  const it = skSelected();
  if (!it) { d.style.display = 'none'; d.innerHTML = ''; return; }
  d.style.display = '';
  d.innerHTML = it.source === 'local' ? localDetailHtml(it) : libDetailHtml(it);
  if (it.source === 'local') populateCommandProjects(_cmdProjects);
}
function libMetaLine(s) {
  const scan = s.scan === 'block' ? '<span style="color:var(--err)">⛔ scan: blocked (do not run)</span> · '
    : s.scan === 'warn' ? '<span style="color:var(--warn)">⚠ scan: review</span> · ' : '';
  const untrusted = s.trusted === false ? '<span style="color:var(--warn)">⚠ untrusted (review before agents use it)</span> · ' : '';
  const prov = s.scope ? '[' + esc(s.scope) + (s.signed ? ' ✓signed' : '') + '] ' : '';
  return scan + untrusted + prov
    + 'runs on: ' + esc((s.compat && s.compat.length ? s.compat : ['all']).join(', '))
    + (s.hasInput ? ' · takes input' : '');
}
function libDetailHtml(it) {
  const s = it.raw;
  const untrusted = s.trusted === false;
  return '<div><b>' + esc(it.name) + '</b>' + skBadges(it) + '</div>'
    + '<div class="sk-dmeta">' + libMetaLine(s) + '</div>'
    + (s.hasInput ? '<input id="skInput" placeholder="Text input for the skill (optional)" />' : '')
    + '<div class="sk-run-row">'
    + '<button class="create" onclick="runSelectedSkill()">Run</button>'
    + '<button class="addbtn" onclick="viewSkill()" title="View the skill markdown">View</button>'
    + '</div>'
    + '<pre id="skViewPane" style="display:none;max-height:200px;overflow:auto;font-size:11px;background:var(--code-bg);color:var(--code-text);padding:8px;border-radius:6px;margin-top:6px;white-space:pre-wrap"></pre>'
    + '<div class="sk-more">'
    + '<button class="addbtn" onclick="copySkill()" title="Copy the shareable skill markdown">Copy</button>'
    + '<select id="skPubScope" style="width:auto" title="Scope to publish to"><option value="personal">personal</option><option value="team" selected>team</option><option value="org">org</option><option value="public">public</option></select>'
    + '<button class="addbtn" onclick="publishSelected()" title="Sign &amp; publish to the chosen scope">Publish</button>'
    + (untrusted ? '<button class="addbtn" onclick="trustSelected()" title="Approve so agents may use it">Trust</button>' : '')
    + '<button class="addbtn" onclick="deleteSelected()" title="Delete this skill">🗑 Delete</button>'
    + '</div>';
}
function localDetailHtml(it) {
  const c = it.raw;
  return '<div><b>' + esc(it.name) + '</b>' + skBadges(it) + '</div>'
    + '<div class="sk-dmeta">' + commandMetaChips(c) + '</div>'
    + '<input id="cmdArgs" placeholder="Optional arguments" />'
    + '<div class="sk-proj-row">'
    + '<select id="commandProject" onchange="onCommandProjectChange()"><option value="">Manual path</option></select>'
    + '<input id="commandPath" placeholder="Project path under $HOME" value="$HOME" />'
    + '</div>'
    + '<div class="sk-run-row">'
    + '<button class="command-run create" onclick="runSelectedCommand()">Run</button>'
    + '<button class="addbtn" onclick="inspectCommand()" title="View invoke name, source path, allowed-tools">Inspect</button>'
    + '</div>'
    + '<pre id="cmdViewPane" class="command-view" style="margin:6px 0 0"></pre>';
}
// --- lib-skill actions (operate on the selected catalog item) ---------------
async function viewSkill() {
  const it = skSelected(); if (!it || it.source !== 'lib') return;
  const view = document.getElementById('skViewPane');
  try {
    const d = await api('/skills/' + encodeURIComponent(it.name));
    if (view && d && d.markdown) { view.textContent = d.markdown; view.style.display = 'block'; }
  } catch (e) { /* ignore */ }
}
async function copySkill() {
  const it = skSelected(); if (!it || it.source !== 'lib') return;
  const res = document.getElementById('skStatus');
  try {
    const d = await api('/skills/' + encodeURIComponent(it.name));
    const md = (d && d.markdown) || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(md);
      if (res) res.textContent = 'Copied shareable skill markdown to clipboard.';
    } else {
      const view = document.getElementById('skViewPane');
      if (view) { view.textContent = md; view.style.display = 'block'; }
      if (res) res.textContent = 'Copy the markdown above to share.';
    }
  } catch (e) { if (res) res.textContent = 'Copy failed.'; }
}
async function trustSelected(force) {
  const it = skSelected(); if (!it || it.source !== 'lib') return;
  try {
    const r = await api('/skills/' + encodeURIComponent(it.name) + '/trust', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trusted: true, force: force === true }) });
    if (r && r.requiresForce) {
      const ok = await hmConfirm('⛔ "' + it.name + '" scanned as BLOCKED (risky content). Trust it anyway?', { okLabel: 'Trust anyway' });
      if (ok) return trustSelected(true);
      return;
    }
    await renderSkillCatalog();
  } catch (e) { /* ignore */ }
}
async function deleteSelected() {
  const it = skSelected(); if (!it || it.source !== 'lib') return;
  const ok = await hmConfirm('Delete skill "' + it.name + '"? This removes the file from the brain.', { okLabel: 'Delete' });
  if (!ok) return;
  try { await api('/skills/' + encodeURIComponent(it.name), { method: 'DELETE' }); _skSel = ''; await renderSkillCatalog(); }
  catch (e) { /* ignore */ }
}
async function publishSelected() {
  const it = skSelected(); if (!it || it.source !== 'lib') return;
  const scope = (document.getElementById('skPubScope') || {}).value || 'team';
  const res = document.getElementById('skStatus');
  const ok = await hmConfirm('Sign and publish "' + it.name + '" to the ' + scope + ' scope? This pushes it to that scope\'s git repo.', { okLabel: 'Publish' });
  if (!ok) return;
  if (res) res.textContent = 'Publishing…';
  try {
    const r = await api('/skills/' + encodeURIComponent(it.name) + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }) });
    if (res) res.textContent = r.ok ? ('Published to ' + scope + (r.pushed ? ' (pushed)' : ' (committed)') + ' · signed ' + (r.signedBy || '')) : ('Publish failed: ' + (r.reason || 'error'));
    await renderSkillCatalog();
  } catch (e) { if (res) res.textContent = 'Publish failed.'; }
}
async function syncSkills() {
  const el = document.getElementById('skStatus');
  if (el) el.textContent = 'Syncing…';
  try {
    const r = await api('/skills/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction: 'both' }) });
    const s = r.sync || {}; const f = r.fanout || [];
    const fan = f.map(t => t.id + ':' + t.written).join(' ');
    const per = (s.perScope || []).map(p => p.scope + ' +' + (p.imported||0) + (p.quarantined ? ' (' + p.quarantined + ' to approve)' : '')).join(', ');
    const msg = s.configured
      ? ('synced [' + per + '] · fan-out ' + fan)
      : ('no sources configured (skillsSync.sources) · fan-out ' + fan);
    if (el) el.textContent = msg + ((s.errors && s.errors.length) ? ' · ' + s.errors.length + ' error(s)' : '');
    await renderSkillCatalog();
  } catch (e) { if (el) el.textContent = 'sync failed'; }
}
function toggleTaskSkillPicker() {
  const box = document.getElementById('t_skill_picker');
  if (!box) return;
  const show = box.style.display === 'none';
  box.style.display = show ? '' : 'none';
  if (show) {
    const q = document.getElementById('t_skill_q');
    if (q) { q.value = ''; q.focus(); }
    searchTaskSkills();
  }
}
async function searchTaskSkills() {
  const q = (document.getElementById('t_skill_q') || {}).value || '';
  const box = document.getElementById('t_skill_results');
  if (!box) return;
  try {
    const r = await api('/skills/search?q=' + encodeURIComponent(q));
    const list = r.skills || [];
    if (!list.length) { box.innerHTML = '<div class="muted" style="font-size:11px">No matching skills. Import or create one in the Skills panel.</div>'; return; }
    box.innerHTML = list.slice(0, 40).map(skillPickRow).join('');
  } catch (e) { box.innerHTML = '<div class="muted" style="font-size:11px">search failed</div>'; }
}
function skillPickRow(s) {
  const badges = (s.kind === 'script' ? '<span class="muted">[cmd]</span> ' : '')
    + (s.scan === 'block' ? '<span style="color:var(--err,#e5534b)" title="scan blocked — do not run">⛔</span> ' : '')
    + (s.scope ? '<span class="muted">[' + esc(s.scope) + (s.signed ? ' ✓' : '') + ']</span> ' : '')
    + (s.trusted === false ? '<span style="color:var(--warn)" title="untrusted — approve in Skills panel">⚠</span> ' : '')
    + (s.useCount > 0 ? '<span class="muted">' + s.useCount + '×</span>' : '');
  const nm = esc(s.name).replace(/'/g, '&#39;');
  return '<div style="padding:4px 6px;border-radius:6px;cursor:pointer" onmouseover="this.style.background=\'var(--panel-2)\'" onmouseout="this.style.background=\'\'" onclick="pickTaskSkill(\'' + nm + '\')">'
    + '<b>' + esc(s.name) + '</b> ' + badges
    + '<div class="muted" style="font-size:11px">' + esc(s.description || '') + '</div></div>';
}
function pickTaskSkill(name) {
  const ta = document.getElementById('t_desc');
  if (ta) {
    const ref = 'Use the "' + name + '" skill.';
    ta.value = ta.value.trim() ? (ta.value.trim() + '\n\n' + ref) : ref;
  }
  toggleTaskSkillPicker();
}
// --- run helpers (route by the selected item's source) ----------------------
async function runSelectedSkill() {
  const it = skSelected(); if (!it || it.source !== 'lib') return;
  const input = (document.getElementById('skInput') || {}).value || '';
  const res = document.getElementById('skStatus');
  if (res) res.textContent = 'Launching…';
  try {
    const d = await api('/skills/' + encodeURIComponent(it.name) + '/run',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) });
    if (d && d.kind === 'script' && d.runId) {
      if (res) res.textContent = 'Running script… (deterministic)';
      pollScriptRun(d.runId);
    } else if (d && d.task) {
      if (res) res.textContent = 'Launched skill task ' + (d.task._id || d.task.id || '') + ' — see the board.';
      refresh();
    } else if (res) { res.textContent = (d && d.error) || 'Launched.'; }
  } catch (e) { if (res) res.textContent = 'Error launching skill.'; }
}
async function pollScriptRun(runId) {
  const view = document.getElementById('skViewPane');
  const res = document.getElementById('skStatus');
  for (let i = 0; i < 900; i++) { // up to ~15 min for long builds/releases
    try {
      const d = await api('/skills/runs/' + encodeURIComponent(runId));
      if (view && d) { view.textContent = d.log || ''; view.style.display = 'block'; view.scrollTop = view.scrollHeight; }
      if (d && d.status === 'done') { if (res) res.textContent = 'Script finished (exit ' + d.exitCode + ').'; return; }
    } catch (e) { /* transient */ }
    await new Promise(r => setTimeout(r, 1000));
  }
}
async function runSelectedCommand() {
  const it = skSelected(); if (!it || it.source !== 'local') return;
  const c = it.raw;
  const args = (document.getElementById('cmdArgs') || {}).value || '';
  const projectPath = ((document.getElementById('commandPath') || {}).value || '$HOME').trim() || '$HOME';
  const res = document.getElementById('skStatus');
  if (res) res.textContent = 'Launching /' + c.invokeName + '…';
  try {
    const d = await api('/commands/run',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: c.invokeName, args: args, projectPath: projectPath }) });
    if (d && d.task) { if (res) res.textContent = 'Launched /' + c.invokeName + ' — see the board.'; refresh(); }
    else if (res) { res.textContent = (d && d.error) || 'Launched.'; }
  } catch (e) { if (res) res.textContent = 'Error launching command.'; }
}
function inspectCommand() {
  const it = skSelected(); if (!it || it.source !== 'local') return;
  const c = it.raw;
  const view = document.getElementById('cmdViewPane');
  if (!view) return;
  view.textContent = 'invoke: /' + c.invokeName + '\nkind: ' + c.kind
    + '\ncatalog: local profile catalog'
    + '\nsource: ' + c.sourcePath
    + (c.allowedTools ? '\nallowed-tools: ' + c.allowedTools : '')
    + (c.model ? '\nmodel: ' + c.model : '');
  view.style.display = 'block';
}
// Meta chips for a local command (reused by the detail panel).
function commandMetaChips(c) {
  if (!c) return '<span class="command-chip">No command selected</span>';
  const chips = [
    ["primary", c.kind === "skill" ? "folder skill" : "slash command"],
    ["", "/" + c.invokeName],
  ];
  if (c.model) chips.push(["", "model " + c.model]);
  if (c.argumentHint) chips.push(["", "args " + c.argumentHint]);
  if (c.hasBundledFiles) chips.push(["", String(c.bundledFileCount || 0) + " bundled"]);
  if (c.description) chips.push(["", c.description]);
  return chips.map(([cls, text]) => '<span class="command-chip' + (cls ? ' ' + cls : '')
    + '" title="' + esc(text) + '">' + esc(text) + '</span>').join("");
}
// --- prune (unused skills) --------------------------------------------------
async function loadSkillPrune() {
  const box = document.getElementById('skPrune');
  if (!box) return;
  box.textContent = 'Checking…';
  try {
    const r = await api('/skills/prune');
    const c = r.candidates || [];
    if (!c.length) { box.textContent = 'No unused skills — library is lean.'; return; }
    box.innerHTML = '<div class="muted" style="margin:2px 0">Unused (' + c.length + '):</div>' + c.map(x =>
      '<div class="row" style="gap:6px;align-items:center">'
      + '<span style="flex:1">' + esc(x.name) + ' <span class="muted">— ' + esc(x.reason) + ', ' + x.ageDays + 'd</span></span>'
      + '<button class="addbtn" onclick="archiveSkill(\'' + esc(x.name).replace(/'/g, "&#39;") + '\')">Archive</button></div>'
    ).join('');
  } catch (e) { box.textContent = 'prune check failed'; }
}
async function archiveSkill(name) {
  const ok = await hmConfirm('Archive (delete) skill "' + name + '"? Removes it from the brain library and harness dirs on next sync.', { okLabel: 'Archive' });
  if (!ok) return;
  try { await api('/skills/' + encodeURIComponent(name), { method: 'DELETE' }); loadSkillPrune(); await renderSkillCatalog(); }
  catch (e) { /* ignore */ }
}
// --- Add skills modal (unified import: URL/file · shared scope · local) ------
function openAddSkills() {
  _skillFileContent = null;
  const f = document.getElementById('addUrlFile'); if (f) f.textContent = '';
  const u = document.getElementById('addUrl'); if (u) u.value = '';
  const st = document.getElementById('addStatus'); if (st) st.textContent = '';
  const sh = document.getElementById('addShared'); if (sh) sh.innerHTML = '';
  addTab('url');
  document.getElementById('addSkillOverlay').classList.add('open');
}
function closeAddSkills() { document.getElementById('addSkillOverlay').classList.remove('open'); }
function addTab(src) {
  _addSrc = src;
  ['url', 'shared', 'local'].forEach(s => {
    const tab = document.getElementById('addTab_' + s); if (tab) tab.classList.toggle('active', s === src);
    const pane = document.getElementById('addPane_' + s); if (pane) pane.style.display = (s === src) ? '' : 'none';
  });
}
async function doImportUrl() {
  const url = ((document.getElementById('addUrl') || {}).value || '').trim();
  if (!url && !_skillFileContent) return;
  const st = document.getElementById('addStatus'); if (st) st.textContent = 'Importing…';
  try {
    const body = _skillFileContent ? { content: _skillFileContent } : { url };
    _skillFileContent = null;
    const d = await api('/skills/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const v = d && d.scan && d.scan.verdict;
    const note = v === 'block' ? ' — ⛔ scan BLOCKED (' + ((d.scan.findings || []).map(f => f.rule).join(', ')) + '); review before trusting'
      : v === 'warn' ? ' — ⚠ scan flagged: ' + ((d.scan.findings || []).map(f => f.rule).join(', '))
      : ' (scan: clean)';
    if (st) st.innerHTML = 'Imported (untrusted): ' + esc((d && d.name) || '?') + esc(note);
    const ff = document.getElementById('addUrlFile'); if (ff) ff.textContent = '';
    await renderSkillCatalog();
  } catch (e) { if (st) st.textContent = 'Import failed.'; }
}
async function doBrowseShared() {
  const scope = (document.getElementById('addScope') || {}).value || 'team';
  const box = document.getElementById('addShared');
  if (!box) return;
  box.textContent = 'Browsing ' + scope + '…';
  try {
    const r = await api('/skills/browse?scope=' + encodeURIComponent(scope));
    if (!r.configured) { box.innerHTML = '<div class="muted">No ' + esc(scope) + ' source configured (skillsSync.sources).</div>'; return; }
    const e = r.entries || [];
    if (!e.length) { box.innerHTML = '<div class="muted">No skills shared to ' + esc(scope) + (r.error ? ' (' + esc(r.error) + ')' : '') + '.</div>'; return; }
    box.innerHTML = '<div class="muted" style="margin:2px 0">Shared to ' + esc(scope) + ' (' + e.length + '):</div>' + e.map(function(x) {
      var badges = (x.kind === 'script' ? '<span class="sk-badge src">ops</span> ' : '')
        + (x.signed ? '<span class="sk-badge" title="signed">✓</span> ' : '')
        + (x.scanVerdict === 'block' ? '<span class="sk-badge err" title="scan blocked">⛔</span> ' : (x.scanVerdict === 'warn' ? '<span class="sk-badge warn" title="scan: review">⚠</span> ' : ''));
      var action = x.inLibrary ? '<span class="muted">in library</span>'
        : '<button class="addbtn" onclick="importSharedSkill(\'' + esc(x.scope) + '\',\'' + esc(x.name).replace(/'/g, '&#39;') + '\')">Import</button>';
      return '<div class="row" style="gap:6px;align-items:center;padding:3px 0"><span style="flex:1"><b>' + esc(x.name) + '</b> ' + badges + '<span class="muted">— ' + esc(x.description || '') + '</span></span>' + action + '</div>';
    }).join('');
  } catch (err) { box.innerHTML = '<div class="muted">browse failed</div>'; }
}
async function importSharedSkill(scope, name) {
  const st = document.getElementById('addStatus');
  try {
    const r = await api('/skills/import-remote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: scope, name: name }) });
    if (r && r.ok && r.trusted === false && st) {
      st.textContent = 'Imported "' + name + '" — UNTRUSTED' + (r.scanVerdict === 'block' ? ' (⛔ scan blocked)' : '') + '. Trust it in the list to activate.';
    }
    doBrowseShared();
    await renderSkillCatalog();
  } catch (e) { /* ignore */ }
}
async function doImportLocal() {
  const st = document.getElementById('addStatus'); if (st) st.textContent = 'Importing local skills…';
  try {
    const d = await api('/skills/import-local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (st) st.textContent = 'Imported ' + (d.imported || 0) + ', refined ' + (d.refined || 0)
      + ', skipped ' + (d.skipped || 0)
      + (d.withAssets ? ' · ' + d.withAssets + ' had bundled assets (text only)' : '') + '.';
    await renderSkillCatalog();
  } catch (e) { if (st) st.textContent = 'Import failed.'; }
}

// --- MCP servers (status + restart) -----------------------------------------
async function renderMcp() {
  try {
    const d = await api('/mcp');
    const servers = (d && d.servers) || [];
    const el = document.getElementById('mcp');
    if (!el) return;
    el.innerHTML = servers.length ? servers.map(s => {
      const dot = s.status === 'reachable' ? 'var(--ok)' : (s.status === 'unreachable' ? 'var(--err)' : 'var(--muted)');
      return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0">'
        + '<span style="width:8px;height:8px;border-radius:50%;background:' + dot + ';display:inline-block" title="' + esc(s.detail || s.status) + '"></span>'
        + '<span style="flex:1">' + esc(s.name) + ' <span class="muted" style="font-size:11px">(' + esc(s.transport) + ' · ' + esc(s.status) + ')</span></span>'
        + (s.restartable ? '<button class="addbtn" title="Restart" onclick="restartMcp(\'' + esc(s.name) + '\')">↻</button>' : '')
        + '</div>';
    }).join('') : '<div class="muted" style="font-size:12px">No MCP servers configured. Add them under config.mcpServers, or enable the Azure DevOps feature.</div>';
  } catch (e) { /* transient */ }
}
async function restartMcp(name) {
  try { await api('/mcp/' + encodeURIComponent(name) + '/restart', { method: 'POST' }); }
  catch (e) { /* ignore */ }
  renderMcp();
}

function renderDirectives() {
  const el = document.getElementById("directives");
  if (!state.directives.length) { el.innerHTML = '<div class="muted">None.</div>'; return; }
  el.innerHTML = state.directives.map(d => '<div class="directive">'
    + '<div class="g"><span class="dot '+d.status+'"></span>'+esc(d.goal)+'</div>'
    + '<div class="s">'+esc(d.status)+(d.nextRunAt?' · next '+esc(new Date(d.nextRunAt).toLocaleTimeString()):'')
    + '<span class="directive-actions">'
    + '<button class="sm" onclick="editDirective(\''+d._id+'\')">Edit</button>'
    + '<button class="sm err" onclick="deleteDirective(\''+d._id+'\')">Delete</button>'
    + '</span></div></div>').join("");
}

function fmtUptime(s) {
  if (s == null) return "—";
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  return (d?d+"d ":"")+(h?h+"h ":"")+m+"m";
}
function renderMetrics() {
  const x = state.metrics; if (!x) return;
  const r = x.runs || {};
  document.getElementById("metrics").innerHTML = '<div class="kv">'
    + '<span class="k">uptime</span><span>'+fmtUptime(x.uptimeSeconds)+'</span>'
    + '<span class="k">memory</span><span>'+esc(x.memoryRssMb)+' MB</span>'
    + '<span class="k">runs</span><span>'+esc(r.done||0)+' done · '+esc(r.failed||0)+' failed · '+esc(r.total||0)+' total</span>'
    + '<span class="k">tasks done</span><span>'+esc((x.tasksByStatus||{}).done||0)+'</span>'
    + '<span class="k">tasks failed</span><span>'+esc((x.tasksByStatus||{}).failed||0)+'</span>'
    + '</div>';
}

function renderOnboarding() {
  const o = state.onboarding; if (!o) return;
  const html = o.steps.map(s => {
    const mark = s.state === "done" ? "✓" : "○";
    const cls = s.state === "done" ? "ok" : (s.required ? "err" : "muted");
    const btn = s.state === "done" ? ''
      : ' <button onclick="wizardAction(\''+s.id+'\')" style="margin-left:6px;font-size:11px;padding:1px 7px;cursor:pointer">Set up</button>';
    return '<div class="s" title="'+esc(s.remediation||s.detail)+'">'
      + '<span class="dot '+(s.state==="done"?"done":(s.required?"failed":"sleeping"))+'"></span>'
      + '<span style="color:var(--'+cls+')">'+mark+'</span> '+esc(s.title)
      + (s.required?'':' <span class="muted">(optional)</span>')+btn+'</div>';
  }).join("");
  document.getElementById("onboarding").innerHTML = html
    + '<div class="muted" style="margin-top:6px">'
    + (o.requiredComplete ? '✓ Required setup complete.' : 'First-run setup — complete the required steps below.') + '</div>';
  // Once setup is complete it's just a wall of green checks — collapse it (the
  // operator can still expand it). Only auto-collapse once, so re-opens stick.
  const sec = document.getElementById("setupSec");
  const sum = document.getElementById("setupSummary");
  if (sec && sum) {
    sum.textContent = o.requiredComplete ? "Setup ✓" : "Setup";
    // Once required setup is complete, the wizard is just a wall of green checks —
    // drop it off the rail entirely. It still lives on under Settings → About.
    sec.style.display = o.requiredComplete ? "none" : "";
  }
  const abSetup = document.getElementById("ab_setup");
  if (abSetup) {
    const remaining = o.steps.filter(s => s.required && s.state !== "done").length;
    abSetup.textContent = o.requiredComplete
      ? "✓ Required setup complete."
      : remaining + " required step" + (remaining === 1 ? "" : "s") + " remaining — see the Setup panel on the dashboard.";
  }
}

function toggleContext() {
  const m = document.querySelector('main');
  if (!m) return;
  const collapsed = m.classList.toggle('ctx-collapsed');
  const btn = document.getElementById('ctxToggle');
  if (btn) btn.classList.toggle('on', !collapsed);
  try { localStorage.setItem('hm_ctx_collapsed', collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
}

// Right-panel sections are collapsible <details>; remember each one's open state
// across reloads. (Setup has its own auto-collapse logic, so it's skipped here.)
function wireCtxSections() {
  document.querySelectorAll('details.ctx-sec[id]').forEach((d) => {
    if (d.id === 'setupSec') return;
    const key = 'hm_sec_' + d.id;
    try {
      const saved = localStorage.getItem(key);
      if (saved === '1') d.open = true;
      else if (saved === '0') d.open = false;
    } catch (e) { /* ignore */ }
    d.addEventListener('toggle', () => {
      try { localStorage.setItem(key, d.open ? '1' : '0'); } catch (e) { /* ignore */ }
    });
  });
}
(function applyCtxState() {
  try {
    if (localStorage.getItem('hm_ctx_collapsed') === '1') {
      const m = document.querySelector('main');
      if (m) m.classList.add('ctx-collapsed');
    } else {
      const btn = document.getElementById('ctxToggle');
      if (btn) btn.classList.add('on');
    }
  } catch (e) { /* ignore */ }
})();

// Steps that POST straight to /onboarding/<id> with no extra input.
const NO_INPUT_STEPS = ['config', 'daemon', 'desktopbee'];

// First-run wizard: drive each incomplete step through its POST endpoint.
async function wizardAction(id) {
  try {
    // Message Lane / Mail Lane have their own guided modals.
    if (id === 'messagebee') { openMessageBeeSetup(); return; }
    if (id === 'mailbee') { openMailBeeSetup(); return; }
    let body = {};
    if (id === 'config') {
      body = { config: {} };
    } else if (id === 'brain') {
      const d = await hmPrompt('Canonical brain folder (the one store every model reads):', '~/_GD/brain');
      if (!d) return;
      const sc = await hmConfirm('Also create a ~/brain shortcut pointing at it?', { okLabel: 'Yes' });
      body = { brainRootDir: d, createIfMissing: true, makeShortcut: sc };
    } else if (id === 'local-model') {
      const ep = await hmPrompt('Local model — enter an OpenAI-compatible endpoint (e.g. http://127.0.0.1:1234/v1), or type "cloud-only" to skip local:', 'http://127.0.0.1:1234/v1');
      if (ep === null) return;
      if (ep.trim().toLowerCase() === 'cloud-only') { body = { mode: 'cloud-only' }; }
      else { const m = await hmPrompt('Model id served there:', 'qwen/qwen3.6-27b'); if (!m) return; body = { mode: 'endpoint', endpoint: ep.trim(), modelId: m.trim() }; }
    } else if (id === 'frontier') {
      const k = await hmPrompt('Paste an Anthropic or OpenAI API key (blank = rely on the claude/codex CLI):', '');
      if (k === null) return;
      body = k && k.startsWith('sk-ant') ? { anthropicApiKey: k } : (k ? { openaiApiKey: k } : {});
    } else if (!NO_INPUT_STEPS.includes(id)) {
      // No wizard flow wired for this step yet — don't POST to a missing endpoint silently.
      await hmAlert('This step is configured in Settings — see the step description for what to grant or enable.', 'Setup');
      return;
    }
    const r = await api('/onboarding/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r && r.data && r.data.deepLinks) {
      // Open the TCC panes so the user can grant Accessibility + Screen Recording.
      // (Opened daemon-side — the webview's window.open is a no-op for x-apple URLs.)
      await openSystemPane('accessibility');
      await openSystemPane('screenRecording');
    }
    if (r && r.ok === false) await hmAlert((r.detail || 'failed'), 'Setup: ' + id);
    await refresh();
  } catch (e) { await hmAlert('Setup failed: ' + e, 'Setup'); }
}

// --- Message Lane guided setup ---------------------------------------------
function mbStep() { return (state.onboarding && state.onboarding.steps || []).find(s => s.id === 'messagebee'); }
async function openMessageBeeSetup() {
  document.getElementById('mb_err').textContent = '';
  document.getElementById('mb_status').textContent = '';
  document.getElementById('mb_phone').value = '';
  renderMessageBeeState(null);
  renderIgnoredSenders();
  document.getElementById('mbOverlay').classList.add('open');
  setTimeout(() => document.getElementById('mb_phone').focus(), 30);
  try {
    const r = await api('/messagebee');
    if (r) renderMessageBeeState(r);
  } catch (e) { /* modal can still show onboarding-derived fallback */ }
}
// Show non-allowlisted senders that have texted, each with a one-click Allow —
// catches the common "set up with my number but iMessage sent as my email" case.
async function renderIgnoredSenders() {
  const el = document.getElementById('mb_ignored');
  if (!el) return;
  try {
    const r = await api('/messagebee/ignored');
    const ig = (r && r.ignored) || [];
    if (!ig.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="muted" style="font-size:11px;margin-bottom:3px">Texted but not allowlisted:</div>'
      + ig.map(i => '<div class="mb-ignored-row">'
        + '<span class="mb-ig-addr">' + esc(i.address) + '</span>'
        + (i.text ? '<span class="muted mb-ig-text">"' + esc(i.text) + '"</span>' : '')
        + '<button onclick="allowIgnored(\'' + esc(i.address).replace(/'/g, "\\'") + '\')">Allow</button></div>').join('');
  } catch (e) { el.innerHTML = ''; }
}
async function allowIgnored(address) {
  try {
    await api('/messagebee/allow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) });
    await renderIgnoredSenders();
    const r = await api('/onboarding/messagebee', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enable: true }) });
    if (r && r.data) renderMessageBeeState(r.data);
    document.getElementById('mb_status').textContent = 'Allowlisted ' + address + ' — text again and it will create a task.';
    await refresh();
  } catch (e) { document.getElementById('mb_err').textContent = String(e); }
}
function closeMessageBee() { document.getElementById('mbOverlay').classList.remove('open'); }
// Ask the daemon to open a macOS privacy pane — window.open() is a no-op for the
// x-apple.* URL scheme inside the Tauri/WKWebView, so the native side does it.
const PANE_LABELS = { fullDiskAccess: 'Full Disk Access', accessibility: 'Accessibility', screenRecording: 'Screen Recording', automation: 'Automation' };
async function openSystemPane(pane) {
  try {
    const r = await api('/system/open-pane', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pane }) });
    if (!r || r.ok === false) {
      await hmAlert('Could not open System Settings automatically. Open it manually: System Settings → Privacy & Security → ' + (PANE_LABELS[pane] || pane) + ', then add HiveMatrix.', 'Open System Settings');
      return false;
    }
    return true;
  } catch (e) { await hmAlert('Could not open System Settings: ' + e, 'Open System Settings'); return false; }
}
async function openFullDiskAccess() { await openSystemPane('fullDiskAccess'); }
// Reflect status into the three step marks. data is the POST result (or null = derive from onboarding).
function renderMessageBeeState(data) {
  const fallbackDetail = ((mbStep() || {}).detail || '');
  const fdaReadable = data ? !!data.chatDbReadable : /\b(chat\.db readable|enabled; reading|Messages database readable)\b/i.test(fallbackDetail);
  const enabled = data ? !!data.enabled : ((mbStep() || {}).state === 'done');
  const ids = data ? (data.identities || []) : null;
  const detail = data ? (data.chatDbDetail || '') : fallbackDetail;
  const mark = (el, ok) => { el.textContent = ok ? '✓' : '○'; el.className = 'mb-mark ' + (ok ? 'ok' : 'no'); };
  mark(document.getElementById('mb_fda_mark'), fdaReadable);
  mark(document.getElementById('mb_chan_mark'), enabled);
  document.getElementById('mb_fda_detail').textContent = fdaReadable
    ? 'Granted — HiveMatrix can read Messages.'
    : (detail || 'HiveMatrix needs Full Disk Access to read Messages (chat.db). Grant it, then re-run.');
  if (ids) {
    const allow = ids.filter(i => i.status === 'allowed' || i.status === 'paired');
    mark(document.getElementById('mb_phone_mark'), allow.length > 0);
    document.getElementById('mb_identities').innerHTML = allow.length
      ? allow.map(i => '<span class="mb-chip">' + esc(i.address) + '</span>').join('')
      : '';
  }
}
async function submitMessageBee() {
  const err = document.getElementById('mb_err'); err.textContent = '';
  const status = document.getElementById('mb_status');
  const phone = document.getElementById('mb_phone').value.trim();
  status.textContent = 'Enabling…';
  try {
    const r = await api('/onboarding/messagebee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: true, phone: phone || undefined }),
    });
    if (!r) { err.textContent = 'No response from daemon.'; status.textContent = ''; return; }
    renderMessageBeeState(r.data || {});
    status.textContent = r.detail || (r.ok ? 'Configured.' : 'Done.');
    document.getElementById('mb_phone').value = '';
    await refresh();
  } catch (e) { err.textContent = String(e); status.textContent = ''; }
}

// --- Mail Lane guided setup -------------------------------------------------
let _mlPollTimer = null;
function openMailBeeSetup() {
  document.getElementById('ml_err').textContent = '';
  document.getElementById('ml_status').textContent = '';
  document.getElementById('ml_email').value = '';
  renderMailBeeState(null);
  document.getElementById('mailOverlay').classList.add('open');
  async function pollMl() {
    const data = await api('/mailbee');
    if (data) renderMailBeeState(data);
    if (document.getElementById('mailOverlay').classList.contains('open'))
      _mlPollTimer = setTimeout(pollMl, 3000);
  }
  clearTimeout(_mlPollTimer);
  pollMl();
}
function closeMailBee() {
  clearTimeout(_mlPollTimer);
  _mlPollTimer = null;
  document.getElementById('mailOverlay').classList.remove('open');
}
function renderMailBeeState(data) {
  const mark = (id, ok) => { const el = document.getElementById(id); el.textContent = ok ? '✓' : '○'; el.className = 'mb-mark ' + (ok ? 'ok' : 'no'); };
  const controllable = data ? !!data.mailControllable : false;
  const enabled = data ? !!data.enabled : false;
  mark('ml_auto_mark', controllable);
  mark('ml_chan_mark', enabled);
  document.getElementById('ml_auto_detail').textContent = controllable
    ? 'Granted — HiveMatrix can control Apple Mail.'
    : 'HiveMatrix needs permission to control Mail (read inbox + draft/send). Open Mail, then approve.';
  if (data && data.identities) {
    const trusted = data.identities.filter(i => i.status === 'allowed' || i.status === 'paired');
    mark('ml_trust_mark', trusted.length > 0);
    document.getElementById('ml_identities').innerHTML = trusted.length
      ? trusted.map(i => '<span class="mb-chip">' + esc(i.address) + '</span>').join('') : '';
  }
}
async function submitMailBee() {
  const err = document.getElementById('ml_err'); err.textContent = '';
  const status = document.getElementById('ml_status');
  const email = document.getElementById('ml_email').value.trim();
  status.textContent = 'Enabling…';
  try {
    const r = await api('/onboarding/mailbee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: true, email: email || undefined }),
    });
    if (!r) { err.textContent = 'No response from daemon.'; status.textContent = ''; return; }
    renderMailBeeState(r.data || {});
    status.textContent = r.detail || (r.ok ? 'Configured.' : 'Done.');
    document.getElementById('ml_email').value = '';
    await refresh();
  } catch (e) { err.textContent = String(e); status.textContent = ''; }
}

// Founder-in-the-loop approvals — the unified queue (checkpoint / content / tool
// / stuck) the phone consumes via /approvals/pending. Rendered at the top of the
// context column so the desktop console surfaces the same gates as mobile.
function renderApprovals() {
  const el = document.getElementById("approvals");
  if (!el) return;
  const items = state.approvals || [];
  if (!items.length) { el.innerHTML = ""; return; }
  const label = { checkpoint: "Checkpoint", content: "Content", tool: "Tool", stuck: "Stuck" };
  el.innerHTML = '<div class="appr-wrap"><div class="appr-head">⚠ Approvals <span class="cnt">' + items.length + '</span></div>'
    + items.map((a, i) => {
        const opts = (a.options && a.options.length) ? a.options : ["approve", "deny"];
        const btns = opts.map(o => {
          const cls = (o === "approve" || o === "done") ? " yes" : (o === "deny" || o === "abort") ? " no" : "";
          return '<button class="appr-btn' + cls + '" onclick="resolveApprovalItem(' + i + ',\'' + esc(o) + '\',this)">'
            + esc(o.charAt(0).toUpperCase() + o.slice(1)) + '</button>';
        }).join("");
        return '<div class="appr-item"><div class="ak">' + esc(label[a.kind] || a.kind) + '</div>'
          + '<div class="at">' + esc(a.title || "Approval needed") + '</div>'
          + (a.detail ? '<div class="ad">' + esc(a.detail) + '</div>' : '')
          + '<div class="arow">' + btns + '</div></div>';
      }).join("")
    + '</div>';
}

async function resolveApprovalItem(idx, decision, btn) {
  const a = (state.approvals || [])[idx];
  if (!a) return;
  const item = btn && btn.closest ? btn.closest(".appr-item") : null;
  if (item) item.querySelectorAll(".appr-btn").forEach(b => { b.disabled = true; });
  try {
    await api("/approvals/resolve", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: a.taskId, timestamp: a.timestamp, decision, kind: a.kind }) });
  } catch (e) {
    if (item) item.querySelectorAll(".appr-btn").forEach(b => { b.disabled = false; });
    return;
  }
  refresh();
}

async function refresh() {
  try {
    const [tasks, directives, conn, metrics, onboarding, appr] = await Promise.all([
      api("/tasks"), api("/directives"), api("/connectivity"), api("/metrics"), api("/onboarding"), api("/approvals/pending"),
    ]);
    state.tasks = tasks; state.directives = directives; state.conn = conn; state.metrics = metrics; state.onboarding = onboarding;
    state.approvals = (appr && appr.approvals) || [];
    renderBoard();
    // Center column: drive it right after the board so a later panel error can't
    // leave it stale. selectTask re-fetches the open task; otherwise show overview.
    if (state.selected) selectTask(state.selected); else renderOverview();
    renderConn(); renderDirectives(); renderMetrics(); renderOnboarding();
    renderApprovals(); renderSkillCatalog(); renderMcp(); renderObservability();
  } catch (e) { /* transient */ }
  // Check for updates on every tick (cheap — daemon caches ~60s). Tied to
  // refresh so it fires on SSE activity too, not just a slow background timer
  // the webview may throttle when unfocused.
  checkUpdate();
}

// --- Frontier usage indicator -----------------------------------------------
function fmtTokens(n) { return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? Math.round(n/1e3)+"k" : String(n||0); }

function fmtResets(iso) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "resetting soon";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) { const d = Math.floor(h/24); return "in " + d + "d " + (h%24) + "h"; }
  return "in " + h + "h " + m + "m";
}

function usageBarClass(util) {
  return util >= 80 ? "hi" : util >= 60 ? "warn" : "ok";
}

function renderSubBar(label, win) {
  if (!win) return "";
  const pct = Math.min(100, Math.max(0, win.utilization));
  const cls = usageBarClass(pct);
  return '<div class="urow"><span>' + esc(label) + '</span>'
    + '<span class="um">' + win.remaining.toFixed(1) + '% left · ' + esc(fmtResets(win.resetsAt)) + '</span></div>'
    + '<div class="usage-bar-wrap"><div class="usage-bar"><div class="usage-bar-fill ' + cls + '" style="width:' + pct + '%"></div></div></div>';
}

function renderCodexBar(label, win) {
  if (!win) return "";
  const pct = Math.min(100, Math.max(0, win.utilization || 0));
  const remaining = Math.max(0, 100 - pct);
  const cls = usageBarClass(pct);
  return '<div class="urow"><span>' + esc(label) + '</span>'
    + '<span class="um">' + remaining.toFixed(1) + '% left · ' + esc(fmtResets(win.resetsAt)) + '</span></div>'
    + '<div class="usage-bar-wrap"><div class="usage-bar"><div class="usage-bar-fill ' + cls + '" style="width:' + pct + '%"></div></div></div>';
}

function usagePlanLabel(status) {
  if (!status) return "usage";
  if (status.subscriptionType === "max" && status.rateLimitTier === "default_claude_max_5x") return "Max 5x";
  if (status.subscriptionType) return String(status.subscriptionType).charAt(0).toUpperCase() + String(status.subscriptionType).slice(1);
  return "usage";
}

async function checkUsage(forceRefresh) {
  try {
    const u = await api(forceRefresh ? "/usage?refresh=1" : "/usage");
    if (!u) return;
    const sub = u.subscription;
    const subStatus = u.subscriptionStatus;
    const codexSubscription = u.codexSubscription;
    const pill = document.getElementById("usagePill");

    if (pill) {
      if (sub && (sub.fiveHour || sub.sevenDay)) {
        // Prefer the most-constrained window for the pill label.
        const win = sub.fiveHour ?? sub.sevenDay;
        const pct = win.remaining.toFixed(0);
        pill.textContent = "⚡ " + pct + "% left";
        pill.style.display = "";
        const lines = [];
        if (sub.fiveHour) lines.push("5-hour: " + sub.fiveHour.remaining.toFixed(1) + "% left (" + fmtResets(sub.fiveHour.resetsAt) + ")");
        if (sub.sevenDay) lines.push("7-day:  " + sub.sevenDay.remaining.toFixed(1) + "% left (" + fmtResets(sub.sevenDay.resetsAt) + ")");
        if (sub.sevenDayOpus) lines.push("7-day Opus: " + sub.sevenDayOpus.remaining.toFixed(1) + "% left");
        if (sub.sevenDaySonnet) lines.push("7-day Sonnet: " + sub.sevenDaySonnet.remaining.toFixed(1) + "% left");
        if (u.taskCount > 0) lines.push("", "HiveMatrix: " + u.taskCount + " task(s)");
        pill.title = lines.join("\n");
      } else if (subStatus && subStatus.state !== "missing_credentials") {
        const label = usagePlanLabel(subStatus);
        pill.textContent = "⚡ " + label + " ?";
        pill.style.display = "";
        pill.title = (subStatus.message || "Claude subscription usage left is unavailable.")
          + "\nHiveMatrix: " + (u.taskCount||0) + " task(s)";
      } else {
        // No subscription data — show task count (no dollar amounts).
        pill.textContent = "⚡ " + (u.taskCount||0) + " task" + (u.taskCount===1?"":"s");
        pill.style.display = u.taskCount > 0 ? "" : "none";
        pill.title = "HiveMatrix: " + (u.taskCount||0) + " task(s)\n"
          + (u.byModel||[]).map(m => m.label + ": " + m.tasks + " task" + (m.tasks===1?"":"s")).join("\n");
      }
    }

    const el = document.getElementById("usage");
    if (!el) return;

    let html = '<div class="usage-breakdown">';

    // Subscription remaining rows (Code + Claude share same subscription).
    if (sub && (sub.fiveHour || sub.sevenDay || sub.sevenDayOpus || sub.sevenDaySonnet)) {
      html += '<div class="urow"><span><b>Claude subscription</b></span><span class="um">remaining allotment</span></div>';
      html += renderSubBar("5-hour rolling", sub.fiveHour);
      html += renderSubBar("7-day overall", sub.sevenDay);
      html += renderSubBar("7-day Opus", sub.sevenDayOpus);
      html += renderSubBar("7-day Sonnet", sub.sevenDaySonnet);
    } else if (subStatus && subStatus.state !== "missing_credentials") {
      html += '<div class="urow"><span><b>Claude subscription</b></span><span class="um">' + esc(usagePlanLabel(subStatus)) + '</span></div>'
        + '<div class="muted" style="font-size:11px">' + esc(subStatus.message || "Usage left unavailable.") + '</div>'
        + (String(subStatus.message || "").includes("claude auth login")
          ? '<button id="claudeAuthLogin" class="usage-action" onclick="runClaudeAuthLogin()">Run Claude login</button>'
          : '');
    }

    if (codexSubscription) {
      if ((sub && (sub.fiveHour || sub.sevenDay || sub.sevenDayOpus || sub.sevenDaySonnet)) || (subStatus && subStatus.state !== "missing_credentials")) {
        html += '<div class="usep"></div>';
      }
      const codexPlan = codexSubscription.planType ? String(codexSubscription.planType) : "subscription";
      html += '<div class="urow"><span><b>Codex subscription</b></span><span class="um">' + esc(codexPlan) + '</span></div>';
      if (codexSubscription.fiveHour || codexSubscription.sevenDay) {
        html += renderCodexBar("5-hour rolling", codexSubscription.fiveHour);
        html += renderCodexBar("7-day overall", codexSubscription.sevenDay);
      } else {
        html += '<div class="muted" style="font-size:11px">' + esc(codexSubscription.error || "Usage unavailable.") + '</div>';
      }
    }

    // HiveMatrix task usage (counts + tokens; no dollar amounts).
    if (u.byModel && u.byModel.length) {
      if ((sub && (sub.fiveHour || sub.sevenDay)) || (subStatus && subStatus.state !== "missing_credentials") || codexSubscription) html += '<div class="usep"></div>';
      html += '<div class="urow"><span><b>' + u.taskCount + '</b> task' + (u.taskCount===1?'':'s') + '</span>'
        + '<span class="um">' + fmtTokens(u.inputTokens) + ' in / ' + fmtTokens(u.outputTokens) + ' out</span></div>'
        + u.byModel.map(m => '<div class="urow"><span>' + esc(m.label) + '</span>'
          + '<span class="um">' + m.tasks + ' task' + (m.tasks===1?'':'s') + '</span></div>').join("");
    } else if (!sub || (!sub.fiveHour && !sub.sevenDay)) {
      html += '<div class="muted">No frontier usage yet — local Qwen work runs on-device.</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  } catch (e) { /* transient */ }
}

// Local engine + embeddings status for the "Models" panel. Local-engine tier
// detail comes from the (already-loaded) global models object; the serving supervisor
// and embeddings status are cheap polls. Also drives the header "local" pill.
async function checkModels() {
  const el = document.getElementById("modelStatus");
  if (!el || !models) return;
  let serving = null, emb = null;
  try { [serving, emb] = await Promise.all([api("/local-model/status"), api("/embeddings")]); } catch (e) { /* transient */ }

  const le = models.localEngine, cap = models.localEngineCapability;
  let html = "";

  // — Local (on-device) —
  if (le || (cap && !cap.localCapable)) {
    html += '<div class="mdl-grp">Local · on-device</div>';
    html += renderLocalEngine(le, cap) || "";
    if (serving && serving.managed) {
      const bits = [];
      if (serving.modelId) bits.push(esc(serving.modelId));
      if (serving.restarts) bits.push(serving.restarts + " restart" + (serving.restarts === 1 ? "" : "s"));
      if (serving.lastError) bits.push('<span style="color:var(--err)">' + esc(serving.lastError) + '</span>');
      if (bits.length) html += '<div class="muted" style="font-size:11px;margin:2px 0 6px 2px">' + bits.join(" · ") + '</div>';
    }
  }

  // — Embeddings (shared with Brainpower) —
  if (emb) {
    html += '<div class="mdl-grp">Embeddings <span style="font-weight:400;text-transform:none;letter-spacing:0">· shared with Brainpower</span></div>';
    if (emb.model) {
      const dot = emb.enabled ? '<span style="color:var(--ok)">●</span>' : '<span style="color:var(--muted)">○</span>';
      html += '<div class="backend"><span class="nm">' + dot + " " + esc(emb.model) + '</span>'
        + '<span class="st ' + (emb.enabled ? "ok" : "no") + '">' + (emb.enabled ? "✓ on" : "off") + '</span></div>'
        + '<div class="muted" style="font-size:11px;margin:2px 0 6px 2px">'
        + esc((emb.indexedDocs || 0) + " doc" + (emb.indexedDocs === 1 ? "" : "s") + " indexed")
        + (emb.endpoint ? " · " + esc(emb.endpoint) : "")
        + (emb.enabled ? ' &nbsp; <button class="linklike" onclick="reindexEmbeddings()">Reindex</button>' : "")
        + '</div>';
    } else {
      html += '<div class="muted" style="font-size:11px;margin:2px 0 6px 2px">Not configured — set <code>embeddings</code> in ~/.hivematrix/config.json (shares Brainpower\'s qwen3-embedding model over the same brain).</div>';
    }
  }

  // — Frontier (cloud) — the bars below (#usage) are filled by checkUsage().
  html += '<div class="mdl-grp">Frontier · cloud</div>';
  el.innerHTML = html;

  // Header pill — at-a-glance "is the local engine running".
  const pill = document.getElementById("localPill");
  if (pill) {
    if (le && (!cap || cap.localCapable)) {
      const up = !!le.up;
      const live = (le.tiers || []).filter(t => t.healthy).map(t => t.key);
      pill.textContent = up ? "🧠 local ●" : "🧠 local ○";
      pill.style.display = "";
      pill.title = up
        ? "Local engine running" + (live.length ? " — " + live.join(", ") : "")
        : "Local engine not running";
    } else {
      pill.style.display = "none";
    }
  }
}

async function reindexEmbeddings() {
  hmToast("Reindexing brain…", "ok");
  try {
    const r = await api("/embeddings/reindex", { method: "POST" });
    if (r && r.error) hmToast(r.error, "err");
    else hmToast("Reindexed " + (r?.indexed || 0) + " doc(s)" + (r?.pruned ? ", pruned " + r.pruned : ""), "ok");
  } catch (e) { hmToast("Reindex failed", "err"); }
  checkModels();
}

async function refreshModelsNow() {
  const btn = document.getElementById("usageRefresh");
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  try {
    await loadModels();                          // refresh local-engine tier health
    await Promise.all([checkModels(), checkUsage(true)]);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "↻"; }
  }
}

async function runClaudeAuthLogin() {
  const btn = document.getElementById("claudeAuthLogin");
  if (btn) { btn.disabled = true; btn.textContent = "Opening Terminal…"; }
  try {
    const r = await api("/claude/auth/login", { method: "POST" });
    if (!r || !r.ok) {
      await hmAlert(r?.detail || r?.error || "Could not start Claude auth login.");
    } else {
      await hmAlert("Terminal opened for Claude login. Complete it there, then click the Models panel refresh button.");
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Run Claude login"; }
  }
}

// --- Update indicator -------------------------------------------------------
async function checkUpdate(force) {
  const abStatus = document.getElementById("ab_update");
  const abBtn = document.getElementById("ab_update_btn");
  if (force && abStatus) abStatus.textContent = "checking…";
  try {
    const s = await api(force ? "/update/status?refresh=1" : "/update/status");
    const pill = document.getElementById("updatePill");
    const has = !!(s && s.updateAvailable && s.latest);
    if (pill) {
      if (has) { pill.textContent = "⬆ Update " + s.latest; pill.dataset.latest = s.latest; pill.style.display = ""; }
      else { pill.style.display = "none"; }
    }
    // About tab reflection.
    if (abStatus) abStatus.textContent = has ? ("update available — " + s.latest) : "up to date";
    if (abBtn) abBtn.style.display = has ? "" : "none";
  } catch (e) {
    if (abStatus) abStatus.textContent = "couldn't check (offline?)";
  }
}
async function applyUpdate() {
  const pill = document.getElementById("updatePill");
  const latest = (pill && pill.dataset.latest) || "the latest version";
  if (!await hmConfirm("Install HiveMatrix " + latest + " now? The app will restart to apply it.", { okLabel: "Install & restart" })) return;
  try {
    const r = await api("/update/apply", { method: "POST" });
    if (r && r.ok === false) { await hmAlert(r.detail || "Could not start the update.", "Update"); return; }
    if (pill) { pill.textContent = "⏳ Updating…"; pill.style.cursor = "default"; }
  } catch (e) { await hmAlert("Could not start the update: " + e, "Update"); }
}

document.getElementById("modeSel").addEventListener("change", async (e) => {
  await api("/connectivity/mode", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ mode: e.target.value || null }) });
  refresh();
});

function toggleForm(id) { document.getElementById(id).classList.toggle("open"); }
function cancelForm(id) { document.getElementById(id).classList.remove("open"); }

// --- Models / Settings ---
let models = null;            // { backends, available, defaultModel, version }
const modelById = {};         // UiModel.id → {modelId, fast}

// Live status of the local inference engine (Rapid-MLX) + each tier, so you can
// see at a glance that local is up and serving everything.
function renderLocalEngine(le, cap) {
  if (!le) return "";
  const name = le.engine === "rapid-mlx" ? "Rapid-MLX" : le.engine === "ollama" ? "Ollama" : "LM Studio";
  const capByKey = {};
  if (cap && cap.tiers) for (const t of cap.tiers) capByKey[t.key] = t;
  const tiers = (le.tiers || []).map(t => {
    const c = capByKey[t.key];
    const grey = c && !c.residentCapable; // hardware can't keep this tier resident
    const body = (t.healthy ? '<span style="color:var(--ok)">●</span>' : '<span style="color:var(--muted)">○</span>')
      + ' ' + esc(t.key) + ' — ' + esc(t.alias) + ' :' + t.port
      + ' · reasoning ' + (t.reasoning ? 'on' : 'off') + (t.healthy ? '' : ' · not running')
      + (grey && c.reason ? ' · <span style="color:#c8922b">' + esc(c.reason) + '</span>' : '');
    return grey ? '<span style="opacity:.5" title="' + esc(c.reason || '') + '">' + body + '</span>' : body;
  }).join(' &nbsp;&nbsp; ');
  let foot = '';
  if (cap && !cap.localCapable) {
    foot = '<div class="muted" style="font-size:11px;color:#c8922b;margin:2px 0 6px 2px">' + esc(cap.reason || 'Local models unavailable on this Mac — running cloud-only.') + '</div>';
  } else if (cap && cap.recommendedTiers && cap.recommendedTiers.length) {
    foot = '<div class="muted" style="font-size:11px;margin:2px 0 6px 2px">Recommended for this Mac (' + Math.round(cap.ramGB || 0) + ' GB): <b>' + esc(cap.recommendedTiers.join(' + ')) + '</b> resident.</div>';
  }
  return '<div class="backend"><span class="nm">Local engine — ' + name + '</span>'
    + '<span class="st ' + (le.up ? 'ok' : 'no') + '">' + (le.up ? '✓ running' : 'not running') + '</span></div>'
    + (tiers ? '<div class="muted" style="font-size:11px;margin:2px 0 6px 2px">' + tiers + '</div>' : '')
    + foot;
}

// One-click provisioner: sizes Rapid-MLX to this Mac, installs it, pulls the
// models that fit, writes config. Shown only when the Mac can run local.
function renderProvisionUI(cap) {
  if (!cap || !cap.localCapable) return "";
  const profile = (cap.recommendedTiers || []).join(" + ");
  return '<div style="margin:6px 0 4px 2px">'
    + '<button id="provisionBtn" class="create" onclick="provisionLocalEngine()" style="font-size:12px">Provision local engine</button>'
    + '<span class="muted" style="font-size:11px;margin-left:8px">Installs Rapid-MLX + pulls ' + esc(profile) + ' for this Mac.</span>'
    + '<div id="provisionLog" style="margin-top:4px"></div></div>';
}

async function provisionLocalEngine() {
  const btn = document.getElementById("provisionBtn");
  if (btn) btn.disabled = true;
  try { await api("/local-engine/provision", { method: "POST" }); } catch (e) {}
  pollProvision();
}

async function pollProvision() {
  let r;
  try { r = await api("/local-engine/provision"); } catch (e) { return; }
  const s = (r && r.status) || {};
  const el = document.getElementById("provisionLog");
  if (el) {
    const log = (s.log || []).join("\n");
    const tail = s.phase === "error" ? "\n✗ " + (s.error || "failed") : s.phase === "done" ? "\n✓ done — restart the daemon to serve the new tiers" : "";
    el.innerHTML = '<pre class="muted" style="font-size:11px;white-space:pre-wrap;max-height:160px;overflow:auto;margin:2px 0">' + esc(log + tail) + "</pre>";
  }
  if (s.phase === "running") { setTimeout(pollProvision, 1500); return; }
  const btn = document.getElementById("provisionBtn");
  if (btn) btn.disabled = false;
}

function applyTheme(theme, hasWallpaper) {
  const root = document.documentElement;
  let resolved = theme;
  if (theme === "system") resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  root.dataset.theme = resolved;
  const isMatrix = resolved === "matrix";
  // Panel translucency (--wp-opacity) applies over a wallpaper image OR the Matrix rain.
  if (hasWallpaper || isMatrix) {
    const op = (models && typeof models.wallpaperOpacity === "number") ? models.wallpaperOpacity : 82;
    root.style.setProperty("--wp-opacity", op + "%");
  }
  if (hasWallpaper) {
    root.dataset.wallpaper = "1";
    document.body.style.backgroundImage = 'url("/wallpaper?token=' + encodeURIComponent(HM_TOKEN) + '&t=' + Date.now() + '")';
  } else {
    delete root.dataset.wallpaper;
    document.body.style.backgroundImage = "";
  }
  if (isMatrix) startMatrixRain(); else stopMatrixRain();
}

// --- Matrix theme: animated falling-code canvas ---
let _matrixRAF = null;
let _matrixResize = null;
function startMatrixRain() {
  const c = document.getElementById("matrixRain");
  if (!c) return;
  if (_matrixRAF) return; // already running
  const ctx = c.getContext("2d");
  const fontSize = 16;
  const glyphs = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃ0123456789ABCDEF<>/\\{}[]#$%*".split("");
  let cols = 0, drops = [];
  function reset() {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    cols = Math.ceil(c.width / fontSize);
    drops = new Array(cols).fill(0).map(() => Math.random() * -60);
  }
  reset();
  _matrixResize = reset;
  window.addEventListener("resize", _matrixResize);
  let last = 0;
  const STEP_MS = 90; // throttle to a calm, classic stepped cadence (not 60fps)
  function frame(ts) {
    _matrixRAF = requestAnimationFrame(frame);
    if (ts - last < STEP_MS) return;
    last = ts;
    ctx.fillStyle = "rgba(1,10,5,0.10)"; // trail fade toward the bg colour
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = fontSize + "px ui-monospace, Menlo, monospace";
    for (let i = 0; i < drops.length; i++) {
      const ch = glyphs[(Math.random() * glyphs.length) | 0];
      const x = i * fontSize, y = drops[i] * fontSize;
      ctx.fillStyle = Math.random() < 0.025 ? "#d7ffe6" : "#33e86f"; // bright leading glyph now and then
      ctx.fillText(ch, x, y);
      if (y > c.height && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 1;
    }
    _matrixRAF = requestAnimationFrame(frame);
  }
  _matrixRAF = requestAnimationFrame(frame);
}
function stopMatrixRain() {
  if (_matrixRAF) { cancelAnimationFrame(_matrixRAF); _matrixRAF = null; }
  if (_matrixResize) { window.removeEventListener("resize", _matrixResize); _matrixResize = null; }
  const c = document.getElementById("matrixRain");
  if (c) { const ctx = c.getContext("2d"); ctx && ctx.clearRect(0, 0, c.width, c.height); }
}

async function loadModels() {
  models = await api("/models");
  if (!models) return;
  applyTheme(models.theme || "system", !!models.hasWallpaper);
  for (const m of models.available) modelById[m.id] = { modelId: m.modelId, fast: !!m.fast };
  // Populate the New Task dropdown, grouped intent-first.
  const sel = document.getElementById("t_model");
  const catOf = m => m.backend === "mixed" ? "Recommended" : m.backend === "local" ? "Local (on-device)" : "Cloud frontier";
  const order = ["Recommended", "Local (on-device)", "Cloud frontier"];
  const groups = {};
  for (const m of models.available) { (groups[catOf(m)] = groups[catOf(m)] || []).push(m); }
  const opt = m => '<option value="'+esc(m.id)+'">'+esc(m.name)+(m.note?' — '+esc(m.note):'')+'</option>';
  sel.innerHTML = order.filter(g => groups[g]).map(g =>
    '<optgroup label="'+g+'">'+groups[g].map(opt).join("")+'</optgroup>').join("")
    || '<option value="">(no models configured)</option>';
  // Default selection
  const def = models.available.find(m => m.modelId === models.defaultModel || m.id === models.defaultModel);
  if (def) sel.value = def.id;
  // Refresh the Models panel now that local-engine tier health is loaded.
  checkModels();
}

// --- Projects ---
let projectDropdownSort = "recent";  // "recent" | "name"
let projectDropdownItems = [];       // full list of {name, path, preSelect, lastModified}
let selectedProjectName = "";        // currently selected project in the task form

function sortProjectItems(items, mode) {
  if (mode === "name") return items.slice().sort((a, b) => a.name.localeCompare(b.name));
  // "recent": by lastModified desc, then name asc
  return items.slice().sort((a, b) => {
    const tA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const tB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    if (tB !== tA) return tB - tA;
    return a.name.localeCompare(b.name);
  });
}

function renderProjectDropdown() {
  const search = (document.getElementById("t_project_search")?.value || "").toLowerCase();
  const listEl = document.getElementById("t_project_list");
  const emptyEl = document.getElementById("t_project_empty");
  if (!listEl) return;

  const filtered = projectDropdownItems.filter(p => p.name.toLowerCase().includes(search));
  const sorted = sortProjectItems(filtered, projectDropdownSort);

  if (!sorted.length) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("hidden");

  listEl.innerHTML = sorted.map(p => {
    const timeStr = p.lastModified ? new Date(p.lastModified).toLocaleDateString() : "";
    return '<div class="project-item'+(selectedProjectName===p.name?' selected':'')+'" onclick="selectProjectFromDropdown(\''+esc(p.name)+'\',\''+esc(p.path)+'\')">'
      + (p.preSelect ? '<span class="pstar">★</span>' : '')
      + '<span class="pname">'+esc(p.name)+'</span>'
      + (timeStr ? '<span class="ptime">'+esc(timeStr)+'</span>' : '')
      + '</div>';
  }).join("");
}

function filterProjectDropdown() {
  renderProjectDropdown();
}

function sortProjectsDropdown(mode) {
  projectDropdownSort = mode;
  document.querySelectorAll(".project-sort-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.sort === mode);
  });
  renderProjectDropdown();
}

function openProjectDropdown() {
  const dd = document.getElementById("t_project_dropdown");
  if (dd) dd.classList.remove("hidden");
  renderProjectDropdown();
}

function closeProjectDropdown() {
  const dd = document.getElementById("t_project_dropdown");
  if (dd) dd.classList.add("hidden");
}

function selectProjectFromDropdown(name, path) {
  selectedProjectName = name;
  const search = document.getElementById("t_project_search");
  if (search) search.value = name;
  const pathInput = document.getElementById("t_path");
  if (pathInput) pathInput.value = path;
  closeProjectDropdown();
}

function syncCommandProject(name, path) {
  const input = document.getElementById("commandPath");
  if (input && path) input.value = path;
  const sel = document.getElementById("commandProject");
  if (!sel) return;
  const opt = Array.from(sel.options).find(o => o.value === name || o.dataset.path === path);
  sel.value = opt ? opt.value : "";
}

function populateCommandProjects(projects) {
  if (projects && projects.length) _cmdProjects = projects; // cache for the detail panel
  const sel = document.getElementById("commandProject");
  if (!sel) return;
  const pathInput = document.getElementById("commandPath");
  const previousPath = (pathInput && pathInput.value) || "";
  const previousName = sel.value;
  sel.innerHTML = '<option value="">Manual path</option>'
    + projects.map(p => '<option value="'+esc(p.name)+'" data-path="'+esc(p.path)+'">'+esc(p.name)+(p.preSelect?' ★':'')+'</option>').join("");

  const chosen = projects.find(p => previousPath && p.path === previousPath)
    || projects.find(p => previousName && p.name === previousName)
    || (state.selectedProject ? projects.find(p => p.name === state.selectedProject) : null)
    || projects.find(p => p.preSelect)
    || projects[0];
  if (chosen && pathInput && (!previousPath || previousPath === "$HOME" || previousPath === "/tmp")) {
    syncCommandProject(chosen.name, chosen.path);
  } else if (chosen) {
    sel.value = chosen.name;
  }
}

function onCommandProjectChange() {
  const sel = document.getElementById("commandProject");
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const path = opt && opt.dataset ? opt.dataset.path : "";
  if (path) syncCommandProject(opt.value, path);
}

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("t_project_wrapper");
  if (wrapper && !wrapper.contains(e.target)) closeProjectDropdown();
});

async function loadProjects(fresh) {
  try {
    const data = await api("/projects" + (fresh ? "?fresh=1" : ""));
    if (!data || !Array.isArray(data.projects)) return;
    state.projects = data.projects;
    // Populate header project selector
    const sel = document.getElementById("projectSel");
    const prev = sel.value;
    sel.innerHTML = '<option value="">(all projects)</option>'
      + data.projects.map(p => '<option value="'+esc(p.name)+'" data-path="'+esc(p.path)+'">'+esc(p.name)+(p.preSelect?' ★':'')+'</option>').join("");
    // Restore only an explicit user choice — never auto-select on startup.
    // The ★ project still pre-fills New Task path but never filters the board.
    const saved = localStorage.getItem("hm_project");
    if (saved && sel.querySelector('option[value="'+CSS.escape(saved)+'"]')) {
      sel.value = saved;
      state.selectedProject = saved;
    }
    // Populate New Task project search dropdown
    projectDropdownItems = data.projects.map(p => ({
      name: p.name,
      path: p.path,
      preSelect: !!p.preSelect,
      lastModified: p.lastModified || "",
    }));
    populateCommandProjects(data.projects);
    const preSelected = data.projects.find(p => p.preSelect);
    if (preSelected) {
      selectedProjectName = preSelected.name;
      document.getElementById("t_project_search").value = preSelected.name;
      document.getElementById("t_path").value = preSelected.path;
    }
    renderProjectDropdown();
    // If a filter was restored, also sync the task form path
    if (state.selectedProject) {
      const activeOpt = sel.options[sel.selectedIndex];
      if (activeOpt && activeOpt.dataset.path) {
        document.getElementById("t_path").value = activeOpt.dataset.path;
        syncCommandProject(state.selectedProject, activeOpt.dataset.path);
      }
    }
  } catch (e) { /* transient */ }
}

document.getElementById("projectSel").addEventListener("change", async (e) => {
  state.selectedProject = e.target.value;
  localStorage.setItem("hm_project", e.target.value);
  renderBoard();
  // Sync task-form project path when header project changes
  const opt = e.target.options[e.target.selectedIndex];
  if (opt && opt.dataset.path) {
    document.getElementById("t_path").value = opt.dataset.path;
    syncCommandProject(e.target.value, opt.dataset.path);
  }
});

function onProjectSelect() {
  // Legacy hook — no-op now that we use the search dropdown
}

let _attachments = [];
let _attachUploading = 0;
let _attachError = "";
async function onAttachFiles(input) {
  const files = Array.from(input.files || []);
  input.value = "";  // allow re-selecting the same file
  if (!files.length) return;
  _attachError = "";
  _attachUploading += files.length;
  renderAttachChips();
  for (const f of files) {
    try {
      pushAttachmentRecord(_attachments, await uploadAttachmentFile(f));
    } catch (e) {
      _attachError = "Upload failed";
    } finally {
      _attachUploading = Math.max(0, _attachUploading - 1);
      renderAttachChips();
    }
  }
}
function removeAttach(idx) {
  _attachments.splice(idx, 1);
  renderAttachChips();
}
function clearAttachError() {
  _attachError = "";
  renderAttachChips();
}
function setAttachmentSubmitDisabled() {
  const btn = document.querySelector("#taskForm .create");
  if (btn) btn.disabled = _attachUploading > 0 || !!_attachError;
}
function renderAttachChips() {
  const chips = document.getElementById("t_attach_chips");
  const hint = document.getElementById("t_attach_hint");
  setAttachmentSubmitDisabled();
  if (_attachUploading > 0) hint.textContent = "Uploading…";
  else if (_attachError) hint.innerHTML = esc(_attachError) + ' <button type="button" class="attach-clear" onclick="clearAttachError()">Continue without failed file</button>';
  else hint.textContent = _attachments.length ? "" : "No files selected";
  chips.innerHTML = _attachments.map((a, i) => {
    const name = attachmentName(a);
    const path = attachmentPath(a);
    return '<div class="attach-chip" title="'+esc(path || name)+'"><span>'+esc(name)+'</span><span class="rm" onclick="removeAttach('+i+')">×</span></div>';
  }).join("");
}

function openSettings() {
  document.getElementById("settingsOverlay").classList.add("open");
  switchSettingsTab("models"); // land on the most-used config, not About
  if (!models) return;
  const sd = document.getElementById("s_default");
  sd.innerHTML = models.available.map(m => '<option value="'+esc(m.modelId)+'">'+esc(m.name)+'</option>').join("");
  if (models.defaultModel) sd.value = models.defaultModel;
  document.getElementById("s_backends").innerHTML = models.backends.map(b =>
    '<div class="backend"><span class="nm">'+esc(b.name)+'</span>'
    + '<span class="st '+(b.configured?'ok':'no')+'">'+(b.configured?'✓ '+esc(b.detail):'not set up')+'</span>'
    + (b.configured?'':'<span class="muted" style="flex:1"> — '+esc(b.connect||'')+'</span>')+'</div>').join("")
    + renderLocalEngine(models.localEngine, models.localEngineCapability)
    + renderProvisionUI(models.localEngineCapability);
  const local = models.backends.find(b => b.id === "local");
  document.getElementById("s_endpoint").value = (local && local.endpoint) || "http://localhost:1234/v1";
  const v = models.version || {};
  document.getElementById("s_version").textContent = "HiveMatrix v" + (v.version||"?") + " · build " + (v.build||"?") + " · " + (v.date||"?");
  document.getElementById("s_theme").value = models.theme || "system";
  document.getElementById("s_app_icon").value = models.appIconChoice || "dark-green";
  const iconStatus = document.getElementById("app_icon_status");
  if (iconStatus) iconStatus.textContent = "";
  document.getElementById("s_token").value = HM_TOKEN || "(load the local console to see the token)";
  // Wallpaper: reflect the current image + path so settings shows what's active.
  const hasWp = !!models.hasWallpaper;
  document.getElementById("s_wallpaper").value = hasWp ? (models.wallpaperPath || "") : "";
  if (hasWp) showWallpaperPreview(); else document.getElementById("wallpaper_preview").style.display = "none";
  document.getElementById("wallpaper_opacity_row").style.display = (hasWp || models.theme === "matrix") ? "" : "none";
  const op = typeof models.wallpaperOpacity === "number" ? models.wallpaperOpacity : 82;
  document.getElementById("s_wp_opacity").value = op;
  document.getElementById("s_wp_opacity_val").textContent = op + "%";
  document.getElementById("s_location").value = models.location || "";
  document.getElementById("s_autoupdate").checked = !!models.autoUpdate;
  const hasBothFrontier = models.backends.some(b => b.id === "claude" && b.configured)
                        && models.backends.some(b => b.id === "codex" && b.configured);
  document.getElementById("s_frontier_provider_row").style.display = hasBothFrontier ? "" : "none";
  if (hasBothFrontier) document.getElementById("s_frontier_provider").value = models.frontierProvider || "claude";
  renderRoleModels();
  loadTunnel();
}
function closeSettings() { document.getElementById("settingsOverlay").classList.remove("open"); }

async function openReleases() {
  const body = document.getElementById("releasesBody");
  document.getElementById("releasesOverlay").classList.add("open");
  body.innerHTML = '<div class="muted">Loading…</div>';
  const r = await api("/releases");
  const list = (r && r.releases) || [];
  if (!list.length) { body.innerHTML = '<div class="muted">No release notes yet.</div>'; return; }
  body.innerHTML = list.map(function(rel) {
    const note = rel.note ? esc(rel.note) : '<span class="muted">Maintenance release.</span>';
    return '<div style="padding:10px 0;border-top:1px solid var(--border)">'
      + '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">'
      + '<span style="font-weight:600">v' + esc(rel.version) + '</span>'
      + '<span class="muted" style="font-size:11px">' + esc(rel.date || '') + '</span></div>'
      + '<div style="font-size:13px;margin-top:2px">' + note + '</div></div>';
  }).join("");
}
function closeReleases() { document.getElementById("releasesOverlay").classList.remove("open"); }

// One-click AI-news video draft → creates the review task (full script + pause),
// no general agent, no duplicate tasks. Same structured path the routing uses.
async function draftVideoNow() {
  hmToast("Drafting today's AI-news script…");
  const r = await api("/video/news/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  if (r && (r.draft || r.taskId)) {
    hmToast('Script ready — review it on the board (Edit the draft to revise).', "ok");
    refresh();
    const tid = r.taskId || (r.draft && r.draft.taskId);
    if (tid) selectTask(tid);
  } else {
    hmToast((r && r.error) || "Draft failed", "err");
  }
}

// Mixed-mode role models: thinking → frontier-premium, coding → frontier,
// operational → local. Shown only when a Mixed posture is possible (local +
// frontier both configured). Empty value = the router's built-in default.
function renderRoleModels() {
  const wrap = document.getElementById("s_role_models");
  if (!wrap || !models) return;
  const mixedAvailable = models.available.some(m => m.id === "mixed");
  wrap.style.display = mixedAvailable ? "" : "none";
  if (!mixedAvailable) return;
  const rm = models.roleModels || { thinking: "", coding: "", operational: "", writer: "" };
  const opts = models.roleModelOptions || { thinking: [], coding: [], operational: [], writer: [] };
  const provider = models.frontierProvider || "claude";
  const fill = (id, list, defLabel, selected) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const opts = ['<option value="">' + esc(defLabel) + '</option>']
      .concat(list.map(m => '<option value="' + esc(m.modelId) + '"' + (m.modelId === selected ? ' selected' : '') + '>' + esc(m.name) + (m.note ? ' — ' + esc(m.note) : '') + '</option>'));
    // Selected override that isn't in the catalog (e.g. a hand-set id) still shows.
    if (selected && !list.some(m => m.modelId === selected)) opts.push('<option value="' + esc(selected) + '" selected>' + esc(selected) + '</option>');
    sel.innerHTML = opts.join("");
    sel.value = selected || "";
    sel.disabled = false;
    sel.title = "";
  };
  fill("s_role_thinking", opts.thinking || [], provider === "codex" ? "Default — Codex GPT-5.5" : "Default — Opus 4.8", rm.thinking);
  fill("s_role_coding", opts.coding || [], provider === "codex" ? "Default — Codex Spark" : "Default — Sonnet 4.6", rm.coding);
  fill("s_role_operational", opts.operational || [], "Default — local Qwen", rm.operational);
  fill("s_role_writer", opts.writer || [], provider === "codex" ? "Default — Codex GPT-5.5 online, local offline" : "Default — Sonnet online, local offline", rm.writer);
}

async function saveRoleModel(role, modelId) {
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ roleModel: { role, modelId } }) });
  await loadModels();   // refreshes the global models object (incl. roleModels)
  renderRoleModels();
  hmToast(role + " model saved", "ok");
}
function onOpacityInput(v) {
  document.getElementById("s_wp_opacity_val").textContent = v + "%";
  document.documentElement.style.setProperty("--wp-opacity", v + "%"); // live preview
}
async function saveOpacity(v) {
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ wallpaperOpacity: parseInt(v,10) }) });
  await loadModels();
}
async function saveLocation() {
  const location = document.getElementById("s_location").value.trim();
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ location }) });
  await loadModels();
}
async function saveAutoUpdate() {
  const autoUpdate = document.getElementById("s_autoupdate").checked;
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ autoUpdate }) });
  await loadModels();
}

function switchSettingsTab(tab) {
  const tabs = ["about", "features", "general", "models", "observability", "lanes", "remote"];
  const panels = { models: "settingsModels", observability: "settingsObservability", lanes: "settingsLanes", general: "settingsGeneral", remote: "settingsRemote", features: "settingsFeatures", about: "settingsAbout" };
  for (const t of tabs) {
    document.getElementById("tab-" + t).className = "tab" + (tab === t ? " active" : "");
    document.getElementById(panels[t]).style.display = tab === t ? "" : "none";
  }
  if (tab === "lanes") { renderSettingsLanes(); renderSafeSenders(); }
  if (tab === "features") renderFeatures();
  if (tab === "observability") renderObsDashboard();
  if (tab === "about") { renderAbout(); checkUpdate(); }
}

async function renderFeatures() {
  const el = document.getElementById("s_features");
  el.innerHTML = '<div class="muted">Loading…</div>';
  const [r, auto, brief] = await Promise.all([api("/settings/features"), api("/settings/voice/auto-approval"), api("/settings/briefing")]);
  const features = (r && r.features) || [];
  if (!features.length) { el.innerHTML = '<div class="muted">No optional features.</div>'; return; }
  const featureRows = features.map(f => {
    const on = f.enabled === true;
    const incapable = f.capable === false;
    const reason = (incapable && f.reason) ? ' <span style="color:var(--accent-2)">— ' + esc(f.reason) + '</span>' : '';
    const control = incapable
      ? '<button class="reply-toggle" disabled title="' + esc(f.reason || 'not available') + '" style="opacity:.45;cursor:not-allowed">Unavailable</button>'
      : '<button class="reply-toggle' + (on ? ' active' : '') + '" onclick="toggleFeature(\'' + esc(f.key) + '\',' + (!on) + ')">' + (on ? 'On' : 'Off') + '</button>';
    return '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--border)">'
      + '<div style="flex:1"><div style="font-weight:600">' + esc(f.label) + '</div>'
      + '<div class="muted" style="font-size:11px;margin-top:2px">' + esc(f.description) + reason + '</div></div>'
      + control
      + '</div>';
  }).join('');
  const policy = (auto && auto.policy) || {};
  const checkpointAuto = policy.enabled === true && policy.allowCheckpoints === true;
  const autoRow = '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--border)">'
    + '<div style="flex:1"><div style="font-weight:600">Voice auto-approval</div>'
    + '<div class="muted" style="font-size:11px;margin-top:2px">Allows Talk to approve non-content directive checkpoints. Content, external, stuck, and tool approvals stay manual.</div></div>'
    + '<button class="reply-toggle' + (checkpointAuto ? ' active' : '') + '" onclick="toggleAutoApproval(' + (!checkpointAuto) + ')">' + (checkpointAuto ? 'On' : 'Off') + '</button>'
    + '</div>';
  const b = (brief && brief.briefing) || {};
  const briefOn = b.enabled === true;
  const briefHour = typeof b.hour === 'number' ? b.hour : 8;
  const apnsNote = (brief && brief.apnsConfigured)
    ? ((brief.devices || 0) + ' device' + (brief.devices === 1 ? '' : 's') + ' registered')
    : 'APNs not set up — falls back to iMessage/Telegram/email';
  const hourOpts = Array.from({length:24}, (_,h) => '<option value="'+h+'"'+(h===briefHour?' selected':'')+'>'+String(h).padStart(2,'0')+':00</option>').join('');
  const briefRow = '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--border)">'
    + '<div style="flex:1"><div style="font-weight:600">Morning briefing</div>'
    + '<div class="muted" style="font-size:11px;margin-top:2px">Pushes a daily standup (pending approvals, failures, active directives, usage) to your phone. ' + esc(apnsNote) + '. <button class="linklike" onclick="sendTestBriefing(this)">Send test</button></div></div>'
    + '<div class="row" style="gap:8px;align-items:center">'
    + '<select onchange="setBriefingHour(this.value)" ' + (briefOn ? '' : 'disabled ') + 'style="padding:4px 6px">' + hourOpts + '</select>'
    + '<button class="reply-toggle' + (briefOn ? ' active' : '') + '" onclick="toggleBriefing(' + (!briefOn) + ')">' + (briefOn ? 'On' : 'Off') + '</button>'
    + '</div></div>';
  // Video factory is no longer a Features toggle — it's a capability driven by a
  // user directive (scheduled job) that runs the factory and pauses at the script-
  // review checkpoint. Nothing to render here.
  el.innerHTML = featureRows + autoRow + briefRow;
}

async function toggleBriefing(enabled) {
  await api("/settings/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
  renderFeatures();
}

async function setBriefingHour(hour) {
  await api("/settings/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hour: Number(hour) }) });
  renderFeatures();
}

async function sendTestBriefing(btn) {
  if (btn) btn.disabled = true;
  hmToast('Sending a test briefing…');
  try {
    const r = await api("/briefing/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (r && r.pushed > 0) hmToast('Pushed to ' + r.pushed + ' device' + (r.pushed === 1 ? '' : 's') + ' via APNs.', 'ok');
    else if (r && r.fellBack) hmToast('No device registered — sent via iMessage/Telegram/email instead.', 'ok');
    else hmToast('Briefing built but not delivered (no push, no fallback channel).', 'err');
  } catch (e) {
    hmToast('Test briefing failed.', 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleFeature(key, enabled) {
  await api("/settings/features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, enabled }) });
  renderFeatures();
  initVoiceFeature();
}

async function toggleAutoApproval(enabled) {
  await api("/settings/voice/auto-approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, allowCheckpoints: enabled, allowLowRiskTools: false }),
  });
  renderFeatures();
}

// ── In-app push-to-talk (Voice feature) ───────────────────────────────
let _talkRec = null, _talkChunks = [];
async function initVoiceFeature() {
  try {
    const r = await api("/settings/features");
    const on = ((r && r.features) || []).some(f => f.key === "voice" && f.enabled);
    const btn = document.getElementById("talkBtn");
    if (btn) btn.style.display = on ? "" : "none";
  } catch (e) { /* ignore */ }
}
function talkStatus(msg, show) {
  const el = document.getElementById("talkStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = show ? "" : "none";
}
function blobToB64(blob) {
  return new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
}
async function toggleTalk() {
  const btn = document.getElementById("talkBtn");
  if (_talkRec && _talkRec.state === "recording") { _talkRec.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { talkStatus("mic blocked — allow microphone access", true); return; }
  _talkChunks = [];
  _talkRec = new MediaRecorder(stream);
  _talkRec.ondataavailable = e => { if (e.data && e.data.size) _talkChunks.push(e.data); };
  _talkRec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    btn.textContent = "… thinking"; talkStatus("transcribing…", true);
    try {
      const b64 = await blobToB64(new Blob(_talkChunks, { type: "audio/webm" }));
      const res = await api("/voice/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: b64 }) });
      if (res && res.error) { talkStatus(res.error, true); }
      else {
        if (res && res.audioBase64) { try { new Audio("data:audio/mp4;base64," + res.audioBase64).play(); } catch (e) {} }
        talkStatus((res && res.transcript ? "you: " + res.transcript : "") + (res && res.reply ? "  ·  assistant: " + res.reply : ""), true);
      }
    } catch (e) { talkStatus("voice turn failed", true); }
    btn.textContent = "🎤 Talk";
  };
  _talkRec.start();
  btn.textContent = "■ Stop"; talkStatus("listening… (click Stop when done)", true);
}

function renderAbout() {
  const v = (models && models.version) || {};
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("ab_version", "v" + (v.version || "?"));
  set("ab_build", String(v.build || "?"));
  set("ab_date", v.date || "?");
}

async function renderSettingsLanes() {
  const el = document.getElementById("s_lanes");
  el.innerHTML = '<div class="muted">Loading…</div>';
  const r = await api("/lanes");
  const lanes = (r && r.lanes) || [];
  if (!lanes.length) { el.innerHTML = '<div class="muted">No lanes registered.</div>'; return; }
  el.innerHTML = lanes.map(lane => {
    const dotColor = lane.running ? (lane.healthy === false ? "var(--accent-2)" : "var(--ok)") : "var(--muted)";
    const stateTxt = lane.runtimeMode === "planned" ? "planned"
      : lane.running ? (lane.healthy === false ? "running (unhealthy)" : "running")
      : "stopped";
    const modeBadge = '<span class="badge">'+esc(lane.runtimeMode)+'</span>';
    const healthBadge = lane.healthy === true ? '<span class="badge" style="color:var(--ok)">healthy</span>'
      : lane.healthy === false ? '<span class="badge" style="color:var(--accent-2)">unhealthy</span>' : '';
    // Toggle only for manageable launchagent lanes.
    const toggle = (lane.manageable && lane.runtimeMode === "launchagent")
      ? '<button class="copybtn" onclick="toggleLane(\''+esc(lane.kind)+'\','+(lane.running?'false':'true')+')">'+(lane.running?'Turn off':'Turn on')+'</button>'
      : '<span class="muted" style="font-size:10px">'+(lane.runtimeMode==="embedded"?'follows mode':'—')+'</span>';
    const setupBtn = lane.kind === 'mail' ? '<button class="copybtn" onclick="openMailBeeSetup()" style="margin-right:6px">Set up</button>'
      : lane.kind === 'message' ? '<button class="copybtn" onclick="openMessageBeeSetup()" style="margin-right:6px">Set up</button>'
      : '';
    return '<div class="card" style="cursor:default">'
      + '<div class="t"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+dotColor+';margin-right:6px"></span>'+esc(lane.name)+'</div>'
      + '<div class="m">'+modeBadge+healthBadge+'<span class="badge">'+esc(stateTxt)+'</span></div>'
      + (lane.summary?'<div class="muted" style="font-size:11px;margin-top:4px">'+esc(lane.summary)+'</div>':'')
      + (lane.statusDetail?'<div class="muted" style="font-size:10px;margin-top:2px">'+esc(lane.statusDetail)+'</div>':'')
      + '<div class="row" style="margin-top:6px;justify-content:flex-end">'+setupBtn+toggle+'</div>'
      + '</div>';
  }).join("");
}

async function toggleLane(kind, enable) {
  const r = await api("/lanes/"+kind+"/autostart", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ enabled: enable }) });
  if (r && r.error) { hmAlert(r.error); }
  setTimeout(renderSettingsLanes, 800); // give launchctl a moment
}

// --- COO Dispatch (operator) ------------------------------------------------
// Prepare-only by default; the Create button appears only when the prepared
// result is browser-safe. Talks to /coo/dispatch (same routing/approval/audit
// path the model uses). Never renders secrets — the result carries none.
let cooLastResult = null;
function cooDispatchPrepare() { return cooDispatchRun(false); }
function cooDispatchCreate() { return cooDispatchRun(true); }
async function cooDispatchRun(create) {
  const out = document.getElementById("coo_result");
  const text = (document.getElementById("coo_text").value || "").trim();
  if (!text) { out.innerHTML = '<div class="muted">Enter an objective first.</div>'; return; }
  const domains = (document.getElementById("coo_domains").value || "").split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  const projectPath = (document.getElementById("coo_project_path").value || "").trim();
  const body = { text: text, domains: domains };
  if (create) {
    if (!projectPath) { out.innerHTML = '<div class="errbox">A project path is required to create a task.</div>'; return; }
    body.create = true; body.projectPath = projectPath;
  }
  out.innerHTML = '<div class="muted">'+(create?'Creating…':'Preparing…')+'</div>';
  const r = await api("/coo/dispatch", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
  if (!r || !r.ok || !r.result) { out.innerHTML = '<div class="errbox">'+esc((r&&r.error)||'Dispatch failed')+'</div>'; return; }
  cooLastResult = r.result;
  renderCooResult(r.result);
}
function renderCooResult(result) {
  const out = document.getElementById("coo_result");
  const createBtn = document.getElementById("coo_create_btn");
  // The Create button is shown ONLY for a browser-safe prepared result whose
  // site readiness is acceptable (no readiness info, or readiness.acceptable).
  const readiness = result.readiness || null;
  const readyOk = !readiness || readiness.acceptable === true;
  const canCreate = result.status === "prepared" && result.lane === "browser" && readyOk;
  if (createBtn) createBtn.style.display = canCreate ? "" : "none";
  const row = (k,v) => '<div class="m" style="margin-top:2px"><span class="badge">'+esc(k)+'</span> '+esc(v)+'</div>';
  const rows = [row("status", result.status)];
  if (result.lane) rows.push(row("lane", result.lane));
  if (result.capability) rows.push(row("capability", result.capability));
  if (result.route && result.route.ruleName) rows.push(row("rule", result.route.ruleName));
  if (result.reason) rows.push(row("reason", result.reason));
  // Site readiness (metadata only — never any secret).
  if (readiness) {
    if (readiness.matched) {
      rows.push(row("site readiness", (readiness.siteName || readiness.siteId) + ' — ' + readiness.status + ' (' + readiness.color + ')' + (readiness.acceptable ? '' : ' — needs attention')));
      if (readiness.traceRunId) rows.push(row("readiness trace", readiness.traceRunId));
    } else if (readiness.requiresLogin) {
      rows.push(row("site readiness", 'no configured site matches this target — auth not confirmed'));
    }
  }
  if (result.auditId) rows.push(row("auditId", result.auditId));
  if (result.taskId) rows.push(row("taskId", result.taskId));
  out.innerHTML = '<div class="card" style="cursor:default">'+rows.join("")+'</div>';
}

// --- Safe senders (Message Lane + Mail Lane) --------------------------------
async function renderSafeSenders() {
  const el = document.getElementById("s_safe_senders");
  if (!el) return;
  el.innerHTML = '<div class="muted" style="font-size:11px">Loading…</div>';
  const [mbData, mlData, igData] = await Promise.all([
    api("/messagebee").catch(() => null),
    api("/mailbee").catch(() => null),
    api("/messagebee/ignored").catch(() => null),
  ]);
  function chips(ids, rmFn) {
    if (!ids.length) return '<span class="muted" style="font-size:11px">None yet.</span>';
    return ids.map(i => {
      const safeAddr = esc(i.address).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return '<span class="ss-chip">' + esc(i.address)
        + ' <span class="x" onclick="' + rmFn + '(\'' + safeAddr + '\')" title="Remove">✕</span></span>';
    }).join("");
  }
  const mbIds = mbData ? (mbData.identities || []).filter(i => i.status === "allowed" || i.status === "paired") : [];
  const mlIds = mlData ? (mlData.identities || []).filter(i => i.status === "allowed" || i.status === "paired") : [];
  const ig = igData ? (igData.ignored || []) : [];
  const ignoredHtml = ig.length
    ? '<div style="margin-top:5px"><div class="muted" style="font-size:11px;margin-bottom:2px">Texted but not allowlisted:</div>'
      + ig.map(i => {
          const safeAddr = esc(i.address).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          return '<div class="mb-ignored-row"><span class="mb-ig-addr">' + esc(i.address) + '</span>'
            + (i.text ? '<span class="muted mb-ig-text">"' + esc(i.text.slice(0, 50)) + '"</span>' : "")
            + '<button onclick="allowIgnoredInSafeSenders(\'' + safeAddr + '\')">Allow</button></div>';
        }).join("") + "</div>"
    : "";
  el.innerHTML =
    '<div class="ss-section">'
    + '<div class="ss-section-hd">Message Lane — iMessage / SMS</div>'
    + chips(mbIds, "rmMbSender") + ignoredHtml
    + '<div class="row" style="margin-top:6px;gap:6px">'
    + '<input id="ss_mb_input" class="dialog-input" placeholder="+15551234567 or you@icloud.com" style="flex:1;margin:0"'
    + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();addMbSender();}" />'
    + '<button class="copybtn" onclick="addMbSender()">Add</button></div>'
    + '<div class="err" id="ss_mb_err" style="font-size:11px;margin-top:3px"></div>'
    + '</div>'
    + '<div class="ss-section">'
    + '<div class="ss-section-hd">Mail Lane — Email</div>'
    + chips(mlIds, "rmMlSender")
    + '<div class="row" style="margin-top:6px;gap:6px">'
    + '<input id="ss_ml_input" class="dialog-input" placeholder="trusted@example.com" style="flex:1;margin:0"'
    + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();addMlSender();}" />'
    + '<button class="copybtn" onclick="addMlSender()">Add</button></div>'
    + '<div class="err" id="ss_ml_err" style="font-size:11px;margin-top:3px"></div>'
    + '</div>';
}
async function addMbSender() {
  const input = document.getElementById("ss_mb_input");
  const errEl = document.getElementById("ss_mb_err");
  const address = input ? input.value.trim() : "";
  if (!address || !errEl) return;
  errEl.textContent = "";
  try {
    await api("/messagebee/identities", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ address, status:"allowed" }) });
    input.value = "";
    renderSafeSenders();
  } catch(e) { errEl.textContent = String(e); }
}
async function rmMbSender(address) {
  try {
    await api("/messagebee/identities", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ address, status:"pending" }) });
    renderSafeSenders();
  } catch(e) { /* ignore */ }
}
async function addMlSender() {
  const input = document.getElementById("ss_ml_input");
  const errEl = document.getElementById("ss_ml_err");
  const address = input ? input.value.trim() : "";
  if (!address || !errEl) return;
  errEl.textContent = "";
  try {
    await api("/mailbee/identities", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ address, status:"allowed" }) });
    input.value = "";
    renderSafeSenders();
  } catch(e) { errEl.textContent = String(e); }
}
async function rmMlSender(address) {
  try {
    await api("/mailbee/identities", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ address, status:"pending" }) });
    renderSafeSenders();
  } catch(e) { /* ignore */ }
}
async function allowIgnoredInSafeSenders(address) {
  try {
    await api("/messagebee/allow", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ address }) });
    renderSafeSenders();
  } catch(e) { /* ignore */ }
}

function renderSettingsProjects() {
  const el = document.getElementById("s_projects");
  const countEl = document.getElementById("s_proj_count");
  if (!state.projects.length) {
    el.innerHTML = '<div class="muted">No projects discovered yet. Run a re-scan.</div>';
    countEl.textContent = "0";
    return;
  }
  countEl.textContent = state.projects.length;
  el.innerHTML = state.projects.map(p => {
    const sourceLabels = p.sources.map(s => s === "claude-code" ? "Claude" : s === "vscode" ? "VS Code" : "Git").join(", ");
    return '<div class="card" style="cursor:default" onclick="selectProjectFromSettings(\''+esc(p.name)+'\')">'
      + '<div class="t">'+esc(p.name)+(p.preSelect?' <span class="badge" style="color:var(--ok)">★ active</span>':'')+'</div>'
      + '<div class="m"><span class="badge">'+esc(p.path)+'</span>'
      + (p.hasManifest?'<span class="badge" style="color:var(--accent-2)">manifest</span>':'')
      + '<span class="badge">'+sourceLabels+'</span></div></div>';
  }).join("");
}

function selectProjectFromSettings(name) {
  const sel = document.getElementById("projectSel");
  sel.value = name;
  state.selectedProject = name;
  localStorage.setItem("hm_project", name);
  renderBoard();
}

async function refreshProjects() {
  await loadProjects(true); // bypass the cache
  renderSettingsProjects();
}

let tunnel = null;
function copyField(id){ var i=document.getElementById(id); i.select(); document.execCommand("copy"); }
async function loadTunnel() {
  tunnel = await api("/tunnel");
  const dot = document.getElementById("s_remote_dot"), label = document.getElementById("s_remote_label");
  const detail = document.getElementById("s_tunnel_detail"), btn = document.getElementById("s_tunnel_btn"), live = document.getElementById("s_tunnel_live");
  if (!tunnel) return;
  if (!tunnel.installed) {
    dot.className = "dot err"; label.textContent = "cloudflared not installed";
    detail.textContent = "Install with: brew install cloudflared";
    btn.style.display = "none"; live.style.display = "none"; return;
  }
  btn.style.display = "";
  if (tunnel.running && tunnel.url) {
    dot.className = "dot on"; label.textContent = "Remote access ON";
    const modeLabel = tunnel.mode === "named"
      ? (tunnel.owner === "hivematrix" ? "Named tunnel running from HiveMatrix" : "Named tunnel configured for pairing")
      : "Temporary ad-hoc tunnel running";
    detail.textContent = modeLabel + (tunnel.cloudflareAccessConfigured ? " · Cloudflare Access credentials included in QR" : "") + (tunnel.qrInstalled ? "" : " (install qrencode for the QR: brew install qrencode)");
    btn.textContent = tunnel.canStop ? "Stop tunnel" : "Start temporary tunnel";
    live.style.display = "block";
    document.getElementById("s_tunnel_url").value = tunnel.url;
    if (tunnel.mode === "named") document.getElementById("s_named_host").value = tunnel.url;
    const cfDetail = document.getElementById("s_cf_access_detail");
    if (cfDetail) cfDetail.textContent = tunnel.cloudflareAccessConfigured
      ? "Cloudflare Access service-token credentials are saved and will be included in the QR."
      : "Only needed when Cloudflare Access protects the hostname for iOS/API calls.";
    // QR from the daemon (token via query); cache-bust per URL.
    document.getElementById("s_qr").innerHTML = tunnel.qrInstalled
      ? '<img src="/tunnel/qr?token=' + encodeURIComponent(HM_TOKEN) + '&u=' + encodeURIComponent(tunnel.url) + '" style="width:100%;height:100%" alt="pairing QR" />'
      : '<div class="muted" style="font-size:11px">QR unavailable — brew install qrencode</div>';
  } else {
    dot.className = "dot off"; label.textContent = "Remote access OFF";
    detail.textContent = "Start a tunnel to reach this daemon from your phone.";
    btn.textContent = "Start temporary tunnel"; live.style.display = "none";
  }
}
async function toggleTunnel() {
  const btn = document.getElementById("s_tunnel_btn");
  const stopping = tunnel && tunnel.canStop;
  btn.disabled = true; btn.textContent = stopping ? "Stopping…" : "Starting…";
  try {
    tunnel = await api(stopping ? "/tunnel/stop" : "/tunnel/start", { method: "POST" });
  } catch (e) { /* */ }
  btn.disabled = false;
  loadTunnel();
}
async function configureNamedTunnel() {
  const hostname = document.getElementById("s_named_host").value.trim();
  if (!hostname) return;
  tunnel = await api("/tunnel/configure-named", { method: "POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ hostname }) });
  loadTunnel();
}
async function saveCloudflareAccessCredentials() {
  const cloudflareAccessClientId = document.getElementById("s_cf_access_id").value.trim();
  const cloudflareAccessClientSecret = document.getElementById("s_cf_access_secret").value.trim();
  tunnel = await api("/tunnel/access-credentials", { method: "POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ cloudflareAccessClientId, cloudflareAccessClientSecret }) });
  document.getElementById("s_cf_access_secret").value = "";
  loadTunnel();
}
async function startNamedTunnel() {
  const connectorToken = document.getElementById("s_named_token").value.trim();
  const hostname = document.getElementById("s_named_host").value.trim();
  if (!connectorToken || !hostname) return;
  tunnel = await api("/tunnel/start-named", { method: "POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ connectorToken, hostname }) });
  loadTunnel();
}

async function saveTheme() {
  const theme = document.getElementById("s_theme").value;
  models = await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ theme }) }) || models;
  applyTheme(theme, !!(models && models.hasWallpaper));
  // The panel-translucency slider applies to the Matrix rain too, so reveal it here.
  const hasWp = !!(models && models.hasWallpaper);
  document.getElementById("wallpaper_opacity_row").style.display = (hasWp || theme === "matrix") ? "" : "none";
  hmToast("Theme: " + theme, "ok");
}
async function saveAppIconChoice() {
  const appIconChoice = document.getElementById("s_app_icon").value;
  const statusEl = document.getElementById("app_icon_status");
  if (statusEl) {
    statusEl.style.color = "var(--accent)";
    statusEl.textContent = "Saving...";
  }
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ appIconChoice }) });
  await loadModels();
  if (statusEl) {
    statusEl.style.color = "var(--ok)";
    statusEl.textContent = "Saved. Reopen HiveMatrix to update the Dock icon.";
  }
}
async function saveWallpaperPath() {
  const wallpaperPath = document.getElementById("s_wallpaper").value.trim();
  const statusEl = document.getElementById("wallpaper_status");
  statusEl.style.color = "var(--accent)";
  statusEl.textContent = "Saving…";
  try {
    await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ wallpaperPath }) });
    await loadModels();
    statusEl.style.color = "var(--ok)";
    statusEl.textContent = "✓ Wallpaper set";
    if (wallpaperPath) showWallpaperPreview();
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
  } catch (e) {
    statusEl.style.color = "var(--err)";
    statusEl.textContent = "Failed to save";
  }
}
async function clearWallpaper() {
  document.getElementById("s_wallpaper").value = "";
  document.getElementById("wallpaper_preview").style.display = "none";
  const statusEl = document.getElementById("wallpaper_status");
  statusEl.style.color = "var(--accent)";
  statusEl.textContent = "Clearing…";
  try {
    await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ wallpaperPath: null }) });
    await loadModels();
    statusEl.style.color = "var(--ok)";
    statusEl.textContent = "✓ Wallpaper cleared";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
  } catch (e) {
    statusEl.style.color = "var(--err)";
    statusEl.textContent = "Failed to clear";
  }
}
// Called when the user picks a file via the "Choose image" button.
// Shows a preview immediately, then uploads the file to the daemon.
function onWallpaperFileSelected(input) {
  const f = input.files?.[0];
  if (!f) return;
  const statusEl = document.getElementById("wallpaper_status");
  // Show local preview immediately
  const preview = document.getElementById("wallpaper_preview");
  const img = document.getElementById("wallpaper_preview_img");
  const reader = new FileReader();
  reader.onload = async (e) => {
    img.src = String(e.target?.result || "");
    preview.style.display = "block";
    statusEl.style.color = "var(--accent)";
    statusEl.textContent = "Uploading…";
    // Upload as base64
    const b64 = String(e.target?.result || "").split(",")[1];
    const ext = (f.name.split(".").pop() || "png").toLowerCase();
    try {
      await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ wallpaperData: b64, wallpaperExt: ext }) });
      await loadModels();
      statusEl.style.color = "var(--ok)";
      statusEl.textContent = "✓ Wallpaper set from " + f.name;
      // Update the path field to show where it was saved
      document.getElementById("s_wallpaper").value = "~/.hivematrix/wallpaper." + ext;
      setTimeout(() => { statusEl.textContent = ""; }, 4000);
    } catch (err) {
      statusEl.style.color = "var(--err)";
      statusEl.textContent = "Upload failed — try again";
    }
  };
  reader.readAsDataURL(f);
  input.value = ""; // allow re-selecting the same file
}
function showWallpaperPreview() {
  const preview = document.getElementById("wallpaper_preview");
  const img = document.getElementById("wallpaper_preview_img");
  img.src = "/wallpaper?token=" + encodeURIComponent(HM_TOKEN) + "&t=" + Date.now();
  preview.style.display = "block";
}

async function saveDefault() {
  const modelId = document.getElementById("s_default").value;
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ defaultModel: modelId }) });
  await loadModels();
  hmToast("Default model saved", "ok");
}
async function saveFrontierProvider() {
  const frontierProvider = document.getElementById("s_frontier_provider").value;
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ frontierProvider }) });
  await loadModels();
  hmToast("Frontier provider saved", "ok");
}
async function saveEndpoint() {
  const localEndpoint = document.getElementById("s_endpoint").value.trim();
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ localEndpoint }) });
  await loadModels();
  hmToast("Endpoint saved", "ok");
}

async function createTask() {
  const err = document.getElementById("t_err"); err.textContent = "";
  const title = document.getElementById("t_title").value.trim();
  let description = document.getElementById("t_desc").value.trim();
  const projectPath = document.getElementById("t_path").value.trim();
  const projName = selectedProjectName || null;
  const sel = modelById[document.getElementById("t_model").value] || { modelId: null, fast: false };
  if (!description || !projectPath) { err.textContent = "Description and project path are required."; return; }
  if (_attachUploading > 0) { err.textContent = "Wait for attachments to finish uploading."; return; }
  if (_attachError) { err.textContent = "Try attaching failed files again before creating the task."; return; }
  const attachments = _attachments.slice();
  try {
    // Title optional — omit when blank so the daemon derives it from the instructions.
    const t = await api("/tasks", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ title: title || undefined, description, attachments, projectPath, project: projName || "console", model: sel.modelId || null, fastMode: sel.fast, status: "backlog", executor: "agent" }) });
    if (!t || !t._id) { err.textContent = "Create failed."; return; }
    document.getElementById("t_title").value = ""; document.getElementById("t_desc").value = "";
    _attachments = []; _attachError = ""; _attachUploading = 0; renderAttachChips();
    toggleForm("taskForm"); refresh();
  } catch (e2) { err.textContent = String(e2); }
}

async function createDirective() {
  const err = document.getElementById("d_err"); err.textContent = "";
  const goal = document.getElementById("d_goal").value.trim();
  const projectPath = document.getElementById("d_path").value.trim();
  const crit = document.getElementById("d_crit").value.trim();
  const interval = document.getElementById("d_interval").value.trim();
  if (!goal || !projectPath) { err.textContent = "Goal and project path are required."; return; }
  const triggerPolicy = interval ? { type: "schedule", interval } : { type: "manual" };
  try {
    const d = await api("/directives", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ goal, project: "console", projectPath, triggerPolicy, criteria: crit ? [crit] : [] }) });
    if (!d || !d._id) { err.textContent = "Create failed."; return; }
    document.getElementById("d_goal").value = ""; document.getElementById("d_crit").value = "";
    toggleForm("dirForm"); refresh();
  } catch (e2) { err.textContent = String(e2); }
}

function editDirective(id) {
  const d = state.directives.find(x => x._id === id);
  if (!d) return;
  document.getElementById("de_id").value = d._id;
  document.getElementById("de_goal").value = d.goal;
  document.getElementById("de_path").value = d.projectPath;
  document.getElementById("de_status").value = d.status;
  // Reverse-engineer interval from triggerPolicy JSON
  try {
    const tp = JSON.parse(d.triggerPolicy || "{}");
    document.getElementById("de_interval").value = tp.interval || "";
  } catch { document.getElementById("de_interval").value = ""; }
  toggleForm("dirEditForm");
}

async function saveDirective() {
  const err = document.getElementById("de_err"); err.textContent = "";
  const id = document.getElementById("de_id").value;
  const goal = document.getElementById("de_goal").value.trim();
  const projectPath = document.getElementById("de_path").value.trim();
  const status = document.getElementById("de_status").value;
  const interval = document.getElementById("de_interval").value.trim();
  if (!goal || !projectPath) { err.textContent = "Goal and project path are required."; return; }
  const triggerPolicy = interval ? { type: "schedule", interval } : { type: "manual" };
  try {
    const d = await api("/directives/" + encodeURIComponent(id), { method:"PATCH", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ goal, projectPath, status, triggerPolicy }) });
    if (!d) { err.textContent = "Update failed."; return; }
    toggleForm("dirEditForm"); refresh();
  } catch (e2) { err.textContent = String(e2); }
}

async function deleteDirective(id) {
  if (!await hmConfirm("Delete this directive and all its runs?", { okLabel: "Delete", danger: true })) return;
  try {
    await api("/directives/" + encodeURIComponent(id), { method: "DELETE" });
    refresh();
  } catch (e2) { /* transient */ }
}

// SSE for live updates; fall back to polling.
function connectSSE() {
  try {
    const es = new EventSource("/events?token=" + encodeURIComponent(HM_TOKEN));
    const live = document.getElementById("live");
    es.onopen = () => { live.className = "live"; live.textContent = "● live"; };
    es.onmessage = () => refresh();
    es.addEventListener("hive:event", refresh);
    es.addEventListener("tasks:created", refresh);
    es.addEventListener("tasks:updated", refresh);
    es.addEventListener("directives:created", refresh);
    es.addEventListener("directives:updated", refresh);
    es.addEventListener("directives:deleted", refresh);
    es.addEventListener("connectivity:change", refresh);
    es.onerror = () => { live.className = "live stale"; live.textContent = "● reconnecting"; };
  } catch (e) { /* polling covers it */ }
}

if (requireToken()) {
  loadModels();
  wireCtxSections();
  loadProjects();
  refresh();
  connectSSE();
  initVoiceFeature();
  setInterval(refresh, 5000);
  checkUpdate();
  setInterval(checkUpdate, 5 * 60 * 1000);
  checkUsage();
  checkModels();
  setInterval(checkUsage, 30 * 1000);
  setInterval(checkModels, 30 * 1000);
}
</script>
</body>
</html>`;
