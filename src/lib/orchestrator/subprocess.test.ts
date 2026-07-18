import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { renderAttachmentBlock } from "@/lib/tasks/attachments";
import { buildClaudeSpawnArgs, isLocalEndpointModel } from "./subprocess";

test("Claude spawn args run like a direct interactive session: no allowlist, no turn cap, permissions skipped", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read", "Bash"],
    thinkingMode: "auto",
  });

  assert.equal(args.includes("--dangerously-skip-permissions"), true);
  assert.equal(args.includes("--allowedTools"), false);
  assert.equal(args.includes("--max-turns"), false);
  const outputFormatIndex = args.indexOf("--output-format");
  assert.notEqual(outputFormatIndex, -1);
  assert.equal(args[outputFormatIndex + 1], "stream-json");
});

test("Claude spawn args still carry a budget ceiling alongside --dangerously-skip-permissions", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    maxBudgetUsd: 10,
    thinkingMode: "auto",
  });

  assert.equal(args.includes("--dangerously-skip-permissions"), true);
  const budgetIndex = args.indexOf("--max-budget-usd");
  assert.notEqual(budgetIndex, -1);
  assert.equal(args[budgetIndex + 1], "10");
});

test("the coo agent profile's live-roster injection is wired into the Claude CLI path too, not just generic-agent.ts", () => {
  // spawnAgent shells out to a real Claude CLI process, so this is a
  // source-level regression guard rather than a full spawn-mock test (see
  // generic-agent.test.ts for the equivalent behavioral test against the
  // local/Qwen path, which exercises the identical getCoreAgentProfiles()
  // logic this mirrors). The bug this catches: coo's system prompt claims
  // "your available agent types are generated at prompt-assembly time" —
  // that claim must be backed by real code on EVERY path that can run a coo
  // task, or the CLI-routed COO would see a promise with nothing behind it.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "subprocess.ts"), "utf8");
  const region = src.slice(src.indexOf('agentType !== "auto"'), src.indexOf('agentType !== "auto"') + 1200);
  assert.match(region, /agentType === "coo"/, "the CLI path must special-case coo the same way generic-agent.ts does");
  assert.match(region, /getCoreAgentProfiles/, "must build the roster from the live core roster, not a hardcoded string");
  assert.match(region, /--- Available agent types \(create_task\) ---/, "same injected header the local-agent path uses");
});

test("the delegation directive is scoped to self-planning (broad) work only", () => {
  // The delegation prompt is appended inside spawnAgent (not buildClaudeSpawnArgs,
  // which has no access to agent-type/model context), so this is a source-level
  // regression guard rather than a spawn-mock test, matching the coo-roster test
  // above.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "subprocess.ts"), "utf8");
  assert.match(src, /You are the top-level agent for this task\./);
  assert.match(src, /delegate construction and implementation work to subagents via the Agent tool/);
  // Must stay model-agnostic: the router picks the top-level model, so a live
  // run was seen on `--model sonnet` while this prompt claimed to be Opus
  // delegating to "Sonnet subagents" — telling Sonnet to hand work to itself.
  // Scoped to the constant's VALUE: the surrounding comment names those tiers
  // deliberately (to record the bug), so a whole-file check would match itself.
  const promptStart = src.indexOf("const DELEGATION_SYSTEM_PROMPT =");
  assert.ok(promptStart !== -1, "delegation prompt constant should be locatable");
  const promptValue = src.slice(promptStart, src.indexOf(";", promptStart));
  assert.doesNotMatch(promptValue, /Opus/, "prompt must not name a model tier");
  assert.doesNotMatch(promptValue, /Sonnet/, "prompt must not name the subagent tier");
  // Regression: this used to be appended unconditionally, so a NARROW task was
  // also pushed to spawn subagents for work it could just do — extra round-trips
  // and indirection versus a direct `claude` session. It must now be gated on the
  // broad/self-planning path.
  const start = src.indexOf("Direct-session parity");
  const end = src.indexOf("Inject agent profile system prompt");
  assert.ok(start !== -1 && end > start, "delegation region should be locatable");
  const region = src.slice(start, end);
  assert.match(region, /if \(workflow === "work"\)/, "delegation must be gated on the self-planning workflow");
  assert.match(region, /args\.push\("--append-system-prompt", DELEGATION_SYSTEM_PROMPT\)/);
});

test("Claude spawn args omit max-budget flag when budget is uncapped", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read", "Bash"],
    maxBudgetUsd: 0,
    thinkingMode: "auto",
  });

  assert.equal(args.includes("--max-budget-usd"), false);
  assert.equal(args.includes("0"), false);
});

