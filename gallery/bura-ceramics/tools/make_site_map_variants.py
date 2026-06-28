#!/usr/bin/env python3
"""
make_site_map_variants.py — alternative Panel A maps that avoid CC-BY-SA.

Both variants are built ONLY from public-domain data (Natural Earth 1:10m
rivers + lakes, public domain) drawn over a procedural parchment background, so
NO attribution is legally required (a courtesy credit is still shown).

Outputs (../assets/):
  bura-site-map-public.png       clean public-domain reference map
  bura-site-map-commission.png   hand-drawn "commission" style with coastline
                                  casing + hydrology overlay, compass rose,
                                  ornamental border

Dependencies: Pillow only (Natural Earth GeoJSON fetched with stdlib urllib).
Run:  python gallery/bura-ceramics/tools/make_site_map_variants.py
"""

import io
import json
import math
import os
import random
import time
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

# ---- configuration (kept identical to make_site_map.py so markers align) ----

ZOOM = 10
TARGET_W = 1500
LON_MIN, LON_MAX = 0.40, 2.45
LAT_MIN, LAT_MAX = 13.25, 14.55

SITE = (1.0389, 13.8981, "Bura-Asinda-Sikka", "site")
POIS = [
    SITE,
    (2.1128, 13.5128, "Niamey", "city"),
    (0.7524, 14.0090, "Tera", "town"),
]

# poster ochre palette
INK = (59, 47, 32)
MID = (170, 122, 64)
CREAM = (239, 227, 194)
PAPER = (231, 216, 178)
ACCENT = (154, 60, 35)
WATER = (96, 116, 120)        # muted slate for the public version
WATER_DK = (54, 70, 74)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
ASSETS = os.path.normpath(os.path.join(HERE, "..", "assets"))

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
RIVERS = "ne_10m_rivers_lake_centerlines.geojson"
LAKES = "ne_10m_lakes.geojson"
# AWS Open Data Terrain Tiles — elevation primarily from SRTM (public domain).
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
USER_AGENT = "hopeOS-bura-mapgen/1.0 (gallery demo; non-commercial)"

# ---- projection ------------------------------------------------------------

def lonlat_to_pixel(lon, lat, z):
    n = 256 * (2 ** z)
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


_PX0 = lonlat_to_pixel(LON_MIN, LAT_MAX, ZOOM)
_PX1 = lonlat_to_pixel(LON_MAX, LAT_MIN, ZOOM)
OUT_H = int(round(TARGET_W * (_PX1[1] - _PX0[1]) / (_PX1[0] - _PX0[0])))


def to_xy(lon, lat):
    gx, gy = lonlat_to_pixel(lon, lat, ZOOM)
    x = (gx - _PX0[0]) / (_PX1[0] - _PX0[0]) * TARGET_W
    y = (gy - _PX0[1]) / (_PX1[1] - _PX0[1]) * OUT_H
    return x, y

# ---- public-domain hydrography (Natural Earth) -----------------------------

