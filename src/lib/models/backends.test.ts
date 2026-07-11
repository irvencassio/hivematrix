import test from "node:test";
import assert from "node:assert/strict";

import { detectBackends } from "./backends";

function fixture(installed: boolean, enabled: boolean) {
  return detectBackends({
    findBinary: (name) => (name === "claude" && installed ? "/fake/bin/claude" : null),
    isProviderEnabled: (id) => (id === "claude" ? enabled : false),
  });
}

test("installed=true, enabled=true -> configured=true", () => {
  const claude = fixture(true, true).find((b) => b.id === "claude")!;
  assert.equal(claude.installed, true);
  assert.equal(claude.enabled, true);
  assert.equal(claude.configured, true);
});

test("installed=true, enabled=false -> configured=false (disabled but still installed)", () => {
  const claude = fixture(true, false).find((b) => b.id === "claude")!;
  assert.equal(claude.installed, true);
  assert.equal(claude.enabled, false);
  assert.equal(claude.configured, false);
});

test("installed=false, enabled=true -> configured=false (enabled mid-setup, not installed yet)", () => {
  const claude = fixture(false, true).find((b) => b.id === "claude")!;
  assert.equal(claude.installed, false);
  assert.equal(claude.enabled, true);
  assert.equal(claude.configured, false);
});

test("installed=false, enabled=false -> configured=false", () => {
  const claude = fixture(false, false).find((b) => b.id === "claude")!;
  assert.equal(claude.installed, false);
  assert.equal(claude.enabled, false);
  assert.equal(claude.configured, false);
});
