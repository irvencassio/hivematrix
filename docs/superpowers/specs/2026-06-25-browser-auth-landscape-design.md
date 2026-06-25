# Browser Auth Landscape Research

Date: 2026-06-25
Status: Research note for BrowserBee / solo-founder controller fabric

## Question

Has anyone truly solved browser use with a free solution that also handles authentication?

## Short Answer

No one appears to have fully solved universal authenticated browser automation for free.

The best free/open-source tools solve a narrower but useful problem: reuse an already-authenticated browser profile, persistent user data directory, or exported storage state. That is enough for many solo-founder workflows if the human logs in once and HiveMatrix reuses the session.

The products that go further into managed credentials, 1Password integration, automatic TOTP, encrypted injection, cloud profiles, stealth browsers, and captcha/proxy handling are mostly paid/cloud products.

## What "Solved" Should Mean

A serious solution needs all of this:

- Persistent login state across runs.
- Ability to attach to or clone an existing signed-in browser profile.
- No passwords, cookies, or TOTP secrets exposed to the model.
- Human approval for high-risk credential fills and external side effects.
- Reliable file upload/download support.
- Recovery when sessions expire, selectors change, or 2FA/CAPTCHA appears.
- Audit trail of actions, screenshots, state checks, and artifacts.
- Local/free mode for routine work.

## Current Free/Open Options

### agent-browser

Best current CLI-shaped fit for HiveMatrix.

Strengths:

- Open-source Apache-2.0 CLI.
- Active and very popular.
- Uses stable element refs and accessibility snapshots.
- Supports uploads, screenshots, PDFs, batch execution, local browser sessions, and cloud browser providers.
- Supports Chrome profile reuse, persistent profile directories, and importing auth state from a running Chrome session.
- Original profile can be copied as a read-only snapshot, which is safer than letting agents mutate the daily driver profile.

Limitations:

- Authentication is still session reuse or storage-state import, not a complete credential broker.
- Remote debugging / auth import is powerful and should be treated as full local browser control.
- For password-manager-style credential injection, the repo points toward plugin/vault patterns rather than shipping a complete free universal vault.

Assessment:

This is the strongest free base layer for BrowserBee if HiveMatrix wants a CLI-first browser controller.

### Playwright MCP

Best standard MCP option.

Strengths:

- Official Microsoft Playwright MCP server.
- Persistent profile is default; cookies/localStorage persist between sessions.
- Supports `--user-data-dir`, `--storage-state`, isolated mode, extension connection, and CDP endpoint attachment.
- Easy to expose to Codex, Claude, Cursor, Goose, LM Studio, etc.

Limitations:

- It is a browser control server, not a credential manager.
- Authentication is mostly persistent profiles/storage state or connecting to an existing browser.
- Good fit for coding-agent loops, less ideal as the whole product-facing BrowserBee unless wrapped in HiveMatrix policy/session/audit layers.

Assessment:

Use as a compatibility backend, especially for MCP-native workers.

### Chrome DevTools MCP

Best official Chrome-native option.

Strengths:

- Official Chrome DevTools MCP server.
- Controls and inspects live Chrome.
- Supports persistent user data directory.
- Supports auto-connect / existing browser session flows that reuse real logged-in Chrome state.

Limitations:

- Existing-session control is high risk because the agent can act inside a signed-in browser.
- Its own authenticated-page discussion points to auto-connect as the solution, not to a full credential abstraction.
- Better for debugging/dev workflows than durable business workflow execution unless wrapped.

Assessment:

Useful as an attach-to-real-browser backend and as a building block inside OpenClaw-like flows.

### Browser Use OSS

Best full agent framework.

Strengths:

- Open-source MIT.
- Very popular and active.
- Supports real Chrome profile usage and storage-state export/import.
- Current docs discuss profile syncing, TOTP placeholders, custom tools, and 1Password SDK use.

Limitations:

- Best production/auth/stealth features are tied to Browser Use Cloud.
- Open-source path can be made to handle auth, but the secure credential broker is something you compose with custom tools.

Assessment:

Strong reference and possible backend. Less CLI-native than agent-browser for HiveMatrix's deterministic script-first lane.

### OpenClaw Browser Tool

Best full assistant/gateway reference.

Strengths:

- Local Gateway with browser plugin.
- Isolated agent profile by default.
- Can attach to real signed-in Chrome through Chrome DevTools MCP.
- Has explicit profile selection, tab handling, stale-ref recovery, and manual blocker guidance.

Limitations:

