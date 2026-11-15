// Field maps: a shaded chart of a region (sea depth and coast on Earth, relief on Mars) drawn once
// to an offscreen canvas, then a pannable, zoomable view with the blueprint grid on top.
import { Region, XY, pointInPoly, fbm } from './world';

const cache = new Map<string, HTMLCanvasElement>();

/** Render a region's base chart (N×N pixels). Earth uses a fast distance transform for depth. */
export function baseChart(r: Region, N = 640): HTMLCanvasElement {
  const key = r.id + ':' + N;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d')!, img = ctx.createImageData(N, N), d = img.data;
  const px = (i: number) => -r.half + 2 * r.half * (i + 0.5) / N, py = (j: number) => r.half - 2 * r.half * (j + 0.5) / N;
  const kmPerPx = 2 * r.half / N;
  if (r.loc === 'earth') {
    const land = new Uint8Array(N * N), bank = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = px(i), y = py(j);
      land[j * N + i] = r.land.some(pl => pointInPoly(x, y, pl)) ? 1 : 0;
      bank[j * N + i] = r.banks.some(pl => pointInPoly(x, y, pl)) ? 1 : 0;
    }
    // Chamfer distance (in pixels) from land, for the continental shelf and deep water.
    const D = new Float32Array(N * N).fill(1e9);
    for (let k = 0; k < N * N; k++) if (land[k]) D[k] = 0;
    const a = 1, b = Math.SQRT2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i; let v = D[k];
      if (i > 0) v = Math.min(v, D[k - 1] + a);
      if (j > 0) { v = Math.min(v, D[k - N] + a); if (i > 0) v = Math.min(v, D[k - N - 1] + b); if (i < N - 1) v = Math.min(v, D[k - N + 1] + b); }
      D[k] = v;
    }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i; let v = D[k];
      if (i < N - 1) v = Math.min(v, D[k + 1] + a);
      if (j < N - 1) { v = Math.min(v, D[k + N] + a); if (i < N - 1) v = Math.min(v, D[k + N + 1] + b); if (i > 0) v = Math.min(v, D[k + N - 1] + b); }
      D[k] = v;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, o = k * 4, x = px(i), y = py(j), n = fbm(x / 30, y / 30, 5);
      if (land[k]) {
        const g = 0.5 + 0.5 * fbm(x / 18, y / 18, 3);
        d[o] = 22 + 14 * g; d[o + 1] = 38 + 18 * g; d[o + 2] = 44 + 12 * g;
      } else {
        const km = D[k] * kmPerPx, deep = bank[k] ? 0.05 : Math.min(1, km / 70) ** 0.7;
        const lit = 1 - deep;
        d[o] = 6 + 18 * lit + 6 * n; d[o + 1] = 22 + 46 * lit + 8 * n; d[o + 2] = 44 + 62 * lit + 10 * n;
        if (bank[k]) { d[o] += 8; d[o + 1] += 30; d[o + 2] += 26; }
      }
      d[o + 3] = 255;
    }
  } else {
    // Mars: height, then a hillshade lit from the north-west, coloured by elevation.
    const H = new Float32Array(N * N);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const h = r.heightAt(px(i), py(j)); H[j * N + i] = h; if (h < lo) lo = h; if (h > hi) hi = h; }
    const zk = 1 / (kmPerPx * 1000) * 9;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, o = k * 4;
      const dx = (H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)]) * zk, dy = (H[Math.max(0, j - 1) * N + i] - H[Math.min(N - 1, j + 1) * N + i]) * zk;
      const nl = Math.hypot(dx, dy, 1), shade = Math.max(0, (-dx * -0.6 + -dy * 0.6 + 1 * 0.55) / nl / 1.05);
      const e = (H[k] - lo) / (hi - lo);
      const base = [70 + 70 * e, 34 + 34 * e, 22 + 18 * e];
      const s = 0.45 + 0.85 * shade;
      d[o] = base[0] * s; d[o + 1] = base[1] * s; d[o + 2] = base[2] * s; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cache.set(key, cv);
  return cv;
}

