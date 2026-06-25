/**
 * Workflow definition: HeyGen portal video from a script.
 *
 * Pure data — discovery metadata only. Execution is the existing
 * `dispatchHeyGenVideoWorkflow` (the `handler` marker maps to it); this module
 * imports only the HeyGen *constants* (site + handoff points), no execution logic.
 */

import { HEYGEN_SITE, HEYGEN_HANDOFF_POINTS } from "@/lib/browser-lane/heygen";
import type { WorkflowDefinition } from "./registry";

export const HEYGEN_PORTAL_VIDEO_WORKFLOW: WorkflowDefinition = {
  id: "heygen.portal_video_from_script",
  name: "HeyGen portal video from script",
  description:
    "Create a HeyGen portal video from a script, routed through Browser Lane readiness with explicit operator handoffs, then publish the local result to YouTube without re-rendering.",
  lane: "browser",
  capability: "workflow.run",
  inputSchema: [
    { name: "script", type: "string", required: true, description: "The narration / script text for the video." },
    { name: "title", type: "string", required: true, description: "The video title." },
    { name: "creativeNotes", type: "string", required: false, description: "Optional creative direction (style, pacing, tone)." },
    { name: "assetPaths", type: "string[]", required: false, description: "Optional local asset paths the operator uploads at the file picker." },
    { name: "project", type: "string", required: false, description: "Optional project label for the routed task." },
  ],
  readiness: {
    required: true,
    siteId: HEYGEN_SITE.id,
    note: "The HeyGen Browser Lane site must be green and fresh — run a readiness check before creating the portal task.",
  },
  approvalPolicy: {
    mode: "manual",
    note: "Login, two-factor, CAPTCHA, the file picker, preview, and export are operator handoffs. Nothing is auto-submitted.",
  },
  handoffPoints: HEYGEN_HANDOFF_POINTS,
  artifacts: [
    "Browser Lane trace timeline for the portal session",
    "Screenshots when the browser backend supports them",
    "Final video URL or a manual completion note recorded on the task, then the published YouTube URL",
  ],
  runbook: "docs/runbooks/heygen-portal-video-pipeline.md",
  routing: {
    domains: [...HEYGEN_SITE.allowedDomains],
    phrases: ["heygen", "portal video", "video from script", "make a video"],
    tags: ["video", "heygen", "portal"],
  },
  handler: "heygen-portal-video",
};
