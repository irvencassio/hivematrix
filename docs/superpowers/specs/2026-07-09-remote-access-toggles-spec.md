# Remote Access Toggles — HiveMatrix (desktop daemon + console)

Date: 2026-07-09
Status: Standalone implementation handoff spec
Repo: `/Users/irvcassio/hivematrix`
Companion specs: `hivematrix-ios` and `hivematrix-watch` (same date, same topic). **Land this one first** — it defines the daemon API the other two consume.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this spec task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Write the failing test first for every task that has one.

---

## Goal

Settings → Remote access becomes **two independent toggles**, styled exactly like the existing ChatGPT/Claude provider switches:

| Toggle | For | When ON reveals | QR? |
|---|---|---|---|
| **Tailscale** | iPhone | Serve status, reachable URL, **pairing QR** | Yes |
| **Cloudflare** | Apple Watch | Public hostname, Access service token, connector token | **No** |

Each toggle **drives its transport**, it does not merely disclose a panel:

- Tailscale ON runs `tailscale serve --bg 3747`; OFF runs `tailscale serve reset`.
- Cloudflare ON starts the named connector when a connector token is saved, and adopts an already-running external connector otherwise; OFF stops only a connector HiveMatrix itself started.

Cloudflare is **permanent (named) tunnels only**. The temporary quick tunnel (`*.trycloudflare.com`) is deleted from the codebase.

The pairing QR now encodes the **Tailscale** URL, not the Cloudflare URL. The Watch has no QR — it is provisioned by typing the Cloudflare hostname and Access credentials into the iPhone app and tapping *Sync Apple Watch* (unchanged behavior; see the iOS spec).

## Why

The transports already have distinct audiences (`docs/TAILSCALE.md`): the phone belongs on the private mesh and gets direct P2P voice; the Watch can only do plain HTTPS and therefore needs the public named tunnel. The current UI shows both cards at all times with no on/off state, and the QR — the thing you actually scan with the phone — is wired to the Cloudflare URL, which is the wrong transport for the phone. The quick tunnel has had **no UI button for some time** (`console.ts` never calls `POST /tunnel/start`), so it is dead weight carrying a real security caveat.

## Non-goals

- No change to the pairing wire format (`{type:"hivematrix-connection", version:1, url, token, cloudflareAccess?}`). Watch and iOS parsers stay compatible.
- No new persistent store. Everything lands in the existing `~/.hivematrix/remote-access.json` (mode `0600`).
- No change to voice ICE / STUN-only mesh detection (`hostOnMesh`, `filterStunOnly`).
- No Tailscale sign-in automation. `tailscale up` remains the operator's job.

---

## Ground truth — read before you touch anything

The console is **not** a React app. `ui/index.html` is a stub. The whole console is one server-rendered `String.raw` template in `src/daemon/console.ts` (8,773 lines): markup, CSS, and a browser `<script>` that `tsc` does **not** type-check. A TypeScript-ism inside that script is a runtime SyntaxError that kills the entire console. `src/daemon/console.test.ts` parses the script the way a browser would — keep it passing.

`src-tauri` (Rust) contains **zero** tunnel code. Do not look there.

`.claude/worktrees/zen-grothendieck-c4df93/` holds a stale parallel copy of these files. **Never edit it.** Only touch paths under `/Users/irvcassio/hivematrix/src/…` and `/Users/irvcassio/hivematrix/docs/…`.

Files in play:

| Path | Role |
|---|---|
| `src/lib/tunnel/remote-access-settings.ts` | `~/.hivematrix/remote-access.json` read/write |
| `src/lib/tunnel/tailscale.ts` | Tailscale detection (no start/stop today) |
| `src/lib/tunnel/cloudflared.ts` | cloudflared child-process control, QR, pairing payload |
| `src/daemon/server.ts` | HTTP routes (`/tunnel*`, around line 1113) |
| `src/daemon/console.ts` | Markup in `<div id="settingsRemote">`; client JS in `loadTunnel()`; the switch helper `settingsSwitch()` |

