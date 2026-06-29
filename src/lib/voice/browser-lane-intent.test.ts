import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVoiceBrowserLaneTask,
  detectVoiceBrowserLaneIntent,
} from "./browser-lane-intent";

test("detects explicit Browser Lane search requests", () => {
  assert.deepEqual(detectVoiceBrowserLaneIntent("Use browser lane to search Tesla Model S price"), {
    mode: "search",
    query: "Tesla Model S price",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("browser lane search tesla cars"), {
    mode: "search",
    query: "tesla cars",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("search the web for best solo founder CRMs"), {
    mode: "search",
    query: "best solo founder CRMs",
  });
});

test("detects explicit Browser Lane read requests", () => {
  assert.deepEqual(detectVoiceBrowserLaneIntent("browser lane read https://example.com pricing"), {
    mode: "read",
    url: "https://example.com",
    query: "pricing",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use browser lane to read apple developer news"), {
    mode: "search",
    query: "apple developer news",
  });
});

test("detects explicit Browser Lane open requests", () => {
  assert.deepEqual(detectVoiceBrowserLaneIntent("use browser lane to open https://google.com"), {
    mode: "open",
    url: "https://google.com",
    objective: "Open https://google.com",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use browser lane to open TestFlight"), {
    mode: "search",
    query: "TestFlight",
  });
});

test("detects explicit Browser Lane logged-in workflow requests", () => {
  assert.deepEqual(
    detectVoiceBrowserLaneIntent("use Browser Lane to sign into LinkedIn and see if I have any friend requests"),
    {
      mode: "workflow",
      objective: "Check LinkedIn friend requests",
      startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
      requiresLogin: true,
    },
  );
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to check my LinkedIn invitations"), {
    mode: "workflow",
    objective: "Check LinkedIn invitations",
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("open LinkedIn with Browser Lane and check connection requests"), {
    mode: "workflow",
    objective: "Check LinkedIn connection requests",
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to sign into Gmail and check unread mail"), {
    mode: "workflow",
    objective: "Check Gmail unread mail",
    startUrl: "https://mail.google.com/mail/u/0/#inbox",
    requiresLogin: true,
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to log into HeyGen and check video status"), {
    mode: "workflow",
    objective: "Check HeyGen video status",
    startUrl: "https://app.heygen.com/home",
    requiresLogin: true,
  });
});

test("detects bare 'sign into' as logged-in workflow", () => {
  // These fail until hasWorkflowCue adds sign\s*into alongside log\s*into
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to sign into LinkedIn"), {
    mode: "workflow",
    objective: "Open LinkedIn workflow",
    startUrl: "https://www.linkedin.com/feed/",
    requiresLogin: true,
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to sign into Gmail"), {
    mode: "workflow",
    objective: "Check Gmail",
    startUrl: "https://mail.google.com/mail/u/0/#inbox",
    requiresLogin: true,
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to sign into HeyGen"), {
    mode: "workflow",
    objective: "Run HeyGen workflow",
    startUrl: "https://app.heygen.com/home",
    requiresLogin: true,
  });
});

test("detects 'log into' and bare 'check' variants as logged-in workflow", () => {
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to log into LinkedIn"), {
    mode: "workflow",
    objective: "Open LinkedIn workflow",
    startUrl: "https://www.linkedin.com/feed/",
    requiresLogin: true,
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to check my Gmail"), {
    mode: "workflow",
    objective: "Check Gmail",
    startUrl: "https://mail.google.com/mail/u/0/#inbox",
    requiresLogin: true,
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to log into HeyGen"), {
    mode: "workflow",
    objective: "Run HeyGen workflow",
    startUrl: "https://app.heygen.com/home",
    requiresLogin: true,
  });
});

test("unrelated voice text does not become Browser Lane work", () => {
  assert.equal(detectVoiceBrowserLaneIntent("search Tesla Model S price"), null);
  assert.equal(detectVoiceBrowserLaneIntent("tell me a joke"), null);
  assert.equal(detectVoiceBrowserLaneIntent("search the codebase for Browser Lane bugs"), null);
  assert.equal(detectVoiceBrowserLaneIntent("fix Browser Lane icon size"), null);
  assert.equal(detectVoiceBrowserLaneIntent("add tests for browser lane routing"), null);
});

test("task builder carries deterministic lane endpoint instructions", () => {
  const task = buildVoiceBrowserLaneTask({
    mode: "search",
    query: "Tesla Model S price",
  }, { titlePrefix: "Voice" });

  assert.equal(task.source, "browser-lane");
  assert.match(task.title, /Voice: Browser Lane search/);
  assert.match(task.description, /\/lane\/browser/);
  assert.doesNotMatch(task.description, /127\.0\.0\.1:3748\/lane\/browser/);
  assert.match(task.description, /hivematrix_browser/);
  assert.deepEqual(task.output.browserLaneVoice.args, { mode: "search", query: "Tesla Model S price" });
});

test("task builder makes logged-in workflow state explicit", () => {
  const task = buildVoiceBrowserLaneTask({
    mode: "workflow",
    objective: "Check LinkedIn friend requests",
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  }, { titlePrefix: "Voice" });

  assert.equal(task.source, "browser-lane");
  assert.match(task.title, /Voice: Browser Lane workflow Check LinkedIn friend requests/);
  assert.match(task.description, /Browser Lane workflow/);
  assert.match(task.description, /Requires login: yes/);
  assert.match(task.description, /operator/i);
  assert.match(task.description, /session|sign in|2FA/i);
  assert.match(task.description, /\/lane\/browser/);
  assert.doesNotMatch(task.description, /127\.0\.0\.1:3748\/lane\/browser/);
  assert.deepEqual(task.output.browserLaneVoice.args, {
    mode: "workflow",
    objective: "Check LinkedIn friend requests",
    startUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
    requiresLogin: true,
  });
});
