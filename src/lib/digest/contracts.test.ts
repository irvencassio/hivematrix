import test from "node:test";
import assert from "node:assert/strict";
import { isHttpUrl, digestSlug, digestDocFilename, buildDigestTaskDescription } from "./contracts";

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

test("buildDigestTaskDescription includes the url, the exact write path, and fetch+summarize steps", () => {
  const d = buildDigestTaskDescription({ url: "https://example.com/a", docPath: "/brain/digests/x.md", note: "focus on pricing" });
  assert.match(d, /https:\/\/example\.com\/a/);
  assert.match(d, /\/brain\/digests\/x\.md/);
  assert.match(d, /webbee_search/);
  assert.match(d, /write_file/);
  assert.match(d, /focus on pricing/);
});
