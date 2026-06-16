import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { selectReleaseDmg } from "./release-artifacts.mjs";

test("release DMG selection prefers the clean custom DMG with stable public name", () => {
  const root = mkdtempSync(join(tmpdir(), "hm-release-artifacts-"));
  try {
    const bundle = join(root, "bundle");
    mkdirSync(join(bundle, "dmg"), { recursive: true });
    const tauriDmg = join(bundle, "dmg", "HiveMatrix_1.2.3_aarch64.dmg");
    const customDmg = join(bundle, "HiveMatrix-1.2.3.dmg");
    writeFileSync(tauriDmg, "tauri dmg");
    writeFileSync(customDmg, "clean dmg");

    assert.deepEqual(selectReleaseDmg(bundle, "1.2.3"), {
      sourcePath: customDmg,
      assetName: "HiveMatrix_1.2.3_aarch64.dmg",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

