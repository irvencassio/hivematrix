import assert from "node:assert/strict";
import test from "node:test";

const { isYoutubeSummaryRequest, extractYoutubeUrlFromText, extractDomainsFromText } = await import(
  "./youtube-summary-intent"
);

const FAILED_PROMPT =
  "can you run the YouTube thing that summarizes for: https://www.youtube.com/watch?v=9PUaEj0pMYE";

// --- isYoutubeSummaryRequest ---
test("isYoutubeSummaryRequest: the exact failed prompt routes to youtube summary", () => {
  assert.equal(isYoutubeSummaryRequest(FAILED_PROMPT), true);
});

test("isYoutubeSummaryRequest: a bare YouTube URL matches by domain", () => {
  assert.equal(isYoutubeSummaryRequest("please look at https://youtu.be/9PUaEj0pMYE"), true);
});

test("isYoutubeSummaryRequest: a phrase with no URL still matches", () => {
  assert.equal(isYoutubeSummaryRequest("summarize this youtube video for me"), true);
});

test("isYoutubeSummaryRequest: an unrelated task does not match", () => {
  assert.equal(isYoutubeSummaryRequest("fix the login bug in the auth flow"), false);
});

test("isYoutubeSummaryRequest: empty/whitespace → false", () => {
  assert.equal(isYoutubeSummaryRequest(""), false);
  assert.equal(isYoutubeSummaryRequest("   "), false);
});

// --- extractYoutubeUrlFromText ---
test("extractYoutubeUrlFromText: pulls the watch URL from the failed prompt", () => {
  assert.equal(
    extractYoutubeUrlFromText(FAILED_PROMPT),
    "https://www.youtube.com/watch?v=9PUaEj0pMYE",
  );
});

test("extractYoutubeUrlFromText: pulls a youtu.be short URL", () => {
  assert.equal(
    extractYoutubeUrlFromText("see https://youtu.be/9PUaEj0pMYE thanks"),
    "https://youtu.be/9PUaEj0pMYE",
  );
});

test("extractYoutubeUrlFromText: ignores non-YouTube URLs", () => {
  assert.equal(extractYoutubeUrlFromText("read https://vimeo.com/123456789"), null);
});

test("extractYoutubeUrlFromText: no URL → null", () => {
  assert.equal(extractYoutubeUrlFromText("summarize that youtube clip"), null);
});

test("extractYoutubeUrlFromText: strips trailing punctuation around the URL", () => {
  assert.equal(
    extractYoutubeUrlFromText("(https://www.youtube.com/watch?v=9PUaEj0pMYE)"),
    "https://www.youtube.com/watch?v=9PUaEj0pMYE",
  );
});

// --- extractDomainsFromText ---
test("extractDomainsFromText: returns hostnames of URLs in the text", () => {
  assert.deepEqual(
    extractDomainsFromText("a https://www.youtube.com/watch?v=9PUaEj0pMYE b https://vimeo.com/1"),
    ["www.youtube.com", "vimeo.com"],
  );
});

test("extractDomainsFromText: no URLs → empty array", () => {
  assert.deepEqual(extractDomainsFromText("no links here"), []);
});
