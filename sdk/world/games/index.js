/**
 * hopeOS SDK — Games · Hub
 * ═══════════════════════════════════════════════════════════════
 * The single handle the host (world.html) and the WorldAgent talk to. Owns the
 * registry of game types and the one active session, and forwards the two
 * per-frame hooks. Mirrors how `tour` is wired for curation — additive, so a world
 * with no game simply never calls it.
 *
 *   const games = new GamesHub({ world, nav, hope, THREE,
 *                                onBegin, onExit });   // host mode hooks
 *   games.start('rhythm', spec);          // shows the "how to play" gate, then play
 *   games.startNow('rhythm', spec);       // skip the gate (agent: "start it now")
 *   if (games.active) games.steer(intent, dt);   // BEFORE world.step
 *   games.update(dt, { right, left });           // AFTER hand resolve
 *
 * New game types (slice.js …) register here; the chooser + agent pick them up for free.
 */
import { RhythmGame } from './rhythm.js';
import { SliceGame } from './slice.js';
import { normalizeRhythm, normalizeSlice } from './spec.js';

const REGISTRY = {
  rhythm: { ctor: RhythmGame, label: 'Rhythm', icon: '🎵',
    blurb: 'Slice neon notes in time with your hands — a Moon-Rider-style run.',
    normalize: normalizeRhythm },
  slice: { ctor: SliceGame, label: 'Slice', icon: '🍉',
    blurb: 'Fruit fly at you — swipe to slice, dodge the bombs. A Fruit-Ninja-style round.',
    normalize: normalizeSlice },
};

export class GamesHub {
  constructor(ctx) { this.ctx = ctx; this.onBegin = ctx.onBegin || null; this.onExit = ctx.onExit || null; this.session = null; this.activeType = null; }

  get active() { return !!(this.session && this.session.active); }
  get busy() { return !!(this.session && (this.session.active || this.session.state === 'intro' || this.session.state === 'done')); }
  types() { return Object.entries(REGISTRY).map(([id, g]) => ({ id, label: g.label, icon: g.icon, blurb: g.blurb })); }

  /** Spin up a game and show its intro gate. Returns false if the type is unknown. */
  start(type = 'rhythm', spec = {}) { return this._spin(type, spec, false); }
  /** Spin up and begin immediately (no gate) — for the agent. */
  startNow(type = 'rhythm', spec = {}) { return this._spin(type, spec, true); }

  _spin(type, spec, immediate) {
    const g = REGISTRY[type]; if (!g) return false;
    this._dispose();
    const s = new g.ctor({ ...this.ctx });
    s.onBegin = () => { if (this.onBegin) try { this.onBegin(type); } catch {} };
    s.onExit = () => { this.activeType = null; if (this.onExit) try { this.onExit(); } catch {} };
    this.session = s; this.activeType = type;
    const norm = g.normalize ? g.normalize(spec) : spec;
    if (immediate) { s.spec = norm; s.begin(); } else if (!s.offerIntro(norm)) { this._dispose(); return false; }
    return true;
  }

  steer(intent, dt) { if (this.session) this.session.steer(intent, dt); }
  update(dt, hands) { if (this.session) this.session.update(dt, hands); }
  quit() { if (this.session) this.session.exit(true); }
  _dispose() { if (this.session) { try { this.session.destroy(); } catch {} this.session = null; this.activeType = null; } }
}

export default GamesHub;
