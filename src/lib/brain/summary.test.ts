import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recentBrainDocs, weeklyDigestFilename, buildBrainDigestTaskDescription } from "./summary";

test("recentBrainDocs returns docs in the window, newest first, excludes stale", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-sum-"));
  const proj = join(root, "projects", "hive");
  mkdirSync(proj, { recursive: true });
  const now = Date.now();
  const recentA = join(proj, "a.md");
  const recentB = join(proj, "b.md");
  const old = join(proj, "old.md");
  writeFileSync(recentA, "a");
  writeFileSync(recentB, "b");
  writeFileSync(old, "old");
  const day = 86_400_000;
  utimesSync(recentA, new Date(now - 1 * day), new Date(now - 1 * day));
  utimesSync(recentB, new Date(now - 3 * day), new Date(now - 3 * day));
  utimesSync(old, new Date(now - 30 * day), new Date(now - 30 * day));

  const docs = await recentBrainDocs({ brainRootDir: root, sinceDays: 7, now });
  const paths = docs.map((d) => d.path);
  assert.deepEqual(paths, [join("projects", "hive", "a.md"), join("projects", "hive", "b.md")]); // newest first, old excluded
});

test("weeklyDigestFilename + task description", () => {
  assert.equal(weeklyDigestFilename("2026-06-22"), "2026-06-22-brain-weekly-digest.md");
  const desc = buildBrainDigestTaskDescription({
    docs: [{ path: "projects/hive/a.md", mtimeMs: 1 }],
    docPath: "/brain/digests/2026-06-22-brain-weekly-digest.md",
    sinceDays: 7,
  });
  assert.match(desc, /last 7 days/);
  assert.match(desc, /projects\/hive\/a\.md/);
  assert.match(desc, /\[\[doc-slug\]\]/);
});
