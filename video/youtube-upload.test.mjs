import test from "node:test";
import assert from "node:assert/strict";
import { buildPublishArgs } from "./youtube-upload.mjs";

test("buildPublishArgs maps setup-note upload flags to publish.mjs", () => {
  const args = buildPublishArgs([
    "out/news.mp4",
    "--title",
    "Top AI News",
    "--description",
    "Today",
    "--tags",
    "AI,news",
    "--privacy",
    "private",
  ]);
  assert.deepEqual(args, [
    "publish.mjs",
    "out/news.mp4",
    "--title",
    "Top AI News",
    "--description",
    "Today",
    "--tags",
    "AI,news",
    "--privacy",
    "private",
    "--kind",
    "avatar",
  ]);
});

test("buildPublishArgs preserves explicit kind", () => {
  const args = buildPublishArgs(["out/news.mp4", "--title", "Top AI News", "--kind", "screen"]);
  assert.deepEqual(args.slice(-2), ["--kind", "screen"]);
});