- OpenClaw is a competing control plane, not just a browser library.
- It reports login/2FA/CAPTCHA blockers as manual action instead of pretending to solve them.
- Browser attachment to real signed-in sessions is useful but high-risk.

Assessment:

Study/bridge, but do not replace HiveMatrix yet.

### Stagehand

Best hybrid code-plus-AI SDK.

Strengths:

- Open-source SDK.
- Good design philosophy: combine deterministic code with AI where flexible perception is needed.
- Local mode can use a persistent `userDataDir`.
- Browserbase mode provides cloud contexts, keep-alive sessions, proxies, captcha solving, and observability.

Limitations:

- The strongest auth persistence features are Browserbase cloud features.
- Local free mode is useful but still file/profile persistence, not a whole credential-safe auth subsystem.

Assessment:

Strong pattern for deterministic workflows. Useful for generated scripts.

### Skyvern

Best open-source RPA/workflow product candidate.

Strengths:

- Open-source AGPL.
- Browser workflow builder with LLM/computer-vision approach.
- Public materials emphasize session persistence and authentication workflow handling.

Limitations:

- Heavier product stack.
- Public issue history still shows session persistence/auth bugs.
- More of a product to evaluate than a small embedded controller.

Assessment:

Worth trialing for workflow-builder ideas, but not a clean BrowserBee substrate until proven locally.

### Emerging Small Repos

`open-browser-use` and `bridgic-browser` are worth watching.

`open-browser-use` is interesting because it pairs a Chrome extension with a CLI/SDK/MCP and aims to be a platform-neutral browser-use layer for agents.

`bridgic-browser` is interesting because it focuses on stable refs, stealth mode, persistent profiles, and script generation.

Both are promising but much less proven than agent-browser, Playwright MCP, Browser Use, or Chrome DevTools MCP.

## Paid / Cloud Products Go Further

Browserbase, Kernel, Steel, and Browser Use Cloud are the current class of products that market stronger auth handling:

- Persistent cloud contexts/profiles.
- Local cookie sync.
- 1Password or credential-vault integration.
- TOTP handling.
- Encrypted credential injection.
- Captcha/proxy/stealth infrastructure.
- Session replay and observability.

This matters because it shows the missing shape, but those capabilities are not generally available as a complete free local stack.

## Recommendation For HiveMatrix

Do not wait for a magical free universal browser-auth solution.

Build BrowserBee as a HiveMatrix-owned controller with pluggable backends:

1. Primary local backend: `agent-browser`.
2. Compatibility backend: Playwright MCP.
3. Real-user-browser attach backend: Chrome DevTools MCP / OpenClaw-style `user` profile.
4. Generated script backend: Stagehand local.
5. Optional commercial backend: Browserbase / Kernel / Browser Use Cloud for workflows that need stealth, captcha, or managed credential injection.

Authentication policy:

- Default: human logs in once to a dedicated BrowserBee profile; HiveMatrix reuses that profile.
- Safer attach: copy or import auth state from the user browser instead of mutating the daily profile.
- High-risk attach: connect to real signed-in Chrome only when the user is present and approves.
- Credentials: if we need automatic login, build a Canopy-style Keychain/1Password bridge where the model gets placeholders and the controller injects values.
- 2FA/CAPTCHA: treat as manual blockers unless a site-specific approved workflow has a credential/TOTP bridge.

The conclusion is practical: free browser automation has mostly solved session reuse, not universal authentication. HiveMatrix should own the credential/session boundary itself.

## What If We Build Our Own Agent Browser?

This is plausible, but the right scope is important.

HiveMatrix should not build a browser engine. It should build an agent browser shell on top of Chromium/WebKit/Playwright/CDP:

- Dedicated BrowserBee browser profile.
- Native shell or controlled Chromium instance.
- DOM/accessibility/screenshot scanner.
- Session and credential bridge.
- Script runner.
- Audit/proof recorder.
- Approval gates.

The shell would watch pages as they load and maintain an agent-readable page model:

```json
{
  "url": "https://example.com/login",
  "title": "Sign in",
  "forms": [
    {
      "id": "login-form",
      "purpose": "login",
      "fields": [
        { "ref": "field_email", "kind": "email", "label": "Email", "autocomplete": "username" },
        { "ref": "field_password", "kind": "password", "label": "Password", "autocomplete": "current-password" }
      ],
      "submit": { "ref": "button_sign_in", "text": "Sign in" }
    }
  ],
  "actions": [
    { "ref": "button_sign_in", "kind": "submit", "text": "Sign in" },
    { "ref": "link_forgot_password", "kind": "link", "text": "Forgot password?" }
  ],
  "risk": {
    "credentialForm": true,
    "externalSubmit": true
  }
}
```

