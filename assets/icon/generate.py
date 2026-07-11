#!/usr/bin/env python3
"""Generate HiveMatrix icon asset sets from the SVG masters."""
import os, shutil, subprocess, sys

# cairosvg (used for the alpha-preserving iOS dark/tinted renders) resolves
# libcairo by bare name through dyld, which only honors DYLD_LIBRARY_PATH set at
# process launch. Re-exec once with Homebrew's lib dir on the path.
_LIBDIRS = [p for p in ("/opt/homebrew/lib", "/usr/local/lib") if os.path.isdir(p)]
if _LIBDIRS and os.environ.get("_HM_ICON_REEXEC") != "1":
    env = dict(os.environ, _HM_ICON_REEXEC="1")
    existing = env.get("DYLD_LIBRARY_PATH", "")
    env["DYLD_LIBRARY_PATH"] = ":".join(_LIBDIRS + ([existing] if existing else []))
    os.execve(sys.executable, [sys.executable, *sys.argv], env)

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

def render_svg_alpha(svg_name, size=1024):
    """Render an SVG preserving transparency (qlmanage flattens alpha onto white,
    which is wrong for the iOS dark/tinted appearances)."""
    import cairosvg
    png = os.path.join(OUT, f"_{svg_name}.png")
    cairosvg.svg2png(url=os.path.join(HERE, svg_name), write_to=png,
                     output_width=size, output_height=size)
    return Image.open(png).convert("RGBA")

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

# One identity: the green hive-flower on white, everywhere. The old white/black
# alternates (icon-macos-white.svg, AppIconWhite) were retired with the chooser.
ios_master = Image.open(render_svg("icon-ios-master.svg")).convert("RGBA")
mac_master = apply_squircle_alpha(Image.open(render_svg("icon-macos-master.svg")).convert("RGBA"))

# --- iOS: 1024, NO alpha (App Store requirement), full-bleed (iOS rounds it) ---
ios = resize(ios_master, 1024).convert("RGB")
ios.save(os.path.join(OUT, "AppIcon.png"))

# iOS 17+ dark + tinted appearances. Apple wants these designed on a TRANSPARENT
# background (system composites over its dark material / applies the tint), so
# unlike the primary icon they KEEP alpha.
render_svg_alpha("icon-ios-dark.svg").save(os.path.join(OUT, "AppIcon-Dark.png"))
render_svg_alpha("icon-ios-tinted.svg").save(os.path.join(OUT, "AppIcon-Tinted.png"))

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

for name in list(png_sizes.keys()) + ["icon.ico", "icon.icns", "app-icon-dark-green.png"]:
    shutil.copy2(os.path.join(OUT, name), os.path.join(TAURI_ICONS, name))
print("copied desktop icons ->", TAURI_ICONS)

# Push the iOS icon set into the sibling hivematrix-ios repo (if present) so
# iPhone/iPad carry the same green-on-white identity as the Mac, plus the dark +
# tinted appearances the system swaps to on the Home Screen.
IOS_APPICONSET = os.path.abspath(os.path.join(
    REPO, "..", "hivematrix-ios", "HiveMatrix", "Assets.xcassets", "AppIcon.appiconset"))
if os.path.isdir(IOS_APPICONSET):
    for name in ("AppIcon.png", "AppIcon-Dark.png", "AppIcon-Tinted.png"):
        shutil.copy2(os.path.join(OUT, name), os.path.join(IOS_APPICONSET, name))
    contents = {
        "images": [
            {"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
            {"filename": "AppIcon-Dark.png", "idiom": "universal", "platform": "ios", "size": "1024x1024",
             "appearances": [{"appearance": "luminosity", "value": "dark"}]},
            {"filename": "AppIcon-Tinted.png", "idiom": "universal", "platform": "ios", "size": "1024x1024",
             "appearances": [{"appearance": "luminosity", "value": "tinted"}]},
        ],
        "info": {"author": "xcode", "version": 1},
    }
    import json
    with open(os.path.join(IOS_APPICONSET, "Contents.json"), "w") as fh:
        json.dump(contents, fh, indent=2)
        fh.write("\n")
    print("copied iOS icon set (light/dark/tinted) ->", IOS_APPICONSET)
else:
    print("iOS repo not found; skipped iOS icon copy")

# Push the same green-on-white identity into the embedded watch app, which now
# lives in the sibling hivematrix-ios repo (HiveMatrixWatch target). watchOS needs
# the FULL app-icon set (idiom "watch" + "watch-marketing") — a single-size
# "universal" icon does NOT compile via actool for watchOS and fails App Store
# validation ("Missing Icons"). All renditions derive from the 1024 no-alpha
# master (no alpha, per App Store requirement).
WATCH_APPICONSET = os.path.abspath(os.path.join(
    REPO, "..", "hivematrix-ios", "HiveMatrixWatch", "Resources",
    "Assets.xcassets", "AppIcon.appiconset"))
if os.path.isdir(WATCH_APPICONSET):
    # (px, idiom, size, scale, role, subtype)
    watch_icons = [
        (48,  "watch", "24x24",     "2x", "notificationCenter", "38mm"),
        (55,  "watch", "27.5x27.5", "2x", "notificationCenter", "42mm"),
        (66,  "watch", "33x33",     "2x", "notificationCenter", "45mm"),
        (58,  "watch", "29x29",     "2x", "companionSettings",  None),
        (87,  "watch", "29x29",     "3x", "companionSettings",  None),
        (80,  "watch", "40x40",     "2x", "appLauncher",        "38mm"),
        (88,  "watch", "44x44",     "2x", "appLauncher",        "40mm"),
        (92,  "watch", "46x46",     "2x", "appLauncher",        "41mm"),
        (100, "watch", "50x50",     "2x", "appLauncher",        "44mm"),
        (102, "watch", "51x51",     "2x", "appLauncher",        "45mm"),
        (108, "watch", "54x54",     "2x", "appLauncher",        "49mm"),
        (172, "watch", "86x86",     "2x", "quickLook",          "38mm"),
        (196, "watch", "98x98",     "2x", "quickLook",          "42mm"),
        (216, "watch", "108x108",   "2x", "quickLook",          "44mm"),
        (234, "watch", "117x117",   "2x", "quickLook",          "45mm"),
        (258, "watch", "129x129",   "2x", "quickLook",          "49mm"),
        (1024, "watch-marketing", "1024x1024", "1x", None,      None),
    ]
    watch_src = Image.open(os.path.join(OUT, "AppIcon.png")).convert("RGB")
    _stale = os.path.join(WATCH_APPICONSET, "AppIcon.png")  # old single-size file
    if os.path.exists(_stale):
        os.remove(_stale)
    watch_images = []
    for px, idiom, size, scale, role, subtype in watch_icons:
        fn = f"icon_{px}.png"
        resize(watch_src, px).save(os.path.join(WATCH_APPICONSET, fn))
        entry = {"idiom": idiom, "size": size, "scale": scale, "filename": fn}
        if role:
            entry["role"] = role
        if subtype:
            entry["subtype"] = subtype
        watch_images.append(entry)
    import json
    with open(os.path.join(WATCH_APPICONSET, "Contents.json"), "w") as fh:
        json.dump({"images": watch_images, "info": {"author": "xcode", "version": 1}}, fh, indent=2)
        fh.write("\n")
    print("copied watchOS icon set (full) ->", WATCH_APPICONSET)
else:
    print("hivematrix-ios watch appiconset not found; skipped watch icon copy")
