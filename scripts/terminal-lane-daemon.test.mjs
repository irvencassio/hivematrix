import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const server = readFileSync(new URL("../src/daemon/server.ts", import.meta.url), "utf8");

test("daemon declares Terminal Lane maintenance endpoints", () => {
  for (const route of [
    "/terminal-lane/profiles",
    "/terminal-lane/dashboard",
    "/terminal-lane/probes",
    "/terminal-lane/readiness/run",
    "/terminal-lane/traces",
  ]) {
    assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  }
});
