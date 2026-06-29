/**
 * hopeOS SDK — Curation Mode (guided gallery walkthrough)
 * ═══════════════════════════════════════════════════════════════
 * A museum/restoration tour layered over a live hopeOS world (Meroë-inspired, but
 * embodied — you stay a character inside the film). It rides the existing engine:
 *   • LOOK is driven via the absolute `intent.yaw/pitch` the template already consumes.
 *   • "Art flies to you" tweens the artifact mesh to a reading pose in front of the eyes,
 *     then returns it home — the world's saved coordinates never change.
 *
 * The locked design (see meroe-patterns/CURATION-MODE.md):
 *   intro gate → per-stop: pan to face → artifact flies to you → curator card →
 *   bounded head/eye look with elastic recenter → wander-off "return to tour" →
 *   end → "explore freely" hand-off to normal play.
 *
 * Wiring (3 touch-points in world.html):
 *   const tour = new CurationTour({ world, nav, hope, THREE });
 *   tour.offerIntro();                          // on spawn (published worlds)
 *   if (tour.active) tour.steer(intent, dt);    // in the frame loop, BEFORE world.step
 *   tour.update(dt);                            // in the frame loop, AFTER world.step
 */
import * as THREE from 'three';

const NEON = '#39ff5a';

// Curator copy keyed by fuzzy label match — seeds rich content for the AABC×Met gallery,
// and degrades to the object's own label on any other world.
const CURATOR = [
  { match: /hades|persephone|relief|met|votive|terracotta fragment/i,
    kicker: 'The Met · Greek, South Italian, Locrian · ca. 470–460 BCE',
    title: 'Hades Abducting Persephone',
    body: 'Terracotta fragment of a votive relief. When Hades carried Persephone to the underworld, '
        + 'Demeter stilled all growth on earth until her daughter could return for part of each year — '
        + 'an ancient allegory for the seasons. Deaccessioned by The Met and restituted to the Italian '
        + 'Republic in 2026, in collaboration with the Manhattan DA’s office. Here it is live, present, '
        + 'and accessible once more.' },
  { match: /bura|ceramic|clay|head|cracked|meshy/i,
    kicker: 'Bura civilization · Niger River Valley · ca. 200–1300 CE',
    title: 'Bura Ceramics',
    body: 'Figurative terracotta from the Bura culture — funerary jars, statues and busts marked by '
        + 'ridged textures and scarification designs, used as urns in complex burial rites that '
        + 'distinguished age, gender and class. Discovered at sites like Asinda-Sikka, they reveal a '
        + 'sophisticated society with deep cultural continuity.' },
];

const INTRO = {
  kicker: 'AABC × THE MET × BUCONNI ART GALLERY · HOSTED BY HOPEOS',
  title: 'LOST & RECONSTRUCTED',
  lede: 'A curation walkthrough — cultural artifacts, made live and accessible again.',
  paras: [
    'Around you stands a space rebuilt with today’s tools. That is the wager of this work: art is not '
      + 'only the power to <b>envision</b> what no longer exists — but to <b>engineer</b> it, and make it real again.',
    'The artifacts gathered here were once lost, scattered, or taken. Here they are live, present, and accessible once more.',
    'This is a collaboration. The Met and partner collections open their holdings; the Buconni Art Gallery '
      + 'curates; <b>AABC</b> returns cultural heritage to its people through restitution, transparency, and new '
      + 'technology; and <b>hopeOS</b> makes it a place you can enter. Together, we engineer hope.',
    'Look around freely — turn your head, let your eyes wander. The tour will guide you, and gently bring you back.',
  ],
};

const OUTRO = {
  kicker: 'AABC · Cultural Restitution',
  title: 'Engineering Hope',
  body: 'AABC helps museums and stakeholders resolve cultural-property claims — using blockchain for '
      + 'transparency, accountability, and ethical stewardship, fostering global collaboration and fairer '
      + 'outcomes. Lost and reconstructed, made live and accessible again. The space is now yours to explore.' };

