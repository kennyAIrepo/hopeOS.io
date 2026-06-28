# Map Design & Generation — Panel A (Bura, Middle Niger)

How the Panel A maps are generated, and how to re-size a generated map so it
drops into a poster hero slot of any aspect ratio **without cropping**.

All generators are dependency-light Python (Pillow + numpy + stdlib `urllib`)
and write PNGs into `assets/`. No API keys. Run from the repo root, e.g.:

```pwsh
python gallery/bura-ceramics/tools/make_context_map.py
```

---

## 1. Generators & outputs

| Script | Output (`assets/`) | What it is | Licensing |
| --- | --- | --- | --- |
| [tools/make_site_map.py](tools/make_site_map.py) | `bura-site-map.png` (1500×980) | OpenTopoMap duotone regional map, GPS pin + graticule + scale | **CC-BY-SA** (OpenTopoMap) — attribution required |
| [tools/make_site_map_variants.py](tools/make_site_map_variants.py) | `bura-site-map-public.png` (1500×980) | SRTM multi-directional hillshade, ochre-toned | **Public domain** (SRTM + Natural Earth) — no attribution required |
| [tools/make_site_map_variants.py](tools/make_site_map_variants.py) | `bura-site-map-commission.png` (1500×980) | Natural Earth ink-drawn "commission" style on parchment | Public domain — original drawing |
| [tools/make_context_map.py](tools/make_context_map.py) | `bura-site-map-context.png` (1600×**1214**) | Wide valley context: SRTM base + OSM roads/feeders + the ~834-site distribution corridor | SRTM public domain; **OSM = ODbL (attribution required)** |

`bura-site-map-context.png` is the current Panel A hero.

---

## 2. Data sources (kept for linking)

| Layer | Source | Endpoint | License |
| --- | --- | --- | --- |
| Elevation (hillshade) | AWS Terrain Tiles (SRTM/terrarium) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Public domain |
| Topo basemap | OpenTopoMap XYZ tiles | `https://{a,b,c}.tile.opentopomap.org/{z}/{x}/{y}.png` | CC-BY-SA |
| Rivers/lakes (1:10m) | Natural Earth vector | `…/nvkelso/natural-earth-vector/master/geojson/ne_10m_*.geojson` | Public domain |
| Roads + feeder waterways | OpenStreetMap via Overpass | mirrors: `overpass.kumi.systems`, `overpass-api.de`, `maps.mail.ru` | **ODbL** — attribution required |

Terrarium decode: `elev_m = R*256 + G + B/256 − 32768`.

