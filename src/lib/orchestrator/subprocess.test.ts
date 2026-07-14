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

test("the top-level CLI task is told to delegate build work to Sonnet subagents", () => {
  // The delegation prompt is appended inside spawnAgent (not buildClaudeSpawnArgs,
  // which has no access to agent-type/model context), so this is a source-level
  // regression guard rather than a spawn-mock test, matching the coo-roster test
  // above.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "subprocess.ts"), "utf8");
  assert.match(src, /You are the top-level agent on Opus\./);
  assert.match(src, /delegate construction and implementation work to Sonnet subagents via the Agent tool/);
  assert.match(src, /args\.push\("--append-system-prompt", DELEGATION_SYSTEM_PROMPT\)/);
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
  const effortIndex = args.indexOf("--effort");
  assert.notEqual(effortIndex, -1);
  assert.equal(args[effortIndex + 1], "max");
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
