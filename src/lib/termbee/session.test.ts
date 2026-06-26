import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createSession, runCommand, readScrollback, listSessions, killSession } from "./session";

test("persistent session: state carries across commands, output captured, offline", { timeout: 20_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "termbee-"));
  const id = createSession({ cwd: dir });
  t.after(() => { killSession(id); rmSync(dir, { recursive: true, force: true }); });

  // 1) basic command + exit code (no network — pure local shell)
  const r1 = await runCommand(id, "echo hello-termbee");
  assert.equal(r1.exitCode, 0);
  assert.match(r1.output, /hello-termbee/);

  // 2) state persists: export a var, then read it back in a later command
  await runCommand(id, "export FOO=bar123");
  const r2 = await runCommand(id, "echo $FOO");
  assert.match(r2.output, /bar123/);

  // 3) cwd persists: cd into a subdir, pwd reflects it
  await runCommand(id, "mkdir -p sub && cd sub");
  const r3 = await runCommand(id, "pwd");
  assert.match(r3.output, /\/sub$/m);

  // 4) multi-step build-ish flow + non-zero exit code surfaces
  const r4 = await runCommand(id, "false");
  assert.equal(r4.exitCode, 1);

  // 5) scrollback accumulates across the session
  const sb = readScrollback(id);
  assert.ok(sb && sb.includes("hello-termbee"));

  // 6) listed as alive
  assert.ok(listSessions().some((s) => s.id === id && s.alive));
});

test("runCommand auto-creates a missing session", { timeout: 10_000 }, async (t) => {
  const id = "auto_sess_test";
  t.after(() => killSession(id));
  const r = await runCommand(id, "echo created-on-demand");
  assert.match(r.output, /created-on-demand/);
});

test("session can bind to a Terminal Lane profile/open command", { timeout: 10_000 }, async (t) => {
  const id = createSession({
    id: "bound_profile_test",
    profileId: "local-dev",
    openCommand: "/bin/bash",
    cwd: "/tmp",
  });
  t.after(() => killSession(id));

  const info = listSessions().find((s) => s.id === id);
  assert.ok(info);
  assert.equal(info.profileId, "local-dev");
  assert.equal(info.openCommand, "/bin/bash");

  const result = await runCommand(id, "echo bound-session");
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /bound-session/);
});
