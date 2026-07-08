/**
 * hopeOS SDK — Games · MusicEngine  (the beat-sync "song track")
 * ═══════════════════════════════════════════════════════════════
 * Moon Rider / Beat Saber play to MUSIC — the beatmap and the audio share one
 * clock. hopeOS has no asset pipeline and runs from file:// / a CDN, so shipping
 * an mp3 is fragile (CORS on cross-origin WebAudio, no offline). Instead the
 * default "song" is SYNTHESIZED in WebAudio, in-repo and royalty-free, and it is
 * scheduled against the SAME AudioContext clock the game reads — so the beats are
 * sample-accurate, never drift, and work offline with zero assets.
 *
 *   const music = new MusicEngine(audioCtx, { bpm: 120, seed: 7, style: 'synthwave' });
 *   music.start();                 // begins playback at audioCtx.currentTime + lookahead
 *   const t = music.time;          // seconds of music elapsed — feed this to the beat clock
 *   music.stop();
 *
 * A real track can be substituted: `new MusicEngine(ac, { url })` plays an
 * <audio> element instead, and `.time` reports its currentTime. Same interface,
 * so RhythmGame doesn't care which it got. Drop a CC0 track (e.g. a Kevin
 * MacLeod / Free Music Archive piece) at the URL and beats lock to it too.
 *
 * The composition is deterministic from (bpm, seed) — no Math.random — so a
 * published spec replays the identical song. Same LCG as spec.js.
 */

// minor pentatonic, the safe "everything sounds intentional" scale (semitone offsets)
const PENT = [0, 3, 5, 7, 10];
const noteHz = (semi) => 440 * Math.pow(2, (semi - 9) / 12);   // semi: midi-ish, 0 = C-ish ref

export class MusicEngine {
  /** @param {AudioContext} ac shared context (so game blips + music share a clock) */
  constructor(ac, { bpm = 120, seed = 7, url = null, volume = 0.5, root = -5 } = {}) {
    this.ac = ac;
    this.bpm = Math.min(240, Math.max(40, bpm | 0 || 120));
    this.beat = 60 / this.bpm;
    this.url = url || null;
    this.root = root;                 // transpose of the whole track, in semitones
    this._seed = (seed >>> 0) || 7;
    this.playing = false;
    this._startAt = 0;                // ac.currentTime when beat 0 lands
    this._audio = null; this._mediaNode = null;
    this._timer = null; this._nextBeat = 0;   // scheduler cursor (beat index)
    this._buildGraph(volume);
  }

  // deterministic PRNG — identical generator to spec.js so the song is reproducible
  _rnd() { this._seed = (this._seed * 1664525 + 1013904223) >>> 0; return this._seed / 4294967296; }

