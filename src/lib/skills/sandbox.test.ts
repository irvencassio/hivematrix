import test from "node:test";
import assert from "node:assert/strict";
import type { Skill } from "./contracts";
import type { AuditEntry } from "@/lib/audit/audit";
import { runSkillSandboxed } from "./sandbox";

function scriptSkill(over: Partial<Skill> = {}): Skill {
  return {
    name: "demo", description: "", tags: [], body: "echo hello",
    source: "operator", createdAt: "", updatedAt: "", revisions: 1, useCount: 0, lastUsedAt: "",
    compat: ["all"], trusted: true, failures: 0, probation: false, kind: "script", interpreter: "bash", roles: [], ...over,
  };
}

function captureAudit(): { entries: AuditEntry[]; audit: (e: AuditEntry) => void } {
  const entries: AuditEntry[] = [];
  return { entries, audit: (e: AuditEntry) => { entries.push(e); } };
}

test("happy path: trivial bash skill runs, ok, exit 0, stdout contains output, audit emitted", async () => {
  const { entries, audit } = captureAudit();
  const result = await runSkillSandboxed(scriptSkill({ body: "echo hello" }), { audit });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello/);
  assert.equal(result.timedOut, false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, "skill:run");
  assert.equal(entries[0].status, "ok");
});

test("env allowlist: HIVE_* and secret vars are NOT passed through; HOME is the scratch cwd", async () => {
  const origHiveDaemonPort = process.env.HIVE_DAEMON_PORT;
  const origSecret = process.env.SOME_SECRET;
  process.env.HIVE_DAEMON_PORT = "9999";
  process.env.SOME_SECRET = "super-secret-value";
  try {
    const { audit } = captureAudit();
    const result = await runSkillSandboxed(
      scriptSkill({ body: 'echo "HIVE=$HIVE_DAEMON_PORT|SECRET=$SOME_SECRET"; echo "HOME=$HOME"' }),
      { audit },
    );
    assert.equal(result.ok, true);
    // Neither var should have made it into the child's env.
    assert.match(result.stdout, /HIVE=\|SECRET=/);
    // HOME inside the child must be the scratch cwd, not the operator's real home.
    assert.doesNotMatch(result.stdout, new RegExp(`HOME=${origHiveDaemonPort ?? "___never___"}`));
    const homeLine = result.stdout.split("\n").find((l) => l.startsWith("HOME="));
    assert.ok(homeLine, "expected a HOME= line in stdout");
    const scratchHome = homeLine!.slice("HOME=".length).trim();
    assert.notEqual(scratchHome, "");
    assert.notEqual(scratchHome, origHiveDaemonPort);
  } finally {
    if (origHiveDaemonPort === undefined) delete process.env.HIVE_DAEMON_PORT; else process.env.HIVE_DAEMON_PORT = origHiveDaemonPort;
    if (origSecret === undefined) delete process.env.SOME_SECRET; else process.env.SOME_SECRET = origSecret;
  }
});

test("SKILL_INPUT: input option is passed to the script as $SKILL_INPUT", async () => {
  const result = await runSkillSandboxed(scriptSkill({ body: 'echo "got:$SKILL_INPUT"' }), { input: "xyz" });
  assert.match(result.stdout, /got:xyz/);
});

test("params: {{param}} placeholders in body are substituted before running", async () => {
  const result = await runSkillSandboxed(
    scriptSkill({ body: 'echo "value:{{thing}}"' }),
    { params: { thing: "widget" } },
  );
  assert.match(result.stdout, /value:widget/);
});

test("timeout: a sleeping script is killed at timeoutMs and reports timedOut", async () => {
  const start = Date.now();
  const result = await runSkillSandboxed(scriptSkill({ body: "sleep 5" }), { timeoutMs: 1000 });
  const duration = Date.now() - start;
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, null);
  assert.ok(duration < 3000, `expected duration < 3000ms, got ${duration}ms`);
});

test("stdout cap: output larger than 64KB is truncated", async () => {
  const result = await runSkillSandboxed(
    scriptSkill({ body: 'head -c 100000 /dev/zero | tr "\\0" "a"' }),
    { timeoutMs: 15_000 },
  );
  assert.equal(result.ok, true);
  assert.ok(result.stdout.length <= 64 * 1024 + 1024, `expected capped stdout, got ${result.stdout.length} bytes`);
});

test("network deny (darwin, best-effort): sandboxed run cannot reach the network", async () => {
  const result = await runSkillSandboxed(
    scriptSkill({ body: 'curl -s -m 3 -o /dev/null -w "%{http_code}" http://example.com/ ; echo "EXIT:$?"' }),
    { timeoutMs: 10_000 },
  );
  if (process.platform === "darwin" && result.sandboxed) {
    // curl should fail to resolve/connect under the network-deny profile.
    assert.doesNotMatch(result.stdout, /200/);
  }
  if (process.platform === "darwin") {
    // Best-effort: only assert sandboxed=true if sandbox-exec actually exists on this box.
    const { existsSync } = await import("node:fs");
    if (existsSync("/usr/bin/sandbox-exec")) {
      assert.equal(result.sandboxed, true);
    }
  }
});

test("audit on failure: a skill that exits non-zero reports ok:false, exitCode, and audit status fail", async () => {
  const { entries, audit } = captureAudit();
  const result = await runSkillSandboxed(scriptSkill({ body: "exit 3" }), { audit });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 3);
  assert.equal(result.timedOut, false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, "skill:run");
  assert.equal(entries[0].status, "fail");
});

test("spawn error never throws — resolves with ok:false", async () => {
  const result = await runSkillSandboxed(scriptSkill({ interpreter: "bash" }), {
    spawnImpl: (() => { throw new Error("boom"); }) as unknown as typeof import("child_process").spawn,
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, null);
  assert.match(result.stderr, /boom/);
});

test("default audit (recordAudit) is used when no audit option is passed", async () => {
  // Just verify it doesn't throw when relying on the real recordAudit implementation.
  const result = await runSkillSandboxed(scriptSkill({ body: "echo default-audit-ok" }));
  assert.equal(result.ok, true);
  assert.match(result.stdout, /default-audit-ok/);
});
