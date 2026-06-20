import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const python = join(root, "assets/icon/.venv/bin/python");

function inspectPng(path) {
  const script = `
import json, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
w, h = im.size
pix = im.load()
alpha = []
for y in range(h):
  for x in range(w):
    if pix[x, y][3] > 0:
      alpha.append((x, y))
if alpha:
  xs = [p[0] for p in alpha]
  ys = [p[1] for p in alpha]
  bbox = [min(xs), min(ys), max(xs) + 1, max(ys) + 1]
else:
  bbox = None
print(json.dumps({
  "size": [w, h],
  "corner": pix[0, 0],
  "topCenter": pix[w // 2, max(1, h // 16)],
  "center": pix[w // 2, h // 2],
  "bbox": bbox
}))
`;
  return JSON.parse(execFileSync(python, ["-c", script, path], { encoding: "utf8" }));
}

test("desktop app icon is full-bleed with transparent rounded corners", () => {
  const icon = inspectPng(join(root, "src-tauri/icons/icon.png"));
  assert.deepEqual(icon.size, [512, 512]);
  assert.equal(icon.corner[3], 0, "corner should be transparent, not a white matte");
  assert.deepEqual(icon.bbox, [0, 0, 512, 512], "non-transparent icon footprint should fill the image");
});

test("white alternate runtime icon exists", () => {
  const path = join(root, "src-tauri/icons/app-icon-white.png");
  assert.equal(existsSync(path), true, "white alternate icon must be bundled");
  const icon = inspectPng(path);
  assert.deepEqual(icon.size, [512, 512]);
  assert.equal(icon.corner[3], 0, "corner should be transparent");
  assert.ok(icon.topCenter[0] > 245 && icon.topCenter[1] > 245 && icon.topCenter[2] > 245, "background should be white");
});
