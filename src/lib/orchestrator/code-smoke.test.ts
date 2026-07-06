import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodeSmoke, isRunnableFile, smokeScriptPath } from "./code-smoke";

// These tests drive the real scripts/hive-verify-smoke.py harness under a pty, so
// they need python3 on PATH. Skip cleanly if it (or the harness) is unavailable
// rather than failing CI on an environment without Python.
const harnessAvailable = !!smokeScriptPath();

// The static stage uses ruff if present. Tests that assert ruff-specific behavior
// skip when it is absent (the harness degrades to the runtime stage in that case).
const ruffAvailable = (() => {
  try {
    execFileSync("ruff", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("isRunnableFile matches Python, ignores others", () => {
  assert.equal(isRunnableFile("game.py"), true);
  assert.equal(isRunnableFile("/abs/path/App.PY"), true);
  assert.equal(isRunnableFile("readme.md"), false);
  assert.equal(isRunnableFile("main.ts"), false);
});

test("runCodeSmoke returns ran:false when there is nothing runnable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smoke-none-"));
  try {
    writeFileSync(join(dir, "notes.md"), "# nothing to run\n");
    const res = await runCodeSmoke(dir, ["notes.md"]);
    assert.equal(res.ran, false);
    assert.equal(res.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "static stage FAILS a library module with an undefined name (py_compile would pass it)",
  { skip: !harnessAvailable || !ruffAvailable },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-mod-"));
    try {
      // No __main__ guard → the runtime stage only py_compiles this, which is
      // green despite `os` never being imported. The ruff static stage catches it.
      const mod = ["def save(score):", "    return os.path.expanduser('~/x')", ""].join("\n");
      writeFileSync(join(dir, "helper.py"), mod);
      const res = await runCodeSmoke(dir, ["helper.py"]);
      assert.equal(res.ran, true);
      assert.equal(res.ok, false);
      assert.match(res.report, /Code Verification Gate: FAILED/);
      assert.match(res.report, /F821|Undefined name|ruff/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "static stage does NOT block on a mere unused import (F401 is excluded)",
  { skip: !harnessAvailable || !ruffAvailable },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-unused-"));
    try {
      const mod = ["import os", "import sys", "print(sys.version)", ""].join("\n");
      writeFileSync(join(dir, "lib.py"), mod);
      const res = await runCodeSmoke(dir, ["lib.py"]);
      assert.equal(res.ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("runCodeSmoke FAILS on a curses program that crashes on first render", { skip: !harnessAvailable }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "smoke-bad-"));
  try {
    // Classic bottom-right-corner crash: full-width write on the last line.
    const bad = [
      "import curses",
      "def main(stdscr):",
      "    h, w = stdscr.getmaxyx()",
      "    stdscr.addstr(h - 1, 0, '#' * w)",  // fills the final cell -> addwstr ERR
      "    stdscr.refresh()",
      "    stdscr.getch()",
      "if __name__ == '__main__':",
      "    curses.wrapper(main)",
      "",
    ].join("\n");
    writeFileSync(join(dir, "bad.py"), bad);
    const res = await runCodeSmoke(dir, ["bad.py"]);
    assert.equal(res.ran, true);
    assert.equal(res.ok, false);
    assert.match(res.report, /Code Verification Gate: FAILED/);
    assert.match(res.report, /addwstr\(\) returned ERR/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCodeSmoke PASSES a well-behaved curses program", { skip: !harnessAvailable }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "smoke-good-"));
  try {
    const good = [
      "import curses",
      "def main(stdscr):",
      "    stdscr.nodelay(1)",
      "    stdscr.timeout(50)",
      "    h, w = stdscr.getmaxyx()",
      "    stdscr.erase()",
      "    stdscr.addstr(0, 0, 'ok'[: w - 1])",  // safe write
      "    stdscr.refresh()",
      "    while True:",
      "        if stdscr.getch() == ord('q'):",
      "            break",
      "if __name__ == '__main__':",
      "    curses.wrapper(main)",
      "",
    ].join("\n");
    writeFileSync(join(dir, "good.py"), good);
    const res = await runCodeSmoke(dir, ["good.py"]);
    assert.equal(res.ran, true);
    assert.equal(res.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCodeSmoke does not fail a deliberate non-zero exit", { skip: !harnessAvailable }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "smoke-exit-"));
  try {
    writeFileSync(join(dir, "cli.py"), "import sys\nif __name__ == '__main__':\n    sys.exit(3)\n");
    const res = await runCodeSmoke(dir, ["cli.py"]);
    assert.equal(res.ran, true);
    assert.equal(res.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
