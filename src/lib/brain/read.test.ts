import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBrainDoc, formatBrainReadResult } from "./read";

function makeBrain(): string {
  const root = mkdtempSync(join(tmpdir(), "brain-read-"));
  mkdirSync(join(root, "projects"), { recursive: true });
  writeFileSync(join(root, "solo-founder-os-plan.md"), "# Solo Founder OS\nGoal 1: ship HiveMatrix.\nGoal 2: annuity license by Aug.");
  writeFileSync(join(root, "projects", "notes.md"), "Some project notes.");
  return root;
}

test("readBrainDoc returns a doc's full content for a valid in-root path", async () => {
  const root = makeBrain();
  try {
    const r = await readBrainDoc("solo-founder-os-plan.md", { root });
    assert.equal(r.ok, true);
    assert.match(r.content, /Goal 1: ship HiveMatrix/);
    assert.match(r.content, /Goal 2: annuity license/);
    assert.equal(r.truncated, false);
    assert.match(formatBrainReadResult(r), /solo-founder-os-plan\.md:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readBrainDoc reads a nested path under the root", async () => {
  const root = makeBrain();
  try {
    const r = await readBrainDoc("projects/notes.md", { root });
    assert.equal(r.ok, true);
    assert.match(r.content, /Some project notes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readBrainDoc rejects a `..` traversal that escapes the brain root", async () => {
  const root = makeBrain();
  try {
    const r = await readBrainDoc("../../etc/passwd", { root });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /escapes the brain root/);
    assert.equal(r.content, "");
    assert.match(formatBrainReadResult(r), /^Error:.*escapes the brain root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readBrainDoc rejects an absolute path outside the brain root", async () => {
  const root = makeBrain();
  try {
    const r = await readBrainDoc("/etc/passwd", { root });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /escapes the brain root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readBrainDoc handles a missing file gracefully", async () => {
  const root = makeBrain();
  try {
    const r = await readBrainDoc("does-not-exist.md", { root });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /try brain_search first/);
    assert.match(formatBrainReadResult(r), /^Error:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readBrainDoc handles a missing/disabled brain root", async () => {
  const r = await readBrainDoc("anything.md", { root: null });
  assert.equal(r.ok, false);
  assert.equal(r.root, null);
  assert.match(formatBrainReadResult(r), /Error/);
});

test("readBrainDoc requires a non-empty path", async () => {
  const root = makeBrain();
  try {
    const r = await readBrainDoc("", { root });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /'path' is required/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readBrainDoc truncates over-long content and notes the truncation", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-read-trunc-"));
  try {
    const big = "x".repeat(50_000);
    writeFileSync(join(root, "huge.md"), big);
    const r = await readBrainDoc("huge.md", { root, maxChars: 1000 });
    assert.equal(r.ok, true);
    assert.equal(r.truncated, true);
    assert.equal(r.content.length, 1000);
    assert.match(formatBrainReadResult(r), /Truncated to 1000 chars/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readBrainDoc does not truncate content under the cap", async () => {
  const root = makeBrain();
  try {
    const r = await readBrainDoc("solo-founder-os-plan.md", { root, maxChars: 20_000 });
    assert.equal(r.truncated, false);
    assert.doesNotMatch(formatBrainReadResult(r), /Truncated/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
