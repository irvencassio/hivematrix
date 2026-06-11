import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthBeeHealthSnapshot,
  buildAuthBeeProviderReadiness,
  buildAuthBeeSessionPlaneSummary,
  normalizeAuthBeeSessionEntry,
  normalizeAuthBeeSessionEntries,
} from "./contracts";

test("normalizeAuthBeeSessionEntry derives provider slugs and expires stale sessions", () => {
  const session = normalizeAuthBeeSessionEntry(
    {
      provider: "LinkedIn",
      label: "Recruiter browser profile",
      kind: "cookie_jar",
      project: "hive",
      domains: ["linkedin.com", "www.linkedin.com"],
      expiresAt: "2026-05-09T09:00:00.000Z",
    },
    { now: new Date("2026-05-10T09:00:00.000Z") },
  );

  assert.equal(session.provider, "linkedin");
  assert.equal(session.kind, "cookie_jar");
  assert.equal(session.status, "expired");
  assert.deepEqual(session.domains, ["linkedin.com", "www.linkedin.com"]);
});

test("normalizeAuthBeeSessionEntries skips malformed persisted records", () => {
  const sessions = normalizeAuthBeeSessionEntries([
    { provider: "gmail", label: "Inbox OAuth", kind: "oauth", status: "ready" },
    { provider: "", label: "bad" },
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.provider, "gmail");
});

test("normalizeAuthBeeSessionEntries preserves persisted updatedAt ordering", () => {
  const sessions = normalizeAuthBeeSessionEntries([
    {
      provider: "youtube",
      label: "YouTube main profile",
      kind: "cookie_jar",
      status: "ready",
      updatedAt: "2026-05-10T10:00:00.000Z",
    },
    {
      provider: "codex",
      label: "Codex CLI auth",
      kind: "cli_auth",
      status: "ready",
      updatedAt: "2026-05-10T11:00:00.000Z",
    },
  ]);

  assert.equal(sessions[0]?.provider, "codex");
  assert.equal(sessions[0]?.updatedAt, "2026-05-10T11:00:00.000Z");
  assert.equal(sessions[1]?.provider, "youtube");
  assert.equal(sessions[1]?.updatedAt, "2026-05-10T10:00:00.000Z");
});

test("buildAuthBeeHealthSnapshot counts session states and provider readiness", () => {
  const sessions = [
    normalizeAuthBeeSessionEntry(
      {
        provider: "gmail",
        label: "Inbox OAuth",
        kind: "oauth",
        status: "ready",
        lastVerifiedAt: "2026-05-10T10:00:00.000Z",
      },
      { now: new Date("2026-05-10T10:05:00.000Z") },
    ),
    normalizeAuthBeeSessionEntry(
      {
        provider: "linkedin",
        label: "LinkedIn cookies",
        kind: "cookie_jar",
        status: "needs_reauth",
      },
      { now: new Date("2026-05-10T10:05:00.000Z") },
    ),
  ];

  const health = buildAuthBeeHealthSnapshot({
    sessions,
    providerReadiness: [
      buildAuthBeeProviderReadiness({
        provider: "codex",
        label: "Codex CLI auth",
        kind: "cli_auth",
        configured: true,
        authMode: "subscription",
      }),
    ],
  });

  assert.equal(health.counts.total, 2);
  assert.equal(health.counts.ready, 1);
  assert.equal(health.counts.needsReauth, 1);
  assert.equal(health.latestVerifiedAt, "2026-05-10T10:00:00.000Z");
  assert.equal(health.sessionPlane.total, 1);
  assert.equal(health.sessionPlane.needsReauth, 1);
  assert.deepEqual(health.sessionPlane.providers, ["linkedin"]);
  assert.equal(health.providerReadiness[0]?.status, "ready");
});

test("buildAuthBeeSessionPlaneSummary tracks browser-capable sessions and attachments", () => {
  const sessions = [
    normalizeAuthBeeSessionEntry(
      {
        provider: "youtube",
        label: "YouTube main profile",
        kind: "cookie_jar",
        status: "ready",
        attachedTo: ["browserbee", "tubebee"],
        domains: ["youtube.com"],
      },
      { now: new Date("2026-05-10T10:00:00.000Z") },
    ),
    normalizeAuthBeeSessionEntry(
      {
        provider: "vodafone",
        label: "Vodafone import session",
        kind: "session_attachment",
        status: "needs_reauth",
        attachedTo: ["browserbee"],
        domains: ["vodafone.com"],
      },
      { now: new Date("2026-05-10T10:05:00.000Z") },
    ),
    normalizeAuthBeeSessionEntry(
      {
        provider: "codex",
        label: "Codex CLI auth",
        kind: "cli_auth",
        status: "ready",
      },
      { now: new Date("2026-05-10T10:10:00.000Z") },
    ),
  ];

  const summary = buildAuthBeeSessionPlaneSummary(sessions);

  assert.equal(summary.total, 2);
  assert.equal(summary.ready, 1);
  assert.equal(summary.needsReauth, 1);
  assert.deepEqual(summary.providers, ["vodafone", "youtube"]);
  assert.deepEqual(summary.attachedCapabilities, ["browserbee", "tubebee"]);
});
