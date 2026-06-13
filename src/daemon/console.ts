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
  /* Wallpaper: panels go translucent so the image shows through; text stays readable. */
  html[data-wallpaper="1"] body { background-size: cover; background-position: center; background-attachment: fixed; }
  html[data-wallpaper="1"] .col, html[data-wallpaper="1"] header { background-color: color-mix(in srgb, var(--panel) var(--wp-opacity, 82%), transparent); backdrop-filter: blur(6px); }
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
  /* MessageBee guided setup */
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
  .badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--badge-bg); color: var(--badge-text); }
  .badge.model { color: var(--accent-2); }
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
  .reply-toggle.active { border-color: var(--accent-2) !important; color: var(--accent-2) !important; }
  .transcript { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    max-height: 46vh; overflow-y: auto; font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
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
  .streaming { font-size: 10px; color: var(--ok); margin-left: 6px; }
  .remote-status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; margin-top: 8px; }
  .remote-status .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .remote-status .dot.on { background: var(--ok); } .remote-status .dot.off { background: var(--muted); } .remote-status .dot.err { background: var(--err); }
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
<header>
  <span class="logo">HiveMatrix</span>
  <span class="live" id="live">● live</span>
  <span style="display:flex;align-items:center;gap:8px">
    <span class="muted">project</span>
    <select id="projectSel" style="max-width:220px">
      <option value="">(all projects)</option>
    </select>
  </span>
  <span class="mode">
    <span class="muted">connectivity</span>
    <select id="modeSel">
      <option value="">(auto)</option>
      <option value="cloud-ok">cloud-ok</option>
      <option value="local-only">local-only</option>
      <option value="offline">offline</option>
    </select>
    <span class="pill" id="modePill">…</span>
    <span class="usage-pill" id="usagePill" style="display:none" title="">⚡ —</span>
    <span class="update-pill" id="updatePill" style="display:none" onclick="applyUpdate()" title="Click to install and restart">⬆ Update</span>
    <button class="gear" title="Settings" onclick="openSettings()">⚙</button>
  </span>
</header>

