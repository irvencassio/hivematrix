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

test("app icon choice defaults to dark-green and round-trips known values", () => {
  assert.equal(s.getAppIconChoice(), "dark-green");
  s.setAppIconChoice("white");
  assert.equal(s.getAppIconChoice(), "white");
  s.setAppIconChoice("dark-green");
  assert.equal(s.getAppIconChoice(), "dark-green");
});

test("wallpaper opacity defaults to 82 and clamps to 0–100", () => {
  assert.equal(s.getThemeSettings().wallpaperOpacity, 82);
  s.setWallpaperOpacity(10);
  assert.equal(s.getThemeSettings().wallpaperOpacity, 10, "values below 40 now persist");
  s.setWallpaperOpacity(0);
  assert.equal(s.getThemeSettings().wallpaperOpacity, 0, "fully transparent allowed");
  s.setWallpaperOpacity(-5);
  assert.equal(s.getThemeSettings().wallpaperOpacity, 0, "clamped up to 0");
  s.setWallpaperOpacity(999);
  assert.equal(s.getThemeSettings().wallpaperOpacity, 100, "clamped down to 100");
  s.setWallpaperOpacity(65);
  assert.equal(s.getThemeSettings().wallpaperOpacity, 65);
});

test("role models default empty, round-trip per role, and clear back to default", () => {
  assert.deepEqual(s.getRoleModels(), { thinking: "", coding: "", operational: "", writer: "" });
  s.setRoleModel("thinking", "claude-opus-4-8");
  s.setRoleModel("coding", "claude-sonnet-4-6");
  s.setRoleModel("operational", "qwen3-coder-30b");
  s.setRoleModel("writer", "claude-sonnet-4-6");
  assert.deepEqual(s.getRoleModels(), {
    thinking: "claude-opus-4-8",
    coding: "claude-sonnet-4-6",
    operational: "qwen3-coder-30b",
    writer: "claude-sonnet-4-6",
  });
  // blank clears just that role back to the resolver default
  s.setRoleModel("coding", "  ");
  assert.equal(s.getRoleModels().coding, "");
  assert.equal(s.getRoleModels().thinking, "claude-opus-4-8", "other roles untouched");
});

test("getRoleModelsForDisplay aliases legacy Claude IDs while storage stays raw", () => {
  s.setRoleModel("thinking", "claude-opus-4-8");
  s.setRoleModel("coding", "claude-sonnet-4-6");
  s.setRoleModel("operational", "qwen3-coder-30b");
  s.setRoleModel("writer", "opus");
  // Display value the console dropdown matches against uses the CLI aliases, so a
  // legacy pinned full id selects the "Claude Opus"/"Claude Sonnet" option instead
  // of rendering as a raw id.
  assert.deepEqual(s.getRoleModelsForDisplay(), {
    thinking: "opus",
    coding: "sonnet",
    operational: "qwen3-coder-30b",
    writer: "opus",
  });
  // Stored config is untouched — full names still resolve via the CLI + regexes.
  assert.equal(s.getRoleModels().thinking, "claude-opus-4-8");
  assert.equal(s.getRoleModels().coding, "claude-sonnet-4-6");
});
