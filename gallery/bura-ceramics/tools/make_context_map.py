#!/usr/bin/env python3
"""
make_context_map.py — Panel A "context" variant: the Bura site in the wider
middle-Niger valley, with roads + water-feeder tributaries and the documented
distribution corridor of the ~834 related Bura-culture sites.

Layers
  - SRTM hillshade base (public domain), ochre-toned
  - OpenStreetMap waterways (Niger + feeder tributaries) and major roads
    (c) OpenStreetMap contributors, ODbL — attribution shown
  - Distribution corridor of the 834 related sites (UNESCO TL #5045): a
    250 x 150 km swath from the Malian border to the "W" river bend. Individual
    coordinates are unpublished (looting protection), so the 834 sites are shown
    SCHEMATICALLY, clustered along the valley axis — not as surveyed positions.

Sources (kept for linking):
  https://whc.unesco.org/en/tentativelists/5045          (extent, 450 km / 250x150)
  https://en.wikipedia.org/wiki/Bura_archaeological_site (834 sites figure)
  https://grokipedia.com/page/bura_archaeological_site   (zone dimensions)

Dependencies: Pillow, numpy (urllib for tiles + Overpass).
Run:  python gallery/bura-ceramics/tools/make_context_map.py
"""

import io
import json
import math
import os
import random
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

# ---- extent (wide, to show the whole valley corridor) ----------------------

TARGET_W = 1600
ELEV_ZOOM = 10
LON_MIN, LON_MAX = 0.10, 2.70

# The image is sized to the Panel A hero slot (loader.js innerW:imgH = 896:680)
# so drawCover() shows it 1:1 with no cropping and the legend/title/scale all fit.
HERO_ASPECT = 896.0 / 680.0
_CENTER_LAT = 13.715

def _merc_yn(lat):
    s = math.sin(math.radians(lat))
    return 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)   # normalized [0,1]

def _merc_yn_inv(yn):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yn))))

# longitude defines the width; derive the latitude band that yields HERO_ASPECT
_w_norm = (LON_MAX - LON_MIN) / 360.0
_h_norm = _w_norm / HERO_ASPECT
_cy_norm = _merc_yn(_CENTER_LAT)
LAT_MAX = _merc_yn_inv(_cy_norm - _h_norm / 2)
LAT_MIN = _merc_yn_inv(_cy_norm + _h_norm / 2)

# corridor axis: NW (Niger enters from Mali) -> SE ("W" river bend)
CORRIDOR_NW = (0.95, 14.85)
CORRIDOR_SE = (2.45, 12.55)
CORRIDOR_HALF_KM = 75.0   # ~150 km wide

SITE = (1.0389, 13.8981, "Bura-Asinda-Sikka", "site")
POIS = [
    SITE,
    (2.1128, 13.5128, "Niamey", "city"),
    (0.7524, 14.0090, "Tera", "town"),
    (0.99, 14.93, "Mali border", "edge"),
    (2.40, 12.45, "the 'W' bend", "edge"),
]

INK = (59, 47, 32)
MID = (170, 122, 64)
CREAM = (239, 227, 194)
ACCENT = (154, 60, 35)
WATER_DK = (54, 70, 74)
WATER = (92, 112, 116)
ROAD = (138, 96, 54)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
ASSETS = os.path.normpath(os.path.join(HERE, "..", "assets"))
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
USER_AGENT = "hopeOS-bura-mapgen/1.0 (gallery demo; non-commercial)"

# ---- projection ------------------------------------------------------------

def lonlat_to_pixel(lon, lat, z):
    n = 256 * (2 ** z)
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


_P0 = lonlat_to_pixel(LON_MIN, LAT_MAX, ELEV_ZOOM)
_P1 = lonlat_to_pixel(LON_MAX, LAT_MIN, ELEV_ZOOM)
OUT_H = int(round(TARGET_W * (_P1[1] - _P0[1]) / (_P1[0] - _P0[0])))


def to_xy(lon, lat):
    gx, gy = lonlat_to_pixel(lon, lat, ELEV_ZOOM)
    return ((gx - _P0[0]) / (_P1[0] - _P0[0]) * TARGET_W,
            (gy - _P0[1]) / (_P1[1] - _P0[1]) * OUT_H)

