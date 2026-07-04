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
tileTop = pix[w // 2, bbox[1] + max(4, h // 40)] if bbox else None
print(json.dumps({
  "size": [w, h],
  "corner": pix[0, 0],
  "tileTop": tileTop,
  "center": pix[w // 2, h // 2],
  "bbox": bbox
}))
`;
  return JSON.parse(execFileSync(python, ["-c", script, path], { encoding: "utf8" }));
}

// The glyph must be INSET inside the tile (~Apple's 0.805 content ratio) with a
// transparent margin — not full-bleed — so macOS doesn't render it larger than
// neighboring app icons.
test("desktop app icon is inset (not full-bleed) with transparent corners", () => {
  const icon = inspectPng(join(root, "src-tauri/icons/icon.png"));
  assert.deepEqual(icon.size, [512, 512]);
  assert.equal(icon.corner[3], 0, "corner should be transparent, not a white matte");
  const [x0, y0, x1] = icon.bbox;
  const ratio = (x1 - x0) / icon.size[0];
  assert.ok(ratio > 0.74 && ratio < 0.86, `glyph should fill ~0.805 of the canvas (got ${ratio.toFixed(3)})`);
  assert.ok(x0 > 20 && y0 > 20, "glyph should sit inside a transparent margin");
});

test("white alternate runtime icon exists and is inset with a white tile", () => {
  const path = join(root, "src-tauri/icons/app-icon-white.png");
  assert.equal(existsSync(path), true, "white alternate icon must be bundled");
  const icon = inspectPng(path);
  assert.deepEqual(icon.size, [512, 512]);
  assert.equal(icon.corner[3], 0, "corner should be transparent (inset, not full-bleed)");
  assert.ok(
    icon.tileTop[3] > 245 && icon.tileTop[0] > 245 && icon.tileTop[1] > 245 && icon.tileTop[2] > 245,
    "tile interior should be opaque white",
  );
});
