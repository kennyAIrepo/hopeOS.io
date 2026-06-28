#!/usr/bin/env python3
"""
make_site_map.py — generate the Panel A "A Bend in the Niger" site map.

Builds a sepia/ochre topographic map of the middle Niger River valley centred on
the Bura-Asinda-Sikka necropolis, with the GPS location pinned and Niamey / Tera
shown for orientation. The basemap is OpenTopoMap (OpenStreetMap + SRTM elevation,
CC-BY-SA) — terrain and hydrology are the enduring features, so modern labels are
de-emphasised and the whole thing is toned to evoke the c.3rd-13th c. CE setting.

Output: ../assets/bura-site-map.png  (landscape, ~1500 px wide)

Dependencies: Pillow only (tiles fetched with the stdlib urllib).
Run:  python gallery/bura-ceramics/tools/make_site_map.py
"""

import io
import math
import os
import time
import urllib.request

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

# ---- configuration ---------------------------------------------------------

ZOOM = 10                      # 10 ~= 150 m/px here -> sharp at poster size
TARGET_W = 1500                # output width in px

# Region bounding box (degrees). Frames the site with Niamey (SE) and Tera (NW).
LON_MIN, LON_MAX = 0.40, 2.45  # ~ 220 km wide
LAT_MIN, LAT_MAX = 13.25, 14.55  # ~ 145 km tall

# Points of interest: (lon, lat, label, kind)
SITE = (1.0389, 13.8981, "Bura-Asinda-Sikka", "site")          # 13 deg 53'53"N 1 deg 02'20"E
POIS = [
    SITE,
    (2.1128, 13.5128, "Niamey", "city"),
    (0.7524, 14.0090, "Tera", "town"),
]

TILE_SOURCES = [
    ("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", ["a", "b", "c"]),
    ("https://tile.openstreetmap.org/{z}/{x}/{y}.png", [""]),  # fallback
]
USER_AGENT = "hopeOS-bura-mapgen/1.0 (gallery demo; non-commercial)"

# Palette (matches the poster's ochre scheme)
INK = (59, 47, 32)            # #3b2f20 shadows
MID = (170, 122, 64)          # #aa7a40 mid
CREAM = (239, 227, 194)       # #efe3c2 highlights
ACCENT = (154, 60, 35)        # #9a3c23 site marker
LABEL_BG = (239, 227, 194)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "bura-site-map.png"))

# ---- web-mercator helpers --------------------------------------------------

def lonlat_to_pixel(lon, lat, z):
    """Global pixel coords (256-px tiles) for a lon/lat at zoom z."""
    n = 256 * (2 ** z)
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y

# ---- tile fetching ---------------------------------------------------------

def fetch_tile(z, x, y):
    last_err = None
    for tmpl, subs in TILE_SOURCES:
        for s in subs:
            url = tmpl.replace("{s}", s).replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=20) as r:
                    return Image.open(io.BytesIO(r.read())).convert("RGB")
            except Exception as e:  # noqa: BLE001 - try the next mirror/source
                last_err = e
                time.sleep(0.3)
    raise RuntimeError(f"tile {z}/{x}/{y} failed: {last_err}")


