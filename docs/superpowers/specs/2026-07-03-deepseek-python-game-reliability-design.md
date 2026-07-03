# DeepSeek Python Game Reliability Design

## Problem

DeepSeek created a Python snake game with `pygame` on Python 3.14.6. `pygame` installed from source but its font/native module was incomplete, so the task first appeared complete and then got stuck probing `pygame.font` internals.

## Goal

Make local OpenAI-compatible coding agents, including DeepSeek, choose a robust implementation path for small Python game tasks and avoid declaring success after a failing verification command.

## Approach

1. Add local-agent system prompt guidance for deliverable reliability.
2. Use the `antirez/ds4` agent posture: DeepSeek/DwarfStar local agents are purpose-built, narrow execution paths. Upstream ds4's native agent keeps inference inside the agent, represents sessions with on-disk KV cache, and designs tools/system prompt vertically for DeepSeek V4 Flash/PRO.
3. Even when HiveMatrix reaches Dwarf Star through its OpenAI-compatible server bridge, preserve that vertical DeepSeek discipline in the prompt instead of treating the run like a generic package sandbox.
4. Call out simple Python games specifically: prefer standard-library `tkinter` or terminal implementations unless a third-party GUI dependency is already known to work.
5. Tell the agent to pivot after dependency/native-extension failures rather than repeatedly probing optional package internals.
6. Require the final verification command to pass before the agent summarizes completion.

## Verification

- Add a focused unit test around `buildMessages()` proving the local developer prompt contains the Python game reliability guidance.
- Repair the current generated `snake.py` so it runs without `pygame.font`.
- Ensure the repaired task does not create or depend on a venv.
