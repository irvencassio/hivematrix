# Browser Lane is Claude-native — do not reintroduce Codex

**Decided 2026-07-22 (HiveMatrix 0.1.252). This is a closed decision.**

Browser Lane has **one engine**: Claude drives a real desktop browser through
Desktop Lane. There is no Codex backing, no OpenAI dependency, and no auth to
configure. If you are debugging Browser Lane and find yourself reaching for
`codex login` or an `OPENAI_API_KEY`, stop — you are on a path that was
deliberately deleted.

## Why Codex was removed

Browser Lane used to prefer a `codex_computer_use` backing and treat
Claude-driving-the-desktop as a *fallback*. That primary path was unreachable on
this machine, permanently:

- The Computer Use model (`gpt-5.4-computer-use`) requires an **OpenAI API-key**
  Codex account. On a ChatGPT-**subscription** login it returns
  `HTTP 400 — not supported when using Codex with a ChatGPT account`.
- This machine's `~/.codex/auth.json` is `auth_mode: "chatgpt"` with
  `OPENAI_API_KEY: null` — i.e. subscription auth. The gate was
  `codexUsable = (authMode === "api-key")`, so it was **always false**.

So the Codex branch never executed. Worse, its existence was actively harmful:

- Every Browser Lane failure surfaced as *"No usable Codex auth was found (run
  `codex login`)"* — pointing at an auth problem that did not exist and could not
  be fixed by logging in.
- The refusal path told operators to enable a "fallback", implying the real
  engine was something else that was merely unavailable.
- It masked the actual bug: the fallback path told agents to use `desktop_action`,
  a tool task agents did not have until 0.1.250. Two dead paths stacked on each
  other, and the error text blamed a third thing.

## What the engine actually is

Claude runs as the task agent and drives the browser with the **`desktop_action`**
lane tool (wired into task agents in 0.1.250 — before that, task agents had only
`send_imessage`/`send_email`/`draft_email`, which is why the fallback silently did
nothing). Preferred strategy, most reliable first:

1. `desktop.script.run` (AppleScript/JXA) to open and navigate
2. `desktop.ax.query` / `desktop.ax.act` on the Accessibility tree
3. `desktop.click` / `desktop.type` by coordinate — last resort
4. `desktop.capture` to verify state

`search` and `read` modes do not need any of this — they return rendered page
content directly and are the right choice for anything without login state or
multi-step interaction.

## The only real precondition

`resolveBrowserBeeBacking({ desktopBeeAvailable })`. That is the whole decision:
if Desktop Lane (the Swift helper) is up, the job dispatches; if not, it refuses
with that reason. No auth checks, no opt-in flag.

Note `browserLane.desktopFallback` is now **vestigial for dispatch**. It is still
read for status surfaces, but it no longer gates anything — gating the only engine
behind an opt-in named "fallback" would just make Browser Lane silently dead.

## Naming you will trip over

The stored backing value is still `desktop_fallback`, and
`BROWSERBEE_BACKINGS` still *accepts* `codex_computer_use`. Both are
**historical, not aspirational**:

- `desktop_fallback` is the only value anything produces. It is not a fallback to
  anything anymore; renaming it would invalidate envelopes already on disk.
- `codex_computer_use` is retained **read-only**, purely so job envelopes written
  before the cutover still parse. `resolveBrowserBeeBacking` cannot return it and
  nothing writes it.

Do not "clean these up" by deleting the enum value — that breaks historical task
records. Do not treat their presence as evidence Codex is supported.

## Codex elsewhere in HiveMatrix

This decision is **scoped to Browser Lane**. Codex remains a general frontier
provider (usage tracking, provider alternation, task execution) and was not
touched. Removing Codex from Browser Lane is not a statement about Codex overall.

## If you genuinely want Computer Use back

It would require an OpenAI API-key account (a paid API key, separate from the
ChatGPT subscription). That is a purchasing decision for the operator, not a code
fix — and it was explicitly declined on 2026-07-22 in favour of the Claude path,
which by then already worked. Ask before rebuilding it.
