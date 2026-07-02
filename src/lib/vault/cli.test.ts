import assert from "node:assert/strict";
import test from "node:test";

import { parseVaultCli, renderVaultCliHelp } from "./cli";

test("vault CLI parses list/set/rm commands without inline secret leakage", () => {
  assert.deepEqual(parseVaultCli(["help"]), { command: "help" });
  assert.deepEqual(parseVaultCli([]), { command: "help" });
  assert.deepEqual(parseVaultCli(["list"]), { command: "list", scope: undefined });
  assert.deepEqual(parseVaultCli(["list", "--scope", "site"]), { command: "list", scope: "site" });

  assert.deepEqual(parseVaultCli([
    "set",
    "--scope", "site",
    "--name", "github.com",
    "--label", "GitHub PAT",
    "--value", "hunter2",
  ]), {
    command: "set",
    scope: "site",
    name: "github.com",
    label: "GitHub PAT",
    value: "hunter2",
  });

  assert.deepEqual(parseVaultCli([
    "set",
    "--scope", "env",
    "--name", "API_KEY",
  ]), {
    command: "set",
    scope: "env",
    name: "API_KEY",
    label: "",
    value: undefined,
  });

  assert.deepEqual(parseVaultCli(["rm", "env", "API_KEY"]), {
    command: "rm",
    scope: "env",
    name: "API_KEY",
  });
});

test("vault CLI rejects malformed set/rm arguments", () => {
  assert.throws(() => parseVaultCli(["set", "--scope", "site"]), /name is required/);
  assert.throws(() => parseVaultCli(["set", "--name", "abc"]), /scope is required/);
  assert.throws(() => parseVaultCli(["rm", "--scope", "site"]), /name is required/);
  assert.throws(() => parseVaultCli(["rm"]), /scope is required/);
  assert.throws(() => parseVaultCli(["unknown", "one"]), /unknown vault command/);
});

test("vault CLI help contains stdin guidance for secret values", () => {
  const help = renderVaultCliHelp();
  assert.match(help, /hive vault list/);
  assert.match(help, /hive vault set/);
  assert.match(help, /hive vault rm/);
  assert.match(help, /printf "my-value" \| hive vault set/);
});