  _buildGraph(volume) {
    const ac = this.ac;
    this.master = ac.createGain(); this.master.gain.value = volume;
    // a gentle lowpass + soft saturation curve keeps the synth warm, not harsh
    this.tone = ac.createBiquadFilter(); this.tone.type = 'lowpass';
    this.tone.frequency.value = 5200; this.tone.Q.value = 0.6;
    this.tone.connect(this.master); this.master.connect(ac.destination);
    // a tiny reusable noise buffer for hats/snares
    const n = ac.sampleRate * 0.4; this._noise = ac.createBuffer(1, n, ac.sampleRate);
    const d = this._noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  // ── lifecycle ──────────────────────────────────────────────
  start() {
    if (this.playing) return; this.playing = true;
    try { this.ac.resume?.(); } catch {}
    if (this.url) { this._startTrack(); return; }
    // synth route: schedule beat 0 a hair in the future so the first beat isn't clipped
    this._startAt = this.ac.currentTime + 0.12;
    this._nextBeat = 0;
    this._tickSchedule();                                  // prime
    this._timer = setInterval(() => this._tickSchedule(), 25);   // lookahead scheduler
  }
  stop() {
    this.playing = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    try { this._audio?.pause(); } catch {}
    try { this.master.gain.setTargetAtTime(0.0001, this.ac.currentTime, 0.05); } catch {}
    this._audio = null;
  }
  /** Seconds of music elapsed — the authoritative beat clock for the game. */
  get time() {
    if (this.url) return this._audio ? this._audio.currentTime : 0;
    return Math.max(0, this.ac.currentTime - this._startAt);
  }

  _startTrack() {
    try {
      this._audio = new Audio(this.url); this._audio.crossOrigin = 'anonymous';
      this._audio.loop = false; this._audio.volume = Math.min(1, this.master.gain.value * 1.6);
      this._audio.play().catch(() => {});   // autoplay may need the game's start gesture (it has one)
    } catch {}
  }

  // ── the synthesized "song" ────────────────────────────────
  // Classic lookahead scheduler: each tick, queue every beat that falls inside the
  // next ~0.2s window. Cheap, jitter-free, and sample-accurate because every voice
  // is started with an explicit ac.currentTime-relative `when`.
  _tickSchedule() {
    if (!this.playing) return;
    const horizon = this.ac.currentTime + 0.2;
    while (this._startAt + this._nextBeat * this.beat < horizon) {
      this._scheduleBeat(this._nextBeat, this._startAt + this._nextBeat * this.beat);
      this._nextBeat++;
    }
  }

  /** Lay down one beat's worth of the arrangement at absolute time `when`. */
  _scheduleBeat(i, when) {
    const bar = Math.floor(i / 4), inBar = i % 4;
    const half = this.beat / 2, q = this.beat / 4;
    // — drums: four-on-the-floor kick, offbeat hats, backbeat snare —
    this._kick(when);
    this._hat(when + half, 0.5);
    if (inBar === 1 || inBar === 3) this._snare(when);
    if (this._rnd() < 0.5) this._hat(when + q * 3, 0.3);
    // — bass: root-driven eighth-note pulse, walks the scale per bar —
    const deg = [0, 0, 4, 3, 0, 2, 4, 1][bar % 8];            // a simple repeating progression
    const rootSemi = this.root + PENT[deg % PENT.length] - 12;
    this._bass(when, rootSemi);
    this._bass(when + half, rootSemi + (this._rnd() < 0.3 ? 12 : 0));
    // — lead arp: sparse seeded pentatonic sparkle on top —
    if (bar >= 2 && this._rnd() < 0.85) {
      const step = PENT[(deg + Math.floor(this._rnd() * 5)) % PENT.length];
      this._lead(when + (this._rnd() < 0.5 ? 0 : half), this.root + step + 12);
    }
    // — pad swell at the top of every 4-bar phrase —
    if (inBar === 0 && bar % 4 === 0) this._pad(when, this.root + PENT[deg % PENT.length], this.beat * 8);
  }

  // ── voices (each fully self-contained, fire-and-forget) ──
  _env(node, when, peak, dur, attack = 0.005) {
    const g = this.ac.createGain(); g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    node.connect(g); g.connect(this.tone); return g;
  }
  _kick(when) {
    const o = this.ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, when); o.frequency.exponentialRampToValueAtTime(48, when + 0.12);
    this._env(o, when, 0.9, 0.18); o.start(when); o.stop(when + 0.2);
  }
  _snare(when) {
    const s = this.ac.createBufferSource(); s.buffer = this._noise;
    const bp = this.ac.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 1400;
    s.connect(bp); this._env(bp, when, 0.35, 0.16); s.start(when); s.stop(when + 0.18);
  }
  _hat(when, vol = 0.4) {
    const s = this.ac.createBufferSource(); s.buffer = this._noise;
    const hp = this.ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    s.connect(hp); this._env(hp, when, 0.18 * vol, 0.05); s.start(when); s.stop(when + 0.06);
  }
  _bass(when, semi) {
    const o = this.ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = noteHz(semi) / 2;
    const f = this.ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 6;
    o.connect(f); this._env(f, when, 0.3, this.beat * 0.5, 0.008); o.start(when); o.stop(when + this.beat * 0.55);
  }
  _lead(when, semi) {
    const o = this.ac.createOscillator(); o.type = 'triangle'; o.frequency.value = noteHz(semi);
    const o2 = this.ac.createOscillator(); o2.type = 'square'; o2.frequency.value = noteHz(semi) * 1.005;
    const g = this._env(o, when, 0.16, this.beat * 0.8, 0.01); o2.connect(g);
    o.start(when); o2.start(when); o.stop(when + this.beat * 0.85); o2.stop(when + this.beat * 0.85);
  }
  _pad(when, semi, dur) {
    [0, 7, 12].forEach((iv, k) => {
      const o = this.ac.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = noteHz(semi + iv) * (k === 0 ? 0.5 : 1);
      this._env(o, when, 0.05, dur, 0.4); o.start(when); o.stop(when + dur + 0.1);
    });
  }
}

export default MusicEngine;
