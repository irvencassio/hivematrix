import test from "node:test";
import assert from "node:assert/strict";
import { isHttpUrl, digestSlug, digestDocFilename, buildDigestTaskDescription, youTubeVideoId, isYouTubeUrl, youTubeThumbnailUrl } from "./contracts";

test("isHttpUrl accepts http(s), rejects junk/other schemes", () => {
  assert.equal(isHttpUrl("https://example.com/a"), true);
  assert.equal(isHttpUrl("http://x.io"), true);
  assert.equal(isHttpUrl("ftp://x"), false);
  assert.equal(isHttpUrl("not a url"), false);
  assert.equal(isHttpUrl(""), false);
});

test("digestSlug + filename are safe and host-based", () => {
  assert.equal(digestSlug("https://www.example.com/blog/post-1?x=2"), "example-com-blog-post-1");
  assert.equal(digestDocFilename("https://example.com/a", "2026-06-14"), "2026-06-14-digest-example-com-a.md");
  assert.equal(digestSlug("garbage"), "link");
});

test("buildDigestTaskDescription (article) includes the url, write path, steps, and an applicability section", () => {
  const d = buildDigestTaskDescription({ url: "https://example.com/a", docPath: "/brain/digests/x.md", note: "focus on pricing" });
  assert.match(d, /https:\/\/example\.com\/a/);
  assert.match(d, /\/brain\/digests\/x\.md/);
  assert.match(d, /hivematrix_browser/);
  assert.match(d, /write_file/);
  assert.match(d, /focus on pricing/);
  assert.match(d, /How this applies to me/);
  assert.match(d, /Solo Founder/i);
});

test("youTubeVideoId parses watch, youtu.be, shorts, embed; rejects non-YouTube", () => {
  assert.equal(youTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youTubeVideoId("https://youtube.com/shorts/abc123XYZ"), "abc123XYZ");
  assert.equal(youTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ?start=1"), "dQw4w9WgXcQ");
  assert.equal(youTubeVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=5s"), "dQw4w9WgXcQ");
  assert.equal(youTubeVideoId("https://example.com/watch?v=nope"), null);
  assert.equal(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ"), true);
  assert.equal(isYouTubeUrl("https://example.com/a"), false);
});

test("YouTube digests get an .html filename + slug; the thumbnail URL is predictable", () => {
  assert.equal(digestDocFilename("https://youtu.be/dQw4w9WgXcQ", "2026-07-12"), "2026-07-12-digest-youtube-dqw4w9wgxcq.html");
  assert.equal(digestDocFilename("https://example.com/a", "2026-07-12"), "2026-07-12-digest-example-com-a.md");
  assert.equal(youTubeThumbnailUrl("dQw4w9WgXcQ"), "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
});

test("buildDigestTaskDescription (YouTube) asks for HTML, thumbnail, clickable link, transcript-based summary, and applicability", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const d = buildDigestTaskDescription({ url, docPath: "/brain/digests/2026-07-12-digest-youtube-dQw4w9WgXcQ.html" });
  assert.match(d, /HTML/);
  assert.match(d, /img\.youtube\.com\/vi\/dQw4w9WgXcQ\/maxresdefault\.jpg/);
  assert.match(d, /Watch on YouTube/);
  assert.match(d, /TRANSCRIPT/i);
  assert.match(d, /How this applies to me/);
  assert.match(d, /Solo Founder/i);
  assert.match(d, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
