// The infographic layer: a Vitruvian reticle around whatever the camera focuses on,
// leader-line labels for objects in the world, and callouts in the hangar.
import { esc } from '../game/util';
import { morphSvg } from './morph';

export interface OvLabel { k: string; x: number; y: number; title: string; sub?: string; col?: string; focus?: string; cls?: string }
export interface OvFocus { x: number; y: number; r: number; name: string; meas: string; detail: string; col: string; sunAng: number | null }
export interface OvCallout { x: number; y: number; title: string; sub: string; col: string; state: 'done' | 'now' | 'todo' }

const f1 = (n: number) => n.toFixed(1);

export class Overlay {
  el: SVGSVGElement;
  t0 = performance.now();
  constructor() { this.el = document.getElementById('ovl') as any; }
  clear() { if (this.el.innerHTML) this.el.innerHTML = ''; }

  draw(W: number, H: number, focus: OvFocus | null, labels: OvLabel[], callouts: OvCallout[] = []) {
    let s = '';
    this.header = null;
    if (focus) s += this.reticle(focus, W, H);
    s += this.labels(labels, focus);
    if (callouts.length) s += this.callouts(callouts, W, H);
    this.el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    morphSvg(this.el, s);
  }

  private reticle(f: OvFocus, W: number, H: number) {
    const R = Math.max(46, Math.min(Math.min(W, H) * 0.36, f.r * 1.22)), x = f.x, y = f.y, c = f.col;
    const t = (performance.now() - this.t0) / 1000;
    let s = `<g opacity="0.9">`;
    s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(R)}" fill="none" stroke="${c}" stroke-opacity=".55" stroke-width="1"/>`;
    // Graduated outer ring: a tick every 5°, longer every 30°.
    const R2 = R + 8;
    let ticks = '';
    for (let k = 0; k < 72; k++) {
      const a = k / 72 * Math.PI * 2, L = k % 6 === 0 ? 7 : 3, ca = Math.cos(a), sa = Math.sin(a);
      ticks += `M${f1(x + ca * R2)} ${f1(y + sa * R2)}L${f1(x + ca * (R2 + L))} ${f1(y + sa * (R2 + L))}`;
    }
    s += `<path d="${ticks}" stroke="${c}" stroke-opacity=".5" stroke-width="1"/>`;
    // Vitruvian square: corner brackets of the square that circumscribes the circle.
    const q = R + 2, b = Math.min(18, R * 0.3);
    s += `<path d="M${f1(x - q)} ${f1(y - q + b)}V${f1(y - q)}H${f1(x - q + b)}M${f1(x + q - b)} ${f1(y - q)}H${f1(x + q)}V${f1(y - q + b)}M${f1(x + q)} ${f1(y + q - b)}V${f1(y + q)}H${f1(x + q - b)}M${f1(x - q + b)} ${f1(y + q)}H${f1(x - q)}V${f1(y + q - b)}" fill="none" stroke="${c}" stroke-opacity=".8" stroke-width="1.2"/>`;
    // Diagonals of the square, faint construction lines.
    s += `<path d="M${f1(x - q)} ${f1(y - q)}L${f1(x - R * 0.72)} ${f1(y - R * 0.72)}M${f1(x + q)} ${f1(y + q)}L${f1(x + R * 0.72)} ${f1(y + R * 0.72)}M${f1(x + q)} ${f1(y - q)}L${f1(x + R * 0.72)} ${f1(y - R * 0.72)}M${f1(x - q)} ${f1(y + q)}L${f1(x - R * 0.72)} ${f1(y + R * 0.72)}" stroke="${c}" stroke-opacity=".28" stroke-dasharray="2 4"/>`;
    // Rotating sweep arc
    const a0 = t * 0.35, a1 = a0 + 0.9;
    s += `<path d="M${f1(x + Math.cos(a0) * (R - 5))} ${f1(y + Math.sin(a0) * (R - 5))}A${f1(R - 5)} ${f1(R - 5)} 0 0 1 ${f1(x + Math.cos(a1) * (R - 5))} ${f1(y + Math.sin(a1) * (R - 5))}" fill="none" stroke="${c}" stroke-width="2" stroke-opacity=".7"/>`;
    // Sun bearing
    if (f.sunAng != null) {
      const ca = Math.cos(f.sunAng), sa = Math.sin(f.sunAng), sx = x + ca * (R2 + 16), sy = y + sa * (R2 + 16);
      s += `<path d="M${f1(x + ca * (R2 + 2))} ${f1(y + sa * (R2 + 2))}L${f1(x + ca * (R2 + 10))} ${f1(y + sa * (R2 + 10))}" stroke="#ffd27a" stroke-width="2"/>`;
      s += `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="4" fill="none" stroke="#ffd27a"/><text x="${f1(sx + 8)}" y="${f1(sy + 4)}" fill="#ffd27a" font-size="11">Sun</text>`;
    }
    // Header: name, size, detail; to the right of the square, or to its left when the right panel is in the way.
    const tw = Math.max(f.name.length * 9, f.meas.length * 6.6, f.detail.length * 6.4) + 10;
    // Keep the header on the side it was on until it truly no longer fits (no flip-flopping).
    const fitsRight = x + q + 14 + tw < W - 420, fitsLeft = x - q - 14 - tw > 360;
    // When the square is too wide for either side (a body filling the view), the header sits inside its top-left corner.
    const inside = !fitsRight && !fitsLeft;
    const right = inside || (this.headerRight ? (fitsRight || !fitsLeft) : (!fitsLeft && fitsRight));
    if (!inside) this.headerRight = right;
    const hx = inside ? Math.max(372, x - q + 16) : right ? x + q + 14 : Math.max(360 + tw, x - q - 14);
    const hy = inside ? Math.max(112, y - q + 30) : Math.max(96, y - q), anc = right ? 'start' : 'end';
    this.header = right ? [hx, hy - 16, hx + tw, hy + 38] : [hx - tw, hy - 16, hx, hy + 38];
    if (!inside) s += `<path d="M${f1(right ? x + q : x - q)} ${f1(y - q)}L${f1(hx + (right ? -4 : 4))} ${f1(hy - 4)}" stroke="${c}" stroke-opacity=".5"/>`;
    s += `<text x="${f1(hx)}" y="${f1(hy + 2)}" text-anchor="${anc}" fill="#e4eeff" font-size="17" font-weight="600">${esc(f.name)}</text>`;
    s += `<text x="${f1(hx)}" y="${f1(hy + 19)}" text-anchor="${anc}" fill="${c}" font-size="12">${esc(f.meas)}</text>`;
    if (f.detail) s += `<text x="${f1(hx)}" y="${f1(hy + 34)}" text-anchor="${anc}" fill="#a9bfdf" font-size="12">${esc(f.detail)}</text>`;
    return s + '</g>';
  }

  private header: [number, number, number, number] | null = null;
  private headerRight = true;
  private side: Record<string, number> = {};
  private labels(ls: OvLabel[], focus: OvFocus | null) {
    const taken: [number, number, number, number][] = [];
    if (this.header) taken.push(this.header);
    let s = '';
    for (const l of ls) {
      const c = l.col || '#4da3ff';
      // Leader: up-right diagonal then a shelf the text sits on; flip left near the right panel,
      // with hysteresis so a label never jumps back and forth while the camera moves.
      const prev = this.side[l.k] ?? 1, edge = window.innerWidth - 420;
      const dx = prev === 1 ? (l.x > edge + 20 ? -1 : 1) : (l.x < edge - 60 ? 1 : -1);
      this.side[l.k] = dx;
      const flip = dx < 0;
      const tx = l.x + dx * 22, ty = l.y - 18;
      const w = 10 + Math.max(l.title.length * 7.2, (l.sub || '').length * 6.2);
      let box: [number, number, number, number] = flip ? [tx - w, ty - 16, tx, ty + 16] : [tx, ty - 16, tx + w, ty + 16];
      // A label that would overlap one already placed is hidden, never moved: labels stay put.
      if (taken.some(b => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
      taken.push(box);
      const act = l.focus ? ` class="hit" data-act="focus" data-v="${esc(l.focus)}"` : '';
      s += `<g${act}>`;
      s += `<circle cx="${f1(l.x)}" cy="${f1(l.y)}" r="3" fill="${c}"/><circle cx="${f1(l.x)}" cy="${f1(l.y)}" r="7" fill="none" stroke="${c}" stroke-opacity=".5"/>`;
      s += `<path d="M${f1(l.x + dx * 5)} ${f1(l.y - 5)}L${f1(tx)} ${f1(ty)}H${f1(tx + dx * w)}" fill="none" stroke="${c}" stroke-opacity=".75"/>`;
      if (l.focus) s += `<rect x="${f1(Math.min(tx, tx + dx * w))}" y="${f1(ty - 18)}" width="${f1(w)}" height="34" fill="transparent"/>`;
      const anchor = flip ? 'end' : 'start', ax = tx + dx * 3;
      s += `<text x="${f1(ax)}" y="${f1(ty - 5)}" text-anchor="${anchor}" fill="#e4eeff" font-size="13" font-family="Saira Semi Condensed, Arial Narrow, sans-serif" font-weight="600">${esc(l.title)}</text>`;
      if (l.sub) s += `<text x="${f1(ax)}" y="${f1(ty + 12)}" text-anchor="${anchor}" fill="${c}" font-size="11.5">${esc(l.sub)}</text>`;
      s += '</g>';
    }
    return s;
  }

  private callouts(cs: OvCallout[], W: number, H: number) {
    // Hangar: each module's anchor connects to a label stacked down the left side.
    const sorted = [...cs].sort((a, b) => a.y - b.y), x0 = 372, gap = 54;
    const top = Math.max(110, H / 2 - sorted.length * gap / 2);
    let s = '';
    sorted.forEach((c, i) => {
      const ly = top + i * gap, col = c.state === 'done' ? '#2fd6b5' : c.state === 'now' ? '#4fd2ff' : '#6f86a8';
      s += `<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="4" fill="none" stroke="${col}" stroke-width="1.5"/><circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="1.5" fill="${col}"/>`;
      s += `<path d="M${f1(c.x)} ${f1(c.y)}L${f1(x0 + 170)} ${f1(ly)}H${f1(x0)}" fill="none" stroke="${col}" stroke-opacity=".7" ${c.state === 'todo' ? 'stroke-dasharray="3 3"' : ''}/>`;
      s += `<text x="${f1(x0)}" y="${f1(ly - 6)}" fill="#e4eeff" font-size="14" font-family="Saira Semi Condensed, Arial Narrow, sans-serif" font-weight="600">${esc(c.title)}</text>`;
      s += `<text x="${f1(x0)}" y="${f1(ly + 13)}" fill="${col}" font-size="12">${esc(c.sub)}</text>`;
    });
    return s;
  }
}
