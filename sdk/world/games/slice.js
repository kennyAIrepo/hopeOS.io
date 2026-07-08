/**
 * hopeOS SDK — Games · SliceGame  (Fruit-Ninja-style, hand-driven)
 * ═══════════════════════════════════════════════════════════════
 * Fruit are launched on arcs that FLY TOWARD the planted player; you slice them
 * with your tracked hands — the holo-hand fingertips are the blade. Bombs cost you
 * a combo. Adapts the Fruit-Ninja-Kinect mechanic (no public source — rebuilt from
 * the mechanic) to MediaPipe hands instead of a depth camera, and the
 * collidingScopes/fruit-ninja MediaPipe reference to hopeOS's existing hand stack:
 *   • physics       — each fruit is a ballistic arc (launch velocity + gravity)
 *   • slice detect   — hand blade segment ∩ fruit sphere, gated on hand speed
 *   • bombs          — slicing one breaks your combo (steer your blade around them)
 *   • drops          — fruit that fall past you unsliced reset the combo
 *   • keyboard parity — a reticle blade you sweep with arrow keys / H J K L (accessibility)
 *
 * Shares the GameSession template (planted bounded-look, HUD, scoring) and the
 * MusicEngine, so it spawns to a beat and plays to the same synth track as Rhythm.
 */
import * as THREE from 'three';
import { GameSession, NEON, clamp, distPointSegment } from './session.js';
import { normalizeSlice } from './spec.js';
import { MusicEngine } from './music.js';

const FRUIT = [
  { color: 0x39ff5a, emissive: 0x1f7a35 },   // lime
  { color: 0xff6ad5, emissive: 0x7a2a5c },   // dragonfruit
  { color: 0xffd84a, emissive: 0x7a6112 },   // lemon
  { color: 0x36c6ff, emissive: 0x155a7a },   // blueberry
  { color: 0xff8a3d, emissive: 0x7a3a12 },   // orange
];
const GRAV = new THREE.Vector3(0, -1, 0);

export class SliceGame extends GameSession {
  constructor(opts) {
    super(opts);
    this.fruits = [];                 // live fruit/bomb meshes in flight
    this.t = 0; this._lastBeat = -1; this._seedState = 1;
    this._music = null; this._ac = null;
    // keyboard reticle blade — a swept point in the field plane (right/up metres)
    this._ret = { x: 0, y: 0, tx: 0, ty: 0, prev: null, tip: null, speed: 0, active: false, mesh: null };
    this.spanYaw = 0.6; this.spanPitch = 0.36;
  }

  introCopy() {
    return { kicker: 'HOPEOS ARCADE · SLICE', title: this.spec?.title || 'Hand Ninja',
      lede: 'Slice the fruit flying at you — dodge the bombs.',
      how: [
        'Fruit arc toward you — <b>swipe through them</b> with either hand to slice.',
        'Chain slices for a bigger <b>combo</b>; a dropped fruit resets it.',
        '<b>Red bombs</b> — do NOT slice them; sweep your blade around.',
        'No camera? Move the reticle with <b>arrow keys / H J K L</b>. <b>Esc</b> to quit.',
      ] };
  }

  // ── field ──
  buildField() {
    this.spec = normalizeSlice(this.spec || {});
    this.t = 0; this._lastBeat = -1; this.total = 0;
    this._seedState = (this.spec.seed >>> 0) || 1;
    this._startClock();
    this._buildReticle();
  }
  teardownField() { this.fruits = []; this._stopClock(); }

  _rnd() { this._seedState = (this._seedState * 1664525 + 1013904223) >>> 0; return this._seedState / 4294967296; }

