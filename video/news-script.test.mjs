import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnthropicPrompt,
  buildDefaultTitle,
  buildDescription,
  buildTemplateScript,
  selectAiHeadlines,
} from "./news-script.mjs";

const sampleStories = [
  { title: "OpenAI ships a new coding model", url: "https://example.com/openai", score: 430, source: "hn" },
  { title: "Local LLM tooling gets faster on Apple Silicon", url: "https://example.com/local", score: 120, source: "hn" },
  { title: "New GPU cluster raises AI training capacity", url: "https://example.com/gpu", score: 95, source: "hn" },
  { title: "A nice CSS layout trick", url: "https://example.com/css", score: 80, source: "hn" },
];

test("selectAiHeadlines filters AI-related stories and keeps top scoring items", () => {
  const selected = selectAiHeadlines(sampleStories, { limit: 2 });
  assert.deepEqual(selected.map((s) => s.title), [
    "OpenAI ships a new coding model",
    "Local LLM tooling gets faster on Apple Silicon",
  ]);
});

test("buildDefaultTitle uses a stable long-form date", () => {
  assert.equal(buildDefaultTitle(new Date("2026-06-22T12:00:00Z")), "Top AI News - June 22, 2026");
});

test("buildTemplateScript creates a spoken presenter script from three stories", () => {
  const script = buildTemplateScript(sampleStories.slice(0, 3), { date: new Date("2026-06-22T12:00:00Z") });
  assert.match(script, /Here are the top AI stories for June 22, 2026/);
  assert.match(script, /OpenAI ships a new coding model/);
  assert.match(script, /Local LLM tooling gets faster on Apple Silicon/);
  assert.match(script, /New GPU cluster raises AI training capacity/);
  assert.doesNotMatch(script, /^[-*]/m);
});

test("buildDescription includes source links without markdown bullets", () => {
  const description = buildDescription(sampleStories.slice(0, 2), { title: "Top AI News - June 22, 2026" });
  assert.match(description, /Top AI News - June 22, 2026/);
  assert.match(description, /1\. OpenAI ships a new coding model - https:\/\/example\.com\/openai/);
  assert.match(description, /2\. Local LLM tooling gets faster on Apple Silicon - https:\/\/example\.com\/local/);
});

test("buildAnthropicPrompt requests plain conversational speech", () => {
  const prompt = buildAnthropicPrompt(sampleStories.slice(0, 3), { date: new Date("2026-06-22T12:00:00Z") });
  assert.match(prompt, /90-second spoken script/);
  assert.match(prompt, /no bullet points/);
  assert.match(prompt, /OpenAI ships a new coding model/);
});

