import test from "node:test";
import assert from "node:assert/strict";
import { buildFirstRunSetupStatus } from "./setup-status";
import { LOCAL_MEMORY_PRESETS } from "@/lib/models/local-engine";

const PRESET_32GB = LOCAL_MEMORY_PRESETS.find((preset) => preset.id === "32gb")!;

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

test("local model provisioning is optional until the user starts Rapid-MLX setup", () => {
  const status = buildFirstRunSetupStatus({
    localModel: {
      plan: {
        arch: "arm64",
        ramGB: 32,
        presetId: "32gb",
        mode: "local_agent_light",
        localCapable: true,
        recommendedTiers: ["fast"],
        tiers: [],
        preset: PRESET_32GB,
        tuning: {},
      },
      status: {
        phase: "idle",
        log: [],
        startedAt: null,
        finishedAt: null,
        error: null,
        plan: null,
      },
    },
    persona: {
      exists: false,
      detail: "persona not yet created - run the birth ritual",
    },
  });

  const localModel = item(status.models, "localModel");
  assert.equal(localModel.state, "not_requested");
  assert.equal(localModel.action, "provision_local_model");
  assert.match(localModel.detail, /Optional: provision Rapid-MLX/i);
  assert.match(item(status.models, "localModel").detail, /fast/);
  assert.equal(item(status.memory, "persona").state, "needs_action");
  assert.match(item(status.memory, "persona").detail, /birth ritual/i);
});