def _download(name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print(f"  downloading {name} ...")
        req = urllib.request.Request(NE_BASE + name, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def _rings(geom):
    t = geom.get("type")
    c = geom.get("coordinates", [])
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return c
    if t == "Polygon":
        return c
    if t == "MultiPolygon":
        return [ring for poly in c for ring in poly]
    return []


def load_geo(name, expand=0.7):
    data = json.load(open(_download(name), encoding="utf-8"))
    bb = (LON_MIN - expand, LAT_MIN - expand, LON_MAX + expand, LAT_MAX + expand)
    out = []
    for feat in data.get("features", []):
        for ring in _rings(feat.get("geometry") or {}):
            if any(bb[0] <= p[0] <= bb[2] and bb[1] <= p[1] <= bb[3] for p in ring):
                out.append([(p[0], p[1]) for p in ring])
    return out

# ---- public-domain terrain (SRTM via AWS terrarium tiles) ------------------

ELEV_ZOOM = 11  # finer than the marker zoom so subtle valley relief shows

def _terr_tile(z, x, y):
    path = os.path.join(CACHE, "terrarium", str(z), str(x), f"{y}.png")
    if os.path.exists(path):
        return Image.open(path).convert("RGB")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(TERRARIUM.format(z=z, x=x, y=y), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    with open(path, "wb") as f:
        f.write(data)
    return Image.open(io.BytesIO(data)).convert("RGB")


def elevation_grid(z=ELEV_ZOOM):
    """Stitch terrarium tiles for the bbox and decode to a metres array."""
    px0, py0 = lonlat_to_pixel(LON_MIN, LAT_MAX, z)
    px1, py1 = lonlat_to_pixel(LON_MAX, LAT_MIN, z)
    tx0, ty0 = int(px0 // 256), int(py0 // 256)
    tx1, ty1 = int(px1 // 256), int(py1 // 256)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    i = 0
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            i += 1
            try:
                tile = _terr_tile(z, tx, ty)
            except Exception as e:  # noqa: BLE001
                print(f"  elev tile {i}/{total} failed ({e}); filling flat")
                tile = Image.new("RGB", (256, 256), (128, 0, 0))
            mosaic.paste(tile, ((tx - tx0) * 256, (ty - ty0) * 256))
            time.sleep(0.03)
    ox, oy = tx0 * 256, ty0 * 256
    mosaic = mosaic.crop((int(px0 - ox), int(py0 - oy), int(px1 - ox), int(py1 - oy)))
    a = np.asarray(mosaic).astype(np.float64)
    return a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0


def _hs(elev, cellsize, az, alt=45.0, zfactor=3.0):
    gy, gx = np.gradient(elev * zfactor, cellsize)
    slope = np.pi / 2.0 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    azr = np.radians(360.0 - az + 90.0)
    altr = np.radians(alt)
    sh = np.sin(altr) * np.sin(slope) + np.cos(altr) * np.cos(slope) * np.cos(azr - aspect)
    return np.clip(sh, 0.0, 1.0)


def terrain_base():
    """Ochre-toned, multidirectional SRTM hillshade sized to the poster."""
    elev = elevation_grid()
    cell = 156543.03 * math.cos(math.radians((LAT_MIN + LAT_MAX) / 2)) / (2 ** ELEV_ZOOM)
    # multidirectional relief reveals the dendritic drainage / terraces
    acc = np.mean([_hs(elev, cell, az, 45, 3.0) for az in (315, 45, 135, 225, 270, 0)], axis=0)
    shade = Image.fromarray((acc * 255.0).astype(np.uint8), "L")
    shade = ImageOps.autocontrast(shade, cutoff=2)
    # lighter ochre endpoints to match the original topo tone
    toned = ImageOps.colorize(shade, black=(102, 83, 53), mid=(178, 142, 88), white=(243, 232, 201))
    toned = Image.blend(toned, Image.new("RGB", toned.size, CREAM), 0.12)
    return toned.resize((TARGET_W, OUT_H), Image.LANCZOS)

# ---- parchment background --------------------------------------------------

def parchment(w, h, base=PAPER):
    img = Image.new("RGB", (w, h), base)
    # faint paper grain
    rnd = random.Random(1349)
    px = img.load()
    for _ in range(int(w * h * 0.04)):
        x, y = rnd.randrange(w), rnd.randrange(h)
        d = rnd.randint(-10, 8)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + d)), max(0, min(255, g + d)), max(0, min(255, b + d)))
    # soft vignette
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse((-w * 0.25, -h * 0.25, w * 1.25, h * 1.25), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(120)).point(lambda v: int(v * 0.8) + 40)
    dark = Image.new("RGB", (w, h), (196, 178, 138))
    return Image.composite(img, dark, mask)

# ---- shared annotation -----------------------------------------------------

def font(size, bold=False, italic=False):
    name = "georgiab.ttf" if bold else "georgiai.ttf" if italic else "georgia.ttf"
    try:
        return ImageFont.truetype(name, size)
    except Exception:  # noqa: BLE001
        return ImageFont.load_default()


def chip(d, x, y, s, f, anchor="lm", fill=CREAM):
    pad = 6
    b = d.textbbox((0, 0), s, font=f)
    tw, th = b[2] - b[0], b[3] - b[1]
    if anchor == "rm":
        bx = x - tw - 2 * pad
    elif anchor == "mm":
        bx = x - tw / 2 - pad
    else:
        bx = x
    by = y - th / 2 - pad
    d.rectangle((bx, by, bx + tw + 2 * pad, by + th + 2 * pad), fill=fill, outline=INK, width=1)
    d.text((bx + pad, by + pad - b[1]), s, font=f, fill=INK)


def graticule(d, w, h):
    grat = (59, 47, 32, 55)
    fg = font(20)
    lon = math.ceil(LON_MIN)
    while lon < LON_MAX:
        gx, _ = to_xy(lon, LAT_MAX)
        d.line((gx, 0, gx, h), fill=grat, width=1)
        d.text((gx + 4, h - 26), f"{lon} deg E", font=fg, fill=(59, 47, 32, 150))
        lon += 1
    lat = math.ceil(LAT_MIN)
    while lat < LAT_MAX:
        _, gy = to_xy(LON_MIN, lat)
        d.line((0, gy, w, gy), fill=grat, width=1)
        d.text((6, gy + 4), f"{lat} deg N", font=fg, fill=(59, 47, 32, 150))
        lat += 1


def markers(d):
    f_city = font(24)
    f_site = font(28, bold=True)
    for lon, lat, name, kind in POIS:
        x, y = to_xy(lon, lat)
        if kind == "site":
            d.ellipse((x - 22, y - 22, x + 22, y + 22), outline=ACCENT, width=4)
            d.line((x - 30, y, x + 30, y), fill=ACCENT, width=3)
            d.line((x, y - 30, x, y + 30), fill=ACCENT, width=3)
            d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=ACCENT)
            chip(d, x + 36, y - 18, name, f_site, "lm")
            chip(d, x + 36, y + 18, "13 deg 53'53\"N  1 deg 02'20\"E", font(18), "lm")
        else:
            d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=INK, outline=CREAM, width=2)
            anchor = "rm" if lon > SITE[0] else "lm"
            dx = -14 if anchor == "rm" else 14
            chip(d, x + dx, y, name, f_city, anchor)


