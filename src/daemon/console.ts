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
  </span>
</header>
<main>
  <section class="col board">
    <h2>Board</h2>
    <div id="board"></div>
  </section>
  <section class="col session">
    <div id="session"><div class="session-empty">Select a task to inspect its session.</div></div>
  </section>
  <section class="col context">
    <h2>Soak / Health</h2>
    <div id="metrics"></div>
    <h2 style="margin-top:20px">Connectivity</h2>
    <div id="conn"></div>
    <h2 style="margin-top:20px">Directives</h2>
    <div id="directives"></div>
  </section>
</main>
<script>
const LANES = ["backlog","assigned","in_progress","review","done","failed"];
let state = { tasks: [], directives: [], conn: null, metrics: null, selected: null };

async function api(path, opts) {
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
}

async function selectTask(id) {
  state.selected = id;
  renderBoard();
  const t = await api("/tasks/"+id);
  const out = t.output ? (typeof t.output==="string"?JSON.parse(t.output):t.output) : {};
  const el = document.getElementById("session");
  el.innerHTML = '<div class="session"><h1>'+esc(t.title||t._id)+'</h1>'
    + '<div class="sub">'+esc(t.project||"")+' · '+esc(t.status)+(t.reviewState?' · '+esc(t.reviewState):'')+'</div>'
    + '<div class="kv">'
    + '<span class="k">model</span><span>'+esc(t.model||"—")+'</span>'
    + '<span class="k">project path</span><span>'+esc(t.projectPath||"—")+'</span>'
    + '<span class="k">directive</span><span>'+esc(t.directiveId||"—")+'</span>'
    + '<span class="k">completedBy</span><span>'+esc(t.completedBy||"—")+'</span>'
    + '<span class="k">prover</span><span>'+esc(t.proverType||"—")+'</span>'
    + '</div>'
    + '<h2>Description</h2><div class="desc">'+esc(t.description||"")+'</div>'
    + (out.summary?'<h2>Result</h2><div class="desc">'+esc(out.summary)+'</div>':'')
    + '</div>';
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

async function refresh() {
  try {
    [state.tasks, state.directives, state.conn, state.metrics] = await Promise.all([
      api("/tasks"), api("/directives"), api("/connectivity"), api("/metrics"),
    ]);
    renderBoard(); renderConn(); renderDirectives(); renderMetrics();
    if (state.selected) selectTask(state.selected);
  } catch (e) { /* transient */ }
}

document.getElementById("modeSel").addEventListener("change", async (e) => {
  await api("/connectivity/mode", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ mode: e.target.value || null }) });
  refresh();
});

// SSE for live updates; fall back to polling.
function connectSSE() {
  try {
    const es = new EventSource("/events");
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

refresh();
connectSSE();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
