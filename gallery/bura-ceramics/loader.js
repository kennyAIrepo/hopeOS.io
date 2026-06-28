// gallery/bura-ceramics/loader.js
// Small, dependency-free loader + poster renderer for the Bura Ceramics panels.
//
// Design goal: render each panel to a <canvas>. That same canvas is what the
// 3D scene will later wrap as a THREE.CanvasTexture, so the preview you see
// here IS what the in-scene panel material will look like.
//
//   import { loadPanels, renderPanelToCanvas } from './loader.js';
//   const data = await loadPanels();                 // { collection, panels, bibliography }
//   const canvas = await renderPanelToCanvas(panel); // ready for new THREE.CanvasTexture(canvas)

// ---- data ------------------------------------------------------------------

export async function loadPanels(url = './panels.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`loadPanels: ${res.status} ${res.statusText} for ${url}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.panels)) throw new Error('loadPanels: malformed panels.json (no panels[])');
  return data;
}

// Pick the best image to feature on a poster: hero > supporting > reference.
export function pickHeroImage(panel) {
  const imgs = panel.images || [];
  const byRole = (r) => imgs.find((i) => i.role === r);
  return byRole('hero') || byRole('supporting') || byRole('reference') || imgs[0] || null;
}

// ---- palette ---------------------------------------------------------------
// design.palette is descriptive prose ("warm sepia ink on cream").
// Map keywords -> concrete colors so each poster reads on-brand.
const PALETTES = [
  { test: /sepia|cream/i,                    bg: '#efe4cf', panel: '#f6efe0', ink: '#4a3826', accent: '#8a5a2b', muted: '#7a6a52' },
  { test: /monochrome|grey|gray|archival/i,  bg: '#e7e7e7', panel: '#f2f2f2', ink: '#1f1f1f', accent: '#444444', muted: '#666666' },
  { test: /ink line|warm white/i,            bg: '#f3eee4', panel: '#fbf8f1', ink: '#2b2b2b', accent: '#7a4a1f', muted: '#6b6b6b' },
  { test: /earth|brown|sub-surface/i,        bg: '#d9c7ad', panel: '#e8dcc6', ink: '#3a2a17', accent: '#6b4a25', muted: '#5e4a33' },
  { test: /ochre|map/i,                      bg: '#e3d4ab', panel: '#efe3c2', ink: '#3f3318', accent: '#9a6b1f', muted: '#6f5d33' },
  { test: /museum|neutral/i,                 bg: '#e4e4e6', panel: '#f4f4f6', ink: '#26262b', accent: '#3a6ea5', muted: '#5c5c66' }
];
const PALETTE_DEFAULT = { bg: '#ece4d3', panel: '#f6efe0', ink: '#3b2f20', accent: '#8a5a2b', muted: '#6f6150' };
function paletteFor(panel) {
  const p = (panel.design && panel.design.palette) || '';
  return PALETTES.find((x) => x.test.test(p)) || PALETTE_DEFAULT;
}

// ---- image loading (best-effort; cross-origin images may fail) -------------
function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    // Only request CORS for absolute (cross-origin) URLs so same-origin canvases stay exportable.
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ---- text helpers ----------------------------------------------------------
function wrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function drawLines(ctx, lines, x, y, lh, max) {
  let yy = y;
  for (const l of lines) {
    if (max && yy > max) break;
    ctx.fillText(l, x, yy);
    yy += lh;
  }
  return yy;
}

