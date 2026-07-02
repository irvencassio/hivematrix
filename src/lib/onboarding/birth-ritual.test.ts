import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { extractPersonaName, extractPersonaEmoji, getPersonaStatus, buildBirthRitualMessages } from "./birth-ritual";

// ---------------------------------------------------------------------------
// extractPersonaName
// ---------------------------------------------------------------------------

test("extractPersonaName: reads **Name:** field", () => {
  const content = "# 🌙 Noctis\n\n**Name:** Noctis\n**Sigil:** 🌙";
  assert.equal(extractPersonaName(content), "Noctis");
});

test("extractPersonaName: falls back to H1 stripping leading emoji", () => {
  const content = "# ⚡ Vex\n\nSome content";
  assert.equal(extractPersonaName(content), "Vex");
});

test("extractPersonaName: strips multiple leading emoji from H1", () => {
  const content = "# 🔮✨ Aether\n\nSome content";
  assert.equal(extractPersonaName(content), "Aether");
});

test("extractPersonaName: returns null when no match", () => {
  assert.equal(extractPersonaName("No heading or name here"), null);
});

test("extractPersonaName: Name field takes precedence over H1", () => {
  const content = "# 🔥 WrongName\n\n**Name:** Ember\n";
  assert.equal(extractPersonaName(content), "Ember");
});

// ---------------------------------------------------------------------------
// extractPersonaEmoji
// ---------------------------------------------------------------------------

test("extractPersonaEmoji: reads **Sigil:** field", () => {
  const content = "# 🌙 Noctis\n\n**Sigil:** 🌙\n**Name:** Noctis";
  assert.equal(extractPersonaEmoji(content), "🌙");
});

test("extractPersonaEmoji: falls back to first emoji in H1", () => {
  const content = "# ⚡ Vex\n\nSome content";
  assert.equal(extractPersonaEmoji(content), "⚡");
});

test("extractPersonaEmoji: returns null when no emoji found", () => {
  const content = "# Noctis\n\nNo emoji here";
  assert.equal(extractPersonaEmoji(content), null);
});

// ---------------------------------------------------------------------------
// getPersonaStatus
// ---------------------------------------------------------------------------

test("getPersonaStatus: returns new when brainRoot is null", () => {
  const status = getPersonaStatus(null);
  assert.equal(status.state, "new");
});

test("getPersonaStatus: returns new when IDENTITY.md absent", () => {
  const dir = join(tmpdir(), `hmtest-${Date.now()}`);
  mkdirSync(join(dir, "persona"), { recursive: true });
  try {
    const status = getPersonaStatus(dir);
    assert.equal(status.state, "new");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getPersonaStatus: returns existing when IDENTITY.md present", () => {
  const dir = join(tmpdir(), `hmtest-${Date.now()}`);
  mkdirSync(join(dir, "persona"), { recursive: true });
  const identity = "# 🌙 Noctis\n\n**Name:** Noctis\n**Sigil:** 🌙\n**Born:** 2026-07-02\n";
  writeFileSync(join(dir, "persona", "IDENTITY.md"), identity, "utf-8");
  try {
    const status = getPersonaStatus(dir);
    assert.equal(status.state, "existing");
    assert.equal(status.name, "Noctis");
    assert.equal(status.emoji, "🌙");
    assert.equal(status.avatarPath, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getPersonaStatus: includes avatarPath when avatar.png exists", () => {
  const dir = join(tmpdir(), `hmtest-${Date.now()}`);
  mkdirSync(join(dir, "persona"), { recursive: true });
  writeFileSync(join(dir, "persona", "IDENTITY.md"), "# ⚡ Vex\n**Name:** Vex\n", "utf-8");
  writeFileSync(join(dir, "persona", "avatar.png"), Buffer.from("PNG"), "binary");
  try {
    const status = getPersonaStatus(dir);
    assert.equal(status.state, "existing");
    assert.ok(status.avatarPath?.endsWith("avatar.png"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getPersonaStatus: returns new when brainRoot dir does not exist", () => {
  const status = getPersonaStatus("/nonexistent/path/that/does/not/exist");
  assert.equal(status.state, "new");
});

// ---------------------------------------------------------------------------
// buildBirthRitualMessages
// ---------------------------------------------------------------------------

test("buildBirthRitualMessages: returns system + user messages", () => {
  const messages = buildBirthRitualMessages();
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
});

test("buildBirthRitualMessages: system prompt contains key instructions", () => {
  const messages = buildBirthRitualMessages();
  const prompt = (messages[0] as { role: "system"; content: string }).content;
  assert.ok(prompt.includes("SOUL.md"), "prompt should reference SOUL.md");
  assert.ok(prompt.includes("IDENTITY.md"), "prompt should reference IDENTITY.md");
  assert.ok(prompt.includes("USER.md"), "prompt should reference USER.md");
  assert.ok(prompt.includes("generate_avatar"), "prompt should reference generate_avatar");
  assert.ok(prompt.includes("This file is yours to evolve"), "prompt must include the exact closing line");
  assert.ok(prompt.includes("second-person"), "prompt should specify second-person voice");
});

test("buildBirthRitualMessages: system prompt contains today's date", () => {
  const today = new Date().toISOString().slice(0, 10);
  const messages = buildBirthRitualMessages();
  const prompt = (messages[0] as { role: "system"; content: string }).content;
  assert.ok(prompt.includes(today), "prompt should include today's date");
});

test("buildBirthRitualMessages: user message is the begin trigger", () => {
  const messages = buildBirthRitualMessages();
  const user = messages[1] as { role: "user"; content: string };
  assert.ok(user.content.toLowerCase().includes("begin"), "user turn should say begin");
});
