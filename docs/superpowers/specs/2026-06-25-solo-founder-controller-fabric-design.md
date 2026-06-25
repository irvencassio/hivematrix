# Solo Founder Controller Fabric Design

Date: 2026-06-25
Status: Brainstorming / design options

## Problem

HiveMatrix should not be only a video-factory agent or a collection of skills. The target is a complete autonomous operating system for a solo founder: it should grow a business, operate tools, monitor opportunities, create assets, update systems, and handle repeatable back-office work.

The hard part is not only model intelligence. The hard part is reliable action:

- Browser and desktop work need durable, typed controllers instead of ad hoc prompt-driven screen control.
- Secrets must stay in Keychain, browser profiles, OAuth stores, or app-native credentials. The model should see capability names, status, schemas, and outputs, not passwords or raw tokens.
- The COO/router needs a database-backed map of which workflows are deterministic scripts, which are model-assisted, which require BrowserBee/DesktopBee/API controllers, and which require frontier review.
- Local models on the MacBook Pro M5 Max with 128GB memory should carry most operational work to keep frontier usage down.

## Research Snapshot

Existing HiveMatrix is already close to the right shape:

- Model routing is role-based. Mixed mode sends `think` and `code-critical` to frontier models but `execute` and `cheap-web` to local Qwen. Local-only routes all roles to local Qwen and queues frontier-review debt for critical work.
- BrowserBee currently models authenticated browser jobs with run modes, approval modes, artifact policies, and backings for Codex Computer Use or DesktopBee fallback.
- DesktopBee already sends typed requests to a native Swift helper over loopback with approval enforcement.
- TermBee already prefers Canopy, which exposes a local `/capabilities` and `/invoke` bridge.
- Canopy is the strongest reference pattern: credentials live in Keychain and the model-facing bridge gets typed capability calls and bearer-authenticated output.

Brain docs point in the same direction:

- Hive should be the orchestration brain, not just another tool zoo.
- BrowserBee should own authenticated rendered browser work through reusable sessions.
- DesktopBee should own native app/full-computer control.
- Hermes is useful as inspiration for a skill-improvement loop, but not as an embedded runtime unless a stable driveable API appears.
- OpenClaw is a serious reference for local-first gateway, channels, browser profiles, plugins, skills, and policy, but adopting it as the top-level control plane would compete with HiveMatrix unless deliberately bridged.

## Design Principle

HiveMatrix should become a controller fabric, not a giant agent prompt.

The COO should route work to durable capabilities:

- `WebBee`: public web/search/fetch, no login.
- `BrowserBee`: authenticated browser sessions, uploads/downloads, screenshots, stateful sites.
- `DesktopBee`: local Mac apps, Accessibility, ScreenCaptureKit, AppleScript/JXA, file dialogs, menus.
- `TermBee`: shell/CLI through Canopy where possible.
- `APIBee`: service APIs with OAuth/API keys held outside the model.
- `ContentBee`: script/story/asset generation and editorial production.
- `ReviewBee`: verification, risk review, and final human-facing summaries.

Every controller should use the Canopy-style shape:

```json
{
  "name": "browser.session.attach",
  "summary": "Attach to a ready browser session by label.",
  "inputSchema": {},
  "outputSchema": {},
  "permission": "confirm_external",
  "requiresSession": "heygen",
  "sideEffect": "browser_state",
  "secretBoundary": "controller_owned"
}
```

The model can ask for `browser.session.attach` or `heygen.video.create_from_script`. It should never ask the user for a HeyGen password, paste a token into a prompt, or receive hidden session cookies.

## Deployment Options

### Option 1: Local-Only

All planning, scripting, routing, extraction, browser/desktop decisions, and coding run through local Qwen or another local OpenAI-compatible model. Controllers still operate the screen and APIs, but model calls never leave the Mac.

Best for:

- Low marginal cost.
- Privacy-sensitive business operations.
- Bulk monitoring, summarization, classification, draft generation, and deterministic workflow execution.
- Offline or degraded-network operation.

Risks:

- Weakest at novel strategy, hard visual recovery, ambiguous UI, subtle code review, and high-stakes external actions.
- Needs stronger scripts, schemas, replayable workflows, and test fixtures because the model will be less able to improvise safely.

