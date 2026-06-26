#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const resources = join(root, "terminal-lane-app", "Resources");
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
}

rmSync(renderDir, { recursive: true, force: true });
mkdirSync(renderDir, { recursive: true });

const svgName = "terminal-lane-icon.svg";
const baseName = "TerminalLane";
const svg = join(resources, svgName);
const iconset = join(resources, `${baseName}.iconset`);
const icns = join(resources, `${baseName}.icns`);
if (!existsSync(svg)) throw new Error(`missing ${svg}`);
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

run("qlmanage", ["-t", "-s", "1024", "-o", renderDir, svg]);
const rendered = join(renderDir, `${svgName}.png`);
const transparent = join(renderDir, `${baseName}-transparent.png`);
run("assets/icon/.venv/bin/python", ["-c", `
from PIL import Image
import sys
im = Image.open(sys.argv[1]).convert("RGBA")
pix = im.load()
w, h = im.size
corner = 230
for y in range(h):
    for x in range(w):
        r, g, b, a = pix[x, y]
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

for (const [size, name] of [
  [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
]) {
  run("sips", ["-z", String(size), String(size), transparent, "--out", join(iconset, name)]);
}
run("iconutil", ["-c", "icns", iconset, "-o", icns]);
copyFileSync(transparent, join(resources, `${baseName}.png`));
rmSync(iconset, { recursive: true, force: true });
rmSync(renderDir, { recursive: true, force: true });
console.log(`Generated ${icns}`);
