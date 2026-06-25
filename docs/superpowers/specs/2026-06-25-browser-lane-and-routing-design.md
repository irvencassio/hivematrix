# Browser Lane And COO Routing Design

Date: 2026-06-25
Status: Approved direction candidate / ready for implementation planning

## Context

HiveMatrix started with Bees: BrowserBee, WebBee, DesktopBee, TermBee, AuthBee, MailBee, MessageBee, and related concepts like Weaver. The naming is now hurting the product:

- Voice prompts mishear `BrowserBee` as `browser b`.
- Multiple browser-ish names make the COO choose between implementation details.
- Claude/Codex workers may interpret "browser" as their own Chrome MCP instead of the HiveMatrix-owned browser controller.
- Skills add guidance overhead, but the system needs deterministic routing and structured capability contracts.

The new direction:

- Product remains **HiveMatrix**.
- Operator CLI is **`hive`**.
- Execution categories are **Lanes**.
- Browser work becomes **Browser Lane**.
- Model-visible browser tool is **`hivematrix_browser`**.
- WebBee, BrowserBee, and Weaver are removed as product concepts, model-visible concepts, docs concepts, and UI concepts.
- Desktop and terminal remain separate lanes because browser, native app, and shell automation have different risk and permission models.

## Brutally Honest Take

Browser Lane is worth building, but only if HiveMatrix owns the auth/session/routing boundary. If we simply wrap agent-browser or Chrome MCP and call it a product, Claude/Codex/local models will still improvise around the boundary, credentials will stay awkward, traces will be incomplete, and failures will be hard to debug.

The Mac app must be built early. Authentication readiness is visual and operational: 2FA, CAPTCHA, suspicious-login warnings, account switchers, invalid sessions, file upload sheets, and "wrong account" problems are not clean CLI-only problems.

The SQL routing table is also worth building, but it must not become arbitrary prompt text in a database. It needs typed match conditions, typed actions, priorities, validation, test fixtures, and audit history. Otherwise it recreates the skill problem with worse observability.

## Naming Model

Human/product language:

- Browser Lane
- Desktop Lane
- Terminal Lane
- Mail Lane
- Message Lane
- Memory Lane
- Review Lane

CLI language:

- `hive browser ...`
- `hive desktop ...`
- `hive terminal ...`
- `hive lanes status`

Model-visible tool names:

- `hivematrix_browser`
- `hivematrix_desktop`
- `hivematrix_terminal`
- `hivematrix_mail`
- `hivematrix_message`
- `hivematrix_memory`

Backend names:

- `agent_browser`
- `playwright_mcp`
- `chrome_devtools_mcp`
- `codex_computer_use`
- `browserbase`
- `canopy`

Backend names should not be normal routing choices for the COO or frontier workers. They are implementation details and escalation options.

## Scope

### In Scope

- Rename browser/web concepts from Bees to Browser Lane.
- Remove WebBee, BrowserBee, and Weaver as named components after compatibility migration.
- Build early Browser Lane Mac app console for auth readiness.
- Add `hive browser` CLI surface.
- Use macOS Keychain only for browser credentials.
- Add dedicated browser-site, credential-ref, readiness-probe, readiness-run, trace, capability, provider, and routing-rule tables.
- Add one canonical model-facing browser capability.
- Hide direct Claude/Codex Chrome MCP behind explicit escalation routing.
- Add trace bundles for troubleshooting.
- Add visual/OCR/vision fallback design for unlabeled pages.
- Add Apple Developer setup plan for Browser Lane app identifier and provisioning under Team Irv Cassio (`cassio.irv@gmail.com`), with password/2FA handled by the operator.

### Out Of Scope For First Build

- Universal CAPTCHA solving.
- 1Password integration.
- Cloud credential vaults.
- Replacing the browser engine.
- Direct arbitrary COO SQL editing without validation.

## Browser Lane Product Shape

Browser Lane is one user/model-facing browser tool with multiple internal modes:

