import test from "node:test";
import assert from "node:assert/strict";
import { stripThinkBlocks } from "./generic-agent";

test("stripThinkBlocks: no think block passes through unchanged", () => {
  const result = stripThinkBlocks("Hello world");
  assert.equal(result.content, "Hello world");
  assert.equal(result.reasoning, "");
});

test("stripThinkBlocks: strips a complete think block", () => {
  const result = stripThinkBlocks("<think>reasoning here</think>answer here");
  assert.equal(result.content, "answer here");
  assert.equal(result.reasoning, "reasoning here");
});

test("stripThinkBlocks: strips think block at start, preserves rest", () => {
  const result = stripThinkBlocks("<think>let me think</think>The answer is 42.");
  assert.equal(result.content, "The answer is 42.");
  assert.equal(result.reasoning, "let me think");
});

test("stripThinkBlocks: handles unclosed think block (streaming edge case)", () => {
  const result = stripThinkBlocks("<think>partial reasoning without close");
  assert.equal(result.content, "");
  assert.equal(result.reasoning, "partial reasoning without close");
});

test("stripThinkBlocks: multiple think blocks extracted", () => {
  const result = stripThinkBlocks("before<think>r1</think>middle<think>r2</think>end");
  assert.equal(result.content, "beforemiddleend");
  assert.equal(result.reasoning, "r1r2");
});

test("stripThinkBlocks: no leading whitespace in content", () => {
  const result = stripThinkBlocks("<think>r</think>  answer");
  assert.equal(result.content, "answer");
});

test("stripThinkBlocks: empty string", () => {
  const result = stripThinkBlocks("");
  assert.equal(result.content, "");
  assert.equal(result.reasoning, "");
});

test("stripThinkBlocks: think block contains nested content safely", () => {
  const result = stripThinkBlocks("<think>I should call the tool with value='hello'</think>CALLING TOOL");
  assert.equal(result.content, "CALLING TOOL");
  assert.ok(result.reasoning.includes("hello"));
});
