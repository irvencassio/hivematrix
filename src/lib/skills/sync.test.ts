import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSkillsSyncConfig } from "./sync";

test("parseSkillsSyncConfig: null without a repoUrl", () => {
  assert.equal(parseSkillsSyncConfig({}), null);
  assert.equal(parseSkillsSyncConfig({ skillsSync: { branch: "main" } }), null);
});

test("parseSkillsSyncConfig: defaults branch, dir (out of Drive), trustOnPull", () => {
  const c = parseSkillsSyncConfig({ skillsSync: { repoUrl: "git@example.com:me/skills.git" } });
  assert.ok(c);
  assert.equal(c!.repoUrl, "git@example.com:me/skills.git");
  assert.equal(c!.branch, "main");
  assert.equal(c!.dir, join(homedir(), ".hivematrix", "skills-repo")); // NOT under the brain/Drive
  assert.equal(c!.trustOnPull, true);
});

test("parseSkillsSyncConfig: respects overrides incl. trustOnPull:false and ~ expansion", () => {
  const c = parseSkillsSyncConfig({ skillsSync: { repoUrl: "u", branch: "dev", dir: "~/x/skills", trustOnPull: false } });
  assert.equal(c!.branch, "dev");
  assert.equal(c!.dir, join(homedir(), "x", "skills"));
  assert.equal(c!.trustOnPull, false);
});
