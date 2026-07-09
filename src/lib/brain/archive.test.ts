import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { archiveProjectDoc, restoreProjectDoc, deleteArchivedProjectDoc } from "./archive";
import { listProjectDocs, readProjectDoc } from "./doc-review";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hm-archive-"));
  const proj = join(root, "projects", "hive");
  mkdirSync(join(proj, "lanes"), { recursive: true });
  writeFileSync(join(proj, "agent-brief.md"), "# Hive Agent Brief\n");
  writeFileSync(join(proj, "lanes", "manager.md"), "# Manager Lane\n");
  return { root, proj };
}

test("archiveProjectDoc moves a root-level doc into _archived/, preserving content", async () => {
  const { root, proj } = fixture();
  const r = await archiveProjectDoc("hive", "agent-brief.md", root);
  assert.equal(r.ok, true);
  assert.ok(!existsSync(join(proj, "agent-brief.md")), "gone from its original location");
  const archivedPath = join(proj, "_archived", "agent-brief.md");
  assert.ok(existsSync(archivedPath));
  assert.match(readFileSync(archivedPath, "utf-8"), /Hive Agent Brief/);
});

test("archiveProjectDoc preserves sub-path (lanes/manager.md → _archived/lanes/manager.md)", async () => {
  const { root, proj } = fixture();
  const r = await archiveProjectDoc("hive", "lanes/manager.md", root);
  assert.equal(r.ok, true);
  assert.ok(existsSync(join(proj, "_archived", "lanes", "manager.md")));
});

test("restoreProjectDoc reverses an archive", async () => {
  const { root, proj } = fixture();
  await archiveProjectDoc("hive", "agent-brief.md", root);
  const r = await restoreProjectDoc("hive", "agent-brief.md", root);
  assert.equal(r.ok, true);
  assert.ok(existsSync(join(proj, "agent-brief.md")));
  assert.ok(!existsSync(join(proj, "_archived", "agent-brief.md")));
});

test("archiveProjectDoc: missing file fails cleanly, nothing left in a partial state", async () => {
  const { root } = fixture();
  const r = await archiveProjectDoc("hive", "does-not-exist.md", root);
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test("archiveProjectDoc: path traversal is rejected", async () => {
  const { root } = fixture();
  const r = await archiveProjectDoc("hive", "../../../etc/passwd", root);
  assert.equal(r.ok, false);
});

test("an archived doc vanishes from listProjectDocs' active set and reappears flagged archived", async () => {
  const { root } = fixture();
  const beforeIds = (await listProjectDocs("hive", { brainRootDir: root })).docs.map((d) => d.file);
  assert.ok(beforeIds.includes("agent-brief.md"));

  await archiveProjectDoc("hive", "agent-brief.md", root);
  const { docs } = await listProjectDocs("hive", { brainRootDir: root });
  const active = docs.filter((d) => !d.archived);
  const archived = docs.filter((d) => d.archived);
  assert.ok(!active.some((d) => d.file === "agent-brief.md"), "no longer in the active set");
  assert.ok(archived.some((d) => d.file === "agent-brief.md"), "present in the archived set");
});

test("readProjectDoc still finds an archived doc's content (falls back to _archived/)", async () => {
  const { root } = fixture();
  await archiveProjectDoc("hive", "agent-brief.md", root);
  const doc = await readProjectDoc("hive", "agent-brief.md", root);
  assert.ok(doc);
  assert.match(doc!.content, /Hive Agent Brief/);
  assert.equal(doc!.path, join("projects", "hive", "_archived", "agent-brief.md"));
});

test("restore reverses cleanly: back in the active set, gone from archived", async () => {
  const { root } = fixture();
  await archiveProjectDoc("hive", "agent-brief.md", root);
  await restoreProjectDoc("hive", "agent-brief.md", root);
  const { docs } = await listProjectDocs("hive", { brainRootDir: root });
  assert.ok(docs.some((d) => d.file === "agent-brief.md" && !d.archived));
  assert.ok(!docs.some((d) => d.file === "agent-brief.md" && d.archived));
});

test("deleteArchivedProjectDoc permanently removes an archived doc", async () => {
  const { root, proj } = fixture();
  await archiveProjectDoc("hive", "agent-brief.md", root);
  assert.ok(existsSync(join(proj, "_archived", "agent-brief.md")));

  const r = await deleteArchivedProjectDoc("hive", "agent-brief.md", root);
  assert.equal(r.ok, true);
  assert.ok(!existsSync(join(proj, "_archived", "agent-brief.md")));

  const { docs } = await listProjectDocs("hive", { brainRootDir: root });
  assert.ok(!docs.some((d) => d.file === "agent-brief.md"), "gone entirely, not just un-archived");
});

test("deleteArchivedProjectDoc never touches a doc that is still active (not archived)", async () => {
  const { root, proj } = fixture();
  const r = await deleteArchivedProjectDoc("hive", "agent-brief.md", root);
  assert.equal(r.ok, false, "nothing to delete at the _archived/ path — the active file must survive untouched");
  assert.ok(existsSync(join(proj, "agent-brief.md")), "active doc is untouched");
});

test("deleteArchivedProjectDoc: path traversal is rejected", async () => {
  const { root } = fixture();
  const r = await deleteArchivedProjectDoc("hive", "../../../etc/passwd", root);
  assert.equal(r.ok, false);
});
