/**
 * hopeOS SDK — Games · GameSession (base)
 * ═══════════════════════════════════════════════════════════════
 * The "GameTemplate": the games analogue of CurationTour. A game is an overlay
 * that rides the live world without changing its saved coordinates. The base owns
 * everything common to every game type:
 *   • lifecycle           offerIntro → begin → (steer/update each frame) → finish
 *   • planted embodiment  the player stands and faces the play-field; bounded head-look
 *   • the eye / blade math reused from the curation rail (one source of truth)
 *   • score · combo · HUD self-injected neon UI (drops into any world)
 *   • keyboard parity     Enter/Esc/Space + per-subclass keys (accessibility mandate)
 *
 * Subclasses (rhythm.js, later slice.js) implement:
 *   buildField()   — lay out the play-field meshes from the spec
 *   tick(dt, blades) — advance gameplay; `blades` = active hand blades this frame
 *   teardownField()
 *
 * Wiring in world.html (mirror of the tour's 3 touch-points):
 *   if (games.active) games.steer(intent, dt);   // BEFORE world.step — plant + face field
 *   games.update(dt, { right, left });           // AFTER  hand resolve — slice detection
 */
import * as THREE from 'three';
import { ArcadeScenery } from './scenery.js';

export const NEON = '#39ff5a';