test("Claude spawn args OMIT --effort under 'auto' so the CLI picks its own depth", () => {
  // Regression: "auto" used to collapse to "max", so every task — including
  // trivial ones — ran at maximum reasoning. Omitting the flag reproduces a
  // direct `claude` session, which is the behavior that felt fast.
  for (const mode of ["auto", "", undefined]) {
    const args = buildClaudeSpawnArgs({
      prompt: "Do the task",
      maxBudgetUsd: 0,
      thinkingMode: mode,
    });
    assert.equal(args.includes("--effort"), false, `thinkingMode=${JSON.stringify(mode)} must not pin effort`);
    assert.equal(args.includes("auto"), false, "'auto' must never be passed as a CLI effort value");
  }
});

test("Claude spawn args still pin an explicitly chosen effort tier", () => {
  for (const tier of ["low", "medium", "high", "xhigh", "max"]) {
    const args = buildClaudeSpawnArgs({ prompt: "Do it", maxBudgetUsd: 0, thinkingMode: tier });
    const i = args.indexOf("--effort");
    assert.notEqual(i, -1, `${tier} should pass --effort`);
    assert.equal(args[i + 1], tier);
  }
});

test("Claude spawn args preserve positive explicit budget ceilings", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read"],
    maxBudgetUsd: 7.5,
    thinkingMode: "high",
  });

  const budgetIndex = args.indexOf("--max-budget-usd");
  assert.notEqual(budgetIndex, -1);
  assert.equal(args[budgetIndex + 1], "7.5");
  const effortIndex = args.indexOf("--effort");
  assert.notEqual(effortIndex, -1);
  assert.equal(args[effortIndex + 1], "high");
});

test("Claude spawn args add a session fast-mode override when enabled", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read"],
    fastMode: true,
  });

  const settingsIndex = args.indexOf("--settings");
  assert.notEqual(settingsIndex, -1);
  assert.equal(args[settingsIndex + 1], '{"fastMode":true}');
});

test("Claude spawn args omit fast-mode override when disabled", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read"],
    fastMode: false,
  });

  assert.equal(args.includes("--settings"), false);
});

test("local endpoint override applies to local models but never Claude aliases", () => {
  // Local models (however named) get ANTHROPIC_BASE_URL pointed at the provider.
  assert.equal(isLocalEndpointModel("qwen/qwen3.6-27b"), true);
  // Claude full ids and bare CLI aliases must go to the real API — routing
  // "sonnet" at the local server made the CLI report the model as missing.
  assert.equal(isLocalEndpointModel("claude-sonnet-5"), false);
  assert.equal(isLocalEndpointModel("sonnet"), false);
  assert.equal(isLocalEndpointModel("opus"), false);
  assert.equal(isLocalEndpointModel("haiku"), false);
  assert.equal(isLocalEndpointModel(undefined), false);
});

test("Claude prompt args preserve formatted attachment paths", () => {
  const attachmentBlock = renderAttachmentBlock([
    { filename: "shot.png", path: "/Users/me/.hivematrix/uploads/id-shot.png" },
  ]);
  const prompt = `Please inspect this image.\n\n${attachmentBlock}`;
  const args = buildClaudeSpawnArgs({ prompt, tools: ["Read"], thinkingMode: "auto" });

  const promptIndex = args.indexOf("-p");
  assert.notEqual(promptIndex, -1);
  assert.ok(args[promptIndex + 1].includes(attachmentBlock));
  assert.match(args[promptIndex + 1], /path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.match(args[promptIndex + 1], /Use the absolute path above/);
});

test("spawnAgent passes the RAW thinkingMode to the effort flag, not the resolved one", () => {
  // Regression caught in production 2026-07-18: buildClaudeSpawnArgs correctly
  // omits --effort for "auto", but spawnAgent was handing it
  // `effectiveThinkingMode` — resolveThinkingMode's output, which collapses
  // "auto" to "max". So a task stored with thinkingMode="auto" still launched
  // with `--effort max`, silently defeating the adaptive default at the ONLY
  // call site that matters. The unit tests above passed the whole time because
  // they call buildClaudeSpawnArgs directly.
  //
  // effectiveThinkingMode remains correct for the ultrathink PREFIX decision;
  // it is wrong for the effort FLAG.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "subprocess.ts"), "utf8");
  const start = src.indexOf("const args = buildClaudeSpawnArgs({");
  assert.ok(start !== -1, "spawn args construction should be locatable");
  const call = src.slice(start, start + 600);
  assert.doesNotMatch(call, /thinkingMode:\s*effectiveThinkingMode/, "must not pass the auto->max resolved value");
  assert.match(call, /^\s*thinkingMode,\s*$/m, "must pass the raw thinkingMode through");
  // The ultrathink prefix still uses the resolved value.
  assert.match(src, /effectiveThinkingMode === "ultrathink"/);
});