<div class="overlay" id="settingsOverlay">
  <div class="modal">
    <h1>Settings <span class="x" onclick="closeSettings()">✕</span></h1>
    <div class="tabs"><div class="tab active" id="tab-models" onclick="switchSettingsTab('models')">Models</div><div class="tab" id="tab-projects" onclick="switchSettingsTab('projects')">Projects</div><div class="tab" id="tab-bees" onclick="switchSettingsTab('bees')">Bees</div></div>
    <div id="settingsModels">
      <label class="flbl">Default model</label>
      <select id="s_default" style="width:100%"></select>
      <div class="row" style="margin:8px 0"><button class="create" onclick="saveDefault()">Save default</button></div>

      <label class="flbl" style="margin-top:14px">Backends</label>
      <div id="s_backends"></div>

      <div id="s_frontier_provider_row" style="display:none;margin-top:14px">
        <label class="flbl">Frontier provider (Mixed / Cloud-only)</label>
        <div class="row" style="align-items:center;gap:8px">
          <select id="s_frontier_provider" onchange="saveFrontierProvider()" style="width:auto">
            <option value="claude">Claude (Sonnet / Opus)</option>
            <option value="codex">Codex (GPT-5.5)</option>
          </select>
        </div>
        <div class="muted" style="font-size:11px;margin-top:2px">Which provider handles the frontier tier in Mixed and Cloud-only modes.</div>
      </div>

      <label class="flbl" style="margin-top:14px">Local server endpoint</label>
      <div class="row"><input id="s_endpoint" placeholder="http://localhost:1234/v1" style="flex:1" />
        <button class="create" onclick="saveEndpoint()">Save</button></div>

      <label class="flbl" style="margin-top:16px">Appearance</label>
      <div class="row" style="align-items:center; gap:10px">
        <span class="muted">Theme</span>
        <select id="s_theme" onchange="saveTheme()" style="width:auto">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
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
          <input type="range" id="s_wp_opacity" min="40" max="100" step="1" style="flex:1" oninput="onOpacityInput(this.value)" onchange="saveOpacity(this.value)" />
          <span class="muted" id="s_wp_opacity_val" style="min-width:42px;text-align:right">82%</span>
        </div>
        <div class="muted" style="font-size:11px">Lower = more wallpaper shows through the panels.</div>
      </div>

      <label class="flbl" style="margin-top:16px">Location</label>
      <div class="row" style="gap:6px">
        <input id="s_location" placeholder="e.g. Cincinnati, OH" style="flex:1" />
        <button class="sm" onclick="saveLocation()">Save</button>
      </div>
      <div class="muted" style="font-size:11px;margin-top:2px">Shared with location-aware tasks (weather, "near me", local time) — e.g. texts to MessageBee.</div>

      <label class="flbl" style="margin-top:16px">Updates</label>
      <div class="row" style="align-items:center;gap:8px">
        <input type="checkbox" id="s_autoupdate" onchange="saveAutoUpdate()" style="width:auto" />
        <span class="muted">Automatically install updates on launch</span>
      </div>
      <div class="muted" style="font-size:11px;margin-top:2px">Off = you'll see an "Update" button in the header to install when you choose.</div>

      <h2 style="margin-top:18px">Remote Access</h2>
      <div class="remote-status"><span class="dot" id="s_remote_dot"></span><span id="s_remote_label">…</span></div>
      <div id="s_tunnel_detail" class="muted" style="font-size:11px;margin-top:4px"></div>

      <label class="flbl" style="margin-top:10px">Temporary ad-hoc tunnel</label>
      <div class="row">
        <button class="create" id="s_tunnel_btn" onclick="toggleTunnel()">Start temporary tunnel</button>
      </div>
      <div class="muted" style="font-size:11px;margin-top:4px">Creates a temporary trycloudflare.com URL for quick pairing.</div>

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

      <details style="margin-top:12px">
        <summary class="muted" style="cursor:pointer;font-size:12px">Advanced: Named Cloudflare tunnel</summary>
        <label class="flbl" style="margin-top:8px">Public hostname</label>
        <div class="row"><input id="s_named_host" placeholder="hivey.cassio.io" style="flex:1" />
          <button class="copybtn" onclick="configureNamedTunnel()">Save / show QR</button></div>
        <div class="muted" style="font-size:11px;margin-top:4px">Use a stable Cloudflare hostname for one-time mobile pairing.</div>

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
      </details>

      <div class="muted" style="font-size:11px;margin-top:10px">⚠ A tunnel exposes the daemon to the internet; the access token is the only barrier — treat it like a password. The console never hands the token to tunneled visitors.</div>

      <div class="vinfo" id="s_version">…</div>
    </div>
    <div id="settingsProjects" style="display:none">
      <div class="kv"><span class="k">discovered</span><span id="s_proj_count">…</span></div>
      <div id="s_projects"></div>
      <div class="row" style="margin-top:10px"><button class="create" onclick="refreshProjects()">↻ Re-scan</button></div>
      <div class="muted" style="font-size:11px;margin-top:8px">Projects discovered from git repos, Claude Code history, and VS Code recents. ★ = pre-selected (active project).</div>
    </div>
    <div id="settingsBees" style="display:none">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Embedded capability lanes</label>
        <button class="copybtn" onclick="renderSettingsBees()">↻ Refresh</button>
      </div>
      <div id="s_bees" style="margin-top:8px"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <label class="flbl" style="margin:0">Safe senders</label>
        <button class="copybtn" onclick="renderSafeSenders()">↻</button>
      </div>
      <div id="s_safe_senders" style="margin-top:4px"></div>
      <div class="muted" style="font-size:11px;margin-top:10px">Embedded lanes run inside the daemon and follow the connectivity mode. Launch-agent lanes (e.g. BrainBee) can be toggled on/off — that installs/removes their macOS LaunchAgent.</div>
    </div>
  </div>
</div>

