import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brainDocPolicyText, defaultBrainRootDir, normalizeBrainRootDir, shortenHome } from "./settings";

test("defaultBrainRootDir stays pinned to the Google Drive brain root", () => {
  const root = mkdtempSync(join(tmpdir(), "hive-brain-settings-"));
  const home = join(root, "home");
  const previousHome = process.env.HOME;

  process.env.HOME = home;

  try {
    assert.equal(defaultBrainRootDir(), join(home, "_GD", "brain"));
    assert.match(brainDocPolicyText(), /~\/_GD\/brain/);
    assert.match(brainDocPolicyText(), /create subdirectories as needed/i);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("normalizeBrainRootDir falls back to the recommended Google Drive brain root", () => {
  const root = mkdtempSync(join(tmpdir(), "hive-brain-settings-"));
  const home = join(root, "home");
  const previousHome = process.env.HOME;

  process.env.HOME = home;

  try {
    assert.equal(normalizeBrainRootDir(""), join(home, "_GD", "brain"));
    assert.equal(shortenHome(normalizeBrainRootDir("")), "~/_GD/brain");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