Recommendation:

- Treat this as a supported posture, not the default for business-critical growth work.
- Require strong workflow definitions, local evals, and human approval for external side effects.
- Queue frontier-review debt for important decisions and critical code when frontier returns.

### Option 2: Mixed With Claude

Local Qwen handles most operational work. Claude handles strategic planning, nuanced business judgment, ambiguous creative direction, final review, and high-risk action approval.

Best for:

- Highest current fit with the existing HiveMatrix routing docs.
- Business strategy, writing quality, product judgment, and multi-step planning.
- Keeping frontier spend concentrated on high-leverage judgment.

Risks:

- Requires explicit budget and escalation policy or the system will drift back toward frontier-by-default.
- Claude does not itself give a native desktop/browser control substrate; HiveMatrix still needs BrowserBee/DesktopBee/Canopy-style controllers.

Recommendation:

- Use as the primary near-term mode.
- Change mixed mode from "frontier thinks by default" to "local drafts and plans first; Claude reviews/escalates when risk, uncertainty, or novelty crosses thresholds."

### Option 3: Mixed With Codex

Local Qwen handles routine work. Codex handles coding-heavy workflows, repository changes, Computer Use escalation, and UI-driven tasks where the Codex desktop/app tools are the best available frontier control surface.

Best for:

- Coding, repo maintenance, build/release work, and tasks that benefit from Codex Computer Use.
- Browser/desktop escalation where the built-in Codex environment can operate the UI.
- Integrating with OpenAI-style Agents/Codex SDK/App Server patterns later.

Risks:

- Codex Computer Use is a strong escalation path, but it should not become the only automation substrate. It is less deterministic than typed site/app controllers.
- For a HiveMatrix product, relying entirely on an external Codex UI loop can blur who owns approvals, audit, and workflow state.

Recommendation:

- Use Codex as a specialist worker and visual escalation engine.
- Keep HiveMatrix as the system of record for workflows, approvals, sessions, audit, artifacts, and cost.

### Option 4: Frontier-Only With Claude

Claude handles all planning and execution decisions. Controllers still own credentials and actions, but local models are disabled.

Best for:

- Highest reasoning quality for strategy, creative, and ambiguous tasks.
- Early prototyping when reliability matters more than spend.
- One-off high-value work.

Risks:

- Cost can scale badly for always-on solo-founder operations.
- It underuses the M5 Max and weakens the local-first premise.
- Still needs controller fabric for real-world action and secret safety.

Recommendation:

- Keep as a premium / emergency / evaluation posture, not the default OS mode.

### Option 5: Frontier-Only With Codex

Codex handles all planning, coding, and UI operation. HiveMatrix becomes more of a workflow dashboard and state layer around Codex workers.

Best for:

- Software engineering, local machine operations, and workflows where Codex has the best tool access.
- Fast experiments before building dedicated controllers.

Risks:

- Business operations become dependent on the Codex surface rather than HiveMatrix-owned capabilities.
- Long-running autonomous business workflows need persistent state, credential policy, and audit surfaces that should live in HiveMatrix.
- Frontier-only is the most expensive mode for repetitive operational work.

Recommendation:

- Use as a fallback and prototyping path.
- Promote successful Codex-driven workflows into deterministic scripts or typed controllers.

## Recommended Architecture

Make HiveMatrix the top-level control plane.

OpenClaw, Hermes, Claude, Codex, local Qwen, browser controllers, native helpers, and Canopy should be possible workers or inspirations, but HiveMatrix should own:

- Workflow registry.
- Capability registry.
- Session and credential inventory metadata.
- Approval policies.
- Run history and audit.
- Artifacts and evidence.
- Model routing and cost budgets.
- Escalation and review debt.

The key database additions should be:

- `capability_providers`: BrowserBee, DesktopBee, Canopy, OpenClaw bridge, Codex worker, Claude worker, API connectors.
- `capabilities`: typed capability name, owner provider, schemas, permissions, side effects, availability, cost/risk hints.
- `credential_refs`: non-secret labels for Keychain/OAuth/browser-session material.
- `session_refs`: site/app/session status, last health check, reauth state, allowed domains.
- `workflow_defs`: deterministic or model-assisted playbooks with required capabilities, model posture, approval policy, verification criteria.
- `workflow_runs`: step-level evidence, controller calls, screenshots, output artifacts, verification result, spend.

