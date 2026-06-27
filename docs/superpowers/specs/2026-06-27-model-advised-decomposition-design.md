# Model-Advised Work Package Decomposition — Design

> Superpowers brainstorming artifact. Date: 2026-06-27.
> Follow-up to the Task Intake + Work Package MVP and the orchestration slice.
> Topic: when a prompt is already classified broad, let the **local Qwen model**
> produce a better step breakdown than the regex splitter — while HiveMatrix
> deterministic policy still decides risk, gating, and concurrency. Opt-in,
> offline-safe, fully testable via injected fakes.
>
> **HARD CONSTRAINT (operator policy): no cloud LLM API keys, ever — no
> Anthropic key, no OpenAI/ChatGPT key.** Decomposition uses ONLY the local,
> keyless Qwen endpoint (LM Studio HTTP). There is no frontier/Claude leg and no
> dependency on any external CLI session for this feature. If the local model is
> unavailable (or connectivity is offline), intake falls back to the existing
> deterministic regex split.

## 1. Problem

The MVP decomposes a broad prompt with a crude regex splitter
(`splitFragments`). It misses steps, over-splits conjunctions, and can't infer
implicit work. We want a model to propose better *step boundaries and wording*.

The hard constraint (design principle 9, repeated across the prior specs):
**models advise; deterministic HiveMatrix policy decides.** So the model's only
job is to emit a cleaner list of step strings. Everything that matters for safety
— per-item risk, the held release/deploy final-gate, dependency gating, and
same-repo concurrency — stays deterministic and is applied identically to model
output and regex output.

## 2. Key design decision — model produces *fragments only*

The model returns `string[]` (concise step descriptions). Those fragments flow
through the **same** `proposedItemsFromFragments()` policy builder the regex path
already uses. Consequences:

- Risk regexes (`RELEASE_RE`/`DESTRUCTIVE_RE`/`CREDENTIALED_RE`) re-stamp each
  item; release/deploy/destructive → `risk: high`, `executionMode: hold`,
  `dependsOn` = all prior items (final gate). The model cannot downgrade a risky
  step.
- scopeHints (`worktree`/`read-only`) are derived deterministically from the
  fragment text, not trusted from the model — because they drive concurrency,
  which is policy.
- The model never sets `kind`, `risk`, `collision`, or concurrency. It only makes
  the step list better.

This keeps the safety surface 100% deterministic and makes the feature a pure
upgrade to fragment quality.

## 3. Components

### 3a. Keyless completion client — `src/lib/models/chat-client.ts`

A thin, injectable completion abstraction over the project's **keyless** backends.
NO cloud API keys are ever read or sent. Both the HTTP `fetch` and the CLI
process runner are injectable, so unit tests touch neither the network nor a
real subprocess.

```ts
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatComplete = (messages: ChatMessage[], opts?: ChatOpts) => Promise<string>;
interface ChatOpts { maxTokens?: number; temperature?: number; timeoutMs?: number; model?: string; fetchImpl?: typeof fetch; runCli?: CliRunner }

// Backend A — local Qwen over LM Studio HTTP (keyless). Primary, fast.
export async function localChatComplete(messages, opts?): Promise<string>
// Backend B — a keyless CLI session (codex `exec`; ChatGPT subscription). Best-effort.
export async function cliChatComplete(binary, messages, opts?): Promise<string>

// Resolve the configured completion backend, in order: local Qwen → codex CLI.
// Returns null when none is configured (→ deterministic fallback).
export function resolveCompletionClient(mode): ChatComplete | null
```

