import test from "node:test";
import assert from "node:assert/strict";
import { SKILL_HARNESSES, skillSlug, skillFilename, renderSkillFile, parseSkillFile, formatSkillIndex, skillRunsOn, skillHasInput, applySkillInput, skillEnabledByProviders, skillAppliesToRole, type Skill } from "./contracts";

test("SKILL_HARNESSES is exactly claude + codex — qwen-code was retired as a skill-export harness", () => {
  assert.deepEqual(SKILL_HARNESSES, ["claude", "codex"]);
});

function skill(over: Partial<Skill> = {}): Skill {
  return {
    name: over.name ?? "deploy-release",
    description: over.description ?? "How to cut a release",
    tags: over.tags ?? ["ops", "release"],
    body: over.body ?? "When releasing:\n1. bump version\n2. tag\n3. push",
    source: over.source ?? "directive:run9",
    createdAt: over.createdAt ?? "2026-06-14T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-06-14T00:00:00.000Z",
    revisions: over.revisions ?? 1,
    useCount: over.useCount ?? 0,
    failures: over.failures ?? 0,
    lastUsedAt: over.lastUsedAt ?? "",
    compat: over.compat ?? ["all"],
    trusted: over.trusted ?? true,
    probation: over.probation ?? false,
    kind: over.kind ?? "instruction",
    interpreter: over.interpreter ?? "bash",
    roles: over.roles ?? [],
    tool: over.tool,
  };
}

test("skillSlug + skillFilename are safe and stable", () => {
  assert.equal(skillSlug("Deploy a Release!! v2"), "deploy-a-release-v2");
  assert.equal(skillFilename("Deploy a Release"), "deploy-a-release.md");
});

test("renderSkillFile → parseSkillFile round-trips (incl. useCount)", () => {
  const s = skill({ useCount: 4, lastUsedAt: "2026-06-14T01:00:00.000Z", revisions: 2 });
  const parsed = parseSkillFile(renderSkillFile(s));
  assert.ok(parsed);
  assert.equal(parsed!.name, s.name);
  assert.equal(parsed!.description, s.description);
  assert.deepEqual(parsed!.tags, s.tags);
  assert.equal(parsed!.body, s.body);
  assert.equal(parsed!.source, s.source);
  assert.equal(parsed!.revisions, 2);
  assert.equal(parsed!.useCount, 4);
  assert.equal(parsed!.lastUsedAt, "2026-06-14T01:00:00.000Z");
});

test("failures + probation round-trip when non-default", () => {
  const s = skill({ failures: 2, probation: true });
  const parsed = parseSkillFile(renderSkillFile(s));
  assert.ok(parsed);
  assert.equal(parsed!.failures, 2);
  assert.equal(parsed!.probation, true);
});

test("failures + probation are omitted from rendered frontmatter at default values, and parse back to 0/false", () => {
  const s = skill({ failures: 0, probation: false });
  const rendered = renderSkillFile(s);
  assert.doesNotMatch(rendered, /^failures:/m);
  assert.doesNotMatch(rendered, /^probation:/m);
  const parsed = parseSkillFile(rendered)!;
  assert.equal(parsed.failures, 0);
  assert.equal(parsed.probation, false);
});

test("compat round-trips and skillRunsOn gates by harness", () => {
  const s = skill({ compat: ["claude"] });
  const parsed = parseSkillFile(renderSkillFile(s))!;
  assert.deepEqual(parsed.compat, ["claude"]);
  assert.equal(skillRunsOn(parsed.compat, "claude"), true);
  assert.equal(skillRunsOn(parsed.compat, "codex"), false);
  assert.equal(skillRunsOn(["all"], "codex"), true);
  assert.equal(skillRunsOn([], "codex"), true); // empty = any
});

test("skillEnabledByProviders: all/[] always eligible regardless of enablement", () => {
  assert.equal(skillEnabledByProviders([], []), true);
  assert.equal(skillEnabledByProviders(["all"], []), true);
});