// ── shared math (same spirit as curation.js) ──
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const damp = (cur, goal, lambda, dt) => goal + (cur - goal) * Math.exp(-lambda * dt);
export const shortAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
export function softClamp(v, span) { const s = Math.sign(v), m = Math.abs(v); return m <= span ? v : s * (span + (m - span) / (1 + (m - span) * 2.2)); }
export function dirFromAngles(yaw, pitch) { const cp = Math.cos(pitch); return new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp); }
/** Shortest distance from point p to segment a→b (all THREE.Vector3). */
export function distPointSegment(p, a, b) {
  const ab = b.clone().sub(a); const t = clamp(p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1e-9), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * A "blade" is one hand's swept segment this frame (prevTip → tip) plus its speed —
 * the unit of slice detection. GameSession builds these from resolved scene-space hands.
 */
class Blade {
  constructor(side) { this.side = side; this.tip = null; this.prev = null; this.speed = 0; this.live = false; }
  update(landmarks, dt) {
    if (!landmarks) { this.live = false; this.prev = this.tip = null; return; }
    // blade tip = mean of index + middle fingertips (lm 8,12) — the cutting edge
    const tip = landmarks[8].clone().add(landmarks[12]).multiplyScalar(0.5);
    this.prev = this.tip || tip.clone();
    this.tip = tip;
    this.speed = dt > 0 ? this.prev.distanceTo(this.tip) / dt : 0;
    this.live = true;
  }
}

export class GameSession {
  constructor({ world, nav, hope, THREE: T }) {
    this.world = world; this.nav = nav; this.hope = hope; this.T = T || THREE;
    this.scene = (hope && hope.scene) || world.scene;
    this.onBegin = null; this.onExit = null;          // host hooks (world.html)
    this.active = false; this.state = 'idle';         // idle | intro | playing | done
    this.spec = null;
    this.score = 0; this.combo = 0; this.best = 0; this.hits = 0; this.misses = 0; this.total = 0;
    // planted bounded-look (identical feel to the curation rail)
    this.spanYaw = 0.7; this.spanPitch = 0.4; this.gaze = 1.0; this.recenterLambda = 2.4; this.recenterDelay = 0.5;
    this.lookHome = { yaw: world.yaw || 0, pitch: 0 };
    this.devYaw = 0; this.devPitch = 0; this._idle = 0;
    this.group = new this.T.Group(); this.group.name = 'gameField'; this.scene.add(this.group);
    this.blades = { right: new Blade('right'), left: new Blade('left') };
    this.scenery = new ArcadeScenery({ world, hope, scene: this.scene });   // holographic space backdrop
    this._injectCSS(); this._buildDOM();
  }

  // ── subclass contract ──
  buildField() {}                 // create meshes under this.group from this.spec
  tick(dt, blades) {}             // advance gameplay; blades = [Blade...] that are live
  teardownField() {}              // remove gameplay meshes (group is cleared for you)
  introCopy() { return { kicker: 'HOPEOS ARCADE', title: this.spec?.title || 'Game', lede: '', how: [] }; }

  // ── lifecycle ──
  /** Show the "how to play" gate. Returns false if the spec can't run. */
  offerIntro(spec) {
    if (spec) this.spec = spec;
    if (!this.spec) return false;
    this.state = 'intro'; this._showIntro(); return true;
  }
  begin() {
    if (this.onBegin) { try { this.onBegin(); } catch {} }
    this._hide(this.el.gate);
    // face the field: plant where we stand, lock look-home to the current heading
    this.anchor = this.world.getAvatarPosition().clone();
    this.lookHome = { yaw: this.world.yaw || 0, pitch: 0 };
    this.devYaw = this.devPitch = 0; this._idle = 0;
    this.score = 0; this.combo = 0; this.best = 0; this.hits = 0; this.misses = 0;
    this._clearGroup();
    try { this.scenery.enter(this.palette || 0x36c6ff); } catch (e) { console.warn('[arcade] scenery', e); }
    this.buildField();
    this.active = true; this.state = 'playing';
    this.el.hud.classList.add('show'); this._renderHUD();
  }
  /** End the game and hand control back to the host (free roam). */
  exit(silent) {
    this.active = false; this.state = 'idle';
    this._clearGroup(); try { this.teardownField(); } catch {} try { this.scenery.exit(); } catch {}
    if (this.nav) { this.nav.yaw = this.world.yaw; this.nav.pitch = this.world.pitch; this.nav.keys = {}; }
    this.el.hud.classList.remove('show'); this._hide(this.el.card);
    if (!silent && this.onExit) { try { this.onExit(); } catch {} }
    if (silent) this._hide(this.el.gate);
  }
  finish() {
    this.active = false; this.state = 'done';
    this._clearGroup(); try { this.teardownField(); } catch {} try { this.scenery.exit(); } catch {}
    this.el.hud.classList.remove('show');
    this._showEnd();
  }

  // ── per-frame: BEFORE world.step (plant + bounded look) ──
  steer(intent, dt) {
    if (!this.active) return;
    const dyaw = (intent.yawDelta || 0) * this.gaze, dpitch = (intent.pitchDelta || 0) * this.gaze;
    const steering = Math.abs(dyaw) + Math.abs(dpitch) > 1e-4;
    if (steering) { this.devYaw += dyaw; this.devPitch += dpitch; this._idle = 0; }
    else { this._idle += dt; if (this._idle > this.recenterDelay) {
      this.devYaw = damp(this.devYaw, 0, this.recenterLambda, dt);
      this.devPitch = damp(this.devPitch, 0, this.recenterLambda, dt); } }
    this.devYaw = softClamp(this.devYaw, this.spanYaw);
    this.devPitch = softClamp(this.devPitch, this.spanPitch);
    intent.yaw = this.lookHome.yaw + this.devYaw;
    intent.pitch = clamp(this.lookHome.pitch + this.devPitch, -1.45, 1.45);
    intent.yawDelta = 0; intent.pitchDelta = 0;
    intent.forward = 0; intent.strafe = 0; intent.jump = false;   // planted: you stand and play
  }

  // ── per-frame: AFTER hand resolve (advance gameplay) ──
  update(dt, hands) {
    if (!this.active) return;
    const live = [];
    this.blades.right.update(hands && hands.right, dt); if (this.blades.right.live) live.push(this.blades.right);
    this.blades.left.update(hands && hands.left, dt);  if (this.blades.left.live) live.push(this.blades.left);
    try { this.scenery.update(dt, this.eye(), this.fieldBasis()); } catch {}   // forward-travel space stream
    this.tick(dt, live);
    this._renderHUD();
  }

  destroy() { this._clearGroup(); try { this.scene.remove(this.group); } catch {} try { window.removeEventListener('keydown', this._onKey); this.el.root.remove(); this.el.style.remove(); } catch {} }

  // ── scoring (called by subclasses) ──
  addHit(points = 100) { this.combo++; this.best = Math.max(this.best, this.combo); this.hits++;
    this.score += Math.round(points * (1 + Math.min(this.combo, 8) * 0.125)); this._pulse('hit'); }
  addMiss() { this.combo = 0; this.misses++; this._pulse('miss'); }
  get accuracy() { const a = this.hits + this.misses; return a ? Math.round(100 * this.hits / a) : 100; }

  // ── eye / field helpers (shared) ──
  eye() { const p = this.world.getAvatarPosition(); p.y = this.world.playerBody.translation().y + (this.world.cfg.eyeHeight || 1.5); return p; }
  forward() { return dirFromAngles(this.lookHome.yaw, 0); }
  /** Right/up basis of the play-field plane (perpendicular to the look-home forward). */
  fieldBasis() { const f = this.forward(); const up = new this.T.Vector3(0, 1, 0);
    const right = new this.T.Vector3().crossVectors(f, up).normalize(); const u = new this.T.Vector3().crossVectors(right, f).normalize();
    return { f, right, up: u }; }
  _clearGroup() { for (let i = this.group.children.length - 1; i >= 0; i--) { const c = this.group.children[i]; this.group.remove(c); c.geometry?.dispose?.(); c.material?.dispose?.(); } }

  // ── HUD / DOM (self-contained neon, same family as curation) ──
  _injectCSS() {
    const css = `
    #gameRoot{position:fixed;inset:0;z-index:60;pointer-events:none;font-family:'Space Grotesk',system-ui,sans-serif;color:#d7ecdd}
    #gameRoot .pe{pointer-events:auto}
    .gm-gate{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:4vmin;
      background:radial-gradient(120% 120% at 50% 40%,rgba(4,9,6,.62),rgba(4,7,10,.86))}
    .gm-gate.show{display:flex;animation:gmFade .5s ease}
    .gm-panel{pointer-events:auto;max-width:680px;width:100%;background:rgba(6,14,10,.66);border:1px solid rgba(73,231,134,.35);
      border-radius:18px;padding:30px 36px;backdrop-filter:blur(10px);box-shadow:0 0 60px rgba(57,255,90,.12);text-align:center}
    .gm-k{font-size:12px;letter-spacing:.32em;text-transform:uppercase;color:${NEON};margin-bottom:10px}
    .gm-h{font-size:clamp(30px,5.4vw,54px);font-weight:700;line-height:1.04;color:#eafff1;text-shadow:0 0 22px rgba(93,255,155,.4);margin:0 0 12px}
    .gm-lede{font-size:clamp(14px,2.2vw,18px);color:${NEON};margin:0 0 16px}
    .gm-how{list-style:none;padding:0;margin:0 auto 18px;max-width:440px;text-align:left}
    .gm-how li{font-size:14px;line-height:1.6;color:#cfe6d7;margin:0 0 6px;padding-left:20px;position:relative}
    .gm-how li:before{content:'▸';position:absolute;left:0;color:${NEON}}
    .gm-cta{display:inline-flex;gap:10px;margin-top:6px}
    .gm-btn{pointer-events:auto;background:linear-gradient(135deg,#3ddc74,#21b85f);border:none;color:#02110a;font-weight:700;
      border-radius:11px;padding:13px 26px;font-family:inherit;font-size:15px;cursor:pointer;box-shadow:0 0 22px rgba(57,255,90,.35)}
    .gm-btn:hover{filter:brightness(1.08)}
    .gm-btn.ghost{background:rgba(12,30,22,.7);border:1px solid rgba(73,231,134,.4);color:#9fe6bd;box-shadow:none}
    /* HUD — score / combo / progress */
    .gm-hud{position:absolute;top:18px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:22px;
      background:rgba(6,14,10,.6);border:1px solid rgba(73,231,134,.3);border-radius:13px;padding:9px 20px;backdrop-filter:blur(9px)}
    .gm-hud.show{display:flex}
    .gm-stat{text-align:center;min-width:60px}
    .gm-stat b{display:block;font-size:22px;color:#eafff1;line-height:1}
    .gm-stat span{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#7fcfa0}
    .gm-combo b{color:${NEON};text-shadow:0 0 12px ${NEON}}
    .gm-prog{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(73,231,134,.12)}
    .gm-prog i{display:block;height:100%;width:0;background:${NEON};box-shadow:0 0 8px ${NEON};transition:width .12s linear}
    .gm-exit{pointer-events:auto;background:none;border:1px solid rgba(73,231,134,.3);color:#9fe6bd;border-radius:9px;padding:6px 11px;cursor:pointer;font-size:11px;font-family:inherit}
    .gm-feed{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);font-size:34px;font-weight:800;opacity:0;pointer-events:none;text-shadow:0 0 16px currentColor}
    .gm-feed.hit{color:${NEON};animation:gmPop .45s ease}
    .gm-feed.miss{color:#ff5a6e;animation:gmPop .45s ease}
    @keyframes gmFade{from{opacity:0}to{opacity:1}}
    @keyframes gmPop{0%{opacity:0;transform:translate(-50%,-40%) scale(.7)}30%{opacity:1}100%{opacity:0;transform:translate(-50%,-62%) scale(1.1)}}
    `;
    const s = document.createElement('style'); s.id = 'gameStyle'; s.textContent = css; document.head.appendChild(s);
    this.el = { style: s };
  }
  _buildDOM() {
    const root = document.createElement('div'); root.id = 'gameRoot';
    root.innerHTML = `
      <div class="gm-gate" id="gmGate"></div>
      <div class="gm-feed" id="gmFeed"></div>
      <div class="gm-hud" id="gmHud">
        <div class="gm-stat"><b id="gmScore">0</b><span>score</span></div>
        <div class="gm-stat gm-combo"><b id="gmCombo">0</b><span>combo ×</span></div>
        <div class="gm-stat"><b id="gmAcc">100%</b><span>accuracy</span></div>
        <button class="gm-exit" id="gmExit" title="leave the game">⏏ quit</button>
        <div class="gm-prog"><i id="gmProg"></i></div>
      </div>`;
    document.body.appendChild(root);
    const $ = id => root.querySelector('#' + id);
    Object.assign(this.el, { root, gate: $('gmGate'), hud: $('gmHud'), feed: $('gmFeed'),
      score: $('gmScore'), combo: $('gmCombo'), acc: $('gmAcc'), prog: $('gmProg') });
    $('gmExit').onclick = () => this.exit();
    this._onKey = (e) => {
      if (this.state === 'intro' && e.key === 'Enter') { this.begin(); return; }
      if (this.state === 'done' && e.key === 'Enter') { this.begin(); return; }
      if (!this.active) return;
      if (e.key === 'Escape') { this.exit(); return; }
      this.onKey && this.onKey(e);   // subclass lane keys (accessibility parity)
    };
    window.addEventListener('keydown', this._onKey);
  }
  _renderHUD() {
    this.el.score.textContent = this.score;
    this.el.combo.textContent = this.combo;
    this.el.acc.textContent = this.accuracy + '%';
    this.el.prog.style.width = clamp(this.progress() * 100, 0, 100) + '%';
  }
  progress() { return 0; }   // subclass: 0..1 through the track
  _pulse(kind) { const f = this.el.feed; f.className = 'gm-feed ' + kind; f.textContent = kind === 'hit' ? (this.combo > 1 ? '×' + this.combo : 'HIT') : 'MISS';
    f.style.opacity = '0'; void f.offsetWidth; f.style.opacity = ''; }
  _hide(el) { el.classList.remove('show'); }
  _show(el) { el.classList.add('show'); }
  _showIntro() {
    const c = this.introCopy();
    this.el.gate.innerHTML = `<div class="gm-panel pe">
      <div class="gm-k">${c.kicker}</div>
      <h1 class="gm-h">${c.title}</h1>
      ${c.lede ? `<div class="gm-lede">${c.lede}</div>` : ''}
      ${c.how?.length ? `<ul class="gm-how">${c.how.map(h => `<li>${h}</li>`).join('')}</ul>` : ''}
      <div class="gm-cta"><button class="gm-btn" id="gmStart">▶ Start</button>
        <button class="gm-btn ghost" id="gmCancel">Back</button></div></div>`;
    this.el.gate.querySelector('#gmStart').onclick = () => this.begin();
    this.el.gate.querySelector('#gmCancel').onclick = () => this.exit();
    this._show(this.el.gate);
  }
  _showEnd() {
    this.el.gate.innerHTML = `<div class="gm-panel pe" style="max-width:520px">
      <div class="gm-k">${this.spec?.title || 'HOPEOS ARCADE'}</div>
      <h1 class="gm-h">${this.score.toLocaleString()}</h1>
      <div class="gm-lede">best combo ×${this.best} · ${this.accuracy}% accuracy · ${this.hits}/${this.hits + this.misses} hit</div>
      <div class="gm-cta"><button class="gm-btn" id="gmAgain">↻ Play again</button>
        <button class="gm-btn ghost" id="gmDone">Explore freely →</button></div></div>`;
    this.el.gate.querySelector('#gmAgain').onclick = () => this.begin();
    this.el.gate.querySelector('#gmDone').onclick = () => this.exit();
    this._show(this.el.gate);
  }
}

export default GameSession;
