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

test("browser lane CLI parses site maintenance commands without secrets", () => {
  assert.deepEqual(parseBrowserLaneCli(["sites", "list"]), {
    command: "sites-list",
  });

  assert.deepEqual(parseBrowserLaneCli([
    "sites",
    "add",
    "heygen",
    "--name",
    "HeyGen",
    "--home-url",
    "https://app.heygen.com/home",
    "--login-url",
    "https://app.heygen.com/login",
    "--domain",
    "app.heygen.com",
    "--credential-ref",
    "hivematrix.browser.heygen.primary",
  ]), {
    command: "sites-add",
    site: {
      id: "heygen",
      displayName: "HeyGen",
      homeUrl: "https://app.heygen.com/home",
      loginUrl: "https://app.heygen.com/login",
      allowedDomains: ["app.heygen.com"],
      credentialRef: "hivematrix.browser.heygen.primary",
    },
  });
});

test("browser lane CLI parses probe maintenance commands", () => {
  assert.deepEqual(parseBrowserLaneCli([
    "probes",
    "add",
    "heygen",
    "heygen-home",
    "--name",
    "Home",
    "--url",
    "https://app.heygen.com/home",
    "--text",
    "Create video",
  ]), {
    command: "probes-add",
    probe: {
      id: "heygen-home",
      siteId: "heygen",
      name: "Home",
      url: "https://app.heygen.com/home",
      assertions: [{ kind: "text", value: "Create video", optional: false }],
      requiresAuth: true,
    },
  });
});

test("browser lane CLI parses trace inspection commands", () => {
  assert.deepEqual(parseBrowserLaneCli(["trace", "list"]), {
    command: "trace-list",
  });
  assert.deepEqual(parseBrowserLaneCli(["trace", "latest"]), {
    command: "trace-latest",
  });
  assert.deepEqual(parseBrowserLaneCli(["trace", "show", "trace-123"]), {
    command: "trace-show",
    traceRunId: "trace-123",
  });
});

test("browser lane help teaches the stable command names", () => {
  const help = renderBrowserLaneHelp();
  assert.match(help, /hive browser status/);
  assert.match(help, /hive browser sites add/);
  assert.match(help, /hive browser probes add/);
  assert.match(help, /hive browser trace latest/);
  assert.match(help, /hive browser run/);
  assert.doesNotMatch(help, /BrowserBee|WebBee/);
});
