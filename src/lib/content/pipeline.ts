/**
 * Content pipeline: brief → channel renditions → staged artifacts → approval.
 *
 * Mirrors the W5.1 image-gen shape — a dispatcher that writes task-scoped
 * artifacts and degrades honestly when the backend isn't configured. Each
 * rendition is staged as a markdown artifact (the "files + clipboard handoff"
 * publish path); then one approval request is raised so the founder approves by
 * text (W1.1) before anything is posted. The renderer is injectable for tests.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { ensureScopeDir } from "@/lib/artifacts/paths";
import { Artifact } from "@/lib/artifacts/store";
import { requestCheckpointApproval } from "@/lib/orchestrator/approval";
import {
  CONTENT_CHANNELS,
  buildRenditionPrompt,
  channelLabel,
  contentArtifactFilename,
  type ContentBrief,
  type ContentChannel,
} from "./channels";
import { renderViaCompletion, type ContentRenderResult } from "./render";

export type ContentRenderer = (channel: ContentChannel, brief: ContentBrief) => Promise<ContentRenderResult>;

let contentRendererForTests: ContentRenderer | null = null;

export function _setContentRendererForTests(renderer: ContentRenderer | null): void {
  contentRendererForTests = renderer;
}

const defaultRenderer: ContentRenderer = (channel, brief) => renderViaCompletion(buildRenditionPrompt(brief, channel));

export interface ContentRendition {
  channel: ContentChannel;
  ok: boolean;
  path?: string;
  detail: string;
  chars: number;
}

export interface ContentResult {
  taskId: string;
  brief: ContentBrief;
  renditions: ContentRendition[];
  approvalRequested: boolean;
}

/** Render and stage one artifact per channel. `stamp` is injected for deterministic tests. */
export async function generateRenditions(
  taskId: string,
  brief: ContentBrief,
  channels: readonly ContentChannel[] = CONTENT_CHANNELS,
  stamp: string = "draft",
): Promise<ContentRendition[]> {
  const renderer = contentRendererForTests ?? defaultRenderer;
  const dir = ensureScopeDir("task", taskId);
  const out: ContentRendition[] = [];

  for (const channel of channels) {
    const result = await renderer(channel, brief);
    if (!result.ok) {
      out.push({ channel, ok: false, detail: result.detail, chars: 0 });
      continue;
    }
    const filename = contentArtifactFilename(channel, stamp);
    const path = join(dir, filename);
    writeFileSync(path, result.text);
    const stem = `content-${channel}`;
    Artifact.upsert({
      scope: "task",
      scopeId: taskId,
      filename,
      title: `${channelLabel(channel)} rendition`,
      mimeType: "text/markdown",
      sizeBytes: Buffer.byteLength(result.text),
      stem,
      versionNum: Artifact.nextVersion("task", taskId, stem),
      metadata: { channel },
    });
    out.push({ channel, ok: true, path, detail: "ok", chars: result.text.length });
  }

  return out;
}

/**
 * Full pipeline: generate renditions, then raise one approval gate so the
 * founder signs off by text before publishing. Returns the staged trail.
 */
export async function runContentPipeline(
  taskId: string,
  brief: ContentBrief,
  channels: readonly ContentChannel[] = CONTENT_CHANNELS,
  stamp: string = "draft",
): Promise<ContentResult> {
  const renditions = await generateRenditions(taskId, brief, channels, stamp);
  const staged = renditions.filter((r) => r.ok);

  let approvalRequested = false;
  if (staged.length > 0) {
    requestCheckpointApproval({
      id: taskId,
      gate: "content",
      goal: `Publish: ${brief.topic}`,
      summary: `${staged.length} rendition(s): ${staged.map((r) => channelLabel(r.channel)).join(", ")}`,
    });
    approvalRequested = true;
  }

  return { taskId, brief, renditions, approvalRequested };
}
