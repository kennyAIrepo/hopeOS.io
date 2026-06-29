# Meroë → hopeOS — reusable component patterns

Source studied: https://artsexperiments.withgoogle.com/meroe/ (Google Arts & Culture ×
UNESCO Sudan). Stack confirmed: **Three.js + WebXR**, drone photogrammetry models
optimized for mobile, hand-built interior geometry, GSAP-class tweening, scrollytelling.

Target: hopeOS (`h0p3.io`) — no-build native ESM, three r160, Rapier, "one intent / many
inputs" decoupling, graceful degradation. Current test world: `h0p3.io/world/aabcart_2_2`.
Use case: **accessible art gallery / museum / restoration & curation in a game environment.**

---

## The core architectural insight

Meroë is a **scroll-driven guided narrative** over a 3D model.
hopeOS is **free-roam embodied navigation** (keyboard / gesture → one `intent`).

These are not in conflict — a guided tour is **just another intent source**. The same way
keyboard and gesture both emit `{forward, strafe, yawDelta, pitchDelta, jump, sprint}`, a
**TourDirector can emit a scripted camera path** the world template already knows how to
consume. That keeps the engine untouched and makes "curator mode" a drop-in plugin, exactly
the L5 philosophy in WORLD_LAYER.md.

> Guided tour = a 4th input alongside keyboard / gesture / AI-agent. It produces camera
> waypoints instead of per-frame movement, but flows through the same template.

---

## Component catalog (Meroë → hopeOS module)

Proposed home: `sdk/world/tour/` (new L5 sub-layer). All vanilla ESM, no build, three r160.

| # | Meroë pattern | Reusable component | What it does in hopeOS |
|---|---|---|---|
| 1 | Intro hero: headline + looping video bg + audio alt | **`IntroOverlay`** | Title card over the live 3D view; "Begin tour" CTA; audio-narration alternative + captions. Reuses world.html `#entry` overlay conventions. |
| 2 | Chapters / scrollytelling sections | **`TourDirector`** | Ordered list of tour *stops*; advances by scroll, click, keyboard, or auto-play; emits the active stop. The sequencer. |
| 3 | Camera pans between points of interest | **`CameraTour`** | Tweens camera position+target between stop waypoints (ease in/out). Emits into the template like an intent source. Reduced-motion → instant cut. |
| 4 | Hotspots / annotations on the model | **`Hotspot`** | A 3D-anchored marker that billboards a 2D label/panel; click → opens curatorial card. Depth-sorted, occludable. |
| 5 | Fixed section nav (Home / Pyramids / …) | **`TourNav`** | Chapter index / progress rail; jump to any stop; current-stop highlight; fully keyboard-navigable. |
| 6 | Cutaway / reveal of interior structure | **`CutawayView`** | Clipping-plane or layer-toggle reveal of an object's interior (great for restoration: show layers, under-drawing, damage map). |
| 7 | Curatorial text card per stop | **`CuratorCard`** | The intro-text-with-the-model pattern: rich text panel docked beside the focused artwork; image + body + credits + audio. |
| 8 | Street View panorama embeds | **`PanoramaLink`** | Optional jump to a 360 / external context view; gated behind the link-safety rules. |
| 9 | Share (copy URL / social) | **`ShareBar`** | Mostly *exists* — `h0p3.io/world/<name>` + deep-link to a specific stop (`#stop=3`). |
| 10 | Audio narration + captions + reduced motion | **`a11y` layer (cross-cutting)** | Per-stop narration (audio file or TTS), synced captions, reduced-motion, keyboard-only progression, screen-reader alt text per artwork. |

---

## Accessibility = the differentiator (your stated goal)

"Accessible formatting in the game environment" maps directly onto these cross-cutting rules,
which every component above must honor:

- **Narrated tour** — each stop carries `narration` (audio URL) **or** falls back to Web
  Speech TTS; captions render in `CuratorCard` in sync.
- **Keyboard-only path** — `←/→` prev/next stop, `Enter` open card, `Esc` exit tour. No
  pointer or webcam required (graceful degradation, per CONCEPT design principles).
- **Reduced motion** — honor `prefers-reduced-motion`: `CameraTour` cuts instead of sweeps
  (motion-sensitivity / vestibular safety).
- **Screen-reader layer** — each artwork/hotspot has an `alt`/`longdesc`; a live region
  announces the active stop's title + description.
- **High-contrast text** — `CuratorCard` over 3D uses a solid/blur backdrop, large type
  (the green-on-#04070a design system already leans this way).
- **Free-roam never lost** — guided mode is *additive*; the user can drop the rails and walk
  the gallery with WASD/gesture at any moment, then rejoin the tour.

---

## Data model — a "tour" rides on the existing world snapshot

A tour is **portable JSON** that references object `label`s already in the world snapshot
(ARCHITECTURE.md §7.1) — no engine change, fully shareable/publishable like worlds:

```jsonc
{
  "tour": {
    "title": "Restoration: The Aabc Collection",
    "intro": { "heading": "…", "body": "…", "narration": "blob://…", "media": "…" },
    "stops": [
      {
        "id": "stop-1",
        "target": "marble bust",        // matches a world object label
        "camera": { "pos": [x,y,z], "look": [x,y,z], "ease": "inOut", "ms": 2200 },
        "card": { "heading": "…", "body": "…", "credits": "…",
                  "narration": "blob://…", "alt": "screen-reader description" },
        "hotspots": [ { "anchor": "left ear", "note": "1840 restoration seam" } ],
        "cutaway": null
      }
    ]
  }
}
```

This means: **the AI co-creator (WorldAgent) could author tours conversationally** — "give
me a 5-stop accessible tour of this gallery" → it emits this JSON, same as it builds scenes.

---

## What I'd build first (proposed, sandbox only)

A minimal vertical slice provable in the sandbox without touching your folder:
1. `TourDirector` + `CameraTour` — scripted camera sweep through 3 stops, keyboard + reduced-motion.
2. `Hotspot` + `CuratorCard` — one annotated artwork with a curatorial panel + caption.
3. A tiny demo `tour.json` over a stand-in GLB, served on localhost so you can click through.

No GSAP needed — a ~40-line easing tween keeps it dependency-free (in keeping with the
version-pinned-CDN philosophy); GSAP stays an option if we want richer timelines later.
