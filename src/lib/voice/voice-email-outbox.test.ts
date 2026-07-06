/**
 * Tests for the voice-email outbox watcher.
 *
 * Verifies that JSON files written to ~/.hivematrix/voice-email-outbox/ are
 * picked up and routed to sendMail / draftMail, and that files are removed
 * after processing.
 */

import { strict as assert } from "assert";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Helpers ─────────────────────────────────────────────────────────────────

const OUTBOX_DIR = join(homedir(), ".hivematrix", "voice-email-outbox");
type CapturedEmail = { to: string; subject: string; body: string };

function cleanOutbox(): void {
  if (existsSync(OUTBOX_DIR)) {
    for (const entry of readdirSync(OUTBOX_DIR)) {
      if (!entry.startsWith("email-test-") || !entry.endsWith(".json")) continue;
      const path = join(OUTBOX_DIR, entry);
      if (!statSync(path).isFile()) continue;
      unlinkSync(path);
    }
  }
}

function writeOutboxJson(to: string, subject: string, body: string, sendMode = "send"): string {
  mkdirSync(OUTBOX_DIR, { recursive: true });
  const path = join(OUTBOX_DIR, `email-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({ to, subject, body, sendMode, timestamp: Date.now() / 1000, source: "voice-email" }));
  return path;
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function testPollPicksUpJsonFiles(): Promise<void> {
  cleanOutbox();
  const { pollVoiceEmailOutbox, _setVoiceEmailMailFnsForTests } = await import("./voice-email-outbox");

  // Write a test email JSON
  const path = writeOutboxJson("test@example.com", "Test Subject", "Test body content");
  assert.ok(existsSync(path), "outbox JSON should exist before poll");

  let sendCalledWith: CapturedEmail | null = null;
  _setVoiceEmailMailFnsForTests(
    (to, subject, body) => {
      sendCalledWith = { to, subject, body };
      return Promise.resolve(true);
    },
    null,
  );

  await pollVoiceEmailOutbox();

  // After poll, the file should be removed
  assert.ok(!existsSync(path), "outbox JSON should be deleted after poll");
  assert.ok(sendCalledWith !== null, "sendMail should have been called");
  const captured = sendCalledWith as CapturedEmail;
  assert.equal(captured.to, "test@example.com");
  assert.equal(captured.subject, "Test Subject");
  assert.equal(captured.body, "Test body content");

  cleanOutbox();
  _setVoiceEmailMailFnsForTests(null, null);
  console.log("  ✅ testPollPicksUpJsonFiles");
}

async function testPollDraftMode(): Promise<void> {
  cleanOutbox();
  const { pollVoiceEmailOutbox, _setVoiceEmailMailFnsForTests } = await import("./voice-email-outbox");

  // Write a test email JSON with draft mode
  const path = writeOutboxJson("test@example.com", "Draft Subject", "Draft body", "draft");
  assert.ok(existsSync(path));

  let draftCalledWith: CapturedEmail | null = null;
  _setVoiceEmailMailFnsForTests(
    null,
    (to, subject, body) => {
      draftCalledWith = { to, subject, body };
      return Promise.resolve(true);
    },
  );

  await pollVoiceEmailOutbox();

  assert.ok(!existsSync(path), "draft JSON should be deleted after poll");
  assert.ok(draftCalledWith !== null, "draftMail should have been called");
  const captured = draftCalledWith as CapturedEmail;
  assert.equal(captured.to, "test@example.com");
  assert.equal(captured.subject, "Draft Subject");
  assert.equal(captured.body, "Draft body");

  cleanOutbox();
  _setVoiceEmailMailFnsForTests(null, null);
  console.log("  ✅ testPollDraftMode");
}

async function testPollSkipsMissingToOrBody(): Promise<void> {
  cleanOutbox();
  const { pollVoiceEmailOutbox, _setVoiceEmailMailFnsForTests } = await import("./voice-email-outbox");

  // Write a JSON with empty to — should be skipped and deleted
  const path1 = writeOutboxJson("", "Subject", "Body");
  // Write a JSON with empty body — should be skipped and deleted
  const path2 = writeOutboxJson("test@example.com", "Subject", "");
  assert.ok(existsSync(path1));
  assert.ok(existsSync(path2));

  let sendCount = 0;
  _setVoiceEmailMailFnsForTests(
    () => { sendCount++; return Promise.resolve(true); },
    null,
  );

  await pollVoiceEmailOutbox();

  assert.ok(!existsSync(path1), "empty-to JSON should be deleted");
  assert.ok(!existsSync(path2), "empty-body JSON should be deleted");
  assert.equal(sendCount, 0, "no sendMail should be called for invalid entries");

  cleanOutbox();
  _setVoiceEmailMailFnsForTests(null, null);
  console.log("  ✅ testPollSkipsMissingToOrBody");
}

async function testPollSkipsAlreadySeenFiles(): Promise<void> {
  cleanOutbox();
  const { pollVoiceEmailOutbox, _setVoiceEmailMailFnsForTests } = await import("./voice-email-outbox");

  // Write a test email JSON
  const path = writeOutboxJson("test@example.com", "Subject", "Body");

  let callCount = 0;
  _setVoiceEmailMailFnsForTests(
    () => { callCount++; return Promise.resolve(true); },
    null,
  );

  // First poll — should send once
  await pollVoiceEmailOutbox();
  assert.equal(callCount, 1, "first poll should send");

  // Second poll — should NOT re-send (already seen)
  await pollVoiceEmailOutbox();
  assert.equal(callCount, 1, "second poll should not re-send seen file");

  cleanOutbox();
  _setVoiceEmailMailFnsForTests(null, null);
  console.log("  ✅ testPollSkipsAlreadySeenFiles");
}

async function testPollStartStop(): Promise<void> {
  const { startVoiceEmailOutboxPoller, stopVoiceEmailOutboxPoller } = await import("./voice-email-outbox");

  const stop = startVoiceEmailOutboxPoller(999_999); // very slow interval
  assert.ok(typeof stop === "function", "start returns stop function");

  stopVoiceEmailOutboxPoller(); // direct call should also work
  stop(); // returned stop should also work (no-op after first stop)

  console.log("  ✅ testPollStartStop");
}

// ── Run ─────────────────────────────────────────────────────────────────────

export default async function runTests(): Promise<void> {
  console.log("\n🧪 voice-email-outbox tests\n");
  await testPollPicksUpJsonFiles();
  await testPollDraftMode();
  await testPollSkipsMissingToOrBody();
  await testPollSkipsAlreadySeenFiles();
  await testPollStartStop();
  console.log("\n✅ All voice-email-outbox tests passed\n");
}

void runTests();