> **Line numbers in this spec are hints, not addresses.** It was written against `edaf99d` with uncommitted work-in-progress in the tree (a Brain / Claude-Code-config feature that touches `console.ts`, `server.ts`, and `src/lib/brain/*` but **no** tunnel code). `console.ts` in particular has already drifted ~11 lines in the markup region and ~116 in the script region. **Locate every edit by symbol name or DOM id, never by line number.** There is no semantic conflict with that work — but do not rebase your understanding on stale offsets.

### Verified machine facts (do not re-derive)

`tailscale serve --help` on this Mac (CLI at `/usr/local/bin/tailscale`) offers subcommands `status`, `reset`, `drain`, `clear`, `advertise`, `get-config`, `set-config`. **There is no `serve off`.** Enable with `serve --bg <port>`; disable with `serve reset`.

`tailscale serve status --json` while serving returns:

```json
{ "TCP": { "443": { "HTTPS": true } },
  "Web": { "irvs-macbook-pro.tail2b861e.ts.net:443":
    { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3747" } } } } }
```

When nothing is served it returns `{}`. Detection = any `Web[*].Handlers[*].Proxy` whose value ends in `:<port>`.

**Caveat to preserve in a code comment:** `serve reset` clears the node's *entire* serve config, not just HiveMatrix's handler. On a single-purpose Mac that is fine; the operator can override the command with `TS_SERVE_RESET_CMD`, mirroring the existing `TS_SERVE_CMD` override in `scripts/tailscale-setup.sh`.

---

## The daemon contract (what iOS consumes)

### `~/.hivematrix/remote-access.json` — three new keys

```jsonc
{
  "namedHostname": "https://hivey.cassio.io",
  "cloudflareAccessClientId": "….access",
  "cloudflareAccessClientSecret": "…64 hex…",
  "tailscaleEnabled": true,            // NEW
  "cloudflareEnabled": true,           // NEW
  "cloudflareConnectorToken": "…"      // NEW, secret, optional
}
```

> **Trap — read this twice.** `saveRemoteAccessSettings()` currently copies a field only when it is truthy (`if (namedHostname) settings.namedHostname = …`). Applied to a boolean, that silently drops `false`, so "turn Tailscale off" would never persist. Booleans **must** be gated on `typeof v === "boolean"`, not on truthiness.

### `GET /tunnel` — extended response

```jsonc
{
  "installed": true, "running": true, "url": "https://hivey.cassio.io",
  "binary": "/opt/homebrew/bin/cloudflared", "qrInstalled": true,
  "mode": "named",                     // "none" | "named"  — "quick" is GONE
  "owner": "hivematrix",               // "hivematrix" | "external" | "configured"
  "canStop": true,
  "cloudflareEnabled": true,           // NEW
  "connectorTokenSaved": true,         // NEW — presence only, never the token
  "cloudflareAccessConfigured": true,
  "cloudflareAccessClientId": "….access",
  "cloudflareAccessSecretSaved": true,
  "tailscale": {
    "installed": true, "running": true,
    "ipv4": "100.x.y.z",
    "magicDNSName": "irvs-macbook-pro.tail2b861e.ts.net",
    "pairingUrl": "https://irvs-macbook-pro.tail2b861e.ts.net",
    "serving": true,                   // NEW — `tailscale serve` proxies to our port
    "enabled": true                    // NEW — the toggle's persisted state
  }
}
```

`running` is now `cloudflareEnabled && (childRunning || !!configuredUrl)`. A configured-but-disabled Cloudflare leg reports `running: false`.

### Routes

| Method | Path | Change |
|---|---|---|
| `GET` | `/tunnel` | Extended as above |
| `POST` | `/remote/tailscale/enabled` | **NEW** — `{enabled: boolean}` |
| `POST` | `/remote/cloudflare/enabled` | **NEW** — `{enabled: boolean, connectorToken?: string}` |
| `POST` | `/tunnel/configure-named` | Unchanged |
| `POST` | `/tunnel/access-credentials` | Unchanged |
| `POST` | `/tunnel/stop` | Unchanged |
| `POST` | `/tunnel/start-named` | **Deprecated shim** — delegates to the cloudflare-enabled handler. Kept so an un-updated iOS build keeps working. |
| `POST` | `/tunnel/start` | **DELETED** (quick tunnel) |
| `GET` | `/tunnel/qr` | Now encodes the **Tailscale** URL; `400` when Tailscale isn't serving |

