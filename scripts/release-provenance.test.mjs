import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(path, "utf8");

test("publish gate fails unless the built app explicitly reports a clean worktree", () => {
  const body = read("scripts/publish-release.sh");

  // build-info.json's sourceDirty is printed by python: True / False / None
  // (None when the field is missing). The gate must demand an explicit clean
  // flag — a missing field slipping past a dirty==True check would let an
  // unknown-provenance build publish.
  assert.match(body, /"\$BUILT_DIRTY" != "False"/, "gate requires an explicit clean flag");
  assert.match(body, /"\$BUILT_DIRTY" != "false"/, "gate accepts a JSON-style lowercase false too");
  assert.doesNotMatch(body, /"\$BUILT_DIRTY" = "True"/, "the pass-unless-dirty form is gone");
});

test("dmg staging temp directory is cleaned up on exit", () => {
  const body = read("scripts/build-dmg.sh");

  // mktemp -d without a trap leaks a staging copy of the .app every build.
  assert.match(body, /trap 'rm -rf "\$STAGE_ROOT"' EXIT/, "staging dir has an EXIT cleanup trap");
});
