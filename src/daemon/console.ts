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
<title>Console</title>
<script defer src="/assets/mermaid.min.js"></script>
<style>
  :root {
    color-scheme: dark;
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
    /* ── Dark tints ─────────────────────────────────────── */
    --mat-tint-chrome:    rgba(22,27,34,  var(--mat-tint-alpha-chrome));
    --mat-tint-regular:   rgba(22,27,34,  var(--mat-tint-alpha-regular));
    --mat-tint-thick:     rgba(28,34,48,  var(--mat-tint-alpha-thick));
    --mat-tint-thin:      rgba(13,17,23,  var(--mat-tint-alpha-thin));
    --bg: #0d1117; --panel: var(--mat-tint-regular); --panel-2: var(--mat-tint-thick); --border: #2d333b;
    --modal-bg: #161b22;
    --text: #e6edf3; --muted: #8b949e; --accent: #d9a441; --accent-2: #58a6ff;
    --ok: #3fb950; --warn: #d29922; --err: #f85149;
    --pill-mcp: #bc8cff; --pill-skill: #39c5cf;
    --code-bg: #0a0d12; --code-text: #e6edf3;
    --badge-bg: #21262d; --badge-text: #8b949e;
    --overlay-bg: transparent;
    --reply-q-bg: rgba(88,166,255,.08);
    --hover-bg: rgba(255,255,255,.06);
    --card-shadow: 0 1px 3px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.12);
    --create-btn-text: #1a1a1a;
    --errbox-bg: rgba(248,81,73,.08);
  }
  html[data-theme="light"] {
    color-scheme: light;
    --mat-tint-chrome:    rgba(255,255,255, var(--mat-tint-alpha-chrome));
    --mat-tint-regular:   rgba(255,255,255, var(--mat-tint-alpha-regular));
    --mat-tint-thick:     rgba(240,243,246, var(--mat-tint-alpha-thick));
    --mat-tint-thin:      rgba(255,255,255, var(--mat-tint-alpha-thin));
    --bg: #f6f8fa; --panel: var(--mat-tint-regular); --panel-2: var(--mat-tint-thick); --border: #d0d7de;
    --modal-bg: #ffffff;
    --text: #1f2328; --muted: #57606a; --accent: #9a6700; --accent-2: #0969da;
    --ok: #1a7f37; --warn: #9a6700; --err: #cf222e;
    --pill-mcp: #8250df; --pill-skill: #1b7c83;
    --code-bg: #e8ecf1; --code-text: #1f2328;
    --badge-bg: #e8ecf1; --badge-text: #57606a;
    --overlay-bg: transparent;
    --reply-q-bg: rgba(9,105,218,.08);
    --hover-bg: rgba(0,0,0,.04);
    --card-shadow: 0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.04);
    --create-btn-text: #fff;
    --errbox-bg: rgba(207,34,46,.06);
  }
  /* Matrix: deep green-black palette with neon-green accents, behind an animated code-rain canvas. */
  html[data-theme="matrix"] {
    color-scheme: dark;
    --mat-tint-alpha-regular: 0.85;
    --mat-tint-chrome:    rgba(4,20,11,   var(--mat-tint-alpha-chrome));
    --mat-tint-regular:   rgba(4,20,11,   var(--mat-tint-alpha-regular));
    --mat-tint-thick:     rgba(10,33,19,  var(--mat-tint-alpha-thick));
    --mat-tint-thin:      rgba(1,10,5,    var(--mat-tint-alpha-thin));
    --bg: #010a05; --panel: var(--mat-tint-regular); --panel-2: var(--mat-tint-thick); --border: #1d5a32;
    --modal-bg: #071206;
    --text: #b9ffce; --muted: #57b074; --accent: #39ff7e; --accent-2: #6effa3;
    --ok: #39ff7e; --warn: #d2e022; --err: #ff5d6c;
    --pill-mcp: #a68cff; --pill-skill: #4dd0e1;
    --code-bg: #03100a; --code-text: #b9ffce;
    --badge-bg: #0c2416; --badge-text: #57b074;
    --overlay-bg: transparent;
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
  html[data-theme="matrix"] .col, html[data-theme="matrix"] header { backdrop-filter: blur(var(--mat-wp-blur)) saturate(var(--mat-wp-sat)); -webkit-backdrop-filter: blur(var(--mat-wp-blur)) saturate(var(--mat-wp-sat)); }
  /* Panel tint alphas scale with the opacity slider so that 0% = fully transparent */
  html[data-wallpaper="1"] {
    --mat-tint-alpha-chrome:  var(--mat-wp-opacity);
    --mat-tint-alpha-regular: calc(var(--mat-wp-opacity) * 0.878);
    --mat-tint-alpha-thick:   calc(var(--mat-wp-opacity) * 1.049);
    --mat-tint-alpha-thin:    calc(var(--mat-wp-opacity) * 0.671);
  }
  html[data-theme="matrix"] {
    --mat-tint-alpha-chrome:  var(--mat-wp-opacity);
    --mat-tint-alpha-regular: calc(var(--mat-wp-opacity) * 1.037);
    --mat-tint-alpha-thick:   calc(var(--mat-wp-opacity) * 1.049);
    --mat-tint-alpha-thin:    calc(var(--mat-wp-opacity) * 0.671);
  }
  /* ── .text-on-material ─────────────────────────────────────────────────
     Protective text treatment for section labels exposed above panel surfaces.
     Usable as a utility class; also auto-applied to known section headings
     when a wallpaper is active so they remain legible at panel edges.       */
  .text-on-material { text-shadow: 0 1px 4px rgba(0,0,0,.55); }
  html[data-theme="light"] .text-on-material { text-shadow: 0 1px 4px rgba(255,255,255,.80); }
  html[data-theme="matrix"] .text-on-material { text-shadow: 0 1px 4px rgba(0,10,4,.70); }
  html[data-wallpaper="1"] h2,
  html[data-wallpaper="1"] .status-card-name,
  html[data-wallpaper="1"] .mdl-grp,
  html[data-wallpaper="1"] .ctx-sec > summary,
  html[data-wallpaper="1"] .dir-group-hdr { text-shadow: 0 1px 4px rgba(0,0,0,.55); }
  html[data-theme="light"][data-wallpaper="1"] h2,
  html[data-theme="light"][data-wallpaper="1"] .status-card-name,
  html[data-theme="light"][data-wallpaper="1"] .mdl-grp,
  html[data-theme="light"][data-wallpaper="1"] .ctx-sec > summary,
  html[data-theme="light"][data-wallpaper="1"] .dir-group-hdr { text-shadow: 0 1px 4px rgba(255,255,255,.80); }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    background: transparent; color: var(--text); height: 100vh; overflow: hidden;
    -webkit-font-smoothing: antialiased; display: flex; flex-direction: column; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.26); }
  html[data-theme="light"] ::-webkit-scrollbar-thumb { background: rgba(0,0,0,.14); }
  html[data-theme="light"] ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,.26); }
  ::selection { background: rgba(217,164,65,.28); }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 16px;
    background: var(--panel); border-bottom: 1px solid var(--border); height: 44px; flex-shrink: 0;
    backdrop-filter: var(--mat-chrome); -webkit-backdrop-filter: var(--mat-chrome); }
  header .logo { font-weight: 700; color: var(--accent); letter-spacing: .5px; }
  header .mode { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  select { background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 3px 8px; font-size: 11px; }
  main { --col-left: 300px; --col-right: 320px; position: relative;
    display: grid; grid-template-columns: var(--col-left) 1fr var(--col-right); flex: 1 1 0%; min-height: 0; }
  .col { overflow-y: auto; padding: 12px; backdrop-filter: var(--mat-regular); -webkit-backdrop-filter: var(--mat-regular); }
  /* Draggable dividers on the inner edge of each side rail. Thin absolute
     overlays pinned to the rail boundary; dragging rewrites --col-left /
     --col-right (the grid widths), which are persisted in localStorage. */
  .col-resizer { position: absolute; top: 0; bottom: 0; width: 9px; z-index: 6;
    cursor: col-resize; touch-action: none; }
  .col-resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%;
    width: 2px; transform: translateX(-50%); background: transparent; transition: background .12s ease; }
  .col-resizer:hover::after, .col-resizer.dragging::after { background: var(--accent); }
  #resizeLeft { left: var(--col-left); margin-left: -4px; }
  #resizeRight { right: var(--col-right); margin-right: -4px; }
  /* The task-detail column is a size container so controls respond to the column
     width (rails collapse independently of the window), not the viewport. */
  .col.session { container-type: inline-size; background: var(--panel); }
  .col.board { border-right: 1px solid var(--border); background: var(--panel); }
  .col.context { border-left: 1px solid var(--border); background: var(--panel); }
  main.ctx-collapsed { grid-template-columns: var(--col-left) 1fr; }
  main.ctx-collapsed .col.context { display: none; }
  main.ctx-collapsed #resizeRight { display: none; }
  /* Tablet / mid-size window: narrow the default rail widths so the center keeps
     usable width (the ◨ context toggle still reclaims it entirely). A user's
     dragged width is an inline style, so it overrides these defaults. */
  @media (min-width: 761px) and (max-width: 1080px) {
    main { --col-left: 240px; --col-right: 280px; }
  }
  /* Narrow screens (remote / iOS webview / small window): stack the three columns
     into one document-flow column instead of crushing the center. */
  @media (max-width: 760px) {
    body { height: auto; overflow: auto; }
    main, main.ctx-collapsed { grid-template-columns: 1fr; height: auto; }
    .col-resizer { display: none; }
    .col { height: auto; max-height: none; }
    .col.board { border-right: 0; border-bottom: 1px solid var(--border); }
    .col.context { border-left: 0; border-top: 1px solid var(--border); }
    .session { min-height: 180px; }
  }
  .ctx-sec { margin: 0; }
  .col.context .ctx-sec[open] { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 0 10px 10px; margin-bottom: 10px; }
  .ctx-sec > summary { cursor: pointer; list-style: none; font-size: 14px; font-weight: 600; margin: 20px 0 6px; color: var(--text); }
  .col.context .ctx-sec[open] > summary { margin: 10px 0 8px; }
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
  .addbtn { width: 100%; text-align: left; background: var(--panel-2); color: var(--text);
    border: 1px dashed var(--border); border-radius: 8px; padding: 7px 10px; cursor: pointer;
    font-size: 12px; font-weight: 600; margin-bottom: 10px; transition: border-color .15s ease, color .15s ease; }
  .addbtn:hover { border-color: var(--accent); color: var(--accent); }
  .addbtn.active { border-color: var(--accent); color: var(--accent); }
  /* Overview nav — explicit return target at the top of the board column. */
  .ov-nav { width: 100%; text-align: left; background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; cursor: pointer;
    font-size: 12px; font-weight: 600; margin-bottom: 8px; transition: border-color .15s ease, color .15s ease; }
  .ov-nav:hover { border-color: var(--accent); }
  .ov-nav.active { border-color: var(--accent); color: var(--accent); }
  .oc-nav { display:block; }
  .oc-nav .oc-avail-dot { margin-right: 7px; }
  .ov-back { font-size: 11px; margin-left: 8px; vertical-align: middle; }
  .form { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px;
    padding: 0 16px; margin-bottom: 0; display: block;
    max-height: 0; overflow: hidden; opacity: 0;
    transition: max-height .24s ease, opacity .18s ease, padding .24s ease, margin .24s ease; }
  .form.open { max-height: 700px; opacity: 1; padding: 14px 16px; margin-bottom: 12px; }
  .form input, .form textarea { width: 100%; box-sizing: border-box; background: var(--bg);
    color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px;
    font-size: 13px; margin-bottom: 10px; font-family: inherit; }
  .form textarea { resize: vertical; min-height: 72px; }
  .form .row { display: flex; gap: 8px; }
  .form button.create { background: var(--accent); color: var(--create-btn-text); border: 0; border-radius: 7px;
    padding: 8px 18px; font-weight: 700; cursor: pointer; font-size: 13px; }
  .form button.cancel { background: transparent; color: var(--muted); border: 1px solid var(--border);
    border-radius: 7px; padding: 8px 16px; cursor: pointer; font-size: 13px; }
  .form button.cancel:hover { border-color: var(--text); color: var(--text); }
  .form .err { color: var(--err); font-size: 11px; margin-top: 6px; }
  .form button.enhance { background: transparent; color: var(--accent); border: 1px solid var(--accent);
    border-radius: 7px; padding: 8px 14px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .form button.enhance:hover { background: var(--hover-bg); }
  .form button.enhance:disabled { opacity: .5; cursor: default; }
  .t-enhanced-box { border: 1px solid var(--accent); border-radius: 8px; padding: 10px; margin: 0 0 10px; background: var(--hover-bg); }
  .t-enhanced-box .t-enhanced-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--accent); font-weight: 700; margin-bottom: 6px; }
  .t-enhanced-box textarea { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 13px;
    font-family: inherit; resize: vertical; min-height: 90px; }
  .t-enhanced-box input[type="text"] { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 13px;
    font-family: inherit; font-weight: 600; margin-bottom: 8px; }
  .t-enhanced-box .t-enhanced-rationale { font-size: 11px; color: var(--muted); margin: 6px 0 8px; }
  .t-enhanced-box .row { display: flex; gap: 8px; }
  .form select { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 13px;
    margin-bottom: 10px; font-family: inherit; cursor: pointer; }
  .form select:focus { outline: none; border-color: var(--accent); }
  .flbl { display: block; font-size: 10px; color: var(--muted); text-transform: uppercase;
    letter-spacing: .5px; margin: 2px 0 3px; }
  .form .flbl { font-size: 11px; font-weight: 600; text-transform: none; letter-spacing: 0; margin: 10px 0 4px; }
  .gear { cursor: pointer; color: var(--muted); font-size: 16px; background: none; border: 0; }
  .gear-lg { font-size: 19px; line-height: 1; }
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
  .ov-card[onclick] { cursor: pointer; transition: border-color .15s ease, background .15s ease; }
  .ov-card[onclick]:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--panel-2)); }
  .ov-card.warn { border-color: color-mix(in srgb, var(--warn) 50%, var(--border)); }
  .ov-card.ok { border-color: color-mix(in srgb, var(--ok) 50%, var(--border)); }
  .ov-card.err { border-color: color-mix(in srgb, var(--err) 50%, var(--border)); }
  .ov-num { font-size: 22px; font-weight: 700; line-height: 1; }
  .new-task-panel { padding: 18px 20px 24px; }
  .new-task-panel .form { max-width: none; }
  .sk-param-area { border: 1px dashed var(--border); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
  .sk-param-area .flbl { color: var(--accent); margin-top: 0; }
  .sk-param-area input + .flbl { margin-top: 8px; }
  .sk-param-area input { margin-bottom: 6px; }
  .attach-drop.drag-over { border: 1px dashed var(--accent) !important; background: color-mix(in srgb, var(--accent) 8%, var(--panel-2)); border-radius: 6px; }
  .ov-lbl { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .ov-hint { color: var(--muted); font-size: 12px; text-align: center; margin-top: 20px; }
  .badge.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 16%, var(--badge-bg)); }
  .badge.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 16%, var(--badge-bg)); }
  .badge.err { color: var(--err); }
  .stuck-banner { background: color-mix(in srgb, var(--warn) 10%, var(--panel-2)); border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border)); border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
  .stuck-banner-head { font-weight: 600; color: var(--warn); font-size: 12px; margin-bottom: 4px; }
  .stuck-item-list { margin: 4px 0 0; list-style: none; padding: 0; }
  .stuck-item-list li { font-size: 11px; color: var(--text); padding: 2px 0; }
  .stuck-action { font-size: 11px; color: var(--muted); margin-top: 6px; }
  .usage-pill { background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 999px; padding: 3px 11px; font-size: 11px; font-weight: 600; white-space: nowrap; cursor: default; }
  .usage-breakdown { font-size: 11px; }
  .usage-breakdown .urow { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .usage-breakdown .urow .um { color: var(--muted); }
  .usage-breakdown .usep { border-top: 1px solid var(--border); margin: 5px 0 3px; }
  .usage-bar-wrap { display: flex; align-items: center; gap: 6px; margin: 2px 0 4px; }
  .usage-bar { display: inline-block; position: relative; height: 6px; border-radius: 3px; background: var(--border); flex: 1; overflow: hidden; }
  .usage-bar-fill { display: block; height: 100%; border-radius: 3px; transition: width .3s; }
  .usage-bar-fill.ok  { background: var(--ok,  #4caf50); }
  .usage-bar-fill.warn { background: #f0a500; }
  .usage-bar-fill.hi  { background: #e05b2c; }
  /* Day markers on 7-day windows — a thin page-background notch every 1/7 of the
     bar, so "3 days of usage in day 1" reads as a mostly-full first segment
     instead of a vague overall percentage. */
  .usage-bar-tick { position: absolute; top: 0; bottom: 0; width: 1.5px; background: var(--bg); z-index: 1; pointer-events: none; }
  .usage-status-dot { font-size: 9px; vertical-align: middle; margin-right: 3px; }
  .usage-status-dot.ok   { color: var(--ok, #4caf50); }
  .usage-status-dot.warn { color: #f0a500; }
  .usage-status-dot.hi   { color: #e05b2c; }
  .usage-win-bars button { display: inline-flex; align-items: center; gap: 4px; }
  .usage-win-bars .usage-bar-wrap { margin: 0; }
  .usage-win-bars .usage-bar { width: 26px; flex: none; }
  .usage-bar-days { display: inline-flex; align-items: center; }
  .usage-bar-day { display: inline-block; width: 3px; height: 6px; border-radius: 1px; background: var(--border); margin-right: 1px; }
  .usage-bar-day:last-child { margin-right: 0; }
  .usage-bar-day.filled.ok { background: var(--ok, #4caf50); }
  .usage-bar-day.filled.hi { background: #e05b2c; }
  #usageWinToggle button { border: 1px solid transparent; }
  #usageWinToggle button.on { background: var(--panel-2); color: var(--accent); border-color: var(--accent); }
  /* Compact at-a-glance provider cards for the Usage section. */
  .usage-cards { display: flex; flex-direction: column; gap: 6px; }
  .usage-card { border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; background: var(--panel-2); }
  .usage-card.low { border-color: #e05b2c; }
  .usage-card .uc-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .usage-card .uc-name { font-weight: 600; font-size: 12px; }
  .usage-card .uc-pct { font-size: 12px; font-weight: 600; }
  .usage-card.low .uc-pct { color: #e05b2c; }
  .usage-card .uc-reset { font-size: 10px; margin-top: 3px; }
  .usage-details { margin-top: 8px; }
  .usage-details > summary { cursor: pointer; list-style: none; font-size: 11px; color: var(--muted); }
  .usage-details > summary::-webkit-details-marker { display: none; }
  .usage-details > summary::before { content: '▸ '; }
  .usage-details[open] > summary::before { content: '▾ '; }
  .usage-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:20px; }
  .usage-head h2 { margin:0 0 10px; }
  .obs-split { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:8px; }
  .obs-split .opill { font-size:11px; padding:2px 8px; border-radius:20px; border:1px solid var(--border); background:var(--panel-2); color:var(--muted); }
  .obs-tbl { width:100%; border-collapse:collapse; font-size:11.5px; }
  .obs-tbl th { text-align:left; color:var(--muted); font-weight:600; padding:3px 6px; border-bottom:1px solid var(--border); }
  .obs-tbl td { padding:3px 6px; border-bottom:1px solid var(--border); }
  .obs-strip { display:flex; flex-wrap:wrap; gap:14px; margin:8px 0 4px; padding:8px 10px; background:var(--panel-2); border:1px solid var(--border); border-radius:8px; }
  .obs-cell { display:flex; flex-direction:column; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .obs-cell b { font-size:13px; color:var(--text); text-transform:none; letter-spacing:0; }
  /* Observability dashboard (dedicated popup) */
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
  .compat-chip { min-width:0; max-width:100%; display:inline-block; border:1px solid color-mix(in srgb, var(--ok) 35%, var(--border)); color:var(--ok); background:var(--panel); border-radius:999px; padding:0 5px; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; }
  .command-run { background:var(--accent); color:var(--create-btn-text); border:0; flex:1; }
  .command-view { display:none; max-height:200px; overflow:auto; font-size:11px; background:var(--code-bg); color:var(--code-text); padding:8px; border-radius:6px; margin:0 10px 10px; white-space:pre-wrap; }
  /* Unified Skills & Commands section */
  .sk-toolbar { display:flex; gap:6px; align-items:center; margin-bottom:8px; }
  .sk-toolbar input { flex:1; min-width:80px; margin:0; }
  .sk-toolbar .addbtn { width:auto; flex:none; margin-bottom:0; white-space:nowrap; }
  .sk-list { max-height:300px; overflow:auto; }
  .sk-list:empty { display:none; }
  .sk-row { display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:7px; cursor:pointer; transition:background .1s; }
  .sk-row:hover { background:color-mix(in srgb,var(--panel) 70%,transparent); }
  .sk-row.sel { background:color-mix(in srgb,var(--accent) 11%,var(--panel-2)); }
  .sk-row.sel .sk-row-name { color:var(--accent-2); }
  .sk-row.kbd-focus { background:var(--panel); outline:1px solid color-mix(in srgb,var(--accent-2) 35%,transparent); outline-offset:-1px; }
  .sk-row-icon { font-size:15px; flex:none; width:20px; text-align:center; line-height:1; }
  .sk-row-body { flex:1; min-width:0; }
  .sk-row-name { font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sk-row-desc { font-size:10.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sk-row .sk-desc { overflow:hidden; text-overflow:ellipsis; }
  .sk-row-right { display:flex; align-items:center; gap:3px; flex:none; max-width:48%; overflow:hidden; }
  .sk-badge { display:inline-block; font-size:10px; color:var(--muted); border:1px solid var(--border); border-radius:999px; padding:0 5px; margin-left:4px; white-space:nowrap; }
  .sk-badge.src { color:var(--accent-2); border-color:color-mix(in srgb, var(--accent-2) 42%, var(--border)); }
  .sk-badge.warn { color:var(--warn); border-color:color-mix(in srgb, var(--warn) 45%, var(--border)); }
  .sk-badge.err { color:var(--err); border-color:color-mix(in srgb, var(--err) 45%, var(--border)); }
  .sk-detail { margin-top:10px; border:1px solid var(--border); border-radius:10px; background:var(--panel-2); padding:10px 11px; }
  .sk-detail .sk-dhead { display:flex; align-items:center; gap:7px; margin-bottom:4px; }
  .sk-detail .sk-dhead-icon { font-size:18px; line-height:1; flex:none; }
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
  .sk-tab { flex:1; text-align:center; padding:6px 4px; font-size:12px; border:1px solid var(--border); border-radius:6px; cursor:pointer; color:var(--muted); transition:color .15s ease, border-color .15s ease, background .15s ease; }
  .sk-tab.active { color:var(--accent-2); border-color:color-mix(in srgb, var(--accent-2) 45%, var(--border)); background:var(--panel); }
  .linklike { background:none; border:0; color:var(--muted); text-decoration:underline; cursor:pointer; font-size:11px; padding:0; }
  .usage-refresh { border:1px solid var(--border); background:var(--panel-2); color:var(--muted);
    width:24px; height:24px; border-radius:6px; cursor:pointer; line-height:1; font-size:13px; }
  .usage-refresh:hover { color:var(--text); border-color:var(--text); }
  .usage-refresh[disabled] { opacity:.45; cursor:default; }
  .col.board .ctx-sec:first-child > summary { margin-top: 6px; }
  .attach-drop { border: 1px dashed var(--border); border-radius: 6px; padding: 4px 6px; }
  .usage-action { border:1px solid var(--border); background:var(--panel-2); color:var(--text);
    border-radius:6px; cursor:pointer; font-size:11px; padding:4px 8px; margin-top:6px; }
  .usage-action:hover { border-color:var(--accent-2); }
  .usage-action[disabled] { opacity:.45; cursor:default; }
  .update-pill { cursor: pointer; background: var(--panel-2); color: var(--text);
    border-radius: 999px; padding: 3px 11px; font-size: 11px; font-weight: 700; white-space: nowrap;
    border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border)); }
  .update-pill.update-available {
    background: var(--warn); color: #1a1205;
    border-color: color-mix(in srgb, var(--warn) 60%, var(--text));
    animation: updatePulse 2s ease-in-out infinite;
  }
  .update-pill:hover { filter: brightness(1.08); }
  @keyframes updatePulse {
    0%,100% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--warn) 35%, transparent); }
    50% { transform: scale(1.025); box-shadow: 0 0 0 8px color-mix(in srgb, var(--warn) 0%, transparent); }
  }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45);
    display: flex; align-items: center; justify-content: center; z-index: 50;
    opacity: 0; visibility: hidden; pointer-events: none;
    transition: opacity .18s ease, visibility .18s; }
  .overlay.open { opacity: 1; visibility: visible; pointer-events: auto; }
  .overlay .modal { transform: translateY(8px) scale(.97); transition: transform .2s cubic-bezier(.2,.8,.2,1); }
  .overlay.open .modal { transform: none; }
  .modal { width: 640px; max-width: 92vw; max-height: 84vh; overflow-y: auto; background: var(--modal-bg);
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
  .mb-step .mb-mark.ok { color: var(--ok); } .mb-step .mb-mark.no { color: var(--err); } .mb-step .mb-mark.skip { color: var(--muted); }
  .mb-step .mb-body { flex: 1; }
  .mb-step .mb-body .t { font-weight: 600; margin-bottom: 2px; }
  .mb-step button { margin-top: 5px; font-size: 11px; padding: 3px 10px; border-radius: 6px; cursor: pointer;
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  .mb-chip { display: inline-flex; align-items: center; gap: 3px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px;
    padding: 1px 6px 1px 9px; margin: 2px 4px 2px 0; font-size: 11px; }
  .mb-chip .x { cursor: pointer; color: var(--muted); font-size: 10px; line-height: 1; }
  .mb-chip .x:hover { color: var(--err); }
  .mb-chip .act { cursor: pointer; color: var(--muted); font-size: 10px; line-height: 1; font-weight: 700; }
  .mb-chip .act:hover { color: var(--accent); }
  .mb-ignored-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 11px; }
  .ss-section { margin-top:12px; }
  .ss-section-hd { font-weight:600; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
  .ss-chip { display:inline-flex; align-items:center; background:var(--panel-2); border:1px solid var(--border); border-radius:12px; padding:1px 6px 1px 9px; margin:2px 4px 2px 0; font-size:11px; gap:3px; }
  .ss-chip .x { cursor:pointer; color:var(--muted); font-size:10px; line-height:1; }
  /* ── Zero-terminal onboarding wizard ───────────────────────────────────── */
  .ob-wizard { width: 580px; }
  .ob-prog { display: flex; gap: 6px; margin-bottom: 20px; }
  .ob-prog-seg { flex: 1; height: 3px; border-radius: 2px; background: var(--border); transition: background .3s; }
  .ob-prog-seg.done { background: var(--ok); }
  .ob-prog-seg.active { background: var(--accent); }
  .ob-step-panel { display: none; }
  .ob-step-panel.active { display: block; }
  .ob-step-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin-bottom: 6px; }
  .ob-heading { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
  .ob-subheading { font-size: 12px; color: var(--muted); margin-bottom: 14px; line-height: 1.55; }
  .ob-perm-row { display: flex; align-items: flex-start; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .ob-perm-row:last-child { border-bottom: 0; }
  .ob-pm { width: 18px; text-align: center; font-size: 14px; flex-shrink: 0; line-height: 1.7; }
  .ob-pm.ok { color: var(--ok); } .ob-pm.no { color: var(--muted); }
  .ob-perm-info { flex: 1; }
  .ob-perm-title { font-weight: 600; }
  .ob-perm-desc { color: var(--muted); margin-top: 1px; font-size: 11px; }
  .ob-perm-actions { margin-top: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ob-perm-actions button { font-size: 11px; padding: 3px 10px; border-radius: 6px; cursor: pointer;
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  .ob-perm-granted { font-size: 11px; color: var(--ok); }
  .ob-model-card { border: 1px solid var(--border); border-radius: 8px; padding: 11px 13px; margin-bottom: 8px;
    display: flex; align-items: flex-start; gap: 10px; transition: border-color .2s; }
  .ob-model-card.detected { border-color: color-mix(in srgb, var(--ok) 60%, var(--border)); }
  .ob-model-icon { font-size: 18px; line-height: 1.4; }
  .ob-model-body { flex: 1; min-width: 0; }
  .ob-model-name { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; }
  .ob-model-status { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .ob-model-status.ok { color: var(--ok); }
  .ob-model-expand { font-size: 11px; color: var(--accent-2); cursor: pointer; margin-top: 5px; user-select: none; }
  .ob-model-detail { display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
  .ob-model-detail.open { display: block; }
  .ob-model-detail input { margin-bottom: 4px; width: 100%; box-sizing: border-box; }
  .ob-model-detail .ob-btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .ob-model-detail .ob-btn-row button { font-size: 11px; padding: 3px 10px; border-radius: 6px; cursor: pointer;
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  .ob-model-mark { font-size: 14px; }
  .ob-model-mark.ok { color: var(--ok); } .ob-model-mark.no { color: var(--muted); }
  .ob-brain-preview { font-size: 11px; color: var(--muted); margin-top: 4px; min-height: 14px; }
  .ob-brain-preview.ok { color: var(--ok); }
  .ob-brain-preview.warn { color: var(--warn); }
  .ob-brain-row { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0 4px; }
  .ob-brain-row input { flex: 1; margin-bottom: 0; }
  .ob-brain-row button { flex-shrink: 0; font-size: 12px; padding: 6px 14px; border-radius: 6px; cursor: pointer;
    background: var(--accent); color: var(--create-btn-text); border: 0; font-weight: 600; }
  .ob-any-status { font-size: 11px; margin-bottom: 10px; }
  .ob-any-status.ok { color: var(--ok); }
  .ob-any-status.warn { color: var(--warn); }
  .ob-nav { display: flex; align-items: center; gap: 8px; margin-top: 18px; border-top: 1px solid var(--border); padding-top: 14px; }
  .ss-chip .x:hover { color:var(--err); }
  .mb-ignored-row .mb-ig-addr { font-weight: 600; }
  .mb-ignored-row .mb-ig-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: italic; }
  .mb-ignored-row button { font-size: 10px; padding: 2px 9px; border-radius: 6px; cursor: pointer;
    background: var(--accent); color: var(--create-btn-text, #1a1a1a); border: 0; font-weight: 700; }
  .mb-ignored-row button.secondary { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  .tabs { display: flex; gap: 6px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
  .tab { padding: 6px 12px; cursor: pointer; font-size: 12px; color: var(--muted); border-bottom: 2px solid transparent; transition: color .15s ease, border-color .15s ease; }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .backend { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px; }
  .backend .nm { font-weight: 600; min-width: 150px; }
  .backend .st { font-size: 11px; }
  .backend .st.ok { color: var(--ok); } .backend .st.no { color: var(--muted); }
  .mdl-card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
  .mdl-card-head { display: flex; align-items: center; gap: 8px; }
  .mdl-card-name { font-weight: 600; font-size: 12px; flex: 1; }
  .mdl-tier { font-size: 11px; color: var(--muted); margin-top: 4px; word-break: keep-all; }
  .mdl-tier-alias { display: block; padding-left: 14px; }
  .mdl-card-foot { font-size: 11px; color: var(--muted); margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); }
  .vinfo { font-size: 11px; color: var(--muted); margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
  .status-card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .status-card-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none; border-bottom: 1px solid var(--border); }
  .status-card.collapsed .status-card-head { border-bottom: none; }
  .status-card-head:hover { background: rgba(255,255,255,.03); }
  .status-card-name { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; flex: 1; }
  .status-card-caret { font-size: 9px; color: var(--muted); flex: 0 0 auto; }
  .status-card-count { font-size: 11px; color: var(--accent); font-weight: 600; }
  .status-card-body { padding: 6px 8px 8px; }
  /* Review-lane batch grouping (display-only rollup — see groupReviewBatches
     in the board script). Cards keep their own styling inside the group. */
  .batch-group { border: 1px dashed var(--border); border-radius: 8px; padding: 6px 6px 0; margin-bottom: 8px; }
  .batch-group-head { font-size: 10.5px; font-weight: 600; color: var(--muted); padding: 0 2px 6px; }
  .card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: border-color .1s; position: relative;
    box-shadow: var(--card-shadow); width: 100%; box-sizing: border-box; min-height: 52px; }
  .card:hover { border-color: var(--accent-2); }
  /* Board status colors: needs_input → amber (operator action), ready_for_review
     → green (waiting on team). Status owns border+tint; selection is an additive
     ring (box-shadow) so the two signals never collide on themes where --accent
     equals --warn/--ok. See docs/superpowers/specs/2026-07-15-board-status-colors-design.md */
  .card.tone-attention { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 8%, var(--panel-2)); }
  .card.tone-review    { border-color: var(--ok);   background: color-mix(in srgb, var(--ok) 8%, var(--panel-2)); }
  .card.sel { box-shadow: 0 0 0 2px var(--accent); }
  .card.in-progress { animation: taskCardPulse 2.6s ease-in-out infinite; box-shadow: 0 0 0 0 rgba(249, 193, 75, 0.24); }
  .card.in-progress:hover { animation-duration: 1.6s; }
  .card .t { font-weight: 600; margin-bottom: 2px; padding-right: 58px; }
  .card .m { font-size: 11px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; }
  .card .card-archive { position: absolute; top: 5px; right: 6px; font-size: 10.5px; font-weight: 600;
    line-height: 1; color: var(--muted); background: none; border: 1px solid transparent;
    cursor: pointer; padding: 3px 7px; border-radius: 4px; opacity: 0; transition: opacity .1s; letter-spacing: .2px; }
  .card:hover .card-archive { opacity: 1; }
  .card .card-archive:hover { color: var(--accent-2); background: var(--border); border-color: var(--border); }
  .card .mdl-card-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
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
  /* Provenance pills on a completed task's detail view — what ran it. Color
     coding: model = blue (matches the existing .badge.model convention),
     MCP server = violet, skill/command = teal, agent role = gold (a 4th,
     distinct hue — NOT the same class as .role, which names the model pill
     for historical reasons; do not conflate the two). Consistent across all
     three themes via the --pill-*/--accent custom properties above. */
  .prov-pills { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
  .prov-pill { font-size: 10px; padding: 2px 8px; border-radius: 999px; font-weight: 600;
    border: 1px solid currentColor; background: transparent; }
  .prov-pill.role { color: var(--accent-2); }
  .prov-pill.mcp { color: var(--pill-mcp); }
  .prov-pill.skill { color: var(--pill-skill); }
  .prov-pill.agent { color: var(--accent); }
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
  /* ── Schedule timeline ───────────────────────────────── */
  .sch-view-btns { display: flex; gap: 4px; margin-bottom: 8px; }
  .sch-view-btn { font-size: 11px; padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border);
    background: var(--panel-2); color: var(--muted); cursor: pointer; }
  .sch-view-btn.active { border-color: var(--accent-2); color: var(--accent-2); background: rgba(88,166,255,.1); }
  .sch-view-btn:hover:not(.active) { border-color: var(--accent-2); color: var(--text); }
  .tl-wrap { margin: 0 0 10px; }
  .tl-header { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--muted); margin-bottom: 4px; }
  .tl-track { position: relative; height: 32px; background: var(--bg); border-radius: 4px; border: 1px solid var(--border); overflow: visible; }
  .tl-now-line { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ok); opacity: .8; z-index: 2; border-radius: 1px; }
  .tl-tick { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--border); }
  .tl-tick-lbl { position: absolute; bottom: -14px; font-size: 9px; color: var(--muted); transform: translateX(-50%); white-space: nowrap; pointer-events: none; }
  .tl-dot { position: absolute; top: 50%; transform: translate(-50%,-50%); width: 10px; height: 10px;
    border-radius: 50%; border: 2px solid var(--bg); cursor: pointer; z-index: 3; transition: transform .1s; }
  .tl-dot:hover { transform: translate(-50%,-50%) scale(1.5); z-index: 10; }
  .tl-dot.status-active { background: var(--ok); }
  .tl-dot.status-sleeping { background: var(--muted); }
  .tl-dot.status-blocked { background: var(--err); }
  .tl-dot.status-overdue { background: var(--err); box-shadow: 0 0 0 3px rgba(248,81,73,.3); }
  .tl-dot.status-soon { background: var(--warn); box-shadow: 0 0 0 3px rgba(210,153,34,.25); }
  .tl-window-btn { font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border);
    background: var(--panel-2); color: var(--muted); cursor: pointer; }
  .tl-window-btn.active { color: var(--accent-2); border-color: var(--accent-2); }
  .countdown { font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 600; }
  .countdown.soon { background: rgba(210,153,34,.18); color: var(--warn); }
  .countdown.overdue { background: rgba(248,81,73,.13); color: var(--err); }
  .countdown.ok { background: rgba(63,185,80,.13); color: var(--ok); }
  .countdown.muted { background: var(--badge-bg); color: var(--badge-text); }
  .dir-group-hdr { font-size: 10px; font-weight: 600; color: var(--muted); text-transform: uppercase;
    letter-spacing: .5px; margin: 8px 0 4px; padding-bottom: 3px; border-bottom: 1px solid var(--border); }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
  .dot.active { background: var(--ok); } .dot.done { background: var(--accent-2); }
  .dot.sleeping { background: var(--muted); } .dot.blocked, .dot.failed { background: var(--err); }
  .muted { color: var(--muted); }
  .live { font-size: 10px; color: var(--ok); }
  .live.degraded { color: var(--warn); }
  .live.down, .live.stale { color: var(--err); }
  .archive-link { font-size: 11px; color: var(--accent-2); cursor: pointer; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .archive-link:hover { text-decoration: underline; }
  .board-sec { margin: 0; }
  .board-sec-header { font-size: 14px; font-weight: 600; margin: 20px 0 6px; color: var(--text); display: flex; align-items: center; gap: 8px; }
  /* Standardized task-detail action row. One set of tokens for every reply/review/
     retry/steer control so heights, radius, padding, and min-width match. */
  .action-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
  .action-bar > button { min-height: 30px; min-width: 72px; border-radius: 6px; padding: 6px 14px;
    font-size: 12px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center;
    justify-content: center; gap: 6px; white-space: nowrap; border: 1px solid var(--border);
    background: var(--panel-2); color: var(--text);
    transition: background .15s ease, border-color .15s ease, color .15s ease, opacity .12s ease, filter .12s ease; }
  .action-bar > button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  .action-bar > button[disabled] { opacity: .5; cursor: default; filter: none; }
  /* The one obvious next action. Child combinator beats the base button rule. */
  .action-bar > .primary-action { background: var(--accent); color: var(--create-btn-text);
    border-color: var(--accent); font-weight: 700; }
  .action-bar > .primary-action:hover { filter: brightness(1.08); }
  .action-bar > .secondary-action:hover { border-color: var(--accent-2); }
  .action-bar > .ghost-action { background: transparent; color: var(--muted); border-color: transparent; }
  .action-bar > .ghost-action:hover { color: var(--text); border-color: var(--accent-2); }
  /* Destructive: quiet until hover, then it reads red — not loud unless engaged. */
  .action-bar > .danger-action:hover { border-color: var(--err); color: var(--err); }
  /* Narrow task-detail column → stack controls full-width instead of cramming. */
  @container (max-width: 420px) {
    .action-bar { flex-direction: column; align-items: stretch; }
    .action-bar > button { width: 100%; }
  }
  .reply-question { background: var(--reply-q-bg); border: 1px solid var(--accent-2); border-radius: 6px;
    padding: 8px 12px; font-size: 12px; color: var(--text); margin-bottom: 8px; }
  /* Reply/retry/steer textarea fills the column (it's a block child of the
     section, so flex:1 was a no-op) and keeps a stable minimum height. */
  .reply-input { width: 100%; box-sizing: border-box; background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); font: 12px/1.4 inherit; padding: 8px 10px; min-height: 64px; resize: vertical; }
  .reply-input:focus { outline: none; border-color: var(--accent-2); }
  .reply-section { display: none; }
  .reply-section.open { display: block; }
  /* needs_input: the reply window stands out so a waiting question is unmissable. */
  .reply-section.needs { display: block; border: 1.5px solid var(--accent-2); border-radius: 10px;
    padding: 12px 14px; background: var(--reply-q-bg); margin: 14px 0; box-shadow: 0 0 0 3px rgba(76,201,240,.10); }
  .reply-head { font-size: 13px; font-weight: 700; color: var(--accent-2); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
  /* review/failed reply: present but understated — a thin left rule, no glow/card. */
  .reply-section.subtle.open { display: block; border-left: 2px solid var(--border); padding: 8px 0 8px 12px; margin: 12px 0; }
  .reply-subhead { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
  .reply-toggle.active { border-color: var(--accent-2) !important; color: var(--accent-2) !important; }
  .settings-switch { display: inline-flex; align-items: center; gap: 8px; min-width: 112px; justify-content: flex-start;
    border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px 4px 5px; background: var(--panel-2);
    color: var(--muted); font-size: 11px; font-weight: 700; line-height: 1; cursor: pointer; white-space: nowrap; }
  .settings-switch:hover { border-color: var(--accent-2); color: var(--text); }
  .settings-switch:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  .settings-switch-track { position: relative; width: 34px; height: 18px; border-radius: 999px; flex: 0 0 34px;
    background: var(--border); box-shadow: inset 0 0 0 1px rgba(255,255,255,.05); transition: background .16s ease; }
  .settings-switch-knob { position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%;
    background: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: transform .16s ease, background .16s ease; }
  .settings-switch-text { min-width: 58px; text-align: left; color: inherit; }
  .settings-switch.is-on { border-color: color-mix(in srgb, var(--ok) 70%, var(--border)); color: var(--text);
    background: color-mix(in srgb, var(--ok) 16%, var(--panel-2)); }
  .settings-switch.is-on .settings-switch-track { background: var(--ok); }
  .settings-switch.is-on .settings-switch-knob { transform: translateX(16px); background: var(--bg); }
  .settings-switch.is-off { color: var(--muted); }
  .settings-switch.is-disabled { opacity: .55; cursor: not-allowed; }
  .settings-switch.is-disabled:hover { border-color: var(--border); color: var(--muted); }
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
  /* Prominent primary for Lane actions (the form-scoped .create isn't styled in cards). */
  .lane-primary { background: var(--accent); color: var(--create-btn-text); border: 0; border-radius: 6px; padding: 5px 12px; font-size: 11px; font-weight: 700; cursor: pointer; }
  .lane-primary:hover { filter: brightness(1.08); }
  /* When an update/repair is involved, use the warning colour so it stands out. */
  .lane-primary.update { background: var(--warn); color: #1a1205; }
  .lane-primary[disabled] { opacity: .5; cursor: default; filter: none; }
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
  #s_qr svg, #s_cf_qr svg { width: 100%; height: 100%; display: block; }
  /* Project search dropdown */
  .project-search { position: relative; margin-bottom: 6px; }
  .project-search input { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit; margin-bottom: 4px; }
  .project-search input:focus { outline: none; border-color: var(--accent); }
  .project-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
    background: var(--modal-bg); border: 1px solid var(--border); border-radius: 8px;
    margin-top: 2px; box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; flex-direction: column; }
  .project-dropdown.hidden { display: none; }
  .project-sort-row { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .project-sort-btn { font-size: 10px; padding: 2px 8px; border-radius: 999px; cursor: pointer;
    color: var(--muted); background: var(--panel-2); border: 1px solid var(--border); user-select: none; }
  .project-sort-btn.active { color: var(--accent); border-color: var(--accent); }
  .project-list { max-height: 320px; overflow-y: auto; }
  .project-item { display: flex; flex-direction: column; gap: 1px; padding: 7px 10px; cursor: pointer;
    font-size: 12px; border-bottom: 1px solid var(--border); }
  .project-item:last-child { border-bottom: none; }
  .project-item:hover, .project-item.selected, .project-item.active { background: var(--hover-bg); }
  .project-item-row1 { display: flex; align-items: center; gap: 5px; }
  .project-item .pname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .project-item .pstar { color: var(--ok); font-size: 11px; flex-shrink: 0; }
  .project-item .ptime { font-size: 10px; color: var(--muted); flex-shrink: 0; }
  .project-item .ppath { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .project-empty { padding: 12px 10px; font-size: 11px; color: var(--muted); text-align: center; }
  .project-empty.hidden { display: none; }
  /* Selected project row: name + muted derived path (no raw path input) */
  .project-selected { display: flex; align-items: center; gap: 6px; margin: 2px 0 8px;
    padding: 7px 10px; background: color-mix(in srgb, var(--accent) 6%, var(--panel-2));
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 8px; min-width: 0; }
  .project-selected .pname { font-size: 12px; font-weight: 600; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0; }
  .project-selected .pstar { color: var(--ok); font-size: 11px; flex-shrink: 0; }
  .project-selected .ppath { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; flex: 1 1 auto; min-width: 0; }
  .project-selected .project-clear { background: none; border: 0; cursor: pointer; color: var(--muted);
    font-size: 16px; padding: 0; flex-shrink: 0; margin-left: auto; line-height: 1; }
  .project-selected .project-clear:hover { color: var(--err); }
  .custom-folder-toggle { display: inline-block; margin: 0 0 6px; font-size: 11px; }
  .custom-folder { margin: 0 0 6px; }
  .custom-folder input { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
  /* Dropdown appear animation */
  @keyframes dropdownAppear { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:none; } }
  .project-dropdown:not(.hidden) { animation: dropdownAppear .14s ease; }
  /* Active/live status dot pulse */
  @keyframes dotPulse { 0%,100% { opacity:1; } 55% { opacity:.5; } }
  @keyframes taskCardPulse {
    0% { box-shadow: 0 0 0 0 rgba(249, 193, 75, 0.0); }
    45% { box-shadow: 0 0 0 6px rgba(249, 193, 75, 0.20); }
    90% { box-shadow: 0 0 0 12px rgba(249, 193, 75, 0.0); }
    100% { box-shadow: 0 0 0 0 rgba(249, 193, 75, 0.0); }
  }
  .dot.active { animation: dotPulse 2.8s ease-in-out infinite; }
  /* Obs window button transition */
  .obs-win button { transition: background .15s ease, color .15s ease; }
  /* Sch-view-btn transition */
  .sch-view-btn { transition: border-color .15s ease, color .15s ease, background .15s ease; }
  /* ── Flash center pane ─────────────────────────────────────────────── */
  .oc-avail-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  .oc-avail-dot.ok  { background:var(--ok); }
  .oc-avail-dot.off { background:var(--muted); }
  .oc-avail-dot.err { background:var(--err); }
  .oc-session-sel { font-size:11px; color:var(--muted); background:transparent; border:none;
    cursor:pointer; max-width:160px; padding:2px 4px; border-radius:4px; }
  .oc-session-sel:hover { background:var(--hover-bg); }
  .col.session.oc-session-mode { overflow:hidden; display:flex; flex-direction:column; min-height:0; }
  .oc-center-pane { flex:1 1 auto; min-height:0; height:calc(100vh - 68px); max-height:calc(100vh - 68px); width:100%; display:flex; flex-direction:column; max-width:980px;
    margin:0 auto; padding:18px 18px 14px; gap:12px; overflow:hidden; }
  .oc-panel-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .oc-panel-title { display:flex; align-items:center; gap:8px; font-size:18px; font-weight:700; }
  .oc-panel-sub { color:var(--muted); font-size:12px; }
  .oc-panel-head-spacer { flex:1 1 auto; min-width:12px; }
  .oc-panel-body { flex:1 1 auto; min-height:0; display:flex; flex-direction:column;
    border:1px solid var(--border); border-radius:10px; background:var(--panel-2); overflow:hidden; }
  .oc-transcript { flex:1 1 auto; min-height:0; overflow-y:auto; padding:16px 18px; font-size:13px; scroll-behavior:smooth; }
  .oc-msg { margin-bottom:14px; }
  .oc-msg-user { text-align:right; }
  .oc-msg-user .oc-msg-text { background:var(--reply-q-bg); border-radius:10px; padding:7px 11px;
    display:inline-block; max-width:78%; word-break:break-word; text-align:left; }
  .oc-msg-assistant .oc-msg-text { color:var(--text); word-break:break-word; }
  .oc-msg-system .oc-msg-text { color:var(--muted); font-style:italic; word-break:break-word; }
  .oc-msg-meta { font-size:10px; color:var(--muted); margin-bottom:3px; }
  .oc-panel-composer-shell { flex:0 0 auto; min-height:96px; display:grid; grid-template-columns:minmax(0, 1fr) 88px;
    align-items:end; gap:8px; width:100%; min-width:0;
    padding:12px; border-top:1px solid var(--border); background:var(--panel); cursor:text; }
  .oc-panel-composer-shell.oc-drag { background:color-mix(in srgb, var(--accent) 8%, var(--panel)); outline:2px dashed var(--accent); outline-offset:-4px; }
  .oc-input { width:100%; min-width:0; min-height:64px; max-height:180px; padding:9px 11px;
    border:1px solid var(--border); border-radius:8px; background:var(--code-bg);
    color:var(--text); font-size:13px; resize:none; font-family:inherit; line-height:1.45; }
  .oc-input:focus { outline:none; border-color:var(--accent); }
  .oc-panel-composer-actions { display:flex; flex-direction:column; gap:7px; min-width:0; }
  .oc-panel-composer-actions button { width:100%; min-width:0; text-align:center; }
  .oc-img-preview { display:flex; gap:8px; flex-wrap:wrap; padding:0 12px; }
  .oc-img-preview:empty { display:none; }
  .oc-img-chip { position:relative; width:56px; height:56px; border-radius:8px; overflow:hidden;
    border:1px solid var(--border); flex:0 0 auto; }
  .oc-img-chip img { width:100%; height:100%; object-fit:cover; display:block; }
  .oc-img-chip .rm { position:absolute; top:1px; right:1px; width:16px; height:16px; line-height:14px;
    text-align:center; border-radius:50%; background:rgba(0,0,0,0.65); color:#fff; font-size:11px;
    cursor:pointer; border:none; padding:0; }
  .oc-mic-btn { padding:7px 6px; border:1px solid var(--border); border-radius:8px;
    background:var(--code-bg); color:var(--text); font-size:12px; font-family:inherit;
    cursor:pointer; white-space:nowrap; }
  .oc-mic-btn:hover { border-color:var(--accent); }
  .oc-mic-btn.recording { border-color:#e05b2c; color:#e05b2c; background:rgba(224,91,44,0.08); }
  .oc-warn-panel { display:flex; align-items:flex-start; gap:10px; padding:18px; font-size:13px; }
  .oc-warn-icon { flex-shrink:0; color:var(--warn); font-size:15px; line-height:1.3; }
  .oc-warn-body { flex:1; min-width:0; }
  .oc-warn-title { font-weight:600; color:var(--text); margin-bottom:2px; }
  .oc-warn-reason { color:var(--muted); line-height:1.4; word-break:break-word; }
  .oc-warn-action { display:inline-block; margin-top:5px; font-size:11px; color:var(--accent);
    cursor:pointer; text-decoration:underline; background:none; border:none; padding:0;
    font-family:inherit; }
  .oc-warn-action:hover { opacity:.75; }
  @media (max-width:760px) {
    .oc-center-pane { padding:12px; min-height:420px; height:auto; max-height:none; }
    .oc-panel-composer-shell { min-height:118px; grid-template-columns:1fr; align-items:stretch; }
    .oc-panel-composer-actions { flex-direction:row; }
    .oc-panel-composer-actions button { flex:1; }
  }

  /* ── Brain / Memory Review pane ─────────────────────────────────────── */
  .brain-pane { flex:1 1 auto; min-height:0; height:calc(100vh - 68px); max-height:calc(100vh - 68px);
    width:100%; display:flex; flex-direction:column; padding:18px 18px 14px; gap:12px; overflow:hidden; }
  .tools-pane { flex:1 1 auto; min-height:0; overflow-y:auto; padding:4px 4px 24px; }
  .obs-panel-toggles { display:flex; align-items:center; flex-wrap:wrap; gap:4px; padding:2px 10px 12px; }
  .tools-group { margin:14px 0 4px; }
  .tools-group-h { font-size:13px; font-weight:700; color:var(--text); padding:0 4px; }
  .tools-group-h .count { font-size:11px; color:var(--muted); font-weight:600; margin-left:4px; }
  .tools-group-sub { font-size:11px; color:var(--muted); padding:1px 4px 6px; }
  /* Multicolumn tool row: left identity+fields column, right full-description column,
     expanded detail spans the full width beneath both. Collapses to a single column
     on narrow panes via container query fallback below. */
  .tools-row { border:1px solid var(--border); border-radius:8px; background:var(--panel-2); padding:9px 12px;
    margin:6px 0; cursor:pointer; display:grid; grid-template-columns:minmax(190px,270px) 1fr;
    column-gap:16px; row-gap:6px; align-items:start; }
  .tools-row:hover { border-color:var(--accent); }
  .tools-idcol { min-width:0; display:flex; flex-direction:column; gap:5px; }
  .tools-row-top { display:flex; align-items:center; gap:7px; }
  .tools-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  .tools-dot.on { background:var(--ok,#4caf50); }
  .tools-dot.off { background:var(--muted); }
  .tools-dot.err { background:var(--err); }
  .tools-dot.lib { background:#6b7280; }
  .tools-name { font-family:ui-monospace,Menlo,monospace; font-size:12.5px; color:var(--text); font-weight:600;
    overflow:hidden; text-overflow:ellipsis; }
  .tools-kind { font-size:9.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);
    border:1px solid var(--border); border-radius:4px; padding:1px 5px; flex-shrink:0; }
  .tools-caret { margin-left:auto; color:var(--muted); font-size:11px; flex-shrink:0; }
  /* Structured fields, always visible in the left column — the "more fields" glance. */
  .tools-fields { display:flex; flex-direction:column; gap:2px; }
  .tools-field { display:flex; gap:6px; font-size:10.5px; line-height:1.35; min-width:0; }
  .tools-field .fk { color:var(--muted); text-transform:uppercase; letter-spacing:.04em; font-size:9.5px;
    min-width:62px; flex-shrink:0; padding-top:1px; }
  .tools-field .fv { color:var(--text); min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; }
  .tools-field .fv.mono { font-family:ui-monospace,Menlo,monospace; color:var(--accent); }
  .tools-status { font-size:10px; font-weight:600; }
  .tools-status.on { color:var(--ok,#4caf50); }
  .tools-status.off { color:var(--muted); }
  .tools-status.lib { color:#9aa4b2; }
  /* Rightmost column: the full description paragraph, never clamped. */
  .tools-desc { font-size:12px; color:var(--text); line-height:1.5; align-self:start; min-width:0;
    overflow-wrap:break-word; }
  /* Goal cards are a full-width stack (title row, details, next step), not the
     two-column capability layout the Tools inventory uses. */
  .tools-row.goal-row { display:block; }
  /* Goal card "do this next" step — the actionable hook; click to set/edit. */
  .goal-next { margin-top:6px; font-size:11.5px; color:var(--accent);
    cursor:pointer; border-top:1px dashed var(--border); padding-top:6px; }
  .goal-next:hover { color:var(--accent-2); }
  .tools-detail { grid-column:1 / -1; margin-top:2px; padding-top:8px; border-top:1px solid var(--border);
    font-size:11.5px; color:var(--text); display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr));
    gap:4px 18px; }
  .tools-detail .tools-k { display:inline-block; min-width:74px; color:var(--muted); font-size:10.5px;
    text-transform:uppercase; letter-spacing:.04em; }
  .tools-detail code { font-family:ui-monospace,Menlo,monospace; font-size:11px; color:var(--accent);
    word-break:break-all; }
  @media (max-width:720px) {
    .tools-row { grid-template-columns:1fr; }
  }
  .brain-shell { flex:1 1 auto; min-height:0; display:grid; grid-template-columns:200px 1fr 1fr;
    border:1px solid var(--border); border-radius:10px; background:var(--panel-2); overflow:hidden; }
  .brain-col { border-right:1px solid var(--border); display:flex; flex-direction:column; min-height:0; overflow:hidden; }
  .brain-col:last-child { border-right:none; }
  .brain-col-head { padding:10px 14px; border-bottom:1px solid var(--border); font-size:11px; font-weight:700;
    letter-spacing:.06em; text-transform:uppercase; color:var(--muted); flex-shrink:0; }
  .brain-col-body { overflow-y:auto; flex:1 1 auto; min-height:0; }
  .brain-proj-row { padding:10px 14px; cursor:pointer; border-bottom:1px solid var(--border);
    display:flex; align-items:center; justify-content:space-between; }
  .brain-proj-row:hover { background:var(--hover-bg); }
  .brain-proj-row.active { background:rgba(217,164,65,.1); border-left:2px solid var(--accent); }
  .brain-proj-row .name { font-weight:600; }
  .brain-proj-row.active .name { color:var(--accent); }
  .brain-proj-row .count { font-size:10.5px; color:var(--muted); background:var(--badge-bg); border-radius:9px; padding:1px 7px; }
  .brain-proj-row.pinned.active { background:rgba(88,166,255,.1); border-left:2px solid var(--accent-2); }
  .brain-proj-row.pinned .name { color:var(--accent-2); }
  .brain-proj-row.pinned .sub { font-size:10px; color:var(--muted); font-weight:400; margin-top:2px; }
  .brain-legend { display:flex; flex-wrap:wrap; gap:10px; padding:8px 14px; border-bottom:1px solid var(--border);
    font-size:10.5px; color:var(--muted); flex-shrink:0; background:var(--panel); }
  .brain-legend span { display:flex; align-items:center; gap:4px; white-space:nowrap; }
  .brain-toolbar { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border); flex-shrink:0; flex-wrap:wrap; }
  .brain-toolbar button { font:inherit; font-size:11.5px; background:var(--panel-2); color:var(--text);
    border:1px solid var(--border); border-radius:6px; padding:5px 10px; cursor:pointer; }
  .brain-toolbar button:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
  .brain-toolbar button:disabled { opacity:.4; cursor:not-allowed; }
  .brain-toolbar .sel-count { font-size:11px; color:var(--muted); margin-right:auto; }
  .brain-doc-row .sm.danger { border-color:var(--err); color:var(--err); }
  .brain-doc-row .sm.danger:hover { background:var(--err); color:#fff; }
  .brain-doc-row input[type="checkbox"] { flex-shrink:0; cursor:pointer; }
  .brain-doc-row { display:flex; align-items:center; gap:9px; padding:8px 12px; border-bottom:1px solid var(--border); cursor:pointer; }
  .brain-doc-row:hover { background:var(--hover-bg); }
  .brain-doc-row.selected-file { background:var(--reply-q-bg); }
  .brain-doc-row .badge { flex-shrink:0; font-size:13px; width:20px; text-align:center; }
  .brain-doc-row .meta-col { flex:1; min-width:0; }
  .brain-doc-row .fname { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .brain-doc-row.tag-brief .fname { color:var(--accent); }
  .brain-doc-row .sub { font-size:10.5px; color:var(--muted); margin-top:1px; }
  .brain-doc-row .status-tag { flex-shrink:0; font-size:9.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
    padding:2px 6px; border-radius:4px; background:var(--badge-bg); color:var(--muted); }
  .brain-doc-row.tag-brief .status-tag { background:rgba(217,164,65,.15); color:var(--accent); }
  .brain-doc-row.tag-ctx .status-tag { background:rgba(63,185,80,.15); color:var(--ok); }
  .brain-doc-row.tag-indexed .status-tag { background:rgba(88,166,255,.15); color:var(--accent-2); }
  .brain-doc-row.tag-orphan .status-tag { background:var(--badge-bg); color:var(--muted); }
  .brain-doc-row.tag-stale .status-tag { background:rgba(210,153,34,.15); color:var(--warn); }
  .brain-doc-row.tag-excluded .status-tag { background:rgba(248,81,73,.12); color:var(--err); }
  .brain-doc-row.config-file { background:rgba(88,166,255,.05); cursor:pointer; }
  .brain-doc-row.config-file .status-tag { background:rgba(88,166,255,.15); color:var(--accent-2); }
  .brain-doc-row.config-file .fname { color:var(--accent-2); }
  .brain-doc-row.archived { opacity:.5; cursor:default; }
  .brain-doc-row.archived .fname { text-decoration:line-through; }
  .brain-doc-row.archived:hover { background:transparent; }
  .archived-divider { padding:8px 12px; font-size:10.5px; color:var(--muted); text-transform:uppercase;
    letter-spacing:.06em; border-bottom:1px solid var(--border); background:var(--panel); }
  .brain-render-head { display:flex; align-items:center; justify-content:space-between; padding:10px 14px;
    border-bottom:1px solid var(--border); flex-shrink:0; gap:10px; }
  .brain-render-title { font-weight:700; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .brain-render-title .path { color:var(--muted); font-weight:400; font-size:11px; display:block; }
  .brain-toggle-group { display:flex; border:1px solid var(--border); border-radius:6px; overflow:hidden; flex-shrink:0; }
  .brain-toggle-group button { font:inherit; font-size:11px; background:var(--panel); color:var(--muted);
    border:none; padding:4px 12px; cursor:pointer; }
  .brain-toggle-group button.active { background:var(--accent); color:var(--create-btn-text); font-weight:700; }
  .brain-render-body { flex:1 1 auto; min-height:0; overflow-y:auto; padding:18px 22px; }
  .brain-render-body.raw { font:12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space:pre-wrap; color:var(--muted); }
  /* Shared full-panel empty/error/loading state — the polished centered style,
     usable by any center panel (was brain-only). .brain-empty-state kept as an
     alias so existing Brain/Roles markup is unchanged. */
  .oc-empty, .brain-empty-state { color:var(--muted); text-align:center; padding:60px 20px; font-size:12.5px; }
  .oc-empty a { color:var(--accent); }
  /* Roles screen center-pane dossier blocks (Identity/Configuration/Insight/Learned) */
  .roles-block { border-bottom:1px solid var(--border); padding:12px 14px; }
  .roles-block:last-child { border-bottom:none; }
  .roles-block-head { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); margin-bottom:8px; }
  .roles-block-body { font-size:13px; line-height:1.5; }
  .json-friendly { font-size:13px; line-height:1.5; }
  .json-row { margin-bottom:16px; }
  .json-key { display:block; font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:.04em;
    color:var(--muted); margin-bottom:4px; }
  .json-val code, .json-list code { background:var(--code-bg); border-radius:4px; padding:1px 5px;
    font:12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .json-list { margin:2px 0; padding-left:20px; }
  .json-list li { margin:4px 0; }
  @media (max-width:900px) {
    .brain-shell { grid-template-columns:1fr; overflow-y:auto; }
    .brain-col { border-right:none; border-bottom:1px solid var(--border); }
  }
</style>
</head>
<body>
<canvas id="matrixRain" aria-hidden="true"></canvas>
<header>
  <div class="hzone">
    <span class="logo">HiveMatrix</span>
    <span class="live" id="live" style="cursor:pointer" onclick="toggleConnOverride()" title="Daemon + connectivity status — click to override connectivity">● live</span>
    <span class="obs-win usage-win-bars" id="usageWinToggle">
      <button data-w="5h" class="on" id="usageBtn5h" onclick="setHeaderUsageWindow('5h')">5h<span class="usage-bar-wrap" onclick="event.stopPropagation();openObsModal()"><span class="usage-bar" id="usageBar5h"><span class="usage-bar-fill" id="usageBar5hFill"></span></span></span></button>
      <button data-w="7d" id="usageBtn7d" onclick="setHeaderUsageWindow('7d')">7d<span class="usage-bar-wrap" onclick="event.stopPropagation();openObsModal()"><span class="usage-bar-days" id="usageBar7d"><span class="usage-bar-day" data-day="1"></span><span class="usage-bar-day" data-day="2"></span><span class="usage-bar-day" data-day="3"></span><span class="usage-bar-day" data-day="4"></span><span class="usage-bar-day" data-day="5"></span><span class="usage-bar-day" data-day="6"></span><span class="usage-bar-day" data-day="7"></span></span></span></button>
    </span>
    <span class="muted" id="usageWinReadout" style="font-size:11px"></span>
  </div>
  <div class="hzone mode" style="margin-left:auto">
    <span class="hgroup" title="Connectivity — auto by default; the ● live indicator shows the current effective mode. Click it to override.">
      <span class="muted hlabel" id="connLabel" style="display:none">override</span>
      <select id="modeSel" style="display:none">
        <option value="">(auto)</option>
        <option value="cloud-ok">cloud-ok</option>
        <option value="local-only">local-only</option>
        <option value="offline">offline</option>
      </select>
    </span>
    <span class="update-pill" id="updatePill" style="display:none" onclick="applyUpdate()" title="Click to install and restart">⬆ Update</span>
    <span class="hsep"></span>
    <button class="gear" id="themeToggle" title="Toggle light / dark theme" onclick="toggleThemeQuick()">🌗</button>
    <button class="gear gear-lg ctx-toggle" id="ctxToggle" title="Hide / show the right panel" onclick="toggleContext()">◨</button>
    <button class="gear gear-lg" title="Settings" onclick="openSettings()">⚙</button>
  </div>
</header>
<div id="toastHost"></div>

<div class="overlay" id="settingsOverlay">
  <div class="modal">
    <h1>Settings <span class="x" onclick="closeSettings()">✕</span></h1>
    <div class="tabs"><div class="tab active" id="tab-about" onclick="switchSettingsTab('about')">About</div><div class="tab" id="tab-setup" onclick="switchSettingsTab('setup')">Setup</div><div class="tab" id="tab-features" onclick="switchSettingsTab('features')">Features</div><div class="tab" id="tab-general" onclick="switchSettingsTab('general')">Personalization</div><div class="tab" id="tab-models" onclick="switchSettingsTab('models')">Models</div><div class="tab" id="tab-lanes" onclick="switchSettingsTab('lanes')">Lanes</div><div class="tab" id="tab-remote" onclick="switchSettingsTab('remote')">Remote</div><div class="tab" id="tab-license" onclick="switchSettingsTab('license')">License</div></div>
    <div id="settingsModels" style="display:none">
      <div class="muted" style="font-size:11px;margin-bottom:12px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;line-height:1.45">
        <b style="color:var(--text)">How HiveMatrix routes work:</b> every role runs on Claude — <b>Thinking</b> → Opus, <b>Coding</b> → Sonnet, <b>Operational &amp; Chat</b> → Haiku, <b>Writer</b> → Sonnet. Override any role below.</div>
      <label class="flbl">Default model</label>
      <select id="s_default" style="width:100%" onchange="saveDefault()"></select>

      <label class="flbl" style="margin-top:14px">Backends</label>
      <div id="s_backends"></div>

      <div id="s_provider_toggles" style="margin-top:14px">
        <label class="flbl">Providers</label>
        <div class="muted" style="font-size:11px;margin-bottom:6px">A frontier CLI is used automatically once it's installed and signed in — no separate on/off switch.</div>
        <div id="s_provider_toggle_rows"><div class="muted">Loading…</div></div>
      </div>

      <div id="s_frontier_provider_row" style="display:none;margin-top:14px">
        <label class="flbl">Frontier provider</label>
        <div class="row" style="align-items:center;gap:8px">
          <select id="s_frontier_provider" onchange="saveFrontierProvider()" style="width:auto">
            <option value="claude">Claude (Sonnet / Opus)</option>
            <option value="codex">Codex (GPT-5.5 / Spark)</option>
          </select>
        </div>
        <div class="muted" style="font-size:11px;margin-top:2px">Which provider handles frontier work.</div>
      </div>

      <div id="s_role_models" style="margin-top:16px">
        <label class="flbl">Models</label>
        <div class="muted" style="font-size:11px;margin-bottom:8px">Each kind of work routes to its own Claude model by default. Override any role — or leave on Default.</div>
        <div id="s_role_frontier_rows">
          <div class="role-row"><span class="role-name">🧠 Thinking <span class="muted">planning · architecture · review</span></span>
            <select id="s_role_thinking" onchange="saveRoleModel('thinking', this.value)"></select></div>
          <div class="role-row"><span class="role-name">⌨️ Coding <span class="muted">critical implementation · UI</span></span>
            <select id="s_role_coding" onchange="saveRoleModel('coding', this.value)"></select></div>
        </div>
        <div class="role-row"><span class="role-name">⚙️ Operational + Chat <span class="muted">bulk execution · file ops · Flash chat</span></span>
          <select id="s_role_operational" onchange="saveRoleModel('operational', this.value)"></select></div>
        <div class="role-row"><span class="role-name">✍️ Writer <span class="muted">briefings · summaries · drafts</span></span>
          <select id="s_role_writer" onchange="saveRoleModel('writer', this.value)"></select></div>
      </div>

    </div>
    <div id="settingsRemote" style="display:none">
      <div class="remote-status"><span class="dot" id="s_remote_dot"></span><span id="s_remote_label">…</span></div>
      <div id="s_tunnel_detail" class="muted" style="font-size:11px;margin-top:4px"></div>

      <div class="remote-card">
        <div class="remote-card-h" style="justify-content:space-between"><span>Tailscale <span class="badge">iPhone · private mesh</span></span><span id="s_ts_switch"></span></div>
        <div id="s_ts_body" style="display:none">
          <div class="muted" id="s_ts_status" style="font-size:11px;margin:4px 0 8px"></div>
          <label class="flbl" style="margin-top:0">Reachable URL (this Mac)</label>
          <div class="row"><input id="s_ts_url" readonly style="flex:1;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
            <button class="copybtn" onclick="copyField('s_ts_url')">Copy</button></div>
          <label class="flbl" style="margin-top:10px">Scan to pair (iPhone)</label>
          <div id="s_qr" style="background:#fff;border-radius:8px;padding:8px;width:188px;height:188px"></div>
          <div class="muted" style="font-size:11px;margin-top:4px">Open HiveMatrix on iPhone → Scan QR. Encodes the tailnet URL + token (generated locally). Nothing is exposed to the internet.</div>
        </div>
      </div>

      <div class="remote-card">
        <div class="remote-card-h" style="justify-content:space-between"><span>Cloudflare <span class="badge">Apple Watch · permanent tunnel</span></span><span id="s_cf_switch"></span></div>
        <div id="s_cf_body" style="display:none">
          <div class="muted" style="font-size:11px;margin:4px 0 8px">The Apple Watch can't join a mesh, so it reaches the daemon over a permanent named tunnel. Scan the QR below on iPhone (it encodes the hostname + token, and the Access credentials when configured) — or enter the values by hand — then tap Sync Apple Watch. The Watch itself can't scan; it inherits the config from iPhone.</div>
          <label class="flbl" style="margin-top:0">Public hostname</label>
          <div class="row"><input id="s_named_host" placeholder="hivey.cassio.io" style="flex:1" />
            <button class="copybtn" onclick="configureNamedTunnel()">Save hostname</button></div>

          <label class="flbl" style="margin-top:8px">Cloudflare Access Client ID</label>
          <input id="s_cf_access_id" placeholder="service-token client id" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
          <label class="flbl" style="margin-top:6px">Cloudflare Access Client Secret</label>
          <div class="row"><input id="s_cf_access_secret" type="password" placeholder="service-token client secret" style="flex:1;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
            <button class="copybtn" onclick="saveCloudflareAccessCredentials()">Save Access</button></div>
          <div class="muted" id="s_cf_access_detail" style="font-size:11px;margin-top:4px"></div>

          <label class="flbl" style="margin-top:8px">Connector token</label>
          <input id="s_named_token" type="password" placeholder="optional — only if HiveMatrix should run cloudflared" style="width:100%" />
          <div class="muted" style="font-size:11px;margin-top:4px">Leave blank when a Cloudflare connector already runs outside HiveMatrix. Saved when you turn the toggle on.</div>

          <label class="flbl" style="margin-top:10px">Public URL</label>
          <div class="row"><input id="s_tunnel_url" readonly style="flex:1;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
            <button class="copybtn" onclick="copyField('s_tunnel_url')">Copy</button></div>

          <label class="flbl" style="margin-top:10px">Scan on iPhone</label>
          <div id="s_cf_qr" style="background:#fff;border-radius:8px;padding:10px;width:240px;height:240px;max-width:100%"></div>
          <div class="muted" style="font-size:11px;margin-top:4px">⚠ Encodes the hostname + access token (and the Cloudflare Access secret, if configured) — treat this QR like a password, same as the token field above.</div>
        </div>
      </div>

      <label class="flbl" style="margin-top:14px">Access token (manual pairing)</label>
      <div class="row"><input id="s_token" readonly style="flex:1;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
        <button class="copybtn" onclick="copyField('s_token')">Copy</button></div>

      <div class="muted" style="font-size:11px;margin-top:10px">⚠ A Cloudflare tunnel exposes the daemon to the internet; the access token is the only barrier — treat it like a password. The console never hands the token to tunneled visitors. Tailscale exposes nothing publicly.</div>
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

      <label class="flbl" style="margin-top:16px">Privacy &amp; Diagnostics</label>
      <div class="row" style="align-items:center;gap:8px">
        <input type="checkbox" id="s_telemetry" onchange="saveTelemetry()" style="width:auto" />
        <span class="muted">Send anonymous usage stats</span>
      </div>
      <div class="muted" style="font-size:11px;margin-top:2px">Off by default. Sends only aggregate feature counters (never event payloads or file contents) to a first-party endpoint once a day. Helps prioritize improvements.</div>
      <div class="row" style="gap:6px;margin-top:8px">
        <button class="sm" onclick="clearTelemetryData()" title="Delete all locally stored telemetry events">Clear local data</button>
        <button class="sm" onclick="sendDiagnostics()" title="Build a diagnostics bundle and copy it to the clipboard">Copy diagnostics</button>
      </div>
      <div id="s_telemetry_status" class="muted" style="font-size:11px;margin-top:3px;min-height:14px"></div>

      <label class="flbl" style="margin-top:16px">Updates</label>
      <div class="row" style="align-items:center;gap:8px">
        <input type="checkbox" id="s_autoupdate" onchange="saveAutoUpdate()" style="width:auto" />
        <span class="muted">Automatically install updates on launch</span>
      </div>
      <div class="muted" style="font-size:11px;margin-top:2px">Off = you'll see an "Update" button in the header to install when you choose.</div>

      <label class="flbl" style="margin-top:16px">Autonomy</label>
      <div class="row" style="align-items:center; gap:10px">
        <span class="muted">How much you approve</span>
        <select id="s_autonomy" onchange="saveAutonomy()" style="width:auto">
          <option value="manual">Manual — approve everything</option>
          <option value="standard">Standard — review results</option>
          <option value="autonomous">Autonomous — run on its own</option>
        </select>
      </div>
      <div id="s_autonomy_desc" class="muted" style="font-size:11px;margin-top:3px;min-height:16px"></div>
      <div class="muted" style="font-size:11px;margin-top:2px">Release, deploy, destructive, and high-risk steps always stop for your approval — at every level.</div>

      <label class="flbl" style="margin-top:16px">Heartbeat</label>
      <div class="row" style="align-items:center;gap:8px">
        <input type="checkbox" id="s_hb_enabled" onchange="saveHeartbeat()" style="width:auto" />
        <span class="muted">Unprompted pulse: the agent checks its HEARTBEAT.md checklist and only speaks up when something matters</span>
      </div>
      <div class="row" style="align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap">
        <span class="muted" style="font-size:11px">Every</span>
        <input type="number" id="s_hb_interval" min="5" max="720" style="width:60px" onchange="saveHeartbeat()" />
        <span class="muted" style="font-size:11px">min · quiet</span>
        <input type="number" id="s_hb_quiet_start" min="0" max="23" placeholder="—" style="width:48px" onchange="saveHeartbeat()" />
        <span class="muted" style="font-size:11px">–</span>
        <input type="number" id="s_hb_quiet_end" min="0" max="23" placeholder="—" style="width:48px" onchange="saveHeartbeat()" />
        <span class="muted" style="font-size:11px">h · morning brief</span>
        <input type="number" id="s_hb_morning" min="0" max="23" placeholder="off" style="width:48px" onchange="saveHeartbeat()" />
        <span class="muted" style="font-size:11px">h · evening recap</span>
        <input type="number" id="s_hb_evening" min="0" max="23" placeholder="off" style="width:48px" onchange="saveHeartbeat()" />
        <span class="muted" style="font-size:11px">h</span>
      </div>
      <div class="muted" style="font-size:11px;margin-top:3px">Reports respect the Autonomy dial above (Autonomous acts on its own; Manual observes and proposes), arrive on your notify channels, and appear in the session as messages you can reply to. Daily moments always deliver; leave an hour blank to turn one off.</div>
      <div class="row" style="margin-top:6px;gap:6px">
        <button class="sm" onclick="runHeartbeatNow()">💓 Pulse now</button>
        <button class="sm" onclick="runHeartbeatNow('morning-brief')">☀️ Send morning brief</button>
        <button class="sm" onclick="runHeartbeatNow('evening-recap')">🌙 Send evening recap</button>
      </div>
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
      <div id="home_readiness_banner" style="display:none;margin-bottom:14px"></div>
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
    <div id="settingsSetup" style="display:none">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="flbl" style="margin:0">Setup</label>
        <button class="create" onclick="openObWizard()">Open setup wizard</button>
      </div>
      <div id="settings_setup_summary" class="muted" style="font-size:12px;margin-bottom:10px">Loading…</div>
      <label class="flbl">Required</label>
      <div id="settings_setup_required"></div>
      <label class="flbl" style="margin-top:14px">Optional</label>
      <div id="settings_setup_optional"></div>
    </div>
    <div id="settingsProjects" style="display:none">
      <div class="kv"><span class="k">discovered</span><span id="s_proj_count">…</span></div>
      <label class="flbl" style="margin-top:10px">Default project</label>
      <select id="s_default_project" onchange="saveDefaultProject()" style="width:100%">
        <option value="">(none — auto-select)</option>
      </select>
      <div class="muted" style="font-size:11px;margin-top:2px">Pre-filled in New Task when no recent project is active. Inbox is the built-in catch-all for non-project work.</div>
      <div id="s_projects" style="margin-top:10px"></div>
      <div class="row" style="margin-top:10px"><button class="create" onclick="refreshProjects()">↻ Re-scan</button></div>
      <div class="muted" style="font-size:11px;margin-top:8px">Projects discovered from git repos, Claude Code history, and VS Code recents. ★ = pre-selected (active project).</div>
    </div>
    <div id="settingsLicense" style="display:none">
      <div id="lic_status_banner"></div>
      <div id="lic_detail" class="kv" style="margin-top:8px"></div>
      <label class="flbl" style="margin-top:16px">License key</label>
      <div class="muted" style="font-size:11px;margin-bottom:8px">Paste the license JSON sent to your email, or click the activation link in your purchase confirmation — it opens HiveMatrix automatically.</div>
      <textarea id="lic_key_input" placeholder="Paste license JSON here…" style="width:100%;min-height:80px;font-family:ui-monospace,Menlo,monospace;font-size:11px;resize:vertical;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:8px;box-sizing:border-box"></textarea>
      <div class="row" style="margin-top:8px;gap:8px;align-items:center">
        <button class="create" onclick="activateLicense()">Activate</button>
        <button class="sm" onclick="renderLicense()">↻ Refresh</button>
        <span id="lic_activate_status" class="muted" style="font-size:11px"></span>
      </div>
      <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border)">
        <div class="muted" style="font-size:12px">On the <b>Free</b> tier? <a href="https://hivematrix.app/pricing" target="_blank" style="color:var(--accent)">Upgrade to Pro — $39/mo or $349/yr</a> — voice, all channels, directives, companion pairing. No per-task fees; bring your own model subscriptions.</div>
      </div>
    </div>
    <div id="settingsLanes" style="display:none">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">System Readiness</label>
        <button class="copybtn" onclick="renderSystemReadiness()">↻ Refresh</button>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 8px">Read-only result-quality checks across routing, Browser Lane auth, lane apps, workflows, model readiness, and stale legacy task state.</div>
      <div id="system_readiness" style="margin-top:6px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Lane Apps</label>
        <button class="copybtn" onclick="renderLaneSetup()">↻ Refresh</button>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 8px">HiveMatrix updates itself automatically; lane apps are installed explicitly. Browser Lane is a standalone signed app — the card below shows whether it's bundled, installed, current, signed, launchable, and whether the daemon and its readiness are healthy, plus the one action to take next. A passing signature is not enough: launch is verified separately.</div>
      <div id="lane_apps" style="margin-top:6px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">Detail for the cards above</div>
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">↳ Browser Lane Sites &amp; Auth</label>
        <button class="copybtn" onclick="renderBrowserReadiness()">↻ Refresh</button>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 6px">Per-site auth/readiness for the Browser Lane app, with stale tracking. Each site shows its auth strategy (Manual session / Keychain login / Google SSO / Microsoft SSO) and an honest session state. After you sign in, you can close Browser Lane — the session persists in its WebKit data store, and the readiness check confirms it. CAPTCHA / 2FA still need you; HiveMatrix never bypasses human verification.</div>
      <div class="row" style="margin-top:4px"><button class="create" onclick="runBrowserReadiness()">Run readiness check</button></div>
      <div id="browser_readiness" style="margin-top:8px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Runtime Capabilities</label>
        <button class="copybtn" onclick="renderSettingsLanes()">↻ Refresh</button>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 8px">Lane capabilities the daemon runs in-process — not installable apps. These follow the connectivity mode; launchagent-backed ones can be turned on or off.</div>
      <div id="s_lanes" style="margin-top:8px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Credential Vault</label>
        <button class="copybtn" onclick="renderVaultRefs()">↻ Refresh</button>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 8px">Vault aliases are never rendered with their values. Manage <code>vault://</code> refs only.</div>
      <div id="vault_status" class="muted" style="font-size:11px;min-height:16px"></div>
      <div class="row" style="margin-top:6px;gap:6px">
        <input id="s_vault_scope" placeholder="scope (site, env, host)" style="width:28%" />
        <input id="s_vault_name" placeholder="name (e.g. github.com)" style="width:32%" />
        <input id="s_vault_label" placeholder="label (optional)" style="width:40%" />
      </div>
      <div class="row" style="margin-top:6px;gap:6px;align-items:center">
        <input id="s_vault_value" type="password" placeholder="value (never shown in UI)" style="flex:1" />
        <button class="create" onclick="setVaultRef()">Set / Update</button>
      </div>
      <div class="row" style="margin-top:8px;gap:6px">
        <input id="s_vault_scope_filter" placeholder="Filter by scope" style="width:100%" oninput="renderVaultRefs()" />
      </div>
      <div id="s_vault_refs" style="margin-top:8px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">COO Dispatch</label>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 8px">Route a request through your COO rules. Browser Lane is the canonical browser automation path; risky lanes (mail, message, desktop) return approval-required and never act here.</div>
      <textarea id="coo_text" rows="2" placeholder="Objective — e.g. Upload today's script on the site" style="width:100%;box-sizing:border-box"></textarea>
      <input id="coo_domains" placeholder="Target domain(s), comma-separated — e.g. github.com" style="width:100%;box-sizing:border-box;margin-top:6px" />
      <label class="flbl" style="margin:6px 0 2px;display:block">Project <span class="muted" style="font-size:10px;font-weight:400">(required to create a task)</span></label>
      <div id="coo_project_wrapper" class="project-search" style="margin-bottom:0">
        <input id="coo_project_search" type="text" placeholder="Search projects…" autocomplete="off" oninput="mpFilter('coo')" onfocus="mpOpen('coo')" onkeydown="mpKeydown(event,'coo')" />
        <div id="coo_project_dropdown" class="project-dropdown hidden">
          <div class="project-sort-row">
            <span class="project-sort-btn active" data-sort="recent" onclick="mpSort('coo','recent')">Most recent</span>
            <span class="project-sort-btn" data-sort="name" onclick="mpSort('coo','name')">Name A–Z</span>
          </div>
          <div id="coo_project_list" class="project-list"></div>
          <div id="coo_project_empty" class="project-empty hidden">No projects found</div>
        </div>
      </div>
      <div id="coo_project_selected" class="project-selected" style="display:none;margin-bottom:6px"></div>
      <button type="button" class="linklike custom-folder-toggle" onclick="mpToggleCustomFolder('coo')">Use another folder…</button>
      <div id="coo_custom_folder" class="custom-folder" style="display:none">
        <input id="coo_custom_path" placeholder="~/path/to/folder" onkeydown="if(event.key==='Enter'){event.preventDefault();mpUseCustomFolder('coo');}" />
        <div class="row"><button class="create" onclick="mpUseCustomFolder('coo')">Use this folder</button><button class="cancel" onclick="mpToggleCustomFolder('coo')">Cancel</button></div>
        <div class="err" id="coo_custom_err"></div>
      </div>
      <input id="coo_project_path" type="hidden" value="" />
      <div class="row" style="margin-top:6px;gap:6px">
        <button class="copybtn" onclick="cooDispatchPrepare()">Prepare</button>
        <button class="create" id="coo_create_btn" style="display:none" onclick="cooDispatchCreate()">Create Browser Lane task</button>
      </div>
      <div id="coo_result" style="margin-top:8px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <label class="flbl" style="margin:0">COO routing rules</label>
        <div class="row" style="gap:6px;align-items:center">
          <select id="coo_rules_lane_filter" onchange="renderCooRoutingRules()">
            <option value="">All lanes</option>
            <option value="browser">Browser</option>
            <option value="mail">Mail</option>
            <option value="message">Message</option>
            <option value="desktop">Desktop</option>
            <option value="memory">Memory</option>
            <option value="review">Review</option>
          </select>
          <button class="copybtn" onclick="renderCooRoutingRules()">↻ Refresh</button>
          <button class="copybtn" onclick="cooSeedDefaultRules()">Seed defaults</button>
          <button class="create" onclick="cooNewRule()">New rule</button>
        </div>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 6px">View and update the typed routing entries used by COO Dispatch.</div>
      <div class="row" style="gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <input id="coo_resolve_text" placeholder="Resolve tester objective" style="flex:1;min-width:180px;box-sizing:border-box" />
        <input id="coo_resolve_domains" placeholder="Domains, comma-separated" style="flex:1;min-width:160px;box-sizing:border-box" />
        <button class="copybtn" onclick="cooResolveRuleTest()">Resolve</button>
      </div>
      <div id="coo_resolve_result" class="muted" style="font-size:11px;margin-top:4px"></div>
      <div id="coo_rules_result" class="muted" style="font-size:11px;margin-top:6px"></div>
      <div id="coo_rules_list" style="margin-top:8px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Workflows</label>
        <button class="copybtn" onclick="renderWorkflows()">↻ Refresh</button>
      </div>
      <div class="muted" style="font-size:11px;margin:4px 0 6px">Registered repeatable workflows COO and the model can route to. Each links its runbook.</div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:8px">
        <div class="muted" style="font-size:11px"><b>Workflow inbox</b> — what needs review, what's ready, what's blocked.</div>
        <button class="copybtn" onclick="renderWorkflowInbox()">↻</button>
      </div>
      <div id="workflow_inbox" style="margin-top:4px"></div>
      <div id="workflows_list" style="margin-top:10px"></div>
      <div class="row" style="margin-top:8px;gap:6px;align-items:center">
        <input id="brief_topic" placeholder="Research brief topic — e.g. AI tools for solo founders" style="flex:1;box-sizing:border-box" />
        <button class="create" onclick="prepareResearchBrief()">Prepare research brief</button>
      </div>
      <div id="brief_result" class="muted" style="font-size:11px;margin-top:4px"></div>
      <div class="muted" style="font-size:11px;margin:8px 0 4px">Proposed next actions</div>
      <div id="workflow_actions" style="margin-top:4px"></div>
      <div class="muted" style="font-size:11px;margin:8px 0 4px">Recent runs</div>
      <div id="workflow_runs" style="margin-top:4px"></div>
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

<!-- Observability — opened by clicking the 5h/7d usage-bar visual in the header. -->
<div class="overlay" id="obsOverlay" onclick="if(event.target===this)closeObsModal()">
  <div class="modal" style="width:820px;max-width:92vw;max-height:88vh;overflow:auto">
    <h1>📊 Observability<span class="x" onclick="closeObsModal()">✕</span></h1>
    <div class="oc-panel-sub">Tokens, tasks, latency &amp; prompt-cache across Claude &amp; Codex</div>
    <div class="obs-panel-toggles" id="obsModalToggles"></div>
    <div id="obsDashPanel"><div class="muted">Loading…</div></div>
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
      <div class="muted" style="font-size:12px">Bulk-import the folder skills from your local harness profiles (Claude / Codex) into the brain library so they can be shared and run as skills.</div>
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
        <button onclick="revealMessageBeeDaemon()">Reveal daemon in Finder</button>
        <button onclick="restartMessageBeeDaemon()">Restart daemon</button>
        <div class="muted" style="font-size:11px;margin-top:3px">The daemon that reads Messages runs as its own process — HiveMatrix's own Full Disk Access entry above doesn't cover it. Reveal it, add it to Full Disk Access, then restart the daemon to pick up the change.</div>
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
        <div id="mb_blocked" style="margin-top:6px"></div>
      </div>
    </div>
    <div class="mb-step">
      <span class="mb-mark no" id="mb_self_mark">○</span>
      <div class="mb-body">
        <div class="t">Agent identities</div>
        <div class="muted">Message Lane ignores messages from these iMessage addresses to prevent self-reply loops. Use the agent's sending email or phone, not your sender identity.</div>
        <input class="dialog-input" id="mb_self_input" placeholder="agent@icloud.com or +15551234567" style="margin-top:6px;margin-bottom:4px" />
        <div id="mb_self_handles"></div>
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
        <button id="ml_auto_retry_btn" onclick="mlRetryAutomationProbe()">Grant Mail Automation</button>
        <button onclick="mlOpenAutomationSettings()">Open Automation settings</button>
        <div class="muted" style="font-size:11px;margin-top:3px" id="ml_auto_hint">Click "Grant Mail Automation" — HiveMatrix will launch Mail and macOS will ask you to approve control. If the prompt was dismissed, use "Open Automation settings" to turn it on by hand.</div>
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

<!-- Zero-terminal onboarding wizard: permissions → models → brain -->
<div class="overlay" id="obWizardOverlay">
  <div class="modal ob-wizard">
    <h1>Set up HiveMatrix <span class="x" onclick="closeObWizard(true)">✕</span></h1>
    <!-- 3-segment progress bar -->
    <div class="ob-prog">
      <div class="ob-prog-seg active" id="obProg0"></div>
      <div class="ob-prog-seg" id="obProg1"></div>
      <div class="ob-prog-seg" id="obProg2"></div>
    </div>

    <!-- ── Step 0: System Permissions ── -->
    <div class="ob-step-panel active" id="obStep0">
      <div class="ob-step-label">Step 1 of 3</div>
      <div class="ob-heading">System Permissions</div>
      <div class="ob-subheading">HiveMatrix needs a few macOS permissions to read messages, control the desktop, and hear your voice. Click each button to open the exact Settings pane — add HiveMatrix, then return here. All are optional; grant only what you need.</div>

      <div class="ob-perm-row">
        <span class="ob-pm no" id="ob_perm_fda">○</span>
        <div class="ob-perm-info">
          <div class="ob-perm-title">Full Disk Access</div>
          <div class="ob-perm-desc" id="ob_perm_fda_detail">Lets HiveMatrix read your Messages database (chat.db) and Mail folder. Required for Message Lane and Mail Lane.</div>
          <div class="ob-perm-actions">
            <span class="ob-perm-granted" id="ob_perm_fda_granted" style="display:none">✓ Granted</span>
            <button id="ob_perm_fda_open" onclick="obProbeFullDiskAccess()">Check Full Disk Access →</button>
          </div>
        </div>
      </div>

      <div class="ob-perm-row">
        <span class="ob-pm no" id="ob_perm_acc">○</span>
        <div class="ob-perm-info">
          <div class="ob-perm-title">Accessibility + Screen Recording</div>
          <div class="ob-perm-desc" id="ob_perm_acc_detail">Required for Desktop Lane — lets HiveMatrix see the screen and click UI elements.</div>
          <div class="ob-perm-actions">
            <span class="ob-perm-granted" id="ob_perm_acc_granted" style="display:none">✓ Granted</span>
            <button id="ob_perm_acc_open" onclick="obRequestDesktopPerms()">Open Desktop Permissions →</button>
          </div>
        </div>
      </div>

      <div class="ob-perm-row">
        <span class="ob-pm no" id="ob_perm_auto">○</span>
        <div class="ob-perm-info">
          <div class="ob-perm-title">Automation (Apple Mail)</div>
          <div class="ob-perm-desc" id="ob_perm_auto_detail">Lets HiveMatrix draft and send email via Apple Mail. Required for Mail Lane. Open Mail.app first so it appears in the list.</div>
          <div class="ob-perm-actions">
            <span class="ob-perm-granted" id="ob_perm_auto_granted" style="display:none">✓ Granted</span>
            <button id="ob_perm_auto_open" onclick="obProbeMailAutomation()">Check Mail Automation →</button>
          </div>
        </div>
      </div>

      <div class="ob-perm-row">
        <span class="ob-pm no" id="ob_perm_mic">○</span>
        <div class="ob-perm-info">
          <div class="ob-perm-title">Microphone</div>
          <div class="ob-perm-desc" id="ob_perm_mic_detail">Required for voice input (Talk mode). Grant this, then HiveMatrix will ask again the first time you start a voice session.</div>
          <div class="ob-perm-actions">
            <span class="ob-perm-granted" id="ob_perm_mic_granted" style="display:none">✓ Opened settings</span>
            <button id="ob_perm_mic_open" onclick="obOpenPermMic()">Open Microphone settings →</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Step 1: Model Backends ── -->
    <div class="ob-step-panel" id="obStep1">
      <div class="ob-step-label">Step 2 of 3</div>
      <div class="ob-heading">Model Backends</div>
      <div class="ob-subheading">HiveMatrix routes tasks to frontier models (Claude, ChatGPT). Set up at least one. You bring your own subscription — HiveMatrix never meters tokens.</div>
      <div class="ob-any-status" id="ob_models_status">Detecting…</div>

      <div class="ob-model-card" id="ob_model_claude">
        <div class="ob-model-icon">✦</div>
        <div class="ob-model-body">
          <div class="ob-model-name">Claude Code CLI <span class="ob-model-mark no" id="ob_claude_mark">—</span></div>
          <div class="ob-model-status" id="ob_claude_status">Checking…</div>
          <div class="ob-model-expand" onclick="obToggleDetail('ob_claude_detail')">▸ Install guide</div>
          <div class="ob-model-detail" id="ob_claude_detail">
            <div class="muted" style="font-size:11px">Install Claude Code from <strong>claude.ai/download</strong>, sign in with your Anthropic or Claude.ai account. No API key needed — uses your subscription. Once installed, HiveMatrix detects it automatically on next refresh.</div>
          </div>
        </div>
      </div>

      <div class="ob-model-card" id="ob_model_codex">
        <div class="ob-model-icon">⬡</div>
        <div class="ob-model-body">
          <div class="ob-model-name">Codex CLI (ChatGPT) <span class="ob-model-mark no" id="ob_codex_mark">—</span></div>
          <div class="ob-model-status" id="ob_codex_status">Checking…</div>
          <div class="ob-model-expand" onclick="obToggleDetail('ob_codex_detail')">▸ Install guide</div>
          <div class="ob-model-detail" id="ob_codex_detail">
            <div class="muted" style="font-size:11px">Install via: <code>npm install -g @openai/codex</code>. Log in with your ChatGPT Plus/Pro account (no API key needed). Once installed, HiveMatrix detects it automatically.</div>
          </div>
        </div>
      </div>

    </div>

    <!-- ── Step 2: Brain Location ── -->
    <div class="ob-step-panel" id="obStep2">
      <div class="ob-step-label">Step 3 of 3</div>
      <div class="ob-heading">Brain Location</div>
      <div class="ob-subheading">HiveMatrix stores your memory, notes, and skills in a folder called your Brain. Choose where to put it — a new folder will be created if it doesn't already exist. If you already use Obsidian or have an existing brain folder, you can point HiveMatrix at it instead.</div>
      <div class="ob-brain-row">
        <input class="dialog-input" id="ob_brain_path" placeholder="~/HiveMatrix Brain" oninput="obBrainInputChange()" />
        <button onclick="obSetBrain()">Use this path</button>
      </div>
      <div class="ob-brain-preview" id="ob_brain_preview"></div>
      <div class="muted" id="ob_brain_status" style="font-size:11px;margin-top:6px"></div>
      <div class="err" id="ob_brain_err" style="font-size:11px;margin-top:4px"></div>
      <div class="ob-model-card" style="margin-top:12px">
        <div class="ob-model-icon">✦</div>
        <div class="ob-model-body">
          <div class="ob-model-name">HiveMatrix personality <span class="ob-model-mark no" id="ob_persona_mark">—</span></div>
          <div class="ob-model-status" id="ob_persona_status">Checking…</div>
          <div class="ob-btn-row" style="margin-top:8px">
            <button id="ob_birth_ritual" onclick="obRunBirthRitual()">Run birth ritual →</button>
          </div>
          <div class="muted" id="ob_birth_log" style="font-size:11px;margin-top:6px;white-space:pre-wrap;max-height:120px;overflow:auto"></div>
        </div>
      </div>
    </div>

    <!-- ── Navigation ── -->
    <div class="ob-nav">
      <button class="cancel" onclick="closeObWizard(true)" style="font-size:11px;margin-right:auto">Skip for now</button>
      <button class="cancel" id="obBackBtn" onclick="obBack()" style="display:none">← Back</button>
      <button class="ok" id="obNextBtn" onclick="obNext()">Next →</button>
    </div>
  </div>
</div>

<main>
  <div class="col-resizer" id="resizeLeft" title="Drag to resize the left panel"></div>
  <div class="col-resizer" id="resizeRight" title="Drag to resize the right panel"></div>
  <section class="col board">
    <button class="ov-nav" id="overviewNav" onclick="showOverview()">⌂ Overview</button>
    <button class="addbtn" id="newTaskNav" onclick="showNewTaskPanel()">＋ New task</button>
    <button class="ov-nav oc-nav" id="flashNav" onclick="showFlashPanel()">💬 Chat</button>
    <button class="ov-nav oc-nav" id="brainNav" onclick="showBrain()">🧠 Brain</button>
    <button class="ov-nav oc-nav" id="rolesNav" onclick="showRoles()">👥 Roles</button>
    <button class="ov-nav oc-nav" id="toolsNav" onclick="showTools()">🛠️ Tools</button>
    <button class="ov-nav oc-nav" id="goalsNav" onclick="showGoals()">🎯 Goals</button>
    <div class="form" id="taskForm">
      <input id="t_title" type="hidden" value="" />
      <textarea id="t_desc" placeholder="What should the agent do? (be specific)"></textarea>
      <div id="t_enhanced_preview" class="t-enhanced-box" style="display:none">
        <div class="t-enhanced-label">✨ Enhanced prompt</div>
        <input type="text" id="t_enhanced_title" placeholder="Task name" maxlength="60" />
        <label class="flbl" style="margin-top:6px">Suggested role — review and correct if needed</label>
        <select id="t_enhanced_role"><option value="auto">Auto</option></select>
        <textarea id="t_enhanced_text"></textarea>
        <div class="t-enhanced-rationale" id="t_enhanced_rationale"></div>
        <div class="row">
          <button type="button" class="create" onclick="acceptEnhancedPrompt()">Use this</button>
          <button type="button" class="cancel" onclick="dismissEnhancedPrompt()">Keep raw</button>
        </div>
      </div>
      <div style="margin:-4px 0 8px">
        <button type="button" class="linklike" onclick="toggleTaskSkillPicker()" title="Pick an installed skill or command to use — no need to remember names">＋ Use a skill</button>
      </div>
      <div id="t_skill_picker" style="display:none;margin-bottom:4px">
        <input id="t_skill_q" placeholder="Search your skills & commands…" oninput="searchTaskSkills()" style="margin-bottom:4px" />
        <div id="t_skill_results" style="max-height:170px;overflow:auto"></div>
      </div>
      <label class="flbl">Project <span class="muted" style="font-size:10px;font-weight:400">(optional — defaults to Inbox / your home directory)</span></label>
      <div id="t_project_wrapper" class="project-search">
        <input id="t_project_search" type="text" placeholder="Search projects… (leave blank for an operations task)" autocomplete="off" oninput="filterProjectDropdown()" onfocus="openProjectDropdown()" onkeydown="onProjectSearchKeydown(event)" />
        <div id="t_project_dropdown" class="project-dropdown hidden">
          <div class="project-sort-row">
            <span class="project-sort-btn active" data-sort="recent" onclick="sortProjectsDropdown('recent')">Most recent</span>
            <span class="project-sort-btn" data-sort="name" onclick="sortProjectsDropdown('name')">Name A–Z</span>
          </div>
          <div id="t_project_list" class="project-list"></div>
          <div id="t_project_empty" class="project-empty hidden">No projects found <button class="copybtn" id="t_project_rescan" onclick="refreshProjects()">↻ Re-scan</button></div>
        </div>
      </div>
      <div id="t_project_selected" class="project-selected" style="display:none"></div>
      <button type="button" class="linklike custom-folder-toggle" onclick="toggleCustomFolder()">Use another folder…</button>
      <div id="t_custom_folder" class="custom-folder" style="display:none">
        <input id="t_custom_path" placeholder="~/path/to/folder" onkeydown="if(event.key==='Enter'){event.preventDefault();useCustomFolder();}" />
        <div class="row"><button class="create" onclick="useCustomFolder()">Use this folder</button><button class="cancel" onclick="toggleCustomFolder()">Cancel</button></div>
        <div class="err" id="t_custom_err"></div>
      </div>
      <input id="t_path" type="hidden" value="" />
      <details id="t_advanced">
        <summary style="display:block;cursor:pointer;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;margin:10px 0 3px">Advanced</summary>
        <label class="flbl">Role</label>
        <select id="t_role"><option value="auto" selected>Auto</option></select>
        <div class="muted" style="font-size:11px;margin-top:2px" id="t_role_hint">Auto picks a specialist when "Specialist agents" is enabled in Settings → Features; otherwise every task runs as developer.</div>
        <label class="flbl">Model</label>
        <select id="t_model"></select>
        <label class="flbl">Mode</label>
        <select id="t_route">
          <option value="auto" selected>Auto — route lanes, else one task</option>
          <option value="normal">Direct — one plain task</option>
        </select>
        <div class="muted" style="font-size:11px;margin-top:2px">Auto routes browsing work to the right lane and otherwise dispatches a single task — the coding harness plans its own steps. Pick Direct to force one plain task.</div>
      </details>
      <label class="flbl">Attachments</label>
      <div class="attach-row attach-drop" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="onAttachDrop(event)">
        <input type="file" id="t_attach_input" multiple style="display:none" onchange="onAttachFiles(this)">
        <button type="button" class="cancel" onclick="document.getElementById('t_attach_input').click()">⊕ Browse</button>
        <span class="muted" id="t_attach_hint" style="font-size:11px">Drag files here or browse</span>
      </div>
      <div class="attach-chips" id="t_attach_chips"></div>
      <div class="row" style="margin-top:12px"><button class="cancel" onclick="cancelForm('taskForm')">Cancel</button><button type="button" class="enhance" id="t_enhance_btn" onclick="enhanceTaskPrompt()">✨ Enhance</button><button class="create" onclick="createTask()">Create task</button></div>
      <div class="err" id="t_err"></div>
    </div>
    <div id="boardSec" class="board-sec">
      <div class="board-sec-header">Board <span id="archiveBtn" class="archive-link" onclick="archiveCompleted()" title="Archive review/done/failed tasks"></span></div>
      <div id="board"></div>
    </div>
  </section>
  <section class="col session">
    <div id="session"><div class="session-empty">Select a task to inspect its session.</div></div>
  </section>
  <section class="col context">
    <div id="approvals"></div>
    <details class="ctx-sec" id="setupSec" open><summary id="setupSummary">Setup</summary>
    <div id="onboarding"></div></details>
    <details class="ctx-sec" id="connSec" open><summary>Connectivity</summary>
    <div id="conn"></div></details>
    <details class="ctx-sec" id="dirSec" open><summary>Scheduled</summary>
    <button class="addbtn" onclick="toggleForm('dirForm')">＋ New scheduled item</button>
    <div class="form" id="dirForm">
      <input id="d_goal" placeholder="What to run on a schedule — e.g. review my inbox each morning" />
      <label class="flbl">Project</label>
      <div id="d_project_wrapper" class="project-search">
        <input id="d_project_search" type="text" placeholder="Search projects…" autocomplete="off" oninput="mpFilter('d')" onfocus="mpOpen('d')" onkeydown="mpKeydown(event,'d')" />
        <div id="d_project_dropdown" class="project-dropdown hidden">
          <div class="project-sort-row">
            <span class="project-sort-btn active" data-sort="recent" onclick="mpSort('d','recent')">Most recent</span>
            <span class="project-sort-btn" data-sort="name" onclick="mpSort('d','name')">Name A–Z</span>
          </div>
          <div id="d_project_list" class="project-list"></div>
          <div id="d_project_empty" class="project-empty hidden">No projects found</div>
        </div>
      </div>
      <div id="d_project_selected" class="project-selected" style="display:none"></div>
      <button type="button" class="linklike custom-folder-toggle" onclick="mpToggleCustomFolder('d')">Use another folder…</button>
      <div id="d_custom_folder" class="custom-folder" style="display:none">
        <input id="d_custom_path" placeholder="~/path/to/folder" onkeydown="if(event.key==='Enter'){event.preventDefault();mpUseCustomFolder('d');}" />
        <div class="row"><button class="create" onclick="mpUseCustomFolder('d')">Use this folder</button><button class="cancel" onclick="mpToggleCustomFolder('d')">Cancel</button></div>
        <div class="err" id="d_custom_err"></div>
      </div>
      <input id="d_path" type="hidden" value="" />
      <input id="d_crit" placeholder="Success criterion (optional)" />
      <input id="d_interval" placeholder="Repeat interval (e.g. PT4H, P1D) — blank = manual" />
      <div class="row"><button class="create" onclick="createDirective()">Schedule</button><button class="cancel" onclick="cancelForm('dirForm')">Cancel</button></div>
      <div class="err" id="d_err"></div>
    </div>
    <div class="form" id="dirEditForm">
      <input id="de_id" type="hidden" />
      <input id="de_goal" placeholder="What to run on a schedule — e.g. review my inbox each morning" />
      <label class="flbl">Project</label>
      <div id="de_project_wrapper" class="project-search">
        <input id="de_project_search" type="text" placeholder="Search projects…" autocomplete="off" oninput="mpFilter('de')" onfocus="mpOpen('de')" onkeydown="mpKeydown(event,'de')" />
        <div id="de_project_dropdown" class="project-dropdown hidden">
          <div class="project-sort-row">
            <span class="project-sort-btn active" data-sort="recent" onclick="mpSort('de','recent')">Most recent</span>
            <span class="project-sort-btn" data-sort="name" onclick="mpSort('de','name')">Name A–Z</span>
          </div>
          <div id="de_project_list" class="project-list"></div>
          <div id="de_project_empty" class="project-empty hidden">No projects found</div>
        </div>
      </div>
      <div id="de_project_selected" class="project-selected" style="display:none"></div>
      <button type="button" class="linklike custom-folder-toggle" onclick="mpToggleCustomFolder('de')">Use another folder…</button>
      <div id="de_custom_folder" class="custom-folder" style="display:none">
        <input id="de_custom_path" placeholder="~/path/to/folder" onkeydown="if(event.key==='Enter'){event.preventDefault();mpUseCustomFolder('de');}" />
        <div class="row"><button class="create" onclick="mpUseCustomFolder('de')">Use this folder</button><button class="cancel" onclick="mpToggleCustomFolder('de')">Cancel</button></div>
        <div class="err" id="de_custom_err"></div>
      </div>
      <input id="de_path" type="hidden" value="" />
      <input id="de_interval" placeholder="Repeat interval (e.g. PT4H, P1D) — blank = manual" />
      <select id="de_status"><option value="active">active</option><option value="sleeping">sleeping</option><option value="blocked">blocked</option><option value="retired">retired</option></select>
      <div class="row"><button class="create" onclick="saveDirective()">Save changes</button><button class="cancel" onclick="cancelForm('dirEditForm')">Cancel</button></div>
      <div class="err" id="de_err"></div>
    </div>
    <div id="directives"></div></details>
    <details class="ctx-sec" id="skillsSec" open><summary>Skills &amp; Commands</summary>
    <div class="sk-toolbar">
      <input id="skQuery" placeholder="Search skills &amp; commands…" oninput="skQueryInput()" onkeydown="skQueryKeydown(event)" />
      <button class="addbtn" onclick="openAddSkills()" title="Import a skill from a URL, a file, a shared scope, or your local folders">＋ Add</button>
      <button class="addbtn" onclick="syncSkills()" title="Git-sync all scopes + write skills into the Claude/Codex dirs">⇄ Sync</button>
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
const laneColor = { in_progress: "var(--accent)", review: "var(--ok)", failed: "var(--err)" };
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
let state = { tasks: [], directives: [], conn: null, metrics: null, onboarding: null, selected: null, selectedSkillOrCommand: null, projects: [], selectedProject: "", packCards: [], schedView: 'timeline', tlWindow: 24 };
let _taskFormInSession = false;
// Tracks whether the prompt wizard has already run (accepted or dismissed) for the
// current New Task open, so "Always enhance" only auto-triggers once per open.
let _promptWizardHandled = false;

function setFlashSessionMode(open) {
  const session = document.getElementById("session");
  if (session) {
    session.classList.toggle("oc-session-mode", !!open);
    if (session.parentElement) session.parentElement.classList.toggle("oc-session-mode", !!open);
  }
}

async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, { "Authorization": "Bearer " + HM_TOKEN });
  const r = await fetch(path, opts);
  if (r.status === 204) return null;
  return r.json();
}
function esc(s){ return (s==null?"":String(s)).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
// Encode arbitrary text for safe inlining as a single-quoted JS string argument in
// an onclick attribute (esc() only handles &<>; this also neutralises quotes).
function attrEnc(s){ return encodeURIComponent(s==null?"":String(s)).replace(/'/g,"%27"); }
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
function packMetricLabel(metric) {
  if (typeof metric === "string") return metric;
  if (!metric || typeof metric !== "object") return "";
  const label = metric.label || metric.name || "";
  const value = metric.value == null ? "" : String(metric.value);
  const unit = metric.unit ? " " + metric.unit : "";
  return (label ? label + ": " : "") + value + unit;
}
function renderPackDashboardCards() {
  const cards = state.packCards || [];
  if (!cards.length) return "";
  return '<div class="ov-head" style="margin-top:18px">Packs</div>'
    + '<div class="ov-grid">'
    + cards.map(card => {
      const metrics = (card.metrics || []).map(packMetricLabel).filter(Boolean).slice(0, 3).join(" · ");
      const cta = typeof card.cta === "string" ? card.cta : (card.cta && (card.cta.label || card.cta.text)) || "";
      return '<div class="ov-card">'
        + '<div class="ov-num" style="font-size:14px;line-height:1.2">' + esc(card.title || card.packName || "Pack") + '</div>'
        + '<div class="ov-lbl">' + esc(metrics || card.packName || "") + '</div>'
        + (cta ? '<div class="ov-lbl" style="margin-top:4px;color:var(--accent)">' + esc(cta) + '</div>' : '')
        + '</div>';
    }).join("")
    + '</div>';
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
  if (state.selected || state.selectedSkillOrCommand || _taskFormInSession || _flashState.panelOpen || _brainState.panelOpen || _rolesState.panelOpen || _toolsState.panelOpen || _goalsState.panelOpen) return;
  setFlashSessionMode(false);
  const el = document.getElementById("session");
  if (!el) return;
  const statusToLane = {}; LANE_DEFS.forEach(L => L.statuses.forEach(s => statusToLane[s] = L.key));
  const counts = {}; LANE_DEFS.forEach(L => counts[L.key] = 0);
  const filtered = state.tasks;
  for (const t of filtered) { const k = statusToLane[t.status]; if (k) counts[k]++; }
  const dirActive = (state.directives || []).filter(d => d.status === "active").length;
  const appr = (state.approvals || []).length;
  const card = (label, val, cls, numColor, action) => '<div class="ov-card ' + (cls || "") + '"' + (action ? ' onclick="' + action + '"' : '') + '><div class="ov-num"' + (numColor ? ' style="color:' + numColor + '"' : '') + '>' + val + '</div><div class="ov-lbl">' + esc(label) + '</div></div>';
  el.innerHTML = '<div class="overview">'
    + '<div class="ov-head">Overview</div>'
    + '<div class="ov-grid">' + LANE_DEFS.map(L => card(L.label, counts[L.key], "", laneColor[L.key] || "", "focusBoardLane('" + L.key + "')")).join("") + '</div>'
    + '<div class="ov-grid" style="margin-top:8px">'
    + card("scheduled", dirActive)
    + card("pending approvals", appr, appr ? "warn" : "")
    + '</div>'
    + renderPackDashboardCards()
    + '<div class="ov-hint">Select a task to inspect progress — or ＋ New task to start one.</div>'
    + '</div>';
}

// Explicit return-to-overview navigation. Clears the open task (same fields
// delete/archive already null) and re-renders; the project filter is untouched.
function showOverview() {
  state.selected = null;
  state.selectedSkillOrCommand = null;
  _skSel = '';
  _ctxTask = null;
  if (_taskFormInSession) _closeNewTaskPanel();
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setStoredView('overview');
  setFlashSessionMode(false);
  renderBoard();
  renderSkillList();
  renderOverview();
  syncNav();
}
function focusBoardLane(key) {
  const allOtherKeys = LANE_DEFS.map(L => L.key).filter(k => k !== key);
  try { localStorage.setItem("hm_lanes_collapsed", JSON.stringify(allOtherKeys)); } catch (e) { /* ignore */ }
  renderBoard();
  const board = document.getElementById("board");
  if (board) board.scrollIntoView({ behavior: "smooth", block: "start" });
}
// Single source of truth for left-nav highlight. Every show*/panel entry point
// and the periodic refresh route through this, so exactly one nav item is ever
// lit. Previously eight functions synced overlapping subsets (Roles was omitted
// from the overview sync, and showOverview synced nothing) — which left a stale
// item highlighted alongside the active one ("menus duplicated").
function syncNav() {
  const panelOpen = _flashState.panelOpen || _brainState.panelOpen || _rolesState.panelOpen
    || _toolsState.panelOpen || _goalsState.panelOpen;
  const overviewActive = !state.selected && !state.selectedSkillOrCommand && !_taskFormInSession && !panelOpen;
  const active = {
    overviewNav: overviewActive,
    newTaskNav: _taskFormInSession,
    flashNav: _flashState.panelOpen,
    brainNav: _brainState.panelOpen,
    rolesNav: _rolesState.panelOpen,
    toolsNav: _toolsState.panelOpen,
    goalsNav: _goalsState.panelOpen,
  };
  for (const id in active) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", !!active[id]);
  }
}
// Kept for existing call sites; all nav sync now funnels through syncNav().
function updateOverviewNav() { syncNav(); }
function isEditableTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
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

function timeUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).valueOf() - Date.now();
  if (ms < -300000) return { label: 'overdue', cls: 'overdue', ms };
  if (ms < 60000) return { label: 'now', cls: 'ok', ms };
  const m = Math.floor(ms / 60000);
  if (m < 60) return { label: 'in ' + m + 'm', cls: m < 15 ? 'soon' : 'muted', ms };
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return { label: 'in ' + h + 'h' + (rm ? ' ' + rm + 'm' : ''), cls: 'muted', ms };
  return { label: 'in ' + Math.floor(h / 24) + 'd', cls: 'muted', ms };
}
function setSchedView(v) { state.schedView = v; renderDirectives(); }
function setTlWindow(h) { state.tlWindow = h; renderDirectives(); }

function ageBadge(t) {
  var raw = (t && t.updatedAt) || (t && t.createdAt) || "";
  var label = timeAgo(raw, Date.now());
  return label ? '<span class="badge age" title="'+esc(raw)+'">'+esc(label)+'</span>' : "";
}
// Board review-state → {label, tone}. Mirrors getReviewStateMeta (review-state.ts);
// duplicated here because the console script has no module loader to import it.
// tone "attention" (amber) = operator must act; "review" (green) = waiting on team.
function reviewStateMeta(rs) {
  if (rs === "needs_input") return { label: "Needs Input", tone: "attention" };
  if (rs === "ready_for_review") return { label: "Ready for Review", tone: "review" };
  if (rs === "needs_parent_decision") return { label: "Needs parent decision", tone: "review" };
  return null;
}

// task.verification → badge {label, cls}. verification is null for most
// claude -p tasks (no verification gate ran) — that's the common, correct
// case, so callers must render NOTHING when this returns null, not a
// placeholder. The GET /tasks row comes straight from SQLite (no rowToTask
// parsing on that endpoint — see server.ts), so verification may arrive as
// a raw JSON string instead of an already-parsed object; handle both.
function verificationMeta(v) {
  if (!v) return null;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch (e) { return null; }
  }
  if (!v || typeof v !== "object") return null;
  if (v.verdict === "passed") return { label: "✓ verified", cls: "ok" };
  if (v.verdict === "failed") return { label: "✗ failed", cls: "err" };
  if (v.verdict === "uncertain") return { label: "? unverified", cls: "" };
  return null;
}

// Active view persistence — restores the last-open sidebar view on launch.
var HM_VALID_VIEWS = ["overview", "flash", "brain", "roles", "tools", "goals"];
var _currentView = "overview";

function getStoredView() {
  try {
    var v = localStorage.getItem("hm_last_view");
    return HM_VALID_VIEWS.indexOf(v) !== -1 ? v : "overview";
  } catch (e) { return "overview"; }
}

function setStoredView(view) {
  _currentView = view;
  try { localStorage.setItem("hm_last_view", view); } catch (e) { /* ignore */ }
}

// Scroll position persistence — only for views with one unambiguous
// scrollable content container (see design doc decision #3).
var SCROLL_TARGETS = { flash: '#flashTranscript', tools: '.tools-pane', goals: '.tools-pane' };
var _pendingScrollRestore = null;

function scrollStorageKey(view) { return 'hm_scroll_' + view; }

function saveScrollPosition(view) {
  var sel = SCROLL_TARGETS[view];
  if (!sel) return;
  var el = document.querySelector(sel);
  if (!el) return;
  try { localStorage.setItem(scrollStorageKey(view), String(el.scrollTop)); } catch (e) { /* ignore */ }
}

function restoreScrollPosition(view) {
  var sel = SCROLL_TARGETS[view];
  if (!sel) return;
  var el = document.querySelector(sel);
  if (!el) return;
  var saved = 0;
  try { saved = parseInt(localStorage.getItem(scrollStorageKey(view)) || '0', 10) || 0; } catch (e) { /* ignore */ }
  el.scrollTop = saved;
}

// Collapsed board lanes persist in localStorage and survive the periodic board
// re-render (renderBoard rebuilds innerHTML, so collapse state can't live in the
// DOM). Lets the operator fold a tall lane (e.g. "review") so failed / in-progress
// stay in view; the header + count remain visible while collapsed.
function getCollapsedLanes() {
  try { return new Set(JSON.parse(localStorage.getItem("hm_lanes_collapsed") || "[]")); }
  catch (e) { return new Set(); }
}
function toggleBoardLane(key) {
  const c = getCollapsedLanes();
  if (c.has(key)) c.delete(key); else c.add(key);
  try { localStorage.setItem("hm_lanes_collapsed", JSON.stringify(Array.from(c))); } catch (e) { /* ignore */ }
  renderBoard();
}
/*__REVIEW_SORT_COMPARATOR_START__*/
function reviewSortComparator(a, b) {
  const ta = Date.parse(a.updatedAt || a.createdAt || "") || 0;
  const tb = Date.parse(b.updatedAt || b.createdAt || "") || 0;
  return tb - ta;
}
/*__REVIEW_SORT_COMPARATOR_END__*/

// Single task-card renderer — shared by every lane's plain body and the
// review lane's batch groups, so the verified/failed/unverified badge (and
// every other card affordance) lives in one place instead of two drifting
// copies of the same markup.
function taskCardHtml(t, laneKey) {
  const rsm = reviewStateMeta(t.reviewState);
  const vm = verificationMeta(t.verification);
  return '<div class="card'+(state.selected===t._id?' sel':'')+(rsm?' tone-'+rsm.tone:'')+(laneKey === "in_progress" ? " in-progress" : "")+'" onclick="selectTask(\''+t._id+'\')">'
    + '<button class="card-archive" title="Archive task" onclick="event.stopPropagation();cardArchive(\''+t._id+'\')">Archive</button>'
    + '<div class="mdl-card-head" style="padding-right:58px;align-items:flex-start">'
    + '<span class="mdl-card-name" style="min-width:0" title="'+esc(t.title||t._id)+'">'+esc(t.title||t._id)+'</span>'
    + '<div style="flex:0 0 auto;display:flex;gap:4px;align-items:center;flex-wrap:wrap">'
    + cardRoleBadge(t)
    + taskModelBadge(t.model)
    + (rsm?'<span class="badge '+(rsm.tone==="attention"?"warn":"ok")+'">'+esc(rsm.label)+'</span>':'')
    + (vm?'<span class="badge'+(vm.cls?' '+vm.cls:'')+'" title="Verification result">'+esc(vm.label)+'</span>':'')
    + ageBadge(t)+'</div>'
    + '</div>'
    + '</div>';
}

// Groups review-lane cards that share a batchId under one aggregate rollup
// header (display-only — no merge/bulk-delete). A task with no batchId
// (most tasks — batches only come from chat/directive fan-out) is its own
// standalone group of one and renders exactly as it did before grouping
// existed. The rollup counts every task with that batchId across ALL lanes,
// not just the review-lane subset passed in as items, so the header keeps
// reflecting true batch progress after some siblings leave review (done/
// failed) while others are still awaiting review.
function groupReviewBatches(items, allTasks) {
  const laneOf = {};
  LANE_DEFS.forEach(L => L.statuses.forEach(s => { laneOf[s] = L.key; }));
  const seen = new Set();
  const groups = [];
  for (const t of items) {
    const bid = t.batchId;
    if (!bid) { groups.push({ batchId: null, items: [t] }); continue; }
    if (seen.has(bid)) continue;
    seen.add(bid);
    const groupItems = items.filter(x => x.batchId === bid);
    const batchTasks = (allTasks || []).filter(x => x.batchId === bid);
    const counts = {};
    for (const bt of batchTasks) {
      const key = laneOf[bt.status] || bt.status || "unknown";
      counts[key] = (counts[key] || 0) + 1;
    }
    const breakdown = LANE_DEFS.filter(L => counts[L.key]).map(L => counts[L.key] + " " + L.label).join(" · ");
    groups.push({ batchId: bid, items: groupItems, total: batchTasks.length, breakdown: breakdown });
  }
  return groups;
}

// Review lane's body: batch-grouped cards interleaved with standalone ones,
// in the same (already-sorted) order groupReviewBatches was handed.
function renderReviewLaneBody(items) {
  const groups = groupReviewBatches(items, state.tasks);
  return groups.map(g => {
    const cards = g.items.map(t => taskCardHtml(t, "review")).join("");
    if (!g.batchId) return cards;
    return '<div class="batch-group">'
      + '<div class="batch-group-head">Batch · ' + g.total + ' task' + (g.total === 1 ? '' : 's') + (g.breakdown ? ' — ' + esc(g.breakdown) : '') + '</div>'
      + cards
      + '</div>';
  }).join("");
}

function renderBoard() {
  const statusToLane = {};
  LANE_DEFS.forEach(L => L.statuses.forEach(s => statusToLane[s] = L.key));
  const byLane = {}; LANE_DEFS.forEach(L => byLane[L.key] = []);
  const filtered = state.tasks;
  for (const t of filtered) { const k = statusToLane[t.status]; if (k) byLane[k].push(t); }
  const el = document.getElementById("board");
  const collapsedLanes = getCollapsedLanes();
  el.innerHTML = LANE_DEFS.map(L => {
    let items = byLane[L.key] || [];
    if (L.key === "review") {
      items = items.slice().sort(reviewSortComparator);
    }
    if (!items.length && (L.key==="done"||L.key==="failed")) return "";
    const isCollapsed = collapsedLanes.has(L.key);
    const nameColor = laneColor[L.key] || "var(--text)";
    return '<div class="status-card'+(isCollapsed?' collapsed':'')+'">'
      + '<div class="status-card-head" onclick="toggleBoardLane(\''+L.key+'\')" title="'+(isCollapsed?'Expand':'Collapse')+' '+esc(L.label)+'">'
      + '<span class="status-card-caret">'+(isCollapsed?'▸':'▾')+'</span>'
      + '<span class="status-card-name" style="color:'+nameColor+'">'+L.label+'</span>'
      + '<span class="status-card-count">'+items.length+'</span>'
      + '</div>'
      + (isCollapsed ? '' : '<div class="status-card-body">'
          + (L.key === "review" ? renderReviewLaneBody(items) : items.map(t => taskCardHtml(t, L.key)).join(""))
          + '</div>')
      + '</div>';
  }).join("") || '<div class="muted">No tasks.</div>';
  const archivable = state.tasks.filter(t => ["review","done","failed","cancelled"].includes(t.status)).length;
  const ab = document.getElementById("archiveBtn");
  if (ab) ab.textContent = archivable ? "· archive completed (" + archivable + ")" : "";
  updateOverviewNav();
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
  if (running) b.push('<button class="secondary-action" onclick="taskAction(\''+t._id+'\',\'cancel\')">■ Cancel</button>');
  if (retryable) b.push('<button class="secondary-action reply-toggle" id="retryToggle_'+t._id+'" onclick="toggleRetry(\''+t._id+'\')">↻ Retry</button>');
  // Reply: answer the agent / continue a finished task (review, failed, cancelled)
  // — except needs_input, which already shows the fully-standout reply card.
  const canReply = !steerable && t.reviewState !== "needs_input" && (t.pendingQuestion || retryable);
  if (canReply) b.push('<button class="secondary-action reply-toggle" id="replyToggle_'+t._id+'" onclick="toggleReply(\''+t._id+'\')">↩ Reply</button>');
  if (!running) b.push('<button class="secondary-action" onclick="taskAction(\''+t._id+'\',\'archive\')">⌫ Archive</button>');
  b.push('<button class="danger-action" onclick="deleteTask(\''+t._id+'\')">🗑 Delete</button>');
  let html = '<div class="action-bar">'+b.join("")+'</div>';
  // Retry-with-steer: optional guidance text + attachments fold out under Retry.
  if (retryable) {
    html += '<div id="retrySection_'+t._id+'" class="reply-section">'
      + '<textarea id="retryText" class="reply-input" placeholder="Optional: add guidance to steer the rerun…" rows="2" oninput="onCtxDraft(\'retry\',this)"></textarea>'
      + attachPickerHtml('retry')
      + '<div class="action-bar"><button class="primary-action" onclick="submitRetry(\''+t._id+'\')">↻ Retry'+(t.status==='cancelled'?'':' with guidance')+'</button></div></div>';
  }
  // Steer a live run: always-visible box (the task is live-refreshing, so a
  // collapsible section would close mid-compose). Submitting interrupts the agent
  // and resumes the same session with the new instruction.
  if (steerable) {
    html += '<div id="steerSection_'+t._id+'" class="reply-section open">'
      + '<div class="reply-question">Steer this run — your instruction is added and the session resumes.</div>'
      + '<textarea id="steerText" class="reply-input" placeholder="Type a new instruction to steer this run…" rows="2" oninput="onCtxDraft(\'steer\',this)"></textarea>'
      + '<div class="action-bar"><button class="primary-action" onclick="submitSteer(\''+t._id+'\')">⤳ Send Steer</button></div></div>';
  }
  // Reply box. needs_input → the fully-standout card (auto-open). Otherwise a
  // subtler "reply to continue" box (toggled open from the ↩ Reply button).
  if (!steerable) {
    const isOpen = t.reviewState === "needs_input";
    const q = t.pendingQuestion ? '<div class="reply-question">'+esc(t.pendingQuestion)+'</div>' : '';
    html += '<div id="replySection_'+t._id+'" class="reply-section'+(isOpen?' open needs':' subtle')+'">'
      + (isOpen
          ? '<div class="reply-head">✋ Awaiting your reply</div>'
          : '<div class="reply-subhead">↩ Reply — your message is added and the task re-runs</div>')
      + q
      + '<textarea id="replyText" class="reply-input" placeholder="'+(isOpen?'Type your reply…':'Reply to this task…')+'" rows="'+(isOpen?'7':'2')+'" oninput="onCtxDraft(\'reply\',this)"></textarea>'
      + attachPickerHtml('reply')
      + '<div class="action-bar">'
      + (_replyEditSource ? '<button class="ghost-action" onclick="loadDraftIntoReply()" title="Load the current draft into the box to edit in place — no copy-paste">✎ Edit the draft</button> ' : '')
      + '<button class="primary-action" onclick="replyTask(\''+t._id+'\')">Reply</button></div></div>';
  }
  return html;
}

async function selectTask(id) {
  state.selected = id;
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setFlashSessionMode(false);
  if (_taskFormInSession) _closeNewTaskPanel();
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
  // Coordinator children (for plural role pills) — cheap, indexed lookup;
  // includes archived children (see GET /tasks' parentTaskId special-case),
  // since a subtask auto-archives on success and that's the interesting case.
  let children = [];
  try { children = await api("/tasks?parentTaskId="+id); } catch (e) { children = []; }
  if (state.selected !== id) return; // stale — operator moved on while this was in flight
  const out = t.output ? (typeof t.output==="string"?JSON.parse(t.output):t.output) : {};
  // The clean text the operator would edit: a review draft's script, else the result.
  _replyEditSource = (typeof out.reviewScript === "string" && out.reviewScript) || (typeof out.summary === "string" && out.summary) || "";
  const logs = typeof t.logs === "string" ? (()=>{try{return JSON.parse(t.logs)}catch{return[]}})() : (t.logs||[]);
  const live = ["assigned","in_progress"].includes(t.status);
  const el = document.getElementById("session");
  const colEl = el && el.parentElement; // .col.session — the scrollable outer column
  // Preserve scroll positions — innerHTML rebuild resets scrollTop to 0.
  const prevColScroll = (colEl && !live) ? colEl.scrollTop : 0;
  const prevScrollTop = live ? null : (el.querySelector(".transcript")?.scrollTop ?? null);
  el.innerHTML = '<div class="session"><h1>'+esc(t.title||t._id)+(live?'<span class="streaming">● running</span>':'')
    + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button></h1>'
    + '<div class="sub">'+esc(t.project||"")+' · '+esc(t.status)+(t.reviewState?' · '+esc(t.reviewState):'')+'</div>'
    + taskProvenancePills(t, out, logs, children)
    + taskActionsHtml(t)
    + (t.projectPath ? '<div class="kv"><span class="k">project path</span><span>'+esc(t.projectPath)+'</span></div>' : '')
    + taskTelemetryStrip(t, out)
    + taskVerificationSection(t)
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
  if (colEl && prevColScroll) colEl.scrollTop = prevColScroll;
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
  const btn = sec ? sec.querySelector(".primary-action") : null;
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
// The dashboard modal's group toggle ("by provider" / "by model") now drives
// BOTH the bottom breakdown table AND the time-bucketed "Tokens/Tasks over
// time" charts: in "by model" mode they stack by Claude tier (Opus/Sonnet/
// Haiku) / Codex from series.pointsByModel, which is what the operator asked
// for ("graphs by model usage"). The provider view remains the default.
let _obsGroup = "provider";
// Any provider key not listed here falls back to its raw string as a label
// and to OBS_COLORS.other as a color — see the "|| " fallbacks at every
// OBS_LABELS/OBS_COLORS read site below. A pre-cutover DB may still carry a
// handful of historical "local-*" rows (the since-retired on-device engine);
// they fall through to that "other" bucket rather than an explicit entry,
// since there's no engine left to distinguish tiers for.
const OBS_LABELS = { "anthropic": "Claude", "openai-codex": "Codex", "other": "other" };
const OBS_COLORS = { "anthropic": "#c8794f", "openai-codex": "#10a37f", "other": "#8a93a6" };
const OBS_ORDER = { "anthropic": 0, "openai-codex": 1, "other": 2 };
function obsProvider(model) {
  const m = (model || "").toLowerCase().trim();
  if (/^(codex|chatgpt)/.test(m) || /^(gpt|o[0-9])/.test(m)) return "Codex";
  if (/^(claude|opus|sonnet|haiku)/.test(m)) return "Claude";
  return "—";
}
// Per-Claude-tier colors for the "by model" breakdown, distinct from the
// provider-level OBS_COLORS above — Opus/Sonnet/Haiku all share the
// "anthropic" provider color there, but the operator's ask for "by model" is
// specifically which TIER ran, so each gets its own dot/series color here.
const OBS_TIER_COLORS = { "Opus": "#c8794f", "Sonnet": "#e0a458", "Haiku": "#f0cf7a", "Codex": "#10a37f" };
// Classify a raw model id into a Claude tier or "Codex". Matches the bare CLI
// alias ("opus"/"sonnet"/"haiku") and any resolved full id the CLI reports
// back (e.g. "claude-opus-4-8", "claude-opus-4-8[1m]"). Returns null for
// anything else (historical local rows, unknown ids) so callers fall back to
// the raw string / OBS_COLORS.other.
function obsModelTier(model) {
  const m = (model || "").toLowerCase().trim();
  if (m.indexOf("codex:") === 0 || /^(gpt|o[0-9])/.test(m)) return "Codex";
  if (m === "opus" || m.indexOf("claude-opus") === 0) return "Opus";
  if (m === "sonnet" || m.indexOf("claude-sonnet") === 0) return "Sonnet";
  if (m === "haiku" || m.indexOf("claude-haiku") === 0) return "Haiku";
  return null;
}
function obsModelColor(model) {
  const tier = obsModelTier(model);
  return (tier && OBS_TIER_COLORS[tier]) || OBS_COLORS.other;
}
// Display-only cleanup of a raw model id: a Claude tier collapses to its tier
// name (Opus/Sonnet/Haiku), keeping a "[1m]" 1M-context-window marker as a
// distinct suffix — a [1m] variant prices differently and must stay its own
// row, never merged into the plain tier's row. Codex keeps its specific
// model string (stripping the internal "codex:" prefix — execution-only, not
// user-facing, see codex-agent.ts) since "Codex" alone would collapse GPT-5.5
// and Spark into one row.
function obsModelLabel(model) {
  model = String(model || "");
  const tier = obsModelTier(model);
  if (tier === "Opus" || tier === "Sonnet" || tier === "Haiku") {
    return tier + (/\[1m\]$/.test(model) ? " (1M ctx)" : "");
  }
  if (model.indexOf("codex:") === 0) model = model.slice(6);
  const m1m = model.match(/^(.*)\[1m\]$/);
  if (m1m) return m1m[1] + " (1M ctx)";
  return model;
}


// Board card model badge. Claude/Codex ids collapse to a friendly tier/name via
// obsModelLabel; ids from the retired pre-cutover local stack (qwen / Rapid-MLX)
// that still linger on old task rows render as a neutral "local (legacy)" chip
// instead of the raw internal id like "qwen3.6-27b-4bit".
function taskModelBadge(model) {
  if (!model) return '';
  const m = String(model).toLowerCase();
  if (m.indexOf('qwen') === 0 || m.indexOf('rapid-mlx') >= 0 || m.indexOf('mlx') >= 0 || /\d+b-\d+bit/.test(m)) {
    return '<span class="badge model" title="' + esc(model) + '">local (legacy)</span>';
  }
  return '<span class="badge model">' + esc(obsModelLabel(model)) + '</span>';
}
function fmtMs(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return Math.round(ms) + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  return Math.floor(ms / 60000) + "m" + Math.round((ms % 60000) / 1000) + "s";
}
function fmtNum(n) { return n == null ? "—" : Number(n).toLocaleString(); }


// Which agent role(s) handled a task, as pills: the task's own agentType
// (skipped when "auto"/unset — a task with no real role resolved yet has
// nothing honest to show), plus one pill per distinct role among childTasks
// (empty today; Spec 3's delegation read-back fills this in without needing
// to touch this function again — that's the point of taking the array param
// now instead of a single task). Tooltip states HOW the role was chosen
// (out.roleProvenance, set by POST /tasks for an explicit pick or by the
// scheduler for an auto-resolved one) — never invents a reason it can't back.
const ROLE_PROVENANCE_LABEL = { explicit: "you picked it", classifier: "auto-classified", keyword: "keyword-matched", default: "default (Specialist agents is off)" };
function renderRolePills(task, childTasks) {
  task = task || {};
  childTasks = Array.isArray(childTasks) ? childTasks : [];
  const primaryId = (task.agentType && task.agentType !== "auto") ? task.agentType : null;
  const ids = [];
  if (primaryId) ids.push(primaryId);
  for (const c of childTasks) {
    if (c && c.agentType && c.agentType !== "auto" && ids.indexOf(c.agentType) === -1) ids.push(c.agentType);
  }
  if (!ids.length) return "";
  // task.output may be the raw (possibly JSON-string) field or an
  // already-parsed object depending on the caller — handle both, matching
  // the parse callers like renderSession already do for t.output.
  const rawOut = task.output;
  const out = (rawOut && typeof rawOut === "object") ? rawOut
    : (typeof rawOut === "string" ? (() => { try { return JSON.parse(rawOut); } catch { return {}; } })() : {});
  const prov = out.roleProvenance;
  return ids.map(id => {
    const p = agentProfileById[id];
    const label = (p ? ((p.icon || "") + " " + p.name) : id).trim();
    const tip = (id === primaryId && prov && prov.agentType === id && ROLE_PROVENANCE_LABEL[prov.source])
      ? ROLE_PROVENANCE_LABEL[prov.source] : "Agent role";
    return '<span class="prov-pill agent" title="' + esc(tip) + '">' + esc(label) + '</span>';
  }).join("");
}

// Compact board-card equivalent of renderRolePills — same "which role(s)
// handled this" data, styled as a .badge to match the model/reviewState/age
// badges already on the card instead of the detail view's pill shape. A
// coordinator's card shows its own role plus one badge per distinct child
// agentType (childAgentTypes is enriched server-side in GET /tasks — a
// single grouped query, not a per-card fetch).
function cardRoleBadge(t) {
  const primaryId = t && t.agentType && t.agentType !== "auto" ? t.agentType : null;
  const ids = [];
  if (primaryId) ids.push(primaryId);
  const childIds = Array.isArray(t && t.childAgentTypes) ? t.childAgentTypes : [];
  for (const id of childIds) {
    if (id && id !== "auto" && ids.indexOf(id) === -1) ids.push(id);
  }
  if (!ids.length) return "";
  return ids.map(id => {
    const p = agentProfileById[id];
    const label = (p ? ((p.icon || "") + " " + p.name) : id).trim();
    return '<span class="badge" style="color:var(--accent)" title="Agent role">' + esc(label) + '</span>';
  }).join("");
}

// What ran a completed task: the agent role(s) (renderRolePills, above),
// distinct models used (out.modelsUsed, populated live by the agent manager
// from stream init/turn events), MCP servers actually invoked (derived from
// tool_use log entries — the CLI's own tool-call naming convention is
// "mcp__<server>__<tool>", the same prefix approval.ts matches on), and the
// entry-point skill/command (out.command, set when a task is created via
// "Use a skill").
function taskProvenancePills(t, out, logs, childTasks) {
  out = out || {};
  const rolePills = renderRolePills(t, childTasks || []);
  const models = Array.isArray(out.modelsUsed) ? out.modelsUsed.filter(Boolean) : [];
  const mcpServers = new Set();
  for (const entry of (logs || [])) {
    if (!entry || entry.type !== "tool_use" || typeof entry.content !== "string") continue;
    const m = entry.content.match(/^mcp__([a-zA-Z0-9_.-]+)__/);
    if (m) mcpServers.add(m[1]);
  }
  const skill = typeof out.command === "string" && out.command.trim() ? out.command.trim() : "";

  if (!rolePills && !models.length && !mcpServers.size && !skill) return "";

  const pills = rolePills + models.map(m => '<span class="prov-pill role" title="Model used">' + esc(m) + '</span>').join("")
    + Array.from(mcpServers).map(s => '<span class="prov-pill mcp" title="MCP server used">' + esc(s) + '</span>').join("")
    + (skill ? '<span class="prov-pill skill" title="Skill / command">' + esc(skill) + '</span>' : "");
  return '<div class="prov-pills">' + pills + '</div>';
}

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
  const strip = '<div class="obs-strip">' + cells.map(c =>
    '<span class="obs-cell"><b>' + esc(String(c[1])) + '</b>' + esc(c[0]) + '</span>').join("") + '</div>';
  return '<details class="task-debug"><summary class="muted" style="font-size:11px;cursor:pointer">Debug info</summary>' + strip + '</details>';
}

// Verification-gate report for the detail panel: a collapsible <pre> (escaped
// via esc, same as every other rendered task field) with the verdict badge in
// its summary line. Renders nothing when there's no report to show — most
// claude -p tasks never ran the gate, and a verdict with no report text
// (e.g. "uncertain" from a gate that produced no narrative) has nothing to
// disclose beyond the board-card badge already showing the verdict.
function taskVerificationSection(t) {
  let v = t && t.verification;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { v = null; } }
  if (!v || typeof v !== "object" || typeof v.report !== "string" || !v.report) return "";
  const vm = verificationMeta(v);
  return '<h2>Verification' + (vm ? ' <span class="badge' + (vm.cls ? ' ' + vm.cls : '') + '">' + esc(vm.label) + '</span>' : '') + '</h2>'
    + '<details class="task-debug"><summary class="muted" style="font-size:11px;cursor:pointer">Verification report</summary>'
    + '<pre class="desc" style="white-space:pre-wrap;word-break:break-word;margin-top:6px">' + esc(v.report) + '</pre></details>';
}

// --- Observability dashboard --------------------------------------------
// Data helpers (setObsWindowPanel/setObsGroupPanel/obsPanelToggles) plus the
// obsOverlay modal (openObsModal/closeObsModal) that hosts renderObsDashboard.
function setObsWindowPanel(w) { _obsWindow = w; renderObsDashboard("obsDashPanel"); }
function setObsGroupPanel(g) { _obsGroup = g; renderObsDashboard("obsDashPanel"); }

function obsPanelToggles() {
  const wins = ["1h", "24h", "7d", "30d"];
  const winBtns = wins.map(function (w) { return '<button data-w="' + w + '" onclick="setObsWindowPanel(\'' + w + '\')">' + w + '</button>'; }).join("");
  const grpBtns = '<button data-g="provider" onclick="setObsGroupPanel(\'provider\')">by provider</button>'
    + '<button data-g="model" onclick="setObsGroupPanel(\'model\')">by model</button>';
  return '<span class="obs-win" id="obs_win_panel">' + winBtns + '</span>'
    + '<span class="obs-win" id="obs_group_panel" style="margin-left:8px">' + grpBtns + '</span>'
    + '<button class="copybtn" style="margin-left:8px" onclick="renderObsDashboard(\'obsDashPanel\')">↻ Refresh</button>';
}

function openObsModal() {
  document.getElementById('obsOverlay').classList.add('open');
  document.getElementById('obsModalToggles').innerHTML = obsPanelToggles();
  renderObsDashboard('obsDashPanel');
}
function closeObsModal() {
  document.getElementById('obsOverlay').classList.remove('open');
}

// ── Goals panel (accountability layer) ─────────────────────────────────
let _goalsState = { panelOpen: false, goals: null, error: false };

function showGoals() {
  state.selected = null;
  state.selectedSkillOrCommand = null;
  _skSel = '';
  _ctxTask = null;
  if (_taskFormInSession) _closeNewTaskPanel();
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = true;
  setStoredView('goals');
  renderBoard();
  renderSkillList();
  renderGoalsPanel();
  updateFlashNav();
  updateBrainNav();
  updateRolesNav();
  updateToolsNav();
  updateGoalsNav();
  loadGoals();
}

function restoreLastView() {
  var view = getStoredView();
  if (view === 'flash') { _pendingScrollRestore = 'flash'; showFlashPanel(); }
  else if (view === 'brain') showBrain();
  else if (view === 'roles') showRoles();
  else if (view === 'tools') { _pendingScrollRestore = 'tools'; showTools(); }
  else if (view === 'goals') { _pendingScrollRestore = 'goals'; showGoals(); }
  // 'overview' is already the default rendered state on boot — nothing to do.
}

function updateGoalsNav() { syncNav(); }

async function loadGoals() {
  _goalsState.error = false;
  try {
    const r = await api('/goals');
    _goalsState.goals = (r && r.goals) || [];
  } catch (e) {
    _goalsState.error = true;
    _goalsState.goals = null;
  }
  renderGoalsPanel();
  if (_pendingScrollRestore === 'goals') { _pendingScrollRestore = null; restoreScrollPosition('goals'); }
}

const GOALS_CAT_META = {
  business: { icon: '💼', label: 'Solo Founder / Business' },
  health: { icon: '🏋️', label: 'Health & Fitness' },
  faith: { icon: '✝️', label: 'Faith' },
  language: { icon: '🗣️', label: 'Language' },
  personal: { icon: '🌱', label: 'Personal' }
};
function goalsCatMeta(cat) { return GOALS_CAT_META[cat] || { icon: '🎯', label: cat || 'Other' }; }

function goalRowHtml(g) {
  const due = g.dueToday
    ? '<span class="tools-kind" style="border-color:#e0a458;color:#e0a458">due today</span>'
    : '';
  const paused = g.status === 'paused' ? '<span class="tools-kind">paused</span>' : (g.status === 'done' ? '<span class="tools-kind" style="color:var(--ok)">done ✓</span>' : '');
  const last = g.latestCheckin
    ? 'last: ' + esc(g.latestCheckin.date) + (g.latestCheckin.note ? ' — ' + esc(g.latestCheckin.note) : '')
    : 'no check-ins yet';
  const count = (g.checkinCount != null ? g.checkinCount : 0);
  return '<div class="tools-row goal-row" style="cursor:default">'
    + '<div class="tools-row-top">'
    + '<span class="tools-name" style="font-family:inherit;font-size:13.5px">' + esc(g.title) + '</span>'
    + '<span class="tools-kind">' + esc(g.cadence || 'weekly') + '</span>' + due + paused
    + '<span class="tools-caret" style="margin-left:auto"><button class="oc-mic-btn" style="padding:3px 10px;font-size:11px" onclick="goalCheckin(\'' + attrEnc(g.id) + '\',\'' + attrEnc(g.title) + '\')">＋ Log</button></span>'
    + '</div>'
    + '<div class="tools-desc">' + esc(last) + ' · ' + count + ' check-in' + (count === 1 ? '' : 's')
    + (g.description ? ' · ' + esc(g.description) : '') + '</div>'
    // The explicit "do this next" step — the actionable hook. Clickable to set/edit.
    + '<div class="goal-next" onclick="goalSetNext(\'' + attrEnc(g.id) + '\',\'' + attrEnc(g.title) + '\',\'' + attrEnc(g.nextAction || '') + '\')" title="Click to set the next step">'
    + (g.nextAction ? '→ next: ' + esc(g.nextAction) : '+ set next step')
    + '</div>'
    + '</div>';
}

function renderGoalsPanel() {
  if (!_goalsState.panelOpen) return;
  const session = document.getElementById('session');
  if (!session) return;
  setFlashSessionMode(true);
  let body;
  if (_goalsState.error) {
    body = '<div class="oc-empty">Could not load goals. <a href="#" onclick="event.preventDefault();loadGoals()">Retry</a></div>';
  } else if (!_goalsState.goals) {
    body = '<div class="oc-empty">Loading goals…</div>';
  } else if (!_goalsState.goals.length) {
    body = '<div class="oc-empty">No goals yet. Add one below, or ask the assistant in chat to "import my goals from GOALS.md".</div>';
  } else {
    const goals = _goalsState.goals;
    const due = goals.filter(function (g) { return g.dueToday && g.status === 'active'; });
    body = '';
    if (due.length) {
      body += '<div class="tools-group"><div class="tools-group-h">Due today <span class="count">' + due.length + '</span></div>'
        + '<div class="tools-group-sub">what to move on today</div>'
        + due.map(goalRowHtml).join('') + '</div>';
    }
    // group the rest by category
    const cats = {};
    goals.forEach(function (g) { (cats[g.category || 'personal'] = cats[g.category || 'personal'] || []).push(g); });
    Object.keys(cats).forEach(function (cat) {
      const meta = goalsCatMeta(cat);
      body += '<div class="tools-group"><div class="tools-group-h">' + meta.icon + ' ' + esc(meta.label)
        + ' <span class="count">' + cats[cat].length + '</span></div>'
        + cats[cat].map(goalRowHtml).join('') + '</div>';
    });
  }
  session.innerHTML = '<div class="oc-center-pane">'
    + '<div class="oc-panel-head"><div><div class="oc-panel-title"><span>🎯 Goals</span></div>'
    + '<div class="oc-panel-sub">Long-horizon goals &amp; daily accountability — check in to track progress</div></div>'
    + '<span class="oc-panel-head-spacer"></span>'
    + '<button class="oc-mic-btn" style="margin-right:8px" onclick="goalAdd()">＋ Add goal</button>'
    + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button></div>'
    + '<div class="tools-pane">' + body + '</div></div>';
}

async function goalCheckin(id, title) {
  const note = await hmPrompt('Check-in for "' + (title || 'goal') + '" — what did you do?', '');
  if (note === null) return;
  try {
    await api('/goals/' + encodeURIComponent(id) + '/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note }) });
    hmToast('Logged ✓', 'ok');
    loadGoals();
  } catch (e) { hmToast('Could not log check-in', 'err'); }
}

async function goalAdd() {
  const title = await hmPrompt('New goal — what do you want to track?', '');
  if (!title) return;
  const category = await hmPrompt('Category (business / health / faith / language / personal):', 'personal');
  const cadence = await hmPrompt('Cadence (daily / weekly / milestone):', 'weekly');
  const nextAction = await hmPrompt('Next step (one concrete thing to do soon — optional):', '');
  try {
    await api('/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, category: category || 'personal', cadence: cadence || 'weekly', nextAction: nextAction || undefined }) });
    hmToast('Goal added ✓', 'ok');
    loadGoals();
  } catch (e) { hmToast('Could not add goal', 'err'); }
}

// Set/edit a goal's single "do this next" step — the actionable hook the
// heartbeat, morning brief, and chat surface. Upserts by id.
async function goalSetNext(id, title, current) {
  const next = await hmPrompt('Next step for "' + (title || 'goal') + '" — one concrete thing to do soon:', current || '');
  if (next === null) return;
  try {
    await api('/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, title: title, nextAction: next }) });
    hmToast('Next step set ✓', 'ok');
    loadGoals();
  } catch (e) { hmToast('Could not set next step', 'err'); }
}
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
  if (unit === "minute") return (t || "").slice(11, 16); // "HH:MM" — label already carries the 5-min-floored minute
  if (unit === "hour") return (t || "").slice(11, 13) + ":00";
  return (t || "").slice(5); // MM-DD
}
// Legend keyed by provider OR model. colorFn/labelFn default to the provider
// lookups; the "by model" charts pass obsModelColor/obsModelLabel so Opus/
// Sonnet/Haiku each get their own tier color instead of the shared "Claude".
function obsLegend(keys, colorFn, labelFn) {
  const color = colorFn || function (k) { return OBS_COLORS[k] || OBS_COLORS.other; };
  const label = labelFn || function (k) { return OBS_LABELS[k] || k; };
  return '<div class="obs-legend">' + keys.map(function (k) {
    return '<span><i style="background:' + color(k) + '"></i>' + esc(label(k)) + '</span>';
  }).join("") + '</div>';
}
// Sort order for the "by model" series: Opus, Sonnet, Haiku, Codex, then other.
function obsTierOrder(model) {
  const t = obsModelTier(model);
  return t === "Opus" ? 0 : t === "Sonnet" ? 1 : t === "Haiku" ? 2 : t === "Codex" ? 3 : 4;
}

// Dependency-free stacked-bar SVG: one bar per time bucket, stacked by series
// key (provider or model). colorFn/labelFn default to the provider lookups.
function obsStackedBars(points, keys, valueFn, unit, colorFn, labelFn) {
  const color = colorFn || function (k) { return OBS_COLORS[k] || OBS_COLORS.other; };
  const label = labelFn || function (k) { return OBS_LABELS[k] || k; };
  const providers = keys;
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

// Grouped (side-by-side) bars: within each time bucket, one sub-bar per series
// key, so you can compare which key (model) is used most at a glance — the
// "which models am I using" ask. y-axis scales to the max single value (bars are
// NOT stacked). Used for the by-model view.
function obsGroupedBars(points, keys, valueFn, unit, colorFn, labelFn) {
  const color = colorFn || function (k) { return OBS_COLORS[k] || OBS_COLORS.other; };
  const label = labelFn || function (k) { return OBS_LABELS[k] || k; };
  const W = 720, H = 150, padL = 44, padR = 10, padT = 10, padB = 22;
  const n = points.length || 1;
  const nk = keys.length || 1;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  let maxV = 1;
  for (const p of points) for (const k of keys) { const v = valueFn(p, k) || 0; if (v > maxV) maxV = v; }
  const niceMax = obsNiceMax(maxV);
  const bw = plotW / n;
  const groupW = Math.min(bw - 2, bw * 0.82);
  const sub = groupW / nk;
  const subW = Math.max(0.8, sub * 0.86);
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  for (let g = 0; g <= 2; g++) {
    const val = niceMax * g / 2;
    const y = padT + plotH - (val / niceMax) * plotH;
    svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" style="stroke:var(--border)" stroke-width="1"/>';
    svg += '<text x="' + (padL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="9" style="fill:var(--muted)">' + esc(obsShort(val)) + '</text>';
  }
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const gx = padL + i * bw + (bw - groupW) / 2;
    for (let j = 0; j < nk; j++) {
      const k = keys[j];
      const v = valueFn(p, k) || 0;
      if (v <= 0) continue;
      const h = (v / niceMax) * plotH;
      const x = gx + j * sub + (sub - subW) / 2;
      const y = padT + plotH - h;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + subW.toFixed(1) + '" height="' + Math.max(0.6, h).toFixed(1) + '" fill="' + color(k) + '"><title>' + esc(label(k) + " · " + obsBucketLabel(p.t, unit) + ": " + obsShort(v)) + '</title></rect>';
    }
  }
  const idxs = n <= 1 ? [0] : [0, Math.floor(n / 2), n - 1];
  for (const i of idxs) {
    const x = padL + i * bw + bw / 2;
    svg += '<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" style="fill:var(--muted)">' + esc(obsBucketLabel(points[i].t, unit)) + '</text>';
  }
  return svg + '</svg>';
}

async function renderObsDashboard(target) {
  target = target || "obsDash";
  const el = document.getElementById(target);
  if (!el) return;
  const winSel = target === "obsDashPanel" ? "#obs_win_panel button" : "#obs_win button";
  document.querySelectorAll(winSel).forEach(function (b) { b.classList.toggle("on", b.dataset.w === _obsWindow); });
  if (target === "obsDashPanel") {
    document.querySelectorAll("#obs_group_panel button").forEach(function (b) { b.classList.toggle("on", b.dataset.g === _obsGroup); });
  }
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

  // The time-bucketed charts honor the by-provider / by-model toggle too (not
  // just the breakdown table below): in "by model" mode they stack by Claude
  // tier (Opus/Sonnet/Haiku) / Codex using s.pointsByModel, so the operator can
  // see which model ran over time — the thing they actually asked for.
  const groupByModel = _obsGroup === "model";
  const perStr = s.unit === "minute" ? "5 min" : s.unit === "hour" ? "hour" : "day";
  if (groupByModel) {
    const seen = {};
    (s.pointsByModel || []).forEach(function (p) { Object.keys(p.byModel || {}).forEach(function (k) { seen[k] = 1; }); });
    const modelKeys = Object.keys(seen)
      // Drop retired pre-cutover local models (qwen/deepseek/etc.) — they only
      // linger in historical windows and are excluded from the provider view and
      // the model scorecard too. obsModelTier is null for anything not a live
      // Claude tier or Codex.
      .filter(function (k) { return obsModelTier(k) !== null; })
      .sort(function (a, b) {
        const d = obsTierOrder(a) - obsTierOrder(b);
        return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
      });
    const mpts = s.pointsByModel || [];
    html += '<div class="obs-chart"><h4>Tokens over time</h4><div class="sub">input + output, side-by-side by model</div>'
      + obsGroupedBars(mpts, modelKeys, function (p, k) { const c = p.byModel[k]; return c ? c.inputTokens + c.outputTokens : 0; }, s.unit, obsModelColor, obsModelLabel)
      + obsLegend(modelKeys, obsModelColor, obsModelLabel) + '</div>';
    html += '<div class="obs-chart"><h4>Tasks over time</h4><div class="sub">runs per ' + perStr + ', side-by-side by model</div>'
      + obsGroupedBars(mpts, modelKeys, function (p, k) { const c = p.byModel[k]; return c ? c.runs : 0; }, s.unit, obsModelColor, obsModelLabel)
      + obsLegend(modelKeys, obsModelColor, obsModelLabel) + '</div>';
  } else {
    html += '<div class="obs-chart"><h4>Tokens over time</h4><div class="sub">input + output, stacked by provider</div>'
      + obsStackedBars(s.points, providers, function (p, pr) { const c = p.byProvider[pr]; return c ? c.inputTokens + c.outputTokens : 0; }, s.unit)
      + obsLegend(providers) + '</div>';
    html += '<div class="obs-chart"><h4>Tasks over time</h4><div class="sub">runs per ' + perStr + ', stacked by provider</div>'
      + obsStackedBars(s.points, providers, function (p, pr) { const c = p.byProvider[pr]; return c ? c.runs : 0; }, s.unit)
      + obsLegend(providers) + '</div>';
  }

  html += '<div class="obs-chart"><h4>Prompt cache</h4><div class="sub">cached input reuse — Claude &amp; Codex cache prompts</div>';
  const crows = (s.cache || []).slice().sort(function (a, b) { return (OBS_ORDER[a.provider] ?? 9) - (OBS_ORDER[b.provider] ?? 9); });
  const dbCacheRows = crows.filter(function (c) { return c.provider.indexOf("local-") !== 0; });
  if (!dbCacheRows.length) html += '<div class="muted">No cache data.</div>';
  for (const c of dbCacheRows) {
    const label = OBS_LABELS[c.provider] || c.provider;
    if (!c.supported) {
      html += '<div class="obs-cacherow"><span class="cprov">' + esc(label) + '</span>'
        + '<span class="muted" style="font-size:11px">no prompt-cache signal</span><span class="cnum"></span></div>';
      continue;
    }
    const pct = c.hitRatePct != null ? c.hitRatePct : 0;
    const col = pct >= 50 ? "var(--ok,#4caf50)" : pct >= 20 ? "#f0a500" : "#e05b2c";
    let written = c.cacheCreationTokens > 0 ? " · " + obsShort(c.cacheCreationTokens) + " written" : "";
    if (c.cacheCreate5mTokens != null && c.cacheCreate1hTokens != null) {
      written += " (" + obsShort(c.cacheCreate5mTokens) + " 5m, " + obsShort(c.cacheCreate1hTokens) + " 1h)";
    }
    const net = c.netBenefitTokens != null
      ? ' · <span title="Equivalent base-input-tokens saved by caching, net of the write premium — a token-based signal, not a dollar figure.">net ' + (c.netBenefitTokens >= 0 ? "+" : "-") + obsShort(Math.abs(c.netBenefitTokens)) + (c.netBenefitTokens < 0 ? " (loss)" : " saved") + '</span>'
      : '';
    html += '<div class="obs-cacherow">'
      + '<span class="cprov">' + esc(label) + '</span>'
      + '<span class="cbar"><i style="width:' + Math.min(100, pct).toFixed(0) + '%;background:' + col + '"></i></span>'
      + '<span class="cnum">' + (c.hitRatePct != null ? c.hitRatePct.toFixed(0) + "% hit" : "—") + " · " + obsShort(c.cacheReadTokens) + " read" + written + net + '</span>'
      + '</div>';
  }
  html += '</div>';

  // groupByModel already computed above for the time charts.
  const groupRows = groupByModel ? (detail && detail.totals && detail.totals.byModel) : (detail && detail.totals && detail.totals.byProvider);
  if (groupRows && groupRows.length) {
    const heading = groupByModel ? "By model" : "By provider";
    const colHead = groupByModel ? "model" : "provider";
    html += '<div class="obs-chart"><h4>' + heading + '</h4><div class="sub">recent runs · latency percentiles · throughput</div>'
      + '<table class="obs-tbl"><tr><th>' + colHead + '</th><th>runs</th><th>tok in/out</th><th>p50</th><th>p95</th><th>tok/s</th></tr>';
    for (const p of groupRows) {
      // In "by model" mode, the dot is the model's own Claude-tier/Codex color
      // (obsModelColor) — Opus/Sonnet/Haiku/Codex each a distinct series/color,
      // not just their shared "Claude" provider color — see the _obsGroup
      // comment above for why this stays a second, lightweight query rather
      // than a per-bucket-per-model time series.
      const dot = groupByModel
        ? '<i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:' + obsModelColor(p.key) + '"></i>'
        : '';
      const label = groupByModel ? obsModelLabel(p.key) : (OBS_LABELS[p.key] || p.key);
      html += '<tr><td>' + dot + esc(label) + '</td><td>' + p.runs + '</td>'
        + '<td>' + fmtNum(p.inputTokens) + ' / ' + fmtNum(p.outputTokens) + '</td>'
        + '<td>' + fmtMs(p.latencyP50Ms) + '</td><td>' + fmtMs(p.latencyP95Ms) + '</td>'
        + '<td>' + (p.avgTokensPerSec != null ? p.avgTokensPerSec : "—") + '</td></tr>';
    }
    html += '</table></div>';
  }

  // Per-model scorecard (first-pass %, rework, cost per task) — the reframed
  // "route scorecard", now keyed by Claude tier / Codex. Shown in the full
  // dashboard so the center takeover is complete, not just the right-rail summary.
  const tsc = detail && detail.tierScorecard;
  if (Array.isArray(tsc) && tsc.length) {
    const pct = v => (v == null ? '—' : Math.round(v * 100) + '%');
    const dollars = v => (v == null ? '<span class="muted" title="not reported">—</span>' : '$' + Number(v).toFixed(v < 0.01 ? 4 : 2));
    html += '<div class="obs-chart"><h4>Model scorecard</h4><div class="sub">first-pass rate · rework · cost per task, by model</div>'
      + '<table class="obs-tbl"><tr><th>model</th><th>tasks</th><th>1st-pass</th><th>runs/task</th><th>$/task</th></tr>';
    for (const s2 of tsc) {
      const dot = '<i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:' + (OBS_TIER_COLORS[s2.tier] || OBS_COLORS.other) + '"></i>';
      html += '<tr><td>' + dot + esc(s2.tier) + '</td><td>' + s2.tasks + '</td>'
        + '<td>' + pct(s2.firstPassRate) + '</td>'
        + '<td>' + Number(s2.avgRunsPerTask).toFixed(2) + '</td>'
        + '<td>' + dollars(s2.costPerTask) + '</td></tr>';
    }
    html += '</table></div>';
  }

  el.innerHTML = html;
}

function renderConn() {
  const c = state.conn; if (!c) return;
  // Connectivity mode folds into the header's single "● live" indicator
  // instead of a separate pill (Phase 2 header cleanup) — SSE reachability
  // (set by connectSSE's onopen/onerror) takes priority: if the daemon
  // connection itself is down/reconnecting, that "stale" state must not be
  // clobbered by a mode-only update here.
  const live = document.getElementById("live");
  // "stale" is reserved for connectSSE's own onopen/onerror (the daemon
  // connection itself dropping) — never written here, and never overwritten
  // by this function, so the two states can't clobber each other.
  if (live && !live.classList.contains("stale")) {
    const ok = c.mode === "cloud-ok";
    const bad = c.mode === "offline";
    live.className = "live" + (ok ? "" : (bad ? " down" : " degraded"));
    live.textContent = ok ? "● live" : "● " + c.mode;
    live.title = ok
      ? "Connected — click to override connectivity"
      : "Connectivity: " + c.mode + (c.reason ? " — " + c.reason : "") + " — click to override";
  }
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
let _skFocusIdx = -1;    // keyboard-focused row index in current filtered list (-1 = none)
let _skItems = [];       // current filtered+sorted catalog slice (parallel to rendered rows)
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
    description: c.description || '', kind: c.kind, invokeName: c.invokeName, compat: c.compat, useCount: 0, raw: c,
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
function skIcon(it) {
  if (it.source === 'local') return it.kind === 'skill' ? '📁' : '⌨️';
  return it.kind === 'script' ? '⚙️' : '🧩';
}
function skCardAlert(it) {
  if (it.scan === 'block') return '<span class="sk-card-alert" title="scan blocked — do not run">⛔</span>';
  if (it.scan === 'warn') return '<span class="sk-card-alert" style="color:var(--warn)" title="scan: review">⚠</span>';
  if (it.trusted === false) return '<span class="sk-card-alert" style="color:var(--warn)" title="untrusted — approve before agents use it">⚠</span>';
  return '';
}
function skTypeLabel(it) {
  if (it.source === 'local') return it.kind === 'skill' ? 'folder' : 'cmd';
  return it.kind === 'script' ? 'ops' : 'skill';
}
function compatValues(it) {
  const raw = it && it.raw ? it.raw : it;
  const vals = raw && Array.isArray(raw.compat) ? raw.compat : [];
  return vals.length ? vals : ['all'];
}
function compatLabel(value) {
  if (value === 'claude') return 'Claude';
  if (value === 'codex') return 'ChatGPT';
  return 'All';
}
function compatSearchText(it) {
  return compatValues(it).map(v => v + ' ' + compatLabel(v)).join(' ');
}
function compatChips(it) {
  return compatValues(it).map(v => {
    const label = compatLabel(v);
    return '<span class="compat-chip" title="Runs on ' + esc(label) + '">' + esc(label) + '</span>';
  }).join('');
}
function renderSkillList() {
  const box = document.getElementById('skList');
  if (!box) return;
  const q = ((document.getElementById('skQuery') || {}).value || '').toLowerCase().trim();
  let items = skCatalog();
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    items = items.filter(it => {
      const hay = (it.name + ' ' + it.description + ' ' + (it.kind || '') + ' ' + compatSearchText(it)).toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }
  items.sort((x, y) => (y.useCount - x.useCount) || x.name.localeCompare(y.name));
  _skItems = items.slice(0, 60);
  if (_skFocusIdx >= _skItems.length) _skFocusIdx = -1;
  if (!_skItems.length) {
    box.innerHTML = '<div class="muted" style="font-size:11px;padding:8px">No skills or commands' + (q ? ' match.' : ' yet — use ＋ Add to import.') + '</div>';
    return;
  }
  box.innerHTML = _skItems.map((it, i) => {
    const k = it.key.replace(/'/g, '&#39;');
    const alert = (it.scan === 'block') ? '⛔' : (it.scan === 'warn' || it.trusted === false) ? '⚠' : '';
    const cls = 'sk-row' + (it.key === _skSel ? ' sel' : '') + (i === _skFocusIdx ? ' kbd-focus' : '');
    return '<div class="' + cls + '" data-idx="' + i + '" onclick="selectSkill(\'' + k + '\')" title="' + esc(it.description || it.name) + '">'
      + '<div class="sk-row-icon">' + skIcon(it) + '</div>'
      + '<div class="sk-row-body">'
      + '<div class="sk-row-name">' + esc(it.name) + '</div>'
      + (it.description ? '<div class="sk-row-desc sk-desc">' + esc(it.description) + '</div>' : '')
      + '</div>'
      + '<div class="sk-row-right">'
      + '<span class="sk-badge src">' + esc(skTypeLabel(it)) + '</span>'
      + compatChips(it)
      + (it.useCount > 0 ? '<span class="sk-badge">' + it.useCount + '×</span>' : '')
      + (alert ? '<span style="font-size:11px;margin-left:2px" title="' + (it.scan === 'block' ? 'scan blocked' : 'review before use') + '">' + alert + '</span>' : '')
      + '</div>'
      + '</div>';
  }).join('');
}
function selectSkill(key) {
  if (_skSel === key) { _closeSkillPanel(); return; }
  _skSel = key;
  renderSkillList();
  showSkillPanel(key);
}
function skSelected() { return skCatalog().find(it => it.key === _skSel) || null; }

function showSkillPanel(key) {
  const it = skCatalog().find(i => i.key === key);
  if (!it) return;
  state.selected = null;
  state.selectedSkillOrCommand = key;
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setFlashSessionMode(false);
  if (_taskFormInSession) _closeNewTaskPanel();
  renderBoard();
  const session = document.getElementById('session');
  if (!session) return;
  session.innerHTML = it.source === 'local' ? _localCmdPanelHtml(it) : _libSkillPanelHtml(it);
  if (it.source === 'local') populateCommandProjects(_cmdProjects);
}

function _closeSkillPanel() {
  state.selectedSkillOrCommand = null;
  _skSel = '';
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setFlashSessionMode(false);
  renderSkillList();
  renderSkillDetail();
  renderOverview();
}

function _libSkillPanelHtml(it) {
  const s = it.raw;
  const untrusted = s.trusted === false;
  const namedParams = (Array.isArray(s.params) && s.params.length) ? s.params : [];
  const paramFields = namedParams.map(p =>
    '<label class="flbl">' + esc(skParamLabel(p)) + '</label>'
    + '<input id="skParam_' + esc(p) + '" placeholder="' + esc(skParamLabel(p)) + '…" />'
  ).join('');
  const inputField = s.hasInput
    ? '<label class="flbl">Input</label>'
      + '<textarea id="skInput" placeholder="Freeform input for this skill…" style="resize:vertical"></textarea>'
    : '';
  const scanWarn = s.scan === 'block'
    ? '<div style="color:var(--err);font-size:12px;margin-bottom:8px">⛔ Scan blocked — do not run this skill.</div>'
    : s.scan === 'warn' ? '<div style="color:var(--warn);font-size:12px;margin-bottom:8px">⚠ Scan: review before running.</div>' : '';
  return '<div class="new-task-panel">'
    + '<button class="linklike ov-back" onclick="_closeSkillPanel()" title="Back to overview (Esc)">← Overview</button>'
    + '<h2>' + skIcon(it) + ' ' + esc(it.name) + '</h2>'
    + (it.description ? '<div class="sub">' + esc(it.description) + '</div>' : '')
    + '<div style="font-size:11px;color:var(--muted);margin:0 0 12px">' + libMetaLine(s) + '</div>'
    + scanWarn
    + '<div class="form open">'
    + (namedParams.length ? '<div class="sk-param-area">' + paramFields + '</div>' : '')
    + inputField
    + (!namedParams.length && !s.hasInput
        ? '<div class="muted" style="font-size:12px;margin-bottom:8px">No parameters required.</div>'
        : '')
    + '<div class="row" style="margin-top:12px">'
    + '<button class="cancel" onclick="_closeSkillPanel()">Cancel</button>'
    + '<button class="create" onclick="runSelectedSkill()">Run</button>'
    + '</div>'
    + '<div class="err" id="skRunStatus" style="margin-top:6px"></div>'
    + '</div>'
    + '<pre id="skViewPane" style="display:none;max-height:300px;overflow:auto;font-size:11px;background:var(--code-bg);color:var(--code-text);padding:8px;border-radius:6px;margin-top:12px;white-space:pre-wrap"></pre>'
    + '<div class="sk-more" style="margin-top:10px">'
    + '<button class="addbtn" onclick="viewSkill()" title="View the skill markdown">View</button>'
    + '<button class="addbtn" onclick="copySkill()" title="Copy the shareable skill markdown">Copy</button>'
    + '<select id="skPubScope" style="width:auto" title="Scope to publish to"><option value="personal">personal</option><option value="team" selected>team</option><option value="org">org</option><option value="public">public</option></select>'
    + '<button class="addbtn" onclick="publishSelected()" title="Sign &amp; publish to the chosen scope">Publish</button>'
    + (untrusted ? '<button class="addbtn" onclick="trustSelected()" title="Approve so agents may use it">Trust</button>' : '')
    + '<button class="addbtn" onclick="deleteSelected()" title="Delete this skill">🗑 Delete</button>'
    + '</div>'
    + '</div>';
}

function _localCmdPanelHtml(it) {
  const c = it.raw;
  return '<div class="new-task-panel">'
    + '<button class="linklike ov-back" onclick="_closeSkillPanel()" title="Back to overview (Esc)">← Overview</button>'
    + '<h2>' + skIcon(it) + ' ' + esc(it.name) + '</h2>'
    + (it.description ? '<div class="sub">' + esc(it.description) + '</div>' : '')
    + '<div style="font-size:11px;color:var(--muted);margin:0 0 12px">' + commandMetaChips(c) + '</div>'
    + '<div class="form open">'
    + _cmdOptionsHtml(c.options)
    + '<label class="flbl">' + (_hasOpts(c.options) ? 'Advanced (raw args — overrides picks)' : 'Arguments') + '</label>'
    + '<input id="cmdArgs" placeholder="' + (c.argumentHint ? esc(c.argumentHint) : 'Optional arguments') + '" />'
    + '<label class="flbl">Project</label>'
    + '<div id="cmd_project_wrapper" class="project-search">'
    + '<input id="cmd_project_search" type="text" placeholder="Search projects…" autocomplete="off" oninput="mpFilter(\'cmd\')" onfocus="mpOpen(\'cmd\')" onkeydown="mpKeydown(event,\'cmd\')" />'
    + '<div id="cmd_project_dropdown" class="project-dropdown hidden">'
    + '<div class="project-sort-row">'
    + '<span class="project-sort-btn active" data-sort="recent" onclick="mpSort(\'cmd\',\'recent\')">Most recent</span>'
    + '<span class="project-sort-btn" data-sort="name" onclick="mpSort(\'cmd\',\'name\')">Name A–Z</span>'
    + '</div>'
    + '<div id="cmd_project_list" class="project-list"></div>'
    + '<div id="cmd_project_empty" class="project-empty hidden">No projects found</div>'
    + '</div></div>'
    + '<div id="cmd_project_selected" class="project-selected" style="display:none"></div>'
    + '<button type="button" class="linklike custom-folder-toggle" onclick="mpToggleCustomFolder(\'cmd\')">Use another folder…</button>'
    + '<div id="cmd_custom_folder" class="custom-folder" style="display:none">'
    + '<input id="cmd_custom_path" placeholder="~/path/to/folder" onkeydown="if(event.key===\'Enter\'){event.preventDefault();mpUseCustomFolder(\'cmd\');}" />'
    + '<div class="row"><button class="create" onclick="mpUseCustomFolder(\'cmd\')">Use this folder</button><button class="cancel" onclick="mpToggleCustomFolder(\'cmd\')">Cancel</button></div>'
    + '<div class="err" id="cmd_custom_err"></div>'
    + '</div>'
    + '<input id="commandPath" type="hidden" value="" />'
    + '<div class="row" style="margin-top:12px">'
    + '<button class="cancel" onclick="_closeSkillPanel()">Cancel</button>'
    + '<button class="create" onclick="runSelectedCommand()">Run</button>'
    + '</div>'
    + '<div class="err" id="skRunStatus" style="margin-top:6px"></div>'
    + '</div>'
    + '<pre id="cmdViewPane" style="display:none;max-height:300px;overflow:auto;font-size:11px;background:var(--code-bg);color:var(--code-text);padding:8px;border-radius:6px;margin-top:12px;white-space:pre-wrap"></pre>'
    + '</div>';
}

function skQueryInput() { _skFocusIdx = -1; renderSkillList(); }
function skQueryKeydown(e) {
  const n = _skItems.length;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!n) return;
    _skFocusIdx = (_skFocusIdx < 0) ? 0 : Math.min(_skFocusIdx + 1, n - 1);
    renderSkillList(); skScrollFocused();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _skFocusIdx = Math.max(_skFocusIdx - 1, -1);
    renderSkillList(); skScrollFocused();
  } else if (e.key === 'Enter' && _skFocusIdx >= 0 && _skFocusIdx < n) {
    e.preventDefault();
    selectSkill(_skItems[_skFocusIdx].key);
  } else if (e.key === 'Escape') {
    _skSel = ''; _skFocusIdx = -1;
    renderSkillList(); renderSkillDetail();
  }
}
function skScrollFocused() {
  const box = document.getElementById('skList');
  const el = box && box.querySelector('.kbd-focus');
  if (el) el.scrollIntoView({ block: 'nearest' });
}
function renderSkillDetail() {
  // Detail is now shown in the session panel (showSkillPanel); keep the right-rail
  // slot permanently hidden so it never conflicts with session-panel element IDs.
  const d = document.getElementById('skDetail');
  if (d) { d.style.display = 'none'; d.innerHTML = ''; }
}
function libMetaLine(s) {
  const scan = s.scan === 'block' ? '<span style="color:var(--err)">⛔ scan: blocked (do not run)</span> · '
    : s.scan === 'warn' ? '<span style="color:var(--warn)">⚠ scan: review</span> · ' : '';
  const untrusted = s.trusted === false ? '<span style="color:var(--warn)">⚠ untrusted (review before agents use it)</span> · ' : '';
  const prov = s.scope ? '[' + esc(s.scope) + (s.signed ? ' ✓signed' : '') + '] ' : '';
  return scan + untrusted + prov
    + 'runs on: ' + compatChips({ raw: s })
    + (s.hasInput ? ' · takes input' : '');
}
function skParamLabel(name) {
  return name.replace(/_/g, ' ').replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
function libDetailHtml(it) {
  const s = it.raw;
  const untrusted = s.trusted === false;
  const params = (Array.isArray(s.params) && s.params.length) ? s.params : (s.hasInput ? ['input'] : []);
  const paramFields = params.map(p =>
    '<label class="flbl" style="margin:5px 0 2px">' + esc(skParamLabel(p)) + '</label>'
    + '<input id="skParam_' + esc(p) + '" placeholder="' + esc(skParamLabel(p)) + '…" />'
  ).join('');
  return '<div class="sk-dhead"><span class="sk-dhead-icon">' + skIcon(it) + '</span><b>' + esc(it.name) + '</b>' + skBadges(it) + '</div>'
    + '<div class="sk-dmeta">' + libMetaLine(s) + '</div>'
    + (paramFields ? '<div class="sk-param-area">' + paramFields + '</div>' : '')
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
  return '<div class="sk-dhead"><span class="sk-dhead-icon">' + skIcon(it) + '</span><b>' + esc(it.name) + '</b>' + skBadges(it) + '</div>'
    + '<div class="sk-dmeta">' + commandMetaChips(c) + '</div>'
    + _cmdOptionsHtml(c.options)
    + '<input id="cmdArgs" placeholder="' + (_hasOpts(c.options) ? 'Advanced (raw args — overrides picks)' : (c.argumentHint ? esc(c.argumentHint) : 'Optional arguments')) + '" />'
    + '<label class="flbl" style="margin:6px 0 2px">Project</label>'
    + '<div id="cmd_project_wrapper" class="project-search">'
    + '<input id="cmd_project_search" type="text" placeholder="Search projects…" autocomplete="off" oninput="mpFilter(\'cmd\')" onfocus="mpOpen(\'cmd\')" onkeydown="mpKeydown(event,\'cmd\')" />'
    + '<div id="cmd_project_dropdown" class="project-dropdown hidden">'
    + '<div class="project-sort-row">'
    + '<span class="project-sort-btn active" data-sort="recent" onclick="mpSort(\'cmd\',\'recent\')">Most recent</span>'
    + '<span class="project-sort-btn" data-sort="name" onclick="mpSort(\'cmd\',\'name\')">Name A–Z</span>'
    + '</div>'
    + '<div id="cmd_project_list" class="project-list"></div>'
    + '<div id="cmd_project_empty" class="project-empty hidden">No projects found</div>'
    + '</div></div>'
    + '<div id="cmd_project_selected" class="project-selected" style="display:none"></div>'
    + '<button type="button" class="linklike custom-folder-toggle" onclick="mpToggleCustomFolder(\'cmd\')">Use another folder…</button>'
    + '<div id="cmd_custom_folder" class="custom-folder" style="display:none">'
    + '<input id="cmd_custom_path" placeholder="~/path/to/folder" onkeydown="if(event.key===\'Enter\'){event.preventDefault();mpUseCustomFolder(\'cmd\');}" />'
    + '<div class="row"><button class="create" onclick="mpUseCustomFolder(\'cmd\')">Use this folder</button><button class="cancel" onclick="mpToggleCustomFolder(\'cmd\')">Cancel</button></div>'
    + '<div class="err" id="cmd_custom_err"></div>'
    + '</div>'
    + '<input id="commandPath" type="hidden" value="" />'
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
  const namedParams = (it.raw && Array.isArray(it.raw.params)) ? it.raw.params : [];
  const hasInput = !!(it.raw && it.raw.hasInput);
  const params = {};
  for (const p of namedParams) {
    const el = document.getElementById('skParam_' + p);
    params[p] = el ? el.value : '';
  }
  const inputEl = document.getElementById('skInput');
  const payload = {};
  if (namedParams.length) payload.params = params;
  if (hasInput) payload.input = inputEl ? inputEl.value : '';
  if (!namedParams.length && !hasInput) payload.input = '';
  const res = document.getElementById('skRunStatus') || document.getElementById('skStatus');
  if (res) res.textContent = 'Launching…';
  try {
    const d = await api('/skills/' + encodeURIComponent(it.name) + '/run',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
  const res = document.getElementById('skRunStatus') || document.getElementById('skStatus');
  for (let i = 0; i < 900; i++) { // up to ~15 min for long builds/releases
    try {
      const d = await api('/skills/runs/' + encodeURIComponent(runId));
      if (view && d) { view.textContent = d.log || ''; view.style.display = 'block'; view.scrollTop = view.scrollHeight; }
      if (d && d.status === 'done') { if (res) res.textContent = 'Script finished (exit ' + d.exitCode + ').'; return; }
    } catch (e) { /* transient */ }
    await new Promise(r => setTimeout(r, 1000));
  }
}
// --- Command options picker (new-task box) ---------------------------------
// Renders a command's structured options (from LocalCommand.options, resolved
// server-side from the options frontmatter or the argument-hint) as pickable
// controls, and assembles the chosen flags back into the args string the
// existing /commands/run consumes. The raw "Advanced" box always overrides.
function _hasOpts(spec){ return !!(spec && spec.source && spec.source !== 'none' && (((spec.options||[]).length) || ((spec.positionals||[]).length))); }
function _ea(s){ return esc(s).replace(/"/g, '&quot;'); }
function _q(v){ v = String(v); return /\\s/.test(v) ? '"' + v.replace(/"/g, '') + '"' : v; }
function _optChipHtml(o, inGroup){
  const title = o.description ? ' title="' + _ea(o.description) + '"' : '';
  const onclick = inGroup ? '_optPick(this)' : '_optToggle(this)';
  let chip = '<button type="button" class="opt-chip" data-flag="' + _ea(o.name) + '" data-kind="' + _ea(o.kind) + '"' + (o.group ? ' data-group="' + _ea(o.group) + '"' : '') + title + ' onclick="' + onclick + '" style="padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:inherit;cursor:pointer;font-size:12px">' + esc(o.name) + '</button>';
  if (o.kind === 'value') chip += '<input class="opt-val" data-for="' + _ea(o.name) + '" placeholder="' + _ea(o.valuePlaceholder || 'value') + '" style="display:none;width:120px;font-size:12px;margin-left:3px" />';
  else if (o.kind === 'choice') chip += '<select class="opt-choice" data-for="' + _ea(o.name) + '" style="display:none;font-size:12px;margin-left:3px">' + (o.choices||[]).map(function(x){ return '<option value="' + _ea(x) + '">' + esc(x) + '</option>'; }).join('') + '</select>';
  return (o.kind === 'value' || o.kind === 'choice') ? '<span class="opt-wrap" style="display:inline-flex;align-items:center">' + chip + '</span>' : chip;
}
function _cmdOptionsHtml(spec){
  if (!_hasOpts(spec)) return '';
  const groups = {}; const indep = [];
  (spec.options||[]).forEach(function(o){ if (o.group) { (groups[o.group] = groups[o.group] || []).push(o); } else indep.push(o); });
  let h = '<label class="flbl">Options</label>'
    + '<div style="font-size:10px;color:var(--muted);margin:-2px 0 4px">Click to include; segmented sets are pick-one. The Advanced box below overrides.</div>'
    + '<div id="cmdOptions" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">';
  Object.keys(groups).forEach(function(g){
    h += '<span class="opt-grp" data-group="' + _ea(g) + '" style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">';
    groups[g].forEach(function(o){ h += _optChipHtml(o, true); });
    h += '</span>';
  });
  indep.forEach(function(o){ h += _optChipHtml(o, false); });
  h += '</div>';
  if ((spec.positionals||[]).length){
    h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">';
    spec.positionals.forEach(function(p){
      const title = p.description ? ' title="' + _ea(p.description) + '"' : '';
      if (p.required) {
        // Required stays a plain, always-visible, mandatory input — can't be missed.
        h += '<input class="opt-pos" data-pos="' + _ea(p.name) + '" placeholder="' + _ea(p.name + ' (required)') + '"' + title + ' style="flex:1;min-width:130px;font-size:12px" />';
      } else {
        // Optional renders as a toggle pill (same visual language as flag/value/
        // choice opt-chips) that reveals its companion input only once activated.
        h += '<span class="opt-wrap" style="display:inline-flex;align-items:center">'
          + '<button type="button" class="opt-chip opt-pos-toggle" data-pos="' + _ea(p.name) + '" data-kind="pos"' + title + ' onclick="_optToggle(this)" style="padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:inherit;cursor:pointer;font-size:12px">' + esc(p.name) + '</button>'
          + '<input class="opt-pos-val" data-pos="' + _ea(p.name) + '" placeholder="' + _ea(p.name) + '" style="display:none;width:130px;font-size:12px;margin-left:3px" />'
          + '</span>';
      }
    });
    h += '</div>';
  }
  return h;
}
function _optSetActive(el, on){
  el.classList.toggle('active', on);
  el.style.background = on ? 'var(--accent)' : 'var(--panel)';
  el.style.color = on ? '#fff' : 'inherit';
  const kind = el.getAttribute('data-kind');
  if (kind === 'value' || kind === 'choice' || kind === 'pos'){
    const sib = el.parentNode.querySelector(kind === 'value' ? '.opt-val' : kind === 'choice' ? '.opt-choice' : '.opt-pos-val');
    if (sib){ sib.style.display = on ? '' : 'none'; if (on) { try { sib.focus(); } catch(e){} } }
  }
}
function _optToggle(el){ _optSetActive(el, !el.classList.contains('active')); }
function _optPick(el){
  const grp = el.getAttribute('data-group');
  const box = el.closest('.opt-grp') || document;
  box.querySelectorAll('.opt-chip[data-group="' + grp + '"]').forEach(function(x){ _optSetActive(x, x === el); });
}
function _assembleCmdArgs(){
  const raw = ((document.getElementById('cmdArgs') || {}).value || '').trim();
  if (raw) return raw;
  const parts = [];
  document.querySelectorAll('.opt-pos').forEach(function(inp){ const v = (inp.value||'').trim(); if (v) parts.push(_q(v)); });
  document.querySelectorAll('.opt-pos-toggle.active').forEach(function(chip){ const sib = chip.parentNode.querySelector('.opt-pos-val'); const v = sib && sib.value ? sib.value.trim() : ''; if (v) parts.push(_q(v)); });
  const box = document.getElementById('cmdOptions');
  if (box) box.querySelectorAll('.opt-chip.active').forEach(function(chip){
    const flag = chip.getAttribute('data-flag'); const kind = chip.getAttribute('data-kind');
    if (kind === 'flag') parts.push(flag);
    else if (kind === 'value'){ const inp = chip.parentNode.querySelector('.opt-val'); const v = inp && inp.value ? inp.value.trim() : ''; parts.push(v ? flag + ' ' + _q(v) : flag); }
    else if (kind === 'choice'){ const sel = chip.parentNode.querySelector('.opt-choice'); parts.push(sel && sel.value ? flag + ' ' + _q(sel.value) : flag); }
  });
  return parts.join(' ');
}
async function runSelectedCommand() {
  const it = skSelected(); if (!it || it.source !== 'local') return;
  const c = it.raw;
  const args = _assembleCmdArgs();
  const projectPath = ((document.getElementById('commandPath') || {}).value || '$HOME').trim() || '$HOME';
  const cmdProject = _mpS('cmd');
  const projectName = (cmdProject.name || '').trim();
  const res = document.getElementById('skRunStatus') || document.getElementById('skStatus');
  if (res) res.textContent = 'Launching /' + c.invokeName + '…';
  try {
    const payload = { name: c.invokeName, args: args, projectPath: projectPath };
    if (projectName) payload.project = projectName;
    const d = await api('/commands/run',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (d && d.task) {
      if (res) res.textContent = 'Launched /' + c.invokeName + ' — see the board.';
      refresh();
    } else if (res) { res.textContent = (d && d.error) || 'Launched.'; }
  } catch (e) { if (res) res.textContent = 'Error launching command.'; }
}
function inspectCommand() {
  const it = skSelected(); if (!it || it.source !== 'local') return;
  const c = it.raw;
  const view = document.getElementById('cmdViewPane');
  if (!view) return;
  view.textContent = 'invoke: /' + c.invokeName + '\nkind: ' + c.kind
    + '\ncatalog: local profile catalog'
    + '\nruns on: ' + compatValues({ raw: c }).map(compatLabel).join(", ")
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
  return compatChips({ raw: c }) + chips.map(([cls, text]) => '<span class="command-chip' + (cls ? ' ' + cls : '')
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
      const dotCls = s.status === 'reachable' ? 'on' : (s.status === 'unreachable' ? 'err' : 'off');
      return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0">'
        + '<span class="tools-dot ' + dotCls + '" title="' + esc(s.detail || s.status) + '"></span>'
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

function renderSchedTimeline(sorted) {
  const windowHours = state.tlWindow || 24;
  const windowMs = windowHours * 3600000;
  const now = Date.now();
  const inWindow = sorted.filter(d => {
    if (!d.nextRunAt) return false;
    const t = new Date(d.nextRunAt).valueOf();
    return t >= now - 3600000 && t <= now + windowMs;
  });
  const winBtns = [6, 24, 72].map(h =>
    '<button class="tl-window-btn' + (state.tlWindow === h ? ' active' : '')
    + '" onclick="setTlWindow(' + h + ')">' + (h < 24 ? h + 'h' : h === 24 ? '1d' : '3d') + '</button>'
  ).join(' ');
  const tickInterval = windowHours <= 6 ? 1 : windowHours <= 24 ? 4 : 12;
  let ticks = '';
  for (let h = tickInterval; h < windowHours; h += tickInterval) {
    const pct = (h / windowHours) * 100;
    const lbl = new Date(now + h * 3600000).toLocaleTimeString([], { hour: 'numeric' });
    ticks += '<div class="tl-tick" style="left:' + pct.toFixed(1) + '%"></div>'
           + '<div class="tl-tick-lbl" style="left:' + pct.toFixed(1) + '%">' + esc(lbl) + '</div>';
  }
  const dots = inWindow.map(d => {
    const t = new Date(d.nextRunAt).valueOf();
    const pct = Math.max(1, Math.min(97, ((t - now) / windowMs) * 100));
    const until = timeUntil(d.nextRunAt);
    const dotCls = (until && until.ms < 0) ? 'status-overdue'
      : (until && until.ms < 3600000) ? 'status-soon'
      : 'status-' + d.status;
    return '<div class="tl-dot ' + dotCls + '" style="left:' + pct.toFixed(1) + '%"'
      + ' title="' + esc(d.goal + ' · ' + (until ? until.label : '')) + '"></div>';
  }).join('');
  return '<div class="tl-wrap">'
    + '<div class="tl-header">'
    + '<span style="color:var(--ok);font-weight:600;font-size:10px">▸ now</span>'
    + '<div style="display:flex;gap:4px">' + winBtns + '</div>'
    + '<span>+' + windowHours + 'h</span></div>'
    + '<div class="tl-track">'
    + '<div class="tl-now-line" style="left:0.5%"></div>'
    + ticks + dots
    + '</div>'
    + (inWindow.length === 0 ? '<div class="muted" style="font-size:11px;margin-top:18px">Nothing scheduled in this window.</div>' : '')
    + '</div>';
}

function renderSchedList(sorted) {
  const now = Date.now();
  const groups = [
    { key: 'overdue', label: 'Overdue',           items: [] },
    { key: 'soon',    label: 'Next 1 hour',        items: [] },
    { key: 'today',   label: 'Today',              items: [] },
    { key: 'week',    label: 'This week',          items: [] },
    { key: 'later',   label: 'Later',              items: [] },
    { key: 'manual',  label: 'Manual / on demand', items: [] }
  ];
  for (const d of sorted) {
    if (!d.nextRunAt) { groups[5].items.push(d); continue; }
    const ms = new Date(d.nextRunAt).valueOf() - now;
    if (ms < 0) groups[0].items.push(d);
    else if (ms < 3600000) groups[1].items.push(d);
    else if (ms < 86400000) groups[2].items.push(d);
    else if (ms < 604800000) groups[3].items.push(d);
    else groups[4].items.push(d);
  }
  let html = '';
  for (const g of groups) {
    if (!g.items.length) continue;
    html += '<div class="dir-group-hdr">' + esc(g.label) + '</div>';
    html += g.items.map(d => {
      const until = d.nextRunAt ? timeUntil(d.nextRunAt) : null;
      const ctd = until ? ' <span class="countdown ' + esc(until.cls) + '">' + esc(until.label) + '</span>' : '';
      const timeStr = d.nextRunAt
        ? ' · <span style="font-size:10px;color:var(--muted)" title="' + esc(d.nextRunAt) + '">'
          + esc(new Date(d.nextRunAt).toLocaleTimeString()) + '</span>'
        : '';
      return '<div class="directive">'
        + '<div class="g"><span class="dot ' + d.status + '"></span>' + esc(d.goal) + '</div>'
        + '<div class="s">' + esc(d.status) + timeStr + ctd
        + '<span class="directive-actions">'
        + '<button class="sm" onclick="editDirective(\'' + d._id + '\')">Edit</button>'
        + '<button class="sm err" onclick="deleteDirective(\'' + d._id + '\')">Delete</button>'
        + '</span></div></div>';
    }).join('');
  }
  return html;
}

function renderDirectives() {
  const el = document.getElementById("directives");
  if (!state.directives.length) { el.innerHTML = '<div class="muted">None.</div>'; return; }
  const view = state.schedView || 'timeline';
  const sorted = state.directives.slice().sort((a, b) => {
    if (!a.nextRunAt && !b.nextRunAt) return 0;
    if (!a.nextRunAt) return 1;
    if (!b.nextRunAt) return -1;
    return new Date(a.nextRunAt).valueOf() - new Date(b.nextRunAt).valueOf();
  });
  const viewBtns = '<div class="sch-view-btns">'
    + '<button class="sch-view-btn' + (view === 'timeline' ? ' active' : '') + '" onclick="setSchedView(\'timeline\')" title="Visual timeline">⊶ Timeline</button>'
    + '<button class="sch-view-btn' + (view === 'list' ? ' active' : '') + '" onclick="setSchedView(\'list\')" title="Flat list">☰ List</button>'
    + '</div>';
  let html = viewBtns;
  if (view === 'timeline') html += renderSchedTimeline(sorted);
  html += renderSchedList(sorted);
  el.innerHTML = html;
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
    // drop it off the rail entirely. It still lives on under Settings → Setup.
    sec.style.display = o.requiredComplete ? "none" : "";
  }
  const abSetup = document.getElementById("ab_setup");
  if (abSetup) {
    const remaining = o.steps.filter(s => s.required && s.state !== "done").length;
    abSetup.textContent = o.requiredComplete
      ? "✓ Required setup complete. Review or rerun setup from Settings → Setup."
      : remaining + " required step" + (remaining === 1 ? "" : "s") + " remaining — open Settings → Setup.";
  }
  renderSettingsSetup();
  // Auto-open the wizard on first run (only once per session, respects dismiss)
  _obMaybeAutoOpen(o);
}

function renderSettingsSetup() {
  const summary = document.getElementById("settings_setup_summary");
  const reqEl = document.getElementById("settings_setup_required");
  const optEl = document.getElementById("settings_setup_optional");
  if (!summary || !reqEl || !optEl) return;
  const o = state.onboarding;
  if (!o || !Array.isArray(o.steps)) {
    summary.textContent = "Setup status is loading.";
    reqEl.innerHTML = '<div class="muted" style="font-size:12px">Loading…</div>';
    optEl.innerHTML = '<div class="muted" style="font-size:12px">Loading…</div>';
    return;
  }
  const remaining = o.steps.filter(s => s.required && s.state !== "done").length;
  summary.textContent = o.requiredComplete
    ? "Required setup complete. You can reopen the wizard anytime."
    : remaining + " required step" + (remaining === 1 ? "" : "s") + " remaining.";
  const row = s => {
    const done = s.state === "done";
    const mark = done ? "✓" : "○";
    const color = done ? "var(--ok)" : (s.required ? "var(--err)" : "var(--muted)");
    const action = done ? "" : '<button class="copybtn" onclick="wizardAction(\'' + esc(s.id) + '\')">Set up</button>';
    return '<div class="card" style="cursor:default;margin-bottom:6px">'
      + '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">'
      + '<div><div style="font-weight:600;color:' + color + '">' + mark + ' ' + esc(s.title) + '</div>'
      + '<div class="muted" style="font-size:11px;margin-top:2px">' + esc(s.detail || s.remediation || '') + '</div></div>'
      + action + '</div></div>';
  };
  const required = o.steps.filter(s => s.required);
  const optional = o.steps.filter(s => !s.required);
  reqEl.innerHTML = required.length ? required.map(row).join("") : '<div class="muted" style="font-size:12px">No required setup steps.</div>';
  optEl.innerHTML = optional.length ? optional.map(row).join("") : '<div class="muted" style="font-size:12px">No optional setup steps.</div>';
}

// Side rails are width-adjustable: drag the divider on a rail's inner edge.
// Apply any saved widths immediately (the script runs after <main> is parsed)
// so there's no flash from the default width on reload.
(function applyColWidths() {
  try {
    const m = document.querySelector('main');
    if (!m) return;
    const l = parseInt(localStorage.getItem('hm_col_left') || '', 10);
    const r = parseInt(localStorage.getItem('hm_col_right') || '', 10);
    if (l >= 180) m.style.setProperty('--col-left', l + 'px');
    if (r >= 180) m.style.setProperty('--col-right', r + 'px');
  } catch (e) { /* ignore */ }
})();

function initColResizers() {
  const main = document.querySelector('main');
  if (!main) return;
  const MIN = 180, CENTER_MIN = 240;
  function widthOf(varName, fallback) {
    const v = parseFloat(getComputedStyle(main).getPropertyValue(varName));
    return isNaN(v) ? fallback : v;
  }
  function startDrag(side, ev) {
    ev.preventDefault();
    const handle = ev.currentTarget;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const rect = main.getBoundingClientRect();
    function clientX(e) { return (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX; }
    function onMove(e) {
      const x = clientX(e);
      if (side === 'left') {
        const other = main.classList.contains('ctx-collapsed') ? 0 : widthOf('--col-right', 320);
        const max = rect.width - other - CENTER_MIN;
        const w = Math.max(MIN, Math.min(x - rect.left, max));
        main.style.setProperty('--col-left', Math.round(w) + 'px');
      } else {
        const other = widthOf('--col-left', 300);
        const max = rect.width - other - CENTER_MIN;
        const w = Math.max(MIN, Math.min(rect.right - x, max));
        main.style.setProperty('--col-right', Math.round(w) + 'px');
      }
    }
    function onUp() {
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      try {
        localStorage.setItem('hm_col_left', String(Math.round(widthOf('--col-left', 300))));
        localStorage.setItem('hm_col_right', String(Math.round(widthOf('--col-right', 320))));
      } catch (e) { /* ignore */ }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }
  const lh = document.getElementById('resizeLeft');
  const rh = document.getElementById('resizeRight');
  if (lh) {
    lh.addEventListener('mousedown', (e) => startDrag('left', e));
    lh.addEventListener('touchstart', (e) => startDrag('left', e), { passive: false });
  }
  if (rh) {
    rh.addEventListener('mousedown', (e) => startDrag('right', e));
    rh.addEventListener('touchstart', (e) => startDrag('right', e), { passive: false });
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
    if (id === 'codex-cli') {
      openObWizard();
      _obStep = 1;
      _obRenderStep();
      const detail = document.getElementById('ob_codex_detail');
      if (detail) detail.classList.add('open');
      return;
    }
    if (id === 'canopy') {
      await hmAlert(
        'Canopy is the MCP terminal that replaced HiveMatrix\'s Terminal Lane.\n\n' +
        '• Not installed — install the Canopy app, then reopen this step.\n' +
        '• Installed but not registered — open Canopy → Settings → About → "Set Up Claude Code Access" to register it.\n\n' +
        'This card reflects whether Canopy is present in /Applications and registered in ~/.claude.json. One-click registration from HiveMatrix is coming next.',
        'Canopy (MCP terminal)'
      );
      return;
    }
    if (id === 'persona') { await runPersonaBirthRitual(); return; }
    if (id === 'telemetry') {
      const choice = await hmConfirm(
        'Send anonymous usage stats?\n\nOnly aggregate feature counters (never file contents or event payloads) are sent once a day to a first-party endpoint. Default is off.\n\nYou can change this anytime in Settings > General.',
        { okLabel: 'Yes, opt in', cancelLabel: 'No thanks' }
      );
      await api('/onboarding/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !!choice }) });
      await refresh();
      return;
    }
    let body = {};
    if (id === 'config') {
      body = { config: {} };
    } else if (id === 'brain') {
      const d = await hmPrompt('Canonical brain folder (the one store every model reads):', '~/_GD/brain');
      if (!d) return;
      const sc = await hmConfirm('Also create a ~/brain shortcut pointing at it?', { okLabel: 'Yes' });
      body = { brainRootDir: d, createIfMissing: true, makeShortcut: sc };
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

// ── Onboarding wizard: permissions → models → brain ──────────────────────────

let _obStep = 0;
let _obPollTimer = null;
let _obAutoOpened = false;

function openObWizard() {
  _obStep = 0;
  document.getElementById('obWizardOverlay').classList.add('open');
  _obRenderStep();
  clearInterval(_obPollTimer);
  _obPollTimer = setInterval(_obPollPerms, 3000);
}

function closeObWizard(skip) {
  clearInterval(_obPollTimer);
  _obPollTimer = null;
  document.getElementById('obWizardOverlay').classList.remove('open');
  try { localStorage.setItem('hm_ob_wizard_dismissed', '1'); } catch(e) {}
  if (!skip) refresh();
}

function _obRenderStep() {
  for (let i = 0; i < 3; i++) {
    const seg = document.getElementById('obProg' + i);
    if (seg) seg.className = 'ob-prog-seg' + (i < _obStep ? ' done' : i === _obStep ? ' active' : '');
    const panel = document.getElementById('obStep' + i);
    if (panel) panel.classList.toggle('active', i === _obStep);
  }
  const back = document.getElementById('obBackBtn');
  if (back) back.style.display = _obStep === 0 ? 'none' : '';
  const next = document.getElementById('obNextBtn');
  if (next) next.textContent = _obStep === 2 ? '✓ Finish' : 'Next →';
  if (_obStep === 0) _obPollPerms();
  if (_obStep === 1) obDetectModels();
  if (_obStep === 2) _obInitBrain();
}

function obNext() {
  if (_obStep < 2) { _obStep++; _obRenderStep(); }
  else closeObWizard(false);
}

function obBack() {
  if (_obStep > 0) { _obStep--; _obRenderStep(); }
}

// ── Step 0: permissions ───────────────────────────────────────────────────────

async function obOpenPerm(pane) {
  await openSystemPane(pane);
  setTimeout(_obPollPerms, 800);
}

async function obOpenPerms(panes) {
  for (const p of panes) await openSystemPane(p);
  setTimeout(_obPollPerms, 800);
}

function _obSetupItem(setup, section, id) {
  const items = setup && setup[section];
  return Array.isArray(items) ? (items.find(item => item && item.id === id) || null) : null;
}

function _obSetupStateReady(item) {
  return !!item && (item.state === 'granted' || item.state === 'ready' || item.state === 'configured');
}

function _obSetDetail(id, item, fallback) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = (item && item.detail) || fallback || '';
}

function _obRenderSetupPerms(setup) {
  const fda = _obSetupItem(setup, 'permissions', 'fullDiskAccess');
  const desktop = _obSetupItem(setup, 'permissions', 'desktopControl');
  const mail = _obSetupItem(setup, 'permissions', 'mailAutomation');
  const mic = _obSetupItem(setup, 'permissions', 'microphone');
  _obSetPermMark('ob_perm_fda', _obSetupStateReady(fda));
  _obSetPermMark('ob_perm_acc', _obSetupStateReady(desktop));
  _obSetPermMark('ob_perm_auto', _obSetupStateReady(mail));
  _obSetDetail('ob_perm_fda_detail', fda, 'Lets HiveMatrix read your Messages database (chat.db) and Mail folder.');
  _obSetDetail('ob_perm_acc_detail', desktop, 'Required for Desktop Lane — lets HiveMatrix see the screen and click UI elements.');
  _obSetDetail('ob_perm_auto_detail', mail, 'Lets HiveMatrix draft and send email via Apple Mail.');
  _obSetDetail('ob_perm_mic_detail', mic, 'Required for voice input (Talk mode).');
  // Microphone is intentionally local-only: opening Settings is useful, but it
  // is not proof macOS has granted capture access.
  try { _obSetPermMark('ob_perm_mic', localStorage.getItem('hm_ob_mic_opened') === '1'); } catch(e) {}
}

async function obProbeFullDiskAccess() {
  try {
    const setup = await api('/onboarding/setup/full-disk-access/probe', { method: 'POST' });
    _obRenderSetupPerms(setup);
    const fda = _obSetupItem(setup, 'permissions', 'fullDiskAccess');
    if (!_obSetupStateReady(fda)) await openSystemPane('fullDiskAccess');
  } catch(e) { await hmAlert('Full Disk Access check failed: ' + e, 'Setup'); }
}

async function obRequestDesktopPerms() {
  try {
    const setup = await api('/onboarding/setup/desktop-permissions/request', { method: 'POST' });
    _obRenderSetupPerms(setup);
  } catch(e) { await hmAlert('Desktop permission request failed: ' + e, 'Setup'); }
}

let _obMailRetryTimer = null;
let _obMailRetryElapsedMs = 0;
async function obProbeMailAutomation() {
  clearTimeout(_obMailRetryTimer); _obMailRetryTimer = null; _obMailRetryElapsedMs = 0;
  try {
    const setup = await api('/onboarding/setup/mail-automation/probe', { method: 'POST' });
    _obRenderSetupPerms(setup);
    const mail = _obSetupItem(setup, 'permissions', 'mailAutomation');
    if (!_obSetupStateReady(mail)) {
      await openSystemPane('automation');
      // Poll the same probe (fires the AppleEvent again) until the "HiveMatrix
      // wants to control Mail" prompt is answered, so the wizard flips to
      // Granted on its own instead of leaving the user to re-click.
      obRetryMailAutomationProbe();
    }
  } catch(e) { await hmAlert('Mail Automation check failed: ' + e, 'Setup'); }
}

async function obRetryMailAutomationProbe() {
  clearTimeout(_obMailRetryTimer); _obMailRetryTimer = null;
  async function tick() {
    let setup = null;
    try { setup = await api('/onboarding/setup/mail-automation/probe', { method: 'POST' }); } catch (e) { /* transient — keep retrying */ }
    if (setup) _obRenderSetupPerms(setup);
    const mail = setup ? _obSetupItem(setup, 'permissions', 'mailAutomation') : null;
    if (mail && _obSetupStateReady(mail)) { _obMailRetryElapsedMs = 0; return; }
    _obMailRetryElapsedMs += 2000;
    if (_obMailRetryElapsedMs >= 30000) { _obMailRetryElapsedMs = 0; return; }
    _obMailRetryTimer = setTimeout(tick, 2000);
  }
  await tick();
}

// Microphone can't be probed from the daemon without Swift; mark it as opened
// after the user clicks so the wizard shows something useful.
async function obOpenPermMic() {
  await openSystemPane('microphone');
  try { localStorage.setItem('hm_ob_mic_opened', '1'); } catch(e) {}
  _obSetPermMark('ob_perm_mic', true);
}

function _obSetPermMark(id, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = ok ? '✓' : '○';
  el.className = 'ob-pm ' + (ok ? 'ok' : 'no');
  const granted = document.getElementById(id + '_granted');
  if (granted) granted.style.display = ok ? '' : 'none';
  const open = document.getElementById(id + '_open');
  if (open) open.style.display = ok ? 'none' : '';
}

async function _obPollPerms() {
  try {
    // Probe chat.db (Full Disk Access) actively while the user is on the
    // permissions step. FDA is a SILENT gate — a read-only chat.db open never
    // triggers a TCC prompt (unlike Mail's AppleEvents) — so the passive GET's
    // "no chat.db probe while Message Lane is disabled" rule left users who had
    // ALREADY granted access stuck on a perpetual "not checked". This endpoint
    // forces only the chat.db probe; Mail stays passive (no Mail.app launch).
    const setup = await api('/onboarding/setup/full-disk-access/probe', { method: 'POST' });
    _obRenderSetupPerms(setup);
  } catch(e) { /* polling — ignore transient errors */ }
}

// ── Step 1: model backends ────────────────────────────────────────────────────

async function obDetectModels() {
  const statusEl = document.getElementById('ob_models_status');
  if (statusEl) { statusEl.textContent = 'Detecting…'; statusEl.className = 'ob-any-status'; }
  try {
    const providersResp = await api('/providers').catch(() => null);
    const providers = (providersResp && providersResp.providers) || [];
    const hasClaude = !!(providers.find(p => p.id === 'claude') || {}).installed;
    const hasCodex  = !!(providers.find(p => p.id === 'codex') || {}).installed;
    _obSetModelCard('ob_model_claude', 'ob_claude_mark', 'ob_claude_status', hasClaude,
      hasClaude ? 'Detected — ready to use' : 'Not found on this Mac');
    _obSetModelCard('ob_model_codex',  'ob_codex_mark',  'ob_codex_status',  hasCodex,
      hasCodex  ? 'Detected — ready to use' : 'Not found on this Mac');
    const any = hasClaude || hasCodex;
    if (statusEl) {
      statusEl.textContent = any ? '✓ At least one model backend ready.' : 'No model backends found yet — set up at least one below.';
      statusEl.className = 'ob-any-status' + (any ? ' ok' : ' warn');
    }
  } catch(e) {
    if (statusEl) { statusEl.textContent = 'Detection error: ' + e; statusEl.className = 'ob-any-status warn'; }
  }
}

function _obSetModelCard(cardId, markId, statusId, detected, statusText) {
  const card = document.getElementById(cardId);
  if (card) card.classList.toggle('detected', !!detected);
  const mark = document.getElementById(markId);
  if (mark) { mark.textContent = detected ? '✓' : '—'; mark.className = 'ob-model-mark ' + (detected ? 'ok' : 'no'); }
  const status = document.getElementById(statusId);
  if (status) { status.textContent = statusText; status.className = 'ob-model-status' + (detected ? ' ok' : ''); }
}

function obToggleDetail(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// ── Step 2: brain location ────────────────────────────────────────────────────

function _obInitBrain() {
  const input = document.getElementById('ob_brain_path');
  _obRenderPersonaSetup();
  if (!input || input.value) return; // don't overwrite if the user already typed
  const o = state.onboarding;
  const brainStep = o && o.steps && o.steps.find(s => s.id === 'brain');
  const existing = brainStep && brainStep.state === 'done'
    ? brainStep.detail.replace(/^brain root: /, '') : '';
  // Default to ~/HiveMatrix Brain for new users; existing path for migrations
  input.value = existing || '~/HiveMatrix Brain';
  _obUpdateBrainPreview();
}

async function _obRenderPersonaSetup() {
  const mark = document.getElementById('ob_persona_mark');
  const status = document.getElementById('ob_persona_status');
  const btn = document.getElementById('ob_birth_ritual');
  try {
    const setup = await api('/onboarding/setup');
    const persona = _obSetupItem(setup, 'memory', 'persona');
    const ready = _obSetupStateReady(persona);
    if (mark) { mark.textContent = ready ? '✓' : '—'; mark.className = 'ob-model-mark ' + (ready ? 'ok' : 'no'); }
    if (status) { status.textContent = (persona && persona.detail) || 'Personality has not been created yet.'; status.className = 'ob-model-status' + (ready ? ' ok' : ''); }
    if (btn) btn.style.display = ready ? 'none' : '';
  } catch(e) {
    if (status) status.textContent = 'Personality status unavailable.';
  }
}

// Settings → Setup "Persona" card entry point. The legacy obRunBirthRitual() below
// targets the old wizard's DOM ids, which don't exist on the Setup card, so this
// variant streams the same endpoint and reports progress via toasts instead.
async function runPersonaBirthRitual() {
  const ok = await hmConfirm(
    'Run the birth ritual?\n\nClaude will choose a name, an emoji sigil, and an identity, then write SOUL.md, IDENTITY.md and USER.md into your brain\'s persona folder. This can take a minute.',
    { okLabel: 'Run it' }
  );
  if (!ok) return;
  hmToast('Birth ritual started…');
  try {
    const res = await fetch('/onboarding/birth-ritual', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + HM_TOKEN },
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) {
      const j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.error || j.detail || ('HTTP ' + res.status));
      hmToast(j.reason || 'Persona already exists.');
      await refresh();
      return;
    }
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', name = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        let evt = '', dataStr = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) evt = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
        }
        if (evt === 'done' && dataStr) { try { name = JSON.parse(dataStr).personaName || ''; } catch(e) { /* ignore */ } }
      }
    }
    hmToast(name ? ('✓ ' + name + ' is born') : '✓ Birth ritual complete', 'ok');
    await refresh();
  } catch(e) {
    await hmAlert('Birth ritual failed: ' + e, 'Persona');
  }
}

async function obRunBirthRitual() {
  const btn = document.getElementById('ob_birth_ritual');
  const log = document.getElementById('ob_birth_log');
  if (btn) btn.disabled = true;
  if (log) log.textContent = 'Starting birth ritual…';
  try {
    const res = await fetch('/onboarding/birth-ritual', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + HM_TOKEN },
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) {
      const j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.error || j.detail || ('HTTP ' + res.status));
      if (log) log.textContent = j.reason || 'Personality already exists.';
      await _obRenderPersonaSetup();
      return;
    }
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', acc = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        let evt = '', dataStr = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) evt = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
        }
        if (!evt || !dataStr) continue;
        let d; try { d = JSON.parse(dataStr); } catch(e) { continue; }
        if (evt === 'token') acc += d.delta || '';
        else if (evt === 'done') acc = (d.personaName ? '✓ ' + d.personaName + '\n\n' : '✓ Birth ritual complete.\n\n') + (d.fullText || acc);
        if (log) log.textContent = acc || 'Birth ritual running…';
      }
    }
    await _obRenderPersonaSetup();
  } catch(e) {
    if (log) log.textContent = 'Birth ritual failed: ' + e;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function obBrainInputChange() { _obUpdateBrainPreview(); }

function _obUpdateBrainPreview() {
  const input   = document.getElementById('ob_brain_path');
  const preview = document.getElementById('ob_brain_preview');
  if (!preview || !input) return;
  const val = (input.value || '').trim();
  if (!val) { preview.textContent = ''; preview.className = 'ob-brain-preview'; return; }
  const o = state.onboarding;
  const brainStep = o && o.steps && o.steps.find(s => s.id === 'brain');
  const currentBrain = brainStep && brainStep.state === 'done'
    ? brainStep.detail.replace(/^brain root: /, '') : null;
  if (currentBrain && currentBrain === val) {
    preview.textContent = '✓ Already set to this path';
    preview.className = 'ob-brain-preview ok';
  } else if (currentBrain) {
    preview.textContent = 'Will move brain from ' + currentBrain;
    preview.className = 'ob-brain-preview warn';
  } else {
    preview.textContent = 'Will be created if it doesn\'t exist';
    preview.className = 'ob-brain-preview';
  }
}

async function obSetBrain() {
  const path = ((document.getElementById('ob_brain_path') || {}).value || '').trim();
  if (!path) { document.getElementById('ob_brain_err').textContent = 'Path is required.'; return; }
  const statusEl = document.getElementById('ob_brain_status');
  const errEl    = document.getElementById('ob_brain_err');
  if (statusEl) statusEl.textContent = 'Setting…';
  if (errEl) errEl.textContent = '';
  try {
    const r = await api('/onboarding/brain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brainRootDir: path, createIfMissing: true, makeShortcut: false }),
    });
    if (r && r.ok) {
      if (statusEl) statusEl.textContent = '✓ Brain folder set: ' + path;
      state.onboarding = await api('/onboarding');
      renderOnboarding();
      _obUpdateBrainPreview();
    } else {
      if (errEl) errEl.textContent = (r && r.detail) || 'Failed to set brain path.';
      if (statusEl) statusEl.textContent = '';
    }
  } catch(e) {
    if (errEl) errEl.textContent = String(e);
    if (statusEl) statusEl.textContent = '';
  }
}

// ── Auto-open on first run ────────────────────────────────────────────────────

function _obMaybeAutoOpen(onboarding) {
  if (_obAutoOpened) return;
  try { if (localStorage.getItem('hm_ob_wizard_dismissed')) return; } catch(e) {}
  if (!onboarding || onboarding.requiredComplete) return;
  _obAutoOpened = true;
  openObWizard();
}

// --- Message Lane guided setup ---------------------------------------------
function mbStep() { return (state.onboarding && state.onboarding.steps || []).find(s => s.id === 'messagebee'); }
async function openMessageBeeSetup() {
  document.getElementById('mb_err').textContent = '';
  document.getElementById('mb_status').textContent = '';
  document.getElementById('mb_phone').value = '';
  document.getElementById('mb_self_input').value = '';
  renderMessageBeeState(null);
  renderIgnoredSenders();
  document.getElementById('mbOverlay').classList.add('open');
  setTimeout(() => document.getElementById('mb_phone').focus(), 30);
  try {
    const r = await api('/messagebee/probe', { method: 'POST' });
    if (r) renderMessageBeeState(r);
  } catch (e) { /* modal can still show onboarding-derived fallback */ }
}
// Show non-allowlisted senders that have texted, each with one-click Allow/Disallow —
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
        + '<button onclick="allowIgnored(\'' + mbJsArg(i.address) + '\')">Allow</button>'
        + '<button class="secondary" onclick="blockIgnored(\'' + mbJsArg(i.address) + '\')">Disallow</button></div>').join('');
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
async function blockIgnored(address) {
  try {
    await api('/messagebee/identities', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, status: 'blocked' }),
    });
    await renderIgnoredSenders();
    const r = await api('/messagebee/probe', { method: 'POST' });
    if (r) renderMessageBeeState(r);
    document.getElementById('mb_status').textContent = 'Disallowed ' + address + ' — future texts from it will stay hidden.';
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
// The daemon that reads chat.db is a separate, separately-signed launchd
// process from the HiveMatrix app — toggling HiveMatrix's own Full Disk
// Access entry does not cover it. These two actions close that gap: reveal
// the daemon's real binary so it can be dragged into the FDA "+" picker, and
// restart the daemon so a freshly granted entry takes effect.
async function revealMessageBeeDaemon() {
  try {
    const r = await api('/messagebee/reveal-daemon', { method: 'POST' });
    if (!r || r.ok === false) {
      await hmAlert('Could not reveal the daemon binary: ' + ((r && r.error) || 'unknown error'), 'Reveal Daemon Binary');
      return;
    }
    await hmAlert('Finder opened to the daemon binary (' + r.path + '). Drag it into System Settings → Privacy & Security → Full Disk Access, then click "Restart daemon".', 'Reveal Daemon Binary');
  } catch (e) { await hmAlert('Could not reveal the daemon binary: ' + e, 'Reveal Daemon Binary'); }
}
async function restartMessageBeeDaemon() {
  const status = document.getElementById('mb_status');
  if (status) status.textContent = 'Restarting daemon…';
  try {
    const r = await api('/messagebee/restart-daemon', { method: 'POST' });
    if (!r || r.ok === false) {
      if (status) status.textContent = '';
      await hmAlert('Could not restart the daemon: ' + ((r && r.error) || 'unknown error'), 'Restart Daemon');
      return;
    }
    if (status) status.textContent = 'Daemon restarting — re-checking access…';
    // Give launchctl kickstart -k time to bring the daemon back up, then
    // re-probe and re-render this modal directly — the same probe+render
    // pair openMessageBeeSetup() uses — so a grant made via the reveal/
    // restart flow above is reflected here without requiring the operator
    // to close and reopen the modal. refresh() alone is not enough: it
    // re-renders the board/onboarding/etc but never touches mb_fda_mark.
    setTimeout(async () => {
      refresh();
      try {
        const p = await api('/messagebee/probe', { method: 'POST' });
        if (p) renderMessageBeeState(p);
      } catch (e) { /* transient — mark stays at its last known state */ }
      if (status) status.textContent = '';
    }, 3000);
  } catch (e) { if (status) status.textContent = ''; await hmAlert('Could not restart the daemon: ' + e, 'Restart Daemon'); }
}
function parseMessageBeeSelfHandles() {
  const input = document.getElementById('mb_self_input');
  const raw = input ? input.value.trim() : '';
  if (!raw) return [];
  return raw.split(/[,\n]/).map(v => v.trim()).filter(Boolean);
}
function mbJsArg(s) {
  return esc(s).replace(/"/g, '&quot;').replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function mbChip(label, removeFn) {
  return '<span class="mb-chip">' + esc(label)
    + ' <span class="x" onclick="' + removeFn + '(\'' + mbJsArg(label) + '\')" title="Remove">✕</span></span>';
}
function mbBlockedChip(label) {
  return '<span class="mb-chip">' + esc(label)
    + ' <span class="act" onclick="allowBlockedMessageBeeIdentity(\'' + mbJsArg(label) + '\')" title="Allow sender">Allow</span>'
    + ' <span class="act" onclick="unblockMessageBeeIdentity(\'' + mbJsArg(label) + '\')" title="Remove disallow">Unblock</span></span>';
}
function renderMessageBeeSelfHandles(handles) {
  const el = document.getElementById('mb_self_handles');
  const markEl = document.getElementById('mb_self_mark');
  if (!el || !markEl) return;
  const list = Array.isArray(handles) ? handles.filter(Boolean) : [];
  markEl.textContent = list.length ? '✓' : '○';
  markEl.className = 'mb-mark ' + (list.length ? 'ok' : 'no');
  el.innerHTML = list.length
    ? list.map(h => mbChip(h, 'removeMessageBeeSelfHandle')).join('')
    : '<span class="muted" style="font-size:11px">No agent identities set.</span>';
}
async function saveMessageBeeSelfHandlesIfNeeded() {
  const handles = parseMessageBeeSelfHandles();
  if (!handles.length) return null;
  return api('/messagebee/self-handles', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handles }),
  });
}
async function removeMessageBeeIdentity(address) {
  const err = document.getElementById('mb_err'); if (err) err.textContent = '';
  const status = document.getElementById('mb_status'); if (status) status.textContent = 'Removing…';
  try {
    await api('/messagebee/identities', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, status: 'pending' }),
    });
    const r = await api('/messagebee/probe', { method: 'POST' });
    if (r) renderMessageBeeState(r);
    if (status) status.textContent = 'Removed ' + address + ' from allowed senders.';
    await refresh();
  } catch (e) {
    if (err) err.textContent = String(e);
    if (status) status.textContent = '';
  }
}
async function allowBlockedMessageBeeIdentity(address) {
  const err = document.getElementById('mb_err'); if (err) err.textContent = '';
  const status = document.getElementById('mb_status'); if (status) status.textContent = 'Allowing…';
  try {
    await api('/messagebee/identities', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, status: 'allowed' }),
    });
    const r = await api('/messagebee/probe', { method: 'POST' });
    if (r) renderMessageBeeState(r);
    await renderIgnoredSenders();
    if (status) status.textContent = 'Allowed ' + address + '.';
    await refresh();
  } catch (e) {
    if (err) err.textContent = String(e);
    if (status) status.textContent = '';
  }
}
async function unblockMessageBeeIdentity(address) {
  const err = document.getElementById('mb_err'); if (err) err.textContent = '';
  const status = document.getElementById('mb_status'); if (status) status.textContent = 'Unblocking…';
  try {
    await api('/messagebee/identities', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, status: 'pending' }),
    });
    const r = await api('/messagebee/probe', { method: 'POST' });
    if (r) renderMessageBeeState(r);
    if (status) status.textContent = 'Unblocked ' + address + '. It can prompt again if it texts HiveMatrix.';
    await refresh();
  } catch (e) {
    if (err) err.textContent = String(e);
    if (status) status.textContent = '';
  }
}
async function removeMessageBeeSelfHandle(handle) {
  const err = document.getElementById('mb_err'); if (err) err.textContent = '';
  const status = document.getElementById('mb_status'); if (status) status.textContent = 'Removing…';
  try {
    const current = await api('/messagebee');
    const handles = ((current && current.selfHandles) || []).filter(h => String(h).toLowerCase() !== String(handle).toLowerCase());
    const saved = await api('/messagebee/self-handles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handles }),
    });
    const next = current || {};
    next.selfHandles = (saved && saved.selfHandles) || handles;
    renderMessageBeeState(next);
    if (status) status.textContent = 'Removed ' + handle + ' from agent identities.';
    await refresh();
  } catch (e) {
    if (err) err.textContent = String(e);
    if (status) status.textContent = '';
  }
}
async function renderBlockedMessageBeeIdentities(ids) {
  const el = document.getElementById('mb_blocked');
  if (!el) return;
  const blocked = Array.isArray(ids) ? ids.filter(i => i.status === 'blocked') : [];
  el.innerHTML = blocked.length
    ? '<div class="muted" style="font-size:11px;margin:6px 0 3px">Disallowed senders:</div>'
      + blocked.map(i => mbBlockedChip(i.address)).join('')
    : '';
}
// Reflect status into the setup marks. data is the POST result (or null = derive from onboarding).
function renderMessageBeeState(data) {
  const fallbackDetail = ((mbStep() || {}).detail || '');
  const fdaReadable = data ? !!data.chatDbReadable : /\b(chat\.db readable|enabled; reading|Messages database readable)\b/i.test(fallbackDetail);
  // "Skipped" (no probe ran, e.g. channel not yet enabled) is neither granted
  // nor denied — it must not render as a red mark like a genuine open_failed
  // denial. Mirrors setup-status.ts's buildFullDiskAccess() chatDbProbeSkipped handling.
  const fdaSkipped = data ? !!data.chatDbProbeSkipped : false;
  const enabled = data ? !!data.enabled : ((mbStep() || {}).state === 'done');
  const ids = data ? (data.identities || []) : null;
  const detail = data ? (data.chatDbDetail || '') : fallbackDetail;
  const mark = (el, ok) => { el.textContent = ok ? '✓' : '○'; el.className = 'mb-mark ' + (ok ? 'ok' : 'no'); };
  const markFda = (el, ok, skipped) => { el.textContent = ok ? '✓' : '○'; el.className = 'mb-mark ' + (ok ? 'ok' : (skipped ? 'skip' : 'no')); };
  markFda(document.getElementById('mb_fda_mark'), fdaReadable, fdaSkipped);
  mark(document.getElementById('mb_chan_mark'), enabled);
  document.getElementById('mb_fda_detail').textContent = fdaReadable
    ? 'Granted — HiveMatrix can read Messages.'
    : (detail || 'HiveMatrix needs Full Disk Access to read Messages (chat.db). Grant it, then re-run.');
  if (ids) {
    const allow = ids.filter(i => i.status === 'allowed' || i.status === 'paired');
    mark(document.getElementById('mb_phone_mark'), allow.length > 0);
    document.getElementById('mb_identities').innerHTML = allow.length
      ? allow.map(i => mbChip(i.address, 'removeMessageBeeIdentity')).join('')
      : '';
    renderBlockedMessageBeeIdentities(ids);
  } else {
    renderBlockedMessageBeeIdentities([]);
  }
  renderMessageBeeSelfHandles(data ? (data.selfHandles || []) : []);
}
async function submitMessageBee() {
  const err = document.getElementById('mb_err'); err.textContent = '';
  const status = document.getElementById('mb_status');
  const phone = document.getElementById('mb_phone').value.trim();
  status.textContent = 'Enabling…';
  try {
    const savedSelf = await saveMessageBeeSelfHandlesIfNeeded();
    const r = await api('/onboarding/messagebee', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: true, phone: phone || undefined }),
    });
    if (!r) { err.textContent = 'No response from daemon.'; status.textContent = ''; return; }
    const data = r.data || {};
    if (savedSelf && savedSelf.selfHandles) data.selfHandles = savedSelf.selfHandles;
    renderMessageBeeState(data);
    status.textContent = r.detail || (r.ok ? 'Configured.' : 'Done.');
    document.getElementById('mb_phone').value = '';
    document.getElementById('mb_self_input').value = '';
    await refresh();
  } catch (e) { err.textContent = String(e); status.textContent = ''; }
}

// --- Mail Lane guided setup -------------------------------------------------
// macOS only lists a target app under Privacy & Security → Automation AFTER
// the controlling app has actually fired an AppleEvent at it WHILE it is
// running. Opening the Automation pane cold (no prior probe) shows Mail
// nowhere — nothing to toggle, a dead end. So every entry point here fires
// the real probe (POST /mailbee/probe, which launches Mail and sends the
// AppleEvent) BEFORE it ever points the user at System Settings, and then
// polls until the "HiveMatrix wants to control Mail" prompt is answered —
// the user should not have to re-click after approving it.
let _mlPollTimer = null;
let _mlRetryTimer = null;
let _mlRetryElapsedMs = 0;
const ML_RETRY_INTERVAL_MS = 2000;
const ML_RETRY_CAP_MS = 30000;

function openMailBeeSetup() {
  document.getElementById('ml_err').textContent = '';
  document.getElementById('ml_status').textContent = '';
  document.getElementById('ml_email').value = '';
  renderMailBeeState(null);
  document.getElementById('mailOverlay').classList.add('open');
  async function pollMl() {
    // Passive refresh for the channel/trusted-sender marks — never probes
    // Mail itself (that's mlRetryAutomationProbe's job) so it can't trigger a
    // surprise TCC prompt just from having the dialog open.
    const data = await api('/mailbee');
    if (data) renderMailBeeState(data);
    if (document.getElementById('mailOverlay').classList.contains('open'))
      _mlPollTimer = setTimeout(pollMl, 3000);
  }
  clearTimeout(_mlPollTimer);
  pollMl();
  // Fire the real probe as soon as the dialog opens, with Mail launched, so
  // the permission prompt has a chance to appear right away instead of
  // requiring an extra click.
  mlRetryAutomationProbe();
}
function closeMailBee() {
  clearTimeout(_mlPollTimer);
  _mlPollTimer = null;
  mlStopAutomationRetry();
  document.getElementById('mailOverlay').classList.remove('open');
}
function mlStopAutomationRetry() {
  clearTimeout(_mlRetryTimer);
  _mlRetryTimer = null;
  _mlRetryElapsedMs = 0;
  const btn = document.getElementById('ml_auto_retry_btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Grant Mail Automation'; }
}
// One explicit probe: launches Mail (if needed) and fires the AppleEvent that
// makes macOS register HiveMatrix under Mail's Automation entry. Renders
// whatever real result comes back (granted / not authorized / not running /
// timed out) instead of a generic "approval needed".
async function mlFireProbeOnce() {
  let data = null;
  try { data = await api('/mailbee/probe', { method: 'POST' }); } catch (e) { /* transient — the retry loop will try again */ }
  if (data) renderMailBeeState(data);
  return data;
}
// Fire the probe, then poll every ~2s (capped ~30s) until it succeeds, macOS
// reports explicit denial, or the cap is hit — flipping the dialog to
// "Mail connected" automatically so the user never has to re-click Enable.
async function mlRetryAutomationProbe() {
  mlStopAutomationRetry();
  const btn = document.getElementById('ml_auto_retry_btn');
  const status = document.getElementById('ml_status');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  async function tick() {
    const data = await mlFireProbeOnce();
    if (data && data.mailControllable) {
      if (status) status.textContent = 'Mail connected ✓';
      mlStopAutomationRetry();
      return;
    }
    if (data && data.mailProbeKind === 'not_authorized' && status) {
      status.textContent = 'Waiting for you to approve the "HiveMatrix wants to control Mail" prompt…';
    } else if (status) {
      status.textContent = 'Waiting for Mail Automation approval…';
    }
    _mlRetryElapsedMs += ML_RETRY_INTERVAL_MS;
    if (_mlRetryElapsedMs >= ML_RETRY_CAP_MS) {
      if (status) status.textContent = (data && data.mailProbeDetail) || 'Still not approved. Use "Open Automation settings" to turn it on by hand, then try again.';
      mlStopAutomationRetry();
      return;
    }
    _mlRetryTimer = setTimeout(tick, ML_RETRY_INTERVAL_MS);
  }
  await tick();
}
// "Open Automation settings" fallback — fires one probe first (so Mail is
// actually registered and has something to show), THEN opens the pane, and
// keeps the retry loop running in the background so approving the toggle by
// hand is picked up without another click.
async function mlOpenAutomationSettings() {
  await mlFireProbeOnce();
  await openSystemPane('automation');
  mlRetryAutomationProbe();
}
function renderMailBeeState(data) {
  const mark = (id, ok) => { const el = document.getElementById(id); el.textContent = ok ? '✓' : '○'; el.className = 'mb-mark ' + (ok ? 'ok' : 'no'); };
  const controllable = data ? !!data.mailControllable : false;
  const enabled = data ? !!data.enabled : false;
  // "Skipped" (no probe ran, e.g. the passive poll fired while the channel is
  // still disabled) is neither granted nor denied — it must not overwrite a
  // real result. Without this guard, the passive pollMl() loop (which never
  // stops while the modal is open) clobbers a mark the active probe loop just
  // turned green back to red, and nothing is left running to flip it back.
  // Mirrors renderMessageBeeState's fdaSkipped handling for Message Lane.
  if (!(data && data.mailProbeSkipped)) {
    mark('ml_auto_mark', controllable);
    const detailEl = document.getElementById('ml_auto_detail');
    if (detailEl) {
      if (controllable) {
        detailEl.textContent = 'Granted — HiveMatrix can control Apple Mail.';
      } else if (data && data.mailProbeKind === 'not_authorized') {
        detailEl.textContent = data.mailProbeDetail || 'Not authorized yet — approve the "HiveMatrix wants to control Mail" prompt, or turn it on in Automation settings.';
      } else if (data && data.mailProbeKind === 'not_running') {
        detailEl.textContent = 'Mail.app is not running. Click "Grant Mail Automation" to launch it and ask for permission.';
      } else if (data && data.mailProbeKind === 'timeout') {
        detailEl.textContent = 'Mail did not respond in time. Click "Grant Mail Automation" to try again.';
      } else if (data && data.mailProbeDetail) {
        detailEl.textContent = data.mailProbeDetail;
      } else {
        detailEl.textContent = 'HiveMatrix needs permission to control Mail (read inbox + draft/send). Click "Grant Mail Automation" to ask.';
      }
    }
  }
  mark('ml_chan_mark', enabled);
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
    // Enabling fires one probe attempt server-side (see configureMailBee).
    // The very first AppleEvent macOS ever sees for an app typically fails
    // immediately while it shows the permission prompt — so if we're not
    // controllable yet, keep polling instead of leaving the user stuck on a
    // stale "needs action" state after they click OK.
    if (!(r.data && r.data.mailControllable)) mlRetryAutomationProbe();
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

// Whether the last HTTP poll succeeded — the reliable reachability signal over
// tunnels (unlike the SSE stream). Gates the "reconnecting" indicator.
let _httpHealthy = false;
async function refresh() {
  try {
    const [tasks, directives, conn, metrics, onboarding, appr, packCards] = await Promise.all([
      api("/tasks"), api("/directives"), api("/connectivity"), api("/metrics"), api("/onboarding"), api("/approvals/pending"), api("/packs/dashboard-cards"),
    ]);
    state.tasks = tasks; state.directives = directives; state.conn = conn; state.metrics = metrics; state.onboarding = onboarding;
    state.approvals = (appr && appr.approvals) || [];
    state.packCards = (packCards && packCards.cards) || [];
    renderBoard();
    // Center column: drive it right after the board so a later panel error can't
    // leave it stale. selectTask re-fetches the open task; otherwise show overview.
    if (state.selected) selectTask(state.selected); else renderOverview();
    // A successful HTTP poll proves the daemon is reachable — so clear any
    // SSE-only "reconnecting" state before renderConn paints. The SSE
    // EventSource flaps over tunnels/proxies (Cloudflare buffers/idle-times-out
    // SSE) while HTTP polling stays healthy; without this, one dropped stream
    // pins the indicator to "● reconnecting" forever even though the app is
    // fully functional (the exact iPad-over-tunnel symptom). HTTP reachability
    // is the source of truth for the indicator; SSE is just the push bonus.
    _httpHealthy = true;
    const liveEl = document.getElementById("live");
    if (liveEl) liveEl.classList.remove("stale");
    renderConn(); renderDirectives(); renderMetrics(); renderOnboarding();
    renderApprovals(); renderSkillCatalog(); renderMcp();
    saveScrollPosition(_currentView);
  } catch (e) { _httpHealthy = false; /* transient */ }
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

function usageBarClass(util, resetsAt, durationMs) {
  if (resetsAt && durationMs > 0) {
    const now = Date.now();
    const timeUntilResetMs = new Date(resetsAt).getTime() - now;
    if (timeUntilResetMs > 0) {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (Math.abs(durationMs - sevenDaysMs) < 1000) {
        const cycleDay = sevenDayCycleDay(resetsAt);
        const allowedDays = Math.min(cycleDay, 6);
        const redFloorUsedPct = Math.round((allowedDays / 7) * 1000) / 10;
        return util <= redFloorUsedPct ? "ok" : "hi";
      }
      if (util >= 90) return "hi";
      const elapsedMs = Math.max(0, durationMs - timeUntilResetMs);
      const elapsedFraction = elapsedMs / durationMs;
      const windowUnits = durationMs >= 86400000 ? durationMs / 86400000 : durationMs / 3600000;
      const dailyThreshold = 100 / windowUnits;
      if (elapsedFraction < 0.15) {
        return util > dailyThreshold ? "hi" : "ok";
      }
      const ratio = util / (elapsedFraction * 100);
      if (ratio >= 1.5 || util >= 80) return "hi";
      if (ratio >= 1.25 || util >= 60) return "warn";
      return "ok";
    }
  }
  return util >= 80 ? "hi" : util >= 60 ? "warn" : "ok";
}

// Compact reset for the header pill: "2h 13m" (drops the "in " prefix fmtResets adds).
function fmtResetsCompact(iso) { return fmtResets(iso).replace(/^in /, ""); }

// The binding window = the one with the least remaining headroom.
function lowestWindow(wins) {
  const live = (wins || []).filter(w => w && typeof w.remaining === "number");
  if (!live.length) return null;
  return live.reduce((a, b) => (b.remaining < a.remaining ? b : a));
}

let _headerUsageWin = "5h";
let _lastClaudeWins = null;

function setHeaderUsageWindow(w) { _headerUsageWin = w; renderHeaderUsageWindow(); }

// _lastClaudeWins is cached by checkUsage() below so a toggle click repaints
// instantly instead of waiting on the next poll.
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
  if (!el) return;
  const label = _headerUsageWin === "5h" ? "5-hour" : "7-day";
  const win = findUsageWin(label);
  if (!win) { el.textContent = ""; return; }
  const remaining = Math.max(0, Math.min(100, win.remaining));
  const cls = usageBarClass(win.utilization, win.resetsAt, win.durationMs || 0);
  el.textContent = remaining.toFixed(0) + "% left · resets " + fmtResets(win.resetsAt);
  el.className = "usage-status-dot " + cls;
}

async function checkUsage(forceRefresh) {
  try {
    const [u, providersResp] = await Promise.all([
      api(forceRefresh ? "/usage?refresh=1" : "/usage"),
      api("/providers").catch(() => null),
    ]);
    if (!u) return;
    const providers = (providersResp && providersResp.providers) || [];
    const claudeEnabled = providers.length ? !!(providers.find(p => p.id === "claude") || {}).enabled : true;
    const codexEnabled = providers.length ? !!(providers.find(p => p.id === "codex") || {}).enabled : true;
    const sub = claudeEnabled ? u.subscription : null;
    const subStatus = claudeEnabled ? u.subscriptionStatus : null;
    const codexSubscription = codexEnabled ? u.codexSubscription : null;
    const noFrontierEnabled = !claudeEnabled && !codexEnabled;

    // Normalize each provider's windows into {label, remaining, resetsAt} so the
    // pill, summary cards, and "worst window" all share one source of truth.
    const claudeWins = [];
    if (sub) {
      if (sub.fiveHour) claudeWins.push({ label: "5-hour", remaining: sub.fiveHour.remaining, resetsAt: sub.fiveHour.resetsAt, utilization: sub.fiveHour.utilization, durationMs: 18000000 });
      if (sub.sevenDay) claudeWins.push({ label: "7-day", remaining: sub.sevenDay.remaining, resetsAt: sub.sevenDay.resetsAt, utilization: sub.sevenDay.utilization, durationMs: 604800000 });
      if (sub.sevenDayOpus) claudeWins.push({ label: "7-day Opus", remaining: sub.sevenDayOpus.remaining, resetsAt: sub.sevenDayOpus.resetsAt, utilization: sub.sevenDayOpus.utilization, durationMs: 604800000 });
      if (sub.sevenDaySonnet) claudeWins.push({ label: "7-day Sonnet", remaining: sub.sevenDaySonnet.remaining, resetsAt: sub.sevenDaySonnet.resetsAt, utilization: sub.sevenDaySonnet.utilization, durationMs: 604800000 });
    }
    const codexWins = [];
    if (codexSubscription) {
      if (codexSubscription.fiveHour) codexWins.push({ label: "5-hour", remaining: Math.max(0, 100 - (codexSubscription.fiveHour.utilization || 0)), resetsAt: codexSubscription.fiveHour.resetsAt, utilization: codexSubscription.fiveHour.utilization || 0, durationMs: 18000000 });
      if (codexSubscription.sevenDay) codexWins.push({ label: "7-day", remaining: Math.max(0, 100 - (codexSubscription.sevenDay.utilization || 0)), resetsAt: codexSubscription.sevenDay.resetsAt, utilization: codexSubscription.sevenDay.utilization || 0, durationMs: 604800000 });
    }
    const allWins = claudeWins.concat(codexWins);

    _lastClaudeWins = claudeWins;
    renderHeaderUsageWindow();
  } catch (e) { /* transient */ }
}

async function runClaudeAuthLogin() {
  const btn = document.getElementById("claudeAuthLogin");
  if (btn) { btn.disabled = true; btn.textContent = "Opening Terminal…"; }
  try {
    const r = await api("/providers/claude/setup", { method: "POST" });
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
    const applying = !!(s && s.applying && s.applyingVersion);
    const needsDaemonRestart = !!(s && s.needsDaemonRestart);
    if (pill) {
      if (needsDaemonRestart) {
        pill.textContent = "↻ Finish update " + (s.applyingVersion || s.latest);
        pill.dataset.latest = s.applyingVersion || s.latest;
        pill.style.display = "";
        pill.title = s.detail || "Restart the bundled daemon to finish the update";
        pill.classList.add("update-available");
      } else if (applying) {
        pill.textContent = "⏳ Installing " + s.applyingVersion;
        pill.dataset.latest = s.applyingVersion;
        pill.style.display = "";
        pill.title = "Installing update";
        pill.classList.add("update-available");
      } else if (has) {
        pill.textContent = "⬆ Update " + s.latest;
        pill.dataset.latest = s.latest;
        pill.style.display = "";
        pill.title = "Click to install and restart";
        pill.classList.add("update-available");
      } else {
        pill.style.display = "none";
        pill.title = "Click to install and restart";
        pill.classList.remove("update-available");
      }
    }
    // About tab reflection.
    if (abStatus) abStatus.textContent = needsDaemonRestart ? (s.detail || "daemon restart needed to finish update") : applying ? ("installing update — " + s.applyingVersion) : (has ? ("update available — " + s.latest) : "up to date");
    if (abBtn) {
      abBtn.style.display = has ? "" : "none";
      abBtn.disabled = applying;
      abBtn.textContent = needsDaemonRestart ? "↻ Finish update" : applying ? "Installing…" : "⬆ Install update";
    }
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
    if (pill) { pill.textContent = "⏳ Updating…"; pill.style.cursor = "default"; pill.classList.add("update-available"); }
  } catch (e) { await hmAlert("Could not start the update: " + e, "Update"); }
}

document.getElementById("modeSel").addEventListener("change", async (e) => {
  await api("/connectivity/mode", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ mode: e.target.value || null }) });
  refresh();
});

// Connectivity auto-resolves, so the manual override stays hidden behind the
// "● live" indicator — click it to reveal the select, keeping the header
// uncluttered (and the cloud-ok/local-only vocabulary out of the way day to day).
function toggleConnOverride() {
  const sel = document.getElementById("modeSel");
  const lbl = document.getElementById("connLabel");
  const show = sel.style.display === "none";
  sel.style.display = show ? "" : "none";
  if (lbl) lbl.style.display = show ? "" : "none";
  if (show) sel.focus();
}

function toggleForm(id) { document.getElementById(id).classList.toggle("open"); }
function cancelForm(id) {
  if (id === "taskForm" && _taskFormInSession) { _closeNewTaskPanel(); return; }
  document.getElementById(id).classList.remove("open");
}
function showNewTaskPanel() {
  const form = document.getElementById("taskForm");
  const session = document.getElementById("session");
  if (!form || !session) return;
  state.selected = null;
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setFlashSessionMode(false);
  _ctxTask = null;
  _taskFormInSession = true;
  _promptWizardHandled = false;
  renderBoard();
  // Standard center-panel shell (matches Tools/Obs/Brain/Roles) instead of a
  // bare <h2> — same header, sub, and ← Overview control everywhere.
  session.innerHTML = '<div class="oc-center-pane">'
    + '<div class="oc-panel-head"><div><div class="oc-panel-title"><span>＋ New task</span></div>'
    + '<div class="oc-panel-sub">Describe what you want done — route it to a lane or let it self-plan.</div></div>'
    + '<span class="oc-panel-head-spacer"></span>'
    + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button></div>'
    + '<div class="new-task-panel"></div></div>';
  session.querySelector(".new-task-panel").appendChild(form);
  form.classList.add("open");
  syncNav();
  const desc = document.getElementById("t_desc");
  if (desc) setTimeout(() => desc.focus(), 20);
}
function _closeNewTaskPanel() {
  const form = document.getElementById("taskForm");
  const board = document.getElementById("board");
  if (form && board && board.parentElement) {
    form.classList.remove("open");
    board.parentElement.insertBefore(form, board);
  }
  _taskFormInSession = false;
  renderOverview();
  syncNav();
}

// --- Models / Settings ---
let models = null;            // { backends, available, defaultModel, version }
const modelById = {};         // UiModel.id → {modelId, fast}

// --- Agent roles (roster) ---
let agentProfiles = [];       // [{id, name, description, icon, tools, loadClaudeMd, modelRole, tier, isCustom, promptLines}]
const agentProfileById = {};  // id → profile, for the role pill lookup

function agentRoleOption(p) {
  return '<option value="'+esc(p.id)+'">'+esc(p.icon || "")+' '+esc(p.name)+'</option>';
}

// "Auto" only ever routes to a tier:"core" role (see resolveAutoAgentType /
// getCoreAgentProfiles) — coordinator (coo) and domain (e.g. trader)
// profiles are listed in their own groups, explicit-pick only, so this
// grouping isn't just cosmetic: it's the operator-facing half of the same
// tier boundary the classifier enforces server-side. Shared by every role
// select in the New Task flow (the main picker and the wizard preview's
// suggestion override) so they never drift out of sync with each other.
function roleSelectOptionsHtml() {
  const core = agentProfiles.filter(p => (p.tier || "core") === "core");
  const coordinator = agentProfiles.filter(p => p.tier === "coordinator");
  const domain = agentProfiles.filter(p => p.tier === "domain");
  return '<option value="auto">Auto</option>'
    + core.map(agentRoleOption).join("")
    + (coordinator.length ? '<optgroup label="Coordinator (explicit only)">' + coordinator.map(agentRoleOption).join("") + '</optgroup>' : "")
    + (domain.length ? '<optgroup label="Domain (explicit only)">' + domain.map(agentRoleOption).join("") + '</optgroup>' : "");
}

function populateRoleSelect(id) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value || "auto";
  sel.innerHTML = roleSelectOptionsHtml();
  sel.value = agentProfileById[current] ? current : "auto";
}

async function loadAgentProfiles() {
  const data = await api("/agents/profiles");
  if (!data || !Array.isArray(data.profiles)) return;
  agentProfiles = data.profiles;
  for (const k of Object.keys(agentProfileById)) delete agentProfileById[k];
  for (const p of agentProfiles) agentProfileById[p.id] = p;
  populateRoleSelect("t_role");
  populateRoleSelect("t_enhanced_role");
  return agentProfiles;
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
    root.style.setProperty("--mat-wp-opacity", (op / 100).toFixed(2));
    root.style.setProperty("--mat-wp-blur", op > 0 ? "6px" : "0px");
    root.style.setProperty("--mat-wp-sat",  op > 0 ? "160%" : "100%");
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
  for (const m of models.available) { if (m.disabled) continue; modelById[m.id] = { modelId: m.modelId, fast: !!m.fast }; }
  // Populate the New Task dropdown, grouped intent-first.
  const sel = document.getElementById("t_model");
  const catOf = m => m.backend === "mixed" ? "Recommended" : "Cloud frontier";
  const order = ["Recommended", "Cloud frontier"];
  const groups = {};
  for (const m of models.available) { (groups[catOf(m)] = groups[catOf(m)] || []).push(m); }
  const opt = m => '<option value="'+esc(m.id)+'"'+(m.disabled?' disabled':'')+'>'+esc(m.name)+(m.note?' — '+esc(m.note):'')+'</option>';
  sel.innerHTML = order.filter(g => groups[g]).map(g =>
    '<optgroup label="'+g+'">'+groups[g].map(opt).join("")+'</optgroup>').join("")
    || '<option value="">(no models configured)</option>';
  // Default selection
  const def = models.available.find(m => m.modelId === models.defaultModel || m.id === models.defaultModel);
  if (def) sel.value = def.id;
  // About can be opened before /models finishes; patch its version rows once
  // the version-bearing payload arrives.
  const about = document.getElementById("settingsAbout");
  if (about && about.style.display !== "none") renderAbout();
  const settingsOverlay = document.getElementById("settingsOverlay");
  if (settingsOverlay && settingsOverlay.classList.contains("open")) renderSettingsModelControls();
  return models;
}

// --- Projects ---
let projectDropdownSort = "recent";  // "recent" | "name"
let projectDropdownItems = [];       // full list of {name, path, preSelect, lastModified}
let selectedProject = null;          // { name, path, custom } — single source of truth for task form selection
let projectVisibleItems = [];        // the currently-rendered (filtered+sorted) dropdown rows
let projectHighlightIndex = -1;      // keyboard-highlighted row in projectVisibleItems (-1 = none)

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

  const filtered = projectDropdownItems.filter(p =>
    p.name.toLowerCase().includes(search) || p.path.toLowerCase().includes(search));
  const sorted = sortProjectItems(filtered, projectDropdownSort);
  projectVisibleItems = sorted;
  if (projectHighlightIndex >= sorted.length) projectHighlightIndex = sorted.length - 1;

  if (!sorted.length) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("hidden");

  listEl.innerHTML = sorted.map((p, i) => {
    const timeStr = p.lastModified ? new Date(p.lastModified).toLocaleDateString() : "";
    const cls = "project-item" + (selectedProject?.name===p.name?" selected":"") + (i===projectHighlightIndex?" active":"");
    const shortPath = p.path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
    return '<div class="'+cls+'" data-idx="'+i+'" onclick="selectProjectFromDropdown(\''+esc(p.name)+'\',\''+esc(p.path)+'\')">'
      + '<div class="project-item-row1">'
      + (p.preSelect ? '<span class="pstar">★</span>' : '')
      + '<span class="pname">'+esc(p.name)+'</span>'
      + (timeStr ? '<span class="ptime">'+esc(timeStr)+'</span>' : '')
      + '</div>'
      + '<span class="ppath" title="'+esc(p.path)+'">'+esc(shortPath)+'</span>'
      + '</div>';
  }).join("");
}

function filterProjectDropdown() {
  projectHighlightIndex = -1;  // typing resets the keyboard cursor
  renderProjectDropdown();
}

function sortProjectsDropdown(mode) {
  projectDropdownSort = mode;
  const dd = document.getElementById("t_project_dropdown");
  if (dd) dd.querySelectorAll(".project-sort-btn").forEach(b => {
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
  projectHighlightIndex = -1;
}

// The SINGLE writer of the task-form project selection. Name and path are
// always set together into one object, so the payload can never carry a name
// that disagrees with its projectPath.
function setTaskProject(name, path, custom) {
  selectedProject = (name || path) ? { name: name || "", path: path || "", custom: !!custom } : null;
  const hidden = document.getElementById("t_path");
  if (hidden) hidden.value = path || "";
  const search = document.getElementById("t_project_search");
  if (search) search.value = name || "";
  renderSelectedProject();
}

// Subtle, non-editable confirmation of the choice: name + the derived path as
// muted secondary text (never a primary input). ★ marks the discovered active
// project; custom folders are labelled so the source is honest.
function renderSelectedProject() {
  const row = document.getElementById("t_project_selected");
  const wrapper = document.getElementById("t_project_wrapper");
  const customToggle = document.querySelector("#taskForm .custom-folder-toggle");
  const customFolder = document.getElementById("t_custom_folder");
  if (!row) return;
  const name = selectedProject?.name || "";
  const path = selectedProject?.path || "";
  if (!name && !path) {
    row.style.display = "none"; row.innerHTML = "";
    if (wrapper) wrapper.style.display = "";
    if (customToggle) customToggle.style.display = "";
    return;
  }
  if (wrapper) wrapper.style.display = "none";
  if (customToggle) customToggle.style.display = "none";
  if (customFolder) customFolder.style.display = "none";
  const known = projectDropdownItems.find(p => p.name === name && p.path === path);
  const star = known && known.preSelect ? '<span class="pstar">★</span>' : '';
  const tag = selectedProject?.custom ? '<span class="pstar" title="Custom folder">◆</span>' : star;
  row.style.display = "flex";
  row.innerHTML = tag
    + '<span class="pname" title="'+esc(name)+'">'+esc(name || "(unnamed)")+'</span>'
    + '<span class="ppath" title="'+esc(path)+'">'+esc(path)+'</span>'
    + '<button class="project-clear" onclick="clearTaskProject()" title="Change project">×</button>';
}

function clearTaskProject() {
  setTaskProject("", "", false);
  const s = document.getElementById("t_project_search");
  if (!s) return;
  s.value = "";
  s.focus();
  // Defer so the click event finishes bubbling before the dropdown opens —
  // the document handler would otherwise close it immediately because the
  // X button lives outside t_project_wrapper.
  setTimeout(() => openProjectDropdown(), 0);
}

function selectProjectFromDropdown(name, path) {
  setTaskProject(name, path, false);
  closeProjectDropdown();
}

// Keyboard support for the combobox: ArrowDown/ArrowUp move the highlight,
// Enter selects it, Escape closes the dropdown.
function onProjectSearchKeydown(e) {
  const dd = document.getElementById("t_project_dropdown");
  const open = dd && !dd.classList.contains("hidden");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!open) { openProjectDropdown(); }
    if (!projectVisibleItems.length) return;
    projectHighlightIndex = Math.min(projectVisibleItems.length - 1, projectHighlightIndex + 1);
    renderProjectDropdown();
    scrollProjectHighlightIntoView();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!projectVisibleItems.length) return;
    projectHighlightIndex = Math.max(0, projectHighlightIndex - 1);
    renderProjectDropdown();
    scrollProjectHighlightIntoView();
  } else if (e.key === "Enter") {
    if (open && projectHighlightIndex >= 0 && projectHighlightIndex < projectVisibleItems.length) {
      e.preventDefault();
      const p = projectVisibleItems[projectHighlightIndex];
      selectProjectFromDropdown(p.name, p.path);
    }
  } else if (e.key === "Escape") {
    if (open) { e.preventDefault(); e.stopPropagation(); closeProjectDropdown(); }
  }
}

function scrollProjectHighlightIntoView() {
  const listEl = document.getElementById("t_project_list");
  if (!listEl) return;
  const el = listEl.querySelector('.project-item[data-idx="'+projectHighlightIndex+'"]');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}

// "Use another folder…" — the explicit, advanced path to an arbitrary directory.
function toggleCustomFolder() {
  const box = document.getElementById("t_custom_folder");
  if (!box) return;
  const showing = box.style.display !== "none";
  box.style.display = showing ? "none" : "block";
  const errEl = document.getElementById("t_custom_err");
  if (errEl) errEl.textContent = "";
  if (!showing) {
    const inp = document.getElementById("t_custom_path");
    if (inp) { inp.value = (document.getElementById("t_path")?.value || ""); inp.focus(); }
  }
}

function useCustomFolder() {
  const errEl = document.getElementById("t_custom_err");
  if (errEl) errEl.textContent = "";
  const raw = (document.getElementById("t_custom_path")?.value || "").trim();
  if (!raw) { if (errEl) errEl.textContent = "Enter a folder path (e.g. ~/work/my-project)."; return; }
  // Derive a human-readable name from the folder's last segment so the project
  // name and path stay consistent (no silent mismatch). Backend expands ~/$HOME.
  const trimmed = raw.replace(/\/+$/, "");
  const base = trimmed.split("/").filter(Boolean).pop() || "custom";
  const name = (base === "~" || base === "$HOME") ? "home" : base;
  setTaskProject(name, raw, true);
  const box = document.getElementById("t_custom_folder");
  if (box) box.style.display = "none";
}

function syncCommandProject(name, path) {
  mpSet('cmd', name, path, false);
}

function populateCommandProjects(projects) {
  if (projects && projects.length) _cmdProjects = projects;
  mpAutoSelect('cmd');
}

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("t_project_wrapper");
  if (wrapper && !wrapper.contains(e.target)) closeProjectDropdown();
  Object.keys(_mpState).forEach(pfx => {
    const w = document.getElementById(pfx + "_project_wrapper");
    if (w && !w.contains(e.target)) mpClose(pfx);
  });
});

// --- Generic multi-picker (directive, COO, command forms) ---
const _mpState = {};
function _mpS(pfx) {
  if (!_mpState[pfx]) _mpState[pfx] = { sort: "recent", visible: [], highlight: -1, name: "", custom: false, pathId: pfx + "_path" };
  return _mpState[pfx];
}
function mpRegister(pfx, pathId) { _mpS(pfx).pathId = pathId; }
function _mpPathEl(pfx) { return document.getElementById(_mpS(pfx).pathId); }
function mpSet(pfx, name, path, custom) {
  const s = _mpS(pfx);
  s.name = name || ""; s.custom = !!custom;
  const search = document.getElementById(pfx + "_project_search");
  if (search) search.value = name || "";
  const pathEl = _mpPathEl(pfx);
  if (pathEl) pathEl.value = path || "";
  _mpRenderSelected(pfx);
}
function mpAutoSelect(pfx) {
  const s = _mpS(pfx);
  if (s.name && projectDropdownItems.some(p => p.name === s.name)) return;
  const saved = state.selectedProject ? projectDropdownItems.find(p => p.name === state.selectedProject) : null;
  const chosen = saved || projectDropdownItems.find(p => p.preSelect) || sortProjectItems(projectDropdownItems, "recent")[0];
  if (chosen) mpSet(pfx, chosen.name, chosen.path, false);
}
function mpOpen(pfx) {
  _mpRender(pfx);
  const dd = document.getElementById(pfx + "_project_dropdown");
  if (dd) dd.classList.remove("hidden");
}
function mpClose(pfx) {
  const dd = document.getElementById(pfx + "_project_dropdown");
  if (dd) dd.classList.add("hidden");
  _mpS(pfx).highlight = -1;
}
function mpFilter(pfx) { _mpS(pfx).highlight = -1; _mpRender(pfx); }
function mpSort(pfx, mode) {
  _mpS(pfx).sort = mode;
  const dd = document.getElementById(pfx + "_project_dropdown");
  if (dd) dd.querySelectorAll(".project-sort-btn").forEach(b => b.classList.toggle("active", b.dataset.sort === mode));
  _mpRender(pfx);
}
function _mpRender(pfx) {
  const s = _mpS(pfx);
  const search = (document.getElementById(pfx + "_project_search")?.value || "").toLowerCase();
  const listEl = document.getElementById(pfx + "_project_list");
  const emptyEl = document.getElementById(pfx + "_project_empty");
  if (!listEl) return;
  const filtered = projectDropdownItems.filter(p => p.name.toLowerCase().includes(search) || p.path.toLowerCase().includes(search));
  const sorted = sortProjectItems(filtered, s.sort);
  s.visible = sorted;
  if (s.highlight >= sorted.length) s.highlight = sorted.length - 1;
  if (!sorted.length) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("hidden");
  listEl.innerHTML = sorted.map((p, i) => {
    const timeStr = p.lastModified ? new Date(p.lastModified).toLocaleDateString() : "";
    const cls = "project-item" + (s.name === p.name ? " selected" : "") + (i === s.highlight ? " active" : "");
    return '<div class="' + cls + '" data-idx="' + i + '" onclick="mpPick(\'' + pfx + '\',\'' + esc(p.name) + '\',\'' + esc(p.path) + '\')">'
      + (p.preSelect ? '<span class="pstar">&#9733;</span>' : '')
      + '<span class="pname">' + esc(p.name) + '</span>'
      + (timeStr ? '<span class="pdate">' + timeStr + '</span>' : '')
      + '</div>';
  }).join("");
}
function _mpRenderSelected(pfx) {
  const s = _mpS(pfx);
  const row = document.getElementById(pfx + "_project_selected");
  if (!row) return;
  const path = (_mpPathEl(pfx)?.value || "");
  if (!s.name && !path) { row.style.display = "none"; row.innerHTML = ""; return; }
  const known = projectDropdownItems.find(p => p.name === s.name && p.path === path);
  const star = known && known.preSelect ? '<span class="pstar">&#9733;</span>' : '';
  row.style.display = "flex";
  row.innerHTML = star
    + '<span class="pname" title="' + esc(s.name) + '">' + esc(s.name || "(unnamed)") + '</span>'
    + '<span class="ppath" title="' + esc(path) + '">' + esc(path) + '</span>';
}
function mpPick(pfx, name, path) { mpSet(pfx, name, path, false); mpClose(pfx); }
function mpKeydown(e, pfx) {
  const s = _mpS(pfx);
  const dd = document.getElementById(pfx + "_project_dropdown");
  const open = dd && !dd.classList.contains("hidden");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!open) mpOpen(pfx);
    if (!s.visible.length) return;
    s.highlight = Math.min(s.visible.length - 1, s.highlight + 1);
    _mpRender(pfx); _mpScrollIntoView(pfx);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!s.visible.length) return;
    s.highlight = Math.max(0, s.highlight - 1);
    _mpRender(pfx); _mpScrollIntoView(pfx);
  } else if (e.key === "Enter") {
    if (open && s.highlight >= 0 && s.highlight < s.visible.length) {
      e.preventDefault();
      mpPick(pfx, s.visible[s.highlight].name, s.visible[s.highlight].path);
    }
  } else if (e.key === "Escape") {
    if (open) { e.preventDefault(); e.stopPropagation(); mpClose(pfx); }
  }
}
function _mpScrollIntoView(pfx) {
  const s = _mpS(pfx);
  const listEl = document.getElementById(pfx + "_project_list");
  if (!listEl) return;
  const el = listEl.querySelector('.project-item[data-idx="' + s.highlight + '"]');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}
function mpSyncAll() { Object.keys(_mpState).forEach(pfx => mpAutoSelect(pfx)); }

function mpToggleCustomFolder(pfx) {
  const box = document.getElementById(pfx + "_custom_folder");
  if (!box) return;
  const showing = box.style.display !== "none";
  box.style.display = showing ? "none" : "block";
  const errEl = document.getElementById(pfx + "_custom_err");
  if (errEl) errEl.textContent = "";
  if (!showing) {
    const inp = document.getElementById(pfx + "_custom_path");
    if (inp) { inp.value = (_mpPathEl(pfx)?.value || ""); inp.focus(); }
  }
}

function mpUseCustomFolder(pfx) {
  const errEl = document.getElementById(pfx + "_custom_err");
  if (errEl) errEl.textContent = "";
  const raw = (document.getElementById(pfx + "_custom_path")?.value || "").trim();
  if (!raw) { if (errEl) errEl.textContent = "Enter a folder path (e.g. ~/work/my-project)."; return; }
  const trimmed = raw.replace(/\/+$/, "");
  const base = trimmed.split("/").filter(Boolean).pop() || "custom";
  const name = (base === "~" || base === "$HOME") ? "home" : base;
  mpSet(pfx, name, raw, true);
  const box = document.getElementById(pfx + "_custom_folder");
  if (box) box.style.display = "none";
}

// Escape returns to the Overview — but never while typing in a field or with a
// modal open (those own Escape themselves).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!state.selected && !state.selectedSkillOrCommand) return;
  if (isEditableTarget(document.activeElement)) return;
  if (document.querySelector(".overlay.open")) return;
  showOverview();
});

async function loadProjects(fresh) {
  try {
    const data = await api("/projects" + (fresh ? "?fresh=1" : ""));
    if (!data || !Array.isArray(data.projects)) return;
    state.projects = data.projects;
    // Always include the built-in Inbox project (for general non-project work) unless it's a real discovered project.
    const inboxEntry = { name: "inbox", path: "~", preSelect: false, lastModified: "" };
    const discoveredItems = data.projects.map(p => ({
      name: p.name,
      path: p.path,
      preSelect: !!p.preSelect,
      lastModified: p.lastModified || "",
    }));
    projectDropdownItems = data.projects.some(p => p.name === "inbox")
      ? discoveredItems
      : [inboxEntry, ...discoveredItems];
    // Populate the default-project selector in Settings → Projects.
    const defSel = document.getElementById("s_default_project");
    if (defSel) {
      const prevDef = defSel.value;
      defSel.innerHTML = '<option value="">(none — auto-select)</option>'
        + projectDropdownItems.map(p => '<option value="'+esc(p.name)+'">'+esc(p.name)+'</option>').join("");
      const storedDefault = localStorage.getItem("hm_default_project");
      if (storedDefault && defSel.querySelector('option[value="'+CSS.escape(storedDefault)+'"]')) defSel.value = storedDefault;
      else if (prevDef && defSel.querySelector('option[value="'+CSS.escape(prevDef)+'"]')) defSel.value = prevDef;
    }
    populateCommandProjects(data.projects);
    // Default the New Task selection: board filter → user default → ★ project → most-recent.
    const defaultProjName = localStorage.getItem("hm_default_project");
    const defaultProj = defaultProjName ? projectDropdownItems.find(p => p.name === defaultProjName) : null;
    const savedProj = state.selectedProject ? data.projects.find(p => p.name === state.selectedProject) : null;
    const chosen = savedProj
      || defaultProj
      || data.projects.find(p => p.preSelect)
      || sortProjectItems(projectDropdownItems, "recent")[0];
    const stillValid = selectedProject?.custom || projectDropdownItems.some(p => p.name === selectedProject?.name);
    if (chosen && (!selectedProject?.name || !stillValid)) {
      setTaskProject(chosen.name, chosen.path, false);
      if (savedProj) syncCommandProject(savedProj.name, savedProj.path);
    }
    renderProjectDropdown();
    renderSelectedProject();
    mpSyncAll();
  } catch (e) { /* transient */ }
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
function onAttachDrop(e) {
  e.preventDefault();
  const target = e.currentTarget || e.target;
  if (target && target.classList) target.classList.remove("drag-over");
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) onAttachFiles({ files, value: "" });
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

async function openSettings() {
  document.getElementById("settingsOverlay").classList.add("open");
  switchSettingsTab("about"); // open on About by default
  if (!models) {
    try { await loadModels(); } catch (e) { /* Settings can still show setup/features. */ }
  }
  renderSettingsModelControls();
  renderProviderStatus();
  loadTunnel();
  loadAutonomy();
  loadHeartbeat();
}

const PROVIDER_LABELS = { claude: "Claude (Claude Code)", codex: "Codex (OpenAI)" };

// No on/off switch: isProviderEnabled (frontier-providers.ts) already defaults
// enablement to "is the CLI binary installed" — so status here is purely
// installed/signed-in detection, styled like the Backends cards (mdl-card),
// with an Install/Sign-in affordance that reuses runProviderSetup instead of
// a toggle. installed && !authPresent still gets its own "not signed in"
// state, distinct from "not set up", so an installed-but-unauthenticated CLI
// isn't silently mistaken for a working one.
function providerStatusChip(p) {
  if (p.installed && p.authPresent) return '<span class="st ok">✓ installed</span>';
  if (p.installed) return '<span class="st no">not signed in</span>';
  return '<span class="st no">not set up</span>';
}

async function renderProviderStatus() {
  const wrap = document.getElementById("s_provider_toggle_rows");
  if (!wrap) return;
  let r;
  try {
    r = await api("/providers");
  } catch (e) { wrap.innerHTML = '<div class="muted">Could not load provider status.</div>'; return; }
  const providers = (r && r.providers) || [];
  let html = providers.map(p => {
    const needsSetup = !p.installed || !p.authPresent;
    const setupBtn = needsSetup
      ? '<div class="mdl-card-foot"><button class="sm" onclick="runProviderSetup(\'' + esc(p.id) + '\')">' + (p.installed ? 'Sign in' : 'Install + sign in') + '</button></div>'
      : '';
    return '<div class="mdl-card"><div class="mdl-card-head"><span class="mdl-card-name">' + esc(PROVIDER_LABELS[p.id] || p.id) + '</span>'
      + providerStatusChip(p) + '</div>' + setupBtn + '</div>';
  }).join('');
  wrap.innerHTML = html || '<div class="muted">No providers.</div>';
}

async function runProviderSetup(id) {
  const r = await api("/providers/" + encodeURIComponent(id) + "/setup", { method: "POST" });
  if (!r || !r.ok) {
    await hmAlert((r && (r.detail || r.error)) || ("Could not start " + (PROVIDER_LABELS[id] || id) + " setup."));
  } else {
    await hmAlert("Terminal opened for " + (PROVIDER_LABELS[id] || id) + " setup. Complete it there, then click refresh.");
  }
  await renderProviderStatus();
  models = await loadModels().catch(() => models);
  renderSettingsModelControls();
}

function renderSettingsModelControls() {
  const m = models || {};
  const available = Array.isArray(m.available) ? m.available : [];
  const backends = Array.isArray(m.backends) ? m.backends : [];
  const sd = document.getElementById("s_default");
  const selectable = available.filter(m => !m.disabled); // greyed "set up X" placeholders aren't valid defaults
  sd.disabled = !selectable.length;
  if (selectable.length) {
    sd.innerHTML = selectable.map(m => '<option value="'+esc(m.modelId)+'">'+esc(m.name)+'</option>').join("");
    if (m.defaultModel) sd.value = m.defaultModel;
  } else {
    sd.innerHTML = '<option value="">(no models configured)</option>';
  }
  document.getElementById("s_backends").innerHTML = backends.length ? backends.map(b =>
    '<div class="mdl-card"><div class="mdl-card-head"><span class="mdl-card-name">'+esc(b.name)+'</span>'
    + '<span class="st '+(b.configured?'ok':'no')+'">'+(b.configured?'✓ '+esc(b.detail):'not set up')+'</span></div>'
    + (b.configured?'':'<div class="mdl-card-foot">'+esc(b.connect||'')+'</div>')+'</div>').join("") : '<div class="mdl-card"><div class="mdl-card-foot" style="border:none;margin:0;padding:0">Model status unavailable.</div></div>';
  const v = m.version || {};
  document.getElementById("s_version").textContent = "HiveMatrix v" + (v.version||"?") + " · build " + (v.build||"?") + " · " + (v.date||"?");
  document.getElementById("s_theme").value = m.theme || "system";
  document.getElementById("s_token").value = HM_TOKEN || "(load the local console to see the token)";
  // Wallpaper: reflect the current image + path so settings shows what's active.
  const hasWp = !!m.hasWallpaper;
  document.getElementById("s_wallpaper").value = hasWp ? (m.wallpaperPath || "") : "";
  if (hasWp) showWallpaperPreview(); else document.getElementById("wallpaper_preview").style.display = "none";
  syncWallpaperOpacityRow();
  document.getElementById("s_location").value = m.location || "";
  document.getElementById("s_autoupdate").checked = !!m.autoUpdate;
  document.getElementById("s_telemetry").checked = !!m.telemetryEnabled;
  document.getElementById("s_telemetry_status").textContent = "";
  const hasClaudeFrontier = backends.some(b => b.id === "claude" && b.configured);
  const hasCodexFrontier = backends.some(b => b.id === "codex" && b.configured);
  const hasAnyFrontier = hasClaudeFrontier || hasCodexFrontier;
  const hasBothFrontier = hasClaudeFrontier && hasCodexFrontier;
  document.getElementById("s_frontier_provider_row").style.display = hasAnyFrontier ? "" : "none";
  const frontierSelect = document.getElementById("s_frontier_provider");
  if (frontierSelect) {
    const effectiveFrontierProvider = hasCodexFrontier && !hasClaudeFrontier ? "codex"
      : hasClaudeFrontier && !hasCodexFrontier ? "claude"
        : m.frontierProvider || "claude";
    frontierSelect.value = effectiveFrontierProvider;
    frontierSelect.disabled = !hasBothFrontier;
    frontierSelect.title = hasBothFrontier ? "Choose which frontier CLI (Claude or Codex) handles frontier work." : "Only one frontier CLI is available.";
  }
  renderRoleModels();
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

// Per-role Claude routing: thinking → Opus, coding → Sonnet, operational
// (bulk work + Flash chat) → Haiku, writer → Sonnet. Always shown — every
// role resolves to Claude (or Codex, if picked as the frontier provider).
// Empty value = the router's built-in default.
function renderRoleModels() {
  const wrap = document.getElementById("s_role_models");
  if (!wrap || !models) return;
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
  fill("s_role_thinking", opts.thinking || [], provider === "codex" ? "Default — Codex GPT-5.5" : "Default — Opus", rm.thinking);
  fill("s_role_coding", opts.coding || [], provider === "codex" ? "Default — Codex Spark" : "Default — Sonnet", rm.coding);
  fill("s_role_operational", opts.operational || [], "Default — Haiku", rm.operational);
  fill("s_role_writer", opts.writer || [], provider === "codex" ? "Default — Codex GPT-5.5" : "Default — Sonnet", rm.writer);
}

async function saveRoleModel(role, modelId) {
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ roleModel: { role, modelId } }) });
  await loadModels();   // refreshes the global models object (incl. roleModels)
  renderRoleModels();
  hmToast(role + " model saved", "ok");
}
function onOpacityInput(v) {
  const op = parseInt(v, 10);
  document.getElementById("s_wp_opacity_val").textContent = v + "%";
  document.documentElement.style.setProperty("--mat-wp-opacity", (op / 100).toFixed(2));
  document.documentElement.style.setProperty("--mat-wp-blur", op > 0 ? "6px" : "0px");
  document.documentElement.style.setProperty("--mat-wp-sat",  op > 0 ? "160%" : "100%");
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
async function saveTelemetry() {
  const enabled = document.getElementById("s_telemetry").checked;
  const st = document.getElementById("s_telemetry_status");
  try {
    await api("/telemetry/config", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ enabled }) });
    await loadModels();
    st.textContent = enabled ? "Opted in — aggregate counters will be sent daily." : "Opted out — nothing leaves this Mac.";
  } catch (e) { st.textContent = "Failed to save: " + e; }
}
async function clearTelemetryData() {
  const st = document.getElementById("s_telemetry_status");
  try {
    const r = await api("/telemetry/clear", { method:"POST" });
    st.textContent = "Cleared " + (r && r.cleared != null ? r.cleared : "?") + " event(s).";
  } catch (e) { st.textContent = "Failed: " + e; }
}
async function sendDiagnostics() {
  const st = document.getElementById("s_telemetry_status");
  st.textContent = "Building…";
  try {
    const bundle = await api("/diagnostics/bundle");
    await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    st.textContent = "Diagnostics bundle copied to clipboard.";
  } catch (e) { st.textContent = "Failed: " + e; }
}

function switchSettingsTab(tab) {
  const tabs = ["about", "setup", "features", "general", "models", "lanes", "remote", "license"];
  const panels = { models: "settingsModels", lanes: "settingsLanes", general: "settingsGeneral", remote: "settingsRemote", features: "settingsFeatures", about: "settingsAbout", setup: "settingsSetup", license: "settingsLicense" };
  for (const t of tabs) {
    document.getElementById("tab-" + t).className = "tab" + (tab === t ? " active" : "");
    document.getElementById(panels[t]).style.display = tab === t ? "" : "none";
  }
  if (tab === "lanes") { renderSystemReadiness(); renderLaneSetup(); renderBrowserReadiness(); renderSettingsLanes(); renderSafeSenders(); renderCooRoutingRules(); renderWorkflows(); renderWorkflowInbox(); renderWorkflowActions(); renderVaultRefs(); }
  if (tab === "setup") renderSettingsSetup();
  if (tab === "features") renderFeatures();
  if (tab === "remote") loadTunnel();
  if (tab === "about") { renderAbout(); checkUpdate(); }
  if (tab === "license") renderLicense();
}

function settingsSwitch(on, onclick, opts) {
  const disabled = opts && opts.disabled === true;
  const label = disabled ? "Unavailable" : (on ? "Enabled" : "Off");
  const title = opts && opts.title ? opts.title : label;
  const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : '';
  const clickAttr = disabled ? '' : ' onclick="' + onclick + '"';
  return '<button type="button" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" class="settings-switch ' + (disabled ? 'is-disabled' : (on ? 'is-on' : 'is-off')) + '"' + clickAttr + disabledAttrs + ' title="' + esc(title) + '">'
    + '<span class="settings-switch-track" aria-hidden="true"><span class="settings-switch-knob"></span></span>'
    + '<span class="settings-switch-text">' + label + '</span>'
    + '</button>';
}


async function renderFeatures() {
  const el = document.getElementById("s_features");
  el.innerHTML = '<div class="muted">Loading…</div>';
  const [r, auto] = await Promise.all([api("/settings/features"), api("/settings/voice/auto-approval")]);
  const features = (r && r.features) || [];
  if (!features.length) { el.innerHTML = '<div class="muted">No optional features.</div>'; return; }
  const featureRows = features.map(f => {
    const on = f.enabled === true;
    const incapable = f.capable === false;
    const reason = (incapable && f.reason) ? ' <span style="color:var(--accent-2)">— ' + esc(f.reason) + '</span>' : '';
    const control = incapable
      ? settingsSwitch(false, '', { disabled: true, title: f.reason || 'not available' })
      : settingsSwitch(on, "toggleFeature('" + esc(f.key) + "'," + (!on) + ")", { title: (on ? 'Turn off ' : 'Turn on ') + f.label });
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
    + '<div class="muted" style="font-size:11px;margin-top:2px">Allows Talk to approve non-content scheduled item checkpoints. Content, external, stuck, and tool approvals stay manual.</div></div>'
    + settingsSwitch(checkpointAuto, 'toggleAutoApproval(' + (!checkpointAuto) + ')', { title: checkpointAuto ? 'Turn off voice auto-approval' : 'Turn on voice auto-approval' })
    + '</div>';
  const voiceLogicRow = '<div style="padding:10px 0;border-top:1px solid var(--border)">'
    + '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">'
    + '<div style="flex:1"><div style="font-weight:600">Voice logic test</div>'
    + '<div class="muted" style="font-size:11px;margin-top:2px">Runs canned text scenarios through Talk routing. No mic, STT, or audio playback.</div></div>'
    + '<button class="copybtn" onclick="runVoiceLogicTest(this)">Run test</button>'
    + '</div><div id="s_voice_logic_result" style="margin-top:8px"></div></div>';
  el.innerHTML = featureRows + autoRow + voiceLogicRow;
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

async function runVoiceLogicTest(btn) {
  const out = document.getElementById("s_voice_logic_result");
  if (btn) btn.disabled = true;
  if (out) out.innerHTML = '<div class="muted" style="font-size:11px">Running…</div>';
  try {
    const r = await api("/settings/voice/test-scenarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liveWeather: true }) });
    renderVoiceLogicResults(r);
    if (r && r.ok) hmToast('Voice logic test passed.', 'ok');
    else hmToast('Voice logic test found failures.', 'err');
  } catch (e) {
    if (out) out.innerHTML = '<div class="muted" style="font-size:11px;color:var(--danger)">Voice logic test failed to run.</div>';
    hmToast('Voice logic test failed to run.', 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderVoiceLogicResults(r) {
  const out = document.getElementById("s_voice_logic_result");
  if (!out) return;
  const scenarios = (r && r.scenarios) || [];
  const ok = r && r.ok === true;
  const summary = '<div class="muted" style="font-size:11px;margin-bottom:6px">'
    + (ok ? '✓ ' : '✗ ') + esc(String((r && r.passed) || 0)) + ' passed, ' + esc(String((r && r.failed) || 0)) + ' failed'
    + '</div>';
  const rows = scenarios.map(s => '<div style="display:grid;grid-template-columns:18px minmax(120px,1fr) minmax(120px,1fr);gap:8px;align-items:start;padding:5px 0;border-top:1px solid var(--border);font-size:11px">'
    + '<span style="color:' + (s.passed ? 'var(--ok)' : 'var(--danger)') + '">' + (s.passed ? '✓' : '✗') + '</span>'
    + '<div><div style="font-weight:600">' + esc(s.name || '') + '</div><div class="muted">' + esc(s.utterance || '') + '</div></div>'
    + '<div><code>' + esc(s.actual || '') + '</code><div class="muted">' + esc((s.reply || '').slice(0, 120)) + '</div></div>'
    + '</div>').join('');
  out.innerHTML = summary + rows;
}

// ── In-app push-to-talk (Voice feature) ───────────────────────────────
let _dictRec = null, _dictChunks = [];
let _voiceOn = true; // corrected on first /settings/features fetch; gates the composer mic
async function initVoiceFeature() {
  try {
    const r = await api("/settings/features");
    const on = ((r && r.features) || []).some(f => f.key === "voice" && f.enabled);
    _voiceOn = on;
    const mic = document.getElementById("flashMicBtn");
    if (mic) mic.style.display = on ? "" : "none";
  } catch (e) { /* ignore */ }
}

// ── Flash Lane chat panel ──────────────────────────────────────────────
let _flashState = {
  panelOpen: false,
  sessionId: null,
  sending: false,
  messages: [],
  pendingImages: [] // [{ dataUrl, name }] — attached photos for the next turn (sent as imagesBase64)
};

function flashPanelHtml() {
  return '<div class="oc-center-pane">'
    + '<div class="oc-panel-head">'
    + '<div><div class="oc-panel-title"><span class="oc-avail-dot ok"></span><span>Chat</span></div>'
    + '<div class="oc-panel-sub">Native HiveMatrix agent loop</div></div>'
    + '<span class="oc-panel-head-spacer"></span>'
    + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button>'
    + '</div>'
    + '<div class="oc-panel-body">'
    + '<div class="oc-transcript" id="flashTranscript"></div>'
    + '<div id="flashImgPreview" class="oc-img-preview"></div>'
    + '<div class="oc-panel-composer-shell" onclick="flashFocusInput()" ondragover="event.preventDefault();this.classList.add(\'oc-drag\')" ondragleave="this.classList.remove(\'oc-drag\')" ondrop="flashDrop(event)">'
    + '<textarea class="oc-input" id="flashInput" placeholder="Message…  (paste or drop an image to attach)" rows="3" onkeydown="flashInputKeydown(event)" oninput="flashInputResize(this)" onpaste="flashPaste(event)"></textarea>'
    + '<div class="oc-panel-composer-actions">'
    + '<input type="file" id="flashPhotoInput" accept="image/*" multiple style="display:none" onchange="flashPhotoSelected(this)">'
    + '<button class="oc-mic-btn" id="flashPhotoBtn" onclick="event.stopPropagation();document.getElementById(\'flashPhotoInput\').click()" title="Attach a photo — the assistant can see it">📎 Photo</button>'
    + '<button class="oc-mic-btn" id="flashMicBtn" onclick="event.stopPropagation();flashDictate()" title="Dictate — speak and your words fill the box">🎤 Mic</button>'
    + '<button class="create" id="flashSendBtn" onclick="event.stopPropagation();flashSend()" disabled>Send</button>'
    + '</div></div></div></div>';
}

function renderFlashPanel() {
  if (!_flashState.panelOpen) return;
  const session = document.getElementById('session');
  if (!session) return;
  setFlashSessionMode(true);
  const active = document.activeElement && document.activeElement.id === 'flashInput';
  const draft = active ? ((document.getElementById('flashInput') || {}).value || '') : '';
  session.innerHTML = flashPanelHtml();
  const input = document.getElementById('flashInput');
  if (input && draft) { input.value = draft; flashInputResize(input); }
  const mic = document.getElementById('flashMicBtn');
  if (mic && !_voiceOn) mic.style.display = 'none';
  renderFlashImgPreview();
  const sendBtn = document.getElementById('flashSendBtn');
  if (sendBtn) sendBtn.disabled = !((input && input.value.trim()) || _flashState.pendingImages.length);
  flashRenderMessages();
  if (active && input) input.focus();
}

function showFlashPanel() {
  state.selected = null;
  state.selectedSkillOrCommand = null;
  _skSel = '';
  _ctxTask = null;
  if (_taskFormInSession) _closeNewTaskPanel();
  _flashState.panelOpen = true;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setStoredView('flash');
  renderBoard();
  renderSkillList();
  renderFlashPanel();
  updateFlashNav();
  updateBrainNav();
  updateRolesNav();
  updateToolsNav();
  updateGoalsNav();
  hydrateFlashThread(); // pull the unified operator thread (incl. voice/task-completion posts)
}

// Load the canonical operator conversation (shared by chat + voice + task
// close-the-loop posts) from the server and render it. Best-effort; never
// clobbers an in-flight streaming turn (guarded by _flashState.sending).
async function hydrateFlashThread() {
  if (_flashState.sending) return;
  try {
    const cur = await api('/flash/session/current?peer=operator');
    const sid = cur && cur.sessionId;
    if (!sid) return;
    _flashState.sessionId = sid;
    const r = await api('/flash/sessions/' + encodeURIComponent(sid) + '/turns');
    const turns = (r && r.turns) || [];
    _flashState.messages = turns
      .filter(function (t) { return t.role === 'user' || t.role === 'assistant'; })
      .map(function (t) { return { role: t.role, content: t.content, ts: t.ts ? Date.parse(t.ts) : undefined }; });
    if (_flashState.panelOpen && !_flashState.sending) flashRenderMessages();
  } catch (e) { /* best-effort; keep whatever is on screen */ }
}

// SSE: a task completion (or another surface) appended to the operator thread.
function onFlashAppended(ev) {
  if (!_flashState.panelOpen || _flashState.sending) return;
  try {
    const data = ev && ev.data ? JSON.parse(ev.data) : null;
    if (data && data.sessionId && _flashState.sessionId && data.sessionId !== _flashState.sessionId) return;
  } catch (e) { /* refresh anyway */ }
  hydrateFlashThread();
}

function updateFlashNav() { syncNav(); }

// ── Brain / Memory Review panel ─────────────────────────────────────────
// Read-only per-project doc browser (docs/superpowers/specs/2026-07-09-brain-memory-review-console-design.md,
// Phases 1-2). Status badges are derived server-side from what actually
// reaches a task's prompt today — see GET /brain/docs.
let _brainState = {
  panelOpen: false,
  loading: false,
  projectsError: false,
  docsError: false,
  docContentError: false,
  projects: [],
  project: null,
  docs: [],
  embeddingsEnabled: true,
  doc: null,       // selected file (relative to the project), e.g. "lanes/manager.md"
  docContent: null,
  viewMode: 'rendered',
  selected: new Set()  // files (relative to the project) checked for the toolbar action
};

const BRAIN_STATUS_CLASS = { brief: 'tag-brief', ctx: 'tag-ctx', indexed: 'tag-indexed', orphan: 'tag-orphan', stale: 'tag-stale', excluded: 'tag-excluded' };
const BRAIN_STATUS_LABEL = { brief: 'Main brief', ctx: 'In task ctx', indexed: 'Indexed only', orphan: 'Orphaned', stale: 'Stale', excluded: 'Excluded' };

function brainPanelHtml() {
  return '<div class="oc-center-pane" style="max-width:none">'
    + '<div class="oc-panel-head">'
    + '<div><div class="oc-panel-title"><span>🧠</span><span>Brain / Memory Review</span></div>'
    + '<div class="oc-panel-sub">Which brain docs actually reach a task\'s prompt, per project</div></div>'
    + '<span class="oc-panel-head-spacer"></span>'
    + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button>'
    + '</div>'
    + '<div class="brain-pane" style="padding:0;height:auto;max-height:none">'
    + '<div class="brain-shell">'
    + '<div class="brain-col">'
    + '<div class="brain-col-head">Projects</div>'
    + '<div class="brain-col-body" id="brainProjectList"><div class="muted" style="padding:12px">Loading…</div></div>'
    + '</div>'
    + '<div class="brain-col">'
    + '<div class="brain-col-head"><span id="brainCenterTitle">Documents</span></div>'
    + '<div class="brain-legend">'
    + '<span>⭐ Main brief</span><span>🟢 In task ctx</span><span>🔵 Indexed only</span>'
    + '<span>⚪ Orphaned</span><span>🟠 Stale</span><span>🔴 Excluded</span>'
    + '</div>'
    + '<div class="brain-toolbar">'
    + '<span class="sel-count" id="brainSelCount">0 selected</span>'
    + '<button id="brainArchiveBtn" disabled onclick="runBrainArchiveAction()">Archive selected</button>'
    + '<button id="brainExcludeBtn" disabled onclick="runBrainExcludeAction()">Exclude from context</button>'
    + '</div>'
    + '<div class="brain-col-body" id="brainDocList"><div class="muted" style="padding:12px">Select a project.</div></div>'
    + '</div>'
    + '<div class="brain-col">'
    + '<div class="brain-render-head">'
    + '<div style="min-width:0"><div class="brain-render-title" id="brainRenderTitle">Select a document</div>'
    + '<span class="path" id="brainRenderPath"></span></div>'
    + '<div class="brain-toggle-group">'
    + '<button id="brainBtnRendered" class="active" onclick="setBrainViewMode(\'rendered\')">Rendered</button>'
    + '<button id="brainBtnRaw" onclick="setBrainViewMode(\'raw\')">Raw</button>'
    + '</div></div>'
    + '<div class="brain-render-body" id="brainRenderBody"><div class="brain-empty-state">Click a document on the left to preview it here.</div></div>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '</div>';
}

function renderBrainPanel() {
  if (!_brainState.panelOpen) return;
  const session = document.getElementById('session');
  if (!session) return;
  setFlashSessionMode(true);
  session.innerHTML = brainPanelHtml();
  renderBrainProjects();
  renderBrainDocs();
  renderBrainPane();
}

function showBrain() {
  state.selected = null;
  state.selectedSkillOrCommand = null;
  _skSel = '';
  _ctxTask = null;
  if (_taskFormInSession) _closeNewTaskPanel();
  _flashState.panelOpen = false;
  _brainState.panelOpen = true;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setStoredView('brain');
  renderBoard();
  renderSkillList();
  renderBrainPanel();
  updateFlashNav();
  updateBrainNav();
  updateRolesNav();
  updateToolsNav();
  updateGoalsNav();
  loadBrainProjects();
}

function updateBrainNav() { syncNav(); }

// Live sync (§6): archive/exclude/restore/delete from another surface (or
// another operator session) reflects here without a manual refresh.
async function onBrainChanged() {
  if (!_brainState.panelOpen) return;
  const r = await api('/brain/projects');
  _brainState.projects = (r && r.projects) || [];
  renderBrainProjects();
  if (_brainState.project) await loadBrainDocs(_brainState.project);
}

async function loadBrainProjects() {
  _brainState.projectsError = false;
  try {
    const r = await api('/brain/projects');
    _brainState.projects = (r && r.projects) || [];
  } catch (e) {
    _brainState.projectsError = true;
    _brainState.projects = [];
  }
  if (!_brainState.project && _brainState.projects.length) _brainState.project = _brainState.projects[0].slug;
  renderBrainProjects();
  if (_brainState.project) await loadBrainDocs(_brainState.project);
}

function renderBrainProjects() {
  const el = document.getElementById('brainProjectList');
  if (!el) return;
  if (_brainState.projectsError) { el.innerHTML = '<div class="muted" style="padding:12px">Could not reach the daemon. <a href="#" onclick="event.preventDefault();loadBrainProjects()">Retry</a></div>'; return; }
  if (!_brainState.projects.length) { el.innerHTML = '<div class="muted" style="padding:12px">No brain projects found.</div>'; return; }
  el.innerHTML = _brainState.projects.map(p => {
    const isPinned = p.slug === '__pinned__';
    const cls = 'brain-proj-row' + (isPinned ? ' pinned' : '') + (p.slug === _brainState.project ? ' active' : '');
    const sub = isPinned ? '<div class="sub">pulled into every task, any project</div>' : '';
    return '<div class="' + cls + '" onclick="selectBrainProject(\'' + attrEnc(p.slug) + '\')">'
      + '<span><span class="name">' + esc(p.label) + '</span>' + sub + '</span>'
      + '<span class="count">' + p.docCount + '</span></div>';
  }).join('');
}

async function selectBrainProject(slug) {
  _brainState.project = decodeURIComponent(slug);
  _brainState.doc = null;
  _brainState.docContent = null;
  _brainState.selected = new Set();
  renderBrainProjects();
  await loadBrainDocs(_brainState.project);
}

async function loadBrainDocs(slug) {
  _brainState.loading = true;
  _brainState.docsError = false;
  renderBrainDocs();
  let r;
  try {
    r = await api('/brain/docs?project=' + encodeURIComponent(slug));
  } catch (e) {
    if (_brainState.project !== slug) return;
    _brainState.loading = false;
    _brainState.docsError = true;
    _brainState.docs = [];
    renderBrainDocs();
    renderBrainPane();
    return;
  }
  if (_brainState.project !== slug) return; // stale response — the operator switched projects mid-fetch
  _brainState.loading = false;
  _brainState.docs = (r && r.docs) || [];
  _brainState.embeddingsEnabled = !r || r.embeddingsEnabled !== false;
  // Default-select the project's main brief on first load for a nicer first impression.
  if (!_brainState.doc) {
    const brief = _brainState.docs.find(d => d.status === 'brief');
    if (brief) _brainState.doc = brief.file;
  }
  renderBrainDocs();
  if (_brainState.doc) await loadBrainDocContent(_brainState.project, _brainState.doc);
  else renderBrainPane();
}

function renderBrainDocs() {
  const title = document.getElementById('brainCenterTitle');
  if (title) title.textContent = (_brainState.project || '—') + ' — documents';
  const el = document.getElementById('brainDocList');
  if (!el) return;
  if (_brainState.loading) { el.innerHTML = '<div class="muted" style="padding:12px">Loading… (the brain root may be a slow cloud mount)</div>'; return; }
  if (_brainState.docsError) { el.innerHTML = '<div class="muted" style="padding:12px">Could not load this project\'s documents. <a href="#" onclick="event.preventDefault();loadBrainDocs(_brainState.project)">Retry</a></div>'; return; }
  if (!_brainState.docs.length) {
    const emptyMsg = _brainState.project === '__pinned__'
      ? 'No ~/.claude/CLAUDE.md found on this Mac — nothing pinned yet.'
      : 'No documents in this project.';
    el.innerHTML = '<div class="muted" style="padding:12px">' + esc(emptyMsg) + '</div>';
    return;
  }
  const caveat = !_brainState.embeddingsEnabled
    ? '<div class="muted" style="padding:8px 12px;font-size:10.5px;border-bottom:1px solid var(--border)">Semantic index is off — Indexed/Orphaned may be unreliable until it\'s enabled.</div>'
    : '';
  const isPinnedProject = _brainState.project === '__pinned__';
  const buildRow = d => {
    const isArchived = !!d.archived;
    const isConfig = !!d.configFile;
    const cls = 'brain-doc-row ' + (BRAIN_STATUS_CLASS[d.status] || '') + (d.file === _brainState.doc ? ' selected-file' : '') + (isArchived ? ' archived' : '') + (isConfig ? ' config-file' : '');
    const sizeKb = d.sizeBytes ? (d.sizeBytes / 1024).toFixed(1) + ' KB' : '';
    const modified = d.modified ? new Date(d.modified).toLocaleDateString() : '';
    const checked = _brainState.selected.has(d.file) ? ' checked' : '';
    const archivedActions = isArchived
      ? '<button class="sm" onclick="event.stopPropagation();runBrainRestoreOne(\'' + attrEnc(d.file) + '\')">Restore</button>'
        + '<button class="sm danger" onclick="event.stopPropagation();runBrainDeleteOne(\'' + attrEnc(d.file) + '\')">Delete</button>'
      : '';
    // Pinned docs and Claude Code config files are harness-owned — no
    // Archive/Exclude/Delete, no selection checkbox.
    const disabled = isArchived || isPinnedProject || isConfig;
    const displayName = isConfig ? d.file.replace(/^claude-code\//, '') : d.file;
    const badge = isConfig ? '🔧' : esc(d.badge);
    const statusLabel = isConfig ? 'Claude Code config' : esc(BRAIN_STATUS_LABEL[d.status] || d.status);
    return '<div class="' + cls + '" onclick="selectBrainDoc(\'' + attrEnc(d.file) + '\')">'
      + '<input type="checkbox"' + checked + (disabled ? ' disabled' : '') + ' onclick="event.stopPropagation();toggleBrainDocSelected(\'' + attrEnc(d.file) + '\',this.checked)" />'
      + '<span class="badge">' + badge + '</span>'
      + '<span class="meta-col"><div class="fname">' + esc(displayName) + '</div>'
      + '<div class="sub">' + esc([modified, sizeKb].filter(Boolean).join(' · ')) + '</div></span>'
      + (archivedActions || '<span class="status-tag">' + statusLabel + '</span>')
      + '</div>';
  };
  const active = _brainState.docs.filter(d => !d.archived);
  const archived = _brainState.docs.filter(d => d.archived);
  let html = caveat + active.map(buildRow).join('');
  if (archived.length) {
    html += '<div class="archived-divider">Archived (' + archived.length + ')</div>' + archived.map(buildRow).join('');
  }
  el.innerHTML = html;
  updateBrainToolbar();
}

function toggleBrainDocSelected(file, checked) {
  const f = decodeURIComponent(file);
  if (checked) _brainState.selected.add(f); else _brainState.selected.delete(f);
  updateBrainToolbar();
}

function updateBrainToolbar() {
  const countEl = document.getElementById('brainSelCount');
  const excludeBtn = document.getElementById('brainExcludeBtn');
  const archiveBtn = document.getElementById('brainArchiveBtn');
  if (!countEl || !excludeBtn || !archiveBtn) return;
  const n = _brainState.selected.size;
  countEl.textContent = n + ' selected';
  excludeBtn.disabled = n === 0;
  archiveBtn.disabled = n === 0;
  if (n === 0) { excludeBtn.textContent = 'Exclude from context'; return; }
  const byFile = new Map(_brainState.docs.map(d => [d.file, d]));
  const allExcluded = [..._brainState.selected].every(f => (byFile.get(f) || {}).excluded);
  excludeBtn.textContent = allExcluded ? 'Restore to context' : 'Exclude from context';
}

async function runBrainExcludeAction() {
  const files = [..._brainState.selected];
  if (!files.length || !_brainState.project) return;
  const byFile = new Map(_brainState.docs.map(d => [d.file, d]));
  const allExcluded = files.every(f => (byFile.get(f) || {}).excluded);
  const excluded = !allExcluded; // "Restore" when everything selected is already excluded
  const btn = document.getElementById('brainExcludeBtn');
  if (btn) btn.disabled = true;
  try {
    await api('/brain/doc/exclude', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: _brainState.project, files, excluded })
    });
    hmToast(files.length + ' document' + (files.length === 1 ? '' : 's') + (excluded ? ' excluded from context' : ' restored to context'), 'ok');
    _brainState.selected = new Set();
    await loadBrainDocs(_brainState.project);
  } catch (e) {
    hmToast('Could not update exclusion.', 'err');
    if (btn) btn.disabled = false;
  }
}

async function runBrainArchiveAction() {
  const files = [..._brainState.selected];
  if (!files.length || !_brainState.project) return;
  const byFile = new Map(_brainState.docs.map(d => [d.file, d]));
  // Archiving the project's live main brief silently degrades every future
  // task for it — require an extra, explicit confirm beyond the normal one.
  const includesLiveBrief = files.some(f => (byFile.get(f) || {}).status === 'brief');
  const plural = files.length === 1 ? '' : 's';
  let message = 'This moves ' + files.length + ' document' + plural + ' out of active context, search, and the semantic index. '
    + 'They stay on disk under an archived state and can be restored later.';
  if (includesLiveBrief) {
    message = '⚠ This includes this project\'s MAIN BRIEF — the doc loaded in full into every task for it. '
      + 'Archiving it will silently degrade every future task\'s context.\n\n' + message;
  }
  const ok = await hmConfirm(message, { title: 'Archive selected documents?', okLabel: 'Archive', danger: true });
  if (!ok) return;
  const btn = document.getElementById('brainArchiveBtn');
  if (btn) btn.disabled = true;
  try {
    const r = await api('/brain/doc/archive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: _brainState.project, files })
    });
    hmToast((r && r.ok ? files.length : 0) + ' of ' + files.length + ' document' + plural + ' archived', (r && r.ok) ? 'ok' : 'err');
    _brainState.selected = new Set();
    await loadBrainDocs(_brainState.project);
  } catch (e) {
    hmToast('Could not archive — the file(s) were left in place.', 'err');
    if (btn) btn.disabled = false;
  }
}

async function runBrainRestoreOne(file) {
  const f = decodeURIComponent(file);
  if (!_brainState.project) return;
  try {
    await api('/brain/doc/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: _brainState.project, files: [f] })
    });
    hmToast('Restored.', 'ok');
    await loadBrainDocs(_brainState.project);
  } catch (e) {
    hmToast('Could not restore — the file was left in _archived/.', 'err');
  }
}

async function runBrainDeleteOne(file) {
  const f = decodeURIComponent(file);
  if (!_brainState.project) return;
  const ok = await hmConfirm(
    '⚠ This permanently deletes "' + f + '". Unlike Archive, this cannot be undone — the file will not stay on disk.',
    { title: 'Delete permanently?', okLabel: 'Delete forever', danger: true }
  );
  if (!ok) return;
  try {
    const r = await api('/brain/doc/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: _brainState.project, files: [f] })
    });
    if (r && r.ok) hmToast('Deleted permanently.', 'ok');
    else hmToast('Could not delete.', 'err');
    await loadBrainDocs(_brainState.project);
  } catch (e) {
    hmToast('Could not delete.', 'err');
  }
}

async function selectBrainDoc(file) {
  _brainState.doc = decodeURIComponent(file);
  renderBrainDocs();
  await loadBrainDocContent(_brainState.project, _brainState.doc);
}

let _brainDocCache = {};
async function loadBrainDocContent(project, file) {
  const key = project + '::' + file;
  if (_brainDocCache[key]) { _brainState.docContentError = false; _brainState.docContent = _brainDocCache[key]; renderBrainPane(); return; }
  _brainState.docContent = null;
  _brainState.docContentError = false;
  renderBrainPane();
  let r;
  try {
    r = await api('/brain/doc?project=' + encodeURIComponent(project) + '&file=' + encodeURIComponent(file));
  } catch (e) {
    if (_brainState.project === project && _brainState.doc === file) { _brainState.docContentError = true; renderBrainPane(); }
    return;
  }
  if (_brainState.project !== project || _brainState.doc !== file) return; // stale — operator moved on
  if (r && typeof r.content === 'string') { _brainDocCache[key] = r; _brainState.docContent = r; }
  else _brainState.docContentError = true;
  renderBrainPane();
}

function setBrainViewMode(mode) {
  _brainState.viewMode = mode;
  const rb = document.getElementById('brainBtnRendered'), rw = document.getElementById('brainBtnRaw');
  if (rb) rb.classList.toggle('active', mode === 'rendered');
  if (rw) rw.classList.toggle('active', mode === 'raw');
  renderBrainPaneBody();
}

function renderBrainPane() {
  const titleEl = document.getElementById('brainRenderTitle');
  const pathEl = document.getElementById('brainRenderPath');
  if (!titleEl || !pathEl) return;
  if (!_brainState.doc) {
    titleEl.textContent = 'Select a document';
    pathEl.textContent = '';
    renderBrainPaneBody();
    return;
  }
  titleEl.textContent = _brainState.doc;
  pathEl.textContent = (_brainState.docContent && _brainState.docContent.path) || (_brainState.project + '/' + _brainState.doc);
  renderBrainPaneBody();
}

function renderBrainPaneBody() {
  const body = document.getElementById('brainRenderBody');
  if (!body) return;
  if (!_brainState.doc) { body.className = 'brain-render-body'; body.innerHTML = '<div class="brain-empty-state">Click a document on the left to preview it here.</div>'; return; }
  if (_brainState.docContentError) { body.className = 'brain-render-body'; body.innerHTML = '<div class="brain-empty-state">Could not load this document.</div>'; return; }
  if (!_brainState.docContent) { body.className = 'brain-render-body'; body.innerHTML = '<div class="brain-empty-state">Loading…</div>'; return; }
  if (_brainState.viewMode === 'raw') {
    body.className = 'brain-render-body raw';
    body.textContent = _brainState.docContent.content;
    return;
  }
  // A real .html/.htm brain doc must not go through the markdown pipeline —
  // mdToHtml escapes-then-reparses, so actual HTML tags would show as garbled
  // literal text. Render it as HTML in a maximally-sandboxed iframe instead:
  // no scripts, no same-origin, no forms/popups — brain docs are local files,
  // but a synced/shared doc could still carry hostile markup, and this is the
  // daemon's own console origin (has the API token) so script execution here
  // must stay blocked regardless of trust in the content's source.
  if (/\.html?$/i.test(_brainState.doc)) {
    body.className = 'brain-render-body';
    body.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.style.cssText = 'width:100%;height:100%;min-height:60vh;border:1px solid var(--border);border-radius:6px;background:#fff';
    body.appendChild(frame);
    frame.srcdoc = _brainState.docContent.content;
    return;
  }
  // JSON config files (settings.json, .mcp.json, ...) render as a plain-English
  // summary, not a raw JSON blob — a novice operator shouldn't have to parse
  // braces and quotes to see "what am I allowing Claude Code to do here?".
  if (/\.json$/i.test(brainDocBaseName(_brainState.doc))) {
    body.className = 'brain-render-body';
    const friendly = renderBrainJsonFriendly(brainDocBaseName(_brainState.doc), _brainState.docContent.content);
    body.innerHTML = friendly || '<div class="brain-empty-state">Could not parse this file as JSON — see Raw.</div>';
    return;
  }
  body.className = 'brain-render-body';
  body.innerHTML = mdToHtml(_brainState.docContent.content);
}

function brainDocBaseName(file) {
  return file.replace(/^claude-code\//, '');
}

// ── Novice-friendly JSON rendering for Claude Code config files ──────────
function jsonFriendlyRow(label, valueHtml) {
  return '<div class="json-row"><span class="json-key">' + esc(label) + '</span><div class="json-val">' + valueHtml + '</div></div>';
}

function jsonFriendlyList(items) {
  if (!items || !items.length) return '<span class="muted">(none)</span>';
  return '<ul class="json-list">' + items.map(i => '<li><code>' + esc(String(i)) + '</code></li>').join('') + '</ul>';
}

// Bounded, defensive recursive renderer for whatever keys a settings/mcp file
// doesn't have a named summary for above — still readable, never raw braces.
function renderGenericJsonTree(value, depth) {
  depth = depth || 0;
  if (depth > 6) return '<span class="muted">…</span>';
  if (value === null || value === undefined) return '<span class="muted">—</span>';
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="muted">(none)</span>';
    return '<ul class="json-list">' + value.map(v => '<li>' + renderGenericJsonTree(v, depth + 1) + '</li>').join('') + '</ul>';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '<span class="muted">(none)</span>';
    return '<ul class="json-list">' + keys.map(k => '<li><b>' + esc(k) + '</b>: ' + renderGenericJsonTree(value[k], depth + 1) + '</li>').join('') + '</ul>';
  }
  if (typeof value === 'boolean') return '<code>' + (value ? 'yes' : 'no') + '</code>';
  return '<code>' + esc(String(value)) + '</code>';
}

function renderSettingsJsonFriendly(data) {
  let html = '<div class="json-friendly">';
  if (data.model) html += jsonFriendlyRow('Model', '<code>' + esc(data.model) + '</code>');
  if (data.permissions) {
    if (data.permissions.allow) html += jsonFriendlyRow('Allowed without asking', jsonFriendlyList(data.permissions.allow));
    if (data.permissions.ask) html += jsonFriendlyRow('Asks for confirmation', jsonFriendlyList(data.permissions.ask));
    if (data.permissions.deny) html += jsonFriendlyRow('Never allowed', jsonFriendlyList(data.permissions.deny));
  }
  if (data.env && Object.keys(data.env).length) {
    html += jsonFriendlyRow('Environment variables', '<ul class="json-list">' + Object.entries(data.env).map(([k, v]) =>
      '<li><code>' + esc(k) + '</code> = <code>' + esc(String(v)) + '</code></li>').join('') + '</ul>');
  }
  if (data.hooks && Object.keys(data.hooks).length) {
    html += jsonFriendlyRow('Hooks (run automatically on these events)', '<ul class="json-list">' + Object.entries(data.hooks).map(([event, defs]) => {
      const list = Array.isArray(defs) ? defs : [defs];
      const cmds = list.flatMap(d => (d && Array.isArray(d.hooks)) ? d.hooks.map(h => h && h.command).filter(Boolean) : (d && d.command ? [d.command] : []));
      return '<li><b>' + esc(event) + '</b>: ' + (cmds.length ? cmds.map(c => '<code>' + esc(c) + '</code>').join(', ') : '<span class="muted">configured</span>') + '</li>';
    }).join('') + '</ul>');
  }
  const statusLine = data.statusLine || data.statusline;
  if (statusLine) html += jsonFriendlyRow('Status line', '<code>' + esc(typeof statusLine === 'string' ? statusLine : JSON.stringify(statusLine)) + '</code>');
  const known = ['model', 'permissions', 'env', 'hooks', 'statusLine', 'statusline'];
  const rest = Object.keys(data).filter(k => !known.includes(k));
  if (rest.length) html += jsonFriendlyRow('Other settings', renderGenericJsonTree(Object.fromEntries(rest.map(k => [k, data[k]]))));
  if (!data.model && !data.permissions && !data.env && !data.hooks && !statusLine && !rest.length) {
    html += '<div class="muted">This settings file is empty.</div>';
  }
  html += '</div>';
  return html;
}

function renderMcpJsonFriendly(data) {
  const servers = data.mcpServers || data.servers || {};
  const names = Object.keys(servers);
  let html = '<div class="json-friendly">';
  if (!names.length) {
    html += '<div class="muted">No MCP servers configured in this file.</div>';
  } else {
    html += jsonFriendlyRow('MCP servers (' + names.length + ')', '<ul class="json-list">' + names.map(name => {
      const s = servers[name] || {};
      const type = s.type || (s.url ? 'remote (http/sse)' : 'local (stdio)');
      const detail = s.url ? esc(s.url) : [s.command, ...(Array.isArray(s.args) ? s.args : [])].filter(Boolean).map(esc).join(' ');
      return '<li><b>' + esc(name) + '</b> <span class="muted">— ' + esc(type) + '</span>'
        + (detail ? '<div><code>' + detail + '</code></div>' : '') + '</li>';
    }).join('') + '</ul>');
  }
  html += '</div>';
  return html;
}

function renderBrainJsonFriendly(baseName, content) {
  let data;
  try { data = JSON.parse(content); } catch (e) { return null; }
  if (/^settings(\.local)?\.json$/i.test(baseName)) return renderSettingsJsonFriendly(data);
  if (/^\.?mcp\.json$/i.test(baseName)) return renderMcpJsonFriendly(data);
  return '<div class="json-friendly">' + renderGenericJsonTree(data) + '</div>';
}

// ── Roles screen (Spec2 Phase1) — browse each agent profile: identity,
// resolved model, tool allowlist, real usage stats, and the prompt itself.
// Structurally mirrors the Brain screen (brainPanelHtml/showBrain/…, above):
// left = roster list, center = the selected role's dossier, right = prompt
// viewer with a Rendered/Raw toggle. Reuses the .brain-shell/.brain-col/
// .brain-render-* CSS — same generic three-pane layout, different content. ──

let _rolesState = {
  panelOpen: false,
  profiles: [],       // [{id,name,description,icon,tools,loadClaudeMd,modelRole,tier,isCustom,promptLines}]
  profilesError: false,
  role: null,         // selected profile id
  detail: null,        // GET /agents/profiles/:id response (has systemPrompt)
  detailError: false,
  stats: null,         // GET /agents/profiles/:id/stats response
  skills: null,        // GET /agents/profiles/:id/skills response (skills array)
  viewMode: 'rendered',
  editing: false,      // true while the prompt textarea is open
  draft: null,          // in-progress edited text, kept separate from detail.systemPrompt
  saving: false,
};

const ROLES_TIER_LABEL = { core: 'Core', coordinator: 'Coordinator', domain: 'Domain' };

function rolesPanelHtml() {
  return '<div class="oc-center-pane" style="max-width:none">'
    + '<div class="oc-panel-head">'
    + '<div><div class="oc-panel-title"><span>👥</span><span>Roles</span></div>'
    + '<div class="oc-panel-sub">What each agent role actually is — prompt, tools, model, and real usage</div></div>'
    + '<span class="oc-panel-head-spacer"></span>'
    + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button>'
    + '</div>'
    + '<div class="brain-pane" style="padding:0;height:auto;max-height:none">'
    + '<div class="brain-shell">'
    + '<div class="brain-col">'
    + '<div class="brain-col-head">Roster</div>'
    + '<div class="brain-col-body" id="rolesRosterList"><div class="muted" style="padding:12px">Loading…</div></div>'
    + '</div>'
    + '<div class="brain-col">'
    + '<div class="brain-col-head"><span id="rolesDossierTitle">Dossier</span></div>'
    + '<div class="brain-col-body" id="rolesDossierBody"><div class="muted" style="padding:12px">Select a role.</div></div>'
    + '</div>'
    + '<div class="brain-col">'
    + '<div class="brain-render-head">'
    + '<div style="min-width:0"><div class="brain-render-title" id="rolesPromptTitle">Select a role</div>'
    + '<span class="path" id="rolesPromptSub"></span></div>'
    + '<div style="display:flex;align-items:center;gap:6px">'
    + '<div class="brain-toggle-group" id="rolesViewToggle">'
    + '<button id="rolesBtnRendered" class="active" onclick="setRolesViewMode(\'rendered\')">Rendered</button>'
    + '<button id="rolesBtnRaw" onclick="setRolesViewMode(\'raw\')">Raw</button>'
    + '</div>'
    + '<button class="sm" id="rolesEditBtn" onclick="startRoleEdit()" style="display:none">Edit</button>'
    + '<button class="sm danger" id="rolesResetBtn" onclick="resetRoleToDefault()" style="display:none" title="Delete the custom override, reverting to the built-in prompt">Reset to default</button>'
    + '</div></div>'
    + '<div class="brain-render-body" id="rolesPromptBody"><div class="brain-empty-state">Click a role on the left to read its system prompt here.</div></div>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '</div>';
}

function renderRolesPanel() {
  if (!_rolesState.panelOpen) return;
  const session = document.getElementById('session');
  if (!session) return;
  setFlashSessionMode(true);
  session.innerHTML = rolesPanelHtml();
  renderRolesRoster();
  renderRoleDossier();
  renderRolesPromptPane();
}

function showRoles() {
  state.selected = null;
  state.selectedSkillOrCommand = null;
  _skSel = '';
  _ctxTask = null;
  if (_taskFormInSession) _closeNewTaskPanel();
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = true;
  _toolsState.panelOpen = false;
  _goalsState.panelOpen = false;
  setStoredView('roles');
  renderBoard();
  renderSkillList();
  renderRolesPanel();
  updateFlashNav();
  updateBrainNav();
  updateRolesNav();
  updateToolsNav();
  updateGoalsNav();
  loadRolesRoster();
}

function updateRolesNav() { syncNav(); }

// ── Tools / Capabilities panel ─────────────────────────────────────────
// Read-only inventory of everything the assistant can do: native lane tools,
// flash-only tools, curated skills-as-tools, and the full skill library — each
// with its schema and the file that backs it. Data: GET /capabilities.
let _toolsState = { panelOpen: false, groups: null, error: false, expanded: {} };
// Search box query text, persisted across re-renders. Only toolsQueryInput()
// updates this — renderToolsPanel() must not reset it, so unrelated re-renders
// (e.g. toggleToolExpand) don't clear what the operator typed.
let _toolsQuery = '';

function showTools() {
  state.selected = null;
  state.selectedSkillOrCommand = null;
  _skSel = '';
  _ctxTask = null;
  if (_taskFormInSession) _closeNewTaskPanel();
  _flashState.panelOpen = false;
  _brainState.panelOpen = false;
  _rolesState.panelOpen = false;
  _toolsState.panelOpen = true;
  _goalsState.panelOpen = false;
  setStoredView('tools');
  renderBoard();
  renderSkillList();
  renderToolsPanel();
  updateFlashNav();
  updateBrainNav();
  updateRolesNav();
  updateToolsNav();
  updateGoalsNav();
  loadCapabilities();
}

function updateToolsNav() { syncNav(); }

async function loadCapabilities() {
  _toolsState.error = false;
  try {
    const r = await api('/capabilities');
    _toolsState.groups = (r && r.groups) || [];
  } catch (e) {
    _toolsState.error = true;
    _toolsState.groups = null;
  }
  renderToolsPanel();
  if (_pendingScrollRestore === 'tools') { _pendingScrollRestore = null; restoreScrollPosition('tools'); }
}

const TOOLS_GROUP_META = {
  "native": { title: "Native tools", sub: "built-in lane tools the assistant calls directly" },
  "flash": { title: "Chat tools", sub: "flash-only tools (escalate, learn a skill, deep think…)" },
  "skill-tool": { title: "Skills as tools", sub: "curated learned skills promoted to first-class tools" },
  "skill-library": { title: "Skill library", sub: "the full learned-skill catalog (run via skill_run)" }
};

function toolsSchemaSummary(schema) {
  if (!schema || typeof schema !== 'object') return '';
  const props = schema.properties || {};
  const keys = Object.keys(props);
  if (!keys.length) return 'no parameters';
  const req = new Set(schema.required || []);
  return keys.map(function (k) { return k + (req.has(k) ? '*' : ''); }).join(', ');
}

function renderToolsPanel() {
  if (!_toolsState.panelOpen) return;
  const session = document.getElementById('session');
  if (!session) return;
  setFlashSessionMode(true);
  if (_toolsState.error) {
    session.innerHTML = '<div class="oc-center-pane"><div class="oc-panel-head"><div><div class="oc-panel-title"><span>🛠️ Tools</span></div><div class="oc-panel-sub">Capabilities inventory</div></div><span class="oc-panel-head-spacer"></span><button class="linklike ov-back" onclick="showOverview()">← Overview</button></div><div class="tools-pane"><div class="oc-empty">Could not load capabilities. <a href="#" onclick="event.preventDefault();loadCapabilities()">Retry</a></div></div></div>';
    return;
  }
  const groups = _toolsState.groups;
  let body;
  if (!groups) {
    body = '<div class="oc-empty">Loading capabilities…</div>';
  } else {
    // Real-time search: same predicate shape as renderSkillList's sidebar
    // filter (console.ts ~3598-3603) — lowercase, split into terms, AND-match
    // every term as a substring of the combined name+description+kind text.
    const q = _toolsQuery.toLowerCase().trim();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const visibleGroups = groups.map(function (g) {
      let tools = g.tools || [];
      if (terms.length) {
        tools = tools.filter(function (t) {
          const hay = (t.name + ' ' + (t.description || '') + ' ' + (g.kind || '')).toLowerCase();
          return terms.every(function (term) { return hay.includes(term); });
        });
      }
      return { kind: g.kind, tools: tools };
    }).filter(function (g) { return !terms.length || g.tools.length > 0; }); // skip empty groups only while actively searching

    let total = 0;
    visibleGroups.forEach(function (g) { total += g.tools.length; });
    body = '<div class="muted" style="padding:6px 18px;font-size:12px">' + total + ' capabilities across ' + visibleGroups.length + ' groups</div>';
    if (terms.length && !visibleGroups.length) {
      body += '<div class="oc-empty">No tools match your search.</div>';
    }
    for (const g of visibleGroups) {
      const meta = TOOLS_GROUP_META[g.kind] || { title: g.kind, sub: '' };
      const tools = g.tools;
      body += '<div class="tools-group"><div class="tools-group-h">' + esc(meta.title)
        + ' <span class="count">' + tools.length + '</span></div>'
        + '<div class="tools-group-sub">' + esc(meta.sub) + '</div>';
      for (const t of tools) {
        const key = g.kind + ':' + t.name;
        const open = !!_toolsState.expanded[key];
        const enabled = g.kind === 'native' ? (t.enabled !== false) : (g.kind === 'skill-library' ? false : true);
        const dotCls = g.kind === 'skill-library' ? 'lib' : (enabled ? 'on' : 'off');
        const dotTitle = g.kind === 'skill-library' ? 'reachable via skill_run' : (enabled ? 'available' : 'gated off');
        const dot = '<span class="tools-dot ' + dotCls + '" title="' + dotTitle + '"></span>';
        const kindChip = '<span class="tools-kind">' + esc(g.kind === 'skill-tool' ? 'skill→tool' : g.kind === 'skill-library' ? 'skill' : g.kind) + '</span>';
        const file = t.sourceRef || t.file || '';
        const fileShort = file ? String(file).split('/').pop() : '';
        const schemaStr = toolsSchemaSummary(t.schema) || (t.params && t.params.length ? t.params.join(', ') : '');
        const statusLabel = g.kind === 'skill-library' ? 'via skill_run' : (enabled ? 'available' : 'gated off');

        // Left column: identity + the structured fields that used to hide behind the
        // expander. Right column: the full description paragraph (never clamped).
        let fields = '<div class="tools-fields">';
        fields += '<div class="tools-field"><span class="fk">status</span>'
          + '<span class="fv"><span class="tools-status ' + dotCls + '">' + esc(statusLabel) + '</span></span></div>';
        if (t.capability) fields += '<div class="tools-field"><span class="fk">capability</span><span class="fv mono">' + esc(t.capability) + '</span></div>';
        if (g.kind === 'skill-library' && t.kind) fields += '<div class="tools-field"><span class="fk">kind</span><span class="fv">' + esc(t.kind) + '</span></div>';
        if (t.skillName) fields += '<div class="tools-field"><span class="fk">skill</span><span class="fv">' + esc(t.skillName) + '</span></div>';
        if (schemaStr) fields += '<div class="tools-field"><span class="fk">params</span><span class="fv mono" title="' + attrEnc(schemaStr) + '">' + esc(schemaStr) + '</span></div>';
        if (fileShort) fields += '<div class="tools-field"><span class="fk">source</span><span class="fv mono" title="' + attrEnc(file) + '">' + esc(fileShort) + '</span></div>';
        fields += '</div>';

        body += '<div class="tools-row" onclick="toggleToolExpand(\'' + attrEnc(key) + '\')">'
          + '<div class="tools-idcol">'
          + '<div class="tools-row-top">' + dot + '<span class="tools-name">' + esc(t.name) + '</span>' + kindChip
          + '<span class="tools-caret" title="' + (open ? 'collapse' : 'expand full record') + '">' + (open ? '▾' : '▸') + '</span></div>'
          + fields + '</div>'
          + '<div class="tools-desc">' + esc(t.description || 'No description provided.') + '</div>';
        if (open) {
          body += '<div class="tools-detail" onclick="event.stopPropagation()">';
          if (file) body += '<div><span class="tools-k">file</span> <code>' + esc(file) + '</code></div>';
          if (t.claudeMirror) body += '<div><span class="tools-k">claude</span> <code>' + esc(t.claudeMirror) + '</code></div>';
          if (t.scope) body += '<div><span class="tools-k">scope</span> ' + esc(t.scope) + '</div>';
          if (t.source) body += '<div><span class="tools-k">origin</span> ' + esc(t.source) + '</div>';
          body += '</div>';
        }
        body += '</div>';
      }
      body += '</div>';
    }
  }
  session.innerHTML = '<div class="oc-center-pane">'
    + '<div class="oc-panel-head"><div><div class="oc-panel-title"><span>🛠️ Tools</span></div>'
    + '<div class="oc-panel-sub">Everything the assistant can do — and what backs it</div></div>'
    + '<span class="oc-panel-head-spacer"></span>'
    + '<button class="linklike ov-back" onclick="showOverview()" title="Back to overview (Esc)">← Overview</button></div>'
    + '<div class="sk-toolbar" style="margin-bottom:0">'
    + '<input id="toolsQuery" placeholder="Search tools…" oninput="toolsQueryInput()" value="' + attrEnc(_toolsQuery) + '" />'
    + '</div>'
    + '<div class="tools-pane">' + body + '</div></div>';
}

function toolsQueryInput() {
  _toolsQuery = (document.getElementById('toolsQuery') || {}).value || '';
  renderToolsPanel();
}

function toggleToolExpand(key) {
  _toolsState.expanded[key] = !_toolsState.expanded[key];
  renderToolsPanel();
}

async function loadRolesRoster() {
  _rolesState.profilesError = false;
  try {
    const r = await api('/agents/profiles');
    _rolesState.profiles = (r && r.profiles) || [];
  } catch (e) {
    _rolesState.profilesError = true;
    _rolesState.profiles = [];
  }
  if (!_rolesState.role && _rolesState.profiles.length) _rolesState.role = _rolesState.profiles[0].id;
  renderRolesRoster();
  if (_rolesState.role) await loadRoleDetail(_rolesState.role);
}

function renderRolesRoster() {
  const el = document.getElementById('rolesRosterList');
  if (!el) return;
  if (_rolesState.profilesError) { el.innerHTML = '<div class="muted" style="padding:12px">Could not reach the daemon. <a href="#" onclick="event.preventDefault();loadRolesRoster()">Retry</a></div>'; return; }
  if (!_rolesState.profiles.length) { el.innerHTML = '<div class="muted" style="padding:12px">No agent profiles found.</div>'; return; }
  const byTier = { core: [], coordinator: [], domain: [] };
  for (const p of _rolesState.profiles) (byTier[p.tier] || byTier.core).push(p);
  const row = p => {
    const cls = 'brain-proj-row' + (p.id === _rolesState.role ? ' active' : '');
    const customChip = p.isCustom ? '<span class="count" style="margin-left:4px" title="Custom override">✎</span>' : '';
    return '<div class="' + cls + '" onclick="selectRole(\'' + attrEnc(p.id) + '\')">'
      + '<span><span class="name">' + esc(p.icon || '') + ' ' + esc(p.name) + '</span></span>'
      + '<span>' + customChip + '</span></div>';
  };
  let html = '';
  for (const tier of ['core', 'coordinator', 'domain']) {
    if (!byTier[tier].length) continue;
    html += '<div class="brain-col-head" style="font-size:10px;padding:6px 14px">' + ROLES_TIER_LABEL[tier] + '</div>' + byTier[tier].map(row).join('');
  }
  el.innerHTML = html;
}

async function selectRole(id) {
  _rolesState.role = decodeURIComponent(id);
  _rolesState.editing = false;
  _rolesState.draft = null;
  renderRolesRoster();
  await loadRoleDetail(_rolesState.role);
}

async function loadRoleDetail(id) {
  _rolesState.detail = null;
  _rolesState.detailError = false;
  _rolesState.stats = null;
  _rolesState.skills = null;
  renderRoleDossier();
  renderRolesPromptPane();
  let detail, stats, skillsRes;
  try {
    [detail, stats, skillsRes] = await Promise.all([
      api('/agents/profiles/' + encodeURIComponent(id)),
      api('/agents/profiles/' + encodeURIComponent(id) + '/stats'),
      api('/agents/profiles/' + encodeURIComponent(id) + '/skills'),
    ]);
  } catch (e) {
    if (_rolesState.role !== id) return; // stale — operator moved on
    _rolesState.detailError = true;
    renderRoleDossier();
    renderRolesPromptPane();
    return;
  }
  if (_rolesState.role !== id) return; // stale response
  _rolesState.detail = detail || null;
  _rolesState.stats = stats || null;
  _rolesState.skills = (skillsRes && skillsRes.skills) || [];
  if (!detail) _rolesState.detailError = true;
  renderRoleDossier();
  renderRolesPromptPane();
}

function fmtRoleDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  return (s / 60).toFixed(1) + 'm';
}

function fmtRoleRelativeTime(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

function renderRoleDossier() {
  const titleEl = document.getElementById('rolesDossierTitle');
  const body = document.getElementById('rolesDossierBody');
  if (!body) return;
  if (!_rolesState.role) { if (titleEl) titleEl.textContent = 'Dossier'; body.innerHTML = '<div class="muted" style="padding:12px">Select a role.</div>'; return; }
  if (_rolesState.detailError) { body.innerHTML = '<div class="muted" style="padding:12px">Could not load this role. <a href="#" onclick="event.preventDefault();loadRoleDetail(_rolesState.role)">Retry</a></div>'; return; }
  const d = _rolesState.detail;
  if (titleEl) titleEl.textContent = d ? (d.icon + ' ' + d.name) : _rolesState.role;
  if (!d) { body.innerHTML = '<div class="muted" style="padding:12px">Loading…</div>'; return; }

  const identity = '<div class="roles-block">'
    + '<div class="roles-block-head">Identity</div>'
    + '<div class="roles-block-body">'
    + '<p style="margin:0 0 8px">' + esc(d.description) + '</p>'
    + '<span class="badge">' + (d.isCustom ? 'Custom' : 'Built-in') + '</span> '
    + '<span class="badge">' + esc(ROLES_TIER_LABEL[d.tier] || d.tier) + '</span>'
    + '</div></div>';

  const toolsHtml = d.tools.length
    ? d.tools.map(t => '<span class="badge" style="margin:0 4px 4px 0">' + esc(t) + '</span>').join('')
    : '<span class="muted">No tools — conversational only</span>';
  const configuration = '<div class="roles-block">'
    + '<div class="roles-block-head">Configuration</div>'
    + '<div class="roles-block-body">'
    + '<div class="kv"><span class="k">model</span><span>' + (d.modelRole ? esc(d.modelRole) + ' role' : 'default') + '</span></div>'
    + '<div class="kv"><span class="k">CLAUDE.md</span><span>' + (d.loadClaudeMd ? 'loaded' : 'not loaded') + '</span></div>'
    + '<div style="margin-top:6px">' + toolsHtml + '</div>'
    + '</div></div>';

  const s = _rolesState.stats;
  let insightBody;
  if (!s || s.totalRuns === 0) {
    insightBody = '<div class="muted">This role has never run. Enable <b>Specialist agents</b> in Settings → Features, or pick it explicitly on a new task.</div>';
  } else {
    const rate = s.successRate == null ? 'not enough data' : Math.round(s.successRate * 100) + '%';
    const statusRows = Object.entries(s.byStatus).map(([k, v]) => '<div class="kv"><span class="k">' + esc(k) + '</span><span>' + v + '</span></div>').join('');
    insightBody = '<div class="kv"><span class="k">total runs</span><span>' + s.totalRuns + '</span></div>'
      + statusRows
      + '<div class="kv"><span class="k">success rate</span><span>' + rate + '</span></div>'
      + '<div class="kv"><span class="k">last run</span><span>' + esc(fmtRoleRelativeTime(s.lastRunAt)) + '</span></div>'
      + '<div class="kv"><span class="k">median duration</span><span>' + esc(fmtRoleDuration(s.medianDurationMs)) + '</span></div>';
  }
  const insight = '<div class="roles-block">'
    + '<div class="roles-block-head">Insight</div>'
    + '<div class="roles-block-body">' + insightBody + '</div></div>';

  const sk = _rolesState.skills;
  let learnedBody;
  if (sk === null) {
    learnedBody = '<div class="muted">Loading…</div>';
  } else if (sk.length === 0) {
    learnedBody = '<div class="muted">No skills learned yet. Roles begin authoring skills once retrospection is wired.</div>';
  } else {
    learnedBody = sk.map(s => '<div class="kv"><span class="k">' + esc(s.name) + (s.trusted ? '' : ' <span class="sk-badge warn" title="distilled from a retrospective — approve in the Skills panel before agents use it">untrusted — review</span>') + '</span><span>' + (s.useCount > 0 ? 'used ' + s.useCount + '×' : 'unused') + '</span></div>').join('');
  }
  const learned = '<div class="roles-block">'
    + '<div class="roles-block-head">Learned</div>'
    + '<div class="roles-block-body">' + learnedBody + '</div></div>';

  body.innerHTML = identity + configuration + insight + learned;
}

function setRolesViewMode(mode) {
  _rolesState.viewMode = mode;
  const rb = document.getElementById('rolesBtnRendered'), rw = document.getElementById('rolesBtnRaw');
  if (rb) rb.classList.toggle('active', mode === 'rendered');
  if (rw) rw.classList.toggle('active', mode === 'raw');
  renderRolesPromptBody();
}

function renderRolesPromptPane() {
  const titleEl = document.getElementById('rolesPromptTitle');
  const subEl = document.getElementById('rolesPromptSub');
  const editBtn = document.getElementById('rolesEditBtn');
  const resetBtn = document.getElementById('rolesResetBtn');
  const toggle = document.getElementById('rolesViewToggle');
  if (!titleEl || !subEl) return;
  const d = _rolesState.detail;
  if (!_rolesState.role) { titleEl.textContent = 'Select a role'; subEl.textContent = ''; }
  else { titleEl.textContent = d ? (d.icon + ' ' + d.name) : _rolesState.role; subEl.textContent = d ? d.promptLines + ' lines' : ''; }
  // Editing hides the view-mode toggle and Edit/Reset (replaced by Save/Cancel
  // inside the body) — showing both would let the operator flip Rendered/Raw
  // mid-edit and lose the distinction between "viewing" and "editing".
  const showControls = !!d && !_rolesState.editing;
  if (editBtn) editBtn.style.display = showControls ? '' : 'none';
  if (resetBtn) resetBtn.style.display = (showControls && d.isCustom) ? '' : 'none';
  if (toggle) toggle.style.display = showControls ? '' : 'none';
  renderRolesPromptBody();
}

function renderRolesPromptBody() {
  const body = document.getElementById('rolesPromptBody');
  if (!body) return;
  if (!_rolesState.role) { body.className = 'brain-render-body'; body.innerHTML = '<div class="brain-empty-state">Click a role on the left to read its system prompt here.</div>'; return; }
  if (_rolesState.detailError) { body.className = 'brain-render-body'; body.innerHTML = '<div class="brain-empty-state">Could not load this role.</div>'; return; }
  const d = _rolesState.detail;
  if (!d) { body.className = 'brain-render-body'; body.innerHTML = '<div class="brain-empty-state">Loading…</div>'; return; }
  if (_rolesState.editing) {
    body.className = 'brain-render-body';
    body.innerHTML = '<textarea id="rolesEditTextarea" style="width:100%;min-height:320px;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:10px" oninput="_rolesState.draft=this.value"></textarea>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="cancel" onclick="cancelRoleEdit()">Cancel</button>'
      + '<button class="create" id="rolesSaveBtn" onclick="saveRoleEdit()">Save</button>'
      + '</div>';
    const ta = document.getElementById('rolesEditTextarea');
    if (ta) ta.value = _rolesState.draft != null ? _rolesState.draft : d.systemPrompt;
    return;
  }
  if (_rolesState.viewMode === 'raw') {
    body.className = 'brain-render-body raw';
    body.textContent = d.systemPrompt;
    return;
  }
  body.className = 'brain-render-body';
  body.innerHTML = mdToHtml(d.systemPrompt);
}

function startRoleEdit() {
  if (!_rolesState.detail) return;
  _rolesState.editing = true;
  _rolesState.draft = _rolesState.detail.systemPrompt;
  renderRolesPromptPane();
}

function cancelRoleEdit() {
  _rolesState.editing = false;
  _rolesState.draft = null;
  renderRolesPromptPane();
}

async function saveRoleEdit() {
  const id = _rolesState.role;
  const ta = document.getElementById('rolesEditTextarea');
  const systemPrompt = ta ? ta.value : _rolesState.draft;
  if (!systemPrompt || !systemPrompt.trim()) { hmToast('Prompt cannot be empty.', 'err'); return; }
  const btn = document.getElementById('rolesSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const d = _rolesState.detail || {};
    await api('/agents/profiles/' + encodeURIComponent(id), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt, name: d.name, description: d.description, tools: d.tools,
        loadClaudeMd: d.loadClaudeMd, icon: d.icon, modelRole: d.modelRole, tier: d.tier,
      }),
    });
    hmToast('Saved — takes effect on the next task using this role, no restart needed.', 'ok');
    _rolesState.editing = false;
    _rolesState.draft = null;
    await loadAgentProfiles(); // refresh isCustom/promptLines everywhere (New Task picker, roster list)
    await loadRoleDetail(id);
  } catch (e) {
    hmToast('Could not save: ' + (e instanceof Error ? e.message : String(e)), 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

async function resetRoleToDefault() {
  const id = _rolesState.role;
  if (!id) return;
  const ok = await hmConfirm('Reset ' + id + ' to its default prompt? This deletes the custom override — it cannot be undone.');
  if (!ok) return;
  try {
    await api('/agents/profiles/' + encodeURIComponent(id), { method: 'DELETE' });
    hmToast('Reset to default.', 'ok');
    await loadAgentProfiles();
    await loadRoleDetail(id);
  } catch (e) {
    hmToast('Could not reset: ' + (e instanceof Error ? e.message : String(e)), 'err');
  }
}

function flashRenderMessages() {
  const el = document.getElementById('flashTranscript');
  if (!el) return;
  const msgs = _flashState.messages;
  if (!msgs.length) {
    el.innerHTML = '<div class="muted" style="font-size:13px;padding:8px 0">No messages yet. Say hello!</div>';
    return;
  }
  el.innerHTML = msgs.map(function(m) {
    const ts = m.ts ? new Date(m.ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
    const roleLabel = m.role === 'assistant' ? '🌀' : (m.role === 'user' ? 'You' : m.role);
    let toolHtml = '';
    if (m.toolLines && m.toolLines.length) {
      toolHtml = '<div style="margin:4px 0 2px;font-size:11px;color:var(--muted)">'
        + m.toolLines.map(function(tl) {
          if (tl.type === 'escalated') {
            return '<div style="color:var(--accent)">↗ Escalated to task ' + esc(tl.taskId || '') + '</div>';
          }
          const icon = tl.type === 'result' ? (tl.ok ? '✓' : '✗') : '⏳';
          const nameStr = esc(tl.name || '');
          const summaryStr = tl.type === 'result' ? esc(tl.resultSummary || '') : esc(tl.summary || '');
          const color = tl.type === 'result' ? (tl.ok ? 'var(--ok)' : 'var(--err)') : 'var(--muted)';
          return '<div style="color:' + color + '">' + icon + ' ' + nameStr + (summaryStr ? ' — ' + summaryStr : '') + '</div>';
        }).join('') + '</div>';
    }
    const streamingCursor = (m.streaming && m.role === 'assistant') ? '<span style="opacity:.5">▌</span>' : '';
    const imgs = (m.images && m.images.length)
      ? '<div class="oc-img-preview" style="padding:0 0 5px">' + m.images.map(function (u) {
          return '<div class="oc-img-chip"><img src="' + u + '" alt="attached"></div>';
        }).join('') + '</div>'
      : '';
    return '<div class="oc-msg oc-msg-' + esc(m.role) + '">'
      + '<div class="oc-msg-meta">' + esc(roleLabel) + (ts ? ' · ' + ts : '') + '</div>'
      + toolHtml + imgs
      + '<div class="oc-msg-text">' + esc(m.content || '').replace(/\n/g, '<br>') + streamingCursor + '</div>'
      + '</div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
  if (_pendingScrollRestore === 'flash') { _pendingScrollRestore = null; restoreScrollPosition('flash'); }
}

// Attach photos to the next chat turn — the assistant can SEE them (sent as
// imagesBase64 data URLs; the daemon decodes + lets the model Read them).
// Read ONE image File into a pending attachment. Shared by all three ways to
// attach: the 📎 file picker, paste (Cmd+V a screenshot), and drag-and-drop.
function flashAddImageFile(f) {
  if (!f || !/^image\//.test(f.type)) return false;
  if (_flashState.pendingImages.length >= 6) return false;
  const fr = new FileReader();
  fr.onload = function () {
    _flashState.pendingImages.push({ dataUrl: String(fr.result), name: f.name || 'pasted-image' });
    renderFlashImgPreview();
    const sendBtn = document.getElementById('flashSendBtn');
    if (sendBtn) sendBtn.disabled = false;
  };
  fr.readAsDataURL(f);
  return true;
}
function flashPhotoSelected(inputEl) {
  Array.from(inputEl.files || []).slice(0, 6).forEach(flashAddImageFile);
  inputEl.value = ''; // allow re-selecting the same file
}
// Cmd+V an image (e.g. a Claude Code screenshot) straight into the composer.
// Without this, a pasted image is silently dropped and the turn goes out blind.
function flashPaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  let added = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && /^image\//.test(items[i].type || '')) {
      if (flashAddImageFile(items[i].getAsFile())) added = true;
    }
  }
  if (added) e.preventDefault(); // don't also paste the blank/filename as text
}
// Drag an image file onto the composer.
function flashDrop(e) {
  e.preventDefault();
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('oc-drag');
  Array.from((e.dataTransfer && e.dataTransfer.files) || []).slice(0, 6).forEach(flashAddImageFile);
}

function renderFlashImgPreview() {
  const el = document.getElementById('flashImgPreview');
  if (!el) return;
  el.innerHTML = _flashState.pendingImages.map(function (img, i) {
    return '<div class="oc-img-chip"><img src="' + img.dataUrl + '" alt="attached">'
      + '<button class="rm" title="Remove" onclick="flashRemoveImg(' + i + ')">✕</button></div>';
  }).join('');
}

function flashRemoveImg(i) {
  _flashState.pendingImages.splice(i, 1);
  renderFlashImgPreview();
  const input = document.getElementById('flashInput');
  const sendBtn = document.getElementById('flashSendBtn');
  if (sendBtn) sendBtn.disabled = !((input && input.value.trim()) || _flashState.pendingImages.length);
}

async function flashSend() {
  const input = document.getElementById('flashInput');
  const sendBtn = document.getElementById('flashSendBtn');
  const images = _flashState.pendingImages.slice();
  if (!input || (!input.value.trim() && !images.length) || _flashState.sending) return;
  const msg = input.value.trim();
  _flashState.sending = true;
  if (sendBtn) sendBtn.disabled = true;
  input.value = '';
  _flashState.pendingImages = [];
  renderFlashImgPreview();
  flashInputResize(input);
  updateFlashNav();

  _flashState.messages.push({ role: 'user', content: msg || (images.length ? '📷 Photo' : ''), ts: Date.now(), images: images.map(i => i.dataUrl) });
  const assistantIdx = _flashState.messages.length;
  _flashState.messages.push({ role: 'assistant', content: '', ts: Date.now(), streaming: true, toolLines: [] });
  flashRenderMessages();

  const reqBody = JSON.stringify(Object.assign(
    { channel: 'console', peer: 'operator', text: msg },
    images.length ? { imagesBase64: images.map(i => i.dataUrl) } : {},
    _flashState.sessionId ? { sessionId: _flashState.sessionId } : {}
  ));

  let accText = '';
  let toolLines = [];

  try {
    const res = await fetch('/flash/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HM_TOKEN },
      body: reqBody
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let doneData = null;

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        let evt = '', dataStr = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) evt = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
        }
        if (!evt || !dataStr) continue;
        let d;
        try { d = JSON.parse(dataStr); } catch (e) { continue; }
        if (evt === 'token') {
          accText += d.delta || '';
          _flashState.messages[assistantIdx] = { role: 'assistant', content: accText, ts: Date.now(), streaming: true, toolLines };
          flashRenderMessages();
        } else if (evt === 'tool_start') {
          toolLines = toolLines.concat([{ type: 'start', name: d.name, summary: d.args_summary }]);
          _flashState.messages[assistantIdx] = { role: 'assistant', content: accText, ts: Date.now(), streaming: true, toolLines };
          flashRenderMessages();
        } else if (evt === 'tool_result') {
          toolLines = toolLines.map(function(tl) {
            return (tl.name === d.name && tl.type === 'start')
              ? { type: 'result', name: tl.name, ok: d.ok, summary: tl.summary, resultSummary: d.summary }
              : tl;
          });
          _flashState.messages[assistantIdx] = { role: 'assistant', content: accText, ts: Date.now(), streaming: true, toolLines };
          flashRenderMessages();
        } else if (evt === 'escalated') {
          toolLines = toolLines.concat([{ type: 'escalated', taskId: d.taskId }]);
          _flashState.messages[assistantIdx] = { role: 'assistant', content: accText, ts: Date.now(), streaming: true, toolLines };
          flashRenderMessages();
        } else if (evt === 'done') {
          doneData = d;
        }
      }
    }

    if (doneData) {
      _flashState.sessionId = doneData.sessionId;
      _flashState.messages[assistantIdx] = {
        role: 'assistant', content: doneData.fullText || accText, ts: Date.now(),
        streaming: false, turnId: doneData.turnId, toolLines
      };
    } else {
      _flashState.messages[assistantIdx] = { role: 'assistant', content: accText, ts: Date.now(), streaming: false, toolLines };
    }
    flashRenderMessages();
  } catch (err) {
    _flashState.messages[assistantIdx] = { role: 'system', content: 'Error: ' + (err.message || 'Send failed.'), ts: Date.now() };
    flashRenderMessages();
    hmToast('Chat send failed.', 'err');
  } finally {
    _flashState.sending = false;
    if (sendBtn) sendBtn.disabled = !(input && input.value.trim());
    updateFlashNav();
  }
}

function flashInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); flashSend(); }
}

function flashInputResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  const sendBtn = document.getElementById('flashSendBtn');
  if (sendBtn) sendBtn.disabled = !el.value.trim() && !_flashState.pendingImages.length;
}

function flashFocusInput() {
  const input = document.getElementById('flashInput');
  if (input) input.focus();
}

function blobToB64(blob) {
  return new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
}
// Composer dictation mic (button sits above Send): record → STT-only →
// transcript → auto-send. This is the only voice input on desktop (the header
// "Talk" button was removed). /voice/turn still backs watch/glasses/mobile.
async function flashDictate() {
  const btn = document.getElementById("flashMicBtn");
  const input = document.getElementById("flashInput");
  if (_dictRec && _dictRec.state === "recording") { _dictRec.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { hmToast("Microphone blocked — allow mic access for this page.", "err"); return; }
  _dictChunks = [];
  _dictRec = new MediaRecorder(stream);
  _dictRec.ondataavailable = e => { if (e.data && e.data.size) _dictChunks.push(e.data); };
  _dictRec.onerror = () => { if (btn) { btn.classList.remove("recording"); btn.textContent = "🎤 Mic"; } };
  _dictRec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    if (btn) { btn.classList.remove("recording"); btn.textContent = "…"; btn.disabled = true; }
    try {
      const b64 = await blobToB64(new Blob(_dictChunks, { type: "audio/webm" }));
      const res = await api("/voice/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64: b64 }) });
      if (res && res.error) { hmToast(res.error, "err"); }
      else if (res && res.transcript && input) {
        const cur = input.value || "";
        input.value = (cur && !/\s$/.test(cur)) ? cur + " " + res.transcript : cur + res.transcript;
        flashInputResize(input); // resizes + enables Send
        // Auto-send on stop — dictation is speak → stop → sent, no extra click.
        if (input.value.trim()) flashSend();
      } else { hmToast("Didn't catch that — try again.", ""); }
    } catch (e) { hmToast("Dictation failed — type your message instead.", "err"); }
    if (btn) { btn.textContent = "🎤 Mic"; btn.disabled = false; }
  };
  _dictRec.start();
  if (btn) { btn.classList.add("recording"); btn.textContent = "■ Stop"; }
}

function renderAbout() {
  const v = (models && models.version) || {};
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("ab_version", "v" + (v.version || "?"));
  set("ab_build", String(v.build || "?"));
  set("ab_date", v.date || "?");
  renderHomeReadinessBanner();
}

async function renderHomeReadinessBanner() {
  const banner = document.getElementById("home_readiness_banner");
  if (!banner) return;
  const r = await api("/system/readiness");
  const report = (r && r.report) || r;
  if (!report || !report.checks || report.ok) {
    banner.style.display = "none";
    return;
  }
  const critical = report.checks.filter((c) => c.severity === "critical");
  const warns = report.checks.filter((c) => c.severity === "warn");
  const issues = critical.length > 0 ? critical : warns;
  if (!issues.length) {
    banner.style.display = "none";
    return;
  }
  const borderColor = critical.length > 0 ? "var(--err)" : "var(--warn)";
  const bgColor = critical.length > 0 ? "rgba(229, 83, 75, .1)" : "rgba(249, 174, 66, .1)";
  const titleColor = critical.length > 0 ? "var(--err)" : "var(--warn)";
  const icon = critical.length > 0 ? "⚠" : "⚡";
  const topIssue = issues[0];
  const issueLabel = topIssue.label || topIssue.id;
  const summary = issues.length === 1 ? issueLabel : issueLabel + " + " + (issues.length - 1) + " more";
  banner.innerHTML = '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:6px;background:' + bgColor + ';border:1px solid ' + borderColor + '">'
    + '<span style="font-size:16px;flex-shrink:0">' + icon + '</span>'
    + '<div style="flex:1;min-width:0">'
    + '<div style="color:' + titleColor + ';font-weight:600;font-size:12px">' + esc(summary) + '</div>'
    + '<div style="color:var(--text);font-size:11px;margin-top:2px">' + esc((topIssue.summary || "")) + '</div>'
    + '</div>'
    + '<button class="copybtn" onclick="switchSettingsTab(\'lanes\')" title="Open Lanes settings to review and repair">View</button>'
    + '</div>';
  banner.style.display = "block";
}

async function renderLicense() {
  const banner = document.getElementById("lic_status_banner");
  const det = document.getElementById("lic_detail");
  if (!banner || !det) return;
  banner.innerHTML = '<div class="muted" style="font-size:11px">Loading…</div>';
  det.innerHTML = '';
  const r = await api("/license/status");
  if (!r) { banner.innerHTML = '<div class="muted">Could not load license status.</div>'; return; }
  const stateColor = { valid: "var(--ok)", grace: "var(--warn)", expired: "var(--err)", invalid: "var(--err)", missing: "var(--muted)", unlicensed: "var(--muted)", machine_mismatch: "var(--err)" };
  const color = stateColor[r.state] || "var(--muted)";
  const tierLabel = r.edition ? r.edition.charAt(0).toUpperCase() + r.edition.slice(1) : "Free";
  banner.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;background:var(--bg2);border:1px solid var(--border)">'
    + '<span style="background:' + color + ';color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap">' + esc(tierLabel.toUpperCase()) + '</span>'
    + '<span style="font-size:12px">' + esc(r.reason) + '</span>'
    + '</div>';
  const rows = [];
  if (r.expiresAt) rows.push(['expires', new Date(r.expiresAt).toLocaleDateString()]);
  if (typeof r.daysRemaining === 'number') rows.push(['days remaining', String(r.daysRemaining)]);
  if (r.graceUntil) rows.push(['grace until', new Date(r.graceUntil).toLocaleDateString()]);
  if (r.features && r.features.length) rows.push(['features', r.features.join(', ')]);
  det.innerHTML = rows.map(([k, v]) => '<span class="k">' + esc(k) + '</span><span>' + esc(String(v)) + '</span>').join('');
}

async function activateLicense() {
  const inp = document.getElementById("lic_key_input");
  const stat = document.getElementById("lic_activate_status");
  const raw = inp.value.trim();
  if (!raw) { stat.textContent = "Paste a license key first."; return; }
  stat.textContent = "Activating…";
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    try { parsed = JSON.parse(atob(raw)); } catch {
      stat.innerHTML = '<span style="color:var(--err)">Invalid format — expected JSON or base64-encoded JSON.</span>';
      return;
    }
  }
  if (!parsed || !parsed.payload || typeof parsed.signature !== "string") {
    stat.innerHTML = '<span style="color:var(--err)">Invalid license: missing payload or signature.</span>';
    return;
  }
  const r = await api("/license", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
  if (!r) { stat.innerHTML = '<span style="color:var(--err)">Network error — is the daemon running?</span>'; return; }
  if (r.state === "valid" || r.state === "grace") {
    stat.innerHTML = '<span style="color:var(--ok)">✓ Activated — ' + esc((r.edition || 'pro').toUpperCase()) + ' license applied (' + esc(r.reason) + ')</span>';
    inp.value = '';
    await renderLicense();
  } else {
    stat.innerHTML = '<span style="color:var(--err)">' + esc(r.reason || r.error || 'Activation failed') + '</span>';
  }
}

// --- Lane Apps manager (operator) ------------------------------------------
// HiveMatrix updates itself automatically; the standalone Browser Lane app is
// installed/updated EXPLICITLY here. The Lane Setup model keeps launchState
// ("failed") DISTINCT from signingState ("invalid") — codesign/spctl passing
// does not prove the app launches (the LaunchServices lesson) — and
// renderLaneSetup shows them as separate chips.
function systemReadinessBadge(severity) {
  const color = severity === "ok" ? "var(--ok)"
    : severity === "info" ? "var(--accent-2)"
    : severity === "warn" ? "var(--warn)"
    : "var(--err)";
  return '<span class="badge" style="color:'+color+'">'+esc(severity || "info")+'</span>';
}

async function renderSystemReadiness() {
  const el = document.getElementById("system_readiness");
  if (!el) return;
  el.innerHTML = '<div class="muted">Loading…</div>';
  const r = await api("/system/readiness");
  const report = (r && r.report) || r;
  if (!report || !report.checks) {
    el.innerHTML = '<div class="muted">System readiness unavailable.</div>';
    return;
  }
  const counts = report.counts || {};
  const order = ["ok", "info", "warn", "critical"];
  const chips = order.map(k => {
    const color = k === "ok" ? "var(--ok)" : k === "info" ? "var(--accent-2)" : k === "warn" ? "var(--warn)" : "var(--err)";
    return '<span class="badge" style="color:'+color+'">'+k+': '+esc(counts[k] || 0)+'</span>';
  }).join(" ");
  const checks = (report.checks || []).map(c => {
    const next = c.nextAction ? '<div class="muted" style="font-size:10px;margin-top:3px">Next: '+esc(c.nextAction)+'</div>' : '';
    const repairs = (c.repairActions || []).map(a =>
      '<button class="copybtn" onclick="systemReadinessRepair(\''+esc(a.id)+'\')" title="'+esc(a.description || '')+'">'+esc(a.label || a.id)+'</button>'
    ).join(" ");
    const repairRow = repairs ? '<div class="row" style="justify-content:flex-end;gap:6px;margin-top:5px">'+repairs+'</div>' : '';
    return '<div style="padding:7px 0;border-top:1px solid var(--border)">'
      + '<div class="row" style="justify-content:space-between;gap:8px;align-items:center"><b>'+esc(c.label || c.id)+'</b>'+systemReadinessBadge(c.severity)+'</div>'
      + '<div class="muted" style="font-size:11px;margin-top:3px">'+esc(c.summary || '')+'</div>'
      + next
      + repairRow
      + '</div>';
  }).join("");
  el.innerHTML = '<div class="card" style="cursor:default">'
    + '<div class="t">'+esc(report.summary || 'System readiness')+'</div>'
    + '<div style="margin:6px 0">'+chips+'</div>'
    + '<div id="system_readiness_msg" class="muted" style="font-size:10px;margin:4px 0"></div>'
    + checks
    + '</div>';
}

async function systemReadinessRepair(action) {
  const msg = document.getElementById("system_readiness_msg");
  if (msg) msg.textContent = "Repairing…";
  const r = await api("/system/readiness/repair", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ action }) });
  if (!r || r.ok === false) {
    if (msg) msg.innerHTML = '<span style="color:var(--err)">'+esc((r&&r.error)||'Repair failed')+'</span>';
    return;
  }
  if (msg) msg.textContent = r.message || "Repair complete.";
  renderSystemReadiness();
}

// Lane Setup & Reliability Center — one card per Lane, driven by the unified
// /lane-setup model. Shows install/signing/launch/daemon state + a readiness
// summary + the single recommended next action. No dead buttons: actions that
// can't run are disabled with a visible reason. No secrets are in the model.
function laneInstallBadge(installState) {
  const map = {
    current: ["var(--ok)", "Current"],
    outdated: ["var(--accent)", "Update available"],
    stale: ["var(--warn)", "Stale copy"],
    not_installed: ["var(--muted)", "Not installed"],
    broken: ["var(--err)", "Broken"],
  };
  const [color, label] = map[installState] || ["var(--muted)", installState || "unknown"];
  return '<span class="badge" style="color:'+color+'">'+esc(label)+'</span>';
}
function laneStateChip(label, value, kind) {
  const color = kind === "ok" ? "var(--ok)" : kind === "warn" ? "var(--warn)" : kind === "err" ? "var(--err)" : "var(--muted)";
  return '<span class="badge" style="color:'+color+'">'+esc(label)+': '+esc(value)+'</span>';
}
function laneActionCall(id, action) {
  if (action === "run_readiness") return "laneRunReadiness('"+id+"')";
  if (action === "repair") return "laneRepairApplications('"+id+"')";
  // "update" and "open" are UI labels that map onto real endpoints: update →
  // install (installs/updates from the bundled artifact); open → launch. There is
  // no /lane-apps/:id/update route.
  const endpoint = action === "open" ? "launch" : action === "update" ? "install" : action;
  return "laneAppAction('"+id+"','"+endpoint+"')";
}
function laneBtn(id, action, label, cls, reason) {
  if (reason) return '<button class="'+cls+'" disabled title="'+esc(reason)+'">'+esc(label)+'</button>';
  return '<button class="'+cls+'" onclick="'+laneActionCall(id, action)+'">'+esc(label)+'</button>';
}
async function renderLaneSetup() {
  const el = document.getElementById("lane_apps");
  if (!el) return;
  el.innerHTML = '<div class="muted">Loading…</div>';
  const r = await api("/lane-setup");
  const lanes = (r && r.lanes) || [];
  if (!lanes.length) { el.innerHTML = '<div class="muted">No lane apps registered.</div>'; return; }
  // Post-update banner: when the bundled HiveMatrix carries newer Lane apps than
  // what's installed/active, make it impossible to miss + one click to fix.
  const us = (r && r.updateSummary) || { needsUpdate: [], count: 0, anyShadowed: false };
  const banner = us.count > 0
    ? '<div class="card" style="cursor:default;border:1px solid var(--warn)">'
      + '<div class="t" style="color:var(--warn)">⚠ HiveMatrix updated — Lane apps need update: '+esc(us.needsUpdate.join(", "))+'</div>'
      + (us.anyShadowed ? '<div class="muted" style="font-size:11px;margin-top:3px">A stale copy in /Applications is active and shadowing the fresh build.</div>' : '')
      + '<div class="row" style="margin-top:6px;justify-content:flex-end"><button class="lane-primary update" onclick="laneUpdateAll()">Update Lane Apps</button></div>'
      + '<div id="lane_update_all_msg" class="muted" style="font-size:10px;margin-top:4px"></div>'
      + '</div>'
    : '';
  el.innerHTML = banner + lanes.map(lane => {
    const installed = lane.installedVersion ? esc(lane.installedVersion.short)+' ('+esc(lane.installedVersion.build)+')' : '—';
    const bundled = esc(lane.bundledVersion.short)+' ('+esc(lane.bundledVersion.build)+')';
    // Build identity makes a same-version stale copy legible (build 2 vs 2 but
    // different HMBuildId).
    const idLine = (lane.installedBuildId || lane.bundledBuildId)
      ? '<div class="muted" style="font-size:10px;margin-top:2px">build '+esc(lane.installedBuildId||'—')+(lane.bundledBuildId && lane.bundledBuildId !== lane.installedBuildId ? ' → bundled '+esc(lane.bundledBuildId) : '')+'</div>'
      : '';
    const signing = laneStateChip("Signing", lane.signingState, lane.signingState === "valid" ? "ok" : lane.signingState === "invalid" ? "err" : "muted");
    const launch = laneStateChip("Launch", lane.launchState, lane.launchState === "running" ? "ok" : lane.launchState === "failed" ? "err" : lane.launchState === "not_running" ? "warn" : "muted");
    const daemon = laneStateChip("Daemon", lane.daemonState, lane.daemonState === "reachable" ? "ok" : "err");
    const rd = lane.readiness || {};
    const readinessLine = rd.lane === "browser"
      ? (rd.configuredSites||0)+' site'+((rd.configuredSites===1)?'':'s')+' · '+(rd.ready||0)+' ready · '+(rd.needsAttention||0)+' need attention · '+(rd.stale||0)+' stale'
      : (rd.configuredProfiles||0)+' profile'+((rd.configuredProfiles===1)?'':'s')+' · '+(rd.ready||0)+' ready · '+(rd.failed||0)+' failed · '+(rd.needsAttention||0)+' need attention';
    const dr = lane.disabledReasons || {};
    const na = lane.nextAction || { action: "verify", label: "Verify" };
    // Primary = the single recommended action (never disabled — it's the fix).
    // Colour it amber when an update/repair is involved so it's impossible to miss.
    const updateLike = na.action === "install" || na.action === "update" || na.action === "repair";
    const primary = laneBtn(lane.id, na.action, na.label, "lane-primary" + (updateLike ? " update" : ""), null);
    // Secondary actions, each disabled-with-reason when unavailable.
    const secondary = [
      laneBtn(lane.id, "verify", "Verify", "copybtn", dr.verify),
      laneBtn(lane.id, "launch", "Open app", "copybtn", dr.launch),
      laneBtn(lane.id, "run_readiness", "Run readiness", "copybtn", null),
      laneBtn(lane.id, "reveal", "Reveal", "copybtn", dr.reveal),
    ].join("");
    const reasons = Object.keys(dr).filter(k => dr[k]).map(k => esc(dr[k])).filter((v,i,a)=>a.indexOf(v)===i);
    const reasonNote = reasons.length ? '<div class="muted" style="font-size:10px;margin-top:4px">'+reasons.join(' ')+'</div>' : '';
    // List every installed copy so a stale /Applications copy shadowing a current
    // user copy is visible. Mark the active copy and whether it's current/stale.
    const copies = lane.installedCopies || [];
    const copiesList = copies.length > 1 || (copies[0] && !copies[0].current) ? '<div class="muted" style="font-size:10px;margin-top:4px">Copies on disk:'
      + copies.map(c => '<div>'+(c.active?'▶ ':'· ')+esc(c.path)+' — '+(c.current?'current':'<span style="color:var(--warn)">stale</span>')+(c.active?' (active)':'')+'</div>').join('')
      + '</div>' : '';
    const shadowWarn = lane.shadowed
      ? '<div class="muted" style="font-size:10px;margin-top:3px;color:var(--warn)">⚠ A stale copy in /Applications is shadowing your current install — it wins at launch. Use “'+esc(na.label)+'”.</div>'
      : '';
    return '<div class="card" style="cursor:default">'
      + '<div class="t">'+esc(lane.displayName)+' '+laneInstallBadge(lane.installState)+'</div>'
      + '<div class="muted" style="font-size:11px;margin-top:4px">Installed: <b>'+installed+'</b> · Bundled: <b>'+bundled+'</b></div>'
      + idLine
      + '<div class="muted" style="font-size:10px;margin-top:2px">'+esc(lane.installedPath||'—')+'</div>'
      + copiesList
      + shadowWarn
      + '<div class="m" style="margin-top:6px">'+signing+' '+launch+' '+daemon+'</div>'
      + '<div class="muted" style="font-size:11px;margin-top:4px">Readiness: '+readinessLine+'</div>'
      + '<div class="muted" style="font-size:10px;margin-top:3px">Next: '+esc(na.label)+'</div>'
      + '<div class="row" style="margin-top:6px;justify-content:flex-end;gap:6px;flex-wrap:wrap">'+primary+secondary+'</div>'
      + reasonNote
      + '<div id="lane_app_msg_'+esc(lane.id)+'" class="muted" style="font-size:10px;margin-top:4px"></div>'
      + '</div>';
  }).join("");
}

async function laneUpdateAll() {
  const msg = document.getElementById("lane_update_all_msg");
  if (msg) msg.textContent = "Updating Lane apps from the bundled HiveMatrix…";
  const r = await api("/lane-apps/update-all", { method:"POST", headers:{"Content-Type":"application/json"}, body: "{}" });
  if (!r || !r.results) { if (msg) msg.innerHTML = '<span style="color:var(--err)">'+esc((r&&r.error)||'Update failed')+'</span>'; return; }
  const lines = r.results.map(x => {
    if (x.replacedApplications) return '✓ '+esc(x.displayName)+' — replaced '+esc(x.replacedApplications);
    if (x.shadowed) return '⚠ '+esc(x.displayName)+' — '+esc(x.warning||'still shadowed by a stale /Applications copy');
    return '✓ '+esc(x.displayName)+' — updated '+esc(x.installedPath||'');
  });
  if (msg) msg.innerHTML = lines.join('<br>') || 'Nothing to update.';
  renderLaneSetup();
}

async function laneRepairApplications(id) {
  const msg = document.getElementById("lane_app_msg_"+id);
  if (msg) msg.textContent = "Replacing the /Applications copy…";
  const r = await api("/lane-apps/"+id+"/repair-applications", { method:"POST", headers:{"Content-Type":"application/json"}, body: "{}" });
  if (!r || r.ok === false) {
    // Not a hard error — exact instructions when the copy isn't user-writable.
    if (msg) msg.innerHTML = '<span style="color:var(--warn)">'+esc((r&&(r.instructions||r.error))||'Could not replace the /Applications copy.')+'</span>';
    return;
  }
  if (msg) msg.textContent = "Replaced the /Applications copy at "+esc(r.replacedPath||'')+".";
  renderLaneSetup();
}

async function laneRunReadiness(id) {
  const msg = document.getElementById("lane_app_msg_"+id);
  if (msg) msg.textContent = "Running readiness…";
  const r = await api("/browser-lane/readiness/run", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ siteId: "all" }) });
  if (!r || r.ok === false) { if (msg) msg.innerHTML = '<span style="color:var(--accent-2)">'+esc((r&&r.error)||'Readiness run failed')+'</span>'; return; }
  if (msg) msg.textContent = "Readiness check complete.";
  renderLaneSetup();
  renderBrowserReadiness();
}

async function laneAppAction(id, action) {
  const msg = document.getElementById("lane_app_msg_"+id);
  if (msg) msg.textContent = action === 'install' ? 'Installing…' : action === 'verify' ? 'Verifying…' : action === 'reveal' ? 'Revealing…' : 'Launching…';
  const r = await api("/lane-apps/"+id+"/"+action, { method:"POST", headers:{"Content-Type":"application/json"}, body: "{}" });
  if (!r || r.ok === false) {
    if (msg) msg.innerHTML = '<span style="color:var(--accent-2)">'+esc((r&&r.error)||'Action failed')+'</span>';
    return;
  }
  if (action === 'verify' && r.verification) {
    const v = r.verification;
    const launch = v.launchOk === null ? 'not probed' : (v.launchOk ? 'launched' : 'FAILED');
    if (msg) msg.textContent = 'signature: '+(v.signatureOk?'valid':'INVALID')+' · launch: '+launch;
  } else if (action === 'install') {
    // Honest install result: if a stale /Applications copy shadows the user copy,
    // say so (the install did not become active) instead of claiming success.
    if (msg) {
      if (r.warning) msg.innerHTML = '<span style="color:var(--warn)">⚠ '+esc(r.warning)+'</span>';
      else msg.textContent = 'Installed. Active: '+esc(r.activePath||r.installedPath||'');
    }
  } else if (action === 'launch') {
    if (msg) msg.textContent = 'Opened.';
  } else if (action === 'reveal') {
    if (msg) msg.textContent = 'Revealed in Finder.';
  }
  if (action !== 'reveal') renderLaneSetup();
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

async function renderVaultRefs() {
  const status = document.getElementById("vault_status");
  const el = document.getElementById("s_vault_refs");
  if (!el) return;

  const filter = (document.getElementById("s_vault_scope_filter").value || "").trim();
  if (status) {
    status.style.color = "var(--muted)";
    status.textContent = "";
  }
  el.innerHTML = '<div class="muted">Loading vault refs…</div>';

  try {
    const query = filter ? "?scope=" + encodeURIComponent(filter) : "";
    const r = await api("/vault/refs" + query);
    const refs = (r && r.refs) || [];
    if (!refs.length) {
      el.innerHTML = '<div class="muted">' + (filter ? 'No refs for scope "' + esc(filter) + '".' : "No vault refs configured yet.") + '</div>';
      return;
    }
    el.innerHTML = refs.map((entry) => {
      const scope = esc(entry.scope || "?");
      const name = esc(entry.name || "?");
      const label = esc(entry.label || "");
      const created = esc(entry.createdAt || "");
      const updated = esc(entry.updatedAt || "");
      const s = JSON.stringify(entry.scope || "");
      const n = JSON.stringify(entry.name || "");
      const createdRow = created ? '<div class="muted" style="font-size:10px">created: ' + created + "</div>" : "";
      const updatedRow = updated ? '<div class="muted" style="font-size:10px">updated: ' + updated + "</div>" : "";
      return '<div class="card" style="cursor:default">'
        + '<div class="t">' + scope + " / " + name + (label ? ' <span class="muted" style="font-size:11px">(' + label + ")</span>" : "") + "</div>"
        + '<div class="m" style="display:flex;justify-content:space-between;align-items:center;gap:10px">'
        + '<span class="badge">vault://' + scope + "/" + name + "</span>"
        + '<button class="copybtn" onclick="removeVaultRef(' + s + "," + n + ')">Remove</button>'
        + "</div>"
        + (createdRow || "")
        + (updatedRow || "")
        + "</div>";
    }).join("");
  } catch (e) {
    if (status) {
      status.style.color = "var(--err)";
      status.textContent = "Failed to load vault refs.";
    }
    el.innerHTML = '<div class="errbox">Could not load vault refs.</div>';
  }
}

async function setVaultRef() {
  const msg = document.getElementById("vault_status");
  const scope = (document.getElementById("s_vault_scope").value || "").trim();
  const name = (document.getElementById("s_vault_name").value || "").trim();
  const label = (document.getElementById("s_vault_label").value || "").trim();
  const valueEl = document.getElementById("s_vault_value");
  const value = valueEl ? (valueEl.value || "").trim() : "";
  if (!scope || !name || !value) {
    if (msg) {
      msg.style.color = "var(--err)";
      msg.textContent = "Scope, name, and value are required.";
    }
    return;
  }
  if (msg) {
    msg.style.color = "var(--accent)";
    msg.textContent = "Saving…";
  }
  try {
    const r = await api("/vault/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, name, label, value }),
    });
    if (!r || !r.ok) {
      if (msg) {
        msg.style.color = "var(--err)";
        msg.textContent = (r && r.error) ? String(r.error) : "Failed to save the vault entry.";
      }
      return;
    }
    if (valueEl) valueEl.value = "";
    if (msg) {
      msg.style.color = "var(--ok)";
      msg.textContent = "Saved.";
      setTimeout(() => {
        if (msg && msg.textContent === "Saved.") msg.textContent = "";
      }, 1500);
    }
    await renderVaultRefs();
  } catch (e) {
    if (msg) {
      msg.style.color = "var(--err)";
      msg.textContent = "Failed to save vault value.";
    }
  }
}

async function removeVaultRef(scope, name) {
  const msg = document.getElementById("vault_status");
  const safe = scope && name ? ('vault://' + scope + "/" + name) : "this vault entry";
  if (!await hmConfirm("Remove " + safe + " from the vault?", { okLabel: "Remove", danger: true })) return;
  try {
    const r = await api("/vault/refs/" + encodeURIComponent(scope) + "/" + encodeURIComponent(name), { method: "DELETE" });
    if (!r || r.ok === false) {
      if (msg) {
        msg.style.color = "var(--err)";
        msg.textContent = (r && r.error) ? String(r.error) : "Delete failed.";
      }
      return;
    }
    if (msg) {
      msg.style.color = "var(--ok)";
      msg.textContent = "Removed.";
      setTimeout(() => {
        if (msg && msg.textContent === "Removed.") msg.textContent = "";
      }, 1500);
    }
    await renderVaultRefs();
  } catch (e) {
    if (msg) {
      msg.style.color = "var(--err)";
      msg.textContent = "Delete failed.";
    }
  }
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

// --- COO routing rules admin -------------------------------------------------
// Structured editor over the typed COO rules API. This is not arbitrary SQL and
// refuses obvious secret-looking values before sending anything to the daemon.
let cooRulesCache = [];
let cooDraftRule = null;
function cooSetRulesResult(msg, err) {
  const el = document.getElementById("coo_rules_result");
  if (el) el.innerHTML = err ? '<span class="err">'+esc(msg)+'</span>' : esc(msg || "");
}
async function renderCooRoutingRules() {
  const list = document.getElementById("coo_rules_list");
  if (!list) return;
  list.innerHTML = '<div class="muted">Loading COO routing rules…</div>';
  const r = await api("/coo/routing-rules");
  if (!r || !r.ok) { list.innerHTML = '<div class="errbox">'+esc((r&&r.error)||"COO routing rules unavailable")+'</div>'; return; }
  cooRulesCache = r.rules || [];
  const lane = (document.getElementById("coo_rules_lane_filter")?.value || "").trim();
  let rules = lane ? cooRulesCache.filter(rule => (rule.lane || "") === lane) : cooRulesCache.slice();
  if (cooDraftRule) rules = [cooDraftRule].concat(rules);
  const enabled = rules.filter(rule => rule.enabled !== false).length;
  const summary = '<div class="muted" style="font-size:11px;margin-bottom:6px">'
    + esc(rules.length)+' shown · '+esc(enabled)+' enabled'+(lane ? ' · lane '+esc(lane) : '')+'</div>';
  if (!rules.length) { list.innerHTML = summary + '<div class="muted">No routing rules.</div>'; return; }
  list.innerHTML = summary + rules.map((rule, index) => cooRuleEditor(rule, index)).join("");
}
function cooRuleFieldId(index, field) { return "coo_rule_"+index+"_"+field; }
function cooField(index, field) {
  return document.getElementById(cooRuleFieldId(index, field));
}
function cooListText(value) {
  return Array.isArray(value) ? value.join("\\n") : "";
}
function cooObjText(value) {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return JSON.stringify(obj, null, 2);
}
function cooRuleEditor(rule, index) {
  const id = rule.id || "";
  const controls = [
    ["name", "Name", rule.name || ""],
    ["intent", "Intent", rule.intent || ""],
    ["capability", "Capability", rule.capability || ""],
    ["backendPolicy", "Backend policy", rule.backendPolicy || "lane_owned_first"],
    ["modelPosture", "Model posture", rule.modelPosture || "mixed-local-first"],
    ["riskTier", "Risk tier", rule.riskTier || "normal"],
    ["phrases", "Phrases", cooListText(rule.match && rule.match.phrases)],
    ["domains", "Domains", cooListText(rule.match && rule.match.domains)],
    ["projects", "Projects", cooListText(rule.match && rule.match.projects)],
    ["workflows", "Workflows", cooListText(rule.match && rule.match.workflows)],
    ["tags", "Tags", cooListText(rule.match && rule.match.tags)],
  ];
  const fields = controls.map(c =>
    '<label class="flbl">'+esc(c[1])+'</label><textarea id="'+cooRuleFieldId(index,c[0])+'" rows="'+(c[0].match(/phrases|domains|projects|workflows|tags/) ? 2 : 1)+'">'+esc(c[2])+'</textarea>'
  ).join("");
  const laneOptions = ["browser","mail","message","desktop","memory","review"].map(lane =>
    '<option value="'+lane+'" '+((rule.lane||"browser")===lane?'selected':'')+'>'+lane+'</option>'
  ).join("");
  return '<details class="card" style="cursor:default" open>'
    + '<summary><b>'+esc(rule.name || "New COO rule")+'</b> <span class="badge">'+esc(rule.lane || "browser")+'</span> <span class="badge">'+esc(rule.enabled === false ? "disabled" : "enabled")+'</span></summary>'
    + '<div style="margin-top:8px">'
    + '<label class="flbl">id</label><input id="'+cooRuleFieldId(index,"id")+'" value="'+esc(id)+'" readonly />'
    + '<div class="row" style="gap:8px"><div style="flex:1"><label class="flbl">lane</label><select id="'+cooRuleFieldId(index,"lane")+'">'+laneOptions+'</select></div>'
    + '<div style="width:110px"><label class="flbl">priority</label><input id="'+cooRuleFieldId(index,"priority")+'" value="'+esc(rule.priority ?? 100)+'" /></div>'
    + '<div style="width:90px"><label class="flbl">enabled</label><select id="'+cooRuleFieldId(index,"enabled")+'"><option value="true" '+(rule.enabled!==false?'selected':'')+'>true</option><option value="false" '+(rule.enabled===false?'selected':'')+'>false</option></select></div></div>'
    + fields
    + '<label class="flbl">constraints</label><textarea id="'+cooRuleFieldId(index,"constraints")+'" rows="3">'+esc(cooObjText(rule.constraints))+'</textarea>'
    + '<label class="flbl">approvalPolicy</label><textarea id="'+cooRuleFieldId(index,"approvalPolicy")+'" rows="3">'+esc(cooObjText(rule.approvalPolicy))+'</textarea>'
    + '<label class="flbl">verificationPolicy</label><textarea id="'+cooRuleFieldId(index,"verificationPolicy")+'" rows="3">'+esc(cooObjText(rule.verificationPolicy))+'</textarea>'
    + '<label class="flbl">notes</label><textarea id="'+cooRuleFieldId(index,"notes")+'" rows="2">'+esc(rule.notes || "")+'</textarea>'
    + '<div class="row" style="gap:6px;justify-content:flex-end;margin-top:6px">'
    + '<button class="create" onclick="cooSaveRule('+index+',\''+esc(id)+'\')">Save</button>'
    + '<button class="copybtn" onclick="cooDuplicateRule('+index+')">Duplicate</button>'
    + (id ? '<button class="copybtn" onclick="cooShowRuleHistory(\''+esc(id)+'\')">History</button><button class="copybtn" onclick="cooDeleteRule(\''+esc(id)+'\')">Delete</button>' : '')
    + '</div></div></details>';
}
function cooParseList(value) {
  return String(value || "").split(/[\\n,]+/).map(s => s.trim()).filter(Boolean);
}
function cooParseObject(value, label) {
  const text = String(value || "").trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(label+" must be a JSON object");
  return parsed;
}
function cooSecretLike(value) {
  return /password|cookie|secret|bearer|api[-_ ]?key|token/i.test(String(value || ""));
}
function cooCollectRule(index, existingId) {
  const textFields = ["name","intent","capability","backendPolicy","modelPosture","riskTier","phrases","domains","projects","workflows","tags","notes"];
  const text = textFields.map(field => cooField(index, field)?.value || "").join("\\n");
  if (cooSecretLike(text)) throw new Error("COO rules cannot contain secret-looking values.");
  const constraints = cooParseObject(cooField(index, "constraints")?.value, "constraints");
  const approvalPolicy = cooParseObject(cooField(index, "approvalPolicy")?.value, "approvalPolicy");
  const verificationPolicy = cooParseObject(cooField(index, "verificationPolicy")?.value, "verificationPolicy");
  if (cooSecretLike(JSON.stringify({ constraints, approvalPolicy, verificationPolicy }))) throw new Error("COO policy JSON cannot contain secret-looking values.");
  const priority = Number(cooField(index, "priority")?.value || 0);
  if (!Number.isFinite(priority)) throw new Error("priority must be numeric");
  const rule = {
    id: existingId || undefined,
    name: (cooField(index, "name")?.value || "").trim(),
    intent: (cooField(index, "intent")?.value || "").trim(),
    lane: cooField(index, "lane")?.value || "browser",
    capability: (cooField(index, "capability")?.value || "").trim(),
    backendPolicy: (cooField(index, "backendPolicy")?.value || "lane_owned_first").trim(),
    modelPosture: (cooField(index, "modelPosture")?.value || "mixed-local-first").trim(),
    riskTier: (cooField(index, "riskTier")?.value || "normal").trim(),
    enabled: cooField(index, "enabled")?.value !== "false",
    priority: priority,
    match: {
      phrases: cooParseList(cooField(index, "phrases")?.value),
      domains: cooParseList(cooField(index, "domains")?.value),
      projects: cooParseList(cooField(index, "projects")?.value),
      workflows: cooParseList(cooField(index, "workflows")?.value),
      tags: cooParseList(cooField(index, "tags")?.value),
    },
    constraints: constraints,
    approvalPolicy: approvalPolicy,
    verificationPolicy: verificationPolicy,
    notes: (cooField(index, "notes")?.value || "").trim(),
  };
  for (const field of ["name","intent","lane","capability"]) {
    if (!rule[field]) throw new Error(field+" is required");
  }
  return rule;
}
function cooNewRule() {
  cooDraftRule = {
    name: "New Browser Lane rule",
    intent: "browser_workflow",
    lane: "browser",
    capability: "workflow.run",
    backendPolicy: "lane_owned_first",
    modelPosture: "mixed-local-first",
    riskTier: "normal",
    enabled: true,
    priority: 100,
    match: { phrases: [], domains: [], projects: [], workflows: [], tags: [] },
    constraints: {},
    approvalPolicy: {},
    verificationPolicy: {},
    notes: "",
  };
  renderCooRoutingRules();
}
async function cooSaveRule(index, existingId) {
  try {
    const rule = cooCollectRule(index, existingId);
    const r = await api("/coo/routing-rules", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ rule: rule }) });
    if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
    cooDraftRule = null; cooSetRulesResult("Saved "+(r.rule && r.rule.id ? r.rule.id : rule.name)+"."); renderCooRoutingRules();
  } catch (e) { cooSetRulesResult(e.message || String(e), true); }
}
function cooDuplicateRule(index) {
  try {
    const rule = cooCollectRule(index, "");
    rule.id = undefined;
    rule.name = rule.name + " copy";
    cooDraftRule = rule;
    renderCooRoutingRules();
  } catch (e) { cooSetRulesResult(e.message || String(e), true); }
}
async function cooDeleteRule(id) {
  if (!id) return;
  if (!confirm("Delete COO routing rule "+id+"?")) return;
  const r = await api("/coo/routing-rules/"+encodeURIComponent(id), { method:"DELETE" });
  if (!r || !r.ok) { cooSetRulesResult((r&&r.error)||"Delete failed", true); return; }
  cooSetRulesResult("Deleted "+id+"."); renderCooRoutingRules();
}
async function cooShowRuleHistory(id) {
  const r = await api("/coo/routing-rules/"+encodeURIComponent(id)+"/history");
  if (!r || !r.ok) { cooSetRulesResult((r&&r.error)||"History unavailable", true); return; }
  const history = r.history || [];
  cooSetRulesResult(history.length ? history.slice(0,5).map(h => (h.action || h.event || "change")+" "+(h.createdAt || "")).join(" · ") : "No history.");
}
async function cooSeedDefaultRules() {
  const r = await api("/coo/routing-rules/seed", { method:"POST" });
  if (!r || !r.ok) { cooSetRulesResult((r&&r.error)||"Seed failed", true); return; }
  cooSetRulesResult("Default COO routing rules seeded."); renderCooRoutingRules();
}
async function cooResolveRuleTest() {
  const out = document.getElementById("coo_resolve_result");
  const text = (document.getElementById("coo_resolve_text")?.value || "").trim();
  const domains = cooParseList(document.getElementById("coo_resolve_domains")?.value || "");
  if (!text) { if (out) out.innerHTML = '<span class="err">Enter text to resolve.</span>'; return; }
  const r = await api("/coo/routing-rules/resolve", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ text: text, domains: domains }) });
  if (!r || !r.ok) { if (out) out.innerHTML = '<span class="err">'+esc((r&&r.error)||"Resolve failed")+'</span>'; return; }
  const route = r.route || r.result || null;
  if (!route) { if (out) out.innerHTML = 'No matching rule.'; return; }
  if (out) out.innerHTML = 'Matched '+esc(route.ruleName || route.ruleId || "rule")+' → '+esc(route.lane || "?")+' / '+esc(route.capability || "?");
}

// --- Browser Lane readiness maintenance (operator) --------------------------
// Auth strategy is config, never a secret — surface it so the operator knows
// which sign-in path a site uses (the provider account is intentionally hidden).
function authStrategyLabel(strategy) {
  return strategy === "google_sso" ? "Google SSO"
    : strategy === "microsoft_sso" ? "Microsoft SSO"
    : strategy === "keychain_password" ? "Keychain login"
    : "Manual session";
}
// Honest session state — never claims a login that wasn't observed.
function browserSessionLabel(readiness) {
  if (readiness.stale) return "Stale — re-check";
  switch (readiness.status) {
    case "ready": return "Logged-in session observed";
    case "needs_reauth":
    case "human_required": return "Manual sign-in required";
    case "maintenance": return "Needs maintenance";
    case "probe_failed": return "Probe failed";
    case "blocked": return "Blocked";
    default: return "Unknown — run a check";
  }
}
async function renderBrowserReadiness() {
  const el = document.getElementById("browser_readiness");
  if (!el) return;
  el.innerHTML = '<div class="muted">Loading…</div>';
  const r = await api("/browser-lane/dashboard");
  if (!r || !r.ok) { el.innerHTML = '<div class="muted">Readiness unavailable.</div>'; return; }
  const t = r.totals || { byColor: {} };
  const sites = r.sites || [];
  const attention = sites.filter(s => ['orange','red','gray'].includes(s.readiness.color) || s.readiness.stale === true);
  const m = (k,v) => '<div class="m" style="margin-top:2px"><span class="badge">'+esc(k)+'</span> '+esc(v)+'</div>';
  const head = m("sites", t.sites || 0) + m("needs attention", t.needsAttention || 0) + m("stale", (t.stale || 0) + ' (older than ' + (r.staleAfterHours || 24) + 'h)');
  const shown = (attention.length ? attention : sites).slice(0,5);
  const list = shown.map(s => {
    const strat = '<span class="badge">'+esc(authStrategyLabel(s.authStrategy))+'</span>';
    const stale = s.readiness.stale ? ' · stale' : '';
    return '<div class="muted" style="font-size:11px">'+esc(s.displayName)+' '+strat+' — '+esc(browserSessionLabel(s.readiness))+' ('+esc(s.readiness.color)+')'+stale+'</div>';
  }).join('');
  el.innerHTML = '<div class="card" style="cursor:default">'+head+(list ? '<div style="margin-top:6px">'+list+'</div>' : '<div class="muted" style="font-size:11px;margin-top:6px">No sites configured yet — add one in the Browser Lane app.</div>')+'</div>';
}
async function runBrowserReadiness() {
  const el = document.getElementById("browser_readiness");
  if (el) el.innerHTML = '<div class="muted">Running readiness check…</div>';
  const r = await api("/browser-lane/readiness/run", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ siteId: "all" }) });
  if (!r || !r.ok) { if (el) el.innerHTML = '<div class="errbox">'+esc((r&&r.error)||'Readiness run failed')+'</div>'; return; }
  renderBrowserReadiness(); // re-render the dashboard after the sweep
}

// --- Workflows registry (discovery) -----------------------------------------
async function renderWorkflows() {
  const el = document.getElementById("workflows_list");
  if (!el) return;
  el.innerHTML = '<div class="muted">Loading…</div>';
  const r = await api("/workflows");
  const workflows = (r && r.workflows) || [];
  if (!workflows.length) { el.innerHTML = '<div class="muted" style="font-size:11px">No workflows registered.</div>'; return; }
  el.innerHTML = workflows.map(w => {
    const readiness = w.readiness && w.readiness.required ? 'requires '+esc((w.readiness.siteId||"site"))+' readiness (green/fresh)' : 'no readiness gate';
    return '<div class="card" style="cursor:default">'
      + '<div class="t">'+esc(w.name)+' <span class="badge">'+esc(w.lane)+'</span></div>'
      + '<div class="muted" style="font-size:11px;margin-top:2px">'+esc(w.id)+' — '+readiness+'</div>'
      + (w.runbook ? '<div class="muted" style="font-size:11px;margin-top:2px">Runbook: '+esc(w.runbook)+'</div>' : '')
      + '</div>';
  }).join("");
  renderWorkflowRuns();
}
async function renderWorkflowRuns() {
  const el = document.getElementById("workflow_runs");
  if (!el) return;
  const r = await api("/workflows/runs");
  const runs = (r && r.runs) || [];
  if (!runs.length) { el.innerHTML = '<div class="muted" style="font-size:11px">No workflow runs yet.</div>'; return; }
  el.innerHTML = runs.slice(0, 8).map(run => {
    const links = [run.draftId ? 'draft '+esc(run.draftId) : '', run.childTaskId ? 'task '+esc(run.childTaskId) : ''].filter(Boolean).join(' · ');
    const yt = run.artifacts && run.artifacts.youtubeUrl ? ' · '+esc(run.artifacts.youtubeUrl) : '';
    const blk = run.blocker ? ' — '+esc(run.blocker) : '';
    return '<div class="m" style="margin-top:2px"><span class="badge">'+esc(run.status)+'</span> '+esc(run.title)+(links?' ('+links+')':'')+yt+blk+'</div>';
  }).join("");
}
async function prepareResearchBrief() {
  const out = document.getElementById("brief_result");
  const topic = (document.getElementById("brief_topic").value || "").trim();
  if (!topic) { if (out) out.innerHTML = '<span class="err">Enter a topic first.</span>'; return; }
  if (out) out.innerHTML = '<span class="muted">Preparing brief…</span>';
  const r = await api("/workflows/content.research_brief/prepare", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ topic: topic }) });
  if (!r || !r.ok) { if (out) out.innerHTML = '<span class="err">'+esc((r && r.error) || "Prepare failed")+'</span>'; return; }
  // Show the created run + a short preview of the markdown artifact (no secrets).
  const md = (r.result && r.result.markdown) || r.markdown || "";
  const preview = String(md).split("\n").slice(0, 4).join(" · ");
  if (out) out.innerHTML = 'Brief ready (run '+esc(r.runId)+'): '+esc(preview);
  renderWorkflowRuns(); renderWorkflowActions();
}
// --- Workflow inbox / COO queue (read-only; never executes) ------------------
// Actionable order: needs review → changes requested → ready → blocked → failed →
// running → recently completed. Ready actions offer Execute; blocked actions show the
// reason (not a dead button). Secret-free: counts + titles + system reasons only.
const INBOX_ORDER = [
  ["needs_review", "Needs review"],
  ["changes_requested", "Changes requested"],
  ["proposed_actions_ready", "Ready to execute"],
  ["proposed_actions_blocked", "Blocked"],
  ["failed_or_attention", "Failed / attention"],
  ["running_or_pending", "Running"],
  ["recently_completed", "Recently completed"],
];
async function renderWorkflowInbox() {
  const el = document.getElementById("workflow_inbox");
  if (!el) return;
  el.innerHTML = '<div class="muted" style="font-size:11px">Loading…</div>';
  const r = await api("/workflows/inbox");
  const inbox = r && r.inbox;
  if (!inbox) { el.innerHTML = '<div class="muted" style="font-size:11px">Inbox unavailable.</div>'; return; }
  const counts = inbox.counts || {};
  const groups = inbox.groups || {};
  const total = INBOX_ORDER.reduce((n, g) => n + (counts[g[0]] || 0), 0);
  if (!total) { el.innerHTML = '<div class="muted" style="font-size:11px">Inbox empty — nothing pending.</div>'; return; }
  const chips = INBOX_ORDER.filter(g => counts[g[0]] > 0)
    .map(g => '<span class="badge">'+esc(g[1])+': '+counts[g[0]]+'</span>').join(" ");
  const sections = INBOX_ORDER.map(g => {
    const items = (groups[g[0]] || []);
    if (!items.length) return "";
    const rows = items.map(it => {
      const ready = it.status === "ready" && it.kind === "action";
      const blocked = it.blockedReason ? '<div class="muted" style="font-size:11px;margin-top:2px">'+esc(it.blockedReason)+'</div>' : "";
      const exec = ready
        ? '<div class="row" style="margin-top:4px;justify-content:flex-end"><button class="create" onclick="executeWorkflowAction(\''+esc(it.id)+'\')">Execute</button></div>'
          + '<div id="action_result_'+esc(it.id)+'" class="muted" style="font-size:11px;margin-top:2px"></div>'
        : '';
      const next = it.nextAction ? ' <span class="muted" style="font-size:11px">— '+esc(it.nextAction)+'</span>' : '';
      return '<div class="m" style="margin-top:3px"><span class="badge">'+esc(it.status)+'</span> '+esc(it.title)+next+blocked+exec+'</div>';
    }).join("");
    return '<div style="margin-top:6px"><div class="muted" style="font-size:11px;font-weight:600">'+esc(g[1])+'</div>'+rows+'</div>';
  }).join("");
  el.innerHTML = '<div style="margin-bottom:4px">'+chips+'</div>'+sections;
}

// --- Workflow action handoffs (explicit execution) --------------------------
async function renderWorkflowActions() {
  const el = document.getElementById("workflow_actions");
  if (!el) return;
  const r = await api("/workflows/actions");
  const actions = (r && r.actions) || [];
  if (!actions.length) { el.innerHTML = '<div class="muted" style="font-size:11px">No proposed actions.</div>'; return; }
  el.innerHTML = actions.slice(0, 8).map(a => {
    const req = (a.requiredInputs || []).join(", ");
    return '<div class="card" style="cursor:default">'
      + '<div class="t">'+esc(a.title)+' <span class="badge">→ '+esc(a.targetWorkflowId)+'</span></div>'
      + (a.reason ? '<div class="muted" style="font-size:11px;margin-top:2px">'+esc(a.reason)+'</div>' : '')
      + (req ? '<div class="muted" style="font-size:11px;margin-top:2px">Required inputs: '+esc(req)+'</div>' : '')
      + '<div class="row" style="margin-top:6px;justify-content:flex-end"><button class="create" onclick="executeWorkflowAction(\''+esc(a.id)+'\')">Execute</button></div>'
      + '<div id="action_result_'+esc(a.id)+'" class="muted" style="font-size:11px;margin-top:4px"></div>'
      + '</div>';
  }).join("");
}
async function executeWorkflowAction(actionId) {
  const out = document.getElementById("action_result_"+actionId);
  const r = await api("/workflows/actions/"+encodeURIComponent(actionId)+"/execute", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ inputs: {} }) });
  if (!r) { if (out) out.innerHTML = '<span class="err">Execute failed</span>'; return; }
  if (r.status === "review_required") {
    if (out) out.innerHTML = '<span class="err">Review required</span> — approve the source run ('+esc(r.sourceRunId || "")+') before this action can run.';
  } else if (r.status === "needs_input") {
    if (out) out.innerHTML = '<span class="err">Needs input: '+esc((r.missing || []).join(", "))+'</span> — supply these and run the target workflow directly.';
  } else if (r.ok) {
    if (out) out.innerHTML = 'Executed → prepared'+(r.resultRunId ? ' (run '+esc(r.resultRunId)+')' : '')+'.';
    renderWorkflowRuns();
  } else {
    if (out) out.innerHTML = '<span class="err">'+esc(r.reason || r.error || "Execute failed")+'</span>';
  }
  renderWorkflowActions(); renderWorkflowInbox();
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
    return '<div class="card" style="cursor:default">'
      + '<div class="t">'+esc(p.name)+(p.preSelect?' <span class="badge" style="color:var(--ok)">★ active</span>':'')+'</div>'
      + '<div class="m"><span class="badge">'+esc(p.path)+'</span>'
      + (p.hasManifest?'<span class="badge" style="color:var(--accent-2)">manifest</span>':'')
      + '<span class="badge">'+sourceLabels+'</span></div></div>';
  }).join("");
}

function saveDefaultProject() {
  const sel = document.getElementById("s_default_project");
  if (!sel) return;
  const name = sel.value;
  if (name) localStorage.setItem("hm_default_project", name);
  else localStorage.removeItem("hm_default_project");
  hmToast(name ? "Default project: " + name : "Default project cleared", "ok");
}

async function refreshProjects() {
  await loadProjects(true); // bypass the cache
  renderSettingsProjects();
}

let tunnel = null;
function copyField(id){ var i=document.getElementById(id); i.select(); document.execCommand("copy"); }
async function loadTunnel() {
  tunnel = await api("/tunnel");
  if (!tunnel) return;
  const ts = tunnel.tailscale || {};
  const tsOn = ts.enabled === true, cfOn = tunnel.cloudflareEnabled === true;

  // Header switches — the same toggle component the ChatGPT/Claude provider
  // rows use (settingsSwitch), so turning one on drives the real transport.
  const tsSwitchEl = document.getElementById("s_ts_switch");
  if (tsSwitchEl) tsSwitchEl.innerHTML = settingsSwitch(tsOn, "toggleTailscale(" + (!tsOn) + ")",
    { disabled: !ts.installed, title: !ts.installed ? "Tailscale not installed" : (tsOn ? "Turn off Tailscale" : "Turn on Tailscale") });
  const cfSwitchEl = document.getElementById("s_cf_switch");
  if (cfSwitchEl) cfSwitchEl.innerHTML = settingsSwitch(cfOn, "toggleCloudflare(" + (!cfOn) + ")",
    { disabled: !tunnel.installed, title: !tunnel.installed ? "cloudflared not installed (brew install cloudflared)" : (cfOn ? "Turn off Cloudflare" : "Turn on Cloudflare") });

  const tsBody = document.getElementById("s_ts_body"), cfBody = document.getElementById("s_cf_body");
  if (tsBody) tsBody.style.display = tsOn ? "block" : "none";
  if (cfBody) cfBody.style.display = cfOn ? "block" : "none";

  // Tailscale body
  const tsStatus = document.getElementById("s_ts_status"), tsUrl = document.getElementById("s_ts_url");
  if (tsStatus) tsStatus.textContent = !ts.installed ? "Tailscale not installed on this Mac — install from tailscale.com."
    : !ts.running ? "Tailscale installed but not connected — open the Tailscale app and sign in."
    : !ts.serving ? "Connected, but not serving the daemon yet."
    : ts.magicDNSName ? ("Serving as " + ts.magicDNSName) : "Serving (enable MagicDNS for a hostname).";
  if (tsUrl && document.activeElement !== tsUrl) tsUrl.value = ts.pairingUrl || "";
  if (tsOn && ts.serving) loadTunnelQr();
  if (cfOn && tunnel.url) loadCloudflareQr();

  // Cloudflare body — reflect saved creds without ever echoing a secret.
  const idField = document.getElementById("s_cf_access_id");
  if (idField && document.activeElement !== idField) idField.value = tunnel.cloudflareAccessClientId || "";
  const secretField = document.getElementById("s_cf_access_secret");
  if (secretField && document.activeElement !== secretField)
    secretField.placeholder = tunnel.cloudflareAccessSecretSaved ? "•••••••• saved — type to replace" : "service-token client secret";
  const tokField = document.getElementById("s_named_token");
  if (tokField && document.activeElement !== tokField)
    tokField.placeholder = tunnel.connectorTokenSaved ? "•••••••• saved — type to replace" : "optional — only if HiveMatrix should run cloudflared";
  const hostField = document.getElementById("s_named_host");
  if (tunnel.url && hostField && document.activeElement !== hostField) hostField.value = tunnel.url;
  const tunnelUrlField = document.getElementById("s_tunnel_url");
  if (tunnelUrlField) tunnelUrlField.value = tunnel.url || "";
  const cfDetail = document.getElementById("s_cf_access_detail");
  if (cfDetail) cfDetail.textContent = tunnel.cloudflareAccessConfigured
    ? "Access service-token credentials are saved. Enter the same values on iPhone, then Sync Apple Watch."
    : "Required when Cloudflare Access protects the hostname (it does for the Watch).";

  // Status header
  const dot = document.getElementById("s_remote_dot"), label = document.getElementById("s_remote_label");
  const detail = document.getElementById("s_tunnel_detail");
  const legs = [];
  if (tsOn && ts.serving) legs.push("Tailscale (iPhone)");
  if (cfOn && tunnel.running) legs.push("Cloudflare (Apple Watch)");
  if (legs.length) { dot.className = "dot on"; label.textContent = "Remote access ON"; detail.textContent = legs.join(" · "); }
  else { dot.className = "dot off"; label.textContent = "Remote access OFF"; detail.textContent = "Turn on Tailscale for your iPhone, or Cloudflare for your Apple Watch."; }
}
async function loadTunnelQr() {
  const box = document.getElementById("s_qr");
  if (!box) return;
  box.innerHTML = '<div class="muted" style="font-size:11px;padding:8px;text-align:center">Loading QR…</div>';
  try {
    const r = await fetch("/tunnel/qr", { headers: { "Authorization": "Bearer " + HM_TOKEN } });
    if (r.ok) { box.innerHTML = await r.text(); return; }
    // Endpoint returns a JSON reason (Pro-license gate, Tailscale off, missing
    // qrencode) — surface it instead of leaving a silently-broken box.
    let reason = "QR unavailable";
    try { const j = await r.json(); if (j && j.error) reason = j.error; } catch (e) { /* non-JSON */ }
    box.innerHTML = '<div class="muted" style="font-size:11px;padding:8px;text-align:center">' + esc(reason) + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="muted" style="font-size:11px;padding:8px;text-align:center">QR request failed</div>';
  }
}
async function loadCloudflareQr() {
  const box = document.getElementById("s_cf_qr");
  if (!box) return;
  box.innerHTML = '<div class="muted" style="font-size:11px;padding:8px;text-align:center">Loading QR…</div>';
  try {
    const r = await fetch("/tunnel/qr/cloudflare", { headers: { "Authorization": "Bearer " + HM_TOKEN } });
    if (r.ok) { box.innerHTML = await r.text(); return; }
    // Endpoint returns a JSON reason (Pro-license gate, missing hostname,
    // incomplete Access creds, missing qrencode) — surface it.
    let reason = "QR unavailable";
    try { const j = await r.json(); if (j && j.error) reason = j.error; } catch (e) { /* non-JSON */ }
    box.innerHTML = '<div class="muted" style="font-size:11px;padding:8px;text-align:center">' + esc(reason) + '</div>';
  } catch (e) {
    box.innerHTML = '<div class="muted" style="font-size:11px;padding:8px;text-align:center">QR request failed</div>';
  }
}
async function toggleTailscale(enabled) {
  const status = document.getElementById("s_ts_status");
  let resp = null;
  try {
    resp = await api("/remote/tailscale/enabled", { method: "POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ enabled }) });
  } catch (e) { /* network failure → generic error below */ }
  if (!resp || resp.error) {
    // A failed enable must snap the switch back to Off, not lie about state —
    // re-render from the server rather than trusting the optimistic click.
    if (status) { status.style.color = "var(--err)"; status.textContent = (resp && resp.error) || "Failed to reach the daemon."; }
    await loadTunnel();
    return;
  }
  tunnel = resp;
  await loadTunnel();
}
async function toggleCloudflare(enabled) {
  const cfDetail = document.getElementById("s_cf_access_detail");
  const connectorToken = document.getElementById("s_named_token").value.trim();
  const body = { enabled };
  if (connectorToken) body.connectorToken = connectorToken;
  let resp = null;
  try {
    resp = await api("/remote/cloudflare/enabled", { method: "POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(body) });
  } catch (e) { /* network failure → generic error below */ }
  if (!resp || resp.error) {
    if (cfDetail) { cfDetail.style.color = "var(--err)"; cfDetail.textContent = (resp && resp.error) || "Failed to reach the daemon."; }
    await loadTunnel();
    return;
  }
  tunnel = resp;
  document.getElementById("s_named_token").value = "";
  await loadTunnel();
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
  const cfDetail = document.getElementById("s_cf_access_detail");
  if (cfDetail) { cfDetail.style.color = "var(--accent)"; cfDetail.textContent = "Saving & verifying against Cloudflare…"; }
  let resp = null;
  try {
    resp = await api("/tunnel/access-credentials", { method: "POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ cloudflareAccessClientId, cloudflareAccessClientSecret }) });
  } catch (e) { /* network failure → generic error below */ }
  if (!resp || resp.error) {
    // Rejected (e.g. a URL pasted as the secret) — keep the typed values so the
    // user can fix them, and say why instead of silently persisting garbage.
    if (cfDetail) { cfDetail.style.color = "var(--err)"; cfDetail.textContent = (resp && resp.error) || "Save failed — daemon unreachable"; }
    return;
  }
  tunnel = resp;
  document.getElementById("s_cf_access_secret").value = "";
  const verification = resp.accessVerification;
  await loadTunnel();
  // loadTunnel() rewrites the detail line; overwrite it with the live-check
  // verdict so the user learns immediately whether Cloudflare took the token.
  if (cfDetail && verification) {
    cfDetail.style.color = verification.ok === true ? "var(--ok)" : verification.ok === false ? "var(--err)" : "";
    cfDetail.textContent = verification.message;
  }
}

async function saveTheme() {
  const theme = document.getElementById("s_theme").value;
  models = await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ theme }) }) || models;
  applyTheme(theme, !!(models && models.hasWallpaper));
  // The panel-translucency slider applies to the Matrix rain too, so reveal it here.
  syncWallpaperOpacityRow();
  hmToast("Theme: " + theme, "ok");
}
// Autonomy: load the current level + descriptions, and persist a change. The
// descriptions come from the server so UI and policy never drift.
let autonomyLevelMeta = [];
async function loadAutonomy() {
  const sel = document.getElementById("s_autonomy");
  if (!sel) return;
  try {
    const r = await api("/settings/autonomy");
    if (r && r.level) {
      autonomyLevelMeta = Array.isArray(r.levels) ? r.levels : [];
      sel.value = r.level;
      renderAutonomyDesc(r.level);
    }
  } catch (e) { /* settings can still render without it */ }
}
function renderAutonomyDesc(level) {
  const el = document.getElementById("s_autonomy_desc");
  if (!el) return;
  const meta = autonomyLevelMeta.find(function(l){ return l.key === level; });
  el.textContent = meta ? meta.description : "";
}
async function saveAutonomy() {
  const level = document.getElementById("s_autonomy").value;
  renderAutonomyDesc(level);
  const r = await api("/settings/autonomy", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ level }) });
  if (r && r.level) {
    hmToast("Autonomy: " + level, "ok");
    refresh();
  } else { hmToast((r && r.error) || "Could not save autonomy"); }
}
// Heartbeat (W8 presence layer): pulse + daily moments settings + run-now buttons.
async function loadHeartbeat() {
  const enabled = document.getElementById("s_hb_enabled");
  if (!enabled) return;
  try {
    const r = await api("/settings/heartbeat");
    const hb = r && r.heartbeat;
    if (!hb) return;
    enabled.checked = hb.enabled === true;
    document.getElementById("s_hb_interval").value = hb.intervalMinutes;
    document.getElementById("s_hb_quiet_start").value = hb.quietHours ? hb.quietHours.startHour : "";
    document.getElementById("s_hb_quiet_end").value = hb.quietHours ? hb.quietHours.endHour : "";
    document.getElementById("s_hb_morning").value = hb.morningBriefHour === null ? "" : hb.morningBriefHour;
    document.getElementById("s_hb_evening").value = hb.eveningRecapHour === null ? "" : hb.eveningRecapHour;
  } catch (e) { /* settings can still render without it */ }
}
async function saveHeartbeat() {
  const num = function (id) {
    const raw = document.getElementById(id).value;
    return raw === "" ? null : parseInt(raw, 10);
  };
  const qs = num("s_hb_quiet_start"), qe = num("s_hb_quiet_end");
  const patch = {
    enabled: document.getElementById("s_hb_enabled").checked,
    quietHours: qs !== null && qe !== null ? { startHour: qs, endHour: qe } : null,
    morningBriefHour: num("s_hb_morning"),
    eveningRecapHour: num("s_hb_evening"),
  };
  const interval = num("s_hb_interval");
  if (interval !== null) patch.intervalMinutes = interval;
  const r = await api("/settings/heartbeat", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(patch) });
  if (r && r.heartbeat) {
    hmToast(r.heartbeat.enabled ? "Heartbeat on — every " + r.heartbeat.intervalMinutes + " min" : "Heartbeat off", "ok");
    loadHeartbeat();
  } else { hmToast((r && r.error) || "Could not save heartbeat"); }
}
async function runHeartbeatNow(moment) {
  hmToast(moment ? "Composing " + moment.replace("-", " ") + "…" : "Running heartbeat pulse…", "ok");
  const body = moment ? JSON.stringify({ moment }) : "{}";
  const r = await api("/heartbeat/run", { method:"POST", headers:{"Content-Type":"application/json"}, body });
  if (r && (r.report || r.text)) hmToast((moment ? "Delivered: " : "💓 ") + String(r.report || r.text).slice(0, 120), "ok");
  else if (r && r.stoodDown) hmToast("Heartbeat ran — nothing worth reporting (stood down)", "ok");
  else hmToast((r && r.error) || "Heartbeat run failed");
}
// Reveal/hide the panel-translucency slider to match the current wallpaper/theme
// state. openSettings() calls this on open; the wallpaper set/clear handlers must
// call it after loadModels() too, or the row stays stale until settings is reopened.
function syncWallpaperOpacityRow() {
  const hasWp = !!(models && models.hasWallpaper);
  const theme = (models && models.theme) || "system";
  document.getElementById("wallpaper_opacity_row").style.display = (hasWp || theme === "matrix") ? "" : "none";
  const op = (models && typeof models.wallpaperOpacity === "number") ? models.wallpaperOpacity : 82;
  document.getElementById("s_wp_opacity").value = op;
  document.getElementById("s_wp_opacity_val").textContent = op + "%";
}
async function saveWallpaperPath() {
  const wallpaperPath = document.getElementById("s_wallpaper").value.trim();
  const statusEl = document.getElementById("wallpaper_status");
  statusEl.style.color = "var(--accent)";
  statusEl.textContent = "Saving…";
  try {
    await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ wallpaperPath }) });
    await loadModels();
    syncWallpaperOpacityRow();
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
    syncWallpaperOpacityRow();
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
      syncWallpaperOpacityRow();
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
  if (!modelId) { hmToast("No model is configured yet", "err"); return; }
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

// Prompt wizard: sends the raw #t_desc text to the prompt-rewrite endpoint and
// shows the result in an editable preview. Never blocks task creation — on any
// failure this just toasts and leaves #t_desc untouched.
async function enhanceTaskPrompt() {
  const descEl = document.getElementById("t_desc");
  const raw = descEl.value.trim();
  if (!raw) { hmToast("Describe the task first.", "err"); return; }
  const btn = document.getElementById("t_enhance_btn");
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "Enhancing…";
  try {
    const result = await api("/tasks/enhance", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ description: raw }) });
    const enhanced = (result && typeof result.enhanced === "string" && result.enhanced.trim()) ? result.enhanced : raw;
    if (enhanced === raw) {
      hmToast("No changes suggested.", "ok");
      return;
    }
    document.getElementById("t_enhanced_text").value = enhanced;
    document.getElementById("t_enhanced_title").value = (result && typeof result.title === "string") ? result.title : "";
    document.getElementById("t_enhanced_rationale").textContent = (result && result.rationale) ? result.rationale : "";
    // Suggestion only — the wizard never decides. Pre-fill the preview's own
    // role select with it (already populated/kept in sync by
    // loadAgentProfiles → populateRoleSelect), so the operator sees and can
    // freely override it before accepting, right where they're already
    // reviewing the rewrite.
    const roleSel = document.getElementById("t_enhanced_role");
    if (roleSel) roleSel.value = agentProfileById[result && result.agentType] ? result.agentType : "auto";
    document.getElementById("t_enhanced_preview").style.display = "";
  } catch (e) {
    hmToast("Could not enhance prompt — using what you typed.", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}
function acceptEnhancedPrompt() {
  const enhanced = document.getElementById("t_enhanced_text").value;
  const title = document.getElementById("t_enhanced_title").value.trim();
  const suggestedRole = (document.getElementById("t_enhanced_role") || {}).value;
  document.getElementById("t_desc").value = enhanced;
  if (title) document.getElementById("t_title").value = title;
  const roleSel = document.getElementById("t_role");
  if (roleSel && suggestedRole) roleSel.value = suggestedRole;
  _promptWizardHandled = true;
  dismissEnhancedPrompt();
}
function dismissEnhancedPrompt() {
  document.getElementById("t_enhanced_preview").style.display = "none";
  _promptWizardHandled = true;
}
// Settings → Features toggle, same lookup pattern as initVoiceFeature().
async function isPromptWizardAlwaysOn() {
  try {
    const r = await api("/settings/features");
    return ((r && r.features) || []).some(f => f.key === "promptWizardAlways" && f.enabled);
  } catch (e) { return false; }
}
async function createTask() {
  const err = document.getElementById("t_err"); err.textContent = "";
  const title = document.getElementById("t_title").value.trim();
  const description = document.getElementById("t_desc").value.trim();
  const modelValue = document.getElementById("t_model").value;
  const sel = modelById[modelValue] || { modelId: null, fast: false };
  if (!description) { err.textContent = "Please describe what the agent should do."; return; }
  if (!modelValue) { err.textContent = "Please choose a model before creating the task."; return; }
  if (_attachUploading > 0) { err.textContent = "Wait for attachments to finish uploading."; return; }
  if (_attachError) { err.textContent = "Try attaching failed files again before creating the task."; return; }
  if (!_promptWizardHandled && await isPromptWizardAlwaysOn()) {
    _promptWizardHandled = true;
    await enhanceTaskPrompt();
    return; // Preview shown (or a "no changes" toast) — user confirms, then Create again.
  }
  const attachments = _attachments.slice();
  // Project is optional — an operational task (e.g. running a skill with no
  // directory of its own) doesn't need one. When nothing is picked, fall back
  // to the built-in Inbox catch-all ("~", expanded to the home dir server-side)
  // instead of blocking Create.
  const inboxFallback = projectDropdownItems.find(p => p.name === "inbox") || { name: "inbox", path: "~" };
  const projSel = (selectedProject?.name && selectedProject?.path) ? selectedProject : inboxFallback;
  const projectPath = projSel.path;
  const projectName = projSel.name;
  try {
    // Title optional — omit when blank so the daemon derives it from the instructions.
    const route = (document.getElementById("t_route") || {}).value || "auto";
    const agentType = (document.getElementById("t_role") || {}).value || "auto";
    const t = await api("/tasks", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ title: title || undefined, description, attachments, projectPath, project: projectName, model: sel.modelId || null, fastMode: sel.fast, status: "backlog", executor: "agent", route, agentType }) });
    // POST /tasks may return a normal task ({_id}) or a special route
    // ({routed,taskId} for workflow / browser-lane). All of these are success.
    const ok = t && (t._id || t.taskId || t.routed);
    if (!ok) { err.textContent = (t && t.error) ? String(t.error) : "Create failed."; return; }
    document.getElementById("t_title").value = ""; document.getElementById("t_desc").value = "";
    const roleSel = document.getElementById("t_role"); if (roleSel) roleSel.value = "auto";
    dismissEnhancedPrompt();
    _attachments = []; _attachError = ""; _attachUploading = 0; renderAttachChips();
    if (_taskFormInSession) _closeNewTaskPanel(); else toggleForm("taskForm");
    if (t.routed) {
      hmToast("Routed to " + String(t.routed).replace(/-/g, " ") + ".");
    }
    refresh();
  } catch (e2) {
    const msg = e2 instanceof Error ? e2.message : String(e2);
    err.textContent = "Could not create task: " + msg.replace(/^Error:\s*/i, "");
  }
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
  const _deProj = projectDropdownItems.find(p => p.path === d.projectPath);
  mpSet('de', _deProj ? _deProj.name : ((d.projectPath || "").split("/").filter(Boolean).pop() || "custom"), d.projectPath, !_deProj);
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
  if (!await hmConfirm("Delete this scheduled item and all its runs?", { okLabel: "Delete", danger: true })) return;
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
    es.addEventListener("brain:changed", onBrainChanged);
    es.addEventListener("flash:appended", onFlashAppended);
    // The SSE stream flaps over tunnels/proxies even when the daemon is fully
    // reachable via HTTP. Only surface "reconnecting" when HTTP polling is ALSO
    // down (a real disconnect); otherwise stay quiet — the poll keeps the app
    // live and the browser's EventSource retries on its own.
    es.onerror = () => {
      if (!_httpHealthy) { live.className = "live stale"; live.textContent = "● reconnecting"; }
    };
  } catch (e) { /* polling covers it */ }
}

// Auto-reload when the daemon version changes out from under this page. After an
// in-place app update the daemon restarts into the new build but the webview keeps
// showing the page it already loaded (stale UI — e.g. removed sections lingering).
// Poll /health; when the version differs from the one this page booted with, reload
// so the fresh console is fetched. The first successful poll just records the baseline.
let HM_BOOT_DAEMON_VERSION = null;
async function checkDaemonVersionReload() {
  try {
    const r = await fetch("/health", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.version) return;
    if (HM_BOOT_DAEMON_VERSION && j.version !== HM_BOOT_DAEMON_VERSION) {
      location.reload();
      return;
    }
    HM_BOOT_DAEMON_VERSION = j.version;
  } catch { /* offline / transient — try again next tick */ }
}

if (requireToken()) {
  loadModels();
  loadAgentProfiles();
  wireCtxSections();
  initColResizers();
  mpRegister('d',   'd_path');
  mpRegister('de',  'de_path');
  mpRegister('cmd', 'commandPath');
  mpRegister('coo', 'coo_project_path');
  loadProjects();
  refresh();
  restoreLastView();
  connectSSE();
  initVoiceFeature();
  setInterval(refresh, 5000);
  checkUpdate();
  setInterval(checkUpdate, 5 * 60 * 1000);
  checkUsage();
  checkDaemonVersionReload();
  setInterval(checkUsage, 30 * 1000);
  setInterval(checkDaemonVersionReload, 20 * 1000);
}
</script>
</body>
</html>`;
