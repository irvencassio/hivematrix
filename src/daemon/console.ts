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
  }
  html[data-theme="light"] {
    --bg: #f6f8fa; --panel: #ffffff; --panel-2: #eef1f5; --border: #d0d7de;
    --text: #1f2328; --muted: #656d76; --accent: #9a6700; --accent-2: #0969da;
    --ok: #1a7f37; --warn: #9a6700; --err: #cf222e;
  }
  /* Wallpaper: panels go translucent so the image shows through; text stays readable. */
  html[data-wallpaper="1"] body { background-size: cover; background-position: center; background-attachment: fixed; }
  html[data-wallpaper="1"] .col, html[data-wallpaper="1"] header { background-color: color-mix(in srgb, var(--panel) 82%, transparent); backdrop-filter: blur(6px); }
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
  .form button.create { background: var(--accent); color: #1a1a1a; border: 0; border-radius: 6px;
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
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: none;
    align-items: center; justify-content: center; z-index: 50; }
  .overlay.open { display: flex; }
  .modal { width: 640px; max-width: 92vw; max-height: 84vh; overflow-y: auto; background: var(--panel);
    border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .modal h1 { font-size: 16px; margin: 0 0 14px; display: flex; align-items: center; }
  .modal h1 .x { margin-left: auto; cursor: pointer; color: var(--muted); font-weight: 400; }
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
    padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: border-color .1s; position: relative; }
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
  .badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #21262d; color: var(--muted); }
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
  .reply-question { background: rgba(88,166,255,.08); border: 1px solid var(--accent-2); border-radius: 6px;
    padding: 8px 12px; font-size: 12px; color: var(--text); margin-bottom: 8px; }
  .reply-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 16px; }
  .reply-input { flex: 1; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); font: 12px/1.4 inherit; padding: 6px 10px; resize: vertical; }
  .reply-input:focus { outline: none; border-color: var(--accent-2); }
  .reply-row button { background: var(--accent-2); color: #fff; border: none; border-radius: 6px;
    padding: 6px 14px; font-size: 11px; cursor: pointer; white-space: nowrap; }
  .reply-row button:hover { opacity: .85; }
  .transcript { background: #0a0d12; border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    max-height: 46vh; overflow-y: auto; font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; margin-bottom: 16px; }
  .transcript .ln { padding: 1px 0; }
  .transcript .ln.error { color: var(--err); }
  .transcript .ln.tool { color: var(--accent); }
  .transcript .ln.text { color: var(--text); }
  .errbox { background: rgba(248,81,73,.08); border: 1px solid var(--err); border-radius: 8px;
    padding: 10px; color: var(--err); white-space: pre-wrap; margin-bottom: 16px; font-size: 12px; }
  .md h1,.md h2,.md h3 { color: var(--text); margin: 8px 0 4px; }
  .md h1 { font-size: 16px; } .md h2 { font-size: 14px; } .md h3 { font-size: 13px; }
  .md code { background: #0a0d12; padding: 1px 4px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; }
  .md pre { background: #0a0d12; border: 1px solid var(--border); border-radius: 6px; padding: 8px; overflow-x: auto; }
  .md a { color: var(--accent-2); } .md ul { margin: 4px 0; padding-left: 18px; }
  .streaming { font-size: 10px; color: var(--ok); margin-left: 6px; }
  .remote-status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; margin-top: 8px; }
  .remote-status .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .remote-status .dot.on { background: var(--ok); } .remote-status .dot.off { background: var(--muted); } .remote-status .dot.err { background: var(--err); }
  .copybtn { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px 12px; font-size: 11px; cursor: pointer; }
  .copybtn:hover { border-color: var(--accent); }
  #s_qr svg { width: 100%; height: 100%; }
  /* Project search dropdown */
  .project-search { position: relative; margin-bottom: 6px; }
  .project-search input { width: 100%; box-sizing: border-box; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 12px; font-family: inherit; }
  .project-search input:focus { outline: none; border-color: var(--accent); }
  .project-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    margin-top: 2px; max-height: 240px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  .project-dropdown.hidden { display: none; }
  .project-sort-row { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .project-sort-btn { font-size: 10px; padding: 2px 8px; border-radius: 999px; cursor: pointer;
    color: var(--muted); background: var(--panel-2); border: 1px solid var(--border); user-select: none; }
  .project-sort-btn.active { color: var(--accent); border-color: var(--accent); }
  .project-list { max-height: 200px; overflow-y: auto; }
  .project-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer;
    font-size: 12px; border-bottom: 1px solid var(--border); }
  .project-item:last-child { border-bottom: none; }
  .project-item:hover, .project-item.selected { background: var(--panel-2); }
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

      <h2 style="margin-top:18px">Remote Access</h2>
      <div class="remote-status"><span class="dot" id="s_remote_dot"></span><span id="s_remote_label">…</span></div>
      <div id="s_tunnel_detail" class="muted" style="font-size:11px;margin-top:4px"></div>

      <div class="row" style="margin-top:10px">
        <button class="create" id="s_tunnel_btn" onclick="toggleTunnel()">Start tunnel</button>
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

      <details style="margin-top:12px">
        <summary class="muted" style="cursor:pointer;font-size:12px">Advanced: named tunnel (Cloudflare Access)</summary>
        <label class="flbl" style="margin-top:8px">Connector token</label>
        <input id="s_named_token" type="password" placeholder="from Cloudflare Zero Trust dashboard" style="width:100%" />
        <label class="flbl" style="margin-top:6px">Public hostname</label>
        <div class="row"><input id="s_named_host" placeholder="hive.example.com" style="flex:1" />
          <button class="copybtn" onclick="startNamedTunnel()">Run</button></div>
        <div class="muted" style="font-size:11px;margin-top:4px">Recommended for always-on remote use — put a Cloudflare Access policy in front.</div>
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
      <div class="muted" style="font-size:11px;margin-top:10px">Embedded lanes run inside the daemon and follow the connectivity mode. Launch-agent lanes (e.g. BrainBee) can be toggled on/off — that installs/removes their macOS LaunchAgent.</div>
    </div>
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
    <div class="form" id="dirEditForm" style="display:none">
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
  document.body.innerHTML = '<div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:-apple-system,sans-serif;color:#e6edf3;background:#0d1117">'
    + '<div style="font-size:22px;font-weight:700;color:#d9a441">HiveMatrix</div>'
    + '<div style="color:#8b949e">Remote access — paste your access token</div>'
    + '<input id="lt" type="password" placeholder="access token" style="width:320px;padding:8px;border-radius:6px;border:1px solid #2d333b;background:#161b22;color:#e6edf3" />'
    + '<button onclick="(function(){var v=document.getElementById(\'lt\').value.trim();if(v){localStorage.setItem(\'hm_token\',v);location.reload();}})()" style="background:#d9a441;color:#1a1a1a;border:0;border-radius:6px;padding:8px 18px;font-weight:700;cursor:pointer">Connect</button>'
    + '<div style="color:#8b949e;font-size:11px;max-width:340px;text-align:center">Find this token in the local HiveMatrix console under Settings → Remote access.</div></div>';
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

function taskActionsHtml(t) {
  const b = [];
  const running = ["backlog","assigned","in_progress"].includes(t.status);
  if (running) b.push('<button onclick="taskAction(\''+t._id+'\',\'cancel\')">■ Cancel</button>');
  if (["failed","review","cancelled"].includes(t.status)) b.push('<button onclick="taskAction(\''+t._id+'\',\'retry\')">↻ Retry</button>');
  if (!running) b.push('<button onclick="taskAction(\''+t._id+'\',\'archive\')">⌫ Archive</button>');
  b.push('<button class="danger" onclick="deleteTask(\''+t._id+'\')">🗑 Delete</button>');
  let html = '<div class="actions">'+b.join("")+'</div>';
  if (t.reviewState === "needs_input") {
    const q = t.pendingQuestion ? '<div class="reply-question">'+esc(t.pendingQuestion)+'</div>' : '';
    html += q
      + '<div class="reply-row"><textarea id="replyText" class="reply-input" placeholder="Type your reply…" rows="2"></textarea>'
      + '<button onclick="replyTask(\''+t._id+'\')">↩ Send Reply</button></div>';
  }
  return html;
}

async function selectTask(id) {
  state.selected = id;
  renderBoard();
  const t = await api("/tasks/"+id);
  if (!t || !t._id) { state.selected = null; return; }
  const out = t.output ? (typeof t.output==="string"?JSON.parse(t.output):t.output) : {};
  const logs = typeof t.logs === "string" ? (()=>{try{return JSON.parse(t.logs)}catch{return[]}})() : (t.logs||[]);
  const live = ["assigned","in_progress"].includes(t.status);
  const el = document.getElementById("session");
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
  // Keep the transcript scrolled to the latest line while running.
  const tr = el.querySelector(".transcript"); if (tr && live) tr.scrollTop = tr.scrollHeight;
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

async function replyTask(id) {
  const el = document.getElementById("replyText");
  const text = el ? el.value.trim() : "";
  if (!text) { el && el.focus(); return; }
  el.disabled = true;
  const r = await api("/tasks/"+id+"/reply", { method: "POST", body: JSON.stringify({ text }) });
  if (r && r.ok) { refresh(); selectTask(id); }
  else { alert(r?.error || "Failed to send reply"); el.disabled = false; }
}

function renderConn() {
  const c = state.conn; if (!c) return;
  document.getElementById("modePill").className = "pill "+c.mode;
  document.getElementById("modePill").textContent = c.mode;
  document.getElementById("conn").innerHTML = '<div class="kv">'
    + '<span class="k">mode</span><span>'+esc(c.mode)+'</span>'
    + '<span class="k">override</span><span>'+esc(c.manualOverride||"none")+'</span>'
    + '<span class="k">exhausted</span><span>'+esc((c.exhaustedProviders||[]).join(", ")||"none")+'</span>'
    + '<span class="k">probe fails</span><span>'+esc(c.probeFailures)+'</span>'
    + '<span class="k">reason</span><span>'+esc(c.reason)+'</span></div>';
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
    return '<div class="s" title="'+esc(s.remediation||s.detail)+'">'
      + '<span class="dot '+(s.state==="done"?"done":(s.required?"failed":"sleeping"))+'"></span>'
      + '<span style="color:var(--'+cls+')">'+mark+'</span> '+esc(s.title)
      + (s.required?'':' <span class="muted">(optional)</span>')+'</div>';
  }).join("");
  document.getElementById("onboarding").innerHTML = html
    + '<div class="muted" style="margin-top:6px">'
    + (o.requiredComplete ? 'Required setup complete.' : 'Required setup incomplete.') + '</div>';
}

async function refresh() {
  try {
    [state.tasks, state.directives, state.conn, state.metrics, state.onboarding] = await Promise.all([
      api("/tasks"), api("/directives"), api("/connectivity"), api("/metrics"), api("/onboarding"),
    ]);
    renderBoard(); renderConn(); renderDirectives(); renderMetrics(); renderOnboarding();
    if (state.selected) selectTask(state.selected);
  } catch (e) { /* transient */ }
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

async function loadProjects() {
  try {
    const data = await api("/projects");
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
  loadTunnel();
}
function closeSettings() { document.getElementById("settingsOverlay").classList.remove("open"); }

function switchSettingsTab(tab) {
  document.getElementById("tab-models").className = "tab" + (tab === "models" ? " active" : "");
  document.getElementById("tab-projects").className = "tab" + (tab === "projects" ? " active" : "");
  document.getElementById("tab-bees").className = "tab" + (tab === "bees" ? " active" : "");
  document.getElementById("settingsModels").style.display = tab === "models" ? "" : "none";
  document.getElementById("settingsProjects").style.display = tab === "projects" ? "" : "none";
  document.getElementById("settingsBees").style.display = tab === "bees" ? "" : "none";
  if (tab === "projects") renderSettingsProjects();
  if (tab === "bees") renderSettingsBees();
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
  if (r && r.error) { alert(r.error); }
  setTimeout(renderSettingsBees, 800); // give launchctl a moment
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
  await loadProjects();
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
    detail.textContent = "Reachable over the tunnel" + (tunnel.qrInstalled ? "" : " (install qrencode for the QR: brew install qrencode)");
    btn.textContent = "Stop tunnel";
    live.style.display = "block";
    document.getElementById("s_tunnel_url").value = tunnel.url;
    // QR from the daemon (token via query); cache-bust per URL.
    document.getElementById("s_qr").innerHTML = tunnel.qrInstalled
      ? '<img src="/tunnel/qr?token=' + encodeURIComponent(HM_TOKEN) + '&u=' + encodeURIComponent(tunnel.url) + '" style="width:100%;height:100%" alt="pairing QR" />'
      : '<div class="muted" style="font-size:11px;color:#333">QR unavailable — brew install qrencode</div>';
  } else {
    dot.className = "dot off"; label.textContent = "Remote access OFF";
    detail.textContent = "Start a tunnel to reach this daemon from your phone.";
    btn.textContent = "Start tunnel"; live.style.display = "none";
  }
}
async function toggleTunnel() {
  const btn = document.getElementById("s_tunnel_btn");
  btn.disabled = true; btn.textContent = tunnel && tunnel.running ? "Stopping…" : "Starting…";
  try {
    tunnel = await api(tunnel && tunnel.running ? "/tunnel/stop" : "/tunnel/start", { method: "POST" });
  } catch (e) { /* */ }
  btn.disabled = false;
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
  if (!confirm("Delete this directive and all its runs?")) return;
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
}
</script>
</body>
</html>`;
