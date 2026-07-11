import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("HiveMatrix release bundles Browser Lane artifacts as resources", () => {
  const tauri = read("src-tauri/tauri.conf.json");
  assert.match(tauri, /"\.\.\/build\/browser-lane\/Browser Lane\.app"\s*:\s*"lane-apps\/Browser Lane\.app"/);
  assert.doesNotMatch(tauri, /terminal-lane|Terminal Lane\.app/);
});

test("build-app packages and signs the standalone Browser Lane app artifact before Tauri bundles resources", () => {
  const script = read("scripts/build-app.sh");
  assert.match(script, /node scripts\/package-browser-lane-app\.mjs/);
  assert.match(script, /build\/browser-lane\/Browser Lane\.app/);
  assert.match(script, /codesign --force --options runtime --timestamp --sign "\$IDENTITY"/);
  assert.doesNotMatch(script, /terminal-lane|Terminal Lane\.app/);
});

test("lane app artifact lookup does not rely on import.meta in the bundled daemon", () => {
  const src = read("src/lib/lane-apps/index.ts");
  assert.doesNotMatch(src, /import\.meta/);
  assert.match(src, /Contents\/Resources\/lane-apps/);
  assert.match(src, /process\.execPath/);
});
