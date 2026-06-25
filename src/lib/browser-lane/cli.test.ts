import assert from "node:assert/strict";
import test from "node:test";

import { parseBrowserLaneCli, renderBrowserLaneHelp } from "./cli";

test("browser lane CLI parses status and probe commands", () => {
  assert.deepEqual(parseBrowserLaneCli(["status"]), { command: "status" });
  assert.deepEqual(parseBrowserLaneCli(["probe", "heygen"]), { command: "probe", siteId: "heygen" });
  assert.deepEqual(parseBrowserLaneCli(["probe"]), { command: "probe", siteId: "all" });
});

test("browser lane CLI maps search and run to hivematrix_browser payloads", () => {
  assert.deepEqual(parseBrowserLaneCli(["search", "HeyGen API status"]), {
    command: "tool",
    tool: "hivematrix_browser",
    args: { mode: "search", query: "HeyGen API status" },
  });
  assert.deepEqual(parseBrowserLaneCli(["run", "https://app.heygen.com/home", "upload script"]), {
    command: "tool",
    tool: "hivematrix_browser",
    args: { mode: "workflow", startUrl: "https://app.heygen.com/home", objective: "upload script", requiresLogin: true },
  });
});

test("browser lane CLI read keeps both the URL and the question", () => {
  assert.deepEqual(parseBrowserLaneCli(["read", "https://example.com/pricing", "what changed?"]), {
    command: "tool",
    tool: "hivematrix_browser",
    args: { mode: "read", url: "https://example.com/pricing", query: "what changed?" },
  });
});

test("browser lane CLI accepts keychain references but rejects inline secrets", () => {
  assert.deepEqual(parseBrowserLaneCli([
    "auth",
    "set",
    "heygen",
    "--credential-ref",
    "hivematrix.browser.heygen.primary",
    "--username",
    "founder@example.com",
  ]), {
    command: "auth-set",
    siteId: "heygen",
    credentialRef: "hivematrix.browser.heygen.primary",
    username: "founder@example.com",
  });

  assert.throws(
    () => parseBrowserLaneCli(["auth", "set", "heygen", "--password", "nope"]),
    /must not accept/i,
  );
});

test("browser lane help teaches the stable command names", () => {
  const help = renderBrowserLaneHelp();
  assert.match(help, /hive browser status/);
  assert.match(help, /hive browser run/);
  assert.doesNotMatch(help, /BrowserBee|WebBee/);
});
