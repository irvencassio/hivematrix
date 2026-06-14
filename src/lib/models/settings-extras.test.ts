import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// getThemeSettings/getLocation/etc. read ~/.hivematrix/config.json — point HOME
// at a temp dir so the test is isolated.
const TMP = mkdtempSync(join(tmpdir(), "hm-settings-test-"));
process.env.HOME = TMP;

const s = await import("./available");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

test("location round-trips and clears", () => {
  assert.equal(s.getLocation(), "");
  s.setLocation("  Cincinnati, OH  ");
  assert.equal(s.getLocation(), "Cincinnati, OH");
  s.setLocation("");
  assert.equal(s.getLocation(), "");
});

test("autoUpdate defaults off and round-trips", () => {
  assert.equal(s.getAutoUpdate(), false);
  s.setAutoUpdate(true);
  assert.equal(s.getAutoUpdate(), true);
  s.setAutoUpdate(false);
  assert.equal(s.getAutoUpdate(), false);
});

test("wallpaper opacity defaults to 82 and clamps to 40–100", () => {
  assert.equal(s.getThemeSettings().wallpaperOpacity, 82);
  s.setWallpaperOpacity(10);
  assert.equal(s.getThemeSettings().wallpaperOpacity, 40, "clamped up to 40");
  s.setWallpaperOpacity(999);
  assert.equal(s.getThemeSettings().wallpaperOpacity, 100, "clamped down to 100");
  s.setWallpaperOpacity(65);
  assert.equal(s.getThemeSettings().wallpaperOpacity, 65);
});

test("role models default empty, round-trip per role, and clear back to default", () => {
  assert.deepEqual(s.getRoleModels(), { thinking: "", coding: "", operational: "" });
  s.setRoleModel("thinking", "claude-opus-4-8");
  s.setRoleModel("coding", "claude-fable-5");
  s.setRoleModel("operational", "qwen3-coder-30b");
  assert.deepEqual(s.getRoleModels(), {
    thinking: "claude-opus-4-8",
    coding: "claude-fable-5",
    operational: "qwen3-coder-30b",
  });
  // blank clears just that role back to the resolver default
  s.setRoleModel("coding", "  ");
  assert.equal(s.getRoleModels().coding, "");
  assert.equal(s.getRoleModels().thinking, "claude-opus-4-8", "other roles untouched");
});
