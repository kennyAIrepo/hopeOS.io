# Curation mode — refined design (gaze-steered, art-comes-to-you, constrained rails)

Builds on PATTERNS.md + IMPLEMENTATION.md. Positioning confirmed by the user:
**hopeOS = a VR environment for a game avatar, delivered in a URL with no hardware.**
Curation mode is the museum/restoration application of that: the curator authors the
choreography; the visitor experiences it on a soft rail, by head + eyes, hands-free if they want.

---

## ✅ LOCKED — the default experience (decisions made)

1. **Default motion = art flies to you.** Planted viewer; the piece presents itself. (`present()`)
2. **Entry = Watch + bounded micro-look (the hybrid).** Auto-played choreography is the SPINE.
   At every moment the choreography defines a **lookHome** heading (it pans along the path).
   Within each shot the visitor gets an **angle span** they can freely look around by **moving
   their head + eyes** — and the **scene pans toward where they look**, exactly like real life —
   but only inside that span.
3. **Elastic auto-recenter.** The moment the visitor stops actively looking around, the system
   **springs them back to lookHome and resumes** the choreography/pan. They never have to
   re-find the route; it reclaims them gently.
4. **Soft rail.** Near the span edge, input resists (eased pushback) rather than hard-stopping.
5. **Runaway → return-to-tour.** If the visitor turns too far / too long (e.g. spins ~270° and
   dwells on a random corner past a timeout), the screen shows a **"return to tour"** prompt,
   then **auto-redirects** the camera back onto the route and resumes.

### The math of the spring-tethered look (this IS the default mechanic)

```
lookHome(t)         = choreographed heading at this point on the path (the pan)
deviation           = user steering (head+eye) accumulated this beat
target = lookHome(t) + clamp(deviation, ±span)          // soft clamp near the edge
// when the user is NOT actively steering, deviation decays to 0 (critically damped spring):
deviation += (0 - deviation) * recenterStiffness * dt    // → view eases back onto lookHome
// runaway detector:
if |rawHeadingFromRoute| > span*1.4  AND  offRouteDwell > RUNAWAY_MS:
    show("Return to tour")  →  on confirm/auto-timeout: tween heading → lookHome, resume
```

So at rest the visitor rides the curated pan; lean your gaze and the world turns *with* you
inside the allowed cone; relax and it flows back to the route; bolt off and it offers a hand
back. Params: `span` (per stop, e.g. yaw ±35°, pitch ±18°), `gazeGain`, `recenterStiffness`,
`recenterDelay` (how long after you stop before it reclaims you), `RUNAWAY_MS`. All tunable,
same spirit as `NAV_DEFAULTS`.

---

## The three new ideas (and how grounded each is)

### IDEA 1 — Don't move the viewer; bring the art TO the viewer ("fly/come to you")
Instead of walking the avatar to each piece (or flying a camera), the **artwork detaches and
presents itself** to a mostly-stationary viewer: lifts off its pedestal, glides to a
comfortable reading pose in front of the eyes, turns to its hero angle, scales to fill the
frame, holds, then returns home.

- **Why it's powerful:** it sidesteps the camera-tether limitation entirely. You don't need a
  free-flying camera (Mode C) for most of the experience — the planted viewer + **Mode A pan**
  + object choreography already delivers the "wow." Also more accessible: no locomotion, no
  vestibular load.
- **Grounded:** `template.js` `_tickAnimations` already manages object motion and is
  **stoppable + revertible** — so `recall()` (send it home) is literally the existing "revert."
- **New piece to build:** a `present(label)` choreography = compute a target pose
  `{pos, quat, scale}` in front of the camera (reading distance ≈ 0.6–0.9 m, eye height,
  framed to FOV), tween the object there, optional spotlight + dim surroundings; `recall()` reverts.

### IDEA 2 — Navigate the curated shot with HEAD + EYES (hands-free, on-rail)
Within a stop's framed shot, the visitor explores by **turning their head and moving their
eyes** — not by walking. Gaze/head become a steering signal that is **clamped to the curator's
allowed angles**. Dwell your gaze on a piece → it flies to you. Gaze toward the path's forward
anchor → glide to the next stop.

- **Grounded (already there):** `face.js` exposes `lookDirection.{x,y}` (continuous eye gaze)
  + `lookLeft/Right/Up/Down` + `blink('left'|'right'|'both')` + `eyesClosed(duration)`.
  Eye gaze = fine aim; blink/dwell = select. The deadzone + sensitivity pattern already exists
  in `avatar-nav.js` `NAV_DEFAULTS`.
- **To ENHANCE:** **head pose** (yaw/pitch/roll) isn't computed yet. MediaPipe FaceLandmarker
  can emit a `facialTransformationMatrix` (enable `outputFacialTransformationMatrixes: true`),
  decompose → `headYaw/headPitch`. Fuse **head (coarse, big turns) + eyes (fine, micro-aim)**
  into one steering vector — standard gaze+head fusion. (Verify the FaceLandmarker is actually
  instantiated/running — face track may be off by default for perf/privacy.)
- **Output is an `intent`, just constrained:** gaze/head produce the same
  `{yawDelta, pitchDelta}` shape `nav.update()` emits — so this is literally **"one intent,
  many inputs"** with a projection step. The engine never knows gaze drove it.

### IDEA 3 — Watch ⇄ Interact, and "all routes fall within the tour"
Three levels of agency, with the curated path as the spine:

| Level | Control | Camera | Use |
|---|---|---|---|
| **Watch** | none (passenger) | auto-played choreography (Mode C / scripted Mode A+B) | lean back, like a film |
| **Interact (on-rail)** | head + eyes + hands steer **within** the stop's envelope | constrained | explore the shot the curator framed |
| **Free-roam (escape)** | full WASD / gesture / AI nav | free | wander off mid-tour; tour pauses |

Default visit stays in Watch/Interact, so **every route falls within the panning/tours** — the
curator's angles and pacing are honored. Free-roam is an explicit opt-out ("step off the path"),
and a persistent **"return to tour"** affordance rejoins at the nearest stop. Toggle Watch⇄Interact
anytime (e.g. a button, or "look down" to grab the wheel, "eyes forward" to hand it back).

---

## The core primitive: the RAIL (constrained freedom)

This is what makes it "curation" and not "free world." Each stop/segment defines an **envelope**
that user input is **projected into** (Cinemachine "dolly + confiner + look-at limits", but ours):

```jsonc
{
  "id": "stop-3",
  "rail": {
    "position": { "type": "point|spline|bubble", "value": [x,y,z], "slide": 0.0 },  // where the viewer may be
    "look":     { "yaw": [-35, 35], "pitch": [-15, 25] },   // degrees they may look, clamped
    "fov":      [40, 60],                                    // lens range they may push
    "interact": ["marble bust", "fresco panel"],            // what is gaze/hand-active here
    "advanceGaze": "forward-anchor"                          // gaze here → next stop
  },
  "camera": { "pos":[…], "look":[…], "ease":"inOut", "ms":2200 },   // the curated hero framing
  "present": { "auto": false, "object": "marble bust" },            // fly-to-you on dwell or auto
  "card":    { "heading":"…", "body":"…", "narration":"…", "alt":"…" }
}
```

**Projection rule:** raw input (head/eye/hand/key) → desired Δyaw/Δpitch/slide → **clamp to the
envelope** → feed as `intent`. Free-roam = remove the clamp. That single clamp toggle is the
whole "on-rail vs off-rail" mechanic.

---

## How it all composes per frame (additive to the existing loop)

```
1. raw = read inputs (nav.update gives keyboard/gesture; face gives gaze+head+blink)
2. if curation.active:
     steer  = fuse(headPose, gaze) → {yawDelta,pitchDelta}      // IDEA 2
     intent = project(steer, stop.rail)                          // RAIL clamp (IDEA 3)
     if gazeDwell(object) → world.present(object)                // IDEA 1 (managed anim)
     if gazeAt(forwardAnchor) || nextKey → director.next()       // glide along rail
     if userBreaksOut → curation.active=false (free-roam), show "return to tour"
   else:
     intent = raw                                                // normal free world
3. world.step(dt, intent)        // unchanged
4. director.active ? director.updateCamera() : embody.updateCamera()   // 1-line hook (Mode C)
5. hands resolve every frame (UNCHANGED) → holo hands live even in Watch
```

The ONLY engine edits remain: the one `if (director.active)` camera line in `world.html`, and
enabling the head-pose matrix in the face tracker. Everything else is new files in
`sdk/world/tour/` + a `present()/recall()` method on the template that rides `_tickAnimations`.

---

## Accessibility & comfort (non-negotiable for the museum mandate)

- **Camera is opt-in.** Face tracking needs the webcam ON, but world mode defaults camera OFF
  (privacy, per CONCEPT). So gaze-nav is an *enhancement*; **keyboard/click parity is required**
  for every gaze action (next/prev/select/present). The whole tour must be doable with the
  camera off and even the 3D frozen (text + audio).
- **Dwell, deadzones, damping.** Gaze steering uses center deadzones + dwell timers (reuse the
  `NAV_DEFAULTS` philosophy) so micro-eye-jitter doesn't lurch the view. Blink-to-select needs a
  debounce so natural blinks don't fire.
- **Reduced motion.** `prefers-reduced-motion` → camera cuts, and `present()` snaps instead of
  flying (motion sensitivity; "art rushing at you" can be intense).
- **Never trapped.** Free-roam escape always available; "return to tour" always visible.
- **Calibration.** Quick gaze/head calibration ("look at the four corners") to map this user's
  range — like `body-gestures.js` already calibrates a baseline standing pose.

---

## Build order (revised — sandbox first)

- **P0** Mode-A pan + `present(label)`/`recall()` (art flies to a planted viewer) + curator card.
  *This alone is a complete, accessible micro-experience and needs ~no engine change.*
- **P1** TourDirector + rail envelope + clamp; keyboard nav; Watch vs Interact toggle.
- **P2** Gaze steering from `face.lookDirection` (eyes only first — no head pose needed yet)
  + dwell-to-present + blink-to-select; full keyboard parity.
- **P3** Head-pose enhancement (FaceLandmarker transformation matrix) + head/eye fusion + calibration.
- **P4** Mode C cinematic rig (auto-play Watch) + CutawayView (restoration layers).
- **P5** Walk-and-capture + AI-authored tours + publish/deep-link.

Open questions to resolve with you:
1. For a typical stop, is the **default** "art flies to me" (planted viewer) or "I glide to the art"?
2. Watch vs Interact default on entry — passenger first, or hands-on first?
3. How hard is the rail — hard clamp (can't look past limits) or soft (resists, but possible)?