`/tunnel/qr` keeps its `checkGate("companion_pairing")` license gate and keeps accepting `?token=` (see `requestToken`, `server.ts:263` — `AsyncImage` on iOS cannot set headers).

---

## Work items

Execute in order. Each task: failing test first, then minimal code.

### 1. Persist the three new settings keys

**File:** `src/lib/tunnel/remote-access-settings.ts`

- [ ] Extend `RemoteAccessSettings` with `tailscaleEnabled?: boolean`, `cloudflareEnabled?: boolean`, `cloudflareConnectorToken?: string`.
- [ ] In `readRemoteAccessSettings()` read the booleans with `typeof parsed.x === "boolean"` and the token with the existing `clean()`.
- [ ] In `saveRemoteAccessSettings()` copy the booleans with a `typeof` guard so `false` persists:

```ts
if (typeof next.tailscaleEnabled === "boolean") settings.tailscaleEnabled = next.tailscaleEnabled;
if (typeof next.cloudflareEnabled === "boolean") settings.cloudflareEnabled = next.cloudflareEnabled;
```

- [ ] `cloudflareConnectorToken`: a non-empty string saves; an **empty string clears it** (do not merge-preserve). Add a targeted test for the clear path.

**Accept:** `src/lib/tunnel/remote-access-settings.test.ts` proves a round-trip of `{tailscaleEnabled:false, cloudflareEnabled:false}` reads back as `false` (not `undefined`), and that saving `cloudflareConnectorToken: ""` removes a previously stored token. File mode stays `0600`.

### 2. Tailscale serve control

**File:** `src/lib/tunnel/tailscale.ts`

- [ ] Add `serving: boolean` to `TailscaleStatus`.
- [ ] Add a **pure** parser (test it without a subprocess — this mirrors the existing `parseTailscaleStatusJSON` convention):

```ts
/** True when `tailscale serve status --json` shows a handler proxying to our port. */
export function parseServeStatusJSON(raw: string, port: number): boolean {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return false; }
  const web = ((j ?? {}) as Record<string, unknown>).Web;
  if (!web || typeof web !== "object") return false;
  for (const site of Object.values(web as Record<string, unknown>)) {
    const handlers = (site as Record<string, unknown>)?.Handlers;
    if (!handlers || typeof handlers !== "object") continue;
    for (const h of Object.values(handlers as Record<string, unknown>)) {
      const proxy = (h as Record<string, unknown>)?.Proxy;
      if (typeof proxy === "string" && proxy.endsWith(`:${port}`)) return true;
    }
  }
  return false;
}
```

- [ ] `export function tailscaleServeActive(port: number): boolean` — `execFileSync(bin, ["serve","status","--json"], {timeout: 4000})` → `parseServeStatusJSON`. Never throws; returns `false` on any error.
- [ ] `export function startTailscaleServe(port: number): { ok: boolean; error?: string }` — runs `serve --bg <port>` (honor `process.env.TS_SERVE_CMD` if set, splitting on whitespace, same escape hatch as the setup script). On failure return the stderr text — the console shows it verbatim, because the most common failure is *"tailnet HTTPS certs not enabled"* and the operator needs to read that.
- [ ] `export function stopTailscaleServe(): { ok: boolean; error?: string }` — runs `serve reset` (or `TS_SERVE_RESET_CMD`). Comment the "clears the node's entire serve config" caveat.
- [ ] `tailscaleStatus(port)` sets `serving: tailscaleServeActive(port)` only when `installed && running`, else `false`.

**Accept:** `tailscale.test.ts` covers `parseServeStatusJSON` for the real serving JSON above, `{}`, malformed JSON, and a handler proxying to a *different* port (must be `false`). No test shells out to the real binary.

### 3. Delete the quick tunnel

**Files:** `src/lib/tunnel/cloudflared.ts`, `src/daemon/server.ts`, `src/lib/tunnel/cloudflared.test.ts`

- [ ] Delete `startQuickTunnel()` (lines ~135–167) and the `TRYCF_RE` constant (~128).
- [ ] Narrow `export type TunnelMode = "none" | "named"`.
- [ ] Delete the `POST /tunnel/start` route (`server.ts` ~1120–1130).
- [ ] Delete quick-tunnel tests; update the module doc-comment at the top of `cloudflared.ts` (it currently documents the quick tunnel in its first paragraph).
- [ ] Update `docs/REMOTE-ACCESS.md` — the "Quick tunnel" bullet and the `POST /tunnel/start` endpoint reference must go.