// ── small math helpers ──
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const damp = (cur, goal, lambda, dt) => goal + (cur - goal) * Math.exp(-lambda * dt);
const shortAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
function softClamp(v, span) {                       // resist near the edge instead of hard-stopping
  const s = Math.sign(v), m = Math.abs(v);
  return m <= span ? v : s * (span + (m - span) / (1 + (m - span) * 2.2));
}
function lookAnglesTo(eye, target) {
  const d = target.clone().sub(eye); if (d.lengthSq() < 1e-6) return { yaw: 0, pitch: 0 };
  d.normalize();
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)) };
}
function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

export class CurationTour {
  constructor({ world, nav, hope, THREE: T }) {
    this.world = world; this.nav = nav; this.hope = hope;
    this.onBegin = null;            // host hook: apply Gallery mode + close the chooser
    this.onSkip = null;             // host hook: Gallery free-roam (no tour)
    this.active = false;            // true while the tour drives the look
    this.state = 'idle';            // idle | pan | present | stop | returning
    this.stops = [];
    this.i = -1;
    this.paused = false;
    // tuning (same spirit as NAV_DEFAULTS)
    this.spanYaw = 0.62; this.spanPitch = 0.34;     // ±35° / ±19° bounded look
    this.gaze = 1.0; this.recenterLambda = 2.6; this.recenterDelay = 0.5;
    this.runawayYaw = this.spanYaw * 1.6; this.runawayDist = 3.0; this.RUNAWAY_MS = 1600;
    this.devYaw = 0; this.devPitch = 0; this._idle = 0; this._offT = 0;
    this.lookHome = { yaw: world.yaw || 0, pitch: 0 };
    this._tw = null;                // active tween {a,b,t,ms,onDone,kind}
    this._introEase = null;         // gentle camera glide while the intro gate fades in
    this._present = null;           // active fly-in tween
    this._homes = new Map();        // assetId → {pos,quat,scale} so a piece always returns home
    this._anchor = null;            // viewer body pos at the current stop (for return-to-tour)
    this._injectCSS(); this._buildDOM();
  }

  // ── PUBLIC: lifecycle ─────────────────────────────────────────
  /** Build the tour from the live world's artifacts (imported models) + intro/outro. */
  build() {
    // Real artifacts = imported GLB models with a source URL. EXCLUDE procedural AI objects
    // (graffiti / paint / AI sketches are also adopted as ptype 'import' but source 'ai').
    const arts = (this.world.assets || []).filter(a => a.mesh && a.ptype === 'import' && a.source !== 'ai' && a.url);
    const stops = arts.map(a => {
      const c = CURATOR.find(c => c.match.test(a.label || '')) || {};
      return { asset: a, label: a.label,
        kicker: c.kicker || 'Artifact', title: c.title || (a.label || 'Untitled'),
        body: c.body || 'A piece in this collection.' };
    });
    this.stops = stops;
    return stops.length;
  }

  /** Show the intro gate (call on spawn). Returns false if there's nothing to tour. */
  offerIntro() {
    if (!this.build()) return false;
    this._showIntro();
    this._startIntroEase();              // "fly in" — slowly turn to face the gallery as the gate fades up
    return true;
  }
  _artifactsCentroid() {
    const c = new THREE.Vector3(); let n = 0;
    for (const s of this.stops) { c.add(this._center(s.asset.mesh)); n++; }
    return n ? c.divideScalar(n) : this._eye().add(dirFromAngles(this.world.yaw, 0));
  }
  _startIntroEase() {
    const home = lookAnglesTo(this._eye(), this._artifactsCentroid());
    this._introEase = { a: { yaw: this.world.yaw, pitch: this.world.pitch },
      b: { yaw: this.world.yaw + shortAngle(home.yaw - this.world.yaw), pitch: clamp(home.pitch, -0.45, 0.45) }, t: 0, ms: 2100 };
  }
  _stepIntroEase(dt) {
    const e = this._introEase; e.t += dt * 1000;
    const k = easeInOut(clamp(e.t / e.ms, 0, 1));
    this.world.yaw = e.a.yaw + (e.b.yaw - e.a.yaw) * k;
    this.world.pitch = e.a.pitch + (e.b.pitch - e.a.pitch) * k;
    if (e.t >= e.ms) this._introEase = null;
  }

