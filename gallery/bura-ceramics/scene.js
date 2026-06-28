// gallery/bura-ceramics/scene.js
// Mount the six Bura research panels as FIXED FRAMED PLACARDS on the gallery walls.
//
// Data -> fixed frame: each record in panels.json is rendered to a <canvas> by
// loader.js, wrapped as a THREE.CanvasTexture, and applied to a placard plane that
// is adopted into the live world (so it is labelled, selectable and movable like
// any other object). The frame is the fixed thing in the scene; only its surface
// texture is generated from the data file — no standalone posters are baked in.
//
// Run inside the world (AI run_script / dev console), where `world` and `THREE`
// are in scope:
//
//   const { mountBuraPlacards } = await import('./gallery/bura-ceramics/scene.js');
//   await mountBuraPlacards(world, THREE);                 // default wall row of 6
//   // or supply explicit placements (one per panel A..F):
//   await mountBuraPlacards(world, THREE, { placements: [...] });
//
// Re-running unmounts the previous set first (idempotent).

import { loadPanels, renderPanelToCanvas } from './loader.js';

// Resolve relative image URLs (./assets/...) against the panels.json directory,
// because fetch/Image resolve relative to the PAGE (world.html at the site root),
// not relative to this module.
function withResolvedImages(panel, baseDir) {
  if (!panel.images || !panel.images.length) return panel;
  const images = panel.images.map((im) => {
    if (!im.url || /^(https?:|data:|\/)/i.test(im.url)) return im;
    return { ...im, url: baseDir + im.url.replace(/^\.\//, '') };
  });
  return { ...panel, images };
}

// A default row of portrait placards centred on the origin, facing +Z.
// Override any of these via opts, or pass opts.placements for full control.
function defaultPlacements(n, opts = {}) {
  const w = opts.frameWidth ?? 1.1;       // metres (2:3 portrait -> height = w * 1.5)
  const h = opts.frameHeight ?? (w * 1.5);
  const gap = opts.gap ?? 0.55;
  const eye = opts.eye ?? 1.65;           // centre height off the floor
  const z = opts.z ?? -4.0;               // wall distance from origin
  const rotY = opts.rotationDeg ?? 0;     // wall facing (deg about Y)
  const ox = opts.originX ?? 0;
  const step = w + gap;
  const x0 = ox - ((n - 1) * step) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ position: [x0 + i * step, eye, z], rotationDeg: [0, rotY, 0], size: [w, h] });
  }
  return out;
}

const TAG = 'bura-placard';

/** Remove any placards mounted by a previous call (keeps the function idempotent). */
export function unmountBuraPlacards(world) {
  const assets = world.assets || [];
  for (const a of [...assets]) {
    if (a && a.source === TAG && typeof world.deleteObject === 'function') {
      world.deleteObject(a.id);
    }
  }
}

/**
 * @param {object} world  the WorldTemplate instance in scope
 * @param {object} THREE  the three.js namespace in scope
 * @param {object} [opts]
 * @param {string} [opts.dataUrl]      path to panels.json (default resolves to this folder)
 * @param {Array}  [opts.placements]   explicit per-panel placements (else a default wall row)
 * @param {number} [opts.frameWidth]   placard width in metres (default 1.1)
 * @param {number} [opts.gap]          gap between placards (default 0.55)
 * @param {number} [opts.eye]          centre height off floor (default 1.65)
 * @param {number} [opts.z]            wall distance (default -4.0)
 * @param {number} [opts.rotationDeg]  wall facing about Y (default 0)
 * @returns {Promise<string[]>} ids of the adopted placard objects, in panel order
 */
export async function mountBuraPlacards(world, THREE, opts = {}) {
  const dataUrl = opts.dataUrl || './gallery/bura-ceramics/panels.json';
  const baseDir = dataUrl.replace(/[^/]*$/, '');           // directory portion, trailing '/'
  const data = await loadPanels(dataUrl);
  const panels = data.panels || [];

  unmountBuraPlacards(world);

  const places = opts.placements || defaultPlacements(panels.length, opts);
  const ids = [];

  for (let i = 0; i < panels.length; i++) {
    const panel = withResolvedImages(panels[i], baseDir);
    const place = places[i] || places[places.length - 1] || { position: [i * 1.6, 1.65, -4], rotationDeg: [0, 0, 0], size: [1.1, 1.65] };

    // data -> texture (same canvas the preview shows)
    const canvas = await renderPanelToCanvas(panel, { width: 1024, height: 1536 });
    const tex = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;

    // fixed frame: a thin framed plane (matte board + dark frame edge)
    const [pw, ph] = place.size || [1.1, 1.65];
    const group = new THREE.Group();

    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, ph),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.0 })
    );
    board.receiveShadow = true;
    group.add(board);

    const frameDepth = 0.04;
    const frameEdge = new THREE.Mesh(
      new THREE.BoxGeometry(pw + 0.08, ph + 0.08, frameDepth),
      new THREE.MeshStandardMaterial({ color: 0x1c160e, roughness: 0.7, metalness: 0.1 })
    );
    frameEdge.position.z = -frameDepth / 2 - 0.001;
    frameEdge.castShadow = true;
    frameEdge.receiveShadow = true;
    group.add(frameEdge);

    group.position.fromArray(place.position);
    const r = place.rotationDeg || [0, 0, 0];
    group.rotation.set(
      (r[0] || 0) * Math.PI / 180,
      (r[1] || 0) * Math.PI / 180,
      (r[2] || 0) * Math.PI / 180
    );

    // adopt -> labelled, selectable, movable in the world like every other object
    const label = panel.placardLabel || `Bura Placard ${panel.id}`;
    const id = world.adopt(group, { label, source: TAG });
    ids.push(id);
  }

  return ids;
}

export default mountBuraPlacards;
