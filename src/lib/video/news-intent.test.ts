import test from "node:test";
import assert from "node:assert/strict";
import { isAiNewsVideoRequest } from "./news-intent";

test("matches AI-news video requests", () => {
  for (const s of [
    "create a video of AI news today using video factory",
    "create a video using video factory of AI news for today",
    "make an AI news video",
    "draft a video of today's AI news",
    "generate a news video for me",
    "produce a video of the top AI headlines",
  ]) assert.equal(isAiNewsVideoRequest(s), true, s);
});

test("does NOT match non-AI-news-video requests", () => {
  for (const s of [
    "create a video about how to onboard a customer",  // video, no news
    "summarize today's AI news",                        // news, no video
    "make a marketing video for the launch",            // video, no news
    "what's in the news today",                         // no create, no video
    "review the video script",                          // no create-a-video intent
    "",
  ]) assert.equal(isAiNewsVideoRequest(s), false, s);
});