- `localChatComplete` parses `choices[0].message.content`; tries `/chat/completions`
  then `/v1/chat/completions` (mirrors `health.ts`'s candidate-URL pattern). Short
  timeout (default 12s). Endpoint + model from `getQwenProfile()`.
- `cliChatComplete` runs the keyless CLI one-shot — for codex:
  `codex exec --skip-git-repo-check -- <prompt>` — captures stdout, and feeds it
  through the same robust `parseSteps`. The CLI runner is injected
  (`runCli(binary, args, { stdin, timeoutMs }) => Promise<string>`), so tests use
  a fake and CI never spawns a process. This covers the **ChatGPT / Codex**
  situations via subscription login, no key.
- `resolveCompletionClient` prefers local Qwen (fast); falls back to the codex
  CLI when a `codex` binary is configured/found (`detectBackends()` /
  `findBinary`). **Claude is intentionally excluded** (operator avoids Anthropic).
- Non-2xx / non-zero exit → throws; the caller treats any throw as "no model" and
  falls back deterministically.

Refactoring the existing eval/health call sites onto this client is **out of
scope** (noted as a follow-up) — we only add the new shared module.

### 3b. Decomposer — `src/lib/intake/decompose.ts`

```ts
interface DecomposeDeps { client?: ChatComplete | null; connectivityMode?: string; force?: boolean }
export async function decompose(input: IntakeInput, deps?: DecomposeDeps): Promise<string[] | null>
```

Pipeline (graceful degradation):
1. mode = deps.connectivityMode ?? `getConnectivityPolicy().mode`. **offline →
   return null** (use deterministic fallback). (Local Qwen still works offline if
   the endpoint is on-box, but we keep offline conservative for MVP.)
2. client = deps.client ?? `resolveCompletionClient(mode)`. Null → null.
3. Ask the client to return a JSON array of concise steps for the prompt.
4. `parseSteps(raw)` is robust: strips `<think>…</think>`, pulls the first
   `[...]` JSON array, falls back to numbered/bulleted lines; trims, dedupes,
   drops empties.
5. `< 2` steps → null. Cap at `MAX_STEPS = 12`.
6. Any thrown error anywhere → caught → null.

Returns fragments; never throws. (A future enhancement can chain a second
backend as a refiner; MVP uses the single resolved client.)

### 3c. Intake async entrypoint — `src/lib/intake/classify.ts`

- Extract the inline item-mapping into an exported pure helper
  `proposedItemsFromFragments(fragments, title?)` (used by BOTH paths).
- Add `classifyIntakeAsync(input, deps?): Promise<IntakeResult>`:
  1. `base = classifyIntake(input)` (sync, deterministic — unchanged).
  2. If `base.kind !== "work_package_candidate"` → return base (small/normal
     tasks never touch a model — cost + latency stay zero on the common path).
  3. Decide if enabled: explicit `deps` (or a test-injected dep) → yes; otherwise
     `isFeatureEnabled("taskIntakeModelDecomposition")`. Default flag = **off**.
  4. `fragments = await decompose(input, deps)`. Null → return base (deterministic
     fallback).
  5. `items = proposedItemsFromFragments(fragments, base.packageCandidate.title)`;
     `< 2` → return base.
  6. Return base with `packageCandidate.items` replaced, `reasons` += "model-
     advised decomposition", risk rolled up from items.
- A module-level `_setIntakeDecomposeDepsForTests(deps | null)` mirrors
  youtube-summary's test-dep injection so the server tests stay deterministic.

### 3d. Feature flag

Add to `KNOWN_FEATURES` in `src/lib/config/features.ts`:
`{ key: "taskIntakeModelDecomposition", label: "Smarter task breakdown", description: "Use a local model (or your keyless ChatGPT/Codex CLI session) to split broad requests into cleaner work-package steps. HiveMatrix still decides risk, gating, and concurrency." }`
Default off — opt-in keeps cost predictable and existing gates network-free.

### 3e. Wiring

`server.ts` POST /tasks and `/work-packages/intake/preview` +
`/tasks/intake/preview` call `classifyIntakeAsync` instead of `classifyIntake`.
With the flag off and no injected deps, behavior is byte-identical to today.

### 3f. Item execution is backend-agnostic (the firm "all three" requirement)

The "works in chatgpt / codex / qwen" requirement is about EXECUTION, not just
decomposition. `createTaskFromItem` already produces a normal task with
`executor: "agent"` and `agentType: "auto"`, so the existing model router picks
whichever keyless backend is configured (codex/ChatGPT CLI session or local
Qwen) at run time. This slice must NOT hardcode a backend on package items — it
leaves routing to the established auto path. A test asserts a converted item is
`executor:"agent"` / `agentType:"auto"` (no pinned model), so any of the three
backends can execute it.

## 4. Backend / connectivity matrix (decomposition)

| mode | local Qwen (HTTP) | codex/ChatGPT CLI | result |
|------|-------------------|-------------------|--------|
| offline | — | — | null → deterministic split |
| local-only | yes (if profile) | — | Qwen fragments |
| cloud-ok | yes (if profile) | yes (if `codex` found) | Qwen, else codex CLI |

No path reads or sends a cloud API key. Claude/Anthropic is never invoked.

## 5. Testing (TDD)

- `chat-client.test.ts`: localChatComplete parses choices content via injected
  fetch + falls through to /v1 on 404; cliChatComplete parses an injected CLI
  runner's stdout; non-2xx / non-zero exit throws. No real key, network, or
  process.
- `decompose.test.ts`: client returns fragments; offline → null; no client →
  null; malformed JSON → null; `<2` → null; `<think>` stripped; caps at MAX_STEPS.
- `classify-async.test.ts` (or in classify.test.ts): with injected fake →
  packageCandidate.items come from model fragments + reason added; a release
  fragment is still stamped `hold`/high (policy wins); model returning `<2` →
  deterministic fallback; non-broad prompt → model never called.
- `features.test.ts`: the new flag parses + toggles.
- `server.test.ts`: with `_setIntakeDecomposeDepsForTests` set, POST /tasks broad
  prompt yields package items from the fake model; with deps cleared (flag off),
  behavior is the deterministic baseline (no network).

## 6. Risks / mitigations

- **Cost/latency on every task** → mitigated: model only runs when already
  classified broad AND the flag is on; small tasks never call a model.
- **Non-determinism** → the model only affects fragment text; all safety policy
  is deterministic and re-applied. Tests use injected fakes; the live path has a
  rule-first fallback on any failure.
- **Network in CI** → flag defaults off and deps are injected in tests; no real
  HTTP in `npm test`.
- **Prompt-injection via task text** → the model output is treated as untrusted
  fragments and re-scrubbed by `proposedItemsFromFragments` (secret scrub on
  persist already exists in the store); the model cannot escalate risk/gating.

## 7. Out of scope

- Refactoring existing eval/health completion call sites onto the new client.
- Model-suggested explicit cross-item dependencies (we keep deterministic
  release-gating + positional ordering).
- Streaming, tool-use, or multi-turn planning.
