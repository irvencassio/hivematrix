import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scrubSecrets, scrubSecretsText } from "./redaction";
import { VaultStore } from "./store";

import { recordAudit, readAudit } from "@/lib/audit/audit";

async function makeVaultStore(baseDir: string): Promise<{ store: VaultStore; vaultDbPath: string }> {
  const vaultDbPath = join(baseDir, "vault-leak.db");
  process.env.HIVEMATRIX_DB_PATH = vaultDbPath;

  const g = globalThis as { __hivematrixSqlite?: unknown };
  delete g.__hivematrixSqlite;

  const secrets = new Map<string, string>();
  const runner = async (file: string, args: string[], opts?: { stdin?: string }): Promise<{ stdout: string; stderr: string }> => {
    const cmd = args[0];
    const aIdx = args.indexOf("-a") + 1;
    const key = args[aIdx];
    if (cmd === "add-generic-password") {
      secrets.set(key, opts?.stdin?.replace(/\n$/, "") ?? "");
      return { stdout: "", stderr: "" };
    }
    if (cmd === "find-generic-password") {
      const val = secrets.get(key);
      if (val == null) throw Object.assign(new Error("not found"), { code: 44 });
      return { stdout: `${val}\n`, stderr: "" };
    }
    if (cmd === "delete-generic-password") {
      if (!secrets.delete(key)) throw Object.assign(new Error("not found"), { code: 44 });
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unsupported security command ${cmd}`);
  };

  const { getDb } = await import("@/lib/db");
  getDb();

  const store = new VaultStore({ keychainRunner: runner });
  return { store, vaultDbPath };
}

const CANARY_A = "canaryToken-ALPHA-001";
const CANARY_B = "canarySecret-BETA-002";
const CANARY_C = "canaryValue-GAMMA-003";

test("redaction scrub removes vault-seeded canaries from prompt, transcript, audit, SSE, and tool traces", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "vault-leak-test-"));
  const canaries = [CANARY_A, CANARY_B, CANARY_C];
  const originalHome = process.env.HOME;
  process.env.HOME = tmp;

  // Seed canary secrets through vault helpers (proving test-path realism).
  const { store } = await makeVaultStore(tmp);
  await store.set("site", "alpha", CANARY_A, "canary-site");
  await store.set("host", "beta", CANARY_B, "canary-host");
  await store.set("env", "gamma", CANARY_C, "canary-env");
  const canaryRefs = [
    await store.get("vault://site/alpha" as const),
    await store.get("vault://host/beta" as const),
    await store.get("vault://env/gamma" as const),
  ];
  assert.deepEqual(canaryRefs, [CANARY_A, CANARY_B, CANARY_C]);

  const promptEnvelope = {
    role: "user",
    text: `Build ${CANARY_A} into the config and also ${CANARY_B} with ${CANARY_C}.`,
  };
  const scrubbedPrompt = JSON.stringify(scrubSecrets(promptEnvelope, canaries));
  for (const canary of canaries) assert.equal(scrubbedPrompt.includes(canary), false);

  const transcriptEnvelope = {
    turns: [
      { who: "user", text: `Using ${CANARY_A} as reference token.` },
      { who: "agent", text: `I acknowledged ${CANARY_B} and ${CANARY_C}.` },
    ],
  };
  const scrubbedTranscript = JSON.stringify(scrubSecrets(transcriptEnvelope, canaries));
  for (const canary of canaries) assert.equal(scrubbedTranscript.includes(canary), false);

  const sseEnvelope = `event: flash:tool\ndata: ${JSON.stringify({ output: `Result token: ${CANARY_A}`, tokenHint: CANARY_B })}\n\n`;
  const scrubbedSse = scrubSecretsText(sseEnvelope, canaries);
  for (const canary of canaries) assert.equal(scrubbedSse.includes(canary), false);

  const toolTraceEnvelope = {
    lane: "browser",
    event: "toolResult",
    metadata: {
      token: CANARY_A,
      headers: { authorization: `Bearer ${CANARY_B}` },
      details: { secret: CANARY_C },
    },
    command: "noop",
  };
  const scrubbedToolTrace = JSON.stringify(scrubSecrets(toolTraceEnvelope, canaries));
  for (const canary of canaries) assert.equal(scrubbedToolTrace.includes(canary), false);

  // Audit boundary: same canaries must be removed before persistence.
  const taskId = `vault-canary-${randomUUID()}`;
  recordAudit(
    {
      event: "vault_leak_smoke",
      taskId,
      ts: "2026-07-02T12:00:00.000Z",
      prompt: promptEnvelope.text,
      summary: `Summary carries ${CANARY_A} ${CANARY_B}`,
      status: "done",
    },
    { redact: canaries },
  );
  const auditEntry = readAudit({ taskId })[0];
  const auditBlob = JSON.stringify(auditEntry);
  for (const canary of canaries) assert.equal(auditBlob.includes(canary), false);

  test.after(() => {
    process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  });
});
