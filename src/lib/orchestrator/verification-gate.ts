/**
 * Code verification gate — a system-prompt layer injected into every spawned
 * agent so generated code (any language) is executed and static-checked before
 * the agent reports completion.
 *
 * Why: heavily-quantized local models periodically hallucinate API names
 * (e.g. `curses.nap` instead of `curses.napms`); prompting alone cannot
 * prevent that, but a mandatory catch-and-correct pass turns "silently ships
 * broken code" into "catches it and fixes it". mypy is called out explicitly
 * because plain linters miss hallucinated attrs on C-extension stdlib modules.
 */
export function verificationGatePrompt(): string {
  return `--- Code Verification Gate ---
A task that created or modified code, in ANY language, is not complete until you verified the code:
1. Actually run it. Execute the program, its tests, or the project's build/check (pytest, npm test, tsc --noEmit, go build, cargo check...). Compiling or importing is NOT enough — it does not exercise the code and misses runtime crashes. For a terminal/TUI/curses or otherwise interactive program, you MUST run it in a real terminal, not just import it: a curses program can pass \`py_compile\`, \`import\`, AND \`mypy\` while still crashing on the first frame with \`_curses.error: addwstr() returned ERR\` (e.g. writing to the bottom-right cell). For Python, the fast way to catch this is the bundled headless smoke-runner: \`python3 scripts/hive-verify-smoke.py <changed .py files>\` — it drives the program in a pseudo-terminal and reports any crash. (This same check is also run automatically after you finish; code that crashes will be sent back to you to fix, so verify it yourself first.)
2. Static-check it. Python: run \`ruff check --select F <changed files>\` first — it catches undefined names and forgotten imports (e.g. using \`os.path\` with no \`import os\`) that \`mypy\` and \`py_compile\` silently pass; fix them, never suppress them. Then optionally \`python3 -m mypy --ignore-missing-imports <changed files>\` for type errors. TypeScript: \`tsc --noEmit\`. Plain JS: \`node --check\`. Otherwise use the project's own linter if configured.
3. Missing dependencies or tools are yours to resolve: install them (pip install / npm install / brew install) rather than failing the task or silently switching to a different approach. Use the \`python3\` on PATH, not /usr/bin/python3.
4. If verification fails, fix the code and re-verify. Only report completion after a clean pass, and state in your final summary exactly which verification commands you ran and their results.`;
}
