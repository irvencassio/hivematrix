/**
 * Content pipeline — channels and prompts (pure).
 *
 * One content brief fans out into channel renditions (LinkedIn post, X thread,
 * newsletter section, video script) using the `marketing` agent voice. This
 * module owns the channel list and the per-channel prompt; the pipeline renders
 * and stages them, then asks the founder to approve by text before publishing.
 */

export const CONTENT_CHANNELS = ["linkedin_post", "x_thread", "newsletter_section", "video_script"] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

export function isContentChannel(value: string): value is ContentChannel {
  return (CONTENT_CHANNELS as readonly string[]).includes(value);
}

export interface ContentBrief {
  topic: string;
  audience?: string;
  goal?: string;
  notes?: string;
}

const CHANNEL_GUIDANCE: Record<ContentChannel, string> = {
  linkedin_post:
    "a LinkedIn post (120–200 words): professional but human, one clear hook, 2–4 short paragraphs, a soft call to action, and up to 3 relevant hashtags",
  x_thread:
    "an X/Twitter thread of 4–7 numbered tweets, each ≤280 characters: a strong hook in tweet 1, one idea per tweet, a call to action in the last",
  newsletter_section:
    "a newsletter section (200–350 words) with a bold heading, a narrative middle, and a single takeaway line at the end",
  video_script:
    "a 60–90 second short-form video script with [HOOK], [BODY] beats, and [CTA] markers, written for spoken delivery",
};

const CHANNEL_LABELS: Record<ContentChannel, string> = {
  linkedin_post: "LinkedIn post",
  x_thread: "X thread",
  newsletter_section: "Newsletter section",
  video_script: "Video script",
};

export function channelLabel(channel: ContentChannel): string {
  return CHANNEL_LABELS[channel];
}

export function buildRenditionPrompt(brief: ContentBrief, channel: ContentChannel): string {
  const lines = [
    `You are a marketing content creator. Produce ${CHANNEL_GUIDANCE[channel]}.`,
    "",
    `Topic: ${brief.topic}`,
  ];
  if (brief.audience) lines.push(`Audience: ${brief.audience}`);
  if (brief.goal) lines.push(`Goal: ${brief.goal}`);
  if (brief.notes) lines.push(`Notes: ${brief.notes}`);
  lines.push("", "Return only the finished content, with no preamble or explanation.");
  return lines.join("\n");
}

/** Deterministic artifact filename for a rendition (stamp injected for tests). */
export function contentArtifactFilename(channel: ContentChannel, stamp: string): string {
  return `content-${channel}-${stamp}.md`;
}