<!-- Generic dialog (replaces native alert/confirm/prompt, which don't work in the webview). -->
<div class="overlay" id="dialogOverlay">
  <div class="modal dialog">
    <h1 id="dialogTitle">HiveMatrix</h1>
    <div class="dialog-msg" id="dialogMsg"></div>
    <input class="dialog-input" id="dialogInput" style="display:none" onkeydown="if(event.key==='Enter'){event.preventDefault();dialogResolve(true);}else if(event.key==='Escape'){event.preventDefault();dialogResolve(false);}" />
    <div class="dialog-actions">
      <button class="cancel" id="dialogCancel" onclick="dialogResolve(false)">Cancel</button>
      <button class="ok" id="dialogOk" onclick="dialogResolve(true)">OK</button>
    </div>
  </div>
</div>

<!-- MessageBee guided setup. -->
<div class="overlay" id="mbOverlay">
  <div class="modal" style="width:460px">
    <h1>Set up MessageBee <span class="x" onclick="closeMessageBee()">✕</span></h1>
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

<!-- MailBee guided setup. -->
<div class="overlay" id="mailOverlay">
  <div class="modal" style="width:460px">
    <h1>Set up MailBee <span class="x" onclick="closeMailBee()">✕</span></h1>
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
      <button class="ok" onclick="submitMailBee()">Enable MailBee</button>
    </div>
    <div class="muted" id="ml_status" style="font-size:11px;margin-top:8px"></div>
  </div>
</div>

<main>
  <section class="col board">
    <h2>Board <span id="archiveBtn" class="archive-link" onclick="archiveCompleted()" title="Archive review/done/failed tasks"></span></h2>
    <button class="addbtn" onclick="toggleForm('taskForm')">＋ New task</button>
    <div class="form" id="taskForm">
      <input id="t_title" placeholder="Title (optional — derived from instructions)" />
      <textarea id="t_desc" placeholder="What should the agent do? (be specific)"></textarea>
      <label class="flbl">Project</label>
      <div id="t_project_wrapper" class="project-search">
        <input id="t_project_search" type="text" placeholder="Search projects…" oninput="filterProjectDropdown()" onfocus="openProjectDropdown()" />
        <div id="t_project_dropdown" class="project-dropdown hidden">
          <div class="project-sort-row">
            <span class="project-sort-btn active" data-sort="recent" onclick="sortProjectsDropdown('recent')">Most recent</span>
            <span class="project-sort-btn" data-sort="name" onclick="sortProjectsDropdown('name')">Name A–Z</span>
          </div>
          <div id="t_project_list" class="project-list"></div>
          <div id="t_project_empty" class="project-empty hidden">No projects found</div>
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
    <h2>Setup</h2>
    <div id="onboarding"></div>
    <h2 style="margin-top:20px">Soak / Health</h2>
    <div id="metrics"></div>
    <h2 style="margin-top:20px">Frontier Usage</h2>
    <div id="usage"><div class="muted">No frontier spend yet.</div></div>
    <h2 style="margin-top:20px">Connectivity</h2>
    <div id="conn"></div>
    <h2 style="margin-top:20px">Directives</h2>
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
    <div id="directives"></div>
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

// --- In-DOM dialogs ---------------------------------------------------------
// The Tauri/WKWebView webview has no working native alert/confirm/prompt
// (prompt returns null, alert is a no-op), so these reimplement them in the DOM.
let _dialogResolver = null;
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
    document.getElementById("dialogOverlay").classList.add("open");
    if (opts.prompt) setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}
function hmAlert(message, title) { return _openDialog({ message, title, hideCancel: true }); }
function hmConfirm(message, opts) { return _openDialog(Object.assign({ message }, opts || {})); }
function hmPrompt(message, defaultValue, opts) { return _openDialog(Object.assign({ message, prompt: true, defaultValue }, opts || {})); }

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
          + (t.directiveId?'<span class="badge">directive</span>':'')+'</div></div>').join("")
      + '</div>';
  }).join("") || '<div class="muted">No tasks.</div>';
  const archivable = state.tasks.filter(t => ["review","done","failed","cancelled"].includes(t.status)).length;
  const ab = document.getElementById("archiveBtn");
  if (ab) ab.textContent = archivable ? "· archive completed (" + archivable + ")" : "";
}

// Minimal, safe markdown → HTML (escapes first, then a few inline/block rules).
function mdToHtml(src) {
  let s = esc(src || "");
  s = s.replace(/\x60\x60\x60([\s\S]*?)\x60\x60\x60/g, (m,c)=>'<pre>'+c.replace(/^\n/,'')+'</pre>');
  s = s.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  s = s.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  return s.replace(/\n/g, '<br>');
}

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
  if (running) b.push('<button onclick="taskAction(\''+t._id+'\',\'cancel\')">■ Cancel</button>');
  if (retryable) b.push('<button class="reply-toggle" id="retryToggle_'+t._id+'" onclick="toggleRetry(\''+t._id+'\')">↻ Retry</button>');
  if (t.pendingQuestion) b.push('<button class="reply-toggle" id="replyToggle_'+t._id+'" onclick="toggleReply(\''+t._id+'\')">↩ Reply</button>');
  if (!running) b.push('<button onclick="taskAction(\''+t._id+'\',\'archive\')">⌫ Archive</button>');
  b.push('<button class="danger" onclick="deleteTask(\''+t._id+'\')">🗑 Delete</button>');
  let html = '<div class="actions">'+b.join("")+'</div>';
  // Retry-with-steer: optional guidance text + attachments fold out under Retry.
  if (retryable) {
    html += '<div id="retrySection_'+t._id+'" class="reply-section">'
      + '<textarea id="retryText" class="reply-input" placeholder="Optional: add guidance to steer the rerun…" rows="2"></textarea>'
      + attachPickerHtml('retry')
      + '<div class="reply-row" style="margin-top:6px"><button onclick="submitRetry(\''+t._id+'\')">↻ Retry'+(t.status==='cancelled'?'':' with guidance')+'</button></div></div>';
  }
  // Reply to a needs_input question: text (auto-opens) + attachments.
  const isOpen = t.reviewState === "needs_input";
  const q = t.pendingQuestion ? '<div class="reply-question">'+esc(t.pendingQuestion)+'</div>' : '';
  html += '<div id="replySection_'+t._id+'" class="reply-section'+(isOpen?' open':'')+'">'
    + q
    + '<textarea id="replyText" class="reply-input" placeholder="Type your reply…" rows="2"></textarea>'
    + attachPickerHtml('reply')
    + '<div class="reply-row" style="margin-top:6px"><button onclick="replyTask(\''+t._id+'\')">↩ Send Reply</button></div></div>';
  return html;
}