  /** Begin the walkthrough from the intro gate. */
  begin() {
    if (this.onBegin) { try { this.onBegin(); } catch {} }   // host applies Gallery mode + closes the chooser
    this._introEase = null;
    this._hide(this.el.intro);
    this.active = true; this.paused = false;
    this._restorePlayerEuler();
    this.el.bar.classList.add('show');
    this._renderDots();
    this.goto(0);
  }

  goto(i) {
    if (i < 0) i = 0;
    if (i >= this.stops.length) { this._finish(); return; }
    if (this.i >= 0 && this.stops[this.i]) this._sendHome(this.stops[this.i].asset);   // current piece returns home
    this.i = i;
    this._renderDots();
    this._hide(this.el.card);
    const stop = this.stops[i];
    // anchor + pan to face the artifact's HOME, then fly it to the viewer
    this._anchor = this.world.getAvatarPosition().clone();
    const eye = this._eye();
    const homeCenter = this._center(stop.asset.mesh);
    this.lookHome = lookAnglesTo(eye, homeCenter);
    this.devYaw = this.devPitch = 0; this._offT = 0;
    this._beginTween('pan', { yaw: this.world.yaw, pitch: this.world.pitch }, this.lookHome, 1100, () => {
      this._beginPresent(stop);
    });
    this.state = 'pan';
  }
  next() { if (this.active) this.goto(this.i + 1); }
  prev() { if (this.active) this.goto(this.i - 1); }
  togglePlay() { this.paused = !this.paused; this.el.play.textContent = this.paused ? '▶' : '❚❚'; }

  /** Drop the rails: hand control back to normal play. */
  exitToFreeRoam(silent) {
    this._allHome();
    this.active = false; this.state = 'idle'; this._tw = null; this._present = null; this._introEase = null;
    // Hand the look back to the navigator from EXACTLY where the tour left it — the tour
    // drove world.yaw/pitch directly, so without this the next nav frame would snap the
    // view back to the navigator's stale pre-tour orientation.
    if (this.nav) { this.nav.yaw = this.world.yaw; this.nav.pitch = this.world.pitch; this.nav.keys = {}; }
    this.el.bar.classList.remove('show');
    this._hide(this.el.card); this._hide(this.el.ret); this._hide(this.el.intro);
    if (!silent) this._showEnd();
  }

  // ── PUBLIC: per-frame hooks ───────────────────────────────────
  /** Mutate `intent` to drive the look (bounded gaze + curated pan). Call BEFORE world.step. */
  steer(intent, dt) {
    if (!this.active) return;
    if (this.state === 'stop' && !this.paused) {
      // bounded head/eye look — accumulate the user's steer, soft-clamp, spring back at rest
      const dyaw = (intent.yawDelta || 0) * this.gaze, dpitch = (intent.pitchDelta || 0) * this.gaze;
      const steering = Math.abs(dyaw) + Math.abs(dpitch) > 1e-4;
      if (steering) { this.devYaw += dyaw; this.devPitch += dpitch; this._idle = 0; }
      else { this._idle += dt; if (this._idle > this.recenterDelay) {
        this.devYaw = damp(this.devYaw, 0, this.recenterLambda, dt);
        this.devPitch = damp(this.devPitch, 0, this.recenterLambda, dt);
      } }
      this.devYaw = softClamp(this.devYaw, this.spanYaw);
      this.devPitch = softClamp(this.devPitch, this.spanPitch);
      intent.yaw = this.lookHome.yaw + this.devYaw;
      intent.pitch = clamp(this.lookHome.pitch + this.devPitch, -1.45, 1.45);
    } else {
      // transitions own the look completely
      intent.yaw = this.world.yaw; intent.pitch = this.world.pitch;
    }
    intent.yawDelta = 0; intent.pitchDelta = 0;
    // viewer stays planted during transitions; at a stop they MAY wander (runaway → return)
    if (this.state !== 'stop') { intent.forward = 0; intent.strafe = 0; }
  }

