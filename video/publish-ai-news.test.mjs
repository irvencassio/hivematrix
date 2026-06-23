import test from "node:test";
import assert from "node:assert/strict";
import { buildPipelineCommands, defaultOutPaths } from "./publish-ai-news.mjs";

test("defaultOutPaths creates date-stamped AI news artifacts", () => {
  const paths = defaultOutPaths(new Date("2026-06-22T12:00:00Z"));
  assert.equal(paths.basename, "ai-news-2026-06-22");
  assert.match(paths.script, /video\/out\/ai-news-2026-06-22-script\.txt$/);
  assert.match(paths.video, /video\/out\/ai-news-2026-06-22-avatar\.mp4$/);
});

test("buildPipelineCommands stops after news generation for dry-run", () => {
  const paths = defaultOutPaths(new Date("2026-06-22T12:00:00Z"));
  const commands = buildPipelineCommands({ paths, privacy: "unlisted", dryRun: true });
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].args.slice(0, 3), ["news-script.mjs", "--script-out", paths.script]);
});

test("buildPipelineCommands defaults to HeyGen Video Agent creative render", () => {
  const paths = defaultOutPaths(new Date("2026-06-22T12:00:00Z"));
  const commands = buildPipelineCommands({
    paths,
    privacy: "private",
    style: "style_cinematic",
    orientation: "landscape",
    creativeBrief: "Use sharp animated text cards between stories.",
  });
  assert.equal(commands.length, 3);
  assert.equal(commands[0].args[0], "news-script.mjs");
  assert.deepEqual(commands[1].args, [
    "make-avatar.mjs",
    paths.script,
    paths.video,
    "--mode",
    "agent",
    "--style",
    "style_cinematic",
    "--orientation",
    "landscape",
    "--creative-brief",
    "Use sharp animated text cards between stories.",
  ]);
  assert.deepEqual(commands[2].args, [
    "publish.mjs",
    paths.video,
    "--title-file",
    paths.title,
    "--description-file",
    paths.description,
    "--tags-file",
    paths.tags,
    "--privacy",
    "private",
    "--kind",
    "agent-avatar",
  ]);
});

test("buildPipelineCommands can keep the old direct avatar render", () => {
  const paths = defaultOutPaths(new Date("2026-06-22T12:00:00Z"));
  const commands = buildPipelineCommands({ paths, renderMode: "direct", privacy: "private", kind: "avatar" });
  assert.deepEqual(commands[1].args, ["make-avatar.mjs", paths.script, paths.video, "--mode", "direct"]);
  assert.deepEqual(commands[2].args.slice(-2), ["--kind", "avatar"]);
});
