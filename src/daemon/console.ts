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
    padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: border-color .1s; }
  .card:hover { border-color: var(--accent-2); }
  .card.sel { border-color: var(--accent); }
  .card .t { font-weight: 600; margin-bottom: 2px; }
  .card .m { font-size: 11px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; }
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
  .directive .s { font-size: 11px; color: var(--muted); }
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
</style>
</head>
<body>
<header>
  <span class="logo">HiveMatrix</span>
  <span class="live" id="live">● live</span>
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
    <div class="tabs"><div class="tab active" id="tab-models">Models</div></div>
    <div id="settingsModels">
      <label class="flbl">Default model</label>
      <select id="s_default" style="width:100%"></select>
      <div class="row" style="margin:8px 0"><button class="create" onclick="saveDefault()">Save default</button></div>

      <label class="flbl" style="margin-top:14px">Backends</label>
      <div id="s_backends"></div>

      <label class="flbl" style="margin-top:14px">Local server endpoint</label>
      <div class="row"><input id="s_endpoint" placeholder="http://localhost:1234/v1" style="flex:1" />
        <button class="create" onclick="saveEndpoint()">Save</button></div>

      <div class="vinfo" id="s_version">…</div>
    </div>
  </div>
</div>

<main>
  <section class="col board">
    <h2>Board <span id="archiveBtn" class="archive-link" onclick="archiveCompleted()" title="Archive review/done/failed tasks"></span></h2>
    <button class="addbtn" onclick="toggleForm('taskForm')">＋ New task</button>
    <div class="form" id="taskForm">
      <input id="t_title" placeholder="Title" />
      <textarea id="t_desc" placeholder="What should the agent do? (be specific)"></textarea>
      <input id="t_path" placeholder="Project path (working dir)" value="/tmp" />
      <label class="flbl">Model</label>
      <select id="t_model"></select>
      <label class="flbl">Attachments (file paths, comma-separated — optional)</label>
      <input id="t_attach" placeholder="/path/to/file.png, /path/to/notes.md" />
      <div class="row"><button class="create" onclick="createTask()">Create task</button></div>
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
      <div class="row"><button class="create" onclick="createDirective()">Create directive</button></div>
      <div class="err" id="d_err"></div>
    </div>
    <div id="directives"></div>
  </section>
</main>
<script>
const LANES = ["backlog","assigned","in_progress","review","done","failed"];
// Shared-secret token injected by the daemon into this same-origin page.
const HM_TOKEN = "%%HM_TOKEN%%";
let state = { tasks: [], directives: [], conn: null, metrics: null, onboarding: null, selected: null };

async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, { "Authorization": "Bearer " + HM_TOKEN });
  const r = await fetch(path, opts);
  if (r.status === 204) return null;
  return r.json();
}
function esc(s){ return (s==null?"":String(s)).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }

function renderBoard() {
  const byLane = {}; LANES.forEach(l => byLane[l] = []);
  for (const t of state.tasks) (byLane[t.status] = byLane[t.status] || []).push(t);
  const el = document.getElementById("board");
  el.innerHTML = LANES.map(lane => {
    const items = byLane[lane] || [];
    if (!items.length && (lane==="done"||lane==="failed")) return "";
    return '<div class="lane"><div class="lane-title">'+lane+' <span class="count">'+items.length+'</span></div>'
      + items.map(t => '<div class="card'+(state.selected===t._id?' sel':'')+'" onclick="selectTask(\''+t._id+'\')">'
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
  return '<div class="actions">'+b.join("")+'</div>';
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
    + '<div class="s">'+esc(d.status)+(d.nextRunAt?' · next '+esc(new Date(d.nextRunAt).toLocaleTimeString()):'')+'</div></div>').join("");
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

// --- Models / Settings ---
let models = null;            // { backends, available, defaultModel, version }
const modelById = {};         // UiModel.id → {modelId, fast}

async function loadModels() {
  models = await api("/models");
  if (!models) return;
  for (const m of models.available) modelById[m.id] = { modelId: m.modelId, fast: !!m.fast };
  // Populate the New Task dropdown
  const sel = document.getElementById("t_model");
  sel.innerHTML = models.available.map(m => '<option value="'+esc(m.id)+'">'+esc(m.name)+(m.note?' — '+esc(m.note):'')+'</option>').join("")
    || '<option value="">(no models configured)</option>';
  // Default selection
  const def = models.available.find(m => m.modelId === models.defaultModel || m.id === models.defaultModel);
  if (def) sel.value = def.id;
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
}
function closeSettings() { document.getElementById("settingsOverlay").classList.remove("open"); }

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
  const sel = modelById[document.getElementById("t_model").value] || { modelId: null, fast: false };
  const attach = document.getElementById("t_attach").value.trim();
  if (!title || !description || !projectPath) { err.textContent = "Title, description, and project path are required."; return; }
  if (attach) description += "\n\nAttached files:\n" + attach.split(",").map(s => "- " + s.trim()).filter(Boolean).join("\n");
  try {
    const t = await api("/tasks", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ title, description, projectPath, project: "console", model: sel.modelId || null, fastMode: sel.fast, status: "backlog", executor: "agent" }) });
    if (!t || !t._id) { err.textContent = "Create failed."; return; }
    document.getElementById("t_title").value = ""; document.getElementById("t_desc").value = ""; document.getElementById("t_attach").value = "";
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
    es.addEventListener("connectivity:change", refresh);
    es.onerror = () => { live.className = "live stale"; live.textContent = "● reconnecting"; };
  } catch (e) { /* polling covers it */ }
}

loadModels();
refresh();
connectSSE();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