  /** Advance tweens + detect wander-off. Call AFTER world.step. */
  update(dt) {
    if (this._introEase) this._stepIntroEase(dt);   // runs while the intro gate is up (tour not yet active)
    if (!this.active) return;
    if (this._tw && !this.paused) this._stepTween(dt);
    if (this._present && !this.paused) this._stepPresent(dt);
    if (this.state === 'stop' && !this.paused) this._detectRunaway(dt);
  }

  destroy() { try { this.el.root.remove(); this.el.style.remove(); } catch {} }

  // ── transitions ──────────────────────────────────────────────
  _beginTween(kind, a, b, ms, onDone) {
    b = { yaw: a.yaw + shortAngle(b.yaw - a.yaw), pitch: b.pitch };   // shortest yaw path
    this._tw = { kind, a, b, t: 0, ms, onDone };
  }
  _stepTween(dt) {
    const tw = this._tw; tw.t += dt * 1000;
    const k = easeInOut(clamp(tw.t / tw.ms, 0, 1));
    this.world.yaw = tw.a.yaw + (tw.b.yaw - tw.a.yaw) * k;
    this.world.pitch = tw.a.pitch + (tw.b.pitch - tw.a.pitch) * k;
    if (tw.t >= tw.ms) { this.world.yaw = shortAngle(tw.b.yaw); this.world.pitch = tw.b.pitch; this._tw = null; tw.onDone && tw.onDone(); }
  }

  _beginPresent(stop) {
    this.state = 'present';
    const m = stop.asset.mesh;
    if (!this._homes.has(stop.asset.id)) this._homes.set(stop.asset.id, { pos: m.position.clone(), quat: m.quaternion.clone(), scale: m.scale.clone() });
    const eye = this._eye();
    const fwd = dirFromAngles(this.lookHome.yaw, -0.06);            // read pose, slightly below eye line
    const reach = 1.55;
    const targetCenter = eye.clone().add(fwd.multiplyScalar(reach));
    // scale so the longest dimension reads ~0.95 m
    const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const f = clamp(0.95 / longest, 0.2, 6);
    const toScale = m.scale.clone().multiplyScalar(f);   // mesh is at its home transform when present begins
    // Turn the model's FRONT (+Z) toward the viewer. lookAt(eye→target) makes -Z point from
    // the viewer to the object, i.e. +Z faces the viewer — so the face (not the back) reads.
    const lookM = new THREE.Matrix4().lookAt(eye, targetCenter, new THREE.Vector3(0, 1, 0));
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(lookM);
    // position origin so the object's CENTER lands at targetCenter (account for origin→center offset)
    const center0 = this._center(m);
    const offset = center0.clone().sub(m.position);
    const toPos = targetCenter.clone().sub(offset.multiplyScalar(f));
    this._present = { asset: stop.asset, t: 0, ms: 1700,
      fromPos: m.position.clone(), toPos, fromQuat: m.quaternion.clone(), toQuat,
      fromScale: m.scale.clone(), toScale };
    // lock lookHome to the read pose; card appears as it settles
    this.lookHome = lookAnglesTo(eye, targetCenter);
    setTimeout(() => { if (this.state === 'present' || this.state === 'stop') this._showCard(stop); }, 650);
  }
  _stepPresent(dt) {
    const p = this._present; p.t += dt * 1000;
    const k = easeInOut(clamp(p.t / p.ms, 0, 1));
    const m = p.asset.mesh;
    m.position.lerpVectors(p.fromPos, p.toPos, k);
    m.quaternion.slerpQuaternions(p.fromQuat, p.toQuat, k);
    m.scale.lerpVectors(p.fromScale, p.toScale, k);
    if (p.t >= p.ms) { this.state = 'stop'; this._idle = 0; this._present = null; }   // hand to bounded look
  }
  /** Snap a presented artifact back to its saved home transform (the world never changes). */
  _sendHome(asset) {
    const h = this._homes.get(asset.id); if (!h) return;
    const m = asset.mesh; m.position.copy(h.pos); m.quaternion.copy(h.quat); m.scale.copy(h.scale);
    this._homes.delete(asset.id);
    if (this._present && this._present.asset === asset) this._present = null;
  }
  _allHome() { for (const s of this.stops) this._sendHome(s.asset); }

