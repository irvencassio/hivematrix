import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-youtube-summary-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { extractVideoId, buildYoutubeSummaryMarkdown, prepareYoutubeSummary, parseSummaryResponse } = await import("./youtube-summary");
const { getWorkflowRegistry } = await import("./registry");
const { getWorkflowRun } = await import("./runs");

before(() => { _resetDbForTests(); getDb(); });
after(() => { _resetDbForTests(); delete process.env.HIVEMATRIX_DB_PATH; rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { getDb().exec("DELETE FROM workflow_runs; DELETE FROM workflow_run_events;"); });

// --- extractVideoId ---
test("extractVideoId: watch URL with www", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=9PUaEj0pMYE"), "9PUaEj0pMYE");
});
test("extractVideoId: youtu.be short URL", () => {
  assert.equal(extractVideoId("https://youtu.be/9PUaEj0pMYE"), "9PUaEj0pMYE");
});
test("extractVideoId: no-www watch URL", () => {
  assert.equal(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});
test("extractVideoId: invalid URL → null", () => {
  assert.equal(extractVideoId("not a url"), null);
});
test("extractVideoId: non-YouTube URL → null", () => {
  assert.equal(extractVideoId("https://vimeo.com/123456789"), null);
});
test("extractVideoId: watch URL missing v param → null", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch"), null);
});

// --- buildYoutubeSummaryMarkdown ---
test("buildYoutubeSummaryMarkdown: transcript path includes content and transcriptUsed=true", () => {
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE", videoId: "9PUaEj0pMYE" },
    { transcript: "Hello world this is the transcript.", title: "My Test Video" },
  );
  assert.match(md, /# YouTube summary:/);
  assert.match(md, /My Test Video/);
  assert.match(md, /Hello world this is the transcript/);
  assert.match(md, /transcriptUsed.*true/i);
  assert.match(md, /youtube\.com\/watch\?v=9PUaEj0pMYE/);
});

test("buildYoutubeSummaryMarkdown: no-transcript path includes honest note and transcriptUsed=false", () => {
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE", videoId: "9PUaEj0pMYE" },
    { transcript: null, title: null },
  );
  assert.match(md, /transcriptUsed.*false/i);
  assert.doesNotMatch(md, /Hello world/);
  assert.match(md, /No transcript/i);
  assert.match(md, /Browser Lane|private|login/i);
});

test("buildYoutubeSummaryMarkdown: has the four required sections", () => {
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE", videoId: "9PUaEj0pMYE" },
    { transcript: "some transcript", title: "T" },
  );
  assert.match(md, /^## Summary$/m);
  assert.match(md, /^## Key points$/m);
  assert.match(md, /^## Source \/ transcript status$/m);
  assert.match(md, /^## Limitations$/m);
});

test("buildYoutubeSummaryMarkdown: real summary + key points render under their sections", () => {
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE", videoId: "9PUaEj0pMYE" },
    {
      transcript: "the transcript",
      title: "T",
      summary: "This video explains widgets in three minutes.",
      keyPoints: ["Widgets are blue", "Widgets are cheap"],
    },
  );
  assert.match(md, /This video explains widgets in three minutes\./);
  assert.match(md, /- Widgets are blue/);
  assert.match(md, /- Widgets are cheap/);
  assert.match(md, /summaryGenerated.*true/i);
});

test("buildYoutubeSummaryMarkdown: transcript present but no summary → honest pending note, no hallucination", () => {
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE", videoId: "9PUaEj0pMYE" },
    { transcript: "the captured transcript text", title: "T", summary: null, keyPoints: null },
  );
  assert.match(md, /summaryGenerated.*false/i);
  // Honest: it must say the summary still needs generation/review, not invent one.
  assert.match(md, /needs (generation|review)|not.*generated|pending/i);
  // The transcript is still captured for provenance.
  assert.match(md, /the captured transcript text/);
});

test("buildYoutubeSummaryMarkdown: long transcript is truncated with marker", () => {
  const longTranscript = "word ".repeat(2000);
  const md = buildYoutubeSummaryMarkdown(
    { url: "https://www.youtube.com/watch?v=abc1234defg", videoId: "abc1234defg" },
    { transcript: longTranscript, title: null },
  );
  assert.match(md, /\[truncated\]/i);
});

// --- registry: workflow discoverable ---
test("workflow registry contains content.youtube_summary", () => {
  const def = getWorkflowRegistry().get("content.youtube_summary");
  assert.ok(def, "workflow must be in registry");
  assert.equal(def.lane, "review");
  assert.equal(def.capability, "content.youtube.summary");
  assert.equal(def.handler, "content-youtube-summary");
});

test("registry.match: youtube.com domain matches content.youtube_summary", () => {
  const def = getWorkflowRegistry().match({ domains: ["youtube.com"] });
  assert.ok(def);
  assert.equal(def?.id, "content.youtube_summary");
});

test("registry.match: failed prompt phrase matches content.youtube_summary", () => {
  const def = getWorkflowRegistry().match({
    text: "can you run the YouTube thing that summarizes for: https://www.youtube.com/watch?v=9PUaEj0pMYE",
  });
  assert.ok(def);
  assert.equal(def?.id, "content.youtube_summary");
});

test("registry.match: youtu.be domain matches content.youtube_summary", () => {
  const def = getWorkflowRegistry().match({ domains: ["youtu.be"] });
  assert.ok(def);
  assert.equal(def?.id, "content.youtube_summary");
});

// --- prepareYoutubeSummary: injectable deps (no network) ---
const fakeTranscript = async (_id: string) => "This is the transcript text for the video.";
const fakeTitle = async (_id: string) => "Great Video Title";
const nullTranscript = async (_id: string): Promise<null> => null;
const nullTitle = async (_id: string): Promise<null> => null;

test("prepareYoutubeSummary: transcript → needs_review run + markdown artifact + transcriptUsed=true", async () => {
  const result = await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: fakeTranscript, fetchTitle: fakeTitle },
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "prepared");
  assert.ok(result.runId);
  assert.equal(result.transcriptUsed, true);
  assert.match(result.markdown, /Great Video Title/);
  assert.match(result.markdown, /This is the transcript text/);

  const run = getWorkflowRun(result.runId!);
  assert.ok(run);
  assert.equal(run.workflowId, "content.youtube_summary");
  assert.equal(run.status, "needs_review");
  assert.ok(run.artifacts.summaryMarkdown);
  assert.equal(run.artifacts.transcriptUsed, true);
  assert.doesNotMatch(JSON.stringify(run), /password|cookie|secret|credentialRef|\btoken\b/i);
});

