/**
 * hopeOS SDK — Games · RhythmGame  (Moon-Rider-style, hand-driven)
 * ═══════════════════════════════════════════════════════════════
 * Notes fly toward the planted player on a rail, timed to a beatmap. You SLICE them
 * with your tracked hands (the holo-hand fingertips are the blade) — no controllers,
 * no headset, just the webcam tracking hopeOS already runs. Adapts the Moon Rider /
 * Beat-Saber mechanic (supermedium/moonrider) to MediaPipe hands instead of WebXR:
 *   • beat clock        — audio track time, or a procedural metronome clock
 *   • rail spawn        — notes appear at spawnDist and approach the strike plane on-beat
 *   • slice detection   — hand blade segment ∩ note sphere, gated on hand speed
 *   • bombs             — slicing one breaks your combo (don't touch)
 *   • keyboard parity   — lane keys (a/s/d/f/g) slice without a camera (accessibility)
 *
 * The whole game is described by a portable spec (spec.js) so the agent can author it
 * and it publishes with the world.
 */
import * as THREE from 'three';
import { GameSession, NEON, clamp, distPointSegment } from './session.js';
import { normalizeRhythm } from './spec.js';
import { MusicEngine } from './music.js';
import { makeHoloNote, makeBomb, disposeObj } from './scenery.js';

const LANE_COLORS = [0x39ff5a, 0x36c6ff, 0xffd84a, 0xff6ad5, 0xff8a3d];

export class RhythmGame extends GameSession {
  constructor(opts) {
    super(opts);
    this.laneGap = 0.5; this.rowGap = 0.45; this.baseY = -0.12;   // play-field layout (m, relative to eye)
    this.t = 0; this._spawnI = 0; this.notes = [];                // notes = live meshes in flight
    this._music = null; this._ac = null;
  }

  introCopy() {
    const cam = this.hope && this.hope.tracking ? '' : '';
    return { kicker: 'HOPEOS ARCADE · RHYTHM', title: this.spec?.title || 'Neon Run',
      lede: 'Slice the notes in time with your hands.',
      how: [
        'Notes fly toward you — <b>slice</b> them with either hand as they reach the ring.',
        'Build a <b>combo</b> for a bigger multiplier; a miss resets it.',
        '<b>Red bombs</b> — don’t touch them.',
        'No camera? Use lane keys <b>A S D F G</b>. Turn your head to look around; <b>Esc</b> to quit.',
      ] };
  }

  // ── field ──
  buildField() {
    this.spec = normalizeRhythm(this.spec || {});
    this.t = 0; this._spawnI = 0; this.total = this.spec.notes.length;
    this._startClock();
    this._buildGuides();
  }
  teardownField() { this.notes = []; this._stopClock(); }