## Local Model Policy

The M5 Max should be a first-class compute tier.

Default local lanes:

- Draft scripts, posts, emails, and briefs.
- Classify inbound tasks and route to workflows.
- Extract structured data from pages, PDFs, emails, and logs.
- Summarize public web results and controller output.
- Generate first-pass plans and checklists.
- Run deterministic workflow steps.
- Produce retrospectives and skill/playbook updates.

Escalate to Claude or Codex when:

- The workflow has high external consequence: spending money, sending messages, publishing, deleting, legal/financial/medical stakes.
- The UI has changed and the local model cannot recover.
- The task is novel, strategic, or brand-sensitive.
- Code is critical and needs final review.
- The confidence score is low or controller verification fails.

This should become a router policy, not a vibe:

```ts
route = chooseModel({
  workflowId,
  role,
  riskTier,
  novelty,
  externalSideEffect,
  confidence,
  budgetPolicy,
  posture: "local-only" | "mixed-claude" | "mixed-codex" | "frontier-claude" | "frontier-codex"
});
```

## Script-First Workflows

Skills should teach the model how to think. Scripts should do deterministic work.

For repeatable solo-founder operations, the ideal workflow is:

1. Local model drafts a plan or script.
2. Deterministic script validates inputs and prepares structured payloads.
3. Controller performs typed actions through CLI/browser/desktop/API.
4. Verification script checks final state.
5. Frontier model reviews only if risk, novelty, failure, or policy requires it.

The HeyGen video workflow is a good first example:

- `ContentBee` develops script and scene metadata.
- `BrowserBee` attaches to a ready HeyGen session.
- A deterministic portal script uploads/enters the script and starts video creation.
- BrowserBee captures proof and output URLs.
- The COO stores artifacts and run evidence.

## OpenClaw / Hermes / Codex Position

OpenClaw:

- Strong candidate to study or bridge because it already has local-first gateway, browser profile control, plugin/tool policy, channels, and skills.
- Should not replace HiveMatrix until a side-by-side bridge proves it owns browser/desktop autonomy better than HiveMatrix can.

Hermes:

- Strong inspiration for closed-loop skill creation and improvement.
- Weak candidate to embed as the main runtime because current research found it interactive/gateway-first rather than a clearly driveable backend for HiveMatrix.

Codex:

- Strong specialist for coding, repo maintenance, and Computer Use escalation.
- Should be a worker/controller, not the HiveMatrix database/control-plane replacement.

Claude:

- Strong specialist for strategy, business judgment, creative direction, and final review.
- Should be an escalation tier, not the default path for repetitive operations.

## Recommendation

Build HiveMatrix as the solo-founder control plane with a controller fabric underneath.

Near-term direction:

1. Keep HiveMatrix as the system of record.
2. Standardize a Canopy-style capability contract for BrowserBee, DesktopBee, TermBee, and future API connectors.
3. Add a database-backed workflow and capability registry.
4. Support five runtime postures: local-only, mixed-Claude, mixed-Codex, frontier-Claude, frontier-Codex.
5. Make mixed-Claude the default business posture, but bias routine work to local Qwen and frontier only on risk/novelty/review thresholds.
6. Use Codex Computer Use as a visual/coding escalation engine and promote stable paths into deterministic scripts.
7. Run OpenClaw side-by-side as a benchmark or capability backend before deciding whether to adopt pieces.
8. Steal Hermes' skill-retrospective loop without embedding Hermes as the core runtime.

## Open Decision

The main product fork:

- HiveMatrix remains the top-level solo-founder OS and bridges OpenClaw/Codex/Claude/Hermes ideas as workers.
- OpenClaw becomes the top-level daemon and HiveMatrix narrows into business workflows, dashboard, memory, and domain playbooks.

My current recommendation is the first fork: HiveMatrix should remain the top-level control plane, because it already owns the business context, model routing, approvals, directives, database, local-model readiness, and app-specific product surface.