**Accept:** `grep -ri "trycloudflare\|quick tunnel\|startQuickTunnel" src/ docs/` returns nothing. Typecheck clean (the `mode` narrowing will surface every consumer).

### 4. Enabled-state in `tunnelStatus()`

**File:** `src/lib/tunnel/cloudflared.ts`

- [ ] Add `cloudflareEnabled: boolean` and `connectorTokenSaved: boolean` to `TunnelStatus`.
- [ ] `running` becomes `cloudflareEnabled && (childRunning || !!configuredUrl)`.
- [ ] `mode` / `owner` / `url` stay as they are — a disabled-but-configured tunnel still reports its hostname so re-enabling is one click and the field stays populated.
- [ ] `connectorTokenSaved: !!settings.cloudflareConnectorToken`. **Never** return the token itself, exactly as the Access secret is never returned.

### 5. The two toggle routes

**File:** `src/daemon/server.ts` (place beside the existing `/tunnel/*` block, ~1112)

- [ ] `POST /remote/tailscale/enabled` — body `{enabled}`.
  - Enable: `startTailscaleServe(port)`. On failure return `500 {error}` **and do not persist `tailscaleEnabled: true`** — a toggle that reports ON while serve failed is a lie.
  - Disable: `stopTailscaleServe()`, persist `false`.
  - Respond with the same shape as `GET /tunnel`.
- [ ] `POST /remote/cloudflare/enabled` — body `{enabled, connectorToken?}`.
  - When `connectorToken` is a non-empty string, persist it first (empty string clears).
  - Enable: require a saved `namedHostname` → else `400 {error: "Set a public hostname first"}`. If a connector token is stored, `await startNamedTunnel(token, hostname)`; otherwise `configureNamedTunnel(hostname)` to adopt an externally-run connector. Persist `cloudflareEnabled: true`.
  - Disable: `if (tunnelStatus().canStop) stopTunnel()` — never kill a connector HiveMatrix didn't start. Persist `cloudflareEnabled: false`. Leave hostname, Access creds, and connector token on disk.
  - Respond with the same shape as `GET /tunnel`.
- [ ] Rewrite `POST /tunnel/start-named` as a shim that persists `{connectorToken, namedHostname: hostname}` then runs the enable path above. Add a comment: *deprecated, retained for iOS builds predating 2026-07-09.*

**Accept:** unit tests for the handlers with `startTailscaleServe` / `startNamedTunnel` stubbed. Specifically prove: enabling Tailscale when serve fails returns 500 **and** leaves `tailscaleEnabled` unset; disabling Cloudflare when `canStop === false` does not call `stopTunnel`.

### 6. QR encodes Tailscale

**File:** `src/daemon/server.ts` (`GET /tunnel/qr`, ~1177–1197)

- [ ] Keep the `checkGate("companion_pairing")` gate first.
- [ ] Replace the tunnel-URL source with the Tailscale pairing URL:

```ts
const ts = tailscaleStatus(port);
if (!settings.tailscaleEnabled || !ts.serving || !ts.pairingUrl) {
  json(res, 400, { error: "Turn on Tailscale to show the pairing QR." }); return;
}
if (!qrencodeInstalled()) { json(res, 503, { error: "qrencode not installed (brew install qrencode)" }); return; }
const svg = await generateQrSvg(pairingPayload(ts.pairingUrl, AUTH_TOKEN));
```

- [ ] **Pass no `cloudflareAccess` options.** The mesh needs none, and shipping the Access secret in a QR the phone doesn't need is a gratuitous secret exposure. `pairingPayload()` already omits the key when the options are absent — do not change that function.

**Accept:** a test asserts the payload built for a Tailscale URL has no `cloudflareAccess` key and `type === "hivematrix-connection"`, `version === 1`.

### 7. Console markup

**File:** `src/daemon/console.ts` — replace the entire `<div id="settingsRemote" style="display:none"> … </div>` block (it ends immediately before `<div id="settingsGeneral"`)