  /** Strike ring + lane guides — rebuilt each frame so they track the eye/look. */
  _buildGuides() {
    const { lanes, rows } = this.spec.grid;
    this._ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 8, 40),
      new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.55 }));
    this.group.add(this._ring);
    this._slots = [];
    for (let l = 0; l < lanes; l++) for (let r = 0; r < rows; r++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(this.laneGap * 0.8, this.laneGap * 0.8),
        new THREE.MeshBasicMaterial({ color: LANE_COLORS[l % LANE_COLORS.length], transparent: true, opacity: 0.07, side: THREE.DoubleSide }));
      m.userData = { lane: l, row: r }; this.group.add(m); this._slots.push(m);
    }
  }

  _laneX(lane) { return (lane - (this.spec.grid.lanes - 1) / 2) * this.laneGap; }
  _rowY(row) { return this.baseY + row * this.rowGap; }
  /** World position of a note at depth d (m in front of the eye), given its lane/row. */
  _posFor(lane, row, d, basis, eye) {
    return eye.clone().addScaledVector(basis.f, d).addScaledVector(basis.right, this._laneX(lane)).addScaledVector(basis.up, this._rowY(row));
  }

  _spawnNote(n) {
    const lit = LANE_COLORS[n.lane % LANE_COLORS.length];
    const size = this.spec.tuning.noteSize;
    const mesh = n.kind === 'bomb' ? makeBomb(size) : makeHoloNote(size, lit);   // holographic crystal / spiky bomb
    mesh.userData.note = n; mesh.userData.hit = false; mesh.userData.missed = false;
    this.scenery.registerHolo(mesh.userData.holo);                                // pulse its scanlines each frame
    this.group.add(mesh); this.notes.push(mesh);
  }

  // ── per-frame gameplay ──
  tick(dt, blades) {
    this.t = this._clockTime();
    const tn = this.spec.tuning, eye = this.eye(), basis = this.fieldBasis();
    // keep the ring + lane guides locked in front of the eye
    if (this._ring) { this._ring.position.copy(eye.clone().addScaledVector(basis.f, tn.strikeDist).addScaledVector(basis.up, this.baseY + this.rowGap * 0.5));
      this._ring.quaternion.copy(this.hope.camera.quaternion); }
    for (const s of this._slots) s.position.copy(this._posFor(s.userData.lane, s.userData.row, tn.strikeDist, basis, eye)).addScaledVector(basis.f, 0.02), s.quaternion.copy(this.hope.camera.quaternion);

    // spawn notes whose lead time has arrived
    const lead = (tn.spawnDist - tn.strikeDist) / tn.approach;
    while (this._spawnI < this.spec.notes.length && this.spec.notes[this._spawnI].t - this.t <= lead) {
      this._spawnNote(this.spec.notes[this._spawnI]); this._spawnI++;
    }

    // advance, detect slices + misses
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const mesh = this.notes[i], n = mesh.userData.note;
      const d = tn.strikeDist + (n.t - this.t) * tn.approach;
      mesh.position.copy(this._posFor(n.lane, n.row, d, basis, eye));
      mesh.rotation.y += dt * 1.6; mesh.rotation.x += dt * 0.8;

      if (!mesh.userData.hit && !mesh.userData.missed && Math.abs(d - tn.strikeDist) <= tn.hitWindow) {
        const r = (n.kind === 'bomb' ? this.spec.tuning.noteSize * 0.62 : this.spec.tuning.noteSize) + tn.bladeRadius;
        for (const b of blades) {
          if (b.speed < tn.minSliceSpeed) continue;
          if (distPointSegment(mesh.position, b.prev, b.tip) < r) { this._resolveSlice(mesh); break; }
        }
      }
      // passed the strike plane unhit
      if (!mesh.userData.hit && !mesh.userData.missed && d < tn.strikeDist - tn.hitWindow) {
        if (n.kind !== 'bomb') { mesh.userData.missed = true; this.addMiss(); }
        this._retire(mesh, i, false); continue;
      }
      // fully past → remove
      if (d < tn.strikeDist - 0.9) this._retire(mesh, i, false);
    }

    // done when the map is exhausted and nothing is in flight
    if (this._spawnI >= this.spec.notes.length && !this.notes.length && this.t > this._lastT() + 0.3) this.finish();
  }

  _resolveSlice(mesh) {
    const n = mesh.userData.note;
    if (n.kind === 'bomb') { mesh.userData.hit = true; this.addMiss(); this._blip(110, 0.18, 'saw'); this._burst(mesh.position, 0xff2436); this._retire(mesh, this.notes.indexOf(mesh)); return; }
    mesh.userData.hit = true; this.addHit(100); this._blip(660 + Math.min(this.combo, 8) * 40, 0.09, 'triangle');
    this._burst(mesh.position, mesh.userData.color); this._retire(mesh, this.notes.indexOf(mesh));
  }
  _retire(mesh, idx) {
    if (idx >= 0) this.notes.splice(idx, 1);
    this.scenery.unregisterHolo(mesh.userData.holo);
    this.group.remove(mesh); disposeObj(mesh);
  }
  _burst(pos, color) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    g.position.copy(pos); this.group.add(g);
    const t0 = performance.now();
    const grow = () => { const k = (performance.now() - t0) / 260; if (k >= 1 || !g.parent) { this.group.remove(g); g.geometry.dispose(); g.material.dispose(); return; }
      g.scale.setScalar(1 + k * 6); g.material.opacity = 0.9 * (1 - k); requestAnimationFrame(grow); };
    requestAnimationFrame(grow);
  }

  // keyboard parity — slice the nearest live note in a lane without a camera
  onKey(e) {
    const map = ['a', 's', 'd', 'f', 'g']; const lane = map.indexOf((e.key || '').toLowerCase());
    if (lane < 0 || lane >= this.spec.grid.lanes) return;
    const tn = this.spec.tuning; let best = null, bestErr = Infinity;
    for (const mesh of this.notes) { const n = mesh.userData.note; if (mesh.userData.hit || n.lane !== lane) continue;
      const d = tn.strikeDist + (n.t - this.t) * tn.approach; const err = Math.abs(d - tn.strikeDist);
      if (err < bestErr) { bestErr = err; best = mesh; } }
    if (best && bestErr <= tn.hitWindow * 2.2) this._resolveSlice(best);
  }

  progress() { return this.spec ? clamp(this.t / this.spec.duration, 0, 1) : 0; }
  _lastT() { const a = this.spec.notes; return a.length ? a[a.length - 1].t : this.spec.duration; }

  // ── clock (the MusicEngine IS the beat clock — synth track or audioUrl) ──
  // The game reads music.time, and the MusicEngine schedules the song against the
  // same AudioContext, so notes and music never drift. If audio can't start, time
  // falls back to a wall clock so the game is still playable in silence.
  _startClock() {
    this._t0 = performance.now();
    try { this._ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    if (this._ac) {
      try {
        this._music = new MusicEngine(this._ac, {
          bpm: this.spec.bpm, seed: hashSeed(this.spec.title || 'hopeOS'),
          url: this.spec.audioUrl || null, volume: 0.42,
        });
        this._music.start();
      } catch { this._music = null; }
    }
  }
  _stopClock() { try { this._music && this._music.stop(); } catch {} this._music = null; try { this._ac && this._ac.close(); } catch {} this._ac = null; }
  _clockTime() { return this._music && this._music.playing ? this._music.time : (performance.now() - this._t0) / 1000; }
  /** Tiny WebAudio blip for hit/miss feedback (no asset needed). */
  _blip(freq, dur, type = 'sine') {
    if (!this._ac) return;
    try { const o = this._ac.createOscillator(), g = this._ac.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = 0.0001;
      o.connect(g); g.connect(this._ac.destination); const t = this._ac.currentTime;
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02); } catch {}
  }
}

// deterministic title → seed so a track's synth song is reproducible (matches spec.js)
function hashSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export default RhythmGame;