def scale_bar(d, w, h):
    m_per_px = (LON_MAX - LON_MIN) * 111320 * math.cos(math.radians((LAT_MIN + LAT_MAX) / 2)) / w
    bar_px = 50 * 1000 / m_per_px
    sx, sy = 40, h - 60
    d.rectangle((sx, sy, sx + bar_px, sy + 12), fill=CREAM, outline=INK, width=2)
    d.rectangle((sx, sy, sx + bar_px / 2, sy + 12), fill=INK)
    chip(d, sx, sy - 22, "50 km", font(20, bold=True), "lm")

# ---- hydrology drawing -----------------------------------------------------

def draw_rivers_public(d, rivers, lakes):
    for poly in lakes:
        pts = [to_xy(lon, lat) for lon, lat in poly]
        if len(pts) >= 3:
            d.polygon(pts, fill=WATER, outline=WATER_DK)
    for line in rivers:
        pts = [to_xy(lon, lat) for lon, lat in line]
        if len(pts) >= 2:
            d.line(pts, fill=WATER_DK, width=4, joint="curve")


def draw_rivers_commission(d, rivers, lakes):
    # "coastline" casing: a pale broad bank under a fine dark centreline
    for line in rivers:
        pts = [to_xy(lon, lat) for lon, lat in line]
        if len(pts) < 2:
            continue
        d.line(pts, fill=(214, 198, 158), width=11, joint="curve")   # bank casing
        d.line(pts, fill=(120, 96, 58), width=6, joint="curve")      # water body
        d.line(pts, fill=(70, 54, 30), width=2, joint="curve")       # centreline
    for poly in lakes:
        pts = [to_xy(lon, lat) for lon, lat in poly]
        if len(pts) >= 3:
            d.polygon(pts, fill=(150, 130, 92), outline=(70, 54, 30))
            d.line(pts + [pts[0]], fill=(70, 54, 30), width=2)


def compass_rose(d, cx, cy, r):
    for ang, ln in ((0, r), (90, r), (180, r), (270, r), (45, r * 0.6),
                    (135, r * 0.6), (225, r * 0.6), (315, r * 0.6)):
        a = math.radians(ang)
        d.line((cx, cy, cx + ln * math.sin(a), cy - ln * math.cos(a)), fill=INK, width=2)
    d.polygon((cx, cy - r, cx - r * 0.16, cy - r * 0.4, cx + r * 0.16, cy - r * 0.4), fill=ACCENT)
    d.polygon((cx, cy - r, cx - r * 0.16, cy - r * 0.4, cx, cy - r * 0.55), fill=INK)
    d.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), fill=INK)
    chip(d, cx, cy - r - 20, "N", font(22, bold=True), "mm")


