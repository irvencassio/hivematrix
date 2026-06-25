# HeyGen Script-First Portal Automation Design

## Context

The current HiveMatrix video factory has a solid script-review checkpoint and a HeyGen API lane, but the API lane has not matched the native HeyGen portal experience well enough for the desired output quality. The better boundary is:

- HiveMatrix owns deterministic script development, review, revisions, metadata, and publishing state.
- A browser/desktop automation lane owns the authenticated HeyGen portal render step.
- The router/COO should learn that repeatable production workflows are not just prompts or skills; they are durable workflow definitions with state, tool ownership, and run history.

## Research Snapshot

The existing video flow already drafts a script cheaply, creates a review task, saves edits without spending, and only renders/publishes after approval.

BrowserBee already models stateful browser work with two possible backings: Codex Computer Use when API-key Codex auth can drive the computer-use model, and an opt-in DesktopBee fallback where a local model drives a desktop browser through AppleScript, Accessibility, click/type, and screenshots.

WebBee is intentionally read-only fresh public retrieval. It is not the right lane for HeyGen portal work.

Weaver exists locally as a Python CLI browser automation scaffold using Patchright, browser-use, emunium, and SearXNG, but it is not yet a proved HiveMatrix production backing. The older brain architecture review also recommended pausing Weaver as a standalone product story and folding its ideas behind BrowserBee unless it earns a separate product reason.

Script skills already exist, but they are stored as skill-library artifacts and run as trusted deterministic scripts in the background. That mechanism is useful but too small to be the main workflow substrate for video production because it lacks durable workflow metadata, typed inputs/outputs, lifecycle state, artifact links, and routing history.

## Design Options

### Option 1: Minimal BrowserBee handoff

Keep the current video draft/review system. After approval, create a BrowserBee job whose objective is to open HeyGen, upload/paste the approved script, choose the configured style/avatar/options, render, download the MP4, and hand the path back to HiveMatrix for YouTube publishing.

Pros:
- Fastest path to a real portal-quality proof.
- Reuses BrowserBee and Codex Computer Use rather than depending on unfinished Weaver work.
- Keeps spend and login inside an explicit human-visible workflow.

Cons:
- The HeyGen portal procedure is mostly prompt text at first.
- Download/result capture may be brittle until the workflow has structured step checkpoints.

### Option 2: Workflow registry plus BrowserBee executor

Add a durable workflow registry for repeatable scripts/processes. A `heygen.portal_render` workflow would define typed inputs, required sessions, preferred capability lane, fallback lane, approvals, artifacts, and success criteria. The COO/router would consult this registry before choosing WebBee, BrowserBee, DesktopBee, TermBee, or script execution.

Pros:
- Matches the underlying need: deterministic repeat work should be explicit infrastructure, not improvised prompts.
- Gives the router/COO a database-backed memory of what tool set owns which class of job.
- Creates a foundation for other production workflows beyond video.

Cons:
- More schema and UI/API surface.
- Needs careful TDD and small implementation slices.

### Option 3: Promote Weaver as a BrowserBee backing

Turn Weaver into a local controller/provider behind BrowserBee, using Patchright/browser-use for HeyGen and other portal workflows. BrowserBee stays the product-facing lane; Weaver is only an implementation backend.

Pros:
- Could become a strong long-term browser-control engine.
- Stealth profiles, browser-use loops, and human-like behavior are aligned with authenticated SaaS workflows.

Cons:
- Weaver is currently thin and not proved in HiveMatrix.
- Adds another runtime before the product workflow is validated.
- Risk of reopening the component-sprawl problem the brain docs already warned about.

## Recommendation

Use Option 1 for the first real HeyGen portal proof, but shape it so it can evolve into Option 2.

Concretely:

1. Keep script drafting/review as the deterministic first phase.
2. Replace API render-after-approval with a `portal_render` target that creates a BrowserBee task.
3. Encode the HeyGen portal steps as structured job data, not only prose: start URL, allowed domains, session label, required human login handling, script source path, desired output path, and success criteria.
4. Record every run with artifact links and outcome metadata so the future workflow registry has real examples to learn from.
5. Defer Weaver until BrowserBee has a stable workflow contract to plug into.

## Proposed Architecture

```text
Video request
  -> script workflow (deterministic)
  -> review task (human approval)
  -> BrowserBee portal render job (HeyGen UI)
  -> artifact capture/download
  -> optional YouTube publish
  -> run history / telemetry / workflow learning
```

## Key Boundaries

- WebBee: public research only; not involved in HeyGen.
- BrowserBee: logged-in HeyGen portal automation.
- DesktopBee: fallback or native download/file-picker control.
- TermBee/script execution: deterministic local preparation, validation, file moves, metadata generation.
- Skills: human/agent recipes and small trusted scripts, not the canonical durable workflow database.
- Future workflow registry: typed durable workflow definitions and run history for the COO/router.

## Open Question

For the first implementation slice, should approval create a separate visible BrowserBee task for the HeyGen portal render, or should the existing video review task move into a `rendering_in_portal` state and own the BrowserBee child task under the hood?