def build_mosaic():
    px0, py0 = lonlat_to_pixel(LON_MIN, LAT_MAX, ZOOM)   # top-left
    px1, py1 = lonlat_to_pixel(LON_MAX, LAT_MIN, ZOOM)   # bottom-right
    tx0, ty0 = int(px0 // 256), int(py0 // 256)
    tx1, ty1 = int(px1 // 256), int(py1 // 256)

    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    i = 0
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            i += 1
            print(f"  tile {i}/{total}  {ZOOM}/{tx}/{ty}")
            tile = fetch_tile(ZOOM, tx, ty)
            mosaic.paste(tile, ((tx - tx0) * 256, (ty - ty0) * 256))
            time.sleep(0.12)  # be polite to the tile server

    # crop to the exact bbox within the mosaic
    ox, oy = tx0 * 256, ty0 * 256
    crop = (int(px0 - ox), int(py0 - oy), int(px1 - ox), int(py1 - oy))
    img = mosaic.crop(crop)

    # mapping from lon/lat -> pixel in the cropped image
    def to_xy(lon, lat, w, h):
        cw, ch = crop[2] - crop[0], crop[3] - crop[1]
        gx, gy = lonlat_to_pixel(lon, lat, ZOOM)
        return (gx - px0) / cw * w, (gy - py0) / ch * h

    return img, to_xy

# ---- styling ---------------------------------------------------------------

def duotone(img):
    g = ImageOps.grayscale(img)
    g = ImageOps.autocontrast(g, cutoff=1)
    toned = ImageOps.colorize(g, black=INK, white=CREAM, mid=MID)
    # keep a hint of the real terrain colour
    out = Image.blend(toned, img, 0.18)
    return ImageEnhance.Contrast(out).enhance(1.04)


def vignette(img):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((-w * 0.22, -h * 0.22, w * 1.22, h * 1.22), fill=255)
    mask = mask.point(lambda v: int(v * 0.85) + 38)
    dark = Image.new("RGB", (w, h), (40, 30, 18))
    return Image.composite(img, dark, mask)

# ---- annotation ------------------------------------------------------------

def font(size, bold=False, italic=False):
    name = "georgia.ttf"
    if bold:
        name = "georgiab.ttf"
    elif italic:
        name = "georgiai.ttf"
    try:
        return ImageFont.truetype(name, size)
    except Exception:  # noqa: BLE001
        return ImageFont.load_default()


def text_w(d, s, f):
    b = d.textbbox((0, 0), s, font=f)
    return b[2] - b[0]


def label_chip(d, x, y, s, f, anchor="lm"):
    pad = 6
    b = d.textbbox((0, 0), s, font=f)
    tw, th = b[2] - b[0], b[3] - b[1]
    if anchor == "lm":
        bx, by = x, y - th / 2 - pad
    elif anchor == "rm":
        bx, by = x - tw - 2 * pad, y - th / 2 - pad
    else:  # mm
        bx, by = x - tw / 2 - pad, y - th / 2 - pad
    d.rectangle((bx, by, bx + tw + 2 * pad, by + th + 2 * pad), fill=LABEL_BG, outline=INK, width=1)
    d.text((bx + pad, by + pad - b[1]), s, font=f, fill=INK)


def annotate(img, to_xy):
    w, h = img.size
    d = ImageDraw.Draw(img, "RGBA")

    # graticule (faint) — whole degrees of lon/lat
    grat = (59, 47, 32, 60)
    fg = font(20)
    lon = math.ceil(LON_MIN)
    while lon < LON_MAX:
        gx, _ = to_xy(lon, LAT_MAX, w, h)
        d.line((gx, 0, gx, h), fill=grat, width=1)
        d.text((gx + 4, h - 26), f"{lon} deg E", font=fg, fill=(59, 47, 32, 160))
        lon += 1
    lat = math.ceil(LAT_MIN)
    while lat < LAT_MAX:
        _, gy = to_xy(LON_MIN, lat, w, h)
        d.line((0, gy, w, gy), fill=grat, width=1)
        d.text((6, gy + 4), f"{lat} deg N", font=fg, fill=(59, 47, 32, 160))
        lat += 1

    # points of interest
    f_city = font(24)
    f_site = font(28, bold=True)
    for lon, lat, name, kind in POIS:
        x, y = to_xy(lon, lat, w, h)
        if kind == "site":
            d.ellipse((x - 22, y - 22, x + 22, y + 22), outline=ACCENT, width=4)
            d.line((x - 30, y, x + 30, y), fill=ACCENT, width=3)
            d.line((x, y - 30, x, y + 30), fill=ACCENT, width=3)
            d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=ACCENT)
            label_chip(d, x + 36, y - 18, name, f_site, "lm")
            label_chip(d, x + 36, y + 18, "13 deg 53'53\"N  1 deg 02'20\"E", font(18), "lm")
        else:
            d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=INK, outline=CREAM, width=2)
            anchor = "rm" if lon > SITE[0] else "lm"
            dx = -14 if anchor == "rm" else 14
            label_chip(d, x + dx, y, name, f_city, anchor)

    # scale bar (bottom-left)
    m_per_px = (LON_MAX - LON_MIN) * 111320 * math.cos(math.radians((LAT_MIN + LAT_MAX) / 2)) / w
    bar_km = 50
    bar_px = bar_km * 1000 / m_per_px
    sx, sy = 40, h - 60
    d.rectangle((sx, sy, sx + bar_px, sy + 12), fill=CREAM, outline=INK, width=2)
    d.rectangle((sx, sy, sx + bar_px / 2, sy + 12), fill=INK)
    label_chip(d, sx, sy - 22, f"{bar_km} km", font(20, bold=True), "lm")

    # north arrow (top-right)
    nx, ny = w - 64, 70
    d.polygon((nx, ny - 34, nx - 13, ny + 14, nx, ny + 4, nx + 13, ny + 14), fill=INK)
    label_chip(d, nx, ny + 40, "N", font(22, bold=True), "mm")

    # title block (top-left)
    label_chip(d, 40, 50, "The Middle Niger Valley", font(34, bold=True), "lm")
    label_chip(d, 40, 92, "Setting of the Bura necropolis - c. 3rd-13th c. CE", font(20, italic=True), "lm")

    # attribution (bottom-right)
    attr = "Basemap (c) OpenTopoMap / OpenStreetMap, SRTM - CC-BY-SA. Toned for demonstration."
    fa = font(16)
    tw = text_w(d, attr, fa)
    d.rectangle((w - tw - 16, h - 30, w - 4, h - 4), fill=(239, 227, 194, 210))
    d.text((w - tw - 10, h - 27), attr, font=fa, fill=INK)

    # inner keyline
    d.rectangle((2, 2, w - 3, h - 3), outline=INK, width=3)
    return img

# ---- main ------------------------------------------------------------------

def main():
    print(f"Fetching tiles (zoom {ZOOM})...")
    img, to_xy = build_mosaic()
    h = int(round(TARGET_W * img.height / img.width))
    img = img.resize((TARGET_W, h), Image.LANCZOS)
    img = duotone(img)
    img = vignette(img)
    img = annotate(img, to_xy)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "PNG")
    print(f"Saved {OUT}  ({img.width}x{img.height})")


if __name__ == "__main__":
    main()
