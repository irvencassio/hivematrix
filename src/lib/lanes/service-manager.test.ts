import assert from "node:assert/strict";
import test from "node:test";

import { buildLaunchAgentPlist, getLaneWorkerRuntimeDescriptor, summarizeEmbeddedHealthDetail, embeddedHealthRoute } from "./service-manager";

test("embeddedHealthRoute points at health routes the daemon actually serves", () => {
  // Regression: these embedded bees showed false "unhealthy / fetch failed" because
  // the probe hit a non-existent path (and the wrong port). Review Lane/brainbee have
  // /api/*/health aliases; browserbee only has /browserbee/health (no /api/ prefix).
  assert.equal(embeddedHealthRoute("review"), "/api/review-lane/health");
  assert.equal(embeddedHealthRoute("brainbee"), "/api/brainbee/health");
  assert.equal(embeddedHealthRoute("browserbee"), "/browserbee/health");
  assert.equal(embeddedHealthRoute("desktopbee"), "/desktopbee/health");
  assert.equal(embeddedHealthRoute("webbee"), null);
});

test("desktopbee is a registered runtime (not 'planned')", () => {
  // Regression: it showed "planned · No runtime registered yet" because it
  // was absent from the descriptor map and fell through to the default.
  assert.equal(getLaneWorkerRuntimeDescriptor("desktopbee").runtimeMode, "embedded");
  // termbee (Terminal Lane) was retired — it now falls through to "planned".
  assert.equal(getLaneWorkerRuntimeDescriptor("termbee").runtimeMode, "planned");
});

test("buildLaunchAgentPlist emits a KeepAlive launch agent with the compatibility label", () => {
  const plist = buildLaunchAgentPlist("inventorbee", {
    autoStart: true,
    repoPath: "/Users/example/inventorbee",
    plistLabel: "com.inventorbee.agent",
    plistPath: "/Users/example/Library/LaunchAgents/com.inventorbee.agent.plist",
  }, "/opt/homebrew/bin/node");

  assert.match(plist, /com\.inventorbee\.agent/);
  assert.match(plist, /KeepAlive/);
  assert.match(plist, /dist\/index\.js/);
});

test("Message and Mail lanes are embedded channel pollers (not launchagents)", () => {
  // In HiveMatrix both run in-daemon; status comes from the channel state, and
  // they're managed via their setup modals (no launchctl toggle).
  const message = getLaneWorkerRuntimeDescriptor("messagebee");
  const mail = getLaneWorkerRuntimeDescriptor("mailbee");
  assert.equal(message.runtimeMode, "embedded");
  assert.equal(message.manageable, false);
  assert.equal(mail.runtimeMode, "embedded");
  assert.equal(mail.manageable, false);
});

test("Review Lane and Memory lanes are embedded control-plane workers", () => {
  // W4.2: both run in-daemon (heartbeat + curation poller), like the other
  // embedded lanes — no separate launchd repo to ship.
  const reviewLane = getLaneWorkerRuntimeDescriptor("review");
  const managerbeeCompat = getLaneWorkerRuntimeDescriptor("managerbee"); // deprecated alias
  const brain = getLaneWorkerRuntimeDescriptor("brainbee");
  assert.equal(reviewLane.runtimeMode, "embedded");
  assert.equal(reviewLane.manageable, false);
  assert.equal(managerbeeCompat.runtimeMode, "embedded"); // compat alias resolves correctly
  assert.equal(managerbeeCompat.manageable, false);
  assert.equal(brain.runtimeMode, "embedded");
  assert.equal(brain.manageable, false);
});

test("buildLaunchAgentPlist includes extra runtime environment variables", () => {
  const plist = buildLaunchAgentPlist("inventorbee", {
    autoStart: true,
    repoPath: "/Users/example/inventorbee",
    plistLabel: "com.inventorbee.agent",
    plistPath: "/Users/example/Library/LaunchAgents/com.inventorbee.agent.plist",
  }, {
    executable: "/Applications/Hive.app/Contents/Frameworks/Hive Helper.app/Contents/MacOS/Hive Helper",
    environment: {
      ELECTRON_RUN_AS_NODE: "1",
    },
  });

  assert.match(plist, /ELECTRON_RUN_AS_NODE/);
  assert.match(plist, /Hive Helper/);
});

test("architecture reset exposes Browser Lane internals as embedded Hive capabilities", () => {
  const webBee = getLaneWorkerRuntimeDescriptor("webbee");
  const browserBee = getLaneWorkerRuntimeDescriptor("browserbee");
  const unknown = getLaneWorkerRuntimeDescriptor("not-a-bee");

  assert.equal(webBee.runtimeMode, "embedded");
  assert.equal(webBee.manageable, false);

  assert.equal(browserBee.runtimeMode, "embedded");
  assert.equal(browserBee.manageable, false);

  assert.equal(unknown.runtimeMode, "planned");
  assert.equal(unknown.manageable, false);
});

test("summarizeEmbeddedHealthDetail surfaces session-plane pressure for browserbee", () => {
  const detail = summarizeEmbeddedHealthDetail("browserbee", {
    bee: "browserbee",
    sessionPlane: {
      total: 3,
      ready: 2,
      needsReauth: 1,
      expired: 0,
      providers: ["youtube", "vodafone"],
    },
  });

  assert.match(detail ?? "", /2 ready/i);
  assert.match(detail ?? "", /1 needs reauth/i);
  assert.match(detail ?? "", /youtube, vodafone/i);
});

test("summarizeEmbeddedHealthDetail surfaces authbee readiness totals", () => {
  const detail = summarizeEmbeddedHealthDetail("authbee", {
    bee: "authbee",
    counts: {
      total: 4,
      ready: 2,
      needsReauth: 1,
      expired: 1,
      missing: 0,
      revoked: 0,
    },
  });

  assert.match(detail ?? "", /2 ready/i);
  assert.match(detail ?? "", /1 needs reauth/i);
  assert.match(detail ?? "", /1 expired/i);
});
