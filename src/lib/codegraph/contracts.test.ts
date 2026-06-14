import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isValidSymbol, parseMatchLine, isDefinitionLine, classifyMatches, formatSymbolGraph,
} from "./contracts";
import { findSymbol } from "./provider";

test("isValidSymbol accepts identifiers, rejects junk/regex", () => {
  assert.equal(isValidSymbol("fetchUser"), true);
  assert.equal(isValidSymbol("BRK.B"), true);
  assert.equal(isValidSymbol("a b"), false);
  assert.equal(isValidSymbol(".*"), false);
  assert.equal(isValidSymbol(""), false);
});

test("parseMatchLine parses file:line:text", () => {
  assert.deepEqual(parseMatchLine("src/a.ts:42:  const x = 1"), { file: "src/a.ts", line: 42, text: "  const x = 1" });
  assert.equal(parseMatchLine("no colons"), null);
});

test("isDefinitionLine distinguishes definitions from references", () => {
  assert.equal(isDefinitionLine("fetchUser", "export function fetchUser(id) {"), true);
  assert.equal(isDefinitionLine("fetchUser", "const fetchUser = async () => {"), true);
  assert.equal(isDefinitionLine("User", "class User extends Base {"), true);
  assert.equal(isDefinitionLine("fetchUser", "  const u = await fetchUser(id);"), false, "a call site is a reference");
  assert.equal(isDefinitionLine("User", "  let u: User = null;"), false, "a type annotation use is a reference");
});

test("classifyMatches splits defs vs refs", () => {
  const g = classifyMatches("foo", [
    { file: "a.ts", line: 1, text: "function foo() {}" },
    { file: "b.ts", line: 5, text: "  foo();" },
    { file: "b.ts", line: 9, text: "  return foo() + 1;" },
  ], false);
  assert.equal(g.definitions.length, 1);
  assert.equal(g.references.length, 2);
  assert.match(formatSymbolGraph(g), /1 definition\(s\), 2 reference\(s\)/);
});

test("findSymbol against a real temp project finds the def + usages", async () => {
  const root = mkdtempSync(join(tmpdir(), "cg-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "user.ts"), "export function fetchUser(id) {\n  return id;\n}\n");
  writeFileSync(join(root, "src", "app.ts"), "import { fetchUser } from './user';\nconst u = fetchUser(1);\nconsole.log(fetchUser(2));\n");
  try {
    const g = await findSymbol("fetchUser", root);
    assert.ok(g.definitions.some((d) => d.file.includes("user.ts")), "definition in user.ts");
    assert.ok(g.references.length >= 2, "at least two reference sites");
    assert.ok(g.definitions.length + g.references.length >= 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findSymbol rejects a non-identifier symbol safely (no shell/regex injection)", async () => {
  const g = await findSymbol("foo; rm -rf .*", "/tmp");
  assert.deepEqual({ d: g.definitions.length, r: g.references.length }, { d: 0, r: 0 });
});
