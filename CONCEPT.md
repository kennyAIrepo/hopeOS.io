# hopeOS — Concept

> **hopeOS** is a browser-native 3D/AR spatial engine where anyone can **enter, build,
> and inhabit** 3D worlds using their **body, voice, and natural language** — with **no
> install, no build step, and no code**. It fuses a camera-based spatial-tracking SDK
> (hopeOS AIR / "DEI") with a drop-in world-hosting template engine, unified by an
> in-world **AI co-creator**.

---

## 1. Vision

The web browser is the most widely distributed runtime on Earth, yet immersive 3D and AR
have stayed locked behind native apps, headsets, game engines, and toolchains. hopeOS
removes every one of those gates:

- **Nothing to install.** A URL is the entire client. Open `h0p3.io` and you are inside.
- **Your body is the controller.** A webcam + on-device ML turns your hands and pose into
  spatial input. No headset, no gloves, no markers.
- **Speak the world into being.** Voice and natural language drive an AI agent that
  navigates you, imports real 3D assets, builds scenes, and directs lighting and mood.
- **No-code creation.** "A quiet Japanese garden at dusk" becomes a navigable, collidable,
  playable world in one conversation — no compile, no editor expertise.
- **Live, always.** Everything is interpreted at runtime: imports drop in already lit,
  shadowed, and physically collidable. There is no build/deploy loop between idea and play.

The product north star: **the lowest-friction path from imagination to an inhabited 3D
space**, on any device, for anyone.

---

## 2. The core experience

### 2.1 Enter ("the mirror")
The landing page shows a **live holo-mirror**: the user's camera feed overlaid with a
predicted holographic hand/body skeleton (MediaPipe). This is the invitation — "step
through the looking glass" — and the first proof that the body is the interface.

### 2.2 Play
A hosted world runtime where the user **moves through a 3D space** using either:
- **Keyboard/mouse** — WASD, mouse-look (pointer lock), space to jump, shift to sprint; or
- **Gesture** — one-handed bare-hand VR locomotion: hand *position* steers the camera
  (continuous look), hand *shape* sets the walk state (point = forward, open palm =
  sprint, fist = stop, jab up = jump).

Both input methods emit the **same movement intent**, so a world never knows which drove it.

### 2.3 Embodiment — two ways to be present
- **First-person POV** — the camera is the avatar's eyes; holo hands float in front,
  fingers extending into the scene (classic VR/FPS feel).
- **See Yourself** — a third-person follow camera shows the user's tracked body/hands
  *inside* the scene ("there I am, in the gallery"). An optional SAM2 silhouette can
  billboard the real segmented body image in place of the skeleton.

### 2.4 Build (the no-code world maker)
A short conversation with a **Builder agent** turns a vibe into a concrete search for a
downloadable 3D environment (Sketchfab), or the user uploads their own GLB. The chosen
scene is auto-scaled, grounded, and spawned into an instantly playable world. Inside it,
the **World agent** (a co-creator and spatial designer) can:
- move the user and aim their view,
- import real assets by description ("a marble classical bust"),
- mark walls/floors/regions and place or tile objects on them,
- translate/rotate/scale/recolor/duplicate/delete by name,
- direct **atmosphere**: time of day (a realistic sun arc that recasts shadows), sun
  azimuth/elevation, sky/fog/exposure, skybox, and shadow quality,
- and **script** live behaviors (spin, bob, glow, add lights) when no named tool fits.

### 2.5 Share
Built worlds are **published to a communal public library** at a stable URL
(`h0p3.io/world/<name>`) and reopen on any device, replaying the saved scene, objects,
transforms, and spawn. Private drafts live locally until the creator explicitly publishes.

---

## 3. Design principles

| Principle | What it means in hopeOS |
|---|---|
| **No build step** | Native ESM + import maps over CDN. Edit a file, reload, it's live. Imports are interpreted at runtime — never compiled. |
| **The body is a first-class input** | Hand/pose tracking is a peer to keyboard, not an afterthought — but always *optional* (the camera is a bonus; everything works without it). |
| **Graceful degradation everywhere** | A blocked camera, a slow CDN, a missing AI key, or a failed model never aborts the experience. The world still boots and plays. |
| **One intent, many inputs** | Keyboard and gesture resolve to the same `intent`; both embodiment modes resolve to the same hand `deform()`. New inputs/scenes don't touch the engine. |
| **Human scale is ground truth** | Metres, Y-up. A human ≈ 1.7 m. Everything (imports, doorways, avatar capsule) is sized against the body so spaces feel real. |
| **AI as co-creator, not command parser** | The agent converses, pitches options, and explains trade-offs — and acts with tools. It is a design partner thinking out loud. |
| **Privacy by default** | World mode starts with the camera **off**; the mic is requested only when voice is toggled on. No secrets ship to the browser. |
| **Secrets stay server-side** | All third-party keys live in Vercel env vars behind thin proxies; the browser only ever calls `/api/*`. |

---

## 4. Who it's for

- **Curious visitors** — step into the mirror, wave, walk through a world, with zero setup.
- **No-code creators** — describe a space and inhabit it; no modeling, rigging, or engine.
- **Spatial/AR tinkerers** — a free, install-free sandbox for body-driven interaction.
- **Builders/developers** — an SDK (`window.hopeOS`) for hands, gestures, physics, voice,
  and world hosting, embeddable in any static page.

---

## 5. What makes it different

- **Browser-native AR without a headset or app** — just a webcam and a URL.
- **Runtime-live world building** — no compile loop; imported assets are immediately real
  (lit, shadowed, collidable, touchable).
- **A single coordinate/intent contract** that lets keyboard, gesture, first-person, and
  third-person embodiment all share one engine.
- **An AI that both talks and builds** — voice → Whisper → Claude tool-calls → live scene
  mutations, narrated like a designer working beside you.
- **Communal, shareable worlds** persisted as portable JSON snapshots + hosted GLBs.

---

## 6. Glossary

| Term | Meaning |
|---|---|
| **hopeOS AIR / DEI layer** | The camera-POV spatial-tracking SDK: MediaPipe hands/pose, holo-hand meshes, body capsules, gesture/voice/face detection, collision. |
| **World Layer (L5)** | The drop-in plugin layer that hosts a GLB as a navigable, physical, multi-embodiment world. |
| **WorldTemplate** | The engine that loads a GLB, builds colliders, fits shadows, and runs the avatar character controller. |
| **Intent** | The unified movement command (`forward, strafe, yawDelta, pitchDelta, jump, sprint`) emitted by any input. |
| **Embodiment** | How the user is present in the scene: first-person eyes or third-person body. |
| **World agent** | The in-runtime Claude co-creator that navigates, imports, builds, and directs atmosphere via tools. |
| **Builder agent** | The conversational front door that turns a described vibe into a scene to inhabit. |
| **Holo hand** | A predicted holographic hand mesh driven by MediaPipe landmarks — never a flesh image. |
| **World snapshot** | The portable JSON describing a built world (base scene + objects + transforms + spawn) for save/share/reopen. |