**Subject facts** (UNESCO TL #5045 / Wikipedia / Grokipedia):
- ~**834** related Bura-culture sites; ensemble spans **~450 km / a 250×150 km corridor**, from the Malian border to the "W" river bend; c. **3rd–13th c. CE**.
- Exact site coordinates are **unpublished** (looting protection, ICOM Red List). The 834 sites are therefore drawn **schematically** (clustered along the valley axis with a fixed RNG seed), never as surveyed positions, and labeled as such.
- Type-site Bura-Asinda-Sikka: **13°53′53″N 1°02′20″E** (13.8981, 1.0389).
- Sources: <https://whc.unesco.org/en/tentativelists/5045> · <https://en.wikipedia.org/wiki/Bura_archaeological_site> · <https://grokipedia.com/page/bura_archaeological_site>

---

## 3. Pipeline (context map)

1. **Projection** — Web Mercator. `lonlat_to_pixel(lon, lat, z)`:
   `n = 256·2^z`; `x = (lon+180)/360·n`; `y = (0.5 − ln((1+sinφ)/(1−sinφ))/4π)·n`.
   A bbox `(LON_MIN,LAT_MAX)→(LON_MAX,LAT_MIN)` defines the image; `to_xy()` maps
   lon/lat into pixel space.
2. **SRTM hillshade base** — fetch terrarium tiles at `ELEV_ZOOM`, stitch, crop to
   bbox, decode to metres. Multi-directional hillshade over azimuths
   `315,45,135,225,270,0` (zfactor 3), `autocontrast(cutoff=2)`, colorize
   `black=(102,83,53) mid=(178,142,88) white=(243,232,201)`, blend 12% cream.
3. **OSM overlay** — Overpass query for `waterway~river|stream|canal` and
   `highway~motorway|trunk|primary|secondary`; rivers width 5, streams width 2,
   roads width 2. Cached to `tools/cache/overpass_context.json`.
4. **Distribution corridor** — rotated rectangle (perpendicular offset of the
   NW→SE axis, half-width `CORRIDOR_HALF_KM`); 834 dots seeded `random.Random(834)`
   along the axis with `gauss(0, 0.42)` cross-spread, each = cream halo + crimson dot.
5. **Annotation** — graticule, markers (off-frame markers skipped), 50 km scale
   bar, legend, north arrow, title/subtitle, attribution.

**Caches** (speed up reruns, safe to delete): `tools/cache/terrarium/{z}/{x}/{y}.png`,
`tools/cache/overpass_context.json`, `tools/cache/*.geojson`. A cache covering a
**larger** extent is reused for a smaller one (extra features clip off-frame).

---

## 4. Sizing a map to a poster hero slot (the reusable part)

The poster renderer [loader.js](loader.js) draws the hero with `drawCover()`
(CSS `background-size: cover` semantics → it **center-crops** to fill). To avoid
any crop, the generated PNG must match the slot's aspect ratio.

**Slot geometry** (in `loader.js`):
- Canvas `1024 × 1536`, outer margin `M = 64` → **`innerW = 1024 − 2·64 = 896`**.
- Hero height is per-panel: `const imgH = panel.heroHeight || 420;`
- So the target aspect is **`HERO_ASPECT = innerW / imgH = 896 / imgH`**.

`make_context_map.py` derives its latitude band from that aspect, keeping the
**longitude sweep fixed** (it defines the width) and the same map center:

```python
HERO_ASPECT = 896.0 / 680.0      # innerW / panel.heroHeight
_CENTER_LAT = 13.715             # keep the site centred
_w_norm = (LON_MAX - LON_MIN) / 360.0
_h_norm = _w_norm / HERO_ASPECT  # narrower lat band ⇒ wider image
_cy = _merc_yn(_CENTER_LAT)
LAT_MAX = _merc_yn_inv(_cy - _h_norm / 2)
LAT_MIN = _merc_yn_inv(_cy + _h_norm / 2)
# OUT_H then computes to TARGET_W / HERO_ASPECT automatically.
```

Resulting pixel height: **`OUT_H = round(TARGET_W / HERO_ASPECT) = round(TARGET_W · imgH / 896)`**.

---

## 5. Retargeting for different panel sizes

To put this map (or a new one) into a slot of a different height, set
`heroHeight` on the panel and regenerate with the matching `HERO_ASPECT`.

| `panel.heroHeight` | `HERO_ASPECT` (896/h) | `OUT_H` @ `TARGET_W=1600` | Framing | Lat band shown |
| --- | --- | --- | --- | --- |
| 420 (default) | 2.133 | 750 | wide letterbox | thin valley strip |
| 540 | 1.659 | 964 | wide landscape | |
| **680 (Panel A now)** | **1.318** | **1214** | landscape | corridor + Niamey/Téra |
| 820 | 1.093 | 1465 | near-square | most of the corridor |
| 896 | 1.000 | 1600 | square | full vertical valley |

Taller slot ⇒ smaller `HERO_ASPECT` ⇒ a taller latitude band (more valley), and
the corridor's NW/SE ends come into frame. If you widen the longitude range
instead, increase `LON_MAX − LON_MIN` and the height follows automatically.

**Steps**
1. In [panels.json](panels.json), set the panel's `heroHeight` (e.g. `"heroHeight": 820`).
2. In [tools/make_context_map.py](tools/make_context_map.py), set `HERO_ASPECT = 896.0 / <heroHeight>`.
3. (Optional) keep `_CENTER_LAT`, or adjust `LON_MIN/LON_MAX` for a wider/narrower sweep.
4. Run `python gallery/bura-ceramics/tools/make_context_map.py`.
5. Reload the preview — `drawCover()` now fills the slot 1:1, no crop.

> If a panel uses a different canvas width or margin than 1024/64, recompute
> `innerW = canvasWidth − 2·M` and use `HERO_ASPECT = innerW / heroHeight`.

---

## 6. Attribution requirements

- **SRTM / Natural Earth** — public domain, no attribution required.
- **OpenStreetMap** — ODbL: keep "© OpenStreetMap contributors (ODbL)" in the
  map footer **and** the panel's source list/credit whenever the OSM layer is shown
  (the context map). The public/commission variants avoid OSM and need no attribution.