Structure — two `remote-card`s, each with a switch in its header and a body that is hidden until enabled. Reuse the existing `.remote-card` / `.remote-card-h` / `.badge` classes; add no new CSS.

```html
<div id="settingsRemote" style="display:none">
  <div class="remote-status"><span class="dot" id="s_remote_dot"></span><span id="s_remote_label">…</span></div>
  <div id="s_tunnel_detail" class="muted" style="font-size:11px;margin-top:4px"></div>

  <div class="remote-card">
    <div class="remote-card-h">
      <span>Tailscale <span class="badge">iPhone · private mesh</span></span>
      <span id="s_ts_switch"></span>
    </div>
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
    <div class="remote-card-h">
      <span>Cloudflare <span class="badge">Apple Watch · permanent tunnel</span></span>
      <span id="s_cf_switch"></span>
    </div>
    <div id="s_cf_body" style="display:none">
      <div class="muted" style="font-size:11px;margin:4px 0 8px">The Apple Watch can't join a mesh, so it reaches the daemon over a permanent named tunnel. There is no QR for the Watch — enter these values in HiveMatrix on iPhone, then tap Sync Apple Watch.</div>
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
    </div>
  </div>

  <label class="flbl" style="margin-top:14px">Access token (manual pairing)</label>
  <div class="row"><input id="s_token" readonly style="flex:1;font-family:ui-monospace,Menlo,monospace;font-size:11px" />
    <button class="copybtn" onclick="copyField('s_token')">Copy</button></div>

  <div class="muted" style="font-size:11px;margin-top:10px">⚠ A Cloudflare tunnel exposes the daemon to the internet; the access token is the only barrier — treat it like a password. The console never hands the token to tunneled visitors. Tailscale exposes nothing publicly.</div>
</div>
```

- [ ] `#s_tunnel_live` is gone; its two children (`#s_tunnel_url`, `#s_qr`) now live inside their respective cards. Delete every remaining reference to `s_tunnel_live`.

### 8. Console client JS

**File:** `src/daemon/console.ts` (browser `<script>` — plain ES5-ish JS, **no TypeScript syntax**)

- [ ] Rewrite `loadTunnel()` (find it by name; it begins `async function loadTunnel() {` and currently ends just before `async function loadTunnelQr()`):

```js
async function loadTunnel() {
  tunnel = await api("/tunnel");
  if (!tunnel) return;
  const ts = tunnel.tailscale || {};
  const tsOn = ts.enabled === true, cfOn = tunnel.cloudflareEnabled === true;

  // Header switches — same helper the ChatGPT/Claude provider rows use.
  document.getElementById("s_ts_switch").innerHTML =
    settingsSwitch(tsOn, "toggleTailscale(" + (!tsOn) + ")",
      { disabled: !ts.installed, title: !ts.installed ? "Tailscale not installed" : (tsOn ? "Turn off Tailscale" : "Turn on Tailscale") });
  document.getElementById("s_cf_switch").innerHTML =
    settingsSwitch(cfOn, "toggleCloudflare(" + (!cfOn) + ")",
      { disabled: !tunnel.installed, title: !tunnel.installed ? "cloudflared not installed (brew install cloudflared)" : (cfOn ? "Turn off Cloudflare" : "Turn on Cloudflare") });

  document.getElementById("s_ts_body").style.display = tsOn ? "block" : "none";
  document.getElementById("s_cf_body").style.display = cfOn ? "block" : "none";

  // Tailscale body
  const tsStatus = document.getElementById("s_ts_status"), tsUrl = document.getElementById("s_ts_url");
  tsStatus.textContent = !ts.installed ? "Tailscale not installed on this Mac — install from tailscale.com."
    : !ts.running ? "Tailscale installed but not connected — open the Tailscale app and sign in."
    : !ts.serving ? "Connected, but not serving the daemon yet."
    : ts.magicDNSName ? ("Serving as " + ts.magicDNSName) : "Serving (enable MagicDNS for a hostname).";
  if (tsUrl && document.activeElement !== tsUrl) tsUrl.value = ts.pairingUrl || "";
  if (tsOn && ts.serving) loadTunnelQr();

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
  document.getElementById("s_tunnel_url").value = tunnel.url || "";
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
```

