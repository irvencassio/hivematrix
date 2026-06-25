import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("release notes use lane names instead of old bee brands", () => {
  const changelogTs = read("src/lib/version/changelog.ts");
  const changelogMd = read("CHANGELOG.md");

  for (const [path, content] of [
    ["src/lib/version/changelog.ts", changelogTs],
    ["CHANGELOG.md", changelogMd],
  ]) {
    assert.match(content, /Voice Lane/, `${path} should mention Voice Lane`);
    assert.match(content, /Mail Lane/, `${path} should mention Mail Lane`);
    assert.doesNotMatch(content, /VoiceBee|MailBee/, `${path} still contains old release-note brands`);
  }
});
