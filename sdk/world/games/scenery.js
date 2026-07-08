/**
 * hopeOS SDK — Games · Arcade Scenery
 * ═══════════════════════════════════════════════════════════════
 * Turns the host world into a holographic flight deck for the duration of a game:
 *   • swaps the gallery model + skybox out for deep space (restored on exit)
 *   • a streaming starfield + neon tunnel rings rush PAST the planted player, so it
 *     feels like flying forward through a static body while objects fly to you
 *   • holographic, futuristic note/object materials (fresnel + scanlines, additive glow)
 *   • optional Sketchfab skybox / backdrop model carried on the spec (graceful: falls
 *     back to the procedural space if none / offline)
 *
 * Lives in its OWN group on the scene (separate from the per-round game field), so the
 * backdrop persists across replays and never gets cleared with the notes.
 */
import * as THREE from 'three';

// ── holographic material (fresnel rim + travelling scanlines, additive) ──
const HOLO_VERT = `
varying vec3 vN, vV; varying float vY;
void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0);
  vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }`;
const HOLO_FRAG = `
uniform float uTime; uniform vec3 uColor; uniform float uGlow;
varying vec3 vN, vV; varying float vY;
void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.0);              // fresnel rim
  float scan = sin(vY * 60.0 - uTime * 6.0) * 0.12 + 0.88;          // holographic scanlines
  vec3 c = uColor * (0.35 + f * 1.1) * scan + uColor * uGlow;
  gl_FragColor = vec4(c, 0.30 + f * 0.6 + uGlow * 0.2); }`;

export function holoMaterial(color = 0x39ff5a, glow = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uGlow: { value: glow } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

/** A holographic note: glowing crystal core + bright wireframe shell. Color on userData. */
export function makeHoloNote(size, color) {
  const mat = holoMaterial(color, 0.0);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.78, 0), mat);
  const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(size * 0.9, 0)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  core.add(wire);
  core.userData.color = color; core.userData.holo = mat;
  return core;
}

/** A bomb: angry red spiky core that pulses — visibly "do not touch". */
export function makeBomb(size) {
  const mat = holoMaterial(0xff2436, 0.25);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 0.66, 0), mat);
  const spikes = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 0.95, 1),
    new THREE.MeshBasicMaterial({ color: 0xff2436, wireframe: true, transparent: true, opacity: 0.55 }));
  core.add(spikes);
  core.userData.color = 0xff2436; core.userData.holo = mat; core.userData.bomb = true;
  return core;
}

/** Dispose a note/object built above (traverses children). */
export function disposeObj(obj) {
  obj.traverse(o => { o.geometry?.dispose?.(); const m = o.material; if (Array.isArray(m)) m.forEach(x => x.dispose()); else m?.dispose?.(); });
}

const STAR_COUNT = 700;
const TUNNEL_RINGS = 14;

export class ArcadeScenery {
  constructor({ world, hope, scene }) { this.world = world; this.hope = hope; this.scene = scene || hope.scene; this.group = null; this._saved = null; this._holos = []; }

  /** Swap the world out for space. `palette` = base hue for the tunnel/grid. */
  enter(palette = 0x36c6ff) {
    const sc = this.scene, w = this.world, r = this.hope.renderer;
    this._saved = { background: sc.background, fog: sc.fog,
      modelVisible: w.model ? w.model.visible : null, skyboxVisible: w._skybox ? w._skybox.visible : null,
      exposure: r ? r.toneMappingExposure : null };
    if (w.model) w.model.visible = false;
    if (w._skybox) w._skybox.visible = false;
    sc.background = new THREE.Color(0x03040b);
    sc.fog = new THREE.FogExp2(0x04060f, 0.014);
    if (r) r.toneMappingExposure = 1.15;

    this.group = new THREE.Group(); this.group.name = 'arcadeScenery'; sc.add(this.group);
    this.far = 60; this.speed = 14;                       // flight speed (m/s of the world rushing past)
    this._buildStars(); this._buildTunnel(palette);
    this.palette = palette;
  }

  _buildStars() {
    const pos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const a = (i * 2.3999632) % (Math.PI * 2), rad = 1.5 + Math.sqrt((i % 97) / 97) * 14;
      pos[i * 3] = Math.cos(a) * rad; pos[i * 3 + 1] = Math.sin(a) * rad * 0.6;
      pos[i * 3 + 2] = -((i / STAR_COUNT) * this.far);    // spread along the tunnel (local -Z = forward)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfe9ff, size: 0.06, sizeAttenuation: true,
      transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(this.stars);
  }
  _buildTunnel(palette) {
    this.rings = [];
    for (let i = 0; i < TUNNEL_RINGS; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.03, 6, 56),
        new THREE.MeshBasicMaterial({ color: palette, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.z = -(i / TUNNEL_RINGS) * this.far;
      this.group.add(ring); this.rings.push(ring);
    }
  }

  /** Stream the field past the planted eye → forward-travel illusion. */
  update(dt, eye, basis) {
    if (!this.group) return;
    // orient the local frame so local -Z = forward, +Y = up, +X = right
    const m = new THREE.Matrix4().makeBasis(basis.right, basis.up, basis.f.clone().negate());
    this.group.position.copy(eye); this.group.quaternion.setFromRotationMatrix(m);

    const adv = this.speed * dt;
    // stars
    const p = this.stars.geometry.getAttribute('position'); const arr = p.array;
    for (let i = 0; i < STAR_COUNT; i++) { let z = arr[i * 3 + 2] + adv; if (z > 1.5) z -= this.far; arr[i * 3 + 2] = z; }
    p.needsUpdate = true;
    // tunnel rings (fade as they pass)
    for (const ring of this.rings) { let z = ring.position.z + adv; if (z > 1.5) z -= this.far; ring.position.z = z;
      const depth = -z / this.far; ring.material.opacity = 0.12 + 0.5 * (1 - Math.min(1, depth)); ring.rotation.z += dt * 0.25; }
    // pulse holo materials registered by the game
    for (const mat of this._holos) if (mat.uniforms) mat.uniforms.uTime.value += dt;
  }

  registerHolo(mat) { if (mat && mat.uniforms) this._holos.push(mat); }
  unregisterHolo(mat) { const i = this._holos.indexOf(mat); if (i >= 0) this._holos.splice(i, 1); }

  exit() {
    const sc = this.scene, w = this.world, r = this.hope.renderer, s = this._saved;
    if (this.group) { sc.remove(this.group); this.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); this.group = null; }
    this._holos = [];
    if (s) {
      sc.background = s.background; sc.fog = s.fog;
      if (w.model && s.modelVisible != null) w.model.visible = s.modelVisible;
      if (w._skybox && s.skyboxVisible != null) w._skybox.visible = s.skyboxVisible;
      if (r && s.exposure != null) r.toneMappingExposure = s.exposure;
    }
    this._saved = null;
  }
}

export default ArcadeScenery;