/** A map view: region kilometres to screen pixels, with pan and zoom. */
export class MapView {
  cx = 0; cy = 0; zoom = 1; W = 800; H = 600;
  /** Screen rectangle the map is centred in (leaves room for panels). */
  box = { x: 0, y: 0, w: 800, h: 600 };
  constructor(public r: Region) {}
  get scale() { return Math.min(this.box.w, this.box.h) / (2 * this.r.half) * this.zoom * 0.94; }
  toScr(p: XY) { const s = this.scale; return { x: this.box.x + this.box.w / 2 + (p.x - this.cx) * s, y: this.box.y + this.box.h / 2 - (p.y - this.cy) * s }; }
  toKm(x: number, y: number): XY { const s = this.scale; return { x: this.cx + (x - this.box.x - this.box.w / 2) / s, y: this.cy - (y - this.box.y - this.box.h / 2) / s }; }
  zoomAt(f: number, x: number, y: number) {
    const before = this.toKm(x, y);
    this.zoom = Math.max(1, Math.min(14, this.zoom * f));
    const after = this.toKm(x, y);
    this.cx += before.x - after.x; this.cy += before.y - after.y;
    this.clampPan();
  }
  pan(dx: number, dy: number) { const s = this.scale; this.cx -= dx / s; this.cy += dy / s; this.clampPan(); }
  clampPan() { const m = this.r.half * (1 - 1 / this.zoom); this.cx = Math.max(-m, Math.min(m, this.cx)); this.cy = Math.max(-m, Math.min(m, this.cy)); }
  focus(p: XY, zoom: number) { this.zoom = zoom; this.cx = p.x; this.cy = p.y; this.clampPan(); }

  /** Chart, grid and coast. */
  drawBase(ctx: CanvasRenderingContext2D, chart: HTMLCanvasElement) {
    const r = this.r, a = this.toScr({ x: -r.half, y: r.half }), b = this.toScr({ x: r.half, y: -r.half });
    ctx.fillStyle = '#050c1a'; ctx.fillRect(0, 0, this.W, this.H);
    ctx.save(); ctx.beginPath(); ctx.rect(this.box.x, this.box.y, this.box.w, this.box.h); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(chart, a.x, a.y, b.x - a.x, b.y - a.y);
    // Grid: a step that keeps lines 60–140 px apart.
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200];
    const step = steps.find(s => s * this.scale > 70) || 200;
    ctx.lineWidth = 1; ctx.font = '500 10px "Saira Semi Condensed", "Arial Narrow", sans-serif'; ctx.fillStyle = 'rgba(169,191,223,.55)';
    ctx.strokeStyle = 'rgba(106,168,255,.13)';
    ctx.beginPath();
    for (let x = Math.ceil(-r.half / step) * step; x <= r.half; x += step) { const p = this.toScr({ x, y: 0 }); ctx.moveTo(Math.round(p.x) + .5, a.y); ctx.lineTo(Math.round(p.x) + .5, b.y); }
    for (let y = Math.ceil(-r.half / step) * step; y <= r.half; y += step) { const p = this.toScr({ x: 0, y }); ctx.moveTo(a.x, Math.round(p.y) + .5); ctx.lineTo(b.x, Math.round(p.y) + .5); }
    ctx.stroke();
    // Frame.
    ctx.strokeStyle = 'rgba(106,168,255,.45)'; ctx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(b.x - a.x), Math.round(b.y - a.y));
    // Coast as a crisp line over the soft chart.
    if (r.land.length) {
      ctx.strokeStyle = 'rgba(160,205,255,.55)'; ctx.lineWidth = 1;
      for (const pl of r.land) {
        ctx.beginPath();
        pl.forEach(([x, y], i) => { const p = this.toScr({ x, y }); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.closePath(); ctx.stroke();
      }
    }
    // Scale bar.
    const sb = steps.find(s => s * this.scale > 90) || step, x0 = this.box.x + 18, y0 = this.box.y + this.box.h - 22;
    ctx.strokeStyle = 'rgba(169,191,223,.8)'; ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + sb * this.scale, y0); ctx.lineTo(x0 + sb * this.scale, y0 - 4); ctx.stroke();
    ctx.fillStyle = 'rgba(169,191,223,.9)'; ctx.fillText(sb + ' km', x0 + sb * this.scale + 6, y0 + 3);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- drawing helpers
export const COL = { blue: '#4da3ff', cyan: '#4fd2ff', teal: '#2fd6b5', violet: '#b48cff', amber: '#ffb13d', coral: '#ff6b5a', ink: '#e4eeff', ink2: '#a9bfdf', dim: '#6f86a8' };
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, col = COL.ink, size = 12, weight = 600, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${size}px "Saira Semi Condensed", "Arial Narrow", sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,12,26,.85)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = col; ctx.fillText(text, x, y);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
export function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, col: string, size = 9, fill = true) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-ang);
  ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, size * 0.65); ctx.lineTo(-size * 0.35, 0); ctx.lineTo(-size * 0.7, -size * 0.65); ctx.closePath();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(5,12,26,.9)'; ctx.stroke();
  if (fill) { ctx.fillStyle = col; ctx.fill(); } else { ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke(); }
  ctx.restore();
}
export function ellipsePath(ctx: CanvasRenderingContext2D, v: MapView, c: XY, a: number, b: number, heading: number) {
  const s = v.scale, p = v.toScr(c);
  ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(0.5, a * s), Math.max(0.5, b * s), -heading, 0, Math.PI * 2);
}
