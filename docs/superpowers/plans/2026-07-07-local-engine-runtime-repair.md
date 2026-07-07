# Local Engine Runtime Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rapid-MLX provisioning, runtime supervision, and Settings status agree on the recommended `fast` tier for this 52 GB Mac while preserving custom local endpoints.

**Architecture:** The provisioned `localEngine.tiers` array becomes authoritative when present. Provisioning synchronizes stale HiveMatrix-managed `qwen` and `localModel` entries to the plan's primary tier, while the supervisor launches recognized Rapid-MLX tier aliases through `rapid-mlx serve`.

**Tech Stack:** TypeScript, Node test runner, Rapid-MLX OpenAI-compatible local server, macOS LaunchAgents for live repair.

## Global Constraints

- Do not change embeddings behavior, settings, indexing, or health checks.
- Preserve custom `qwen` profiles whose primary model/endpoint is not a HiveMatrix Rapid-MLX tier.
- Do not overwrite unrelated user config keys in `~/.hivematrix/config.json`.
- Do not commit the pre-existing local edits in `.gitignore` or `docs/USER-GUIDE.html`.
- Use TDD: each production behavior change starts with a failing focused test.

---

### Task 1: Make Configured Local-Engine Tiers Authoritative

**Files:**
- Modify: `src/lib/models/local-engine.test.ts`
- Modify: `src/lib/models/local-engine.ts`

**Interfaces:**
- Consumes: `getLocalEngineConfig(config?: Record<string, unknown>)`, `buildServeArgs(tier: LocalTier)`.
- Produces: `getLocalEngineConfig()` that only backfills defaults when no configured `localEngine.tiers` array exists.

- [ ] **Step 1: Write the failing tests**

Add tests proving one configured tier stays one configured tier, and Rapid-MLX serve args bind loopback:

```ts
test("configured localEngine tiers are authoritative when present", () => {
  const c = getLocalEngineConfig({
    localEngine: {
      engine: "rapid-mlx",
      binary: "/x/rapid-mlx",
      tiers: [{ key: "fast", alias: "my-fast", port: 9000, reasoning: true }],
    },
  });
  assert.deepEqual(c.tiers.map((t) => t.key), ["fast"]);
  assert.equal(c.tiers[0].alias, "my-fast");
});

test("buildServeArgs binds Rapid-MLX to loopback", () => {
  assert.deepEqual(buildServeArgs(DEFAULT_TIERS[0]),
    ["serve", "qwen3.6-35b-4bit", "--host", "127.0.0.1", "--port", "8000", "--no-thinking"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/models/local-engine.test.ts`

Expected: FAIL because the config still backfills `coding`, and `buildServeArgs` lacks `--host`.

- [ ] **Step 3: Write minimal implementation**

Change `getLocalEngineConfig` so `rawTiers.length > 0` maps only configured tiers, using the matching default only to fill missing fields. Change `buildServeArgs` to:

```ts
export function buildServeArgs(tier: LocalTier): string[] {
  const args = ["serve", tier.alias, "--host", "127.0.0.1", "--port", String(tier.port)];
  if (!tier.reasoning) args.push("--no-thinking");
  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/models/local-engine.test.ts`

Expected: PASS.

### Task 2: Sync Stale Managed Qwen And LocalModel Config During Provisioning

**Files:**
- Modify: `src/lib/models/provision.test.ts`
- Modify: `src/lib/models/provision.ts`

**Interfaces:**
- Consumes: `planLocalEngine()`, `qwenProfileForProvisionPlan()`, `tierBaseUrl()`, `SUPPORTED_LOCAL_TIER_PRESETS`.
- Produces: `syncLocalModelProfilesForProvisionPlan(cfg, plan)` for pure tests and `provisionLocalEngine()` runtime use.

- [ ] **Step 1: Write the failing tests**

Add tests:

```ts
test("syncLocalModelProfilesForProvisionPlan moves stale managed coding config to fast on 48GB", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 48 });
  const cfg: Record<string, unknown> = {
    qwen: {
      location: "local",
      primary: { modelId: "qwen3.6-27b-4bit", endpoint: "http://127.0.0.1:8001/v1", provider: "mlx", contextLimit: 262144 },
      thinkingEnabled: false,
      minDecodeRate: 15,
      probeTimeoutMs: 60000,
    },
    localModel: { provider: "mlx", endpoint: "http://127.0.0.1:8001/v1", modelName: "qwen3.6-27b-4bit" },
  };

  syncLocalModelProfilesForProvisionPlan(cfg, plan);

  const qwen = cfg.qwen as { primary: { modelId: string; endpoint: string }; secondary: unknown };
  assert.equal(qwen.primary.modelId, "qwen3.6-35b-4bit");
  assert.equal(qwen.primary.endpoint, "http://127.0.0.1:8000/v1");
  assert.equal(qwen.secondary, null);
  assert.deepEqual(cfg.localModel, { provider: "mlx", endpoint: "http://127.0.0.1:8000/v1", modelName: "qwen3.6-35b-4bit" });
});

test("syncLocalModelProfilesForProvisionPlan preserves custom non-tier qwen profile", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 48 });
  const cfg: Record<string, unknown> = {
    qwen: {
      location: "local",
      primary: { modelId: "custom-mlx-model", endpoint: "http://127.0.0.1:9876/v1", provider: "mlx", contextLimit: 4096 },
    },
    localModel: { provider: "mlx", endpoint: "http://127.0.0.1:9876/v1", modelName: "custom-mlx-model" },
  };

  syncLocalModelProfilesForProvisionPlan(cfg, plan);

  assert.equal(((cfg.qwen as { primary: { modelId: string } }).primary.modelId), "custom-mlx-model");
  assert.deepEqual(cfg.localModel, { provider: "mlx", endpoint: "http://127.0.0.1:9876/v1", modelName: "custom-mlx-model" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/models/provision.test.ts`

