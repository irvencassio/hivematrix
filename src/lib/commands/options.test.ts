import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseArgumentHint,
  parseOptionsFrontmatter,
  resolveCommandOptions,
} from "./options";

test("parseArgumentHint: bare flag", () => {
  const s = parseArgumentHint("--dry-run");
  assert.equal(s.source, "argument-hint");
  assert.equal(s.options.length, 1);
  assert.deepEqual(
    { name: s.options[0].name, kind: s.options[0].kind },
    { name: "--dry-run", kind: "flag" },
  );
});

test("parseArgumentHint: value flag with placeholder (space and =)", () => {
  for (const hint of ["--marketing-version X.Y.Z", "--marketing-version=X.Y.Z", "--filter <pattern>"]) {
    const o = parseArgumentHint(hint).options[0];
    assert.equal(o.kind, "value", hint);
    assert.ok(o.valuePlaceholder && o.valuePlaceholder.length > 0, hint);
  }
});

test("parseArgumentHint: optional flag in brackets", () => {
  const s = parseArgumentHint("[--skip-notarize]");
  assert.equal(s.options.length, 1);
  assert.equal(s.options[0].name, "--skip-notarize");
  assert.equal(s.options[0].kind, "flag");
});

test("parseArgumentHint: choice flag from a|b|c", () => {
  const o = parseArgumentHint("--priority high|medium|low").options[0];
  assert.equal(o.kind, "choice");
  assert.deepEqual(o.choices, ["high", "medium", "low"]);
});

test("parseArgumentHint: top-level alternation → one exclusivity group", () => {
  const s = parseArgumentHint("--release | --verify-only | --build-only");
  assert.equal(s.options.length, 3);
  const groups = new Set(s.options.map((o) => o.group));
  assert.equal(groups.size, 1, "all three share one group");
  assert.ok([...groups][0], "group id is set");
});

test("parseArgumentHint: positionals required vs optional", () => {
  const s = parseArgumentHint("<pr-number> [assignee]");
  assert.equal(s.positionals.length, 2);
  assert.deepEqual(
    s.positionals.map((p) => [p.name, p.required]),
    [["pr-number", true], ["assignee", false]],
  );
});

test("parseArgumentHint: empty → none", () => {
  const s = parseArgumentHint("");
  assert.equal(s.source, "none");
  assert.equal(s.options.length, 0);
  assert.equal(s.positionals.length, 0);
});

test("parseArgumentHint: hybrid positional + optional value flag", () => {
  const s = parseArgumentHint("<issue> [--priority high|medium|low]");
  assert.equal(s.positionals.length, 1);
  assert.equal(s.positionals[0].name, "issue");
  assert.equal(s.options.length, 1);
  assert.equal(s.options[0].kind, "choice");
  assert.deepEqual(s.options[0].choices, ["high", "medium", "low"]);
});

test("parseOptionsFrontmatter: flag with group + description", () => {
  const s = parseOptionsFrontmatter("--release              (mode) Full: build then publish");
  assert.equal(s.source, "frontmatter");
  const o = s.options[0];
  assert.equal(o.name, "--release");
  assert.equal(o.kind, "flag");
  assert.equal(o.group, "mode");
  assert.match(o.description ?? "", /Full: build then publish/);
});

test("parseOptionsFrontmatter: value flag with =placeholder + description", () => {
  const o = parseOptionsFrontmatter("--marketing-version=X.Y.Z  Set the marketing version").options[0];
  assert.equal(o.kind, "value");
  assert.equal(o.valuePlaceholder, "X.Y.Z");
  assert.match(o.description ?? "", /Set the marketing version/);
});

test("parseOptionsFrontmatter: choice flag =a|b|c", () => {
  const o = parseOptionsFrontmatter("--priority=low|med|high   Priority level").options[0];
  assert.equal(o.kind, "choice");
  assert.deepEqual(o.choices, ["low", "med", "high"]);
});

test("parseOptionsFrontmatter: positional lines", () => {
  const s = parseOptionsFrontmatter("<target>   Thing to act on\n[note]   Optional note");
  assert.deepEqual(
    s.positionals.map((p) => [p.name, p.required]),
    [["target", true], ["note", false]],
  );
});

test("resolveCommandOptions: frontmatter wins over hint", () => {
  const s = resolveCommandOptions({ optionsRaw: "--release   (mode) Full", argumentHint: "--verify-only" });
  assert.equal(s.source, "frontmatter");
  assert.equal(s.options[0].name, "--release");
});

test("resolveCommandOptions: falls back to hint, then none", () => {
  assert.equal(resolveCommandOptions({ argumentHint: "--verify-only" }).source, "argument-hint");
  assert.equal(resolveCommandOptions({}).source, "none");
});
