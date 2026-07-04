# Loop Guard Smoke Gate Design

## Problem

A local/OpenAI-compatible coding task can be forced out of tool use by the
generic-agent loop guard after repeated identical tool calls. That path currently
lets the run finish without the deterministic code smoke gate. If the model's
final prose claims success, HiveMatrix receives exit code 0 and moves the task to
review, even when the generated code crashes immediately.

The observed failure was `/Users/irvcassio/Documents/inbox/snake_game.py`:

- `python3 snake_game.py` exits 1 on `import pygame.freetype` under Python 3.14.
- `scripts/hive-verify-smoke.py` catches the same runtime failure.
- The prior reliability work repaired `snake.py`, but this generated artifact
  was `snake_game.py`.

## Goal

Make the generic local-agent path truthful: loop-guard termination must not skip
runtime verification, and code that still fails the smoke gate must produce a
failed task rather than a completed/review task.

## Approach

1. Keep the loop guard: after repeated identical tool calls, force one text-only
   synthesis turn so the model stops looping.
2. Always run the completion smoke gate for touched runnable files, including
   after a loop-guarded text-only turn.
3. If smoke verification fails, feed the crash back to the model and re-enable
   tools so it can repair the code.
4. If the bounded repair attempts are exhausted, return exit code 1 with the
   smoke report in the result. `agent-manager` already maps nonzero exits to
   failed tasks.
5. Add focused unit coverage for the new decision points.

## Verification

- Focused generic-agent tests prove loop-guarded final turns still require smoke
  verification and exhausted smoke failures return nonzero.
- Existing `code-smoke` tests continue to prove the harness catches real runtime
  crashes.
- Full gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
