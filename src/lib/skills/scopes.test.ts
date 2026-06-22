import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSkillSources, scopeTrustDecision, shouldImport, scopeRank } from "./scopes";
import type { SkillScope } from "./contracts";

test("parseSkillSources: back-compat single repoUrl → personal source", () => {
  const s = parseSkillSources({ skillsSync: { repoUrl: "git@x:me/s.git" } });
  assert.equal(s.length, 1);
  assert.equal(s[0].scope, "personal");
  assert.equal(s[0].dir, join(homedir(), ".hivematrix", "skills-repo"));
});

test("parseSkillSources: sources[] sorted personal-first; bad entries dropped", () => {
  const s = parseSkillSources({ skillsSync: { sources: [
    { scope: "public", repoUrl: "p" },
    { scope: "personal", repoUrl: "me" },
    { scope: "team", repoUrl: "t", branch: "dev" },
    { scope: "bogus", repoUrl: "x" }, // dropped
    { scope: "org" },                  // dropped (no repoUrl)
  ] } });
  assert.deepEqual(s.map((x) => x.scope), ["personal", "team", "public"]);
  assert.equal(s.find((x) => x.scope === "team")!.branch, "dev");
});

test("scopeTrustDecision: personal trusted; team/org need signature; public never", () => {
  assert.equal(scopeTrustDecision({ scope: "personal", signatureValid: false }), true);
  assert.equal(scopeTrustDecision({ scope: "team", signatureValid: true }), true);
  assert.equal(scopeTrustDecision({ scope: "team", signatureValid: false }), false);
  assert.equal(scopeTrustDecision({ scope: "org", signatureValid: true }), true);
  assert.equal(scopeTrustDecision({ scope: "public", signatureValid: true }), false);
});

test("shouldImport: more-local scope overrides; same/less-local does not", () => {
  const seen = new Map<string, SkillScope>();
  assert.equal(shouldImport("a", "team", seen), true);
  seen.set("a", "team");
  assert.equal(shouldImport("a", "public", seen), false); // public is less local than team
  assert.equal(shouldImport("a", "personal", seen), true); // personal overrides team
  assert.ok(scopeRank("personal") < scopeRank("public"));
});
