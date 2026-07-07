import test from "node:test";
import assert from "node:assert/strict";
import {
  planLocalEngine,
  getProvisionStatus,
  pythonVersionOk,
  qwenProfileForProvisionPlan,
  resolvedLocalModelPreset,
  syncLocalModelProfilesForProvisionPlan,
} from "./provision";

test("pythonVersionOk: 3.13+ required (rapid-mlx has no 3.9 wheel)", () => {
  assert.equal(pythonVersionOk("3.9"), false);   // the target Mac's system python
  assert.equal(pythonVersionOk("3.12"), false);
  assert.equal(pythonVersionOk("3.13"), true);
  assert.equal(pythonVersionOk("3.14"), true);    // the bundled interpreter
  assert.equal(pythonVersionOk("4.0"), true);
  assert.equal(pythonVersionOk(""), false);       // unknown
});

test("planLocalEngine: 48 GB → one resident tier (fast) resolved to a serve target", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 48 });
  assert.equal(plan.localCapable, true);
  assert.equal(plan.presetId, "48gb");
  assert.equal(plan.mode, "local_agent_standard");
  assert.deepEqual(plan.recommendedTiers, ["fast"]);
  assert.equal(plan.tiers.length, 1);
  assert.equal(plan.tiers[0].alias, "qwen3.6-35b-4bit");
  assert.equal(plan.tiers[0].reasoning, false); // reasoning off by default
});

test("planLocalEngine: 64 GB → both tiers resident", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 64 });
  assert.deepEqual(plan.recommendedTiers, ["fast", "coding"]);
  assert.equal(plan.tiers.length, 2);
});

test("planLocalEngine: 16 GB → cloud-only, no tiers, with a reason", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 16 });
  assert.equal(plan.localCapable, false);
  assert.equal(plan.presetId, "less_than_32gb");
  assert.equal(plan.mode, "frontier_only");
  assert.deepEqual(plan.tiers, []);
  assert.match(plan.reason ?? "", /local model/);
});

test("getProvisionStatus starts idle with an empty log", () => {
  const s = getProvisionStatus();
  assert.equal(s.phase, "idle");
  assert.deepEqual(s.log, []);
  assert.equal(s.error, null);
});

test("qwenProfileForProvisionPlan makes Flash/chat use the fast Qwen tier", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 64 });
  const profile = qwenProfileForProvisionPlan(plan);
  assert.ok(profile);
  assert.equal(profile.primary.modelId, "qwen3.6-35b-4bit");
  assert.equal(profile.primary.endpoint, "http://127.0.0.1:8000/v1");
  assert.equal(profile.primary.provider, "mlx");
  assert.equal(profile.primary.contextLimit, 16384);
  assert.equal(profile.thinkingEnabled, false);
  assert.equal(profile.secondary?.modelId, "qwen3.6-27b-4bit");
  assert.equal(profile.secondary?.endpoint, "http://127.0.0.1:8001/v1");
});

test("resolvedLocalModelPreset stores inspectable role assignments", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 128 });
  const preset = resolvedLocalModelPreset(plan) as { id: string; roles: Record<string, { model?: string; enabled?: boolean; defaultContext?: number }> };
  assert.equal(preset.id, "128gb");
  assert.equal(preset.roles.local_agent_fast.model, "qwen3.6-35b-a3b");
  assert.equal(preset.roles.local_coder_quality.model, "qwen3.6-27b");
  assert.equal(preset.roles.local_coder_quality.defaultContext, 32768);
  assert.equal(preset.roles.local_embeddings.enabled, true);
});

test("qwenProfileForProvisionPlan returns null for cloud-only plans", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 16 });
  assert.equal(qwenProfileForProvisionPlan(plan), null);
});

test("syncLocalModelProfilesForProvisionPlan moves stale managed coding config to fast on 48GB", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 48 });
  const cfg: Record<string, unknown> = {
    qwen: {
      location: "local",
      primary: {
        modelId: "qwen3.6-27b-4bit",
        endpoint: "http://127.0.0.1:8001/v1",
        provider: "mlx",
        contextLimit: 262144,
      },
      thinkingEnabled: false,
      minDecodeRate: 15,
      probeTimeoutMs: 60000,
    },
    localModel: {
      provider: "mlx",
      endpoint: "http://127.0.0.1:8001/v1",
      modelName: "qwen3.6-27b-4bit",
    },
  };

  syncLocalModelProfilesForProvisionPlan(cfg, plan);

  const qwen = cfg.qwen as { primary: { modelId: string; endpoint: string }; secondary: unknown };
  assert.equal(qwen.primary.modelId, "qwen3.6-35b-4bit");
  assert.equal(qwen.primary.endpoint, "http://127.0.0.1:8000/v1");
  assert.equal(qwen.secondary, null);
  assert.deepEqual(cfg.localModel, {
    provider: "mlx",
    endpoint: "http://127.0.0.1:8000/v1",
    modelName: "qwen3.6-35b-4bit",
  });
});

test("syncLocalModelProfilesForProvisionPlan preserves custom non-tier qwen profile", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 48 });
  const cfg: Record<string, unknown> = {
    qwen: {
      location: "local",
      primary: {
        modelId: "custom-mlx-model",
        endpoint: "http://127.0.0.1:9876/v1",
        provider: "mlx",
        contextLimit: 4096,
      },
    },
    localModel: {
      provider: "mlx",
      endpoint: "http://127.0.0.1:9876/v1",
      modelName: "custom-mlx-model",
    },
  };

  syncLocalModelProfilesForProvisionPlan(cfg, plan);

  assert.equal((cfg.qwen as { primary: { modelId: string } }).primary.modelId, "custom-mlx-model");
  assert.deepEqual(cfg.localModel, {
    provider: "mlx",
    endpoint: "http://127.0.0.1:9876/v1",
    modelName: "custom-mlx-model",
  });
});