| Public Browser Lane Capability | Former Name / Backend |
|---|---|
| `fetch`, `read`, `search` | WebBee fast path |
| `open`, `snapshot`, `act`, `upload`, `download` | BrowserBee rendered/authenticated path |
| `readiness`, `reauth`, `credential fill` | Auth/session plane |
| `workflow run` | Deterministic scripts + browser controller |
| `visual locate`, `ocr`, `screenshot assert` | Local visual/vision fallback |
| `escalate` | Chrome MCP, Codex Computer Use, Browserbase, etc. |

The COO should route to Browser Lane, not to these implementation modes.

## Mac App First

The first app should be a **Browser Lane Console**, not a full custom browser engine.

Core screens:

- Sites dashboard with green/yellow/orange/red auth readiness.
- Add Site wizard.
- Credential setup backed only by macOS Keychain.
- Dedicated browser profile viewer / handoff window.
- Readiness probe recorder.
- Trace timeline and failure diagnostics.
- Permissions/onboarding checklist.

Readiness states:

- Green: session valid and read-only probe passed.
- Yellow: session valid, but workflow/probe needs maintenance.
- Orange: human action required: 2FA, CAPTCHA, reauth, account chooser.
- Red: blocked, revoked, suspicious login, site unavailable, or failed assertion.

The app should not click every link. It should run site-specific read-only probes:

- URL reachable.
- Expected text or selector visible.
- Account indicator matches expected account.
- Important workflow entry point exists.
- Optional screenshot/visual assertion passes.

## Keychain Boundary

Use only macOS Keychain for Browser Lane secrets.

HiveMatrix database stores metadata and references only:

```json
{
  "siteId": "heygen",
  "credentialRef": "hivematrix.browser.heygen.primary",
  "allowedDomains": ["app.heygen.com", "www.heygen.com"]
}
```

Keychain stores secrets:

- username
- password
- optional future TOTP secret if explicitly enabled

The model never receives:

- passwords
- cookies
- TOTP secrets
- raw Keychain values
- bearer tokens

Credential fill is a controller action:

```json
{
  "capability": "browser.credential.fill",
  "siteId": "heygen",
  "credentialRef": "hivematrix.browser.heygen.primary",
  "targetFormRef": "login_form"
}
```

## Logging And Troubleshooting

Each readiness run and browser workflow should create a trace bundle:

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
- Redact password fields and credential values.
- Do not export cookies by default.
- Record credential actions as `credential.fill(ref=...)`, not values.
- Preserve enough page state to debug selector and visual failures.

CLI examples:

```bash
hive browser trace latest
hive browser trace open run_123
hive browser diagnose heygen
hive browser export-debug run_123 --redacted
```

## Visual Capability

Browser Lane should mimic the useful part of Codex Computer Use's graphics capability with layered perception:

1. DOM and accessibility tree.
2. HTML/form heuristics.
3. OCR over screenshots.
4. Local vision model or image matching for icons/cards/unlabeled controls.
5. Frontier vision escalation only when local repair fails or risk is high.
6. Human fallback for CAPTCHA, 2FA, and uncertain external side effects.

Visual actions must still produce assertions and traces. The system should not click vaguely because "it looks right" without post-action verification.

## COO Routing Rules

The COO should route through typed SQL tables, not prompt-heavy skills.

Proposed tables:

- `lane_providers`
- `lane_capabilities`
- `coo_routing_rules`
- `coo_routing_rule_history`
- `browser_sites`
- `browser_credentials`
- `browser_readiness_probes`
- `browser_readiness_runs`
- `browser_trace_runs`
- `browser_trace_events`

The key table is `coo_routing_rules`.

Suggested columns:

```sql
id TEXT PRIMARY KEY,
name TEXT NOT NULL,
priority INTEGER NOT NULL,
enabled INTEGER NOT NULL DEFAULT 1,
intent TEXT NOT NULL,
match_json TEXT NOT NULL DEFAULT '{}',
constraints_json TEXT NOT NULL DEFAULT '{}',
lane TEXT NOT NULL,
capability TEXT NOT NULL,
backend_policy TEXT NOT NULL DEFAULT 'lane_owned_first',
model_posture TEXT NOT NULL DEFAULT 'mixed-local-first',
risk_tier TEXT NOT NULL DEFAULT 'normal',
approval_policy TEXT NOT NULL DEFAULT '{}',
verification_policy TEXT NOT NULL DEFAULT '{}',
notes TEXT NOT NULL DEFAULT '',
createdAt TEXT NOT NULL DEFAULT (datetime('now')),
updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
```