async function selectTask(id) {
  state.selected = id;
  // Switching tasks clears any half-composed retry/reply attachments; staying on
  // the same task across a live refresh keeps them.
  if (_ctxAttachTask !== id) { _ctxAttach = { retry: [], reply: [] }; _ctxAttachTask = id; }
  renderBoard();
  const t = await api("/tasks/"+id);
  if (!t || !t._id) { state.selected = null; return; }
  const out = t.output ? (typeof t.output==="string"?JSON.parse(t.output):t.output) : {};
  const logs = typeof t.logs === "string" ? (()=>{try{return JSON.parse(t.logs)}catch{return[]}})() : (t.logs||[]);
  const live = ["assigned","in_progress"].includes(t.status);
  const el = document.getElementById("session");
  // Preserve scroll for non-live tasks — innerHTML rebuild resets scrollTop to 0.
  const prevScrollTop = live ? null : (el.querySelector(".transcript")?.scrollTop ?? null);
  el.innerHTML = '<div class="session"><h1>'+esc(t.title||t._id)+(live?'<span class="streaming">● running</span>':'')+'</h1>'
    + '<div class="sub">'+esc(t.project||"")+' · '+esc(t.status)+(t.reviewState?' · '+esc(t.reviewState):'')+'</div>'
    + taskActionsHtml(t)
    + '<div class="kv">'
    + '<span class="k">model</span><span>'+esc(t.model||"—")+'</span>'
    + '<span class="k">project path</span><span>'+esc(t.projectPath||"—")+'</span>'
    + '<span class="k">directive</span><span>'+esc(t.directiveId||"—")+'</span>'
    + '<span class="k">completedBy</span><span>'+esc(t.completedBy||"—")+'</span>'
    + '<span class="k">prover</span><span>'+esc(t.proverType||"—")+'</span>'
    + '</div>'
    + '<h2>Description</h2><div class="desc md">'+mdToHtml(t.description||"")+'</div>'
    + (t.error?'<h2>Error</h2><div class="errbox">'+esc(t.error)+'</div>':'')
    + '<h2>Session transcript</h2>'+renderTranscript(logs)
    + (out.summary?'<h2>Result</h2><div class="desc md">'+mdToHtml(out.summary)+'</div>':'')
    + '</div>';
  const tr = el.querySelector(".transcript");
  if (tr) {
    if (live) tr.scrollTop = tr.scrollHeight;
    else if (prevScrollTop !== null) tr.scrollTop = prevScrollTop;
  }
  // Restore attachment chips after the innerHTML rebuild.
  renderCtxChips("retry"); renderCtxChips("reply");
}

async function taskAction(id, action) {
  await api("/tasks/"+id+"/"+action, { method: "POST" });
  refresh();
}
async function deleteTask(id) {
  await api("/tasks/"+id, { method: "DELETE" });
  if (state.selected === id) { state.selected = null; document.getElementById("session").innerHTML = '<div class="session-empty">Select a task to inspect its session.</div>'; }
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

// Per-context attachment state for the retry-steer + reply forms. Reset when a
// different task is selected (see selectTask), preserved across same-task
// re-renders so a live refresh doesn't drop files mid-compose.
let _ctxAttach = { retry: [], reply: [] };
let _ctxAttachTask = null;
function onCtxAttach(ctx, input) {
  for (const f of input.files) { const p = f.path || f.name; if (p && !_ctxAttach[ctx].includes(p)) _ctxAttach[ctx].push(p); }
  input.value = "";
  renderCtxChips(ctx);
}
function removeCtxAttach(ctx, idx) { _ctxAttach[ctx].splice(idx, 1); renderCtxChips(ctx); }
function renderCtxChips(ctx) {
  const chips = document.getElementById(ctx+"AttachChips");
  const hint = document.getElementById(ctx+"AttachHint");
  if (!chips) return;
  if (hint) hint.textContent = _ctxAttach[ctx].length ? "" : "No files";
  chips.innerHTML = _ctxAttach[ctx].map((p, i) => {
    const name = p.split("/").pop() || p;
    return '<div class="attach-chip" title="'+esc(p)+'"><span>'+esc(name)+'</span><span class="rm" onclick="removeCtxAttach(\''+ctx+'\','+i+')">×</span></div>';
  }).join("");
}

function toggleRetry(id) {
  const sec = document.getElementById("retrySection_"+id);
  const btn = document.getElementById("retryToggle_"+id);
  if (!sec) return;
  const opening = !sec.classList.contains("open");
  sec.classList.toggle("open", opening);
  if (btn) btn.classList.toggle("active", opening);
  if (opening) { const ta = document.getElementById("retryText"); if (ta) ta.focus(); }
}
async function submitRetry(id) {
  const ta = document.getElementById("retryText");
  const steer = ta ? ta.value.trim() : "";
  const attachments = _ctxAttach.retry.slice();
  await api("/tasks/"+id+"/retry", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ steer, attachments }) });
  _ctxAttach.retry = [];
  refresh();
}

