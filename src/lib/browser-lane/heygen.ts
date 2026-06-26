/**
 * HeyGen Browser Lane workflow skeleton.
 *
 * Turns a script into a Browser-Lane-ready HeyGen *portal* video task. This is the
 * app.heygen.com portal flow (distinct from the HeyGen API path in video/heygen.mjs).
 *
 * It is a skeleton on purpose: login, two-factor, CAPTCHA, the file picker, preview,
 * and export are explicit OPERATOR HANDOFF points — never automated, never bypassed.
 * No credentials are auto-stored and no secrets appear in the site, probe, rule, or
 * job payload — only the non-secret credentialRef pointer (metadata).
 */

import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";
import { upsertCooRoutingRule } from "@/lib/coo/store";
import { parseBrowserBeeJobCreate, type BrowserBeeJobCreatePayload } from "./jobs";
import { getBrowserSite, upsertBrowserReadinessProbe, upsertBrowserSite } from "./store";
import type { BrowserSite, ReadinessProbe } from "./contracts";

export const HEYGEN_SITE = {
  id: "heygen",
  displayName: "HeyGen",
  homeUrl: "https://app.heygen.com/home",
  loginUrl: "https://app.heygen.com/login",
  createUrl: "https://app.heygen.com/create",
  allowedDomains: ["app.heygen.com", "heygen.com", "auth.heygen.com", "accounts.google.com", "google.com"],
  authStrategy: "google_sso" as const,
  // Google SSO is session-based in Browser Lane. Seeding writes no Keychain
  // credential; providerAccount is operator metadata when configured.
  credentialRef: null,
} as const;

/** Manual operator handoff points — these are never automated by the lane. */
export const HEYGEN_HANDOFF_POINTS: string[] = [
  "MANUAL HANDOFF — Login: if HeyGen shows a sign in / log in page, the operator signs in. Login is never automated.",
  "MANUAL HANDOFF — Two-factor / 2FA: if HeyGen asks for a verification code, pause for the operator to enter it.",
  "MANUAL HANDOFF — CAPTCHA: if a CAPTCHA / \"verify you are human\" challenge appears, pause for the operator.",
  "MANUAL HANDOFF — File picker: if assets must be uploaded, the operator selects files in the native file picker (no automated file injection).",
  "MANUAL HANDOFF — Preview: pause for the operator to review the generated preview before export.",
  "MANUAL HANDOFF — Export: the operator exports / downloads the final video and records the final URL or a completion note in the task result.",
];

export interface SeedHeyGenResult {
  site: BrowserSite;
  probe: ReadinessProbe;
  ruleId: string;
}

/**
 * Idempotently register the HeyGen Browser Lane site, a home readiness probe, and a
 * COO routing rule that sends HeyGen domains to the Browser Lane. Metadata only —
 * no Keychain credential is written.
 */
export function seedHeyGenBrowserSite(): SeedHeyGenResult {
  const existing = getBrowserSite(HEYGEN_SITE.id);
  const allowedDomains = Array.from(new Set([
    ...HEYGEN_SITE.allowedDomains,
    ...(existing?.allowedDomains ?? []),
  ].map((domain) => domain.toLowerCase())));
  const site = upsertBrowserSite({
    id: HEYGEN_SITE.id,
    displayName: HEYGEN_SITE.displayName,
    homeUrl: HEYGEN_SITE.homeUrl,
    loginUrl: HEYGEN_SITE.loginUrl,
    allowedDomains,
    authStrategy: existing?.authStrategy ?? HEYGEN_SITE.authStrategy,
    credentialRef: existing?.credentialRef ?? HEYGEN_SITE.credentialRef,
    providerAccount: existing?.providerAccount ?? null,
    notes: existing?.notes ?? "HeyGen portal video workflow. Google SSO session is maintained by Browser Lane persistent WebKit storage.",
  });

  const probe = upsertBrowserReadinessProbe({
    id: "heygen-home",
    siteId: HEYGEN_SITE.id,
    name: "HeyGen home",
    url: HEYGEN_SITE.homeUrl,
    // The signed-in app shows the create affordance; a login wall yields a password
    // field → human_required(login) instead, so we never fake green when logged out.
    assertions: [{ kind: "text", value: "Create video", optional: false }],
    requiresAuth: true,
  });

  const ruleId = "heygen.video";
  upsertCooRoutingRule({
    id: ruleId,
    name: "HeyGen video workflow",
    priority: 80,
    intent: "authenticated_browser_workflow",
    match: { domains: ["heygen.com"], phrases: ["heygen"] },
    lane: "browser",
    capability: "workflow.run",
    riskTier: "external_side_effect",
    notes: "Route HeyGen portal video work to the Browser Lane (authenticated workflow).",
  }, "heygen-seed");

  return { site, probe, ruleId };
}

export interface HeyGenVideoInput {
  script: string;
  title: string;
  creativeNotes?: string;
  assetPaths?: string[];
  project?: string;
}

/**
 * Build a Browser-Lane-ready HeyGen video job from a script. Contains the script,
 * title, creative notes, and asset *paths* (the operator selects them at the file
 * picker) — never credentials or secrets.
 */
export function buildHeyGenVideoJob(input: HeyGenVideoInput): BrowserBeeJobCreatePayload {
  const title = input.title.trim() || "Untitled HeyGen video";
  const script = input.script.trim();
  const creative = input.creativeNotes?.trim();
  const assets = (input.assetPaths ?? []).map((p) => p.trim()).filter(Boolean);

  const objective = `Create a HeyGen video from the provided script in the HeyGen portal: "${title}".`
    + (creative ? ` Creative direction: ${creative}.` : "");

  const steps = [
    ...HEYGEN_HANDOFF_POINTS,
    "Open the HeyGen create flow and choose the avatar and voice that fit the creative direction.",
    "Paste the provided script into the script field exactly as given.",
    assets.length
      ? `If the creative direction needs assets, the operator uploads them via the file picker: ${assets.join(", ")}.`
      : "No asset uploads are expected for this video.",
    "Generate the video, then pause at the preview handoff before exporting.",
  ];

  const notes = [
    `Title: ${title}`,
    creative ? `Creative notes: ${creative}` : null,
    assets.length ? `Asset paths (operator-selected at the file picker): ${assets.join(", ")}` : null,
    "--- SCRIPT ---",
    script,
  ].filter(Boolean).join("\n");

  return parseBrowserBeeJobCreate({
    title: `HeyGen video — ${title}`,
    objective,
    project: input.project?.trim() || DEFAULT_TASK_PROJECT,
    startUrl: HEYGEN_SITE.createUrl,
    siteLabel: HEYGEN_SITE.id,
    requestedBy: "heygen-workflow",
    requiresLogin: true,
    runMode: "manual_escalation",
    approvalMode: "manual",
    jobType: "form_fill",
    allowedDomains: HEYGEN_SITE.allowedDomains,
    steps,
    successCriteria: [
      "The video is generated in HeyGen and its final URL (or a manual completion note) is recorded in the task result.",
    ],
    artifactPolicy: "screenshots",
    tracePolicy: "timeline",
    notes,
  });
}
