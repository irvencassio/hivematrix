import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "project-discovery.ts"), "utf-8");

// hasHiddenSegment / isDiscoverableProjectPath are module-private on purpose —
// exporting them purely for a test would add a symbol nothing in production
// imports. Reconstruct the predicate from source so the test still exercises
// the real expression rather than a copy that can drift.
function hiddenSegmentPredicate(): (path: string) => boolean {
  const body = SRC.match(/function hasHiddenSegment\(path: string\): boolean \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, "hasHiddenSegment should exist in project-discovery.ts");
  return new Function("path", body.replace(/: string/g, "")) as (p: string) => boolean;
}

test("hidden directories are never discovered as projects", () => {
  // VS Code's Local History extension keeps <project>/.history AND git-inits it,
  // so the git scan surfaced it as a real project. It then sorted first in the
  // Memory panel's repository picker and became the default, showing every
  // context file as "not found" for a folder nobody works in.
  const isHidden = hiddenSegmentPredicate();

  assert.equal(isHidden("/Users/x/_GD/digibot/.history"), true, "the reported case");
  assert.equal(isHidden("/Users/x/proj/.history/AGENTS.md"), true, "nested under a hidden dir too");
  assert.equal(isHidden("/Users/x/proj/.venv"), true);
  assert.equal(isHidden("/Users/x/proj/.claude/worktrees/agent-1"), true);

  // Real projects must survive — including dots that are not path segments.
  assert.equal(isHidden("/Users/x/hivematrix"), false);
  assert.equal(isHidden("/Users/x/irvcassio.com"), false, "a dot inside a name is not a hidden segment");
  assert.equal(isHidden("/Users/x/_GD/digibot"), false);
  assert.equal(isHidden("/Users/x/iron-sixty"), false);

  // A bare "." segment (from a relative path) must not disqualify anything.
  assert.equal(isHidden("/Users/x/./proj"), false, "'.' alone is not a hidden directory");
});

test("the hidden-segment guard is actually wired into discoverability", () => {
  const fn = SRC.match(/function isDiscoverableProjectPath\(path: string\): boolean \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(fn, "isDiscoverableProjectPath should exist");
  assert.match(fn, /hasHiddenSegment\(path\)/, "the predicate must be consulted, not merely defined");
});

test("shouldPreSelect is a relevance signal, not a single-selection flag", () => {
  // Consumers must not treat it as "the one active project" — on this machine
  // it is true for ~35 of ~100 projects. Rendering it as an HTML `selected`
  // attribute marks many options and leaves the browser on whichever is last.
  const fn = SRC.match(/export function shouldPreSelect\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(fn, "shouldPreSelect should exist");
  assert.match(fn, /inClaudeHistory \|\|/, "recent-use OR manifest — deliberately non-exclusive");
  assert.match(fn, /isRecent && project\.hasManifest/);
});
