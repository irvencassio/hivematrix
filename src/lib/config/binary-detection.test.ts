import test from "node:test";
import assert from "node:assert/strict";

import { buildCliPath, detectBinary, splitCommand } from "./binary-detection";

test("splitCommand extracts a binary and arguments", () => {
  assert.deepEqual(splitCommand("codex --profile work"), ["codex", "--profile", "work"]);
});

test("detectBinary finds a configured absolute path", () => {
  assert.equal(detectBinary({ name: "missing", configuredPath: "/bin/sh" }), true);
});

test("detectBinary uses explicit search paths when the app PATH is sparse", () => {
  assert.equal(detectBinary({
    name: "missing-codex-test-binary",
    searchPaths: ["/bin/sh"],
  }), true);
});

test("detectBinary checks the binary from configured command", () => {
  assert.equal(detectBinary({
    name: "missing",
    configuredCommand: "/bin/sh --version",
  }), true);
});

test("buildCliPath prepends Homebrew paths for GUI-launched CLI scripts", () => {
  const path = buildCliPath("/usr/bin:/bin");
  const entries = path.split(":");

  assert.equal(entries[0], "/opt/homebrew/bin");
  assert.equal(entries[1], "/usr/local/bin");
  assert.ok(entries.includes("/usr/bin"));
  assert.ok(entries.includes("/bin"));
});
