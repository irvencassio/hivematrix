# Command Options Picker — Design

> Superpowers brainstorming artifact. Approved by operator 2026-07-05 (Tier 1 + Tier 2; assemble an argument string).

## Problem

The console new-task box lets the operator run a catalog command (a local slash
command or folder skill) as a task. Its options/flags (`--release`,
`--verify-only`, `--marketing-version X.Y.Z`, …) are invisible: the box shows a
single free-text "Arguments" input with the command's `argument-hint` as a
greyed-out placeholder ([console.ts `_localCmdPanelHtml`](../../../src/daemon/console.ts)).
The operator has to already know the flags. They want to **see and pick** the
available options.

## Prior art (researched 2026-07-05)

- **Claude Code slash commands** (what our commands are): flags are NOT
  machine-readable; `argument-hint` is a UX-only string; the LLM parses
  `$ARGUMENTS`. So the only structured signal we already have is the hint string.
- **Fig / Amazon Q completion spec**: declarative `options[]` (name, description,
  args w/ enumerated suggestions, isRequired, exclusiveOn) rendered as a picker.
- **Discord application commands**: typed options with `choices[]` → dropdowns.
- **jdx/usage (KDL)**: define flags/args once → generate completions/help/docs.

Takeaway: adopt the Fig/Discord **normalized option model**, but source it from
(a) the `argument-hint` we already have, and (b) an optional richer frontmatter
block for commands we author — the jdx/usage "declare once" spirit.

## Model — `CommandOptionsSpec`

One normalized spec the renderer consumes, produced server-side (tested) and
serialized into the `/commands` (and `/skills`) entry.

```ts
type CommandOptionKind = "flag" | "value" | "choice" | "positional";
interface CommandOption {
  name: string;            // "--release" | "--marketing-version" | positional "pr-number"
  kind: CommandOptionKind;
  required: boolean;       // <positional> or a flag in a required exclusive group
  description?: string;    // Tier 2 only (hint parsing yields none)
  valuePlaceholder?: string; // kind=value: "X.Y.Z"
  choices?: string[];      // kind=choice: ["high","medium","low"]
  group?: string;          // exclusivity group id (radio) — flags only
}
interface CommandOptionsSpec {
  options: CommandOption[];     // flags/value/choice
  positionals: CommandOption[]; // ordered <required> [optional]
  source: "frontmatter" | "argument-hint" | "none";
}
```

## Tier 1 — parse `argument-hint` (zero re-authoring)

`parseArgumentHint(hint): CommandOptionsSpec`. Grammar over the conventional hint
syntax (respecting `<…>`, `[…]`, `|`):
- `--flag` → `flag`.
- `--flag X` / `--flag <x>` / `--flag=X` → `value` (placeholder = X / x).
- `--flag a|b|c` → `choice` (choices split on `|`).
- `<name>` → `positional` required; `[name]` → `positional` optional; `[--flag]` → optional `flag`.
- Top-level ` | ` between flags → one exclusivity `group`.
- Unparseable remainder is ignored (never throws) — the raw-args box remains.

## Tier 2 — `options:` frontmatter DSL (richer, for authored commands)

A human-readable, one-option-per-line block scalar (parseable by the existing
dependency-free `splitFrontmatter`, which folds `|` literals):

```yaml
argument-hint: --release | --verify-only | --build-only [--marketing-version X.Y.Z] [--skip-notarize]
options: |
  --verify-only              (mode) Prereqs + gates only; no build
  --build-only               (mode) Local signed build; no publish
  --release                  (mode) Full: build → notarize → publish
  --marketing-version=X.Y.Z  Set the marketing version (else auto patch-bump)
  --skip-notarize            Local dry run only (refused with --release)
```

Line grammar: `--flag[=<valueHint>|=a|b|c]  [(<group>)]  <description>`. Positional
lines: `<name>` / `[name]  <description>`. `parseOptionsFrontmatter(raw)` → spec
with `source: "frontmatter"`. When present it WINS over the hint (precise +
described); otherwise Tier 1 parses the hint; otherwise `source: "none"`.

`resolveCommandOptions(cmd)` centralizes that precedence.

## Wiring

- `LocalCommand` gains `options: CommandOptionsSpec`. `parseCommandFile` /
  `parseSkillManifest` compute it via `resolveCommandOptions` (reads the new
  `options` frontmatter key, else `argument-hint`). Additive — no API break.
- The `/commands` endpoint already serializes the `LocalCommand`; the spec rides along.

## Console rendering (assemble an argument string)

In `_localCmdPanelHtml`, when `c.options` has entries, render an **Options** block
above the raw input:
- exclusivity `group` flags → segmented "pick one" (radio semantics).
- independent `flag`s → toggle chips.
- `value` flags → toggle chip that reveals a text input (placeholder = valuePlaceholder).
- `choice` flags → toggle chip + a `<select>` of choices.
- `positionals` → labeled inputs (required ones marked).
- description shown as chip title/subtext.
Keep the existing free-text input as an **Advanced / raw args** fallback (always
wins if non-empty). On Run, `_assembleCmdArgs()` builds the string
(`--release --marketing-version 0.2.0`) from the controls and sends it as the same
`args` field to `/commands/run` — **no runner/back-end change** (backward compatible).

## Non-goals / risks

- No validation/execution of flags server-side (parity with Claude Code: UX only;
  the command/agent still interprets args). The picker is an assist, not a gate.
- Hint parsing is best-effort; anything it misses degrades to the raw-args box.
- Brain `{{param}}` skills keep their existing param inputs; this feature targets
  `LocalCommand` options. (A later pass can unify.)
