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

test("fresh machine: required steps incomplete", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T" }));
  assert.equal(step(status, "config").state, "incomplete");
  assert.equal(step(status, "local-model").state, "incomplete");
  assert.equal(step(status, "daemon").state, "incomplete");
  assert.equal(status.requiredComplete, false);
  assert.equal(status.allComplete, false);
});

test("config + qwen + daemon + brain => required complete", () => {
  const status = withHome((home) => {
    mkdirSync(join(home, ".hivematrix"), { recursive: true });
    writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({
      qwen: { primary: { modelId: "qwen/qwen3.6-27b", endpoint: "http://localhost:1234/v1" } },
      memory: { brainRootDir: join(home, "brain") },
    }));
    mkdirSync(join(home, "brain"), { recursive: true });
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(join(home, "Library", "LaunchAgents", "com.hivematrix.daemon.plist"), "<plist/>");
  }, () => getOnboardingStatus({ now: "T" }));

  assert.equal(step(status, "config").state, "done");
  assert.equal(step(status, "local-model").state, "done");
  assert.equal(step(status, "daemon").state, "done");
  assert.equal(step(status, "brain").state, "done");
  assert.equal(status.requiredComplete, true);
  // frontier + desktopbee optional, still incomplete → not allComplete
  assert.equal(status.allComplete, false);
});

test("local-model step is satisfied by cloud-only posture (no local model)", () => {
  const status = withHome((home) => {
    mkdirSync(join(home, ".hivematrix"), { recursive: true });
    writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({ runMode: "cloud-only" }));
  }, () => getOnboardingStatus({ now: "T" }));
  assert.equal(step(status, "local-model").state, "done");
  assert.match(step(status, "local-model").detail, /cloud-only/);
});

test("local-model step is satisfied by the cloud-first default", () => {
  const status = withHome((home) => {
    mkdirSync(join(home, ".hivematrix"), { recursive: true });
    writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({
      memory: { brainRootDir: join(home, "brain") },
    }));
  }, () => getOnboardingStatus({ now: "T" }));
  assert.equal(step(status, "local-model").state, "done");
  assert.match(step(status, "local-model").detail, /cloud-first/i);
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

test("frontier step reflects env credentials", () => {
  const status = withHome(() => {}, () => {
    process.env.OPENAI_API_KEY = "sk-test";
    try { return getOnboardingStatus({ now: "T" }); }
    finally { delete process.env.OPENAI_API_KEY; }
  });
  assert.equal(step(status, "frontier").state, "done");
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

test("incomplete steps carry remediation hints", () => {
  const status = withHome(() => {}, () => getOnboardingStatus({ now: "T" }));
  for (const s of status.steps.filter((s) => s.state === "incomplete")) {
    assert.ok(s.remediation && s.remediation.length > 0, `${s.id} should have remediation`);
  }
});