# ---- SRTM hillshade base ---------------------------------------------------

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
    p0 = lonlat_to_pixel(LON_MIN, LAT_MAX, z)
    p1 = lonlat_to_pixel(LON_MAX, LAT_MIN, z)
    tx0, ty0 = int(p0[0] // 256), int(p0[1] // 256)
    tx1, ty1 = int(p1[0] // 256), int(p1[1] // 256)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    i = 0
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            i += 1
            try:
                tile = _terr_tile(z, tx, ty)
            except Exception as e:  # noqa: BLE001
                print(f"  elev tile {i}/{total} failed ({e})")
                tile = Image.new("RGB", (256, 256), (128, 0, 0))
            mosaic.paste(tile, ((tx - tx0) * 256, (ty - ty0) * 256))
            time.sleep(0.02)
    ox, oy = tx0 * 256, ty0 * 256
    mosaic = mosaic.crop((int(p0[0] - ox), int(p0[1] - oy), int(p1[0] - ox), int(p1[1] - oy)))
    a = np.asarray(mosaic).astype(np.float64)
    return a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0


def _hs(elev, cell, az, alt=45.0, zf=3.0):
    gy, gx = np.gradient(elev * zf, cell)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    azr, altr = np.radians(360 - az + 90), np.radians(alt)
    sh = np.sin(altr) * np.sin(slope) + np.cos(altr) * np.cos(slope) * np.cos(azr - aspect)
    return np.clip(sh, 0, 1)


def terrain_base():
    elev = elevation_grid()
    cell = 156543.03 * math.cos(math.radians((LAT_MIN + LAT_MAX) / 2)) / (2 ** ELEV_ZOOM)
    acc = np.mean([_hs(elev, cell, az) for az in (315, 45, 135, 225, 270, 0)], axis=0)
    shade = ImageOps.autocontrast(Image.fromarray((acc * 255).astype(np.uint8), "L"), cutoff=2)
    toned = ImageOps.colorize(shade, black=(102, 83, 53), mid=(178, 142, 88), white=(243, 232, 201))
    toned = Image.blend(toned, Image.new("RGB", toned.size, CREAM), 0.12)
    return toned.resize((TARGET_W, OUT_H), Image.LANCZOS)

# ---- OpenStreetMap roads + waterways (Overpass) ----------------------------

def fetch_osm():
    cache = os.path.join(CACHE, "overpass_context.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    q = (
        "[out:json][timeout:180];("
        f'way["waterway"~"river|stream|canal"]({LAT_MIN},{LON_MIN},{LAT_MAX},{LON_MAX});'
        f'way["highway"~"motorway|trunk|primary|secondary"]({LAT_MIN},{LON_MIN},{LAT_MAX},{LON_MAX});'
        ");out geom;"
    )
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for ep in OVERPASS_ENDPOINTS:
        for attempt in range(2):
            try:
                print(f"  querying Overpass: {ep} (try {attempt + 1})")
                req = urllib.request.Request(ep, data=data, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=180) as r:
                    out = json.loads(r.read())
                json.dump(out, open(cache, "w", encoding="utf-8"))
                return out
            except Exception as e:  # noqa: BLE001
                last = e
                print(f"    failed: {e}")
                time.sleep(3)
    raise RuntimeError(f"all Overpass mirrors failed: {last}")


def draw_osm(d, osm):
    rivers = streams = roads = 0
    for el in osm.get("elements", []):
        geom = el.get("geometry")
        if not geom:
            continue
        pts = [to_xy(p["lon"], p["lat"]) for p in geom]
        if len(pts) < 2:
            continue
        tags = el.get("tags", {})
        wt = tags.get("waterway")
        if wt:
            if wt == "river":
                d.line(pts, fill=WATER_DK, width=5, joint="curve")
                rivers += 1
            else:
                d.line(pts, fill=WATER, width=2, joint="curve")
                streams += 1
        elif tags.get("highway"):
            d.line(pts, fill=ROAD, width=2, joint="curve")
            roads += 1
    return rivers, streams, roads

# ---- distribution corridor of the 834 sites --------------------------------

def corridor_polygon():
    ax = np.array(CORRIDOR_NW)
    bx = np.array(CORRIDOR_SE)
    v = bx - ax
    # perpendicular unit, scaled to half-width in degrees (approx, lat/lon)
    midlat = (LAT_MIN + LAT_MAX) / 2
    perp = np.array([-v[1], v[0]])
    perp = perp / np.hypot(*perp)
    dlat = CORRIDOR_HALF_KM / 111.0
    dlon = CORRIDOR_HALF_KM / (111.0 * math.cos(math.radians(midlat)))
    off = np.array([perp[0] * dlon, perp[1] * dlat])
    return [ax + off, bx + off, bx - off, ax - off], ax, bx, perp, dlon, dlat


def draw_corridor(img):
    poly, ax, bx, perp, dlon, dlat = corridor_polygon()
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    pts = [to_xy(p[0], p[1]) for p in poly]
    od.polygon(pts, fill=(154, 60, 35, 50), outline=(120, 30, 16, 200))
    od.line(pts + [pts[0]], fill=(120, 30, 16, 180), width=3)
    # axis line
    od.line([to_xy(*ax), to_xy(*bx)], fill=(120, 30, 16, 170), width=2)
    # ~834 sites, clustered along the valley axis (schematic, not surveyed)
    rnd = random.Random(834)
    for _ in range(834):
        t = rnd.random()
        along = ax + (bx - ax) * t
        dperp = rnd.gauss(0, 0.42)           # cluster near the river
        dperp = max(-1.0, min(1.0, dperp))
        lon = along[0] + perp[0] * dperp * dlon
        lat = along[1] + perp[1] * dperp * dlat
        x, y = to_xy(lon, lat)
        od.ellipse((x - 2.6, y - 2.6, x + 2.6, y + 2.6), fill=(245, 230, 198, 150))
        od.ellipse((x - 2.0, y - 2.0, x + 2.0, y + 2.0), fill=(150, 22, 10, 210))
    img.paste(overlay, (0, 0), overlay)

# ---- annotation ------------------------------------------------------------

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
    bx = x - tw - 2 * pad if anchor == "rm" else x - tw / 2 - pad if anchor == "mm" else x
    by = y - th / 2 - pad
    d.rectangle((bx, by, bx + tw + 2 * pad, by + th + 2 * pad), fill=fill, outline=INK, width=1)
    d.text((bx + pad, by + pad - b[1]), s, font=f, fill=INK)


def markers(d):
    f_city = font(24)
    f_site = font(28, bold=True)
    f_edge = font(20, italic=True)
    for lon, lat, name, kind in POIS:
        x, y = to_xy(lon, lat)
        if not (0 <= y <= OUT_H and 0 <= x <= TARGET_W):
            continue  # outside the cropped frame
        if kind == "site":
            d.ellipse((x - 20, y - 20, x + 20, y + 20), outline=ACCENT, width=4)
            d.line((x - 28, y, x + 28, y), fill=ACCENT, width=3)
            d.line((x, y - 28, x, y + 28), fill=ACCENT, width=3)
            d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=ACCENT)
            chip(d, x + 32, y - 16, name, f_site, "lm")
            chip(d, x + 32, y + 16, "13 deg 53'53\"N  1 deg 02'20\"E", font(16), "lm")
        elif kind == "edge":
            d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=ACCENT, outline=CREAM, width=2)
            chip(d, x, y - 18, name, f_edge, "mm")
        else:
            d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=INK, outline=CREAM, width=2)
            anchor = "rm" if lon > SITE[0] else "lm"
            chip(d, x + (-12 if anchor == "rm" else 12), y, name, f_city, anchor)


