import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractWikiLinks, docSlug, buildLinkGraph, backlinksFor, resolveTarget, linksForDoc } from "./links";

test("extractWikiLinks pulls [[targets]] (with aliases), slugified + deduped", () => {
  const c = "See [[Voice Video Persona Strategy]] and [[hermes-decision|Hermes]] and [[hermes-decision]].";
  assert.deepEqual(extractWikiLinks(c).sort(), ["hermes-decision", "voice-video-persona-strategy"]);
});

test("docSlug strips date prefix path + extension", () => {
  assert.equal(docSlug("projects/hive/2026-06-20-rapidmlx.html"), "2026-06-20-rapidmlx");
  assert.equal(docSlug("hermes-decision.md"), "hermes-decision");
});

test("buildLinkGraph + backlinks across a temp brain", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-links-"));
  const proj = join(root, "projects", "hive");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(root, "hermes-decision.md"), "Hermes notes.");
  writeFileSync(join(proj, "2026-06-20-strategy.md"), "Strategy links [[hermes-decision]] and [[missing-doc]].");

  const graph = await buildLinkGraph({ brainRootDir: root });
  // backlinks: who links to hermes-decision?
  assert.deepEqual(backlinksFor("hermes-decision", graph), [join("projects", "hive", "2026-06-20-strategy.md")]);
  // resolve a target slug to its doc
  assert.equal(resolveTarget("hermes-decision", graph), "hermes-decision.md");
  // unresolved target → null but still recorded as a forward link
  assert.equal(resolveTarget("missing-doc", graph), null);
  const fwd = linksForDoc(join("projects", "hive", "2026-06-20-strategy.md"), graph);
  assert.deepEqual(fwd.links.sort(), ["hermes-decision", "missing-doc"]);
});