def ornament_border(d, w, h):
    for inset, wd in ((10, 4), (22, 2)):
        d.rectangle((inset, inset, w - inset - 1, h - inset - 1), outline=INK, width=wd)
    for cx, cy in ((22, 22), (w - 22, 22), (22, h - 22), (w - 22, h - 22)):
        d.line((cx - 14, cy, cx + 14, cy), fill=INK, width=2)
        d.line((cx, cy - 14, cx, cy + 14), fill=INK, width=2)

# ---- variant builders ------------------------------------------------------

def make_public(rivers, lakes):
    img = terrain_base()
    d = ImageDraw.Draw(img, "RGBA")
    graticule(d, TARGET_W, OUT_H)
    draw_rivers_public(d, rivers, lakes)
    markers(d)
    scale_bar(d, TARGET_W, OUT_H)
    # north arrow
    nx, ny = TARGET_W - 64, 70
    d.polygon((nx, ny - 34, nx - 13, ny + 14, nx, ny + 4, nx + 13, ny + 14), fill=INK)
    chip(d, nx, ny + 40, "N", font(22, bold=True), "mm")
    chip(d, 40, 50, "The Middle Niger Valley", font(34, bold=True), "lm")
    chip(d, 40, 92, "Setting of the Bura necropolis - c. 3rd-13th c. CE", font(20, italic=True), "lm")
    attr = "Terrain: SRTM elevation + Natural Earth (public domain). No attribution required."
    fa = font(16)
    b = d.textbbox((0, 0), attr, font=fa)
    tw = b[2] - b[0]
    d.rectangle((TARGET_W - tw - 16, OUT_H - 30, TARGET_W - 4, OUT_H - 4), fill=(239, 227, 194, 215))
    d.text((TARGET_W - tw - 10, OUT_H - 27), attr, font=fa, fill=INK)
    out = os.path.join(ASSETS, "bura-site-map-public.png")
    img.save(out, "PNG")
    print(f"Saved {out}  ({img.width}x{img.height})")


def make_commission(rivers, lakes):
    img = parchment(TARGET_W, OUT_H, base=(226, 210, 170))
    d = ImageDraw.Draw(img, "RGBA")
    graticule(d, TARGET_W, OUT_H)
    draw_rivers_commission(d, rivers, lakes)
    markers(d)
    scale_bar(d, TARGET_W, OUT_H)
    compass_rose(d, TARGET_W - 80, 96, 40)
    # title cartouche
    f_t = font(36, italic=True)
    b = d.textbbox((0, 0), "A Bend in the Niger", font=f_t)
    tw = b[2] - b[0]
    d.rectangle((34, 34, 34 + tw + 28, 96), fill=CREAM, outline=INK, width=2)
    d.rectangle((40, 40, 34 + tw + 22, 90), outline=INK, width=1)
    d.text((48, 44), "A Bend in the Niger", font=f_t, fill=INK)
    chip(d, 40, 118, "Hydrology & terraces of the middle Niger - commission study", font(18, italic=True), "lm")
    attr = "Natural Earth (public domain) - original drawing, no attribution required."
    fa = font(16)
    b = d.textbbox((0, 0), attr, font=fa)
    tw = b[2] - b[0]
    d.rectangle((TARGET_W - tw - 38, OUT_H - 50, TARGET_W - 28, OUT_H - 28), fill=(239, 227, 194, 215))
    d.text((TARGET_W - tw - 34, OUT_H - 47), attr, font=fa, fill=INK)
    ornament_border(d, TARGET_W, OUT_H)
    out = os.path.join(ASSETS, "bura-site-map-commission.png")
    img.save(out, "PNG")
    print(f"Saved {out}  ({img.width}x{img.height})")

# ---- main ------------------------------------------------------------------

def main():
    print("Loading public-domain hydrography (Natural Earth)...")
    rivers = load_geo(RIVERS)
    lakes = load_geo(LAKES)
    print(f"  {len(rivers)} river segments, {len(lakes)} lake rings in view")
    make_public(rivers, lakes)
    make_commission(rivers, lakes)


if __name__ == "__main__":
    main()