def graticule(d, w, h):
    fg = font(18)
    lon = math.ceil(LON_MIN)
    while lon < LON_MAX:
        gx, _ = to_xy(lon, LAT_MAX)
        d.line((gx, 0, gx, h), fill=(59, 47, 32, 45), width=1)
        d.text((gx + 4, h - 24), f"{lon} deg E", font=fg, fill=(59, 47, 32, 150))
        lon += 1
    lat = math.ceil(LAT_MIN)
    while lat < LAT_MAX:
        _, gy = to_xy(LON_MIN, lat)
        d.line((0, gy, w, gy), fill=(59, 47, 32, 45), width=1)
        d.text((8, gy + 4), f"{lat} deg N", font=fg, fill=(59, 47, 32, 150))
        lat += 1


def scale_bar(d, w, h):
    m_per_px = (LON_MAX - LON_MIN) * 111320 * math.cos(math.radians((LAT_MIN + LAT_MAX) / 2)) / w
    bar_px = 50 * 1000 / m_per_px
    sx, sy = 40, h - 56
    d.rectangle((sx, sy, sx + bar_px, sy + 12), fill=CREAM, outline=INK, width=2)
    d.rectangle((sx, sy, sx + bar_px / 2, sy + 12), fill=INK)
    chip(d, sx, sy - 22, "50 km", font(20, bold=True), "lm")


