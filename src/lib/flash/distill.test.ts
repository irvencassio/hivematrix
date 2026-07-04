import test from "node:test";
import assert from "node:assert/strict";
import { mergeOperatorFacts } from "./distill";

test("mergeOperatorFacts seeds USER.md with a header + learned section when empty", () => {
  const { content, added } = mergeOperatorFacts("", ["Prefers terse answers"], "2026-07-04");
  assert.equal(added, 1);
  assert.match(content, /# USER — who the operator is/);
  assert.match(content, /## Learned about the operator/);
  assert.match(content, /- 2026-07-04: Prefers terse answers/);
});

test("mergeOperatorFacts appends to an existing template without clobbering it", () => {
  const template = "# USER\n\n**Name:** Irv\n**Timezone:** America/New_York\n";
  const { content, added } = mergeOperatorFacts(template, ["Working toward an annuity license by August"], "2026-07-04");
  assert.equal(added, 1);
  assert.match(content, /\*\*Name:\*\* Irv/);
  assert.match(content, /annuity license by August/);
});

test("mergeOperatorFacts dedupes against existing bullets and within the batch", () => {
  const existing = "# USER\n\n## Learned about the operator\n- 2026-07-01: Prefers terse answers\n";
  const { content, added } = mergeOperatorFacts(
    existing,
    ["prefers terse answers!", "Prefers terse answers", "Ships on Fridays"],
    "2026-07-04",
  );
  assert.equal(added, 1);
  assert.match(content, /Ships on Fridays/);
  // The original bullet survives; no duplicate added
  assert.equal((content.match(/terse answers/gi) ?? []).length, 1);
});

test("mergeOperatorFacts returns unchanged content when every fact is known", () => {
  const existing = "# USER\n\n## Learned about the operator\n- 2026-07-01: Runs a solo founder business\n";
  const { content, added } = mergeOperatorFacts(existing, ["runs a solo founder business"], "2026-07-04");
  assert.equal(added, 0);
  assert.equal(content, existing);
});

test("mergeOperatorFacts bounds the learned section to the newest 40 bullets", () => {
  let content = "# USER\n";
  for (let i = 0; i < 45; i++) {
    const r = mergeOperatorFacts(content, [`Distinct durable fact number ${i} about topic ${i}`], "2026-07-04");
    content = r.content;
  }
  const bullets = content.split("\n").filter((l) => l.trim().startsWith("- "));
  assert.equal(bullets.length, 40);
  assert.match(bullets[0], /fact number 5/);   // oldest 5 dropped
  assert.match(bullets[39], /fact number 44/); // newest kept
});

test("mergeOperatorFacts ignores empty/whitespace facts", () => {
  const { added } = mergeOperatorFacts("", ["  ", "", "\n"], "2026-07-04");
  assert.equal(added, 0);
});
