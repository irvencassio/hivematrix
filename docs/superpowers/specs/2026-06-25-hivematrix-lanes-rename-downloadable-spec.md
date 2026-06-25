# HiveMatrix Lanes Rename And Browser Lane Handoff Spec

Date: 2026-06-25
Status: Standalone implementation handoff spec

## Purpose

This spec defines the go-forward HiveMatrix architecture language and the implementation target for removing the Bee-era naming.

HiveMatrix should expose clean, voice-friendly, model-safe **Lanes** instead of Bees. Browser automation, public web retrieval, authenticated sessions, and browser workflow execution should consolidate into **Browser Lane**.

The implementing agent should use this spec together with:

- `docs/superpowers/specs/2026-06-25-browser-lane-and-routing-design.md`
- `docs/superpowers/plans/2026-06-25-browser-lane-and-routing.md`

## Executive Decision

Rename and remove the Bee concepts.

HiveMatrix should no longer expose these as product, UI, docs, prompt, or model-visible concepts:

- BrowserBee
- WebBee
- Weaver
- AuthBee
- DesktopBee
- TermBee
- MailBee
- MessageBee

The final product vocabulary should be:

- Browser Lane
- Desktop Lane
- Terminal Lane
- Mail Lane
- Message Lane
- Memory Lane
- Review Lane

The old names may appear only in:

- historical specs
- migration notes
- short-lived compatibility aliases hidden from normal model-visible tools

## Naming Model

### Product

```text
HiveMatrix
```

### Operator CLI

```bash
hive
```

### User-Facing Lanes

| Old Name | New Name | Notes |
|---|---|---|
| BrowserBee | Browser Lane | Authenticated/rendered browser workflows |
| WebBee | Browser Lane | Public fetch/read/search becomes a Browser Lane mode |
| Weaver | Browser Lane runtime | Delete product name; fold useful code into browser runtime |
| DesktopBee | Desktop Lane | Native Mac/app control |
| TermBee | Terminal Lane | Shell/CLI, preferably Canopy-backed |
| AuthBee | Session Plane / Account Readiness | Not a lane; part of Browser Lane and other account-aware lanes |
| MailBee | Mail Lane | Email send/draft |
| MessageBee | Message Lane | SMS/iMessage |

### Model-Visible Tools

Normal model-visible tools should use HiveMatrix-owned names:

```text
hivematrix_browser
hivematrix_desktop
hivematrix_terminal
hivematrix_mail
hivematrix_message
hivematrix_memory
```

Do not expose these as normal model-visible tools:

```text
browserbee_run
webbee_search
weaver_*
claude_chrome_mcp
codex_chrome_mcp
chrome_devtools_mcp
playwright_mcp
agent_browser
```

Backend names are internal adapter names only.

## Browser Lane Scope

Browser Lane is the single browser/web capability surface.

It owns:

- public web fetch/search/read
- rendered browser control
- authenticated browser sessions
- login readiness
- Keychain-backed credential injection
- file upload/download
- browser workflow scripts
- screenshots and traces
- OCR/vision fallback
- escalation to backend browser tools

Browser Lane should decide internally whether a request uses:

- fast fetch/read/search
- controlled Chromium/Chrome session
- agent-browser
- Playwright/CDP
- Chrome DevTools MCP
- Codex Computer Use
- paid cloud backend later, if explicitly configured

The COO should route to Browser Lane, not to backend tools.

## CLI Contract

The target CLI should be:

```bash
hive browser status
hive browser readiness run
hive browser readiness run --all
hive browser readiness status
hive browser sites list
hive browser sites add
hive browser sites edit heygen
hive browser reauth heygen
hive browser open heygen
hive browser snapshot --json
hive browser fetch https://example.com --json
hive browser read https://example.com --json
hive browser search "topic" --json
hive browser workflow run heygen.create_video --json
hive browser trace latest
hive browser trace open run_123
hive browser diagnose heygen
hive browser export-debug run_123 --redacted
```

Every command must support deterministic JSON output where useful:

```bash
hive browser status --json
```

