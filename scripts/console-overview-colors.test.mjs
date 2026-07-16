import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const console_ts = readFileSync(new URL("../src/daemon/console.ts", import.meta.url), "utf8");

test("overview uses --err color for failed lane number", () => {
  // The laneColor map or inline style must reference --err for failed
  assert.ok(
    console_ts.includes("failed") && console_ts.includes("var(--err)"),
    "console.ts must map failed lane to --err color"
  );
  // Specifically the laneColor mapping object
  assert.match(console_ts, /laneColor.*failed.*var\(--err\)/s);
});

test("overview uses --accent color for in_progress lane number", () => {
  assert.match(console_ts, /laneColor.*in_progress.*var\(--accent\)/s);
});

test("overview uses --ok color for review lane number", () => {
  assert.match(console_ts, /laneColor.*review.*var\(--ok\)/s);
});

test("wallpaper translucency uses --mat-wp-blur CSS variable", () => {
  assert.ok(
    console_ts.includes("blur(var(--mat-wp-blur)"),
    "backdrop-filter must use var(--mat-wp-blur) not hardcoded 6px"
  );
  assert.ok(
    !console_ts.includes("backdrop-filter: blur(6px)"),
    "hardcoded backdrop-filter: blur(6px) must be removed"
  );
});

test("wallpaper JS sets --mat-wp-blur alongside --wp-opacity", () => {
  assert.match(console_ts, /--mat-wp-blur.*6px|6px.*--mat-wp-blur/);
  // When opacity is 0, blur is set to 0px
  assert.match(console_ts, /--mat-wp-blur.*0px|0px.*--mat-wp-blur/);
});
