import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contextInventory, listContextSources, AGENTS_MD_MAX_CHARS } from "./context-inventory";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "hm-ctx-"));
}

test("AGENTS_MD_MAX_CHARS matches the cap actually applied at injection", async () => {
  // If these drift, the panel reassures the operator their file fits while the
  // injector is quietly cutting it. Pin them to the same number.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../conventions/agents-md.ts", import.meta.url), "utf-8"),
  );
  const m = /const MAX_CHARS = ([\d_]+);/.exec(src);
  assert.ok(m, "agents-md.ts should declare MAX_CHARS");
  assert.equal(Number(m[1].replace(/_/g, "")), AGENTS_MD_MAX_CHARS);
});

test("reports a present AGENTS.md with its size and cap, untruncated when it fits", () => {
  const dir = tempProject();
  writeFileSync(join(dir, "AGENTS.md"), "# conventions\nkeep it short\n");
  const agents = listContextSources(dir).find((s) => s.label === "AGENTS.md")!;
  assert.equal(agents.found, true);
  assert.equal(agents.kind, "file");
  assert.equal(agents.capChars, AGENTS_MD_MAX_CHARS);
  assert.equal(agents.truncated, false);
  assert.ok(agents.bytes > 0);
});

test("flags AGENTS.md as truncated once it exceeds the injection cap", () => {
  // The real hazard: AGENTS.md is injected into every task and silently sliced
  // at 8000 chars, and this repo's copy puts its git-hygiene rules LAST — so
  // overflow removes exactly the instructions that keep tasks from clobbering
  // each other's work, with nothing surfaced anywhere.
  const dir = tempProject();
  writeFileSync(join(dir, "AGENTS.md"), "x".repeat(AGENTS_MD_MAX_CHARS + 1));
  const agents = listContextSources(dir).find((s) => s.label === "AGENTS.md")!;
  assert.equal(agents.truncated, true, "over-cap AGENTS.md must be reported as cut");
  assert.deepEqual(contextInventory(dir).truncated, ["AGENTS.md"]);
});

test("a missing file is reported as absent, not as zero-and-fine", () => {
  const dir = tempProject();
  const inv = contextInventory(dir);
  assert.ok(inv.missing.includes("AGENTS.md"));
  assert.ok(inv.missing.includes("CLAUDE.md"));
  const agents = inv.sources.find((s) => s.label === "AGENTS.md")!;
  assert.equal(agents.found, false);
  assert.ok(agents.path, "still reports where it WOULD be read from");
});

test("agent-guide.md is listed, and its note explains the misleading overhead figure", () => {
  // A task's recorded `agentGuide` overhead is an accumulator over generated
  // blocks plus this file. It read 16,747 bytes on a machine where the file does
  // not exist, which invites someone to go looking for a file with that content.
  const src = listContextSources(tempProject()).find((s) => s.label === "agent-guide.md")!;
  assert.equal(src.kind, "file");
  assert.match(src.note, /agentGuide/);
  assert.match(src.path!, /\.hivematrix\/agent-guide\.md$/);
});

test("generated blocks are listed but distinguishable from files", () => {
  const sources = listContextSources(tempProject());
  const generated = sources.filter((s) => s.kind === "generated");
  assert.ok(generated.length >= 5, "the bulk of prompt overhead is generated, not files");
  for (const g of generated) {
    assert.equal(g.path, null, `${g.label} must not claim a file path — it cannot be edited`);
    assert.ok(g.note.trim(), `${g.label} needs a plain-English note`);
  }
});

test("MEMORY.md resolves under the profile-specific config dir", () => {
  const dir = tempProject();
  const withProfile = listContextSources(dir, "claude-el").find((s) => s.label === "MEMORY.md")!;
  assert.match(withProfile.path!, /\.claude-el\/projects\//);
  assert.match(withProfile.path!, /memory\/MEMORY\.md$/);
});

test("fileBytes counts only real files, never the generated blocks", () => {
  const dir = tempProject();
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "abc");
  const inv = contextInventory(dir);
  const sum = inv.sources.filter((s) => s.kind === "file").reduce((n, s) => n + s.bytes, 0);
  assert.equal(inv.fileBytes, sum);
});
