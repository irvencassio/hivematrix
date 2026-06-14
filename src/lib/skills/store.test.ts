import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Point the brain root at a temp dir via a temp HOME + config.json (configuredBrainRootDir reads it).
const TMP = mkdtempSync(join(tmpdir(), "hm-skills-"));
const HOME = join(TMP, "home");
const BRAIN = join(TMP, "brain");
mkdirSync(join(HOME, ".hivematrix"), { recursive: true });
writeFileSync(join(HOME, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: BRAIN } }));
const origHome = process.env.HOME;
process.env.HOME = HOME;

const { upsertSkill, listSkills, readSkill, skillsDir, markSkillUsed, setSkillTrusted, deleteSkill } = await import("./store");

test.after(() => {
  process.env.HOME = origHome;
  rmSync(TMP, { recursive: true, force: true });
});

test("skillsDir resolves under the configured brain root", () => {
  assert.equal(skillsDir(), join(BRAIN, "skills"));
});

test("upsertSkill creates a new skill file", async () => {
  const r = await upsertSkill({ name: "Cut Release", description: "release steps", tags: ["ops"], body: "1. bump\n2. tag", source: "directive:r1" });
  assert.equal(r.created, true);
  assert.equal(r.refined, false);
  assert.ok(r.path && existsSync(r.path));
  const read = await readSkill("Cut Release");
  assert.equal(read?.name, "Cut Release");
  assert.equal(read?.revisions, 1);
});

test("re-distilling the same skill with a NEW body refines it (revisions++), not duplicates", async () => {
  const r = await upsertSkill({ name: "Cut Release", description: "release steps v2", body: "1. bump\n2. tag\n3. announce", source: "directive:r2" });
  assert.equal(r.created, false);
  assert.equal(r.refined, true);
  const read = await readSkill("Cut Release");
  assert.equal(read?.revisions, 2);
  assert.match(read!.body, /announce/);
  // still a single file in the library
  assert.equal((await listSkills()).filter((s) => s.name === "Cut Release").length, 1);
});

test("re-distilling with the SAME body is a no-op refine (revisions unchanged)", async () => {
  const before = (await readSkill("Cut Release"))!.revisions;
  const r = await upsertSkill({ name: "Cut Release", description: "release steps v2", body: "1. bump\n2. tag\n3. announce", source: "directive:r3" });
  assert.equal(r.refined, false);
  assert.equal((await readSkill("Cut Release"))!.revisions, before);
});

test("listSkills returns the library index", async () => {
  await upsertSkill({ name: "Triage Email", description: "how to triage", body: "read, classify, draft", source: "directive:r4" });
  const idx = await listSkills();
  assert.ok(idx.length >= 2);
  assert.ok(idx.some((s) => s.name === "Triage Email"));
});

test("markSkillUsed bumps useCount; a refinement appends + bumps revisions", async () => {
  const before = (await readSkill("Triage Email"))!;
  assert.equal(before.useCount, 0);

  const r1 = await markSkillUsed("Triage Email");
  assert.deepEqual({ ok: r1.ok, useCount: r1.useCount, refined: r1.refined }, { ok: true, useCount: 1, refined: false });

  const r2 = await markSkillUsed("Triage Email", { refinement: "also check the spam folder" });
  assert.equal(r2.useCount, 2);
  assert.equal(r2.refined, true);
  const after = (await readSkill("Triage Email"))!;
  assert.equal(after.useCount, 2);
  assert.equal(after.revisions, before.revisions + 1);
  assert.match(after.body, /also check the spam folder/);

  // most-used sorts first in the index
  assert.equal((await listSkills())[0].name, "Triage Email");
});

test("markSkillUsed on an unknown skill is a clean no-op", async () => {
  const r = await markSkillUsed("does-not-exist");
  assert.deepEqual(r, { ok: false, useCount: 0, refined: false });
});

test("imported (untrusted) skill: trusted=false, approvable, deletable", async () => {
  await upsertSkill({ name: "Shared Recipe", description: "from a team", body: "do the thing", source: "import:https://x", trusted: false });
  let s = await readSkill("Shared Recipe");
  assert.equal(s?.trusted, false, "imported defaults untrusted");
  assert.equal((await listSkills()).find(x => x.name === "Shared Recipe")?.trusted, false);

  assert.equal(await setSkillTrusted("Shared Recipe", true), true);
  s = await readSkill("Shared Recipe");
  assert.equal(s?.trusted, true, "operator approval flips it trusted");

  assert.equal(await deleteSkill("Shared Recipe"), true);
  assert.equal(await readSkill("Shared Recipe"), null, "deleted");
  assert.equal(await deleteSkill("Shared Recipe"), false, "second delete is a no-op");
});

test("distilled/manual skills default trusted", async () => {
  await upsertSkill({ name: "House Style", description: "ours", body: "use tabs", source: "directive:r1" });
  assert.equal((await readSkill("House Style"))?.trusted, true);
});
