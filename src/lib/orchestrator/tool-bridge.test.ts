import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeTool } from "./tool-bridge";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "hm-tool-bridge-"));
}

test("read_file refuses binary image attachments instead of injecting bytes", async () => {
  const dir = tempProject();
  try {
    const img = join(dir, "shot.png");
    writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]));

    const out = await executeTool("read_file", JSON.stringify({ path: img }), dir);

    assert.match(out, /binary|image/i);
    assert.match(out, /cannot be read as text/i);
    assert.doesNotMatch(out, /PNG\r?\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read_file defaults to a bounded window and tells the model how to continue", async () => {
  const dir = tempProject();
  try {
    const file = join(dir, "big.ts");
    writeFileSync(file, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n"));

    const out = await executeTool("read_file", JSON.stringify({ path: "big.ts" }), dir);

    assert.match(out, /^1\tline 1/m);
    assert.doesNotMatch(out, /500\tline 500/);
    assert.match(out, /truncated/i);
    assert.match(out, /offset/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search excludes generated dependency and worktree folders by default", async () => {
  const dir = tempProject();
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
    mkdirSync(join(dir, ".claude/worktrees/old/src"), { recursive: true });
    writeFileSync(join(dir, "src/console.ts"), "const marker = 'Observability';\n");
    writeFileSync(join(dir, "dist/console.js"), "const marker = 'Observability';\n");
    writeFileSync(join(dir, "node_modules/pkg/index.js"), "const marker = 'Observability';\n");
    writeFileSync(join(dir, ".claude/worktrees/old/src/console.ts"), "const marker = 'Observability';\n");

    const out = await executeTool("search", JSON.stringify({ pattern: "Observability" }), dir);

    assert.match(out, /src\/console\.ts/);
    assert.doesNotMatch(out, /dist\/console\.js/);
    assert.doesNotMatch(out, /node_modules/);
    assert.doesNotMatch(out, /\.claude/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("list_files excludes generated dependency and worktree folders by default", async () => {
  const dir = tempProject();
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, ".claude/worktrees/old/src"), { recursive: true });
    writeFileSync(join(dir, "src/console.ts"), "");
    writeFileSync(join(dir, "dist/console.ts"), "");
    writeFileSync(join(dir, ".claude/worktrees/old/src/console.ts"), "");

    const out = await executeTool("list_files", JSON.stringify({ pattern: "**/*.ts" }), dir);

    assert.match(out, /src\/console\.ts/);
    assert.doesNotMatch(out, /dist\/console\.ts/);
    assert.doesNotMatch(out, /\.claude/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
