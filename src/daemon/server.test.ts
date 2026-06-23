import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { CONSOLE_HTML } from "./console";
import { consoleHtmlHeaders, createDaemonServer, normalizeHomeProjectPath } from "./server";

test("console HTML routes are served with update-safe cache headers", () => {
  assert.deepEqual(consoleHtmlHeaders(), {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
});

test("Mermaid browser asset is served same-origin without a token", async (t) => {
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/assets/mermaid.min.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/javascript/);
  assert.match(await res.text(), /mermaid/i);
});

test("command project paths resolve from the current user home", () => {
  assert.equal(
    normalizeHomeProjectPath("~/hivematrix", "/Users/example"),
    "/Users/example/hivematrix",
  );
  assert.equal(
    normalizeHomeProjectPath("$HOME/hivematrix", "/Users/example"),
    "/Users/example/hivematrix",
  );
});

test("command project paths reject root and paths outside home", () => {
  assert.throws(
    () => normalizeHomeProjectPath("/", "/Users/example"),
    /cannot be root/,
  );
  assert.throws(
    () => normalizeHomeProjectPath("/tmp/hivematrix", "/Users/example"),
    /must be under/,
  );
});

test("command launcher sends its own visible project path", () => {
  assert.match(CONSOLE_HTML, /id="commandPath"/);
  assert.match(CONSOLE_HTML, /getElementById\('commandPath'\)/);
  assert.match(CONSOLE_HTML, /const projectPath = \(\(document\.getElementById\('commandPath'\) \|\| \{\}\)\.value \|\| '\$HOME'\)\.trim\(\) \|\| '\$HOME';/);
  // The command runner uses its own project path field, never the New Task path.
  const runCommand = CONSOLE_HTML.match(/async function runSelectedCommand\(\) \{[\s\S]*?\n\}/);
  assert.ok(runCommand, "runSelectedCommand block should be present");
  assert.doesNotMatch(runCommand![0], /t_path/);
  assert.match(CONSOLE_HTML, /projectPath:\s*projectPath/);
});