Example JSON:

```json
{
  "ok": true,
  "lane": "browser",
  "sites": {
    "total": 4,
    "ready": 3,
    "needsHuman": 1,
    "blocked": 0
  }
}
```

## Mac App Requirement

Build the Browser Lane Mac app early.

The first app should be a **Browser Lane Console**, not a full browser engine fork.

App identity:

```text
App name: Hive Browser
Bundle ID: com.irvcassio.hivematrix.browserlane
Team: Irv Cassio
Apple ID: cassio.irv@gmail.com
```

The app should include:

- Sites dashboard
- Add Site wizard
- Credential setup
- Keychain save/verify
- Readiness dashboard
- Reauth handoff window
- Probe recorder
- Trace viewer
- Permissions checklist

Readiness colors:

| Color | State | Meaning |
|---|---|---|
| Green | ready | Session valid and probe passed |
| Yellow | maintenance | Session valid, but probe/workflow needs maintenance |
| Orange | human required | Reauth, 2FA, CAPTCHA, account chooser, consent |
| Red | blocked | Revoked, suspicious login, site unavailable, failed hard |

## Keychain Policy

Use only macOS Keychain for Browser Lane secrets.

Do not use:

- 1Password
- custom encrypted SQLite vault
- `.env` credentials
- config-file credentials
- model-visible secrets

HiveMatrix DB stores metadata and refs only:

```json
{
  "siteId": "heygen",
  "displayName": "HeyGen",
  "homeUrl": "https://app.heygen.com/home",
  "loginUrl": "https://app.heygen.com/login",
  "allowedDomains": ["app.heygen.com", "www.heygen.com"],
  "credentialRef": "hivematrix.browser.heygen.primary"
}
```

Keychain stores:

```text
service: HiveMatrix Browser Lane
account: heygen:username
secret: user@example.com

service: HiveMatrix Browser Lane
account: heygen:password
secret: ********
```

The model must never receive:

- password values
- cookies
- TOTP secrets
- bearer tokens
- raw Keychain values

Credential fill is a Browser Lane controller action:

```json
{
  "capability": "browser.credential.fill",
  "siteId": "heygen",
  "credentialRef": "hivematrix.browser.heygen.primary",
  "targetFormRef": "login_form"
}
```

## Authentication Readiness

Browser Lane should run daily readiness checks.

It should not blindly log into every site every morning. It should:

1. Open or attach each dedicated site profile.
2. Check whether the session is already valid.
3. Run a read-only probe.
4. Prompt the human only when reauth is needed.
5. Save the readiness state.
6. Make the state visible to the COO.

Do not test all links. Use site-specific probes:

- expected URL loaded
- expected text visible
- expected selector visible
- account indicator matches expected account
- workflow entry point exists
- optional screenshot/visual assertion passes

## CAPTCHA And 2FA Policy

Default behavior:

- detect
- pause
- bring Browser Lane app forward
- ask human to complete
- resume workflow after success

Do not promise automatic CAPTCHA solving.

Example:

```json
{
  "ok": false,
  "status": "human_required",
  "blocker": "captcha",
  "siteId": "heygen",
  "resumeCommand": "hive browser resume run_123"
}
```

## Visual Capability

Browser Lane should mimic the useful parts of Computer Use graphics.

Layered perception:

1. DOM
2. Accessibility tree
3. HTML/form heuristics
4. OCR
5. Screenshot/image matching
6. Local vision model if available
7. Frontier vision escalation if needed
8. Human fallback

Visual clicks must be verified after action. Do not allow unverified visual guessing for external side effects.

## Logging And Troubleshooting

Each readiness run and browser workflow must produce a trace bundle:

```text
run-id/
  events.jsonl
  page-snapshots/
  screenshots/
  redacted-dom/
  console.log
  network-summary.json
  assertions.json
  final-state.json
```

Rules:

- Never log secrets.
- Redact password fields.
- Do not export cookies by default.
- Store credential actions as refs, not values.
- Preserve enough state to debug selector, session, and visual failures.

## COO Routing Rules