def legend(d, counts):
    rivers, streams, roads = counts
    lines = [
        ("834 Bura-culture sites (schematic", (120, 30, 16)),
        ("  distribution - exact locations", (120, 30, 16)),
        ("  unpublished)", (120, 30, 16)),
        ("Niger + feeder waterways (OSM)", WATER_DK),
        ("Major roads (OSM)", ROAD),
    ]
    f = font(17)
    x, y = 40, 150
    bw = 320
    d.rectangle((x - 10, y - 14, x + bw, y + len(lines) * 24 + 6), fill=(239, 227, 194, 225), outline=INK)
    for i, (txt, col) in enumerate(lines):
        yy = y + i * 24
        if i == 0:
            d.ellipse((x, yy + 2, x + 12, yy + 14), fill=(120, 30, 16))
        elif i == 3:
            d.line((x, yy + 8, x + 14, yy + 8), fill=WATER_DK, width=4)
        elif i == 4:
            d.line((x, yy + 8, x + 14, yy + 8), fill=ROAD, width=3)
        d.text((x + 22, yy), txt, font=f, fill=INK)

# ---- main ------------------------------------------------------------------

def main():
    print("Building SRTM hillshade base...")
    img = terrain_base()
    d = ImageDraw.Draw(img, "RGBA")
    graticule(d, TARGET_W, OUT_H)
    print("Fetching OpenStreetMap roads + waterways...")
    try:
        counts = draw_osm(d, fetch_osm())
        print(f"  drew {counts[0]} rivers, {counts[1]} streams, {counts[2]} roads")
    except Exception as e:  # noqa: BLE001
        print(f"  OSM unavailable ({e}); continuing without roads/feeders")
        counts = (0, 0, 0)
    draw_corridor(img)
    d = ImageDraw.Draw(img, "RGBA")
    markers(d)
    scale_bar(d, TARGET_W, OUT_H)
    legend(d, counts)
    nx, ny = TARGET_W - 60, 64
    d.polygon((nx, ny - 32, nx - 12, ny + 14, nx, ny + 4, nx + 12, ny + 14), fill=INK)
    chip(d, nx, ny + 38, "N", font(22, bold=True), "mm")
    chip(d, 40, 50, "Bura Sites of the Middle Niger", font(34, bold=True), "lm")
    chip(d, 40, 92, "A 250 x 150 km corridor, Malian border to the 'W' bend - c. 3rd-13th c. CE",
         font(19, italic=True), "lm")
    attr = "Terrain: SRTM (public domain). Roads/rivers: (c) OpenStreetMap contributors (ODbL). Sites: UNESCO TL #5045 / Wikipedia."
    fa = font(15)
    b = d.textbbox((0, 0), attr, font=fa)
    tw = b[2] - b[0]
    d.rectangle((TARGET_W - tw - 18, OUT_H - 28, TARGET_W - 6, OUT_H - 6), fill=(239, 227, 194, 220))
    d.text((TARGET_W - tw - 12, OUT_H - 25), attr, font=fa, fill=INK)
    out = os.path.join(ASSETS, "bura-site-map-context.png")
    img.save(out, "PNG")
    print(f"Saved {out}  ({img.width}x{img.height})")


if __name__ == "__main__":
    main()
