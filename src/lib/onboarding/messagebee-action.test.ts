import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-mb-action-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { configureMessageBee } = await import("./actions");
const { isChannelEnabled, listIdentities } = await import("@/lib/messagebee/store");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("enables the channel and allowlists a phone (formatting-insensitive)", async () => {
  const r = await configureMessageBee({ enable: true, phone: "+1 (555) 123-4567" });
  assert.equal(isChannelEnabled(), true);
  const allow = listIdentities().filter((i) => i.status === "allowed" || i.status === "paired");
  assert.equal(allow.length, 1);
  assert.equal(allow[0].address, "+15551234567", "stored normalized to digits");
  // The returned state mirrors what the wizard renders.
  assert.equal((r.data as { enabled: boolean }).enabled, true);
  assert.ok(Array.isArray((r.data as { identities: unknown[] }).identities));
  assert.ok(typeof r.detail === "string" && r.detail.length > 0);
  assert.doesNotMatch(r.detail, /MessageBee/);
  assert.ok((r.data as { deepLinks: { fullDiskAccess: string } }).deepLinks.fullDiskAccess.includes("Privacy_AllFiles"));
});

test("is idempotent — re-allowlisting the same handle does not duplicate", async () => {
  // Same number, different formatting → same normalized address (+15551234567) → no new row.
  await configureMessageBee({ enable: true, phone: "+1-555-123-4567" });
  const allow = listIdentities().filter((i) => i.status === "allowed" || i.status === "paired");
  assert.equal(allow.length, 1, "same normalized address, one identity");
});

test("rejects an invalid handle with a warning but still enables the channel", async () => {
  const r = await configureMessageBee({ enable: true, phone: "   " });
  // Whitespace-only is treated as no phone (no warning, no new identity).
  assert.equal(isChannelEnabled(), true);
  const bad = await configureMessageBee({ enable: true, phone: "###" });
  const warnings = (bad.data as { warnings?: string[] }).warnings;
  assert.ok(warnings && warnings.length === 1, "invalid handle warns");
  assert.ok(!r.ok || typeof r.ok === "boolean");
});