- [ ] `toggleTailscale(enabled)` → `POST /remote/tailscale/enabled`. On a non-2xx, surface `resp.error` in `#s_ts_status` colored `var(--err)` and **re-render from the server** (`loadTunnel()`), so a failed enable snaps the switch back to Off instead of lying. The "certs not enabled" message must reach the user verbatim.
- [ ] `toggleCloudflare(enabled)` → `POST /remote/cloudflare/enabled`, sending `connectorToken` from `#s_named_token` when non-empty, then blanking that field (same pattern `saveCloudflareAccessCredentials()` already uses to blank the Access secret after a save). Same error handling into `#s_cf_access_detail`.
- [ ] Delete `startNamedTunnel()` from the console script (the toggle replaces the "Run with token" button).
- [ ] `configureNamedTunnel()` keeps calling `POST /tunnel/configure-named`, then `loadTunnel()`.
- [ ] `loadTunnelQr()` is unchanged except its error text — it already surfaces the JSON `error` from `/tunnel/qr`, which now says "Turn on Tailscale to show the pairing QR."
- [ ] In `switchSettingsTab(tab)` (find by name), add `if (tab === "remote") loadTunnel();` alongside the existing `if (tab === "features") renderFeatures();`. Today the remote tab has no per-tab render hook and relies on a single `loadTunnel()` at console init — with toggles that can go stale, that's now a bug.

**Accept:** `src/daemon/console.test.ts` passes (it `new Function`-parses the script — any stray TS syntax fails it). Add assertions that the HTML contains `s_ts_switch`, `s_cf_switch`, `s_ts_body`, `s_cf_body`, and no longer contains `s_tunnel_live`. The existing assertion for the literal `tailscale serve --bg 3747` (console.test.ts:514) will fail — that instruction is gone from the copy because the toggle runs it now; update the assertion rather than re-adding the string.

### 9. Docs + decision log

- [ ] `docs/REMOTE-ACCESS.md` — rewrite around the two toggles. Remove the quick tunnel section and `POST /tunnel/start`. Keep the security model (bearer token, `CF-Connecting-IP` token suppression) and the token-rotation steps verbatim; they are unchanged and still correct.
- [ ] `docs/TAILSCALE.md` — the table stays true. Replace "the user runs `tailscale serve --bg 3747`" with "the Tailscale toggle runs `tailscale serve --bg 3747`"; keep the tailnet-HTTPS-certs prerequisite prominent, because that is what makes the toggle fail.
- [ ] `DECISIONS.md` — append a `## Q16 — Quick tunnel removed; remote access is two transport toggles (2026-07-09)` entry. AGENTS.md requires that a new concept name what it deletes: the new persisted keys land in an existing store, and the quick-tunnel code path is deleted outright.
- [ ] `scripts/tailscale-setup.sh` still works standalone; leave it. Add one line to its header noting the console toggle now does the same thing.

---

## Definition of done

1. `npm run typecheck` — zero errors.
2. `npm test` — all passing, including the new `parseServeStatusJSON` and settings-persistence tests.
3. `node scripts/scope-wall.mjs` — zero violations.
4. `grep -ri "trycloudflare\|startQuickTunnel" src/ docs/` — no hits.
5. Manual, on this Mac (the only honest test of subprocess control):
   - Tailscale toggle OFF → `tailscale serve status --json` returns `{}`; the QR box disappears.
   - Tailscale toggle ON → serve status shows the `:3747` proxy; the QR renders; scanning it with the iPhone app pairs against `https://<magicdns>` with **no** `cloudflareAccess` in the payload.
   - Cloudflare toggle OFF with an externally-run connector → the connector keeps running (`canStop === false` means we must not kill it), status reads OFF.
   - Cloudflare toggle ON with a saved hostname and no connector token → adopts, `owner: "configured"`.
   - Reload the console: both switches reflect the persisted state.
6. `~/.hivematrix/remote-access.json` is still mode `0600` and contains `tailscaleEnabled` / `cloudflareEnabled` as real booleans.

## Out of scope

- Automating `tailscale up` / tailnet HTTPS-cert enablement.
- Per-client token revocation or rate limiting on the tunnel (still a known residual risk, documented in `docs/REMOTE-ACCESS.md`).
- Any change to `hivematrix-android` or `hivematrix-glasses`.
