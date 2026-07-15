import test from "node:test";
import assert from "node:assert/strict";
import { buildFirstRunSetupStatus } from "./setup-status";

function item<T extends { id: string }>(items: T[], id: string): T {
  const found = items.find((i) => i.id === id);
  assert.ok(found, `expected item ${id}`);
  return found;
}

test("full disk access grant is independent from Message Lane enablement", () => {
  const status = buildFirstRunSetupStatus({
    onboarding: {
      requiredComplete: false,
      allComplete: false,
      generatedAt: "T",
      steps: [
        { id: "messagebee", title: "Message Lane", required: false, state: "incomplete", detail: "Message Lane disabled" },
      ],
    },
    fullDiskAccessProbe: {
      enabled: false,
      chatDbReadable: true,
      chatDbDetail: "Messages database readable",
      chatDbProbeSkipped: false,
      identities: [],
      selfHandles: [],
    },
  });

  const permission = item(status.permissions, "fullDiskAccess");
  assert.equal(permission.state, "granted");
  assert.match(permission.detail, /Messages database readable/);

  const lane = item(status.optional, "messageLane");
  assert.notEqual(lane.state, "ready");
});

test("desktop control reports helper reachability separately from permission grants", () => {
  const status = buildFirstRunSetupStatus({
    desktop: {
      helperBuilt: true,
      helperReachable: true,
      permissions: { accessibility: false, screenRecording: true },
    },
  });

  const row = item(status.permissions, "desktopControl");
  assert.equal(row.state, "needs_action");
  assert.match(row.detail, /helper reachable/i);
  assert.match(row.detail, /accessibility=false/);
  assert.match(row.detail, /screenRecording=true/);
});

test("mail automation is not requested passively and granted after explicit probe", () => {
  const passive = buildFirstRunSetupStatus({
    mailAutomationProbe: {
      enabled: false,
      mailControllable: false,
      mailProbeSkipped: true,
      mailProbeReason: "channel_disabled",
      identities: [],
      trustedDomains: [],
      triageAll: false,
    },
  });
  assert.equal(item(passive.permissions, "mailAutomation").state, "not_requested");

  const probed = buildFirstRunSetupStatus({
    mailAutomationProbe: {
      enabled: false,
      mailControllable: true,
      mailProbeSkipped: false,
      identities: [],
      trustedDomains: [],
      triageAll: false,
    },
  });
  assert.equal(item(probed.permissions, "mailAutomation").state, "granted");
});

test("microphone opened is not represented as granted", () => {
  const status = buildFirstRunSetupStatus({ microphoneOpened: true });
  const row = item(status.permissions, "microphone");
  assert.equal(row.state, "opened");
  assert.match(row.detail, /request.*first Talk Mode/i);
});

test("frontier model access is required and reflects the onboarding step (Claude-native cutover)", () => {
  const status = buildFirstRunSetupStatus({
    onboarding: {
      requiredComplete: false,
      allComplete: false,
      generatedAt: "T",
      steps: [
        { id: "frontier", title: "Frontier model access", required: true, state: "incomplete", detail: "no frontier CLI found — install claude or codex to enable text inference" },
      ],
    },
    persona: {
      exists: false,
      detail: "persona not yet created - run the birth ritual",
    },
  });

  const frontierModel = item(status.models, "frontierModel");
  assert.equal(frontierModel.state, "needs_action");
  assert.equal(frontierModel.action, "configure_frontier");
  assert.match(frontierModel.detail, /no frontier CLI found/i);
  assert.equal(item(status.memory, "persona").state, "needs_action");
  assert.match(item(status.memory, "persona").detail, /birth ritual/i);
});

test("full disk access FDA-denied detail names the daemon binary path", () => {
  // When chat.db is inaccessible due to FDA denial, the detail should clearly
  // name the daemon binary path so the user knows exactly what to grant FDA to.
  const status = buildFirstRunSetupStatus({
    fullDiskAccessProbe: {
      enabled: false,
      chatDbReadable: false,
      chatDbDetail: "Cannot open Messages database. The daemon that reads chat.db (Contents/Resources/daemon/bin/node) runs as its own separately-signed process, independent of the HiveMatrix app — granting Full Disk Access to \"HiveMatrix\" in System Settings does not cover it. Reveal the daemon binary in Finder and add it to Full Disk Access directly, then restart the daemon: operation not permitted",
      chatDbProbeSkipped: false,
      identities: [],
      selfHandles: [],
    },
  });

  const fullDiskAccess = item(status.permissions, "fullDiskAccess");
  assert.equal(fullDiskAccess.state, "needs_action");
  // The detail should pass through the daemon binary path and remediation steps.
  assert.match(fullDiskAccess.detail, /Contents\/Resources\/daemon\/bin\/node/i);
  assert.match(fullDiskAccess.detail, /Full Disk Access.*does not cover/i);
  assert.match(fullDiskAccess.detail, /restart the daemon/i);
});

test("full disk access transitions to granted after daemon FDA is granted and restarted", () => {
  // Regression: after the user grants FDA to the daemon binary and restarts it,
  // the status should flip to 'granted' without any manual cache busting.
  const status = buildFirstRunSetupStatus({
    fullDiskAccessProbe: {
      enabled: false,
      chatDbReadable: true, // FDA granted to daemon + daemon restarted = readable
      chatDbDetail: "Messages database readable",
      chatDbProbeSkipped: false,
      identities: [],
      selfHandles: [],
    },
  });

  const fullDiskAccess = item(status.permissions, "fullDiskAccess");
  assert.equal(fullDiskAccess.state, "granted");
  assert.match(fullDiskAccess.detail, /readable/i);
  assert.equal(fullDiskAccess.action, undefined, "granted state should have no action");
});
