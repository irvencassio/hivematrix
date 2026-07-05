/**
 * YouTube watcher poll loop. Runs inside the daemon, gated by config.
 *
 * Per tick:
 *  1. List the configured playlist (Data API) and diff against seen ids.
 *  2. On first ever run, SEED — mark everything currently in the playlist as seen
 *     so we don't summarize the entire backlog; only future additions get docs.
 *  3. For each genuinely new video, fetch its transcript (best-effort) and spawn
 *     a summarization task (source "youtube").
 *  4. For every completed summary task, render a standalone HTML brain doc with
 *     the thumbnail + link, write it under <brain>/youtube/, and notify once.
 *
 * The LLM only writes the summary text; doc rendering + delivery are deterministic.
 */

import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Task } from "@/lib/db";
import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { notify } from "@/lib/notify/notify";
import { getYouTubeConfig, isYouTubeWatcherEnabled } from "./config";
import { fetchPlaylistItems } from "./api";
import { fetchTranscript } from "./transcript";
import { newVideos, renderVideoDoc, videoDocFilename, type PlaylistVideo } from "./contracts";
import { seenIds, markSeen, isWritten, markWritten, recordPoll } from "./store";

interface YouTubeTaskOutput {
  youtube?: { video: PlaylistVideo; fromTranscript: boolean };
  summary?: string;
}

async function createSummaryTask(video: PlaylistVideo): Promise<void> {
  const transcript = await fetchTranscript(video.videoId);
  const fromTranscript = !!transcript;
  const basis = (transcript ?? video.description ?? "").slice(0, 24_000);
  const description = [
    "Summarize this YouTube video for later review. Write a concise, information-dense summary:",
    "a 4-8 sentence overview, then 3-6 key takeaways as bullet points. Plain text only.",
    "",
    `Title: ${video.title}`,
    `Channel: ${video.channelTitle}`,
    `URL: ${video.url}`,
    "",
    `--- ${fromTranscript ? "Transcript" : "Description (no transcript available)"} ---`,
    basis || "(no transcript or description available — summarize from the title alone and say so)",
  ].join("\n");

  await Task.create({
    title: `[youtube] ${video.title.slice(0, 60)}`,
    description,
    project: DEFAULT_TASK_PROJECT,
    projectPath: homedir(),
    profile: "researcher",
    status: "backlog",
    executor: "agent",
    source: "youtube",
    output: { youtube: { video, fromTranscript } },
  });
}

async function writeBrainDoc(video: PlaylistVideo, html: string, dateStr: string): Promise<string | null> {
  const root = configuredBrainRootDir();
  if (!root) return null;
  const dir = join(root, "youtube");
  const file = join(dir, videoDocFilename(video, dateStr));
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, html);
    return file;
  } catch {
    return null;
  }
}

/** Render docs + notify for any completed summary task we haven't delivered yet. */
async function deliverCompletedSummaries(): Promise<void> {
  const tasks = await Task.find({ source: "youtube", status: { $in: ["review", "done"] } });
  for (const task of tasks) {
    const out = (task.output ?? {}) as YouTubeTaskOutput;
    const video = out.youtube?.video;
    if (!video || isWritten(video.videoId)) continue;
    const summary = typeof out.summary === "string" ? out.summary.trim() : "";
    if (!summary) continue; // task not finished producing a summary yet

    const generatedAt = new Date().toISOString();
    const html = renderVideoDoc({ video, summary, fromTranscript: out.youtube?.fromTranscript ?? false, generatedAt });
    const path = await writeBrainDoc(video, html, generatedAt.slice(0, 10));
    if (!path) continue; // brain root unreachable — retry next tick

    markWritten(video.videoId);
    await notify(`📺 New video summarized for review: ${video.title}\n${video.url}`);
  }
}

/** One poll cycle. Safe to call on a tick; never throws. */
export async function pollOnce(): Promise<void> {
  if (!isYouTubeWatcherEnabled()) return;
  const cfg = getYouTubeConfig()!;
  try {
    const res = await fetchPlaylistItems({ apiKey: cfg.apiKey, playlistId: cfg.playlistId, maxResults: 50 });
    if (!res.ok) {
      recordPoll(`playlist fetch failed (HTTP ${res.status}): ${res.error}`);
      return;
    }

    const seen = seenIds();
    if (seen.size === 0) {
      // First run: seed so we don't summarize the whole existing backlog.
      markSeen(res.videos.map((v) => v.videoId));
    } else {
      const fresh = newVideos(res.videos, seen).slice(0, cfg.maxPerTick);
      for (const video of fresh) {
        await createSummaryTask(video);
        markSeen([video.videoId]);
      }
    }

    await deliverCompletedSummaries();
    recordPoll(null);
  } catch (err) {
    recordPoll(err instanceof Error ? err.message : String(err));
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the watcher loop (idempotent). Interval comes from config (minutes). */
export function startYouTubeWatcherPoller(): () => void {
  if (timer) return stopYouTubeWatcherPoller;
  const cfg = getYouTubeConfig();
  const intervalMs = Math.max(1, cfg?.pollIntervalMinutes ?? 30) * 60_000;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void pollOnce()
      .catch((e) => { console.error(`[youtube] tick failed: ${e instanceof Error ? e.message : e}`); })
      .finally(() => { running = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopYouTubeWatcherPoller;
}

export function stopYouTubeWatcherPoller(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
