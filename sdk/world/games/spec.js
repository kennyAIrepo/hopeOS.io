/**
 * hopeOS SDK — Games · Portable Spec
 * ═══════════════════════════════════════════════════════════════
 * A game is described by a small JSON object — the same idea as the world
 * snapshot (world-store.js) and the curation tour: portable, agent-authorable,
 * publishes WITH the world. The runtime (GamesHub → a GameSession subclass)
 * interprets it live. No build step.
 *
 *   RhythmSpec (Moon-Rider-style):
 *   {
 *     type: 'rhythm',
 *     title: 'Neon Run',
 *     bpm: 120,
 *     duration: 75,                 // seconds of play
 *     audioUrl: null,               // optional music track; null = procedural + metronome
 *     grid:  { lanes: 3, rows: 2 }, // strike grid in front of the planted player
 *     tuning:{ approach: 8, strikeDist: 0.85, spawnDist: 12, noteSize: 0.22, minSliceSpeed: 1.6 },
 *     notes: [ { t, lane, row, dir, kind } ... ]   // t = beat time (s); dir = slice hint
 *   }
 *
 * `dir` ∈ up|down|left|right|any  (hand-slicing defaults to 'any' — forgiving).
 * `kind` ∈ note|bomb   (bomb = do NOT slice; slicing it breaks the combo).
 */

export const DIRS = ['up', 'down', 'left', 'right', 'any'];

export const RHYTHM_DEFAULTS = {
  approach: 8,        // m/s the notes travel toward the eye
  strikeDist: 0.85,   // m in front of the eye where a note is "hittable"
  spawnDist: 12,      // m in front where a note appears
  noteSize: 0.22,     // m cube edge
  bladeRadius: 0.13,  // m forgiveness around the hand blade
  minSliceSpeed: 1.6, // m/s hand speed required to count as a slice
  hitWindow: 0.18,    // m depth window around the strike plane that scores
  bombRate: 0,        // fraction of notes that are bombs (0 = none)
};

/** Validate + fill a rhythm spec with defaults so the runtime can trust it. */
export function normalizeRhythm(spec = {}) {
  const s = { type: 'rhythm', title: spec.title || 'hopeOS Rhythm',
    bpm: clampNum(spec.bpm, 40, 240, 120),
    duration: clampNum(spec.duration, 10, 600, 75),
    audioUrl: spec.audioUrl || null,
    grid: { lanes: clampInt(spec.grid?.lanes, 1, 5, 3), rows: clampInt(spec.grid?.rows, 1, 3, 2) },
    tuning: { ...RHYTHM_DEFAULTS, ...(spec.tuning || {}) },
    notes: Array.isArray(spec.notes) ? spec.notes.slice() : null };
  if (!s.notes || !s.notes.length) s.notes = generateRhythm(s);
  // keep notes sorted by time; clamp lane/row into the grid
  s.notes = s.notes
    .map(n => ({ t: Math.max(0, +n.t || 0),
      lane: clampInt(n.lane, 0, s.grid.lanes - 1, 0),
      row: clampInt(n.row, 0, s.grid.rows - 1, 0),
      dir: DIRS.includes(n.dir) ? n.dir : 'any',
      kind: n.kind === 'bomb' ? 'bomb' : 'note' }))
    .sort((a, b) => a.t - b.t);
  return s;
}

/**
 * Procedural beatmap — deterministic from (bpm, duration, seed). Lays a note on
 * most beats with the occasional rest and lane/row variety, so the agent can spin
 * a playable track up instantly with no external map. Seeded so a published spec
 * replays identically (no Math.random — see world-store determinism).
 */
export function generateRhythm(spec = {}) {
  const bpm = clampNum(spec.bpm, 40, 240, 120);
  const duration = clampNum(spec.duration, 10, 600, 75);
  const lanes = clampInt(spec.grid?.lanes, 1, 5, 3);
  const rows = clampInt(spec.grid?.rows, 1, 3, 2);
  const bombRate = clampNum(spec.tuning?.bombRate ?? RHYTHM_DEFAULTS.bombRate, 0, 0.4, 0);
  let seed = (spec.seed != null ? spec.seed | 0 : hashStr(spec.title || 'hopeOS')) >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  const beat = 60 / bpm;
  const lead = 2 * beat;                    // skip the first two beats (ramp-in)
  const dirByLane = ['left', 'up', 'right', 'down', 'any'];
  const notes = [];
  let prevLane = Math.floor(lanes / 2);
  for (let t = lead, i = 0; t < duration - beat; t += beat, i++) {
    if (i > 4 && rnd() < 0.18) continue;    // musical rest
    // step the lane by ±1 most of the time so the pattern flows side to side
    let lane = prevLane + (rnd() < 0.5 ? -1 : 1);
    if (lane < 0 || lane >= lanes) lane = prevLane;
    prevLane = lane;
    const row = rows > 1 && rnd() < 0.35 ? 1 : 0;
    const kind = bombRate > 0 && rnd() < bombRate ? 'bomb' : 'note';
    notes.push({ t: +t.toFixed(3), lane, row, dir: kind === 'bomb' ? 'any' : dirByLane[lane] || 'any', kind });
    // every 4th bar, add a quick off-beat double
    if (i % 8 === 7 && rnd() < 0.6) {
      const l2 = (lane + 1) % lanes;
      notes.push({ t: +(t + beat / 2).toFixed(3), lane: l2, row: 0, dir: dirByLane[l2] || 'any', kind: 'note' });
    }
  }
  return notes;
}

/**
 * SliceSpec (Fruit-Ninja-style): fruit are launched on arcs that fly toward the
 * planted player; you slice them with your hands. Bombs cost you. No external map —
 * fruit are spawned procedurally from a seeded cadence, so it publishes with the world.
 *
 *   { type:'slice', title, bpm, duration, tuning:{...} }
 */
export const SLICE_DEFAULTS = {
  approach: 4.2,      // m/s the fruit closes toward the eye plane
  spawnDist: 6.5,     // m in front where fruit launch from
  gravity: 5.2,       // m/s² downward pull (arc feel; lower than real-world for hang time)
  launchUp: 4.6,      // m/s initial upward kick
  spread: 1.6,        // m half-width of the launch fan
  fruitSize: 0.3,     // m radius of a fruit
  bladeRadius: 0.16,  // m forgiveness around the hand blade
  minSliceSpeed: 1.4, // m/s hand speed required to slice
  bombRate: 0.12,     // fraction of spawns that are bombs
  spawnEvery: 0.9,    // seconds between launches (scaled by difficulty over time)
  burst: 2,           // max fruit per launch once warmed up
};

/** Validate + fill a slice spec with defaults. */
export function normalizeSlice(spec = {}) {
  return { type: 'slice', title: spec.title || 'Hand Ninja',
    bpm: clampNum(spec.bpm, 40, 240, 110),
    duration: clampNum(spec.duration, 10, 600, 70),
    audioUrl: spec.audioUrl || null,
    seed: spec.seed != null ? spec.seed | 0 : hashStr(spec.title || 'hopeOS-slice'),
    tuning: { ...SLICE_DEFAULTS, ...(spec.tuning || {}) } };
}

// ── tiny helpers ──
function clampNum(v, lo, hi, dflt) { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; }
function clampInt(v, lo, hi, dflt) { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export default { normalizeRhythm, generateRhythm, normalizeSlice, RHYTHM_DEFAULTS, SLICE_DEFAULTS, DIRS };
