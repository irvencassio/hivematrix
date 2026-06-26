import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("video review approval surface no longer advertises API render", () => {
  const consoleSource = read("src/daemon/console.ts");
  const reviewSource = read("src/lib/video/review.ts");
  const voiceSource = read("src/lib/video/voice-turn.ts");

  for (const source of [consoleSource, reviewSource, voiceSource]) {
    assert.doesNotMatch(source, /Approve &amp; render|render \+ publish|rendering \+ publishing|~\$0\.05|\$0\.05\/sec/i);
  }
  assert.match(consoleSource, /Browser Lane/i);
  assert.match(reviewSource, /Browser Lane/i);
  assert.match(voiceSource, /Browser Lane|portal/i);
});

test("normal video-review approval code does not call make-avatar", () => {
  const newsReview = read("src/lib/video/news-review.ts");
  const approvalStart = newsReview.indexOf("export async function resolveVideoDraft");
  assert.ok(approvalStart > 0, "resolveVideoDraft exists");
  const publishStart = newsReview.indexOf("export interface PublishDraftDeps");
  const approvalSegment = newsReview.slice(approvalStart, publishStart > approvalStart ? publishStart : undefined);

  assert.doesNotMatch(approvalSegment, /make-avatar\.mjs|renderAndPublish|renderConfig/);
  assert.match(approvalSegment, /createPortalTask/);
});
