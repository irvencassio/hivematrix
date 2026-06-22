#!/usr/bin/env python3
"""Generate HiveMatrix icon asset sets from the SVG masters."""
import os, shutil, subprocess
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TAURI_ICONS = os.path.join(REPO, "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)
os.makedirs(TAURI_ICONS, exist_ok=True)

def render_svg(svg_name):
    svg = os.path.join(HERE, svg_name)
    png = os.path.join(HERE, f"{svg_name}.png")
    if os.path.exists(png) and os.path.getmtime(png) >= os.path.getmtime(svg):
        return png
    tmp = os.path.join(OUT, "_render")
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    os.makedirs(tmp, exist_ok=True)
    subprocess.run(["qlmanage", "-t", "-s", "1024", "-o", tmp, svg], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    rendered = os.path.join(tmp, f"{svg_name}.png")
    if not os.path.exists(rendered):
        raise RuntimeError(f"qlmanage did not render {svg_name}")
    shutil.copy2(rendered, png)
    return png

def resize(img, size):
    return img.resize((size, size), Image.LANCZOS)

def apply_squircle_alpha(img, content_ratio=0.805, radius_ratio=0.2237):
    # Inset the squircle inside a TRANSPARENT canvas so the glyph fills ~80.5% of
    # the tile (Apple's content-area ratio) with margin on each side. Without this
    # the art bleeds edge-to-edge and macOS renders the icon visibly larger than
    # its neighbors (which all sit inset). iOS keeps the full-bleed master.
    w, h = img.width, img.height
    content = round(w * content_ratio)
    margin = (w - content) // 2
    art = img.convert("RGBA").resize((content, content), Image.LANCZOS)
    scale = 4
    mask = Image.new("L", (content * scale, content * scale), 0)
    draw = ImageDraw.Draw(mask)
    radius = round(content * radius_ratio) * scale
    draw.rounded_rectangle((0, 0, content * scale, content * scale), radius=radius, fill=255)
    mask = mask.resize((content, content), Image.LANCZOS)
    art.putalpha(mask)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(art, (margin, margin), art)
    return canvas

ios_master = Image.open(render_svg("icon-ios-master.svg")).convert("RGBA")
mac_master = apply_squircle_alpha(Image.open(render_svg("icon-macos-master.svg")).convert("RGBA"))
white_master = apply_squircle_alpha(Image.open(render_svg("icon-macos-white.svg")).convert("RGBA"))

# --- iOS: 1024, NO alpha (App Store requirement), full-bleed (iOS rounds it) ---
ios = resize(ios_master, 1024).convert("RGB")
ios.save(os.path.join(OUT, "AppIcon.png"))
# iOS white alternate icon — same white master as macOS, but full-bleed (no
# squircle inset) since iOS masks it itself. Keeps the iOS white icon in sync
# with icon-macos-white.svg (darker green) instead of a stale hand-placed file.
ios_white = resize(Image.open(render_svg("icon-macos-white.svg")).convert("RGBA"), 1024).convert("RGB")
ios_white.save(os.path.join(OUT, "AppIconWhite.png"))

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

resize(mac_master, 512).save(os.path.join(OUT, "app-icon-dark-green.png"))
resize(white_master, 512).save(os.path.join(OUT, "app-icon-white.png"))

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

for name in list(png_sizes.keys()) + ["icon.ico", "icon.icns", "app-icon-dark-green.png", "app-icon-white.png"]:
    shutil.copy2(os.path.join(OUT, name), os.path.join(TAURI_ICONS, name))
print("copied desktop icons ->", TAURI_ICONS)

# Push the iOS white alternate icon into the sibling hivematrix-ios repo (if present)
# so selecting "white" looks the same on iPhone/iPad as on the Mac.
IOS_WHITE_DST = os.path.abspath(os.path.join(
    REPO, "..", "hivematrix-ios", "HiveMatrix", "Assets.xcassets", "AppIconWhite.appiconset", "AppIconWhite.png"))
if os.path.isdir(os.path.dirname(IOS_WHITE_DST)):
    shutil.copy2(os.path.join(OUT, "AppIconWhite.png"), IOS_WHITE_DST)
    print("copied iOS white icon ->", IOS_WHITE_DST)
else:
    print("iOS repo not found; skipped iOS white icon copy")
