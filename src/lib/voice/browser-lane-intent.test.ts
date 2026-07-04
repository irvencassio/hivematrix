import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVoiceBrowserLaneTask,
  detectVoiceBrowserLaneIntent,
  detectGeneralBrowserLaneIntent,
} from "./browser-lane-intent";

test("general detector routes a plain browsing prompt (no 'browser lane' phrase) to Browser Lane", () => {
  // The voice detector requires the literal lead-in and returns null here…
  assert.equal(detectVoiceBrowserLaneIntent("go to acme.com and download the latest invoice"), null);
  // …but the general detector recognizes target + interaction.
  assert.deepEqual(detectGeneralBrowserLaneIntent("go to acme.com and download the latest invoice"), {
    mode: "open",
    url: "https://acme.com",
    objective: "go to acme.com and download the latest invoice",
  });
});

test("general detector opens an explicit URL with a nav verb", () => {
  assert.deepEqual(
    detectGeneralBrowserLaneIntent("open https://news.ycombinator.com and summarize the top story"),
    { mode: "open", url: "https://news.ycombinator.com", objective: "open https://news.ycombinator.com and summarize the top story" },
  );
});

test("general detector treats a login/account interaction as a workflow", () => {
  const intent = detectGeneralBrowserLaneIntent("log into portal.example.com and check my orders");
  assert.equal(intent?.mode, "workflow");
  assert.equal((intent as { startUrl: string }).startUrl, "https://portal.example.com");
  assert.equal((intent as { requiresLogin: boolean }).requiresLogin, true);
});

test("general detector matches explicit web-search phrasing without a target", () => {
  assert.deepEqual(detectGeneralBrowserLaneIntent("search the web for the best pizza in Chicago"), {
    mode: "search",
    query: "search the web for the best pizza in Chicago",
  });
});

test("general detector does NOT hijack code tasks that mention a URL or filename", () => {
  assert.equal(detectGeneralBrowserLaneIntent("refactor the fetch in src/api/client.ts that calls https://api.acme.com"), null);
  assert.equal(detectGeneralBrowserLaneIntent("fix the failing unit test in server.ts"), null);
  // A domain with no browsing verb is not enough to fire.
  assert.equal(detectGeneralBrowserLaneIntent("document how acme.com rate-limits our webhook"), null);
});

test("general detector ignores secrets in the prompt", () => {
  assert.equal(detectGeneralBrowserLaneIntent("go to acme.com and enter the password hunter2"), null);
});

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

// ── Generic routing guard: readSearch false-positives ──
// Descriptions that BEGIN with "Browser Lane" and contain a readSearch verb
// (check / inspect / research / summarize / read) currently trigger the
// `readSearch` branch because stripLeadIn matches them via the `direct` pattern
// (which does NOT require the "use" prefix). They should return null — these
// are dev-work descriptions ABOUT Browser Lane, not instructions to USE it.
//
// These tests FAIL today because stripLeadIn("Browser Lane check X") → "check X"
// and readSearch("check X") → {mode:"search", query:"X"} — a false positive.

test("descriptions starting with 'Browser Lane <readSearch-verb>' without explicit 'use' lead-in return null", () => {
  assert.equal(detectVoiceBrowserLaneIntent("Browser Lane check icon rendering"), null);
  assert.equal(detectVoiceBrowserLaneIntent("Browser Lane inspect the sidebar layout"), null);
  assert.equal(detectVoiceBrowserLaneIntent("Browser Lane research the navigation bug"), null);
  assert.equal(detectVoiceBrowserLaneIntent("Browser Lane summarize the icon issue"), null);
  assert.equal(detectVoiceBrowserLaneIntent("Browser Lane read the test results"), null);
});

// ── Generic routing guard: explicit 'use Browser Lane to' lead-in still routes ──
// After fixing the readSearch false-positive, "use Browser Lane to check X" must
// still route correctly. The explicit "use" framing distinguishes user instructions
// to invoke the lane from dev-work descriptions that mention the lane as a topic.
// These tests currently PASS and serve as regression guards for the fix.

test("explicit 'use Browser Lane to <readSearch-verb>' without a known service still routes to browser-lane search", () => {
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to check this article"), {
    mode: "search",
    query: "this article",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to research quantum computing"), {
    mode: "search",
    query: "quantum computing",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to inspect this page"), {
    mode: "search",
    query: "this page",
  });
  assert.deepEqual(detectVoiceBrowserLaneIntent("use Browser Lane to read this blog post"), {
    mode: "search",
    query: "this blog post",
  });
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
