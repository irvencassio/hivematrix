import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { executeTool } from "./tool-bridge";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "hm-tool-bridge-"));
}

// create_task shells out (curl) to the real daemon HTTP API on
// HIVEMATRIX_PORT — there's no DI seam for that, so these tests spin up a
// real daemon server (same pattern as server.test.ts's startServer) against
// an isolated HOME + temp DB, and point HIVEMATRIX_PORT at it.
async function withRealDaemon<T>(run: (ctx: { base: string; headers: Record<string, string> }) => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalPort = process.env.HIVEMATRIX_PORT;
  const tmp = mkdtempSync(join(tmpdir(), "hm-tool-bridge-daemon-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "test.db");
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  const { createDaemonServer } = await import("@/daemon/server");
  const { getOrCreateToken, DAEMON_TOKEN_FILE } = await import("@/lib/auth/token");
  const token = getOrCreateToken(DAEMON_TOKEN_FILE);
  const server = createDaemonServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env.HIVEMATRIX_PORT = String(port);
  try {
    return await run({ base: `http://127.0.0.1:${port}`, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    _resetDbForTests();
    delete process.env.HIVEMATRIX_DB_PATH;
    if (originalPort) process.env.HIVEMATRIX_PORT = originalPort; else delete process.env.HIVEMATRIX_PORT;
    if (originalHome) process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function createTopLevelTask(base: string, headers: Record<string, string>, description = "Parent coordinator task"): Promise<string> {
  const res = await fetch(`${base}/tasks`, {
    method: "POST", headers,
    body: JSON.stringify({ description, agentType: "coo", project: "ops", projectPath: "/tmp", route: "normal" }),
  });
  const body = await res.json() as { _id: string };
  assert.equal(res.status, 201, `createTopLevelTask setup failed: ${JSON.stringify(body)}`);
  return body._id;
}

function extractCreatedTaskId(result: string): string {
  const m = result.match(/^Created task ([^:]+):/);
  assert.ok(m, `expected a "Created task <id>: ..." result, got: ${result}`);
  return m![1];
}

test("executeTool reports a truncated (cut-off-mid-JSON) write_file call as such and does not create a file", async () => {
  const dir = tempProject();
  try {
    const truncated = '{"path":"out.txt","content":"<!DOCTYPE html>\\n<html lang=\\"en\\">\\n<head';

    const out = await executeTool("write_file", truncated, dir);

    assert.match(out, /cut off mid-JSON/i);
    assert.match(out, /NOT executed/);
    assert.match(out, new RegExp(`${truncated.length} chars`));
    assert.match(out, /mode="append"/);
    assert.equal(existsSync(join(dir, "out.txt")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeTool reports genuinely malformed (but complete) JSON as invalid, not truncated", async () => {
  const dir = tempProject();
  try {
    const malformed = '{"path": }';

    const out = await executeTool("write_file", malformed, dir);

    assert.match(out, /Invalid JSON arguments/);
    assert.doesNotMatch(out, /cut off mid-JSON/i);
    assert.match(out, new RegExp(`${malformed.length} chars`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

test("write_file defaults to overwrite, replacing existing content", async () => {
  const dir = tempProject();
  try {
    const file = join(dir, "out.txt");
    writeFileSync(file, "stale content");

    const out = await executeTool("write_file", JSON.stringify({ path: "out.txt", content: "fresh content" }), dir);

    assert.match(out, /^File written:/);
    assert.equal(readFileSync(file, "utf-8"), "fresh content");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write_file mode=append adds to the end of an existing file without truncating it", async () => {
  const dir = tempProject();
  try {
    const file = join(dir, "out.txt");
    await executeTool("write_file", JSON.stringify({ path: "out.txt", content: "part one\n" }), dir);
    const out = await executeTool("write_file", JSON.stringify({ path: "out.txt", content: "part two\n", mode: "append" }), dir);

    assert.match(out, /^File appended:/);
    assert.equal(readFileSync(file, "utf-8"), "part one\npart two\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write_file mode=append creates the file when it does not exist yet, like shell >>", async () => {
  const dir = tempProject();
  try {
    const file = join(dir, "new.txt");

    const out = await executeTool("write_file", JSON.stringify({ path: "new.txt", content: "first chunk", mode: "append" }), dir);

    assert.match(out, /^File appended:/);
    assert.equal(readFileSync(file, "utf-8"), "first chunk");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write_file falls back to overwrite for an unrecognised mode value", async () => {
  const dir = tempProject();
  try {
    const file = join(dir, "out.txt");
    writeFileSync(file, "stale content");

    const out = await executeTool("write_file", JSON.stringify({ path: "out.txt", content: "fresh content", mode: "bogus" }), dir);

    assert.match(out, /^File written:/);
    assert.equal(readFileSync(file, "utf-8"), "fresh content");
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

test("create_task fails CLOSED when the depth-check HTTP call cannot be verified — refused, not 'proceed cautiously'", async () => {
  await withRealDaemon(async ({ base, headers }) => {
    const parentId = await createTopLevelTask(base, headers);
    const goodPort = process.env.HIVEMATRIX_PORT;
    process.env.HIVEMATRIX_PORT = "1"; // reserved port — nothing listens here, the curl call errors
    try {
      const result = await executeTool(
        "create_task",
        JSON.stringify({ description: "Do the subtask", agentType: "developer" }),
        "/tmp",
        { parentTaskId: parentId, parentProject: "ops", currentAgentType: "coo" },
      );
      assert.match(result, /^Error:/);
      assert.match(result, /refusing to create a subtask/i);
    } finally {
      process.env.HIVEMATRIX_PORT = goodPort;
    }
  });
});

test("create_task's sibling cap counts only THIS parent's real children, not every active task in the system", async () => {
  await withRealDaemon(async ({ base, headers }) => {
    const parentA = await createTopLevelTask(base, headers, "Parent A");
    const parentB = await createTopLevelTask(base, headers, "Parent B");

    // Unrelated tasks — none of this should count against parent A's cap.
    // (Before the parentTaskId query-filter fix, the sibling check counted
    // every active task in the system, not just this parent's children.)
    for (let i = 0; i < 9; i++) await createTopLevelTask(base, headers, `Noise task ${i}`);
    for (let i = 0; i < 3; i++) {
      const r = await executeTool("create_task", JSON.stringify({ description: `B child ${i}`, agentType: "developer" }), "/tmp", { parentTaskId: parentB, parentProject: "ops" });
      assert.match(r, /^Created task/);
    }

    for (let i = 0; i < 10; i++) {
      const r = await executeTool("create_task", JSON.stringify({ description: `A child ${i}`, agentType: "developer" }), "/tmp", { parentTaskId: parentA, parentProject: "ops" });
      assert.match(r, /^Created task/, `A child ${i} should succeed — the cap must count only parent A's own children`);
    }
    const eleventh = await executeTool("create_task", JSON.stringify({ description: "A child 11", agentType: "developer" }), "/tmp", { parentTaskId: parentA, parentProject: "ops" });
    assert.match(eleventh, /Maximum subtasks per parent/);
  });
});

test("create_task: a subtask cannot create a subtask (depth cap 2)", async () => {
  await withRealDaemon(async ({ base, headers }) => {
    const parentId = await createTopLevelTask(base, headers);
    const childId = extractCreatedTaskId(await executeTool(
      "create_task", JSON.stringify({ description: "child", agentType: "developer" }), "/tmp",
      { parentTaskId: parentId, parentProject: "ops" },
    ));
    const grandchild = await executeTool(
      "create_task", JSON.stringify({ description: "grandchild", agentType: "developer" }), "/tmp",
      { parentTaskId: childId, parentProject: "ops" },
    );
    assert.match(grandchild, /Maximum subtask depth/);
  });
});

test("create_task: dependsOn accepts a real sibling id and it's persisted on the new task", async () => {
  await withRealDaemon(async ({ base, headers }) => {
    const parentId = await createTopLevelTask(base, headers);
    const first = extractCreatedTaskId(await executeTool(
      "create_task", JSON.stringify({ description: "First subtask", agentType: "developer" }), "/tmp",
      { parentTaskId: parentId, parentProject: "ops" },
    ));
    const second = extractCreatedTaskId(await executeTool(
      "create_task", JSON.stringify({ description: "Second subtask", agentType: "qa", dependsOn: [first] }), "/tmp",
      { parentTaskId: parentId, parentProject: "ops" },
    ));

    const row = await (await fetch(`${base}/tasks/${second}`, { headers })).json() as Record<string, unknown>;
    const dependsOn = JSON.parse(String(row.dependsOn ?? "[]"));
    assert.deepEqual(dependsOn, [first]);
  });
});

test("create_task: dependsOn referencing a non-sibling id is rejected", async () => {
  await withRealDaemon(async ({ base, headers }) => {
    const parentId = await createTopLevelTask(base, headers);
    const otherTopLevel = await createTopLevelTask(base, headers, "Unrelated task");
    const result = await executeTool(
      "create_task", JSON.stringify({ description: "Bad subtask", agentType: "developer", dependsOn: [otherTopLevel] }), "/tmp",
      { parentTaskId: parentId, parentProject: "ops" },
    );
    assert.match(result, /not siblings/);
  });
});

test("create_task: dependsOn is rejected when creating a top-level task (no parentTaskId — nothing to be a sibling of)", async () => {
  await withRealDaemon(async () => {
    const result = await executeTool(
      "create_task", JSON.stringify({ description: "Top-level", agentType: "developer", dependsOn: ["some-id"] }), "/tmp", {},
    );
    assert.match(result, /only valid when creating a subtask/);
  });
});

// ─── dispatch_capability — the typed COO dispatcher, not create_task ───────

test("dispatch_capability requires a non-empty request", async () => {
  await withRealDaemon(async () => {
    const result = await executeTool("dispatch_capability", JSON.stringify({}), "/tmp", {});
    assert.match(result, /^Error: request is required/);
  });
});

test("dispatch_capability: no routing rules configured ⇒ honest no_match, never fabricates a route", async () => {
  await withRealDaemon(async () => {
    const result = await executeTool("dispatch_capability", JSON.stringify({ request: "do something nobody routes" }), "/tmp", {});
    assert.match(result, /No capability route matched/);
  });
});

test("dispatch_capability: mail/message/desktop ALWAYS come back approval_required — never auto-approved", async () => {
  await withRealDaemon(async () => {
    const { seedDefaultCooRoutingRules } = await import("@/lib/coo/store");
    seedDefaultCooRoutingRules();
    const result = await executeTool("dispatch_capability", JSON.stringify({ request: "send mail to the investor list" }), "/tmp", {});
    assert.match(result, /^APPROVAL REQUIRED — not executed\./);
    assert.doesNotMatch(result, /\bwas sent\b|\bhas been sent\b|\bis done\b/i, "must never claim the mail was sent");
  });
});

test("dispatch_capability: memory/review report unsupported — the COO must say so, not improvise with bash", async () => {
  await withRealDaemon(async () => {
    const { seedDefaultCooRoutingRules } = await import("@/lib/coo/store");
    seedDefaultCooRoutingRules();
    const result = await executeTool("dispatch_capability", JSON.stringify({ request: "remember this for later" }), "/tmp", {});
    assert.match(result, /^Unsupported — no execution bridge for this yet\./);
  });
});

test("dispatch_capability: terminal (executable lane) comes back prepared, with the matched capability named", async () => {
  await withRealDaemon(async () => {
    const { seedDefaultCooRoutingRules } = await import("@/lib/coo/store");
    seedDefaultCooRoutingRules();
    const result = await executeTool("dispatch_capability", JSON.stringify({ request: "run command to list files" }), "/tmp", {});
    assert.match(result, /^Prepared \(lane: terminal/);
  });
});