  _detectRunaway(dt) {
    const eye = this._eye();
    const dist = this._anchor ? this.world.getAvatarPosition().distanceTo(this._anchor) : 0;
    const off = Math.abs(this.devYaw) > this.runawayYaw || dist > this.runawayDist;
    if (off) { this._offT += dt * 1000; if (this._offT > this.RUNAWAY_MS && !this.el.ret.classList.contains('show')) this._showReturn(); }
    else { this._offT = Math.max(0, this._offT - dt * 1500); }
  }
  _returnToTour() {
    this._hide(this.el.ret); this._offT = 0;
    if (this._anchor) this.world.teleportTo(this._anchor.x, this._anchor.y, this._anchor.z);
    this.devYaw = this.devPitch = 0;
    // re-aim onto the read pose
    this._beginTween('pan', { yaw: this.world.yaw, pitch: this.world.pitch }, this.lookHome, 700, () => { this.state = 'stop'; this._idle = 0; });
    this.state = 'pan';
  }

  _finish() {
    this._allHome();
    this.i = this.stops.length;
    this._hide(this.el.card); this.el.bar.classList.remove('show');
    this._showOutro();
  }

  // ── helpers ──
  _eye() { const p = this.world.getAvatarPosition(); p.y = this.world.playerBody.translation().y + (this.world.cfg.eyeHeight || 1.5); return p; }
  _center(mesh) { return new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()); }
  _restorePlayerEuler() { /* keep current yaw/pitch as tween start */ }

  // ── DOM / styling (self-contained so it drops into any world) ──
  _injectCSS() {
    const css = `
    #curRoot{position:fixed;inset:0;z-index:60;pointer-events:none;font-family:'Space Grotesk',system-ui,sans-serif;color:#d7ecdd}
    #curRoot .pe{pointer-events:auto}
    .cur-gate{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:4vmin;
      background:radial-gradient(120% 120% at 50% 40%,rgba(4,9,6,.62),rgba(4,7,10,.86))}
    .cur-gate.show{display:flex;animation:curFade .5s ease}
    .cur-panel{pointer-events:auto;max-width:760px;width:100%;background:rgba(6,14,10,.62);border:1px solid rgba(73,231,134,.35);
      border-radius:18px;padding:34px 40px;backdrop-filter:blur(10px);box-shadow:0 0 60px rgba(57,255,90,.12)}
    .cur-k{font-size:12.5px;letter-spacing:.32em;text-transform:uppercase;color:${NEON};margin-bottom:12px}
    .cur-h{font-size:clamp(34px,6vw,62px);font-weight:700;line-height:1.02;color:#eafff1;text-shadow:0 0 22px rgba(93,255,155,.4);margin:0 0 14px}
    .cur-lede{font-size:clamp(15px,2.4vw,20px);color:${NEON};margin:0 0 18px}
    .cur-b{font-size:15.5px;line-height:1.62;color:#cfe6d7;margin:0 0 12px}
    .cur-b b{color:${NEON};font-weight:600}
    .cur-cta{display:inline-flex;gap:10px;margin-top:14px}
    .cur-btn{pointer-events:auto;background:linear-gradient(135deg,#3ddc74,#21b85f);border:none;color:#02110a;font-weight:700;
      border-radius:11px;padding:14px 26px;font-family:inherit;font-size:15px;cursor:pointer;box-shadow:0 0 22px rgba(57,255,90,.35)}
    .cur-btn:hover{filter:brightness(1.08)}
    .cur-btn.ghost{background:rgba(12,30,22,.7);border:1px solid rgba(73,231,134,.4);color:#9fe6bd;box-shadow:none}
    /* curator card — docked, transparent, never fully blocks the piece */
    .cur-card{position:absolute;right:26px;top:50%;transform:translateY(-50%);width:min(360px,40vw);display:none;
      background:rgba(6,14,10,.5);border:1px solid rgba(73,231,134,.4);border-radius:15px;padding:20px 22px;backdrop-filter:blur(9px)}
    .cur-card.show{display:block;animation:curRise .45s ease}
    .cur-card .cur-h{font-size:24px;margin-bottom:8px}
    .cur-card .cur-b{font-size:13.5px}
    /* video-like control bar */
    .cur-bar{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:14px;
      background:rgba(6,14,10,.66);border:1px solid rgba(73,231,134,.34);border-radius:13px;padding:9px 14px;backdrop-filter:blur(9px)}
    .cur-bar.show{display:flex}
    .cur-bar button{pointer-events:auto;background:rgba(73,231,134,.1);border:1px solid rgba(73,231,134,.32);color:#bff5d2;
      width:38px;height:34px;border-radius:9px;cursor:pointer;font-size:14px;font-family:inherit}
    .cur-bar button:hover{background:rgba(73,231,134,.22);color:${NEON}}
    .cur-title{font-size:12.5px;color:#bff5d2;min-width:120px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
    .cur-dots{display:flex;gap:6px}
    .cur-dots i{width:8px;height:8px;border-radius:50%;background:rgba(73,231,134,.3);display:block}
    .cur-dots i.on{background:${NEON};box-shadow:0 0 8px ${NEON}}
    .cur-exit{pointer-events:auto;background:none;border:1px solid rgba(73,231,134,.3);color:#9fe6bd;border-radius:9px;
      padding:6px 11px;cursor:pointer;font-size:11px;font-family:inherit}
    /* return-to-tour + end prompts */
    .cur-toast{position:absolute;left:50%;top:40px;transform:translateX(-50%);display:none;align-items:center;gap:12px;
      background:rgba(6,14,10,.8);border:1px solid rgba(73,231,134,.45);border-radius:12px;padding:12px 16px;backdrop-filter:blur(9px)}
    .cur-toast.show{display:flex;animation:curRise .35s ease}
    .cur-toast span{font-size:13px;color:#dff6e6}
    @keyframes curFade{from{opacity:0}to{opacity:1}}
    @keyframes curRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    @media(max-width:640px){.cur-card{right:12px;left:12px;width:auto;top:auto;bottom:84px;transform:none}}
    `;
    const s = document.createElement('style'); s.id = 'curStyle'; s.textContent = css; document.head.appendChild(s);
    this.el = { style: s };
  }
  _buildDOM() {
    const root = document.createElement('div'); root.id = 'curRoot';
    root.innerHTML = `
      <div class="cur-gate" id="curIntro"></div>
      <div class="cur-card" id="curCard"></div>
      <div class="cur-bar" id="curBar">
        <button id="curPrev" title="previous">◂</button>
        <button id="curPlay" title="play / pause">❚❚</button>
        <button id="curNext" title="next">▸</button>
        <span class="cur-dots" id="curDots"></span>
        <span class="cur-title" id="curBarTitle"></span>
        <button class="cur-exit" id="curExit" title="leave the tour">⏏ free roam</button>
      </div>
      <div class="cur-toast" id="curReturn"><span>You’ve wandered off the path.</span>
        <button class="cur-btn ghost" id="curReturnBtn">Return to tour</button></div>`;
    document.body.appendChild(root);
    const $ = id => root.querySelector('#' + id);
    Object.assign(this.el, { root, intro: $('curIntro'), card: $('curCard'), bar: $('curBar'),
      dots: $('curDots'), barTitle: $('curBarTitle'), ret: $('curReturn'),
      play: $('curPlay') });
    $('curPrev').onclick = () => this.prev();
    $('curNext').onclick = () => this.next();
    $('curPlay').onclick = () => this.togglePlay();
    $('curExit').onclick = () => this.exitToFreeRoam();
    $('curReturnBtn').onclick = () => this._returnToTour();
    // keyboard parity (accessibility): arrows / space / esc
    this._onKey = (e) => {
      if (!this.active && this.el.intro.classList.contains('show') && (e.key === 'Enter')) { this.begin(); return; }
      if (!this.active) return;
      if (e.key === 'ArrowRight') this.next();
      else if (e.key === 'ArrowLeft') this.prev();
      else if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'Escape') this.exitToFreeRoam();
    };
    window.addEventListener('keydown', this._onKey);
  }
  _hide(el) { el.classList.remove('show'); el.style.display = ''; }
  _show(el) { el.classList.add('show'); }

  _showIntro() {
    this.el.intro.innerHTML = `<div class="cur-panel pe">
      <div class="cur-k">${INTRO.kicker}</div>
      <h1 class="cur-h">${INTRO.title}</h1>
      <div class="cur-lede">${INTRO.lede}</div>
      ${INTRO.paras.map(p => `<p class="cur-b">${p}</p>`).join('')}
      <div class="cur-cta"><button class="cur-btn" id="curBegin">▶ Begin guided tour</button>
        <button class="cur-btn ghost" id="curSkip">Free roam instead</button></div></div>`;
    this.el.intro.querySelector('#curBegin').onclick = () => this.begin();
    this.el.intro.querySelector('#curSkip').onclick = () => { if (this.onSkip) { try { this.onSkip(); } catch {} } this.exitToFreeRoam(true); };
    this._show(this.el.intro);
  }
  _showCard(stop) {
    this.el.card.innerHTML = `<div class="cur-k">${stop.kicker}</div>
      <h2 class="cur-h">${stop.title}</h2><p class="cur-b">${stop.body}</p>`;
    this._show(this.el.card);
    this.el.barTitle.textContent = stop.title;
  }
  _showReturn() { this._show(this.el.ret); }
  _showOutro() {
    this.el.intro.innerHTML = `<div class="cur-panel pe">
      <div class="cur-k">${OUTRO.kicker}</div><h1 class="cur-h">${OUTRO.title}</h1>
      <p class="cur-b">${OUTRO.body}</p>
      <div class="cur-cta"><button class="cur-btn" id="curRoam">Explore freely →</button>
        <button class="cur-btn ghost" id="curReplay">Replay tour</button></div></div>`;
    this.el.intro.querySelector('#curRoam').onclick = () => this.exitToFreeRoam(true);
    this.el.intro.querySelector('#curReplay').onclick = () => { this._hide(this.el.intro); this.begin(); };
    this._show(this.el.intro);
  }
  _showEnd() {
    this.el.intro.innerHTML = `<div class="cur-panel pe" style="max-width:520px;text-align:center">
      <h1 class="cur-h" style="font-size:34px">The space is yours</h1>
      <p class="cur-b">Walk, look, and handle the gallery freely — WASD / drag to look / grab with your hands.</p>
      <div class="cur-cta" style="justify-content:center"><button class="cur-btn" id="curGo">Explore →</button></div></div>`;
    this.el.intro.querySelector('#curGo').onclick = () => this._hide(this.el.intro);
    this._show(this.el.intro);
  }
  _renderDots() {
    this.el.dots.innerHTML = this.stops.map((_, k) => `<i class="${k === this.i ? 'on' : ''}"></i>`).join('');
  }
}

export default CurationTour;
