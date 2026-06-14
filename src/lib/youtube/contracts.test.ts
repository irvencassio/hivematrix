import test from "node:test";
import assert from "node:assert/strict";
import { newVideos, videoDocFilename, renderVideoDoc, slugify, escapeHtml, type PlaylistVideo } from "./contracts";
import { mapPlaylistItem } from "./api";
import { extractTranscriptText, pickCaptionTrack } from "./transcript";

function vid(over: Partial<PlaylistVideo> = {}): PlaylistVideo {
  return {
    videoId: over.videoId ?? "abc123",
    title: over.title ?? "How transformers work",
    description: over.description ?? "A deep dive.",
    channelTitle: over.channelTitle ?? "ML Channel",
    addedAt: over.addedAt ?? "2026-06-14T00:00:00.000Z",
    thumbnailUrl: over.thumbnailUrl ?? "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    url: over.url ?? "https://www.youtube.com/watch?v=abc123",
  };
}

test("newVideos filters seen ids and sorts oldest-added first", () => {
  const a = vid({ videoId: "a", addedAt: "2026-06-10T00:00:00Z" });
  const b = vid({ videoId: "b", addedAt: "2026-06-12T00:00:00Z" });
  const c = vid({ videoId: "c", addedAt: "2026-06-11T00:00:00Z" });
  const fresh = newVideos([a, b, c], new Set(["b"]));
  assert.deepEqual(fresh.map((v) => v.videoId), ["a", "c"]); // b filtered, a before c by addedAt
});

test("videoDocFilename is dated, slugged, and id-suffixed (collision-proof)", () => {
  const name = videoDocFilename(vid({ title: "Hello, World! Part 2", videoId: "xY9" }), "2026-06-14");
  assert.equal(name, "2026-06-14-youtube-hello-world-part-2-xY9.html");
});

test("slugify and escapeHtml are safe", () => {
  assert.equal(slugify("  A/B  C!! "), "a-b-c");
  assert.equal(escapeHtml(`<script>"&'`), "&lt;script&gt;&quot;&amp;&#39;");
});

test("renderVideoDoc embeds the thumbnail, link, summary, and escapes hostile titles", () => {
  const html = renderVideoDoc({
    video: vid({ title: `Evil <img onerror=x> "title"`, url: "https://www.youtube.com/watch?v=abc123", thumbnailUrl: "https://i.ytimg.com/vi/abc123/hq.jpg" }),
    summary: "Line one.\n\nLine two with a takeaway.",
    fromTranscript: true,
    generatedAt: "2026-06-14T12:00:00.000Z",
  });
  assert.match(html, /<img class="thumb" src="https:\/\/i\.ytimg\.com\/vi\/abc123\/hq\.jpg"/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=abc123"/);
  assert.match(html, /Line one\./);
  assert.match(html, /Summarized from transcript/);
  assert.doesNotMatch(html, /<img onerror=x>/); // hostile title escaped, not injected
  assert.match(html, /Evil &lt;img onerror=x&gt;/);
});

test("renderVideoDoc notes when there was no transcript", () => {
  const html = renderVideoDoc({ video: vid(), summary: "x", fromTranscript: false, generatedAt: "2026-06-14T12:00:00Z" });
  assert.match(html, /no transcript available/);
});

test("mapPlaylistItem maps a Data API item and picks the best thumbnail", () => {
  const mapped = mapPlaylistItem({
    snippet: {
      title: "T", description: "D", videoOwnerChannelTitle: "Chan", publishedAt: "2026-06-14T00:00:00Z",
      resourceId: { videoId: "vid9" },
      thumbnails: { default: { url: "d" }, high: { url: "h" }, maxres: { url: "m" } },
    },
  });
  assert.ok(mapped);
  assert.equal(mapped!.videoId, "vid9");
  assert.equal(mapped!.channelTitle, "Chan");
  assert.equal(mapped!.thumbnailUrl, "m"); // maxres preferred
  assert.equal(mapped!.url, "https://www.youtube.com/watch?v=vid9");
});

test("mapPlaylistItem returns null without a video id and falls back to a thumbnail", () => {
  assert.equal(mapPlaylistItem({ snippet: { title: "no id" } }), null);
  const noThumb = mapPlaylistItem({ snippet: { resourceId: { videoId: "z1" } } });
  assert.equal(noThumb!.thumbnailUrl, "https://i.ytimg.com/vi/z1/hqdefault.jpg");
});

test("transcript helpers: flatten json3 events and pick the english track", () => {
  assert.equal(
    extractTranscriptText({ events: [{ segs: [{ utf8: "hello " }, { utf8: "world" }] }, { segs: [{ utf8: "!" }] }] }),
    "hello world !",
  );
  assert.equal(pickCaptionTrack([{ baseUrl: "x", languageCode: "fr" }, { baseUrl: "y", languageCode: "en" }]), "y");
  assert.equal(pickCaptionTrack([]), null);
});