The model or deterministic script should interact with stable refs and typed actions:

- `page.find({ text: "Log in", role: "button" })`
- `credential.fill({ provider: "heygen", usernameRef: "field_email", passwordRef: "field_password" })`
- `page.click({ ref: "button_sign_in" })`
- `page.waitFor({ urlContains: "/dashboard" })`

The credential bridge must be controller-owned:

- The model can request `credential.fill("heygen")`.
- BrowserBee looks up the credential label in Keychain or 1Password.
- BrowserBee injects values directly into fields.
- The model never receives the password, cookies, or TOTP secret.
- A human approval policy can gate first-time credential use, new domain use, payment flows, publishing, deletes, and messaging.

The shell should combine three page-understanding layers:

1. DOM and accessibility tree for stable semantic refs.
2. HTML/form heuristics for login/search/upload/payment detection.
3. Screenshot/vision fallback for canvas-heavy or inaccessible pages.

It should also have a workflow compiler:

1. Human or model demonstrates a site workflow once.
2. BrowserBee records DOM refs, selectors, URLs, network hints, and screenshots.
3. HiveMatrix saves a typed workflow script with assertions.
4. Future runs execute deterministically first.
5. Local model repairs only when assertions fail.
6. Frontier model escalates only when local repair fails or risk is high.

This changes the backend recommendation:

- `agent-browser`, Playwright MCP, and Chrome DevTools MCP become implementation substrates.
- BrowserBee becomes the product boundary and policy boundary.
- HiveMatrix owns session inventory, credential labels, workflow scripts, approvals, proof, and audit.

The first version should be modest:

1. Launch or attach a dedicated Chromium profile.
2. Produce a normalized page model from DOM + accessibility tree.
3. Detect login forms, search boxes, file inputs, tables, buttons, and links.
4. Support typed actions: open, click, fill, upload, download, wait, snapshot, screenshot.
5. Add Keychain-backed credential injection for one test site.
6. Save every action and post-action assertion to a run trace.

That would be a real BrowserBee. It would not solve every website, but it would give HiveMatrix the missing secure local substrate for agent and script use.

## Overriding Native Model Browser Tools

There is a real routing hazard: if a task says "browser" and the thinking model is Claude, Claude may naturally choose its own Chrome MCP/browser tool instead of the HiveMatrix browser controller.

The fix should be structural, not just prompt wording.

HiveMatrix should expose one canonical browser capability to models:

- Public human phrase: `browser`
- CLI: `hive browser ...`
- Model tool name: `hivematrix_browser`
- Backend names: `agent_browser`, `playwright_mcp`, `chrome_devtools_mcp`, `codex_computer_use`, `browserbase`

Claude/Codex/local models should not receive raw backend browser tools during normal HiveMatrix work. They should receive only the HiveMatrix wrapper:

```json
{
  "name": "hivematrix_browser.run",
  "description": "Run authenticated web/browser actions through HiveMatrix policy, sessions, credentials, approvals, and audit. Do not use native Chrome MCP unless this tool explicitly escalates."
}
```

If a backend browser tool must be available, it should be renamed as an escalation-only tool:

- `browser_backend_chrome_devtools_escalation`
- `browser_backend_codex_computer_use_escalation`
- `browser_backend_playwright_mcp_escalation`

The router should translate user language before it reaches a frontier worker:

```json
{
  "userText": "Use the browser to upload this script to HeyGen.",
  "toolIntent": {
    "lane": "browser",
    "capability": "workflow.run",
    "workflowId": "heygen.create_video",
    "backendPolicy": "hivematrix_owned_first"
  }
}
```

The thinking model can reason about intent and constraints, but HiveMatrix owns execution routing. The model should not decide that "browser" means Claude Chrome MCP just because that tool exists nearby.

Implementation rules:

1. Remove Claude Chrome MCP / Codex Chrome MCP from default HiveMatrix worker tool profiles.
2. Add only `hivematrix_browser` as the normal browser capability.
3. Keep backend browser tools in a separate escalation profile.
4. Require an explicit router decision before enabling an escalation backend.
5. Log every backend escalation with reason, risk, and trace.

Prompt rule, still useful but secondary:

> In HiveMatrix tasks, "browser" means `hivematrix_browser` / `hive browser`. Do not use native Chrome MCP, Playwright MCP, Codex Computer Use, or any direct browser backend unless HiveMatrix explicitly routes an escalation.

This gives voice prompts the simple word "browser" while preserving the control boundary.
