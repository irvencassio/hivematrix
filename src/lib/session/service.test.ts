import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthBeeHealth, deleteAuthBeeSession, listAuthBeeSessions, resolveAuthBeeBrowserSession, upsertAuthBeeSession } from "./service";

test("upsertAuthBeeSession normalizes and stores session metadata on the provided config object", () => {
  const config: Record<string, unknown> = {};

  const created = upsertAuthBeeSession(
    config,
    {
      provider: "LinkedIn",
      label: "Recruiter browser session",
      kind: "cookie_jar",
      project: "hive",
      sessionLabel: "recruiting",
      domains: ["linkedin.com", "www.linkedin.com"],
      attachedTo: ["browserbee"],
      secretRef: "~/Library/Application Support/Hive/browser-profiles/linkedin",
    },
    { now: new Date("2026-05-10T10:00:00.000Z") },
  );

  assert.equal(created.created, true);
  assert.equal(created.entry.provider, "linkedin");
  assert.equal(created.entry.updatedAt, "2026-05-10T10:00:00.000Z");

  const sessions = listAuthBeeSessions(config);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.sessionLabel, "recruiting");
});

test("deleteAuthBeeSession removes an existing session and reports missing ids", () => {
  const config: Record<string, unknown> = {};
  const created = upsertAuthBeeSession(config, {
    provider: "gmail",
    label: "Inbox OAuth",
    kind: "oauth",
    status: "ready",
  });

  assert.equal(deleteAuthBeeSession(config, created.entry.id), true);
  assert.equal(deleteAuthBeeSession(config, created.entry.id), false);
  assert.equal(listAuthBeeSessions(config).length, 0);
});

test("buildAuthBeeHealth summarizes stored sessions plus known provider readiness", () => {
  const config: Record<string, unknown> = {};
  upsertAuthBeeSession(
    config,
    {
      provider: "gmail",
      label: "Inbox OAuth",
      kind: "oauth",
      status: "ready",
      lastVerifiedAt: "2026-05-10T10:00:00.000Z",
    },
    { now: new Date("2026-05-10T10:05:00.000Z") },
  );
  upsertAuthBeeSession(
    config,
    {
      provider: "linkedin",
      label: "Recruiter cookies",
      kind: "cookie_jar",
      status: "needs_reauth",
    },
    { now: new Date("2026-05-10T10:06:00.000Z") },
  );

  const health = buildAuthBeeHealth(config, [
    {
      provider: "codex",
      label: "Codex CLI auth",
      kind: "cli_auth",
      configured: true,
      authMode: "subscription",
    },
  ]);

  assert.equal(health.counts.total, 2);
  assert.equal(health.counts.ready, 1);
  assert.equal(health.counts.needsReauth, 1);
  assert.equal(health.latestVerifiedAt, "2026-05-10T10:00:00.000Z");
  assert.ok(health.providerReadiness.some((entry) => entry.provider === "codex" && entry.status === "ready"));
  assert.ok(health.providerReadiness.some((entry) => entry.provider === "gmail"));
});

test("resolveAuthBeeBrowserSession auto-matches a ready browser session by domain", () => {
  const config: Record<string, unknown> = {};
  upsertAuthBeeSession(
    config,
    {
      provider: "LinkedIn",
      label: "Recruiter browser session",
      kind: "cookie_jar",
      status: "ready",
      sessionLabel: "recruiting",
      domains: ["linkedin.com"],
      attachedTo: ["browserbee"],
    },
    { now: new Date("2026-05-10T10:00:00.000Z") },
  );

  const resolution = resolveAuthBeeBrowserSession(config, {
    host: "www.linkedin.com",
    attachedTo: ["browserbee"],
  });

  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.matchedBy, "domain");
    assert.equal(resolution.session.sessionLabel, "recruiting");
    assert.equal(resolution.session.provider, "linkedin");
  }
});