The COO should use typed SQL routing rules instead of prompt-heavy skills.

Add tables:

```text
lane_providers
lane_capabilities
coo_routing_rules
coo_routing_rule_history
browser_sites
browser_credentials
browser_readiness_probes
browser_readiness_runs
browser_trace_runs
browser_trace_events
```

Important: do not create arbitrary prompt blobs in SQL.

Routing rules must be:

- typed
- prioritized
- enabled/disabled
- validated
- dry-runnable
- audited
- rollback-capable

Example route object given to the COO:

```json
{
  "lane": "browser",
  "capability": "workflow.run",
  "workflowId": "heygen.create_video",
  "backendPolicy": "lane_owned_first",
  "modelPosture": "local_first_frontier_on_failure",
  "approvalPolicy": {
    "beforePublish": true
  }
}
```

The COO should not decide between WebBee, BrowserBee, Weaver, Chrome MCP, or Codex Computer Use. The COO should choose Browser Lane; Browser Lane chooses the backend.

## Model Tool Override

When the user says "browser", HiveMatrix must route to Browser Lane.

Do not let Claude/Codex interpret "browser" as their own native Chrome MCP.

Normal worker toolset:

```text
hivematrix_browser
```

Escalation-only backend tools:

```text
browser_backend_chrome_devtools_escalation
browser_backend_codex_computer_use_escalation
browser_backend_playwright_mcp_escalation
```

Escalation requires an explicit router decision and trace reason.

## Implementation Migration

Do not do a risky all-at-once rename without tests, but deletion is the explicit target.

Phase 1:

- Add Lane contracts.
- Add Browser Lane contracts.
- Add `hivematrix_browser`.
- Add compatibility wrappers.

Phase 2:

- Move BrowserBee code into `src/lib/browser-lane/`.
- Move WebBee code into `src/lib/browser-lane/fetch.ts` or `src/lib/browser-lane/web-read.ts`.
- Fold any useful Weaver code into Browser Lane runtime.

Phase 3:

- Delete active old paths:

```text
src/lib/browserbee/
src/lib/webbee/
```

- Remove active old tool names:

```text
browserbee_run
webbee_search
weaver_*
```

Phase 4:

- Update docs/UI/prompts.
- Keep old names only in historical specs and explicit migration notes.

Verification command:

```bash
rg -n "browserbee_run|webbee_search|BrowserBee|WebBee|Weaver|src/lib/browserbee|src/lib/webbee" src docs
```

Remaining hits must be historical specs or migration notes only.

## Apple Developer Setup

Use Computer Use only for portal setup if needed.

Rules:

- Stop at password prompt.
- Stop at 2FA prompt.
- Verify Team Irv Cassio before creating anything.
- Never echo credentials or codes.
- Record only non-secret identifiers and profile paths.

Target:

```text
Bundle ID: com.irvcassio.hivematrix.browserlane
App name: Hive Browser
Team: Irv Cassio
Apple ID: cassio.irv@gmail.com
```

## Non-Negotiables

- No secrets in SQLite.
- No secrets in logs.
- No raw backend browser tools as normal model tools.
- No WebBee/BrowserBee/Weaver as active names.
- No arbitrary prompt blobs as routing rules.
- No automatic CAPTCHA-solving promise.
- No app polish before readiness, Keychain refs, and traces work.

## Acceptance Criteria

Implementation is acceptable when:

- `hive browser status --json` exists.
- Browser Lane has DB schema for sites, credentials refs, probes, runs, and traces.
- Browser Lane Console app scaffold exists with bundle ID `com.irvcassio.hivematrix.browserlane`.
- Keychain adapter stores and retrieves test credentials without logging values.
- `hivematrix_browser` is the only normal model-visible browser tool.
- `browserbee_run`, `webbee_search`, and `weaver_*` are not normal model-visible tools.
- Active code no longer imports from `src/lib/browserbee` or `src/lib/webbee`.
- COO routing rules can route "use browser for HeyGen" to Browser Lane.
- Tests, typecheck, scope wall, and relevant readiness checks pass.
