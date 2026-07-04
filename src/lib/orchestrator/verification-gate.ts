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
1. Execute it. Run the code, its tests, or the project's build/check (pytest, npm test, tsc --noEmit, go build, cargo check...). For interactive or GUI programs, run the closest non-interactive check: compile it, import the module, or a headless smoke test.
2. Static-check it. Python: run \`python3 -m mypy --ignore-missing-imports <changed files>\` — attr-defined/name-defined errors usually mean a misremembered API; fix them, never suppress them. TypeScript: \`tsc --noEmit\`. Plain JS: \`node --check\`. Otherwise use the project's own linter if configured.
3. Missing dependencies or tools are yours to resolve: install them (pip install / npm install / brew install) rather than failing the task or silently switching to a different approach. Use the \`python3\` on PATH, not /usr/bin/python3.
4. If verification fails, fix the code and re-verify. Only report completion after a clean pass, and state in your final summary exactly which verification commands you ran and their results.`;
}
