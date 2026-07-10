import test from "node:test";
import assert from "node:assert/strict";
import { detectSkillIntent, buildSkillVoiceReply } from "./skill-intent";
import type { SkillIndexEntry } from "@/lib/skills/contracts";

function e(p: Partial<SkillIndexEntry>): SkillIndexEntry {
  return { name: "n", description: "", tags: [], useCount: 0, compat: ["all"], hasInput: false, trusted: true, kind: "instruction", roles: [], ...p };
}

test("detectSkillIntent: list phrasings", () => {
  assert.equal(detectSkillIntent("what skills do I have").kind, "list");
  assert.equal(detectSkillIntent("list my skills").kind, "list");
  assert.equal(detectSkillIntent("which skills are installed").kind, "list");
});

test("detectSkillIntent: search captures the query", () => {
  assert.deepEqual(detectSkillIntent("do I have a skill for kubernetes"), { kind: "search", query: "kubernetes" });
  assert.deepEqual(detectSkillIntent("find a skill to summarize a PR"), { kind: "search", query: "summarize a pr" });
});

test("detectSkillIntent: use captures the name", () => {
  assert.deepEqual(detectSkillIntent("use the deploy release skill"), { kind: "use", name: "deploy release" });
  assert.deepEqual(detectSkillIntent("run the skill release notes"), { kind: "use", name: "release notes" });
});

test("detectSkillIntent: unrelated → none", () => {
  assert.equal(detectSkillIntent("what's the weather today").kind, "none");
});

const lib: SkillIndexEntry[] = [
  e({ name: "deploy-release", description: "ship a release", useCount: 12 }),
  e({ name: "summarize-pr", description: "summarize a pull request", useCount: 5 }),
  e({ name: "release-notes", description: "draft notes", useCount: 1 }),
];

test("buildSkillVoiceReply: list speaks count + most-used (hyphens → spaces)", () => {
  const r = buildSkillVoiceReply({ kind: "list" }, lib);
  assert.equal(r.handled, true);
  assert.match(r.reply, /You have 3 skills/);
  assert.match(r.reply, /deploy release/); // spoken, not hyphenated
});

test("buildSkillVoiceReply: search returns matches or a not-found line", () => {
  assert.match(buildSkillVoiceReply({ kind: "search", query: "release" }, lib).reply, /I found .* for release/);
  assert.match(buildSkillVoiceReply({ kind: "search", query: "kubernetes" }, lib).reply, /couldn't find a skill for kubernetes/);
});

test("buildSkillVoiceReply: use resolves to the best match + action", () => {
  const r = buildSkillVoiceReply({ kind: "use", name: "deploy release" }, lib);
  assert.equal(r.action, "use");
  assert.equal(r.name, "deploy-release");
  assert.match(r.reply, /using the deploy release skill/);
});

test("buildSkillVoiceReply: none → not handled (defer to the voice LLM)", () => {
  assert.equal(buildSkillVoiceReply({ kind: "none" }, lib).handled, false);
});
