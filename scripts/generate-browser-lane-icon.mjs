#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const resources = join(root, "browser-lane-app", "Resources");
const renderDir = join(resources, ".rendered-icon");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result;
}

rmSync(renderDir, { recursive: true, force: true });
mkdirSync(renderDir, { recursive: true });

function makeIcon({ svgName, baseName, whiteState }) {
  const svg = join(resources, svgName);
  const out = join(resources, `${baseName}.iconset`);
  const icns = join(resources, `${baseName}.icns`);
  if (!existsSync(svg)) throw new Error(`missing ${svg}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  run("qlmanage", ["-t", "-s", "1024", "-o", renderDir, svg]);
  const rendered = join(renderDir, `${svgName}.png`);
  if (!existsSync(rendered)) throw new Error(`qlmanage did not render ${svgName}`);
  const transparent = join(renderDir, `${baseName}-transparent.png`);

  run("assets/icon/.venv/bin/python", ["-c", `
from PIL import Image
import sys
im = Image.open(sys.argv[1]).convert("RGBA")
pix = im.load()
w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, a = pix[x, y]
        # QuickLook renders transparent SVG canvas as white. Restore transparency
        # only outside the squircle by testing distance to the nearest rounded
        # corner; keep the white icon's interior white.
        corner = 230
        outside = False
        if x < corner and y < corner:
            outside = (x - corner) ** 2 + (y - corner) ** 2 > corner ** 2
        elif x >= w - corner and y < corner:
            outside = (x - (w - corner - 1)) ** 2 + (y - corner) ** 2 > corner ** 2
        elif x < corner and y >= h - corner:
            outside = (x - corner) ** 2 + (y - (h - corner - 1)) ** 2 > corner ** 2
        elif x >= w - corner and y >= h - corner:
            outside = (x - (w - corner - 1)) ** 2 + (y - (h - corner - 1)) ** 2 > corner ** 2
        if outside and r > 248 and g > 248 and b > 248:
            pix[x, y] = (255, 255, 255, 0)
im.save(sys.argv[2])
`, rendered, transparent]);

  // Inset the full-bleed squircle into Apple's icon grid (~0.805 content ratio)
  // on a transparent canvas, so the dock renders Browser Lane the same size as
  // sibling app icons instead of ~23% larger. Matches src-tauri.
  const padded = join(renderDir, `${baseName}-padded.png`);
  run("assets/icon/.venv/bin/python", ["-c", `
from PIL import Image
import sys
src = Image.open(sys.argv[1]).convert("RGBA")
W = src.width
content = round(W * 0.8125)
margin = (W - content) // 2
scaled = src.resize((content, content), Image.LANCZOS)
canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))
canvas.paste(scaled, (margin, margin), scaled)
canvas.save(sys.argv[2])
`, transparent, padded]);

  const sizes = [
    [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
  ];

  for (const [size, name] of sizes) {
    run("sips", ["-z", String(size), String(size), padded, "--out", join(out, name)]);
  }
  run("iconutil", ["-c", "icns", out, "-o", icns]);
  copyFileSync(padded, join(resources, `${baseName}.png`));
  rmSync(out, { recursive: true, force: true });
  console.log(`Generated ${icns}${whiteState ? " (white state)" : ""}`);
}

makeIcon({ svgName: "browser-lane-icon.svg", baseName: "BrowserLane", whiteState: false });
makeIcon({ svgName: "browser-lane-icon-white.svg", baseName: "BrowserLaneWhite", whiteState: true });
rmSync(renderDir, { recursive: true, force: true });