Expected: FAIL because `syncLocalModelProfilesForProvisionPlan` does not exist.

- [ ] **Step 3: Write minimal implementation**

Export `syncLocalModelProfilesForProvisionPlan`. It should build the desired profile, detect whether existing `qwen.primary` or `localModel` points at any supported Rapid-MLX tier alias or endpoint, and replace only missing or managed-stale entries:

```ts
export function syncLocalModelProfilesForProvisionPlan(cfg: Record<string, unknown>, plan: ProvisionPlan): void {
  const profile = qwenProfileForProvisionPlan(plan);
  if (!profile) return;
  const shouldReplaceQwen = !cfg.qwen || isManagedTierQwenProfile(cfg.qwen);
  if (shouldReplaceQwen) cfg.qwen = profile;
  const desiredLocalModel = {
    provider: profile.primary.provider,
    endpoint: profile.primary.endpoint,
    modelName: profile.primary.modelId,
  };
  if (!cfg.localModel || isManagedTierLocalModel(cfg.localModel)) {
    cfg.localModel = desiredLocalModel;
  }
}
```

Wire `provisionLocalEngine()` to call this helper instead of `ensureQwenProfile()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/models/provision.test.ts`

Expected: PASS.

### Task 3: Launch Rapid-MLX Tier Aliases Through Rapid-MLX

**Files:**
- Modify: `src/lib/local-model/serving.test.ts`
- Modify: `src/lib/local-model/serving.ts`

**Interfaces:**
- Consumes: `tierForAlias()`, `resolveRapidBinary()`, `buildServeArgs()`.
- Produces: `resolveServeCommand(profile)` that returns `rapid-mlx serve ...` for supported tier aliases and keeps `mlx_lm.server` for custom MLX models.

- [ ] **Step 1: Write the failing tests**

Add a test that creates a temp home with a fake Rapid-MLX binary path and a `localEngine` config, then expects:

```ts
assert.deepEqual(resolveServeCommand(profile({
  provider: "mlx",
  modelId: "qwen3.6-35b-4bit",
  endpoint: "http://127.0.0.1:8000/v1",
}), null), {
  cmd: fakeRapid,
  args: ["serve", "qwen3.6-35b-4bit", "--host", "127.0.0.1", "--port", "8000", "--no-thinking"],
});
```

Keep the existing custom model assertion for `mlx_lm.server`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/local-model/serving.test.ts`

Expected: FAIL because tier aliases still map to `mlx_lm.server`.

- [ ] **Step 3: Write minimal implementation**

In `serving.ts`, import Rapid-MLX helpers and update the `mlx` provider branch:

```ts
function rapidMlxServeCommandForTier(modelId: string): ServeCommand | null {
  const tier = tierForAlias(modelId);
  if (!tier) return null;
  const bin = resolveRapidBinary();
  return bin ? { cmd: bin, args: buildServeArgs(tier) } : null;
}
```

Use this helper before falling back to `mlx_lm.server`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/local-model/serving.test.ts`

Expected: PASS.

### Task 4: Remove The Settings Local Model Health Card

**Files:**
- Modify: `src/daemon/console.test.ts`
- Modify: `src/daemon/console.ts`

**Interfaces:**
- Consumes: `renderLocalEngine(m.localEngine, m.localEngineCapability)` and `renderProvisionUI(m.localEngineCapability)`.
- Produces: Settings Models UI that shows live local engine and provisioning controls without the cached local model health card.

- [ ] **Step 1: Write the failing test**

Change the test name and assertions:

```ts
test("Settings Models renders local engine and provisioning controls without cached health card", () => {
  const js = extractScript(CONSOLE_HTML);
  const renderSettings = extractBetween(js, "function renderSettingsModelControls()", "function closeSettings()");

  assert.match(renderSettings, /renderLocalEngine\(m\.localEngine, m\.localEngineCapability\)/);
  assert.doesNotMatch(renderSettings, /renderLocalModelHealth\(m\.localModelHealth\)/);
  assert.match(renderSettings, /renderProvisionUI\(m\.localEngineCapability\)/);
  assert.doesNotMatch(renderSettings, /renderLocalBackendChoice/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/daemon/console.test.ts`

Expected: FAIL because Settings still appends `renderLocalModelHealth`.

- [ ] **Step 3: Write minimal implementation**

Remove the Settings call to `renderLocalModelHealth(m.localModelHealth)`. If the function becomes unused, remove the `renderLocalModelHealth` helper from `console.ts` as well.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/daemon/console.test.ts`

Expected: PASS.

### Final Verification And Live Repair

- [ ] Run focused tests:

```bash
npm test -- src/lib/models/local-engine.test.ts src/lib/models/provision.test.ts src/lib/local-model/serving.test.ts src/daemon/console.test.ts
```

- [ ] Run repo gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

- [ ] Repair live runtime after code verification:

```bash
# Back up ~/.hivematrix/config.json, write qwen/localModel to fast, unload stale coding LaunchAgent,
# install/load com.hivematrix.rapidmlx.fast on :8000, then verify :8000 /v1/models.
```

- [ ] Run local-model readiness after live repair:

```bash
npx tsx scripts/qwen-readiness.mts
```
