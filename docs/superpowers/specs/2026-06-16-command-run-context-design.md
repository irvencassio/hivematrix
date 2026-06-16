# Command Run Context Design

## Problem

The Commands panel launches local Claude slash commands but reads the hidden New Task project path field (`t_path`). When that field remains `/tmp` or another non-home path, `/commands/run` rejects the request before a task is created. The UI then looks like the command did nothing.

## Decision

Commands get their own visible working-directory control:

- A project selector populated from the existing `/projects` discovery response.
- A path input (`commandPath`) that can use `$HOME`, `~`, or an absolute path under the current user home.
- The command launch payload reads `commandPath`, never the New Task-only `t_path`.

Local command discovery remains Claude-profile scoped. These files live under `$HOME/.claude*/commands` and `$HOME/.claude*/skills`; Codex/ChatGPT and Qwen run through the normal task model selector, not through this local Claude slash-command catalog.

## Non-Goals

- Do not hard-code `/Users/irvcassio` or any project path.
- Do not infer command working directories by parsing command markdown bodies.
- Do not route Claude local slash commands through Codex/Qwen unless a separate provider-compatible command catalog is introduced later.
