import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getOnboardingStatus } from "./onboarding";

function withHome<T>(setup: (home: string) => void, run: () => T): T {
  const orig = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "hm-onboard-"));
  setup(home);
  process.env.HOME = home;
  // Clear frontier env so tests are deterministic.
  const oa = process.env.OPENAI_API_KEY, an = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try { return run(); }
  finally {
    process.env.HOME = orig;
    if (oa) process.env.OPENAI_API_KEY = oa;
    if (an) process.env.ANTHROPIC_API_KEY = an;
    rmSync(home, { recursive: true, force: true });
  }
}

function step(status: ReturnType<typeof getOnboardingStatus>, id: string) {
  return status.steps.find((s) => s.id === id)!;
}

const noCli: NonNullable<Parameters<typeof getOnboardingStatus>[0]>["findBinaryImpl"] = () => null;
const claudeCli: NonNullable<Parameters<typeof getOnboardingStatus>[0]>["findBinaryImpl"] =
  (name) => (name === "claude" ? "/fake/bin/claude" : null);

test("fresh machine: required steps incomplete", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T", findBinaryImpl: noCli }));
  assert.equal(step(status, "config").state, "incomplete");
  assert.equal(step(status, "daemon").state, "incomplete");
  assert.equal(step(status, "frontier").state, "incomplete");
  assert.equal(status.requiredComplete, false);
  assert.equal(status.allComplete, false);
});

test("config + frontier CLI + daemon + brain => required complete", () => {
  const status = withHome((home) => {
    mkdirSync(join(home, ".hivematrix"), { recursive: true });
    writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({
      memory: { brainRootDir: join(home, "brain") },
    }));
    mkdirSync(join(home, "brain"), { recursive: true });
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(join(home, "Library", "LaunchAgents", "com.hivematrix.daemon.plist"), "<plist/>");
  }, () => getOnboardingStatus({ now: "T", findBinaryImpl: claudeCli }));

  assert.equal(step(status, "config").state, "done");
  assert.equal(step(status, "daemon").state, "done");
  assert.equal(step(status, "brain").state, "done");
  assert.equal(step(status, "frontier").state, "done");
  assert.equal(status.requiredComplete, true);
  // desktopbee optional, still incomplete → not allComplete
  assert.equal(status.allComplete, false);
});

test("desktopbee done only when helper built AND both permissions granted", () => {
  const base = (opts: Parameters<typeof getOnboardingStatus>[0]) =>
    withHome(() => {}, () => getOnboardingStatus({ now: "T", ...opts }));

  assert.equal(step(base({ helperBuilt: false }), "desktopbee").state, "incomplete");
  assert.equal(step(base({ helperBuilt: true, desktopPermissions: null }), "desktopbee").state, "incomplete");
  assert.equal(step(base({ helperBuilt: true, desktopPermissions: { accessibility: true, screenRecording: false } }), "desktopbee").state, "incomplete");
  assert.equal(step(base({ helperBuilt: true, desktopPermissions: { accessibility: true, screenRecording: true } }), "desktopbee").state, "done");
});

test("optional onboarding setup copy uses lane names", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T" }));
  const desktop = step(status, "desktopbee");
  const message = step(status, "messagebee");
  const mail = step(status, "mailbee");

  assert.equal(desktop.title, "Desktop Lane (desktop control)");
  assert.equal(message.title, "Message Lane (text HiveMatrix)");
  assert.equal(mail.title, "Mail Lane (email watch)");

  for (const s of [desktop, message, mail]) {
    assert.doesNotMatch(`${s.title}\n${s.detail}\n${s.remediation ?? ""}`, /DesktopBee|MessageBee|MailBee/);
  }
});

test("frontier step is CLI-only — an API key alone does not satisfy it (no keys, ever)", () => {
  const status = withHome(() => {}, () => {
    process.env.OPENAI_API_KEY = "sk-test";
    try { return getOnboardingStatus({ now: "T", findBinaryImpl: noCli }); }
    finally { delete process.env.OPENAI_API_KEY; }
  });
  assert.equal(step(status, "frontier").state, "incomplete");
});

test("frontier step is done when a frontier CLI is found", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T", findBinaryImpl: claudeCli }));
  assert.equal(step(status, "frontier").state, "done");
});

test("Codex CLI is optional setup, not a required HiveMatrix backend", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T" }));
  const codex = step(status, "codex-cli");

  assert.equal(codex.required, false);
  assert.equal(codex.title, "Codex CLI (optional)");
  assert.match(codex.detail, /Optional/i);
  assert.match(`${codex.detail}\n${codex.remediation ?? ""}`, /codex CLI|codex login/i);
  assert.equal(status.requiredComplete, false, "fresh machine still fails only required setup, not Codex specifically");
});

test("messagebee uses diagnostic chat.db detail when unreadable", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({
    now: "T",
    messagebee: {
      enabled: true,
      chatDbReadable: false,
      chatDbDetail: "Messages database opened, but the message table check failed: no such table: message",
    },
  }));
  const mb = step(status, "messagebee");
  assert.equal(mb.state, "incomplete");
  assert.match(mb.detail, /message table check failed/);
});

test("messagebee still reports channel disabled after readable chat.db", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({
    now: "T",
    messagebee: { enabled: false, chatDbReadable: true, chatDbDetail: "Messages database readable" },
  }));
  const mb = step(status, "messagebee");
  assert.equal(mb.state, "incomplete");
  assert.match(mb.detail, /channel disabled/);
});

test("canopy: not installed, not registered => incomplete", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T", canopyInstalled: false }));
  const canopy = step(status, "canopy");
  assert.equal(canopy.required, false);
  assert.equal(canopy.state, "incomplete");
  assert.equal(canopy.detail, "Canopy not installed");
  assert.ok(canopy.remediation && /Canopy/.test(canopy.remediation));
});

test("canopy: installed but not registered in ~/.claude.json => incomplete", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T", canopyInstalled: true }));
  const canopy = step(status, "canopy");
  assert.equal(canopy.state, "incomplete");
  assert.equal(canopy.detail, "Canopy installed but not registered for Claude Code");
});

test("canopy: installed and registered => done", () => {
  const status = withHome((home) => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      mcpServers: { canopy: { command: "canopy-mcp" } },
    }));
  }, () => getOnboardingStatus({ now: "T", canopyInstalled: true }));
  const canopy = step(status, "canopy");
  assert.equal(canopy.state, "done");
  assert.equal(canopy.detail, "installed and registered");
  assert.equal(canopy.remediation, undefined);
});

test("canopy: registered in ~/.claude.json but app not installed => still incomplete", () => {
  const status = withHome((home) => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      mcpServers: { canopy: { command: "canopy-mcp" } },
    }));
  }, () => getOnboardingStatus({ now: "T", canopyInstalled: false }));
  const canopy = step(status, "canopy");
  assert.equal(canopy.state, "incomplete");
  assert.equal(canopy.detail, "Canopy not installed");
});

test("canopy: malformed ~/.claude.json is tolerated as unregistered", () => {
  const status = withHome((home) => {
    writeFileSync(join(home, ".claude.json"), "{ not valid json");
  }, () => getOnboardingStatus({ now: "T", canopyInstalled: true }));
  const canopy = step(status, "canopy");
  assert.equal(canopy.state, "incomplete");
  assert.equal(canopy.detail, "Canopy installed but not registered for Claude Code");
});

test("incomplete steps carry remediation hints", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T" }));
  for (const s of status.steps.filter((s) => s.state === "incomplete")) {
    assert.ok(s.remediation && s.remediation.length > 0, `${s.id} should have remediation`);
  }
});
