import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeJsonAtomic } from "./atomic-write";

test("writeJsonAtomic writes parseable JSON and leaves no temp file behind", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "config.json");

  writeJsonAtomic(path, { a: 1, nested: { b: "x" } });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf-8")), { a: 1, nested: { b: "x" } });
  assert.deepEqual(readdirSync(dir), ["config.json"], "no temp files left behind");

  writeFileSync(path, JSON.stringify({ old: true }));
  writeJsonAtomic(path, { new: true });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf-8")), { new: true }, "overwrites an existing file");
  assert.deepEqual(readdirSync(dir), ["config.json"]);
});

test("every config.json writer goes through writeJsonAtomic (a crash mid-write must not truncate config)", () => {
  for (const rel of [
    "src/lib/config/features.ts",
    "src/lib/config/autonomy.ts",
    "src/lib/embeddings/provider.ts",
    "src/lib/models/provision.ts",
    "src/lib/models/available.ts",
  ]) {
    const body = readFileSync(rel, "utf-8");
    assert.doesNotMatch(body, /writeFileSync\(configPath\(\)/, `${rel} must not write config.json non-atomically`);
    assert.match(body, /writeJsonAtomic\(/, `${rel} must write config.json via writeJsonAtomic`);
  }
});
