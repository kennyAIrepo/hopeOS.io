/**
 * hopeOS SDK — Avatar Navigator
 * ═══════════════════════════════════════════════════════════════
 * Produces a unified look/move intent each frame. ALL input methods are live
 * at the same time and freely interleave — keyboard+mouse (tactile), bare-hand
 * gesture, and AI/voice commands. If one isn't being used, the others still work.
 *
 * The navigator OWNS the absolute camera orientation (this.yaw / this.pitch),
 * so pitch can be clamped and never drifts to "stuck facing the floor". It
 * returns absolute yaw/pitch plus movement, and WorldTemplate.step() applies it.
 *
 * ── GESTURE SCHEME (independent channels, no interference) ──
 *   • LEAN hand left/right        → turn (yaw), proportional, hold to spin 360°
 *   • RAISE / LOWER hand          → look up / down (pitch), absolute & self-centering
 *   • POINT (index)               → walk forward (in look direction)
 *   • FIST                        → stop (hard)
 *   • OPEN palm up                → toggle walk/stop
 *   • index JAB up                → jump
 *   • TWO hands apart / together  → zoom POV out / in
 *
 * ── AI hooks ── faceLevel(), faceUp(), faceDown(), turnBy(), stop(), go()
 */

import * as THREE from 'three';

// True when the user is typing into a text field — navigation keys must be left
// alone so words (and spaces!) go to the box, not the avatar.
function isEditable(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
}

const NAV_DEFAULTS = {
  // Turn (yaw) — rate based, from hand lean angle. Hand stays centred in frame.
  leanDeadzone:     12,     // deg of tilt before turning starts
  leanFull:         50,     // deg of tilt = full turn speed
  yawSensitivity:   2.6,    // rad/sec at full lean
  // Look up/down (pitch) — ABSOLUTE from hand height, so it self-centres and
  // can never get stuck looking at the floor. Raise hand = look up.
  pitchTopY:        0.15,   // wrist.y at top of frame → look fully up
  pitchBotY:        0.80,   // wrist.y near bottom → look fully down
  pitchRestY:       0.47,   // wrist.y that means "look level"
  pitchDead:        0.05,   // flat zone around rest (normalised)
  pitchMax:         1.30,   // clamp (~75°)
  lookSmooth:       10.0,   // higher = snappier
  moveRamp:         8.0,    // forward speed ease in/out
  jabVelocity:      1.1,    // upward index jab → jump
  mouseSensitivity: 0.0026,
  touchLookSensitivity: 0.0042, // rad of look per px of one-finger screen drag (touchscreen turn/look)
  turnSpeed:        2.2,    // rad/sec — keyboard turn (← → / Q E), joystick-style
  lookKeySpeed:     1.8,    // rad/sec — keyboard look up/down (↑ ↓)
  dollySensitivity: 0.012,  // metres of forward/back dolly per unit of wheel/touchpad scroll
  trackpadTurnSensitivity: 0.0020,  // rad of turn per px of horizontal two-finger trackpad swipe (steer heading)
  zoomSensitivity:  60,     // FOV degrees per unit of two-hand spread change
  handStableFrames: 4,      // a hand must persist this many frames before it can steer
  handRaiseMaxY:    0.82,   // wrist must be above this (0=top,1=bottom) → genuinely "in the air"
};

export class AvatarNavigator {
  constructor(opts = {}) {
    this.cfg = { ...NAV_DEFAULTS, ...opts };
    this.mode = 'hybrid';        // informational only — all inputs are always live

    // Absolute camera orientation (owned here)
    this.yaw = 0;
    this.pitch = 0;

    // Keyboard / mouse state
    this.keys = {};
    this._mouseYaw = 0;
    this._mousePitch = 0;
    this._dragging = false;

    // On-screen touch joystick (a separate UI widget calls setJoystick each drag).
    // Axes are -1..1: strafe (+ = right), forward (+ = walk forward). Treated as
    // tactile input, on the same authoritative tier as keyboard/mouse.
    this._joyStrafe = 0;
    this._joyForward = 0;

    // Gesture state
    this._prevIndexTipY = null;
    this._lastGesture = 'none';
    this._moving = false;        // walk latch (AI only)
    this._haltLatch = false;
    this._twoHandDist = null;    // for pinch-zoom
    this._handStable = 0;        // consecutive frames a raised hand has been present
    this._dolly = 0;             // accumulated wheel/touchpad scroll → forward/back dolly

    // Smoothing
    this._yawVel = 0;
    this._fwd = 0;

    // Per-frame zoom output (consumed by the host to set camera FOV)
    this.zoomDelta = 0;
    this.buildMode = false;      // when true, gestures don't drive walking (used for placing)
  }