test("prepareYoutubeSummary: no transcript → run with transcriptUsed=false and honest markdown", async () => {
  const result = await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: nullTranscript, fetchTitle: nullTitle },
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "prepared");
  assert.equal(result.transcriptUsed, false);
  assert.match(result.markdown, /No transcript/i);

  const run = getWorkflowRun(result.runId!);
  assert.ok(run);
  assert.equal(run.artifacts.transcriptUsed, false);
});

test("prepareYoutubeSummary: missing url → needs_input", async () => {
  const result = await prepareYoutubeSummary({ url: "" }, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, "needs_input");
  assert.ok(result.missing?.includes("url"));
});

test("prepareYoutubeSummary: non-YouTube URL → needs_input with reason", async () => {
  const result = await prepareYoutubeSummary({ url: "https://vimeo.com/123" }, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, "needs_input");
  assert.ok(result.reason);
});

test("prepareYoutubeSummary: does not create browser-lane tasks", async () => {
  await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: fakeTranscript, fetchTitle: fakeTitle },
  );
  const taskCount = getDb()
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE source = 'browser-lane'")
    .get() as { n: number };
  assert.equal(taskCount.n, 0);
});

// --- summarizer injection ---
const fakeSummarizer = async (_input: { transcript: string; title: string | null; url: string }) => ({
  summary: "A crisp injected summary.",
  keyPoints: ["First key point", "Second key point"],
});

test("prepareYoutubeSummary: injected summarizer produces a real summary artifact", async () => {
  const result = await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: fakeTranscript, fetchTitle: fakeTitle, summarize: fakeSummarizer },
  );
  assert.equal(result.ok, true);
  assert.equal(result.summaryGenerated, true);
  assert.match(result.markdown, /A crisp injected summary\./);
  assert.match(result.markdown, /- First key point/);

  const run = getWorkflowRun(result.runId!);
  assert.ok(run);
  assert.equal(run.artifacts.summaryGenerated, true);
  assert.match(String(run.artifacts.summaryMarkdown), /A crisp injected summary\./);
});

test("prepareYoutubeSummary: summarizer is NOT called when transcript is missing (no hallucination)", async () => {
  let called = false;
  const spySummarizer = async () => {
    called = true;
    return { summary: "should never appear", keyPoints: [] };
  };
  const result = await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: nullTranscript, fetchTitle: nullTitle, summarize: spySummarizer },
  );
  assert.equal(called, false, "summarizer must not run without a transcript");
  assert.equal(result.summaryGenerated, false);
  assert.doesNotMatch(result.markdown, /should never appear/);
});

test("prepareYoutubeSummary: transcript but summarizer returns null → honest, transcriptUsed stays true", async () => {
  const result = await prepareYoutubeSummary(
    { url: "https://www.youtube.com/watch?v=9PUaEj0pMYE" },
    { fetchTranscript: fakeTranscript, fetchTitle: fakeTitle, summarize: async () => null },
  );
  assert.equal(result.transcriptUsed, true);
  assert.equal(result.summaryGenerated, false);
  assert.match(result.markdown, /needs (generation|review)|pending/i);
});

// --- parseSummaryResponse ---
test("parseSummaryResponse: parses SUMMARY + KEY POINTS blocks", () => {
  const parsed = parseSummaryResponse(
    "SUMMARY: It is about cats.\nKEY POINTS:\n- Cats nap\n- Cats eat\n",
  );
  assert.ok(parsed);
  assert.equal(parsed!.summary, "It is about cats.");
  assert.deepEqual(parsed!.keyPoints, ["Cats nap", "Cats eat"]);
});

test("parseSummaryResponse: empty / contentless → null", () => {
  assert.equal(parseSummaryResponse(""), null);
  assert.equal(parseSummaryResponse("   "), null);
});

// --- prepareWorkflowById dispatcher ---
test("prepareWorkflowById: content.youtube_summary is dispatched (not unsupported)", async () => {
  const { prepareWorkflowById } = await import("./prepare");
  const out = await prepareWorkflowById("content.youtube_summary", {
    url: "https://www.youtube.com/watch?v=9PUaEj0pMYE",
  });
  assert.notEqual(out.status, "unsupported");
  // Will be prepared (live net fails gracefully → still prepared with no-transcript markdown)
  // or needs_input if video id extraction somehow fails — but it must not be unsupported.
  assert.ok(out.status === "prepared" || out.status === "needs_input");
});
