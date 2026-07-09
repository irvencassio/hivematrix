import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// resolveModelId reads ~/.hivematrix/config.json — isolate HOME.
const TMP = mkdtempSync(join(tmpdir(), "hm-resolver-test-"));
process.env.HOME = TMP;
mkdirSync(join(TMP, ".hivematrix"), { recursive: true });
const cfgPath = join(TMP, ".hivematrix", "config.json");
const writeCfg = (o: Record<string, unknown>) => writeFileSync(cfgPath, JSON.stringify(o));

const { resolveModelId } = await import("./model-resolver");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

function frontierBackends(claude: boolean, codex: boolean) {
  return frontierBackendsQuadrant({ claudeInstalled: claude, claudeEnabled: claude, codexInstalled: codex, codexEnabled: codex });
}

// installed/enabled are independent axes since Phase 2's redefinition
// (configured = installed && enabled) — exercise all four quadrants per provider.
function frontierBackendsQuadrant(opts: {
  claudeInstalled: boolean; claudeEnabled: boolean; codexInstalled: boolean; codexEnabled: boolean;
}) {
  return [
    { id: "local" as const, name: "Local", configured: false, installed: false, enabled: true, detail: "" },
    { id: "claude" as const, name: "Claude Code", configured: opts.claudeInstalled && opts.claudeEnabled, installed: opts.claudeInstalled, enabled: opts.claudeEnabled, detail: "" },
    { id: "codex" as const, name: "Codex", configured: opts.codexInstalled && opts.codexEnabled, installed: opts.codexInstalled, enabled: opts.codexEnabled, detail: "" },
  ];
}

test("frontier-premium uses thinkModel override, else Opus default", () => {
  writeCfg({});
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: frontierBackends(true, false) }), "opus");
  writeCfg({ thinkModel: "claude-sonnet-4-6" });
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: frontierBackends(true, false) }), "claude-sonnet-4-6");
});

test("frontier uses frontierModel (coding) override, else Sonnet default", () => {
  writeCfg({});
  assert.equal(resolveModelId("frontier", { frontierBackends: frontierBackends(true, false) }), "sonnet");
  writeCfg({ frontierModel: "claude-opus-4-8" });
  assert.equal(resolveModelId("frontier", { frontierBackends: frontierBackends(true, false) }), "claude-opus-4-8");
});

test("codex provider defaults thinking to GPT-5.5 and coding to Spark", () => {
  writeCfg({ frontierProvider: "codex" });
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: frontierBackends(true, true) }), "codex:gpt-5.5");
  assert.equal(resolveModelId("frontier", { frontierBackends: frontierBackends(true, true) }), "codex:gpt-5.3-codex-spark");
});

test("codex provider falls back to Claude when Codex CLI is missing", () => {
  writeCfg({ frontierProvider: "codex" });
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: frontierBackends(true, false) }), "opus");
  assert.equal(resolveModelId("frontier", { frontierBackends: frontierBackends(true, false) }), "sonnet");
});

test("frontier defaults return null when no frontier backend is configured", () => {
  writeCfg({ frontierProvider: "codex" });
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: frontierBackends(false, false) }), null);
  assert.equal(resolveModelId("frontier", { frontierBackends: frontierBackends(false, false) }), null);
});

test("both enabled: primary provider wins, honoring frontierProvider among enabled providers", () => {
  writeCfg({ frontierProvider: "claude" });
  const both = frontierBackendsQuadrant({ claudeInstalled: true, claudeEnabled: true, codexInstalled: true, codexEnabled: true });
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: both }), "opus");
  writeCfg({ frontierProvider: "codex" });
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: both }), "codex:gpt-5.5");
});

test("one enabled: that provider is forced regardless of frontierProvider", () => {
  writeCfg({ frontierProvider: "codex" }); // primary points at codex, but codex is disabled
  const claudeOnly = frontierBackendsQuadrant({ claudeInstalled: true, claudeEnabled: true, codexInstalled: true, codexEnabled: false });
  assert.equal(resolveModelId("frontier", { frontierBackends: claudeOnly }), "sonnet", "codex installed-but-disabled must not win");

  writeCfg({ frontierProvider: "claude" }); // primary points at claude, but claude is disabled
  const codexOnly = frontierBackendsQuadrant({ claudeInstalled: true, claudeEnabled: false, codexInstalled: true, codexEnabled: true });
  assert.equal(resolveModelId("frontier", { frontierBackends: codexOnly }), "codex:gpt-5.3-codex-spark", "claude installed-but-disabled must not win");
});

test("enabled but not yet installed does not count as available — resolves to null (routes to local)", () => {
  const midSetup = frontierBackendsQuadrant({ claudeInstalled: false, claudeEnabled: true, codexInstalled: false, codexEnabled: false });
  writeCfg({ frontierProvider: "claude" });
  assert.equal(resolveModelId("frontier", { frontierBackends: midSetup }), null);
});

test("both off (both installed but disabled): resolves to null without an explicit local-only mode", () => {
  const bothOff = frontierBackendsQuadrant({ claudeInstalled: true, claudeEnabled: false, codexInstalled: true, codexEnabled: false });
  writeCfg({ frontierProvider: "claude" });
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: bothOff }), null);
  assert.equal(resolveModelId("frontier", { frontierBackends: bothOff }), null);
});

test("role model overrides win even when frontier provider is Codex", () => {
  writeCfg({ frontierProvider: "codex", thinkModel: "claude-opus-4-8", frontierModel: "codex:gpt-5.5" });
  assert.equal(resolveModelId("frontier-premium", { frontierBackends: frontierBackends(true, true) }), "claude-opus-4-8");
  assert.equal(resolveModelId("frontier", { frontierBackends: frontierBackends(true, true) }), "codex:gpt-5.5");
});

test("cloud-only resolution ignores local role overrides", () => {
  writeCfg({ frontierProvider: "claude", frontierModel: "qwen/qwen3.6-27b" });
  assert.equal(resolveModelId("frontier", { frontierBackends: frontierBackends(true, false) }), "qwen/qwen3.6-27b");
  assert.equal(resolveModelId("frontier", { noLocalOverrides: true, frontierBackends: frontierBackends(true, false) }), "sonnet");
});

test("local-secondary honors operationalModel override before the Qwen profile", () => {
  writeCfg({ operationalModel: "qwen3-coder-30b" });
  assert.equal(resolveModelId("local-secondary"), "qwen3-coder-30b");
  // no override + no qwen profile → null (caller queues/skips)
  writeCfg({});
  assert.equal(resolveModelId("local-secondary"), null);
});