  _buildReticle() {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.12, 24),
      new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.0, side: THREE.DoubleSide }));
    this.group.add(m); this._ret.mesh = m;
    this._ret.x = this._ret.tx = 0; this._ret.y = this._ret.ty = 0; this._ret.prev = this._ret.tip = null;
  }

  // ── spawning (BEAT-SYNCED) ──
  // Fruit launch ON the beat so the action locks to the synth track: early on, a
  // wave every other beat; as the round ramps up, one on every beat. The MusicEngine
  // shares the clock, so a launch and a kick-drum land together.
  _maybeSpawnOnBeat(beatIndex) {
    if (beatIndex < 2) return;                                 // a 2-beat count-in
    const ramp = clamp(this.t / Math.max(1, this.spec.duration * 0.55), 0, 1);
    const step = ramp < 0.45 ? 2 : 1;                          // every 2nd beat → every beat
    if (beatIndex % step !== 0) return;
    this._spawnWave(ramp);
  }
  _spawnWave(ramp) {
    const tn = this.spec.tuning;
    const n = 1 + Math.floor(this._rnd() * (1 + ramp * (tn.burst - 1) + 0.001));
    for (let k = 0; k < n; k++) {
      const isBomb = this._rnd() < tn.bombRate;
      const x = (this._rnd() * 2 - 1) * tn.spread;             // launch fan across the field
      const lateral = -x * 0.55 + (this._rnd() * 2 - 1) * 0.4; // arc back toward centre, with spice
      this._spawnFruit(x, lateral, isBomb);
    }
  }

  _spawnFruit(launchX, lateral, isBomb) {
    const tn = this.spec.tuning, eye = this.eye(), basis = this.fieldBasis();
    const f = basis.f, right = basis.right, up = basis.up;
    // origin: down low, out in front, fanned left/right
    const p = eye.clone().addScaledVector(f, tn.spawnDist).addScaledVector(right, launchX).addScaledVector(up, -1.3);
    // velocity: in toward the eye, kicked upward, with a lateral curve — a real arc
    const v = new THREE.Vector3()
      .addScaledVector(f, -tn.approach)
      .addScaledVector(up, tn.launchUp)
      .addScaledVector(right, lateral);
    let mesh;
    if (isBomb) {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(tn.fruitSize * 0.85, 0),
        new THREE.MeshStandardMaterial({ color: 0x2a0406, emissive: 0xff2436, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.3 }));
    } else {
      const c = FRUIT[(this._rnd() * FRUIT.length) | 0];
      mesh = new THREE.Mesh(new THREE.SphereGeometry(tn.fruitSize, 18, 14),
        new THREE.MeshStandardMaterial({ color: c.color, emissive: c.emissive, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.1 }));
    }
    mesh.position.copy(p);
    mesh.userData = { vel: v, bomb: isBomb, sliced: false, spin: new THREE.Vector3(this._rnd() * 2, this._rnd() * 3, this._rnd()) };
    this.group.add(mesh); this.fruits.push(mesh); this.total++;
  }

  // ── per-frame gameplay ──
  tick(dt, blades) {
    this.t = this._clockTime();
    const tn = this.spec.tuning, eye = this.eye(), basis = this.fieldBasis();
    const all = this._withReticle(blades, dt, basis, eye);   // hand blades + keyboard reticle blade

    // spawn on every beat boundary crossed since last frame (beat-synced launches)
    const beat = 60 / this.spec.bpm, b = Math.floor(this.t / beat);
    if (b > this._lastBeat) { for (let k = this._lastBeat + 1; k <= b; k++) if (this.t < this.spec.duration) this._maybeSpawnOnBeat(k); this._lastBeat = b; }

    for (let i = this.fruits.length - 1; i >= 0; i--) {
      const m = this.fruits[i], u = m.userData;
      // integrate ballistic arc
      u.vel.addScaledVector(GRAV, tn.gravity * dt);
      m.position.addScaledVector(u.vel, dt);
      m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; m.rotation.z += u.spin.z * dt;

      if (!u.sliced) {
        const r = (u.bomb ? tn.fruitSize * 0.85 : tn.fruitSize) + tn.bladeRadius;
        for (const b of all) {
          if (b.speed < tn.minSliceSpeed) continue;
          if (distPointSegment(m.position, b.prev, b.tip) < r) { this._resolveSlice(m, i); break; }
        }
      }
      if (this.fruits[i] !== m) continue;   // was retired by the slice above

      // dropped / passed the player
      const depth = m.position.clone().sub(eye).dot(basis.f);   // +ve = in front
      const below = m.position.y < eye.y - 2.6;
      if (depth < -0.6 || below) {
        if (!u.bomb && !u.sliced) this.addMiss();   // a fruit you let drop costs the combo
        this._retire(m, i);
      }
    }

    if (this.t >= this.spec.duration && !this.fruits.length) this.finish();
  }

  _resolveSlice(m, idx) {
    const u = m.userData;
    if (u.bomb) { u.sliced = true; this.addMiss(); this._blip(96, 0.22, 'sawtooth'); this._burst(m.position, 0xff2436, 1.6); this._flashHurt(); this._retire(m, idx); return; }
    u.sliced = true; this.addHit(120); this._blip(540 + Math.min(this.combo, 8) * 44, 0.08, 'triangle');
    this._burst(m.position, m.material.color.getHex(), 1.0); this._retire(m, idx);
  }
  _retire(m, idx) {
    const i = idx != null && this.fruits[idx] === m ? idx : this.fruits.indexOf(m);
    if (i >= 0) this.fruits.splice(i, 1);
    this.group.remove(m); m.geometry.dispose(); m.material.dispose();
  }

  // ── reticle blade (keyboard parity) ──
  // Build a blade from the eased reticle so taps/holds produce a swept segment with
  // real speed, and slot it alongside the live hand blades for collision.
  _withReticle(blades, dt, basis, eye) {
    const ret = this._ret, tn = this.spec.tuning;
    ret.x = ret.x + (ret.tx - ret.x) * Math.min(1, dt * 14);
    ret.y = ret.y + (ret.ty - ret.y) * Math.min(1, dt * 14);
    const here = eye.clone().addScaledVector(basis.f, tn.spawnDist * 0.42)
      .addScaledVector(basis.right, ret.x).addScaledVector(basis.up, ret.y + 0.1);
    ret.prev = ret.tip ? ret.tip.clone() : here.clone();
    ret.tip = here;
    ret.speed = dt > 0 ? ret.prev.distanceTo(ret.tip) / dt : 0;
    if (ret.mesh) {
      ret.mesh.position.copy(here); ret.mesh.quaternion.copy(this.hope.camera.quaternion);
      ret.mesh.material.opacity = ret.active ? 0.85 : 0.0;   // only show when keys are driving it
    }
    return ret.active ? blades.concat([ret]) : blades;
  }

  // keyboard parity — nudge the reticle target; movement speed does the slicing
  onKey(e) {
    const k = (e.key || '').toLowerCase(); const tn = this.spec.tuning; const step = 0.55;
    const map = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1],
      h: [-1, 0], l: [1, 0], k: [0, 1], j: [0, -1] };
    const d = map[k]; if (!d) return;
    this._ret.active = true;
    this._ret.tx = clamp(this._ret.tx + d[0] * step, -tn.spread - 0.6, tn.spread + 0.6);
    this._ret.ty = clamp(this._ret.ty + d[1] * step, -1.4, 1.8);
    e.preventDefault?.();
  }

  _flashHurt() {
    try { const r = this.el.root; r.style.transition = 'none'; r.style.boxShadow = 'inset 0 0 120px rgba(255,40,60,.5)';
      requestAnimationFrame(() => { r.style.transition = 'box-shadow .5s ease'; r.style.boxShadow = 'inset 0 0 0 rgba(0,0,0,0)'; }); } catch {}
  }
  _burst(pos, color, scale = 1) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    g.position.copy(pos); this.group.add(g);
    const t0 = performance.now();
    const grow = () => { const k = (performance.now() - t0) / 280; if (k >= 1 || !g.parent) { this.group.remove(g); g.geometry.dispose(); g.material.dispose(); return; }
      g.scale.setScalar(1 + k * 7 * scale); g.material.opacity = 0.9 * (1 - k); requestAnimationFrame(grow); };
    requestAnimationFrame(grow);
  }

  progress() { return this.spec ? clamp(this.t / this.spec.duration, 0, 1) : 0; }

  // ── clock / music (shared with RhythmGame) ──
  _startClock() {
    this._t0 = performance.now();
    try { this._ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    if (this._ac) {
      try { this._music = new MusicEngine(this._ac, { bpm: this.spec.bpm, seed: this.spec.seed, url: this.spec.audioUrl || null, volume: 0.4 }); this._music.start(); }
      catch { this._music = null; }
    }
  }
  _stopClock() { try { this._music && this._music.stop(); } catch {} this._music = null; try { this._ac && this._ac.close(); } catch {} this._ac = null; }
  _clockTime() { return this._music && this._music.playing ? this._music.time : (performance.now() - this._t0) / 1000; }
  _blip(freq, dur, type = 'sine') {
    if (!this._ac) return;
    try { const o = this._ac.createOscillator(), g = this._ac.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = 0.0001;
      o.connect(g); g.connect(this._ac.destination); const t = this._ac.currentTime;
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02); } catch {}
  }
}

export default SliceGame;
