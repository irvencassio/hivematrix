import test from "node:test";
import assert from "node:assert/strict";
import {
  GOALS_SECTION_SPEC,
  SOUL_NOTES_SPEC,
  USER_SECTION_SPEC,
  mergeDatedSection,
  normalizeBullet,
  parseSectionBullets,
} from "./persona-section";

test("normalizeBullet strips punctuation/case/whitespace", () => {
  assert.equal(normalizeBullet("  Ship X — by August!  "), "ship x by august");
});

test("parseSectionBullets strips dashes and leading dates", () => {
  const doc = "# H\n- 2026-07-04: fact one\n- plain bullet\nnot a bullet\n";
  assert.deepEqual(parseSectionBullets(doc), ["fact one", "plain bullet"]);
});

test("mergeDatedSection seeds, appends, dedupes by containment both ways, and bounds", () => {
  const spec = { header: "## Notes", seed: "# Doc", maxItems: 3 };
  let { content, added } = mergeDatedSection("", ["alpha beta"], "2026-07-04", spec);
  assert.equal(added, 1);
  assert.match(content, /# Doc\n\n## Notes\n- 2026-07-04: alpha beta/);

  // Containment dedupe: an existing bullet containing the new item blocks it.
  ({ content, added } = mergeDatedSection(content, ["alpha"], "2026-07-05", spec));
  assert.equal(added, 0);

  // Bounding keeps the newest maxItems.
  for (const item of ["second distinct", "third distinct", "fourth distinct"]) {
    ({ content } = mergeDatedSection(content, [item], "2026-07-05", spec));
  }
  const bullets = parseSectionBullets(content);
  assert.equal(bullets.length, 3);
  assert.deepEqual(bullets, ["second distinct", "third distinct", "fourth distinct"]);
});

test("shared specs are internally consistent", () => {
  for (const spec of [USER_SECTION_SPEC, GOALS_SECTION_SPEC, SOUL_NOTES_SPEC]) {
    assert.ok(spec.header.startsWith("## "));
    assert.ok(spec.maxItems > 0);
    assert.ok(spec.seed.length > 0);
  }
});

test("review regression: bullets land INSIDE the target section, never in later sections", () => {
  const doc = [
    "# USER — who the operator is",
    "",
    "## Learned about the operator",
    "- 2026-07-01: Prefers local models",
    "",
    "## Do-not-touch (operator authored)",
    "- Never email clients directly",
    "- Keep weekends free",
    "",
  ].join("\n");
  const { content, added } = mergeDatedSection(doc, ["Works late on Tuesdays"], "2026-07-04", USER_SECTION_SPEC);
  assert.equal(added, 1);
  const learnedSection = content.split("## Do-not-touch")[0];
  const protectedSection = content.split("## Do-not-touch")[1];
  assert.match(learnedSection, /Works late on Tuesdays/);
  assert.doesNotMatch(protectedSection, /Works late on Tuesdays/);
  assert.match(protectedSection, /Never email clients directly[\s\S]*Keep weekends free/);
});

test("review regression: bounding trims only the target section's bullets", () => {
  const spec = { header: "## Notes", seed: "# Doc", maxItems: 2 };
  let doc = "# Doc\n\n## Notes\n- old one\n- old two\n\n## Keep\n- keeper A\n- keeper B\n";
  const { content } = mergeDatedSection(doc, ["new three"], "2026-07-04", spec);
  const notes = content.split("## Keep")[0];
  const keep = content.split("## Keep")[1];
  assert.doesNotMatch(notes, /old one/);           // oldest trimmed
  assert.match(notes, /old two[\s\S]*new three/);  // newest two kept
  assert.match(keep, /keeper A[\s\S]*keeper B/);   // untouched
});
