import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMcpServers, getMcpServers } from "./registry";

function withHome<T>(setup: (home: string) => void, run: () => T): T {
  const orig = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "hm-mcp-registry-"));
  setup(home);
  process.env.HOME = home;
  try { return run(); }
  finally {
    process.env.HOME = orig;
    rmSync(home, { recursive: true, force: true });
  }
}

test("parseMcpServers normalizes transports and infers from url", () => {
  const servers = parseMcpServers({
    ssh: { transport: "stdio", command: "node", args: ["ssh-mcp.js"] },
    weather: { url: "http://localhost:9000" },
    events: { url: "http://localhost:9001/sse" },
    bad: "nope",
  });
  assert.equal(servers.length, 3); // "bad" dropped
  const byName = Object.fromEntries(servers.map((s) => [s.name, s]));
  assert.equal(byName.ssh.transport, "stdio");
  assert.deepEqual(byName.ssh.args, ["ssh-mcp.js"]);
  assert.equal(byName.weather.transport, "http"); // inferred from url
  assert.equal(byName.events.transport, "sse"); // inferred from /sse
  // sorted by name
  assert.deepEqual(servers.map((s) => s.name), ["events", "ssh", "weather"]);
});

test("parseMcpServers tolerates empty/missing config", () => {
  assert.deepEqual(parseMcpServers(undefined), []);
  assert.deepEqual(parseMcpServers({}), []);
});

test("getMcpServers always includes the internal flash entry, even with no config.json", () => {
  const servers = withHome(() => {}, () => getMcpServers());
  const flash = servers.find((s) => s.name === "flash");
  assert.ok(flash, "flash entry should always be present");
  assert.equal(flash!.scope, "internal");
  assert.equal(flash!.readOnly, true);
  assert.match(flash!.description ?? "", /built-in, always available to chat/);
});

test("getMcpServers merges ~/.claude.json mcpServers as read-only claude-code entries", () => {
  const servers = withHome((home) => {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      mcpServers: { canopy: { command: "canopy-mcp" } },
    }));
  }, () => getMcpServers());

  const canopy = servers.find((s) => s.name === "canopy");
  assert.ok(canopy, "canopy should be reflected from ~/.claude.json");
  assert.equal(canopy!.scope, "claude-code");
  assert.equal(canopy!.readOnly, true);
  assert.match(canopy!.description ?? "", /not exposed to the in-app chat/);
  assert.equal(canopy!.transport, "stdio");
  assert.equal(canopy!.command, "canopy-mcp");

  // flash is still present alongside the reflected entry
  assert.ok(servers.some((s) => s.name === "flash"));
});

test("getMcpServers: a config.json entry with the same name wins over a ~/.claude.json reflection", () => {
  const servers = withHome((home) => {
    mkdirSync(join(home, ".hivematrix"), { recursive: true });
    writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({
      mcpServers: { canopy: { url: "http://localhost:9500" } },
    }));
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      mcpServers: { canopy: { command: "canopy-mcp" } },
    }));
  }, () => getMcpServers());

  const canopy = servers.filter((s) => s.name === "canopy");
  assert.equal(canopy.length, 1, "no duplicate entries for the same name");
  assert.equal(canopy[0].scope, "config");
  assert.equal(canopy[0].readOnly, undefined);
  assert.equal(canopy[0].url, "http://localhost:9500");
});

test("getMcpServers tolerates a missing/invalid ~/.claude.json", () => {
  const servers = withHome(() => {}, () => getMcpServers());
  // Should not throw, and should not include any claude-code-scoped entries.
  assert.ok(!servers.some((s) => s.scope === "claude-code"));
});