  setMode(mode) { this.mode = mode; }

  /** On-screen touch joystick → walk. strafe/forward are -1..1 (0,0 = released). */
  setJoystick(strafe, forward) {
    this._joyStrafe  = THREE.MathUtils.clamp(strafe  || 0, -1, 1);
    this._joyForward = THREE.MathUtils.clamp(forward || 0, -1, 1);
  }

  // ── AI / voice command hooks ──────────────────────────────────
  faceLevel()        { this.pitch = 0; }
  faceUp(deg = 35)   { this.pitch = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(deg), -this.cfg.pitchMax, this.cfg.pitchMax); }
  faceDown(deg = 35) { this.pitch = THREE.MathUtils.clamp(-THREE.MathUtils.degToRad(deg), -this.cfg.pitchMax, this.cfg.pitchMax); }
  turnBy(deg)        { this.yaw -= THREE.MathUtils.degToRad(deg); }   // +deg = turn right
  turnTo(rad)        { this.yaw = rad; }
  stop()             { this._moving = false; this._fwd = 0; }
  go()               { this._moving = true; }

  // ── Keyboard + mouse wiring (call once) — always active ──
  attachKeyboard(domElement) {
    const navKeys = ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    document.addEventListener('keydown', e => {
      if (isEditable(e.target)) return;        // typing in a box → don't navigate, don't swallow the space
      this.keys[e.code] = true;
      if (navKeys.includes(e.code)) e.preventDefault();
    });
    // Always clear on keyup (even if released while a field is focused) so nothing sticks.
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });

    // Stuck-key insurance: lose focus / visibility / focus a text box → release everything.
    const releaseAll = () => { this.keys = {}; this._dragging = false; };
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
    document.addEventListener('focusin', e => { if (isEditable(e.target)) releaseAll(); });

    if (domElement) {
      // Drag-to-look ONLY (no Pointer Lock — locking feeds continuous mouse
      // micro-deltas that make the view drift/spin on its own). Look happens only
      // while the button is held, with a small deadband so a still mouse = no motion.
      // In CREATE mode the LEFT button belongs to the object editor, so looking
      // moves to the RIGHT button; in PLAY mode either drag looks.
      domElement.addEventListener('mousedown', (e) => { if (!this.buildMode || e.button === 2) this._dragging = true; });
      domElement.addEventListener('contextmenu', (e) => e.preventDefault());   // free the right button for look
      window.addEventListener('mouseup', () => { this._dragging = false; });
      window.addEventListener('mouseleave', () => { this._dragging = false; });
      document.addEventListener('mousemove', e => {
        if (!this._dragging) return;
        if (Math.abs(e.movementX) < 1 && Math.abs(e.movementY) < 1) return;  // deadband
        this._mouseYaw   -= e.movementX * this.cfg.mouseSensitivity;
        this._mousePitch -= e.movementY * this.cfg.mouseSensitivity;
      });
      // Wheel / touchpad scroll → navigate. A horizontal-dominant two-finger trackpad swipe
      // TURNS the avatar (steer your heading / where you walk); a vertical scroll dollies you
      // forward / back. Mouse wheels only emit deltaY, so wheel-dolly is unchanged and the
      // turn gesture is trackpad-only (never fights the wheel). Pinch (ctrlKey) is left alone.
      domElement.addEventListener('wheel', e => {
        if (!e.ctrlKey && e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const px = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;   // normalise line-mode → px
          this._mouseYaw -= px * this.cfg.trackpadTurnSensitivity;
        } else {
          this._dolly += -e.deltaY * this.cfg.dollySensitivity;
        }
      }, { passive: true });

      // ── TOUCHSCREEN drag-to-look ──────────────────────────────────────────────
      // One finger dragging on the scene turns (yaw) and looks (pitch), exactly like
      // the mouse-drag look — this is how you steer your heading on a phone/tablet.
      // Feeds the same yaw/pitch accumulator, so it interleaves with every other
      // input. Touches that begin on the joystick or any UI button never reach the
      // canvas (they're separate elements stacked above it), so this only fires on
      // the open scene. A second finger here while a thumb holds the joystick gives
      // natural twin-stick "move + look" at once.
      let lookTouch = null, lastTX = 0, lastTY = 0;
      domElement.addEventListener('touchstart', e => {
        if (this.buildMode) return;                 // build mode: touches belong to the editor gizmo
        if (lookTouch !== null) return;             // already tracking a look finger
        const t = e.changedTouches[0];
        lookTouch = t.identifier; lastTX = t.clientX; lastTY = t.clientY;
      }, { passive: true });
      domElement.addEventListener('touchmove', e => {
        if (lookTouch === null) return;
        for (const t of e.changedTouches) {
          if (t.identifier !== lookTouch) continue;
          const dx = t.clientX - lastTX, dy = t.clientY - lastTY;
          lastTX = t.clientX; lastTY = t.clientY;
          this._mouseYaw   -= dx * this.cfg.touchLookSensitivity;
          this._mousePitch -= dy * this.cfg.touchLookSensitivity;
          if (e.cancelable) e.preventDefault();     // stop the page scrolling/zooming under the drag
        }
      }, { passive: false });
      const endLookTouch = e => { for (const t of e.changedTouches) if (t.identifier === lookTouch) lookTouch = null; };
      domElement.addEventListener('touchend', endLookTouch);
      domElement.addEventListener('touchcancel', endLookTouch);

      domElement.style.cursor = 'grab';
    }
  }

  /** Unified intent. Control priority: keyboard/mouse own navigation; gesture
   *  navigates ONLY when the keyboard is idle AND a hand is in the air. With no
   *  hands and no keys, nothing moves. Hands are always free for "hand stuff". */
  update(dt, frame) {
    const S = this.cfg;
    const smoothK = Math.min(1, S.lookSmooth * dt);
    const rampK = Math.min(1, S.moveRamp * dt);
    this.zoomDelta = 0;

    // ── 1. TACTILE (authoritative): keyboard move + turn/look, mouse-drag look ──
    // WASD = move (forward/back/strafe). Arrows + Q/E = turn & look like a joystick.
    let kForward = 0, kStrafe = 0;
    if (this.keys['KeyW']) kForward += 1;
    if (this.keys['KeyS']) kForward -= 1;
    if (this.keys['KeyD']) kStrafe  += 1;
    if (this.keys['KeyA']) kStrafe  -= 1;
    // On-screen touch joystick adds to the same axes (up = walk forward, sideways = strafe).
    kForward += this._joyForward;
    kStrafe  += this._joyStrafe;
    kForward = THREE.MathUtils.clamp(kForward, -1, 1);
    kStrafe  = THREE.MathUtils.clamp(kStrafe,  -1, 1);

    let kYaw = 0, kPitch = 0;
    if (this.keys['ArrowLeft']  || this.keys['KeyQ']) kYaw   += 1;   // turn left
    if (this.keys['ArrowRight'] || this.keys['KeyE']) kYaw   -= 1;   // turn right
    if (this.keys['ArrowUp'])   kPitch += 1;                         // look up
    if (this.keys['ArrowDown']) kPitch -= 1;                         // look down
    this.yaw   += kYaw   * S.turnSpeed    * dt;
    this.pitch += kPitch * S.lookKeySpeed * dt;

    const mouseMoved = (this._mouseYaw !== 0 || this._mousePitch !== 0);
    this.yaw   += this._mouseYaw;   this._mouseYaw = 0;
    this.pitch += this._mousePitch; this._mousePitch = 0;
    let jump = !!this.keys['Space'];
    const sprint = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

    const dolly = this._dolly; this._dolly = 0;        // wheel/touchpad → forward/back this frame

    // Is the keyboard/mouse actively driving navigation this frame?
    const kbNav = (kForward !== 0 || kStrafe !== 0 || kYaw !== 0 || kPitch !== 0 || mouseMoved || jump || dolly !== 0);

    // ── 2. CONTROL ARBITRATION ──
    const hand = (frame && frame.hands) ? frame.hands[0] : null;
    // A hand only counts as "in the air" if it's genuinely raised (not at the very
    // bottom / a desk-resting or background phantom) AND has persisted a few frames.
    const raised = !!hand && hand[0] && hand[0].y < this.cfg.handRaiseMaxY;
    this._handStable = raised ? this._handStable + 1 : 0;
    const handReady = this._handStable >= this.cfg.handStableFrames;

    // Gesture NAVIGATES only when a steady raised hand is up, the keyboard is
    // idle, and we're not building. Otherwise gesture never touches the camera.
    const gestureNav = handReady && !kbNav && !this.buildMode;

    let gForward = 0;
    if (hand) this._lastGesture = this._classify(hand); else this._lastGesture = 'none';

    if (gestureNav) {
      const wrist = hand[0], midMcp = hand[9];
      // YAW: lean angle (rate-based; hold to keep turning)
      const vx = midMcp.x - wrist.x, vy = midMcp.y - wrist.y;
      const leanDeg = Math.atan2(vx, -vy) * 180 / Math.PI;
      const aLean = Math.abs(leanDeg);
      let targetYawVel = 0;
      if (aLean > S.leanDeadzone) {
        const mag = Math.min(1, (aLean - S.leanDeadzone) / (S.leanFull - S.leanDeadzone));
        targetYawVel = -Math.sign(leanDeg) * mag * S.yawSensitivity;
      }
      this._yawVel += (targetYawVel - this._yawVel) * smoothK;
      this.yaw += this._yawVel * dt;

      // PITCH: absolute, from hand height (self-centering, never drifts)
      const dy = wrist.y - S.pitchRestY;
      let targetPitch = 0;
      if (Math.abs(dy) > S.pitchDead) {
        if (dy < 0) targetPitch =  (-(dy) / (S.pitchRestY - S.pitchTopY)) * S.pitchMax;
        else        targetPitch = -((dy) / (S.pitchBotY  - S.pitchRestY)) * S.pitchMax;
      }
      this.pitch += (THREE.MathUtils.clamp(targetPitch, -S.pitchMax, S.pitchMax) - this.pitch) * smoothK;

      // WALK: hold a POINT to move; fist stops
      const g = this._lastGesture;
      if (g === 'fist') this._moving = false;
      gForward = (g === 'point' || this._moving) ? 1 : 0;

      // JUMP: index jab
      const tip = hand[8];
      if (this._prevIndexTipY !== null && dt > 0 && (this._prevIndexTipY - tip.y) / dt > S.jabVelocity && g === 'point') jump = true;
      this._prevIndexTipY = tip.y;
    } else {
      // Hands not navigating (keyboard driving, building, or no hands):
      // don't let gesture touch yaw/pitch — the view holds still unless YOU move it.
      this._yawVel = 0;
      this._prevIndexTipY = hand ? hand[8].y : null;
      gForward = this._moving ? 1 : 0;     // AI-latched walk still honoured
    }

    // ZOOM (deliberate two-hand spread) — allowed whenever two hands are up; it
    // can't self-trigger, so it never causes idle drift.
    const hands = (frame && frame.hands) ? frame.hands : [];
    if (hands[0] && hands[1]) {
      const d = Math.hypot(hands[0][0].x - hands[1][0].x, hands[0][0].y - hands[1][0].y);
      if (this._twoHandDist !== null) this.zoomDelta += -(d - this._twoHandDist) * S.zoomSensitivity;
      this._twoHandDist = d;
    } else this._twoHandDist = null;

    // ── 3. Merge movement (keyboard + gesture/AI); ramp so nothing lurches ──
    const targetFwd = THREE.MathUtils.clamp(kForward + gForward, -1, 1);
    this._fwd += (targetFwd - this._fwd) * rampK;
    if (targetFwd === 0 && Math.abs(this._fwd) < 0.02) this._fwd = 0;   // no lingering creep
    this.pitch = THREE.MathUtils.clamp(this.pitch, -S.pitchMax, S.pitchMax);
    this._activeLayer = kbNav ? 'keyboard'
      : gestureNav ? 'gesture'
      : handReady ? 'hands (manip)'
      : 'idle';

    return {
      forward: this._fwd,
      strafe:  kStrafe,
      yaw:     this.yaw,        // ABSOLUTE
      pitch:   this.pitch,      // ABSOLUTE
      jump, sprint,
      zoom:    this.zoomDelta,  // FOV degrees to add (host applies)
      dolly,                    // metres to dolly forward/back this frame (host applies)
    };
  }

  _classify(lm) {
    const wrist = lm[0];
    const ext = (tipI, pipI) => {
      const dTip = Math.hypot(lm[tipI].x - wrist.x, lm[tipI].y - wrist.y);
      const dPip = Math.hypot(lm[pipI].x - wrist.x, lm[pipI].y - wrist.y);
      return dTip > dPip * 1.05;
    };
    const index = ext(8, 6), middle = ext(12, 10), ring = ext(16, 14), pinky = ext(20, 18);
    const n = [index, middle, ring, pinky].filter(Boolean).length;
    if (n === 0) return 'fist';
    if (n >= 4) return 'open';
    if (index && !middle && !ring && !pinky) return 'point';
    return 'relaxed';
  }

  get currentGesture() { return this._lastGesture; }
  get walkState() { return this._moving ? 'walk' : 'stop'; }
  get activeLayer() { return this._activeLayer || 'idle'; }
}
