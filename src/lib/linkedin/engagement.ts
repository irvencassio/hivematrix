/**
 * LinkedIn engagement (W5.3) — a daily ritual, not a product surface.
 *
 * It is a scheduled Directive whose work is a domain-locked Browser Lane
 * `site_ops` job: scan the feed/notifications, draft comments/replies in the
 * founder's voice, queue them for approval-by-text (W1.1), post on approve.
 * Every guardrail the workplan calls for is encoded here: navigation locked to
 * linkedin.com, `attached` run mode → manual approval (human-in-the-loop is
 * both the safety and the ToS posture), and a per-run plan checkpoint (W4.1) so
 * the morning run is signed off before it touches anything.
 *
 * This module is pure builders; the Browser Lane executor and the live
 * post remain runtime concerns.
 */

import { join } from "path";
import { parseBrowserBeeJobCreate, type BrowserBeeJobCreatePayload } from "@/lib/browser-lane/jobs";
import type { CreateDirectiveInput } from "@/lib/orchestrator/directive-store";

export const LINKEDIN_DOMAINS = ["linkedin.com", "www.linkedin.com"];
export const LINKEDIN_START_URL = "https://www.linkedin.com/feed/";

/** Brain doc holding the founder's LinkedIn voice/style fingerprint. */
export function linkedinVoiceDocPath(): string {
  return join("hive", "playbooks", "voice", "linkedin.md");
}

export interface LinkedInEngagementOptions {
  project?: string;
  requestedBy?: string;
  voiceNote?: string;
  maxDrafts?: number;
}

/** A validated, linkedin.com-locked, manual-approval Browser Lane job spec. */
export function buildLinkedInEngagementJob(opts: LinkedInEngagementOptions = {}): BrowserBeeJobCreatePayload {
  const maxDrafts = opts.maxDrafts ?? 5;
  return parseBrowserBeeJobCreate({
    title: "LinkedIn daily engagement",
    objective:
      "Scan the LinkedIn feed and notifications, then draft comments and replies in the founder's voice for approval. Never post without explicit approval.",
    project: opts.project ?? "hivematrix",
    startUrl: LINKEDIN_START_URL,
    siteLabel: "LinkedIn",
    requestedBy: opts.requestedBy ?? "founder",
    requiresLogin: true,
    runMode: "attached", // attached → manual approval (human-in-the-loop)
    jobType: "site_ops",
    allowedDomains: LINKEDIN_DOMAINS,
    sessionLabel: "linkedin",
    steps: [
      "Open the LinkedIn feed and the notifications panel.",
      `Identify up to ${maxDrafts} posts or notifications worth engaging with.`,
      "For each, draft a comment or reply in the founder's voice. Do not post anything yet.",
      "Queue the drafts for founder approval.",
      ...(opts.voiceNote ? [`Voice guidance: ${opts.voiceNote}`] : []),
    ],
    successCriteria: [
      `Up to ${maxDrafts} engagement drafts queued for approval`,
      "No comment posted without explicit founder approval",
      "All navigation stayed on linkedin.com",
    ],
    artifactPolicy: "screenshots",
    tracePolicy: "timeline",
    notes: "Domain-locked to linkedin.com; human-approval-in-the-loop and aggressive throttling per W5.3.",
  });
}

export interface LinkedInRitualOptions extends LinkedInEngagementOptions {
  projectPath?: string;
  dailyAtHour?: number;
}

/**
 * The daily-ritual Directive. Runs once each morning, plan-checkpointed so the
 * founder approves the run before it engages, with the LinkedIn voice doc
 * selected into the agent's brain context.
 */
export function buildLinkedInRitualDirective(opts: LinkedInRitualOptions = {}): CreateDirectiveInput {
  const project = opts.project ?? "hivematrix";
  const goal = [
    "LinkedIn daily engagement ritual.",
    "Use the hivematrix_browser tool in workflow mode, domain-locked to linkedin.com, to scan the feed and notifications and draft comments/replies in the founder's voice.",
    "Do not post anything; queue every draft for approval-by-text and post only on approval.",
  ].join(" ");

  return {
    goal,
    profile: "marketing",
    project,
    projectPath: opts.projectPath ?? process.cwd(),
    triggerPolicy: {
      type: "schedule",
      dailyAt: opts.dailyAtHour ?? 9,
      quietHours: { startHour: 22, endHour: 8 },
    },
    approvalPolicy: { checkpoint: "plan" },
    brainSelection: { task: [linkedinVoiceDocPath()], mission: [], session: [] },
    status: "active",
  };
}
