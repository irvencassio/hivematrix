import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-mb-action-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");
// Isolate HOME (before importing anything that reads the license) so the gate
// lookups don't pick up the operator's real ~/.hivematrix/license.json — these
// tests assert the Free-tier (Pro-gated) path and must not depend on whether a
// license happens to be installed on the machine running them.
const _prevHome = process.env.HOME;
process.env.HOME = TMP;

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { configureMessageBee } = await import("./actions");
const { getSelfHandles, isChannelEnabled, listIdentities } = await import("@/lib/messagebee/store");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  if (_prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = _prevHome;
  rmSync(TMP, { recursive: true, force: true });
});

test("enables the channel and allowlists a phone (formatting-insensitive)", async () => {
  const r = await configureMessageBee({ enable: true, phone: "+1 (555) 123-4567" });
  const row = getDb().prepare("SELECT enabled FROM message_channels WHERE channel = 'imessage'").get() as { enabled: number };
  assert.equal(row.enabled, 1, "stored channel preference is enabled");
  assert.equal(isChannelEnabled(), false, "effective channel remains gated without a Pro license");
  const allow = listIdentities().filter((i) => i.status === "allowed" || i.status === "paired");
  assert.equal(allow.length, 1);
  assert.equal(allow[0].address, "+15551234567", "stored normalized to digits");
  // The returned state mirrors what the wizard renders.
  assert.equal((r.data as { enabled: boolean }).enabled, false);
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

test("disables the channel when enable is false", async () => {
  await configureMessageBee({ enable: true, phone: "+1-555-123-4567" });
  const r = await configureMessageBee({ enable: false });
  assert.equal(isChannelEnabled(), false);
  assert.equal(r.ok, true);
  assert.equal((r.data as { enabled: boolean }).enabled, false);
  assert.match(r.detail, /disabled/i);
});

test("stores self handles during guided setup", async () => {
  const r = await configureMessageBee({ enable: false, selfHandles: ["+1 (555) 000-1111", "Me@icloud.com"] });
  assert.deepEqual(getSelfHandles(), ["+15550001111", "me@icloud.com"]);
  assert.deepEqual((r.data as { selfHandles: string[] }).selfHandles, ["+15550001111", "me@icloud.com"]);
});

test("rejects an invalid handle with a warning but still enables the channel", async () => {
  const r = await configureMessageBee({ enable: true, phone: "   " });
  // Whitespace-only is treated as no phone (no warning, no new identity).
  const row = getDb().prepare("SELECT enabled FROM message_channels WHERE channel = 'imessage'").get() as { enabled: number };
  assert.equal(row.enabled, 1, "stored channel preference is enabled");
  assert.equal(isChannelEnabled(), false, "effective channel remains gated without a Pro license");
  const bad = await configureMessageBee({ enable: true, phone: "###" });
  const warnings = (bad.data as { warnings?: string[] }).warnings;
  assert.ok(warnings && warnings.length === 1, "invalid handle warns");
  assert.ok(!r.ok || typeof r.ok === "boolean");
});