async function replyTask(id) {
  const el = document.getElementById("replyText");
  let text = el ? el.value.trim() : "";
  const attachments = _ctxAttach.reply.slice();
  if (!text && !attachments.length) { el && el.focus(); return; }
  if (attachments.length) text += (text ? "\n\n" : "") + "Attached files:\n" + attachments.map(p => "- " + p).join("\n");
  el.disabled = true;
  const r = await api("/tasks/"+id+"/reply", { method: "POST", body: JSON.stringify({ text }) });
  if (r && r.ok) { _ctxAttach.reply = []; refresh(); selectTask(id); }
  else { hmAlert(r?.error || "Failed to send reply"); el.disabled = false; }
}

function toggleReply(id) {
  const sec = document.getElementById("replySection_"+id);
  const btn = document.getElementById("replyToggle_"+id);
  if (!sec) return;
  const opening = !sec.classList.contains("open");
  sec.classList.toggle("open", opening);
  if (btn) btn.classList.toggle("active", opening);
  if (opening) { const ta = document.getElementById("replyText"); if (ta) ta.focus(); }
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
}

// Steps that POST straight to /onboarding/<id> with no extra input.
const NO_INPUT_STEPS = ['config', 'daemon', 'desktopbee'];

// First-run wizard: drive each incomplete step through its POST endpoint.
async function wizardAction(id) {
  try {
    // MessageBee / MailBee have their own guided modals.
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

// --- MessageBee guided setup ------------------------------------------------
function mbStep() { return (state.onboarding && state.onboarding.steps || []).find(s => s.id === 'messagebee'); }
function openMessageBeeSetup() {
  document.getElementById('mb_err').textContent = '';
  document.getElementById('mb_status').textContent = '';
  document.getElementById('mb_phone').value = '';
  renderMessageBeeState(null);
  renderIgnoredSenders();
  document.getElementById('mbOverlay').classList.add('open');
  setTimeout(() => document.getElementById('mb_phone').focus(), 30);
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
  const fdaReadable = data ? !!data.chatDbReadable : !/Full Disk Access/i.test((mbStep() || {}).detail || 'x');
  const enabled = data ? !!data.enabled : ((mbStep() || {}).state === 'done');
  const ids = data ? (data.identities || []) : null;
  const mark = (el, ok) => { el.textContent = ok ? '✓' : '○'; el.className = 'mb-mark ' + (ok ? 'ok' : 'no'); };
  mark(document.getElementById('mb_fda_mark'), fdaReadable);
  mark(document.getElementById('mb_chan_mark'), enabled);
  document.getElementById('mb_fda_detail').textContent = fdaReadable
    ? 'Granted — HiveMatrix can read Messages.'
    : 'HiveMatrix needs Full Disk Access to read Messages (chat.db). Grant it, then re-run.';
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

// --- MailBee guided setup ---------------------------------------------------
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

async function refresh() {
  try {
    [state.tasks, state.directives, state.conn, state.metrics, state.onboarding] = await Promise.all([
      api("/tasks"), api("/directives"), api("/connectivity"), api("/metrics"), api("/onboarding"),
    ]);
    renderBoard(); renderConn(); renderDirectives(); renderMetrics(); renderOnboarding();
    if (state.selected) selectTask(state.selected);
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

function usagePlanLabel(status) {
  if (!status) return "usage";
  if (status.subscriptionType === "max" && status.rateLimitTier === "default_claude_max_5x") return "Max 5x";
  if (status.subscriptionType) return String(status.subscriptionType).charAt(0).toUpperCase() + String(status.subscriptionType).slice(1);
  return "usage";
}

async function checkUsage() {
  try {
    const u = await api("/usage");
    if (!u) return;
    const sub = u.subscription;
    const subStatus = u.subscriptionStatus;
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
        if (u.taskCount > 0) lines.push("", "HiveMatrix spend: $" + (u.totalCost||0).toFixed(2) + " over " + u.taskCount + " task(s)");
        pill.title = lines.join("\n");
      } else if (subStatus && subStatus.state !== "missing_credentials") {
        const label = usagePlanLabel(subStatus);
        pill.textContent = "⚡ " + label + " ?";
        pill.style.display = "";
        pill.title = (subStatus.message || "Claude subscription usage left is unavailable.")
          + "\nHiveMatrix spend: $" + (u.totalCost || 0).toFixed(2) + " over " + (u.taskCount||0) + " task(s)";
      } else {
        // No subscription data — fall back to spend.
        const total = "$" + (u.totalCost || 0).toFixed(2);
        pill.textContent = "⚡ " + total;
        pill.style.display = u.taskCount > 0 ? "" : "none";
        pill.title = "Frontier spend: " + total + " over " + (u.taskCount||0) + " task(s)\n"
          + (u.byModel||[]).map(m => m.label + ": $" + m.cost.toFixed(2) + " (" + m.tasks + ")").join("\n");
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
        + '<div class="muted" style="font-size:11px">' + esc(subStatus.message || "Usage left unavailable.") + '</div>';
    }

    // HiveMatrix task spend.
    if (u.byModel && u.byModel.length) {
      if ((sub && (sub.fiveHour || sub.sevenDay)) || (subStatus && subStatus.state !== "missing_credentials")) html += '<div class="usep"></div>';
      const total = "$" + (u.totalCost || 0).toFixed(2);
      html += '<div class="urow"><span><b>' + total + '</b> spent</span>'
        + '<span class="um">' + u.taskCount + ' tasks · ' + fmtTokens(u.inputTokens) + ' in / ' + fmtTokens(u.outputTokens) + ' out</span></div>'
        + u.byModel.map(m => '<div class="urow"><span>' + esc(m.label) + '</span>'
          + '<span class="um">$' + m.cost.toFixed(2) + ' · ' + m.tasks + ' task' + (m.tasks===1?'':'s') + '</span></div>').join("");
    } else if (!sub || (!sub.fiveHour && !sub.sevenDay)) {
      html += '<div class="muted">No frontier spend yet — local Qwen work is free.</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  } catch (e) { /* transient */ }
}

// --- Update indicator -------------------------------------------------------
async function checkUpdate() {
  try {
    const s = await api("/update/status");
    const pill = document.getElementById("updatePill");
    if (!pill) return;
    if (s && s.updateAvailable && s.latest) {
      pill.textContent = "⬆ Update " + s.latest;
      pill.dataset.latest = s.latest;
      pill.style.display = "";
    } else {
      pill.style.display = "none";
    }
  } catch (e) { /* offline / transient */ }
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

function applyTheme(theme, hasWallpaper) {
  const root = document.documentElement;
  let resolved = theme;
  if (theme === "system") resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  root.dataset.theme = resolved;
  if (hasWallpaper) {
    root.dataset.wallpaper = "1";
    const op = (models && typeof models.wallpaperOpacity === "number") ? models.wallpaperOpacity : 82;
    root.style.setProperty("--wp-opacity", op + "%");
    document.body.style.backgroundImage = 'url("/wallpaper?token=' + encodeURIComponent(HM_TOKEN) + '&t=' + Date.now() + '")';
  } else {
    delete root.dataset.wallpaper;
    document.body.style.backgroundImage = "";
  }
}

async function loadModels() {
  models = await api("/models");
  if (!models) return;
  applyTheme(models.theme || "system", !!models.hasWallpaper);
  for (const m of models.available) modelById[m.id] = { modelId: m.modelId, fast: !!m.fast };
  // Populate the New Task dropdown
  const sel = document.getElementById("t_model");
  sel.innerHTML = models.available.map(m => '<option value="'+esc(m.id)+'">'+esc(m.name)+(m.note?' — '+esc(m.note):'')+'</option>').join("")
    || '<option value="">(no models configured)</option>';
  // Default selection
  const def = models.available.find(m => m.modelId === models.defaultModel || m.id === models.defaultModel);
  if (def) sel.value = def.id;
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
      if (activeOpt && activeOpt.dataset.path) document.getElementById("t_path").value = activeOpt.dataset.path;
    }
  } catch (e) { /* transient */ }
}

document.getElementById("projectSel").addEventListener("change", async (e) => {
  state.selectedProject = e.target.value;
  localStorage.setItem("hm_project", e.target.value);
  renderBoard();
  // Sync task-form project path when header project changes
  const opt = e.target.options[e.target.selectedIndex];
  if (opt && opt.dataset.path) document.getElementById("t_path").value = opt.dataset.path;
});

function onProjectSelect() {
  // Legacy hook — no-op now that we use the search dropdown
}

let _attachPaths = [];
function onAttachFiles(input) {
  for (const f of input.files) {
    const p = f.path || f.name;  // Tauri exposes .path; fallback to name
    if (p && !_attachPaths.includes(p)) _attachPaths.push(p);
  }
  input.value = "";  // allow re-selecting the same file
  renderAttachChips();
}
function removeAttach(idx) {
  _attachPaths.splice(idx, 1);
  renderAttachChips();
}
function renderAttachChips() {
  const chips = document.getElementById("t_attach_chips");
  const hint = document.getElementById("t_attach_hint");
  hint.textContent = _attachPaths.length ? "" : "No files selected";
  chips.innerHTML = _attachPaths.map((p, i) => {
    const name = p.split("/").pop() || p;
    return '<div class="attach-chip" title="'+esc(p)+'"><span>'+esc(name)+'</span><span class="rm" onclick="removeAttach('+i+')">×</span></div>';
  }).join("");
}

function openSettings() {
  document.getElementById("settingsOverlay").classList.add("open");
  if (!models) return;
  const sd = document.getElementById("s_default");
  sd.innerHTML = models.available.map(m => '<option value="'+esc(m.modelId)+'">'+esc(m.name)+'</option>').join("");
  if (models.defaultModel) sd.value = models.defaultModel;
  document.getElementById("s_backends").innerHTML = models.backends.map(b =>
    '<div class="backend"><span class="nm">'+esc(b.name)+'</span>'
    + '<span class="st '+(b.configured?'ok':'no')+'">'+(b.configured?'✓ '+esc(b.detail):'not set up')+'</span>'
    + (b.configured?'':'<span class="muted" style="flex:1"> — '+esc(b.connect||'')+'</span>')+'</div>').join("");
  const local = models.backends.find(b => b.id === "local");
  document.getElementById("s_endpoint").value = (local && local.endpoint) || "http://localhost:1234/v1";
  const v = models.version || {};
  document.getElementById("s_version").textContent = "HiveMatrix v" + (v.version||"?") + " · build " + (v.build||"?") + " · " + (v.date||"?");
  document.getElementById("s_theme").value = models.theme || "system";
  document.getElementById("s_token").value = HM_TOKEN || "(load the local console to see the token)";
  // Wallpaper: reflect the current image + path so settings shows what's active.
  const hasWp = !!models.hasWallpaper;
  document.getElementById("s_wallpaper").value = hasWp ? (models.wallpaperPath || "") : "";
  if (hasWp) showWallpaperPreview(); else document.getElementById("wallpaper_preview").style.display = "none";
  document.getElementById("wallpaper_opacity_row").style.display = hasWp ? "" : "none";
  const op = typeof models.wallpaperOpacity === "number" ? models.wallpaperOpacity : 82;
  document.getElementById("s_wp_opacity").value = op;
  document.getElementById("s_wp_opacity_val").textContent = op + "%";
  document.getElementById("s_location").value = models.location || "";
  document.getElementById("s_autoupdate").checked = !!models.autoUpdate;
  const hasBothFrontier = models.backends.some(b => b.id === "claude" && b.configured)
                        && models.backends.some(b => b.id === "codex" && b.configured);
  document.getElementById("s_frontier_provider_row").style.display = hasBothFrontier ? "" : "none";
  if (hasBothFrontier) document.getElementById("s_frontier_provider").value = models.frontierProvider || "claude";
  loadTunnel();
}
function closeSettings() { document.getElementById("settingsOverlay").classList.remove("open"); }
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
  document.getElementById("tab-models").className = "tab" + (tab === "models" ? " active" : "");
  document.getElementById("tab-projects").className = "tab" + (tab === "projects" ? " active" : "");
  document.getElementById("tab-bees").className = "tab" + (tab === "bees" ? " active" : "");
  document.getElementById("settingsModels").style.display = tab === "models" ? "" : "none";
  document.getElementById("settingsProjects").style.display = tab === "projects" ? "" : "none";
  document.getElementById("settingsBees").style.display = tab === "bees" ? "" : "none";
  if (tab === "projects") renderSettingsProjects();
  if (tab === "bees") { renderSettingsBees(); renderSafeSenders(); }
}

async function renderSettingsBees() {
  const el = document.getElementById("s_bees");
  el.innerHTML = '<div class="muted">Loading…</div>';
  const r = await api("/bees");
  const bees = (r && r.bees) || [];
  if (!bees.length) { el.innerHTML = '<div class="muted">No bee lanes registered.</div>'; return; }
  el.innerHTML = bees.map(b => {
    const dotColor = b.running ? (b.healthy === false ? "var(--accent-2)" : "var(--ok)") : "var(--muted)";
    const stateTxt = b.runtimeMode === "planned" ? "planned"
      : b.running ? (b.healthy === false ? "running (unhealthy)" : "running")
      : "stopped";
    const modeBadge = '<span class="badge">'+esc(b.runtimeMode)+'</span>';
    const healthBadge = b.healthy === true ? '<span class="badge" style="color:var(--ok)">healthy</span>'
      : b.healthy === false ? '<span class="badge" style="color:var(--accent-2)">unhealthy</span>' : '';
    // Toggle only for manageable launchagent bees.
    const toggle = (b.manageable && b.runtimeMode === "launchagent")
      ? '<button class="copybtn" onclick="toggleBee(\''+esc(b.kind)+'\','+(b.running?'false':'true')+')">'+(b.running?'Turn off':'Turn on')+'</button>'
      : '<span class="muted" style="font-size:10px">'+(b.runtimeMode==="embedded"?'follows mode':'—')+'</span>';
    return '<div class="card" style="cursor:default">'
      + '<div class="t"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+dotColor+';margin-right:6px"></span>'+esc(b.name)+'</div>'
      + '<div class="m">'+modeBadge+healthBadge+'<span class="badge">'+esc(stateTxt)+'</span></div>'
      + (b.summary?'<div class="muted" style="font-size:11px;margin-top:4px">'+esc(b.summary)+'</div>':'')
      + (b.statusDetail?'<div class="muted" style="font-size:10px;margin-top:2px">'+esc(b.statusDetail)+'</div>':'')
      + '<div class="row" style="margin-top:6px;justify-content:flex-end">'+toggle+'</div>'
      + '</div>';
  }).join("");
}

async function toggleBee(kind, enable) {
  const r = await api("/bees/"+kind+"/autostart", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ enabled: enable }) });
  if (r && r.error) { hmAlert(r.error); }
  setTimeout(renderSettingsBees, 800); // give launchctl a moment
}

// --- Safe senders (MessageBee + MailBee) ------------------------------------
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
    + '<div class="ss-section-hd">MessageBee — iMessage / SMS</div>'
    + chips(mbIds, "rmMbSender") + ignoredHtml
    + '<div class="row" style="margin-top:6px;gap:6px">'
    + '<input id="ss_mb_input" class="dialog-input" placeholder="+15551234567 or you@icloud.com" style="flex:1;margin:0"'
    + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();addMbSender();}" />'
    + '<button class="copybtn" onclick="addMbSender()">Add</button></div>'
    + '<div class="err" id="ss_mb_err" style="font-size:11px;margin-top:3px"></div>'
    + '</div>'
    + '<div class="ss-section">'
    + '<div class="ss-section-hd">MailBee — Email</div>'
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
}
async function saveFrontierProvider() {
  const frontierProvider = document.getElementById("s_frontier_provider").value;
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ frontierProvider }) });
  await loadModels();
}
async function saveEndpoint() {
  const localEndpoint = document.getElementById("s_endpoint").value.trim();
  await api("/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ localEndpoint }) });
  await loadModels();
}

async function createTask() {
  const err = document.getElementById("t_err"); err.textContent = "";
  const title = document.getElementById("t_title").value.trim();
  let description = document.getElementById("t_desc").value.trim();
  const projectPath = document.getElementById("t_path").value.trim();
  const projName = selectedProjectName || null;
  const sel = modelById[document.getElementById("t_model").value] || { modelId: null, fast: false };
  if (!description || !projectPath) { err.textContent = "Description and project path are required."; return; }
  if (_attachPaths.length) description += "\n\nAttached files:\n" + _attachPaths.map(p => "- " + p).join("\n");
  try {
    // Title optional — omit when blank so the daemon derives it from the instructions.
    const t = await api("/tasks", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ title: title || undefined, description, projectPath, project: projName || "console", model: sel.modelId || null, fastMode: sel.fast, status: "backlog", executor: "agent" }) });
    if (!t || !t._id) { err.textContent = "Create failed."; return; }
    document.getElementById("t_title").value = ""; document.getElementById("t_desc").value = "";
    _attachPaths = []; renderAttachChips();
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
  loadProjects();
  refresh();
  connectSSE();
  setInterval(refresh, 5000);
  checkUpdate();
  setInterval(checkUpdate, 5 * 60 * 1000);
  checkUsage();
  setInterval(checkUsage, 30 * 1000);
}
</script>
</body>
</html>`;
