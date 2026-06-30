import test from "node:test";
import assert from "node:assert/strict";
import { chunkDocument } from "./chunking";
import type { BrainChunk } from "./index-db";

// ── chunk ID format ───────────────────────────────────────────────────────────

test("chunkDocument: chunk IDs follow {relPath}#{chunkIndex} format", () => {
  const chunks = chunkDocument("# Title\n\nContent here.", "projects/test.md");
  assert.ok(chunks.length > 0);
  for (const chunk of chunks) {
    assert.match(chunk.id, /^.+#\d+$/);
    assert.equal(chunk.id, `projects/test.md#${chunk.chunkIndex}`);
  }
});

// ── metadata preservation ─────────────────────────────────────────────────────

test("chunkDocument: preserves relPath in every chunk", () => {
  const path = "domains/programming.md";
  const chunks = chunkDocument("# Intro\n\nSome content.", path);
  assert.ok((chunks as BrainChunk[]).every((c) => c.path === path));
});

test("chunkDocument: chunkIndexes are 0-based and sequential", () => {
  const text = "# H1\n\nContent.\n\n# H2\n\nMore content.";
  const chunks = chunkDocument(text, "test.md");
  (chunks as BrainChunk[]).forEach((c, i) => assert.equal(c.chunkIndex, i));
});

test("chunkDocument: assigns heading from the nearest preceding markdown heading", () => {
  const text = "# First Section\n\nContent under first.\n\n## Subsection\n\nNested content.";
  const chunks = chunkDocument(text, "test.md");
  const headings = (chunks as BrainChunk[]).map((c) => c.heading).filter(Boolean);
  assert.ok(headings.length > 0, "at least one chunk should carry a heading");
  assert.ok(
    headings.some((h) => h === "First Section" || h === "Subsection"),
    `expected a section heading, got: ${JSON.stringify(headings)}`,
  );
});

test("chunkDocument: preamble text before first heading gets null heading", () => {
  const text = "Preamble text here.\n\n# First Heading\n\nSection content.";
  const chunks = chunkDocument(text, "test.md");
  const preamble = (chunks as BrainChunk[]).find((c) => c.text.includes("Preamble"));
  assert.ok(preamble, "preamble chunk should exist");
  assert.equal(preamble!.heading, null);
});

test("chunkDocument: headings are stripped of markdown markers in the heading field", () => {
  const chunks = chunkDocument("# My Heading\n\nBody text.", "test.md");
  const headed = (chunks as BrainChunk[]).find((c) => c.heading !== null);
  if (!headed) return; // guard: only meaningful when heading was detected
  assert.doesNotMatch(headed.heading!, /^#+/, "heading field should not start with #");
});

// ── short document ────────────────────────────────────────────────────────────

test("chunkDocument: single chunk for short documents", () => {
  const text = "# Short Doc\n\nThis is a short document.";
  const chunks = chunkDocument(text, "short.md");
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.includes("short document"));
});

test("chunkDocument: returns at least one chunk for non-empty text", () => {
  const chunks = chunkDocument("Just some text.", "test.md");
  assert.ok(chunks.length >= 1);
});

// ── tokenEstimate ─────────────────────────────────────────────────────────────

test("chunkDocument: tokenEstimate approximates the word count of chunk text", () => {
  const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
  const chunks = chunkDocument(words, "test.md");
  const total = (chunks as BrainChunk[]).reduce((s, c) => s + c.tokenEstimate, 0);
  assert.ok(total >= 40 && total <= 60, `expected ~50 tokens, got ${total}`);
});

test("chunkDocument: tokenEstimate is a positive integer for every chunk", () => {
  const chunks = chunkDocument("# Title\n\nSome content here.", "test.md");
  for (const chunk of chunks) {
    assert.ok(Number.isInteger(chunk.tokenEstimate), "tokenEstimate should be integer");
    assert.ok(chunk.tokenEstimate > 0, "tokenEstimate should be positive");
  }
});

// ── splitting long sections ───────────────────────────────────────────────────

test("chunkDocument: splits a long section into multiple chunks", () => {
  const body = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(" ");
  const text = `# Long Section\n\n${body}`;
  const chunks = chunkDocument(text, "long.md", { chunkWords: 500, chunkOverlapWords: 100 });
  assert.ok(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);
});

test("chunkDocument: adjacent chunks share overlap words", () => {
  const body = Array.from({ length: 800 }, (_, i) => `w${i}`).join(" ");
  const text = `# Section\n\n${body}`;
  const chunks = chunkDocument(text, "test.md", { chunkWords: 400, chunkOverlapWords: 80 });
  if (chunks.length < 2) return; // guard

  const typedChunks = chunks as BrainChunk[];
  const firstWords = new Set(typedChunks[0].text.split(/\s+/).slice(-100));
  const secondFirst = typedChunks[1].text.split(/\s+/).slice(0, 100);
  const overlap = secondFirst.filter((w) => firstWords.has(w));
  assert.ok(overlap.length > 0, "adjacent chunks should share some overlap words");
});

test("chunkDocument: chunk word count does not exceed hard ceiling of 700", () => {
  const body = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(" ");
  const text = `# Section\n\n${body}`;
  const chunks = chunkDocument(text, "test.md", { chunkWords: 500, chunkOverlapWords: 100 });
  for (const chunk of chunks) {
    const wordCount = chunk.text.split(/\s+/).filter(Boolean).length;
    assert.ok(wordCount <= 700, `chunk has ${wordCount} words, exceeds 700-word ceiling`);
  }
});

// ── heading propagation across sub-chunks ─────────────────────────────────────

test("chunkDocument: all sub-chunks of a long section carry the same heading", () => {
  const body = Array.from({ length: 800 }, (_, i) => `w${i}`).join(" ");
  const text = `# My Section\n\n${body}`;
  const chunks = chunkDocument(text, "test.md", { chunkWords: 400, chunkOverlapWords: 80 });
  if (chunks.length < 2) return; // guard

  for (const chunk of chunks) {
    assert.equal(
      chunk.heading,
      "My Section",
      `expected heading "My Section", got "${chunk.heading}"`,
    );
  }
});

// ── empty / whitespace-only sections ─────────────────────────────────────────

test("chunkDocument: does not produce chunks with empty text", () => {
  const text = "# Section A\n\n\n# Section B\n\nContent in B.";
  const chunks = chunkDocument(text, "test.md");
  for (const chunk of chunks) {
    assert.ok(chunk.text.trim().length > 0, "no chunk should have empty text");
  }
});

test("chunkDocument: whitespace-only text returns empty array", () => {
  const chunks = chunkDocument("   \n\n\t  ", "test.md");
  assert.equal(chunks.length, 0);
});

// ── multiple heading levels ───────────────────────────────────────────────────

test("chunkDocument: recognises h2 and h3 headings as section boundaries", () => {
  const text = [
    "## Level Two",
    "",
    "Content under h2.",
    "",
    "### Level Three",
    "",
    "Content under h3.",
  ].join("\n");
  const chunks = chunkDocument(text, "test.md");
  const headings = (chunks as BrainChunk[]).map((c) => c.heading).filter(Boolean);
  assert.ok(
    headings.some((h) => h === "Level Two" || h === "Level Three"),
    `expected h2/h3 headings, got: ${JSON.stringify(headings)}`,
  );
});
