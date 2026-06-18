#!/usr/bin/env python3
"""Generate HiveMatrix icon asset sets from the rendered 1024 masters."""
import os, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

ios_master = Image.open(os.path.join(HERE, "icon-ios-master.svg.png")).convert("RGBA")
mac_master = Image.open(os.path.join(HERE, "icon-macos-master.svg.png")).convert("RGBA")

def resize(img, size):
    return img.resize((size, size), Image.LANCZOS)

# --- iOS: 1024, NO alpha (App Store requirement) ---
ios = resize(ios_master, 1024).convert("RGB")
ios.save(os.path.join(OUT, "AppIcon.png"))

# --- Desktop PNGs (from rounded mac master, keep alpha) ---
png_sizes = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}
for name, size in png_sizes.items():
    resize(mac_master, size).save(os.path.join(OUT, name))

# --- Windows .ico (multi-size) ---
resize(mac_master, 256).save(
    os.path.join(OUT, "icon.ico"),
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

# --- macOS .icns via iconutil (canonical) ---
iconset = os.path.join(OUT, "icon.iconset")
os.makedirs(iconset, exist_ok=True)
icns_map = [
    (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
]
for size, name in icns_map:
    resize(mac_master, size).save(os.path.join(iconset, name))
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(OUT, "icon.icns")], check=True)

print("done ->", OUT)
for f in sorted(os.listdir(OUT)):
    if not f.endswith(".iconset"):
        print("  ", f)
