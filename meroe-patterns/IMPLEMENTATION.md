# Curator / Cinematic mode — deep analysis + implementation (grounded in real code)

Companion to PATTERNS.md. This is the "how do we actually build it in hopeOS" layer, after
reading the real `template.js`, `embodiment.js`, `avatar-nav.js`, and the `world.html` loop.

---

## PART 1 — Deeper Meroë analysis (what it really does)

Meroë's "magic" is **scrollytelling**: a single scrollbar is a normalized timeline `t ∈ [0,1]`
over the whole story. As you scroll:

1. **Scroll position → camera keyframes.** The page defines N keyframes (camera pos + target
   + lens). Scroll `t` is mapped to a segment, then **eased** (GSAP-class) and the camera is
   `lerp`/`slerp`-ed between the two bracketing keyframes. The camera is a **free object** —
   it flies, cranes, pushes into a tomb, pulls back to orbit.
2. **Chapter detection.** Sections are watched (IntersectionObserver-style); entering one
   triggers its text block + its camera target. This is the "intro text integrated with the
   model tour."
3. **"Knows when to let the illustrations breathe."** At certain beats the 3D recedes and
   flat illustration/photo panels take over full-screen. The 3D is a *character in the
   story*, not always on screen. (Big lesson: **3D and 2D narrative trade focus.**)
4. **Hotspots/annotations** appear at specific `t` ranges, anchored to model features, with
   short labels that expand to cards.
5. **Cutaway** — interior revealed by clipping/exploding geometry at the "inside the tomb" beat.
6. **Progressive load / LOD** — photogrammetry aggressively decimated for mobile; load the
   silhouette first, swap detail in. Interiors are *separate hand-built* meshes loaded on demand.
7. **AR + Street View** as side-doors, not the spine.

**The core mechanic to steal:** a **timeline of camera keyframes + synced narrative beats**,
with easing between them. Meroë's *driver* is scroll. Ours shouldn't be.

---

## PART 2 — The fundamental difference (and why ours is better)

| | Meroë / Unity Cinemachine | hopeOS today |
|---|---|---|
| Camera | a **free object**, flown along a track | **tethered to the physics avatar capsule** — it IS the avatar's eyes (FP) or a follow rig (3rd person) |
| Driver | scroll position | per-frame `intent` from keyboard/gesture/AI |
| World | mostly baked; you watch | **live**: hands, holohands, physics, AI all running |
| Interaction during "film" | none (you scroll) | **you can still reach out and act** |

So hopeOS isn't trying to be a scrollytelling page — it's the user's stated north star:
**a film you are a character inside of and can interact with.** That's Cinemachine territory,
not WebXR-scroll territory. We own the whole stack, so we build it natively.

---

## PART 3 — The discovery: the template is ALREADY a camera director

Reading `template.js`, these primitives already exist and are exactly what a cinematic layer needs:

| Existing API | Line | What it gives the director for free |
|---|---|---|
| `step(dt, intent)` accepts **absolute** `intent.yaw` / `intent.pitch` | 616-618 | **Panning is solved.** Feed interpolated absolute angles → smooth head-turn to face an artwork, no new engine code. |
| `intent.dolly` (nudge along look-forward, still collides) | 676-677 | Dolly-in / push toward a piece. |
| `intent.zoom` → camera FOV | world.html 1138 | Lens/FOV moves (Meroë's "push in" feel) without moving the body. |
| `navigateTo(x,z,r)` / `navTarget` auto-walk (steers + stops on arrival/stuck) | 626-639, 722 | **Dolly track is solved.** "Walk the avatar to the next stop" = one call. |
| `teleportTo` / `standOn` / `goToSpawn` / `setSpawnPoint` | 726-760 | Instant cuts between stops; "home" anchor. |
| `getAvatarPosition()` / `getForward()` | 707-717 | Compute look-at angles + framing. |
| `embody.updateCamera(world, camera)` is a **single call** in the loop | world.html 1144 | One seam to override for a detached cinematic camera. |
| `_tickAnimations` (managed spin/bob/glow, stoppable/revertible) | 614 | Same pattern to model "tour playing / paused / reverted." |

> The avatar capsule already has an **AI auto-walk** (`navTarget`) and **absolute look
> override**. A guided tour is mostly *orchestration of primitives that exist*, not new physics.

---

## PART 4 — Three camera modes (map to the three "film" moves)

Build them as escalating capability. Most tours only need the first two.

### Mode A — PAN (look-only, body planted)  ← cheapest, do first
Interpolate `world.yaw`/`world.pitch` toward the angles that face a target. Feed as **absolute**
`intent.yaw/pitch`. The body never moves; the "camera" (eyes) turns to the artwork. Add
`intent.zoom` for a lens push. **Zero engine changes.**

```
lookAtAngles(eyePos, targetPos) → { yaw, pitch }
each frame: yaw = damp(curYaw → goalYaw); feed intent.yaw = yaw (same for pitch)
```

### Mode B — DOLLY / TRACK (body walks the path)  ← embodied tour
Chain `navigateTo(x,z)` waypoints; blend in Mode A panning so the head faces the piece while
walking. Collisions respected — you genuinely *walk the gallery*. This is the honest
"character in the film" version. Reuses `navTarget` wholesale.

### Mode C — CINEMATIC RIG (free camera, crane/fly-through)  ← the "wow" shots
For shots the body can't do (crane up over the gallery, fly through a wall into a vitrine).
**One new hook:** a `director.active` flag that, when true, makes the loop **skip
`embody.updateCamera`** and lets a `CameraTour` own `hope.camera` directly — flying it along a
keyframe spline (pos + lookAt + fov, eased). On tour end, `teleportTo` the body to the landing
spot and hand control back. Body is "parked" only during the shot.

```
// world.html loop, surgical change at the camera step (line ~1144):
if (director.active) director.updateCamera(hope.camera, dt);  // Mode C owns the camera
else                 embody.updateCamera(world, hope.camera); // normal embodiment
```

**Crucially, hands/holohands still resolve every frame (loop step 4) — so even in a cinematic
shot the user's holo hands are present and can gesture/interact. That's the differentiator.**

---

## PART 5 — Proposed module: a tiny "vcam + director" (Cinemachine, dependency-free)

Borrow Cinemachine's model: each tour **stop is a virtual camera (vcam)**; the **director
blends** the live camera toward the active vcam with an easing curve. ~150 lines, no GSAP.

```
sdk/world/tour/
  vcam.js        // { pos, lookAt|targetLabel, fov, mode:'pan'|'dolly'|'cine', ease, ms }
  director.js    // TourDirector: ordered vcams; next()/prev()/goto(i)/play()/pause();
                 //   emits either an intent (modes A/B) or owns the camera (mode C).
  camera-tour.js // easing + lerp/slerp between two vcams; reduced-motion → instant cut
  hotspot.js     // 3D-anchored marker → CuratorCard; depth-tested, billboarded
  curator-card.js// docked text/media/caption panel; live-region a11y
  intro-overlay.js
  tour-store.js  // tour JSON ⇄ world snapshot (references object labels)
```

Wiring is additive: `TourDirector` reads `frame`/`dt`, and either returns an intent that
**blends over** `nav.update()` (so the user can grab the wheel any moment — drop the rails,
walk free, rejoin) or, in Mode C, paints the camera. The engine/template stays untouched
except the one `if (director.active)` line.

### Easing without GSAP
```
const ease = { inOut: t => t<.5 ? 2*t*t : 1-(-2*t+2)**2/2, out: t => 1-(1-t)**2, linear:t=>t };
// blend: cam.pos.lerpVectors(a.pos,b.pos, ease(k)); slerp quats; fov = mix(a.fov,b.fov,ease(k))
```

---

## PART 6 — How we USE this to BUILD (the authoring loop = the no-code ethos)

Three authoring paths, ascending polish — all produce the same portable tour JSON:

1. **Walk-and-capture (no-code, primary).** While in a world, walk/look to frame a piece, hit
   **"＋ Capture stop"** → it snapshots `{cameraPos, yaw, pitch, fov, nearest object label}` as
   a vcam. Reorder stops in a list. This is the spatial analog of `setSpawnPoint` — literally
   reuse that capture pattern. *You direct the film by performing it.*
2. **AI-authored (conversational).** The `WorldAgent` already has `get_scene`/`getSceneState`
   (object labels + positions) and a `run_script` escape hatch with `world/scene/camera/THREE/
   hope/nav` in scope. Add tools `add_tour_stop`, `frame_object("marble bust")`,
   `play_tour` → "Give me a 5-stop accessible tour highlighting the restored pieces" emits the
   JSON. Tour authoring becomes a conversation, same as world building.
3. **Hand-tuned JSON** for power users / imported tours.

Tours **publish like worlds** (Blob, `h0p3.io/world/<name>?tour=1#stop=3` deep links) and ride
on the existing snapshot — a tour references object `label`s already saved in the world.

---

## PART 7 — Accessibility (the museum/restoration mandate), concretely

- **Progression is not scroll** (scroll excludes; also there's nothing to scroll in a 3D world).
  Use: `←/→` prev/next, `Enter` open card, `Esc` free-roam, plus optional **auto-play with
  dwell** and **region triggers** (walk into a zone → its stop fires). Multiple equal paths.
- **Narration**: per-stop audio URL, else Web Speech TTS; captions in `CuratorCard`, synced.
- **Reduced motion**: `prefers-reduced-motion` → `CameraTour` hard-cuts (vestibular safety).
- **Screen reader**: each artwork carries `alt`/`longdesc`; an `aria-live` region announces the
  active stop. The tour is fully consumable **with the 3D camera frozen** (text+audio only mode).
- **Restoration view**: `CutawayView` (clipping planes / layer toggle) to show conservation
  layers, under-drawing, damage maps, before/after — the curation/restoration use case.
- **Never trap the user**: guided mode is additive; free-roam (WASD/gesture/AI) always available.

---

## PART 8 — Build phases (sandbox first, your folder untouched until you say so)

- **P0 (proof):** Mode A pan + one Hotspot + CuratorCard over a stand-in GLB on localhost.
- **P1:** TourDirector + 3-stop dolly tour (Mode B), keyboard nav, reduced-motion, captions.
- **P2:** walk-and-capture authoring + tour JSON save/load.
- **P3:** Mode C cinematic rig (the one `director.active` loop hook) + CutawayView.
- **P4:** AI-authored tours (WorldAgent tools) + publish/deep-link.

Risk notes: Mode C is the only change that touches `world.html`'s loop (1 line) — everything
else is new files under `sdk/world/tour/`. Keep panning damped (vestibular comfort). Test FP
*and* body-embedded (follow cam) — Mode A/B must behave in both; Mode C overrides both.