test("roles is absent from rendered frontmatter when empty, and parses back to [] — proving backward compat", () => {
  const s = skill(); // no roles set
  const rendered = renderSkillFile(s);
  assert.doesNotMatch(rendered, /^roles:/m);
  const parsed = parseSkillFile(rendered)!;
  assert.deepEqual(parsed.roles, []);
  assert.equal(skillAppliesToRole(parsed.roles, "qa"), true);
  assert.equal(skillAppliesToRole(parsed.roles, "founder"), true);
});

test("tool is absent from rendered frontmatter when falsy, and parses back to false — proving backward compat", () => {
  const s = skill(); // no tool set
  const rendered = renderSkillFile(s);
  assert.doesNotMatch(rendered, /^tool:/m);
  const parsed = parseSkillFile(rendered)!;
  assert.equal(parsed.tool, false);
});

test("a skill tagged tool: true round-trips through render/parse", () => {
  const s = skill({ tool: true });
  const rendered = renderSkillFile(s);
  assert.match(rendered, /^tool: true$/m);
  const parsed = parseSkillFile(rendered)!;
  assert.equal(parsed.tool, true);
});

test("a hand-tagged roles round-trips and gates skillAppliesToRole to just that role", () => {
  const s = skill({ roles: ["qa"] });
  const parsed = parseSkillFile(renderSkillFile(s))!;
  assert.deepEqual(parsed.roles, ["qa"]);
  assert.equal(skillAppliesToRole(parsed.roles, "qa"), true);
  assert.equal(skillAppliesToRole(parsed.roles, "founder"), false);
});

test("skillEnabledByProviders: a two-provider skill survives while either is enabled", () => {
  assert.equal(skillEnabledByProviders(["claude", "codex"], ["claude"]), true);
  assert.equal(skillEnabledByProviders(["claude", "codex"], ["codex"]), true);
  assert.equal(skillEnabledByProviders(["claude", "codex"], []), false);
});

test("skillEnabledByProviders: a single-provider skill disappears when that provider is off", () => {
  assert.equal(skillEnabledByProviders(["codex"], ["claude"]), false);
  assert.equal(skillEnabledByProviders(["codex"], ["codex"]), true);
});

test("a skill with no compat frontmatter defaults to all harnesses", () => {
  const parsed = parseSkillFile("---\nname: x\ndescription: d\n---\nbody")!;
  assert.deepEqual(parsed.compat, ["all"]);
});

test("skillHasInput + applySkillInput handle the {{input}} slot", () => {
  assert.equal(skillHasInput("do {{input}} now"), true);
  assert.equal(skillHasInput("no slot here"), false);
  assert.equal(applySkillInput("summarize {{input}}", "this article"), "summarize this article");
  assert.match(applySkillInput("a fixed recipe", "extra context"), /--- Input ---\nextra context/);
});

test("formatSkillIndex shows use counts for proven skills", () => {
  const idx = formatSkillIndex([{ name: "a", description: "do a", tags: [], useCount: 3, compat: ["all"], hasInput: false, trusted: true, kind: "instruction", roles: [] }, { name: "b", description: "do b", tags: [], useCount: 0, compat: ["all"], hasInput: false, trusted: true, kind: "instruction", roles: [] }]);
  assert.match(idx, /- a \(used 3×\): do a/);
  assert.match(idx, /- b: do b/);
});

test("parseSkillFile rejects malformed content", () => {
  assert.equal(parseSkillFile("no frontmatter here"), null);
  assert.equal(parseSkillFile("---\ndescription: missing name\n---\nbody"), null);
});

test("formatSkillIndex lists name: description, empty when no skills", () => {
  assert.equal(formatSkillIndex([]), "");
  const idx = formatSkillIndex([{ name: "a", description: "do a", tags: [], useCount: 0, compat: ["all"], hasInput: false, trusted: true, kind: "instruction", roles: [] }, { name: "b", description: "do b", tags: [], useCount: 0, compat: ["all"], hasInput: false, trusted: true, kind: "instruction", roles: [] }]);
  assert.match(idx, /Skill Library/);
  assert.match(idx, /- a: do a/);
  assert.match(idx, /- b: do b/);
});
