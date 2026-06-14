import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAgentsMd, formatAgentsMd } from "./agents-md";

test("formatAgentsMd wraps content; empty stays empty", () => {
  assert.equal(formatAgentsMd(null), "");
  assert.equal(formatAgentsMd("   "), "");
  const out = formatAgentsMd("Use 2-space indent.");
  assert.match(out, /Project conventions \(AGENTS\.md\)/);
  assert.match(out, /Use 2-space indent\./);
});

test("readAgentsMd reads AGENTS.md from the project root (or .agents.md)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agmd-"));
  try {
    assert.equal(await readAgentsMd(dir), null, "absent → null");
    writeFileSync(join(dir, "AGENTS.md"), "# Conventions\nRun `npm test` before pushing.\n");
    const c = await readAgentsMd(dir);
    assert.ok(c && c.includes("Run `npm test`"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
