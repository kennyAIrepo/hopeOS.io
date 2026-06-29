# Sandbox log — Curation Walkthrough on the real aabcart_2_2 gallery

A runnable proof-of-concept of curation/tour mode, now re-based onto the **actual
`h0p3.io/world/aabcart_2_2` indoor environment** (same base GLB, same artifacts, same
placements as the live world) instead of the earlier outdoor temple. Implements the locked
design in [CURATION-MODE.md](CURATION-MODE.md): intro gate → auto-played choreography +
bounded head/eye look + elastic recenter + **art-flies-to-you** + return-to-tour, then an
**end-of-tour free-roam** handoff. Curator info = transparent neon-green panels.

## Where it lives
Runnable demo in the **session sandbox** (ephemeral): `…/scratchpad/meroe-patterns/demo/`.
This log + the 3 design docs are the durable copy in your repo. Ask me to **copy the demo into
your folder** to keep/run it later (~50 MB of GLBs: gallery 9 MB + two artifacts).

## How it faithfully reproduces the live world
Pulled the published snapshot from `/api/world/aabcart_2_2` and reproduced the engine's exact
load math (verified against `sdk/world/template.js`):
- **Base**: `scale ×= 24 / max(width, depth)` → `autoCenter` XZ → `autoGround` minY→0.
- **Objects**: position / rotationDeg / scale applied as **absolute on the raw GLB** (matches
  `importGLBFromURL` → `setObjectTransform`, which overrides import normalization).
- **Pedestals**: unit `BoxGeometry(1,1,1)` scaled to the saved dimensions + colors.
- Lighting = engine defaults (RoomEnvironment IBL + sun + low hemisphere, exposure 1.0, shadows).

Result: the **Bura head** and **Met relief** sit on their real pedestals at the exact authored
positions (`met [-2.57,3.53,2.62]`, `bura [-3.58,3.65,-0.14]`).

## Structure
```
demo/
  index.html              neon-green shell, importmap (three 0.160), DOM panels
  app.js                  loads the gallery snapshot (engine-faithful) + runs tour + free-roam
  tour/
    world-snapshot.js     the aabcart_2_2 data (base + 2 pedestals + 2 artifacts, abs transforms)
    tour-data.js          intro gate text + 3 stops (Met relief, Bura, AABC), framings from real positions
    camera-director.js    spring-tethered look (lookHome + bounded gaze + recenter + runaway)
    present.js            "art flies to you" present()/recall()
    free-roam.js          end handoff: WASD + pointer-lock look + G grab/drop + wheel + R
    director.js           sequences stops; arrival-gated present; finish()→free-roam handoff
    panel.js              IntroOverlay, CuratorPanel (aria-live), ReturnPrompt, EndPrompt, Hud
    util.js               GLB loader (DRACO+Meshopt), easing, damp, softClamp
  assets/                 gallery_base.glb, met_world.glb, bura_world.glb (the world's own files)
```

## How to run
`python -m http.server 8777` in the demo folder → `http://127.0.0.1:8777/`.
Tour: **◂ ▸** prev/next, **Space** play/pause, **Esc** free-look, **mouse** = head/eye stand-in.
End → "Explore freely": **WASD** move, **mouse** look, **G** grab/drop a piece, **wheel** push/pull, **R** rotate.

## Verification (headless Playwright)
- ✅ Boots clean, **no JS/page errors**; only `/favicon.ico` 404 (harmless).
- ✅ Gallery base loads + autoScale/center/ground; artifacts at exact snapshot positions on pedestals.
- ✅ Tour runs: intro gate → Met stop reached → **relief flies to the viewer** (`state: presented`).
- ✅ **End-of-tour free-roam handoff**: prompt shows → activates → WASD walk moves the camera.
- 📸 Screenshots confirm: intro gate over the gallery, Met relief presented inside the real
  gallery with the neon-green curator card, free-roam crosshair active.

## Known caveats / polish
- **Free-roam fly-cam has no collision** (walks through walls) — fine for the demo; the engine
  port reuses the real avatar character controller + Rapier colliders instead.
- Present distance for the Met relief is slightly close (fills the frame) — easy to nudge.
- Gaze is the **mouse stand-in**; real `face.lookDirection` (eyes) + head-pose fusion is P2/P3 →
  drops into `camDir.setGaze(x,y)`.
- Lighting/exposure approximate the engine defaults; can be matched more tightly if needed.

## Next
P1 rail clamp + Watch/Interact toggle → P2 real eye-gaze + dwell-present + blink-select →
P3 head-pose fusion + calibration → P4 cinematic Watch + CutawayView (restoration layers) →
then port `tour/` into `sdk/world/tour/` so it runs inside `world.html` on any published world.
