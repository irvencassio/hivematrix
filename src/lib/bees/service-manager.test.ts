import assert from "node:assert/strict";
import test from "node:test";

import { buildLaunchAgentPlist, getBeeRuntimeDescriptor, summarizeEmbeddedHealthDetail } from "./service-manager";

test("buildLaunchAgentPlist emits a KeepAlive launch agent with the Bee label", () => {
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

test("MessageBee and MailBee are embedded channel pollers (not launchagents)", () => {
  // In HiveMatrix both run in-daemon; status comes from the channel state, and
  // they're managed via their Set up modals (no Bees-panel launchctl toggle).
  const message = getBeeRuntimeDescriptor("messagebee");
  const mail = getBeeRuntimeDescriptor("mailbee");
  assert.equal(message.runtimeMode, "embedded");
  assert.equal(message.manageable, false);
  assert.equal(mail.runtimeMode, "embedded");
  assert.equal(mail.manageable, false);
});

test("ManagerBee and BrainBee are embedded control-plane workers", () => {
  // W4.2: both run in-daemon (heartbeat + curation poller), like the other
  // embedded Bees — no separate launchd repo to ship.
  const manager = getBeeRuntimeDescriptor("managerbee");
  const brain = getBeeRuntimeDescriptor("brainbee");
  assert.equal(manager.runtimeMode, "embedded");
  assert.equal(manager.manageable, false);
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

test("architecture reset exposes WebBee as an embedded Hive capability", () => {
  const webBee = getBeeRuntimeDescriptor("webbee");
  const browserBee = getBeeRuntimeDescriptor("browserbee");
  const unknown = getBeeRuntimeDescriptor("not-a-bee");

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
