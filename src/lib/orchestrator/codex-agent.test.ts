import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderAttachmentBlock } from "@/lib/tasks/attachments";
import { buildCodexPrompt, buildCodexExecArgs } from "./codex-agent";

// Isolate the DB under a temp HOME before anything calls getDb(). buildCodexPrompt()
// transitively reaches isChannelEnabled() in the mailbee/messagebee stores (via
// isMailLaneEnabled/isMessageLaneEnabled), so every test below that calls it needs
// this in place first — see docs/superpowers/specs/2026-07-15-goals-data-loss-design.md
// §2.1 (this file was one of the transitive-caller gaps the prod-DB guard surfaced).
const home = mkdtempSync(join(tmpdir(), "codex-agent-test-"));
mkdirSync(join(home, ".hivematrix"), { recursive: true });
process.env.HOME = home;

test.after(() => {
  rmSync(home, { recursive: true, force: true });
});

test("buildCodexPrompt prepends the outbound routing block and keeps the task", () => {
  const prompt = buildCodexPrompt("Email Jane the Q3 numbers.", { mailLaneEnabled: true, messageLaneEnabled: true });
  // routing guidance present
  assert.match(prompt, /\/mailbee\/send/);
  assert.match(prompt, /\/messagebee\/send/);
  assert.match(prompt, /do NOT send via osascript/i);
  // the actual task is preserved, after the delimiter
  assert.match(prompt, /--- Your task ---\nEmail Jane the Q3 numbers\./);
  // task comes after the guidance, not before
  assert.ok(prompt.indexOf("/mailbee/send") < prompt.indexOf("Email Jane"));
});

test("the prompt starts with '--' — so codex exec MUST get it after a `--` separator", () => {
  // Regression guard for the "unexpected argument '--- Outbound Channels …'"
  // failure: the prompt begins with dashes, which clap rejects as a flag.
  const prompt = buildCodexPrompt("do a thing", { mailLaneEnabled: true });
  assert.ok(prompt.startsWith("--"), "prompt starts with dashes (the hazard)");
});

test("buildCodexExecArgs places the prompt after a `--` end-of-options separator", () => {
  const prompt = buildCodexPrompt("ship it", { mailLaneEnabled: true });
  const args = buildCodexExecArgs({ codexModel: "gpt-5.5-codex", projectPath: "/tmp/p", prompt });
  // The last two argv entries are exactly: "--", <prompt>
  assert.equal(args[args.length - 2], "--", "`--` precedes the prompt");
  assert.equal(args[args.length - 1], prompt, "prompt is the final positional");
  // and there's exactly one `--` (we didn't accidentally add two)
  assert.equal(args.filter((a) => a === "--").length, 1);
  // sanity: model + project are present
  assert.ok(args.includes("gpt-5.5-codex"));
  assert.ok(args.includes("/tmp/p"));
});

test("buildCodexExecArgs adds low reasoning effort only in fast mode", () => {
  const slow = buildCodexExecArgs({ codexModel: "m", projectPath: "/p", prompt: "x" });
  const fast = buildCodexExecArgs({ codexModel: "m", projectPath: "/p", prompt: "x", fastMode: true });
  assert.ok(!slow.some((a) => a.includes("model_reasoning_effort")));
  assert.ok(fast.some((a) => a.includes('model_reasoning_effort="low"')));
});

test("buildCodexPrompt keeps formatted attachment paths in the task section", () => {
  const attachmentBlock = renderAttachmentBlock([
    { filename: "shot.png", path: "/Users/me/.hivematrix/uploads/id-shot.png" },
  ]);
  const prompt = buildCodexPrompt(`Please inspect this image.\n\n${attachmentBlock}`, { mailLaneEnabled: true });

  assert.ok(prompt.includes(attachmentBlock));
  assert.match(prompt, /--- Your task ---[\s\S]*path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.ok(prompt.indexOf("--- Your task ---") < prompt.indexOf("id-shot.png"));
});

test("buildCodexPrompt omits Mail Lane guidance when Mail Lane is disabled", () => {
  const prompt = buildCodexPrompt("Summarize the dashboard.", { mailLaneEnabled: false, messageLaneEnabled: true });
  assert.match(prompt, /Mail Lane is disabled/i);
  assert.match(prompt, /\/messagebee\/send/);
  assert.doesNotMatch(prompt, /\/mailbee\/send/);
  assert.doesNotMatch(prompt, /\/mailbee\/draft/);
  assert.doesNotMatch(prompt, /Reading & managing email/);
  assert.match(prompt, /--- Your task ---\nSummarize the dashboard\./);
});

test("buildCodexPrompt omits Message Lane guidance when Message Lane is disabled", () => {
  const prompt = buildCodexPrompt("Summarize the dashboard.", { messageLaneEnabled: false });
  assert.match(prompt, /Message Lane is disabled/i);
  assert.doesNotMatch(prompt, /\/messagebee\/send/);
  assert.doesNotMatch(prompt, /Send an SMS\/iMessage/);
  assert.match(prompt, /--- Your task ---\nSummarize the dashboard\./);
});
