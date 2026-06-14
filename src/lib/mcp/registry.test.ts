import test from "node:test";
import assert from "node:assert/strict";
import { parseMcpServers } from "./registry";

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
