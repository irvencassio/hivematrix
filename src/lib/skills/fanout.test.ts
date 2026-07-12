import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planFanout, fanOutSkills, harnessTargets, type HarnessTarget } from "./fanout";
import { renderStandardSkillMd } from "./standard";
import type { Skill } from "./contracts";

function skill(p: Partial<Skill>): Skill {
  return {
    name: "s", description: "d", tags: [], body: "body", source: "manual",
    createdAt: "", updatedAt: "", revisions: 1, useCount: 0, lastUsedAt: "",
    compat: ["all"], trusted: true, failures: 0, probation: false, kind: "instruction", interpreter: "bash", roles: [], ...p,
  };
}

test("planFanout: trust gate + compat gate + removal of dropped slugs", () => {
  const targets: HarnessTarget[] = [{ id: "claude", dir: "/c" }, { id: "codex", dir: "/x" }];
  const skills = [
    skill({ name: "shared", compat: ["all"], trusted: true }),
    skill({ name: "claude-only", compat: ["claude"], trusted: true }),
    skill({ name: "untrusted", compat: ["all"], trusted: false }),
  ];
  const managed = { claude: ["old-gone"], codex: ["old-gone"] };
  const plans = planFanout(skills, targets, managed);
  const claude = plans.find((p) => p.id === "claude")!;
  const codex = plans.find((p) => p.id === "codex")!;
  assert.deepEqual(claude.write.sort(), ["claude-only", "shared"]); // untrusted excluded
  assert.deepEqual(codex.write.sort(), ["shared"]);                 // claude-only excluded by compat
  assert.deepEqual(claude.remove, ["old-gone"]);                    // previously managed, now gone
});

test("renderStandardSkillMd emits spec frontmatter (name=slug, metadata) + body", () => {
  const md = renderStandardSkillMd(skill({ name: "My Skill", description: "does X", kind: "script", compat: ["claude", "codex"] }));
  assert.match(md, /^---\nname: my-skill\n/);
  assert.match(md, /description: does X/);
  assert.match(md, /metadata:\n {2}kind: script\n {2}compat: claude, codex/);
  assert.match(md, /\nbody\n/);
});

test("harnessTargets: only claude and codex — qwen-code was retired as a skill-export harness", () => {
  const home = "/tmp/fanout-home-test";
  const targets = harnessTargets(home);
  assert.deepEqual(targets.map((t) => t.id).sort(), ["claude", "codex"]);
  assert.ok(!targets.some((t) => t.dir.includes(".qwen")), "fanout must never write to ~/.qwen");
});

test("fanOutSkills writes <slug>/SKILL.md, prunes removed, and won't clobber unmanaged", async () => {
  const home = mkdtempSync(join(tmpdir(), "fanout-"));
  const targets: HarnessTarget[] = [{ id: "claude", dir: join(home, ".claude", "skills") }];

  // First fan-out: one trusted skill.
  await fanOutSkills([skill({ name: "alpha" })], targets);
  assert.ok(existsSync(join(targets[0].dir, "alpha", "SKILL.md")));
  assert.match(readFileSync(join(targets[0].dir, "alpha", "SKILL.md"), "utf-8"), /name: alpha/);

  // A user's OWN skill we never managed — must not be touched.
  mkdirSync(join(targets[0].dir, "mine"), { recursive: true });
  writeFileSync(join(targets[0].dir, "mine", "SKILL.md"), "user's own");

  // Second fan-out: alpha removed, beta added. alpha dir pruned; mine untouched; beta written.
  const res = await fanOutSkills([skill({ name: "beta" })], targets);
  assert.equal(existsSync(join(targets[0].dir, "alpha")), false, "managed alpha pruned");
  assert.ok(existsSync(join(targets[0].dir, "beta", "SKILL.md")), "beta written");
  assert.equal(readFileSync(join(targets[0].dir, "mine", "SKILL.md"), "utf-8"), "user's own", "unmanaged skill untouched");
  assert.equal(res[0].written, 1);
  assert.equal(res[0].removed, 1);
});
