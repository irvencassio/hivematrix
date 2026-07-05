# Skills And Commands Sharing Design

## Context

HiveMatrix already has a unified Skills & Commands catalog in the console:

- Brain-library skills come from `GET /skills` and are backed by `src/lib/skills/*`.
- Local profile commands and folder skills come from `GET /commands` and are backed by
  `src/lib/commands/local-catalog.ts`.
- Brain-library skills already have `compat` metadata, currently expressed as
  `all`, `claude`, `codex`, and `qwen`.
- Local commands expose source metadata such as `model`, `allowed-tools`,
  `argument-hint`, and source path, but they do not expose normalized provider
  compatibility.
- The console has sharing/import affordances for library skills (`Copy`,
  `Publish`, remote import, local skill import), but there is no standalone HTML
  brain doc that explains the model.

The operator wants skills and commands to be easy to share out and import, and
the catalog browser should make it obvious which assets can run with all,
Claude, ChatGPT, Qwen local, and DeepSeek local.

## Goals

- Add a normalized compatibility signal for both library skills and local
  commands/folder skills.
- Display compatibility in the catalog browser with human labels:
  `All`, `Claude`, `ChatGPT`, `Qwen(local)`, and `DeepSeek(local)`.
- Preserve the existing internal `codex` harness identifier while presenting it
  as ChatGPT in the UI and docs.
- Add `deepseek` as a first-class compatibility target for skills and fan-out.
- Infer local command compatibility conservatively from frontmatter `model`.
- Create a standalone HTML brain doc that explains share/import flows and the
  compatibility labels.

## Non-Goals

- Do not create a full marketplace or new signed bundle format in this pass.
- Do not change task routing or execution semantics.
- Do not auto-import untrusted remote skills.
- Do not copy bundled local skill assets into the brain library; native
  `/commands/run` remains the fidelity path for bundled assets.

## Approaches

### Approach A: Documentation Only

Create an HTML brain doc explaining the current behavior.

Pros:

- Lowest risk.
- No runtime changes.

Cons:

- Does not make the catalog browser easier to scan.
- Does not help local commands identify provider compatibility.

### Approach B: Catalog Metadata Plus Brain Doc

Extend catalog metadata, render compatibility chips in the console, and create a
standalone HTML brain doc.

Pros:

- Directly addresses the browser-identification request.
- Keeps the existing import/share surfaces.
- Small, testable change set.

Cons:

- Requires touching shared skill compatibility types and fan-out targets.
- Local command compatibility is inferred from available frontmatter, not from
  dynamic execution proof.

### Approach C: Full Marketplace Layer

Add export/import packages for commands and skills with signed manifests,
versions, and richer provenance.

Pros:

- Strong long-term sharing model.
- Could support bundled command assets and trust attestations.

Cons:

- Too broad for this request.
- Requires separate security and product design.

## Decision

Use Approach B.

## Design

### Compatibility Model

The canonical compatibility identifiers are:

- `all`
- `claude`
- `codex`
- `qwen`
- `deepseek`

The UI labels are:

- `all` -> `All`
- `claude` -> `Claude`
- `codex` -> `ChatGPT`
- `qwen` -> `Qwen(local)`
- `deepseek` -> `DeepSeek(local)`

`codex` remains the internal harness identifier because existing fan-out and
skill metadata use it for ChatGPT/Codex routes.

### Local Command Inference

Local commands and folder skills get a `compat` array:

- Missing `model` -> `["all"]`
- `model: all`, `any`, or `*` -> `["all"]`
- Claude-like model aliases (`opus`, `sonnet`, `haiku`, `claude-*`) ->
  `["claude"]`
- ChatGPT/Codex/OpenAI-like aliases (`codex`, `gpt-*`, `chatgpt`,
  `openai-*`) -> `["codex"]`
- Qwen-like aliases (`qwen*`) -> `["qwen"]`
- DeepSeek/Dwarf Star aliases (`deepseek*`, `ds4*`, `dwarf-star*`) ->
  `["deepseek"]`
- Comma-separated model values can produce multiple targets.
- Unknown values fall back to `["all"]` so old assets do not disappear or look
  unusable.

### Browser UI

The unified Skills & Commands section should:

- Show compatibility chips in each list row.
- Show compatibility in both library skill and local command detail panels.
- Include compatibility in the search haystack so queries like `deepseek` or
  `chatgpt` work.
- Keep long chips inside the narrow context column without overflow.

### Share And Import Brain Doc

Create `docs/SKILLS-COMMANDS-BRAIN.html` with:

- Non-technical explanation.
- Compatibility label guide.
- Share-out flows for copied skill markdown and published skill scopes.
- Import flows for URL/paste, shared scopes, and local profile folder skills.
- Local command limitations and bundled-asset behavior.
- Source map to the relevant implementation files.

## Acceptance Criteria

- `src/lib/skills/contracts.ts` accepts and round-trips `deepseek` in `compat`.
- `src/lib/skills/fanout.ts` includes a DeepSeek local target.
- `src/lib/commands/contracts.ts` exposes local command `compat` metadata and
  tests cover Claude, ChatGPT, Qwen, DeepSeek, and all.
- `src/daemon/console.ts` renders compatibility chips for both library skills
  and local commands.
- `src/daemon/console.test.ts` verifies the labels and non-overflow styling.
- `docs/SKILLS-COMMANDS-BRAIN.html` exists and includes the import/share and
  compatibility sections.
- Verification gates pass:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

No local-model runtime paths are changed, so `npx tsx scripts/qwen-readiness.mts`
is not required for this feature.