// ---- the poster renderer ---------------------------------------------------
// Returns a <canvas>. Portrait poster, 2:3 (default 1024×1536 @ dpr 1).
export async function renderPanelToCanvas(panel, opts = {}) {
  const W = opts.width || 1024;
  const H = opts.height || 1536;
  const dpr = opts.dpr || 1;
  const canvas = opts.canvas || document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pal = paletteFor(panel);
  const M = 64;                 // outer margin
  const innerW = W - M * 2;

  // background + subtle vignette
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // panel card
  ctx.fillStyle = pal.panel;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  roundRect(ctx, M - 8, M - 8, innerW + 16, H - (M - 8) * 2, 10);
  ctx.fill();
  ctx.stroke();

  let y = M + 28;

  // first row intentionally left blank (panel code, status and divider removed) — kept for spacing
  y += 22;
  y += 44;

  // title
  ctx.fillStyle = pal.ink;
  ctx.font = '700 56px Georgia, serif';
  const tLines = wrap(ctx, panel.title, innerW);
  y = drawLines(ctx, tLines, M, y, 60) + 6;

  // subtitle
  if (panel.subtitle) {
    ctx.font = 'italic 26px Georgia, serif';
    ctx.fillStyle = pal.accent;
    y = drawLines(ctx, wrap(ctx, panel.subtitle, innerW), M, y, 32) + 10;
  }

  // hero image (best-effort) with caption
  const hero = pickHeroImage(panel);
  const imgH = panel.heroHeight || 420;
  const imgY = y;
  if (hero) {
    const img = await loadImage(hero.url);
    if (img) {
      drawCover(ctx, img, M, imgY, innerW, imgH, 6);
    } else {
      // placeholder: explains the intended illustration
      ctx.fillStyle = pal.panel;
      roundRect(ctx, M, imgY, innerW, imgH, 6);
      ctx.fill();
      ctx.fillStyle = pal.accent;
      ctx.font = '600 20px Helvetica, Arial, sans-serif';
      ctx.fillText('◇ ' + (panel.format || 'image'), M + 28, imgY + 48);
      ctx.fillStyle = pal.muted;
      ctx.font = '16px Helvetica, Arial, sans-serif';
      const note = (panel.design && panel.design.illustration) || hero.caption || 'artwork to be supplied';
      drawLines(ctx, wrap(ctx, note, innerW - 56), M + 28, imgY + 80, 22, imgY + imgH - 60);
    }
    // thin matting-style keyline border (copies the panel card / matting border)
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, M, imgY, innerW, imgH, 6);
    ctx.stroke();
    y = imgY + imgH + 8;
    // caption + license flag
    ctx.fillStyle = pal.muted;
    ctx.font = 'italic 14px Helvetica, Arial, sans-serif';
    const lic = hero.license ? `  ·  [${hero.license}]` : '';
    y = drawLines(ctx, wrap(ctx, (hero.caption || '') + lic, innerW), M, y + 14, 18, y + 56) + 14;
  }

  // description
  ctx.fillStyle = pal.ink;
  ctx.font = '22px Georgia, serif';
  y = drawLines(ctx, wrap(ctx, panel.description, innerW), M, y + 8, 30, H - 320) + 18;

  // key facts
  if (panel.keyFacts && panel.keyFacts.length) {
    ctx.fillStyle = pal.accent;
    ctx.font = '700 18px Helvetica, Arial, sans-serif';
    ctx.fillText('KEY FACTS', M, y);
    y += 26;
    ctx.fillStyle = pal.ink;
    ctx.font = '17px Helvetica, Arial, sans-serif';
    for (const f of panel.keyFacts) {
      if (y > H - 150) break;
      const fl = wrap(ctx, '•  ' + f, innerW - 12);
      y = drawLines(ctx, fl, M, y, 22) + 4;
    }
  }

  // footer: sources (canvas-baked attribution; preview overlays clickable links instead).
  // Pass opts.drawSources === false to omit this line (e.g. when HTML links render it).
  if (opts.drawSources !== false) {
    const srcs = (panel.sources || []).map((s) => s.name || s.publisher).filter(Boolean);
    ctx.fillStyle = pal.muted;
    ctx.font = '13px Helvetica, Arial, sans-serif';
    const srcLine = srcs.length ? 'Sources: ' + srcs.join(' · ') : '';
    drawLines(ctx, wrap(ctx, srcLine, innerW), M, H - M - 14, 16, H - M);
  }

  return canvas;
}

// ---- canvas geometry helpers ----------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawCover(ctx, img, x, y, w, h, r) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const ir = img.width / img.height;
  const fr = w / h;
  let dw = w, dh = h, dx = x, dy = y;
  if (ir > fr) { dw = h * ir; dx = x - (dw - w) / 2; }
  else { dh = w / ir; dy = y - (dh - h) / 2; }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}