Example rule:

```json
{
  "intent": "authenticated_browser_workflow",
  "match": {
    "phrases": ["browser", "log into", "upload to HeyGen", "create video"],
    "domains": ["heygen.com"]
  },
  "lane": "browser",
  "capability": "workflow.run",
  "backendPolicy": "lane_owned_first",
  "modelPosture": "local_first_frontier_on_failure",
  "riskTier": "external_side_effect",
  "approvalPolicy": {
    "beforePublish": true,
    "credentialFill": "first_use_or_new_domain"
  }
}
```

HiveMatrix can browse and maintain these rules through UI/CLI, but changes must go through:

- schema validation
- dry-run against fixtures
- audit history
- rollback
- optional human approval for high-risk rule changes

The COO should receive a resolved route object, not a giant prompt lesson:

```json
{
  "lane": "browser",
  "capability": "workflow.run",
  "workflowId": "heygen.create_video",
  "backendPolicy": "lane_owned_first",
  "modelPosture": "local_first_frontier_on_failure",
  "approvalPolicy": { "beforePublish": true }
}
```

## Native Browser Tool Override

Normal HiveMatrix workers should not receive raw Claude Chrome MCP or Codex Chrome MCP browser tools.

They should receive only:

- `hivematrix_browser`

Backend tools are exposed only through escalation:

- `browser_backend_chrome_devtools_escalation`
- `browser_backend_codex_computer_use_escalation`
- `browser_backend_playwright_mcp_escalation`

This prevents "browser" from being interpreted as the frontier model's native browser instead of Browser Lane.

## Apple Developer Setup

Browser Lane needs a real signed Mac app early enough to test:

- Keychain access groups.
- Local loopback permissions.
- Automation permissions.
- Browser profile storage.
- User trust and fewer repeated prompts.

Recommended identifiers:

- Bundle ID: `com.irvcassio.hivematrix.browserlane`
- App name: `Hive Browser`
- Team: Irv Cassio
- Apple ID account: `cassio.irv@gmail.com`

Portal setup should be operator-assisted with Computer Use:

- Stop on password prompts.
- Stop on 2FA prompts.
- Never echo credentials or codes into logs/docs.
- Verify exact Team before creating identifiers/profiles.

## Migration Strategy

Do not attempt a giant rename in one commit, but do make deletion the explicit target.

Use three layers:

1. New names and route/tool contracts.
2. Short-lived compatibility aliases for old Bee names.
3. Removal of old names from code, UI, docs, prompts, and model-visible tools once tests pass.

Initial compatibility:

- `browserbee_run` aliases to `hivematrix_browser`.
- `webbee_search` aliases to `hivematrix_browser.fetch/search`.
- `AuthBee` types can temporarily alias to `SessionPlane` types.
- Existing tests can be migrated gradually.

Final target:

- No user-visible WebBee/BrowserBee/Weaver names.
- No remaining `src/lib/browserbee`, `src/lib/webbee`, or Weaver module paths.
- No remaining model tools named `browserbee_*`, `webbee_*`, or `weaver_*`.
- No docs instructing the COO/operator/model to use BrowserBee/WebBee/Weaver.
- No model-visible raw browser backend tools.
- COO routes to `browser` lane through DB-backed rules.

## Recommendation

Build Browser Lane as a native Mac app plus CLI-backed local service early.

First implementation slice:

1. Rename model-facing browser/web tool contracts.
2. Add DB-backed routing rule and Browser Lane site/readiness schema.
3. Add `hive browser` CLI skeleton.
4. Add Mac app scaffold and Apple provisioning setup.
5. Add one local Keychain-backed site readiness flow.
6. Keep old Bee names only as aliases until migration completes.

This is more work than a wrapper around Chrome MCP, but it is the only path that gives HiveMatrix a durable solo-founder automation substrate instead of another fragile prompt convention.
