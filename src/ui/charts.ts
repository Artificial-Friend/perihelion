// Small SVG infographics used in the panels. Every chart is pure markup built from data.
import { esc, fmtClock } from '../game/util';
import type { PassInfo, RecoveryEvent } from '../game/ground';
import type { LatLon } from '../game/util';
import { DEG } from '../sim/core';

const f = (n: number) => n.toFixed(1);
const BLUE = '#4da3ff', AMBER = '#ffb13d', TEAL = '#2fd6b5', DIM = '#6f86a8', INK2 = '#a9bfdf', CORAL = '#ff6b5a';

/** Progress ring with an inner Vitruvian square. */
export function ring(p: number, size = 54, col = BLUE, label = '') {
  const r = size / 2 - 4, c = size / 2, a = Math.max(0.0001, Math.min(1, p)) * Math.PI * 2 - Math.PI / 2;
  const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r, large = p > 0.5 ? 1 : 0, q = r * 0.62;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(106,168,255,.2)" stroke-width="3"/>`
    + (p >= 1 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="3"/>` : p > 0 ? `<path d="M${c} ${c - r}A${r} ${r} 0 ${large} 1 ${f(x)} ${f(y)}" fill="none" stroke="${col}" stroke-width="3"/>` : '')
    + `<rect x="${f(c - q)}" y="${f(c - q)}" width="${f(q * 2)}" height="${f(q * 2)}" fill="none" stroke="rgba(106,168,255,.35)"/>`
    + `<text x="${c}" y="${c + 5}" text-anchor="middle" fill="#e4eeff" font-size="14" font-family="Saira Semi Condensed, Arial Narrow, sans-serif" font-weight="600">${label || Math.round(p * 100) + '%'}</text></svg>`;
}

/** Company emblem: circle in a square, the licence colour on the circle. */
export function emblem(col: string, size = 34) {
  const c = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="2" y="2" width="${size - 4}" height="${size - 4}" fill="none" stroke="${BLUE}" stroke-opacity=".7"/><circle cx="${c}" cy="${c}" r="${c - 5}" fill="none" stroke="${col}" stroke-width="1.6"/><path d="M${c} 2V${size - 2}M2 ${c}H${size - 2}" stroke="${BLUE}" stroke-opacity=".35"/><circle cx="${c}" cy="${c}" r="2.5" fill="${col}"/></svg>`;
}

/** The five stages as connected nodes. */
export function stageTrack(stages: { n: number; name: string; col: string }[], unlocked: number, current: number) {
  const W = 470, gap = (W - 40) / (stages.length - 1);
  let s = `<svg width="${W}" height="46" viewBox="0 0 ${W} 46">`;
  s += `<path d="M20 16H${W - 20}" stroke="rgba(106,168,255,.25)"/>`;
  s += `<path d="M20 16H${f(20 + gap * (Math.min(unlocked, 5) - 1))}" stroke="${BLUE}" stroke-width="1.5"/>`;
  stages.forEach((st, i) => {
    const x = 20 + i * gap, open = st.n <= unlocked && st.n <= 4, cur = st.n === current, col = open ? st.col : DIM;
    s += `<g class="node${open ? '' : ' locked'}" ${open ? `data-act="layer" data-v="${st.n}"` : ''}>`;
    s += `<rect x="${f(x - 40)}" y="0" width="80" height="46" fill="transparent"/>`;
    if (cur) s += `<circle cx="${f(x)}" cy="16" r="12" fill="none" stroke="${col}" stroke-opacity=".6"/>`;
    s += `<rect x="${f(x - 6)}" y="10" width="12" height="12" transform="rotate(45 ${f(x)} 16)" fill="${open ? (cur ? col : 'rgba(5,12,26,.9)') : 'rgba(5,12,26,.9)'}" stroke="${col}"/>`;
    s += `<text x="${f(x)}" y="42" text-anchor="middle" fill="${cur ? '#e4eeff' : open ? INK2 : '#8aa0c0'}" font-size="13" class="halo" font-family="Saira Semi Condensed, Arial Narrow, sans-serif" font-weight="${cur ? 600 : 500}">${st.n} ${esc(st.name)}</text></g>`;
  });
  return s + '</svg>';
}

/** Satellite passes as elevation arcs on a time axis. Click an arc to book. */
export function passTimeline(list: PassInfo[], t: number, W = 356, H = 132) {
  const t0 = t - 300, t1 = t + 3600, x = (tt: number) => 8 + (tt - t0) / (t1 - t0) * (W - 16), base = H - 22, top = 16;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}">`;
  for (let k = 0; k <= 60; k += 10) {
    const xx = x(t + k * 60);
    s += `<path d="M${f(xx)} ${base}V${base + 4}" stroke="${DIM}"/><text x="${f(xx)}" y="${H - 6}" text-anchor="middle" fill="${DIM}" font-size="10">${k ? '+' + k + 'm' : 'now'}</text>`;
  }
  for (const el of [30, 60, 90]) { const yy = base - (base - top) * el / 90; s += `<path d="M8 ${f(yy)}H${W - 8}" stroke="rgba(106,168,255,.1)"/><text x="${W - 8}" y="${f(yy - 2)}" text-anchor="end" fill="${DIM}" font-size="9">${el}°</text>`; }
  s += `<path d="M8 ${base}H${W - 8}" stroke="rgba(106,168,255,.4)"/>`;
  for (const p of list) {
    if (p.set < t0 || p.rise > t1) continue;
    const a = x(p.rise), b = x(p.set), h = (base - top) * p.maxEl / 90, mid = (a + b) / 2;
    const col = p.booked ? AMBER : p.conflict ? DIM : BLUE, op = p.state === 'done' ? 0.35 : 1;
    const act = p.state === 'future' && !p.conflict ? ` class="hit" data-act="book" data-v="${esc(p.id)}" style="cursor:pointer"` : '';
    s += `<g${act} opacity="${op}"><path d="M${f(a)} ${base}Q${f(mid)} ${f(base - h * 2)} ${f(b)} ${base}Z" fill="${col}" fill-opacity="${p.booked ? 0.28 : 0.12}" stroke="${col}" stroke-width="${p.state === 'live' ? 2 : 1}"/>`;
    if (b - a > 26) s += `<text x="${f(mid)}" y="${f(base - h - 4)}" text-anchor="middle" fill="${col}" font-size="10">¤${(p.pay / 1000).toFixed(1)}k</text>`;
    s += '</g>';
  }
  s += `<path d="M${f(x(t))} ${top - 6}V${base}" stroke="${TEAL}" stroke-width="1.5"/><text x="${f(x(t) + 3)}" y="${top - 2}" fill="${TEAL}" font-size="10">now</text>`;
  return s + '</svg>';
}

/** Local sea chart: port, predicted zone, boat, actual (unknown) hidden. */
export function seaChart(port: LatLon, sea: number, ev: RecoveryEvent | null, pred: { centre: LatLon; radiusKm: number } | null, boat: { pos: LatLon; to?: LatLon } | null, tLeft: number, total: number, W = 356, H = 210) {
  const cx = 60, cy = H / 2, scale = 2.4; // px per km
  const toXY = (p: LatLon) => {
    const e = (p.lon - port.lon) * 111 * Math.cos(port.lat * DEG), n = (p.lat - port.lat) * 111;
    // rotate so the sea bearing points right
    const b = sea * DEG, along = e * Math.sin(b) + n * Math.cos(b), across = e * Math.cos(b) - n * Math.sin(b);
    return [cx + along * scale, cy + across * scale];
  };
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}">`;
  for (const km of [20, 40, 60, 80, 100, 120]) s += `<circle cx="${cx}" cy="${cy}" r="${km * scale}" fill="none" stroke="rgba(106,168,255,${km % 40 ? 0.08 : 0.18})"/>` + (km % 40 ? '' : `<text x="${cx + km * scale - 2}" y="${cy - 3}" text-anchor="end" fill="${DIM}" font-size="9">${km} km</text>`);
  s += `<path d="M${cx} 0V${H}" stroke="rgba(123,227,160,.35)" stroke-dasharray="4 4"/><text x="${cx - 6}" y="14" text-anchor="end" fill="${INK2}" font-size="10">coast</text>`;
  s += `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="${BLUE}" transform="rotate(45 ${cx} ${cy})"/><text x="${cx - 10}" y="${cy + 4}" text-anchor="end" fill="${BLUE}" font-size="10">port</text>`;
  if (pred) {
    const [x, y] = toXY(pred.centre), r = pred.radiusKm * scale;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="rgba(255,138,92,.1)" stroke="#ff8a5c" stroke-dasharray="4 3"/><path d="M${f(x - 5)} ${f(y)}H${f(x + 5)}M${f(x)} ${f(y - 5)}V${f(y + 5)}" stroke="#ff8a5c"/>`;
    s += `<text x="${f(x + r + 4)}" y="${f(y + 4)}" fill="#ff8a5c" font-size="10">${Math.round(pred.radiusKm * 2)} km zone</text>`;
  }
  if (boat) {
    const [x, y] = toXY(boat.pos);
    if (boat.to) { const [tx, ty] = toXY(boat.to); s += `<path d="M${f(x)} ${f(y)}L${f(tx)} ${f(ty)}" stroke="${TEAL}" stroke-dasharray="3 3"/>`; }
    s += `<path d="M${f(x)} ${f(y - 6)}L${f(x + 5)} ${f(y + 4)}L${f(x - 5)} ${f(y + 4)}Z" fill="${TEAL}"/><text x="${f(x + 8)}" y="${f(y - 4)}" fill="${TEAL}" font-size="10">boat</text>`;
  }
  if (ev) {
    // Countdown ring, top right.
    const k = Math.max(0, Math.min(1, tLeft / total)), R = 26, x0 = W - 36, y0 = 36, a = -Math.PI / 2 + k * Math.PI * 2;
    s += `<circle cx="${x0}" cy="${y0}" r="${R}" fill="rgba(5,12,26,.6)" stroke="rgba(106,168,255,.2)" stroke-width="3"/>`;
    if (k > 0) s += `<path d="M${x0} ${y0 - R}A${R} ${R} 0 ${k > 0.5 ? 1 : 0} 1 ${f(x0 + Math.cos(a) * R)} ${f(y0 + Math.sin(a) * R)}" fill="none" stroke="#ff8a5c" stroke-width="3"/>`;
    s += `<text x="${x0}" y="${y0 + 4}" text-anchor="middle" fill="#e4eeff" font-size="12" font-weight="600">${fmtClock(tLeft)}</text>`;
  }
  return s + '</svg>';
}

/** Flight-plan chart: Δv against flight time, the three plans marked. */
export function planChart(plans: { id: string; label: string; tof: number; dv: number }[], cols: Record<string, string>, W = 356, H = 120) {
  if (!plans.length) return '';
  const maxT = Math.max(...plans.map(p => p.tof)) * 1.15, maxV = Math.max(...plans.map(p => p.dv)) * 1.2;
  const X = (t: number) => 34 + t / maxT * (W - 50), Y = (v: number) => H - 22 - Math.sqrt(v / maxV) * (H - 40);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}"><path d="M34 10V${H - 22}H${W - 10}" fill="none" stroke="rgba(106,168,255,.4)"/>`;
  s += `<text x="${W - 10}" y="${H - 6}" text-anchor="end" fill="${DIM}" font-size="10">flight time</text><text x="4" y="14" fill="${DIM}" font-size="10">Δv</text>`;
  const sorted = [...plans].sort((a, b) => a.tof - b.tof);
  s += `<path d="${sorted.map((p, i) => (i ? 'L' : 'M') + f(X(p.tof)) + ' ' + f(Y(p.dv))).join('')}" fill="none" stroke="rgba(106,168,255,.5)" stroke-dasharray="3 3"/>`;
  for (const p of plans) {
    const c = cols[p.id] || BLUE;
    s += `<g class="hit" data-act="plan" data-v="${p.id}" style="cursor:pointer"><circle cx="${f(X(p.tof))}" cy="${f(Y(p.dv))}" r="6" fill="${c}" fill-opacity=".25" stroke="${c}"/><text x="${f(X(p.tof))}" y="${f(Y(p.dv) - 10)}" text-anchor="middle" fill="${c}" font-size="11">${esc(p.label)}</text></g>`;
  }
  return s + '</svg>';
}

/** Where a Stage 2 target sits relative to Haven: along-track (x) and height (y). */
export function targetChart(aheadKm: number, upKm: number, W = 340, H = 70) {
  const X = (km: number) => W / 2 + km / 16 * (W / 2 - 20), Y = (km: number) => H / 2 - km / 4 * (H / 2 - 10);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}"><path d="M10 ${H / 2}H${W - 10}" stroke="rgba(106,168,255,.35)"/><path d="M${W - 16} ${H / 2 - 4}L${W - 10} ${H / 2}L${W - 16} ${H / 2 + 4}" fill="none" stroke="rgba(106,168,255,.5)"/>`;
  s += `<text x="${W - 10}" y="${H / 2 - 8}" text-anchor="end" fill="${DIM}" font-size="9">direction of flight</text>`;
  s += `<circle cx="${W / 2}" cy="${H / 2}" r="4" fill="${BLUE}"/><text x="${W / 2}" y="${H / 2 + 16}" text-anchor="middle" fill="${BLUE}" font-size="10">you</text>`;
  const tx = X(aheadKm), ty = Y(upKm);
  s += `<path d="M${W / 2} ${H / 2}L${f(tx)} ${f(ty)}" stroke="${AMBER}" stroke-dasharray="3 3"/><rect x="${f(tx - 4)}" y="${f(ty - 4)}" width="8" height="8" fill="${AMBER}" transform="rotate(45 ${f(tx)} ${f(ty)})"/>`;
  s += `<text x="${f(tx)}" y="${f(ty - 8)}" text-anchor="middle" fill="${AMBER}" font-size="10">${aheadKm > 0 ? aheadKm + ' km ahead' : -aheadKm + ' km behind'}${upKm ? ', ' + (upKm > 0 ? '+' : '') + upKm + ' km' : ''}</text>`;
  return s + '</svg>';
}

/** Top-down inner solar system on a compressed radial scale. */
export function systemMap(bodies: { id: string; name: string; p: number[]; col: string; orbitAU?: number }[], ship: number[] | null, path: number[][], here: string | null, W = 356, H = 250) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 12;
  const rs = (au: number) => R * Math.pow(au / 3, 0.5);
  const toXY = (p: number[]) => { const au = Math.hypot(p[0], p[1]) / 1.496e8, a = Math.atan2(p[1], p[0]), r = rs(au); return [cx + Math.cos(a) * r, cy - Math.sin(a) * r]; };
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}">`;
  for (const au of [0.5, 1, 1.52, 2.77]) s += `<circle cx="${cx}" cy="${cy}" r="${f(rs(au))}" fill="none" stroke="rgba(106,168,255,${au === 1 ? 0.3 : 0.15})" ${au === 2.77 ? 'stroke-dasharray="2 4"' : ''}/>`;
  s += `<text x="${f(cx + rs(1) + 3)}" y="${cy - 3}" fill="${DIM}" font-size="9">1 AU</text><text x="${f(cx + rs(2.77) - 3)}" y="${cy - 3}" text-anchor="end" fill="${DIM}" font-size="9">belt</text>`;
  s += `<circle cx="${cx}" cy="${cy}" r="5" fill="#ffd27a"/>`;
  if (path.length) s += `<path d="${path.map((p, i) => { const [x, y] = toXY(p); return (i ? 'L' : 'M') + f(x) + ' ' + f(y); }).join('')}" fill="none" stroke="#b48cff" stroke-width="1.5"/>`;
  const seen: number[][] = [];
  for (const b of bodies) {
    const [x, y] = toXY(b.p), w = b.name.length * 6 + 8, close = seen.some(([a, c, ww]) => x + 7 < a + ww && a < x + 7 + w && Math.abs(c - y) < 12);
    if (!close) seen.push([x + 7, y, w]);
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${b.id === here ? 5 : 3.5}" fill="${b.col}" ${b.id === here ? 'stroke="#fff"' : ''}/>`;
    if (!close) s += `<text x="${f(x + 7)}" y="${f(y + 4)}" fill="${b.col}" font-size="10">${esc(b.name)}</text>`;
  }
  if (ship) { const [x, y] = toXY(ship); s += `<path d="M${f(x)} ${f(y - 6)}L${f(x + 5)} ${f(y + 4)}L${f(x - 5)} ${f(y + 4)}Z" fill="#b48cff" stroke="#fff" stroke-width=".8"/>`; }
  return s + '</svg>';
}

/** Trip progress: accelerate, flip at the midpoint, brake. */
export function tripBar(p: number, W = 356) {
  const x = 10 + p * (W - 20);
  return `<svg class="chart" viewBox="0 0 ${W} 40" height="40"><path d="M10 18H${W / 2}" stroke="${BLUE}" stroke-width="3" stroke-opacity=".35"/><path d="M${W / 2} 18H${W - 10}" stroke="${CORAL}" stroke-width="3" stroke-opacity=".35"/>`
    + `<path d="M10 18H${f(x)}" stroke="#b48cff" stroke-width="3"/><path d="M${W / 2} 10V26" stroke="#e4eeff"/><text x="${W / 2}" y="38" text-anchor="middle" fill="${INK2}" font-size="10">flip</text>`
    + `<text x="10" y="38" fill="${DIM}" font-size="10">accelerate</text><text x="${W - 10}" y="38" text-anchor="end" fill="${DIM}" font-size="10">brake</text>`
    + `<rect x="${f(x - 4)}" y="14" width="8" height="8" fill="#b48cff" transform="rotate(45 ${f(x)} 18)"/></svg>`;
}

/** Station ring: hub, eight slots on a circle inside a square. */
export function stationRing(slots: { mod: string | null; col: string; name: string; building: boolean; progress: number }[], sel: number | null, W = 356, H = 262) {
  const cx = W / 2, cy = H / 2, R = 78;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}">`;
  s += `<rect x="${cx - R - 22}" y="${cy - R - 22}" width="${(R + 22) * 2}" height="${(R + 22) * 2}" fill="none" stroke="rgba(106,168,255,.18)"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(106,168,255,.45)" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="18" fill="rgba(77,163,255,.15)" stroke="${BLUE}"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#e4eeff" font-size="10">hub</text>`;
  slots.forEach((sl, i) => {
    const a = i / 8 * Math.PI * 2 - Math.PI / 2, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R, lx = cx + Math.cos(a) * (R + 34), ly = cy + Math.sin(a) * (R + 34);
    s += `<path d="M${f(cx + Math.cos(a) * 18)} ${f(cy + Math.sin(a) * 18)}L${f(x)} ${f(y)}" stroke="rgba(106,168,255,.2)"/>`;
    s += `<g class="hit" data-act="slot" data-v="${i}" style="cursor:pointer"><circle cx="${f(x)}" cy="${f(y)}" r="15" fill="${sl.mod ? sl.col : 'rgba(5,12,26,.8)'}" fill-opacity="${sl.mod ? (sl.building ? 0.2 : 0.35) : 1}" stroke="${sl.mod ? sl.col : DIM}" ${sl.mod ? '' : 'stroke-dasharray="3 3"'} ${sel === i ? 'stroke-width="2.5"' : ''}/>`;
    if (sl.building) { const e = -Math.PI / 2 + sl.progress * Math.PI * 2; s += `<path d="M${f(x)} ${f(y - 15)}A15 15 0 ${sl.progress > 0.5 ? 1 : 0} 1 ${f(x + Math.cos(e) * 15)} ${f(y + Math.sin(e) * 15)}" fill="none" stroke="${sl.col}" stroke-width="3"/>`; }
    s += `<text x="${f(x)}" y="${f(y + 4)}" text-anchor="middle" fill="${sl.mod ? '#e4eeff' : DIM}" font-size="11">${sl.mod ? '' : '+'}</text></g>`;
    s += `<text x="${f(lx)}" y="${f(ly + 4)}" text-anchor="middle" fill="${sl.mod ? sl.col : DIM}" font-size="10">${esc(sl.mod ? sl.name : 'empty')}</text>`;
  });
  return s + '</svg>';
}

/** Threat radar: sensor horizon ring; raiders as triangles at their time-to-arrival. */
export function threatRadar(threats: { name: string; eta: number; strength: number }[], warn: number, def: number, W = 356, H = 150) {
  const cx = W / 2, cy = H - 14, R = H - 30, maxT = Math.max(warn * 1.15, ...threats.map(x => x.eta * 1.1));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}">`;
  for (const k of [0.25, 0.5, 0.75, 1]) s += `<path d="M${f(cx - R * k)} ${cy}A${f(R * k)} ${f(R * k)} 0 0 1 ${f(cx + R * k)} ${cy}" fill="none" stroke="rgba(106,168,255,.15)"/>`;
  const rw = R * warn / maxT;
  s += `<path d="M${f(cx - rw)} ${cy}A${f(rw)} ${f(rw)} 0 0 1 ${f(cx + rw)} ${cy}" fill="rgba(180,140,255,.07)" stroke="#b48cff" stroke-dasharray="4 3"/><text x="${f(cx + rw + 3)}" y="${cy - 2}" fill="#b48cff" font-size="9">sensor horizon ${Math.round(warn / 60)} min</text>`;
  s += `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" fill="${AMBER}" transform="rotate(45 ${cx} ${cy})"/><text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="${INK2}" font-size="9">defence ${def}</text>`;
  threats.forEach((th, i) => {
    const r = R * Math.min(1, th.eta / maxT), a = Math.PI + (i + 1) / (threats.length + 1) * Math.PI, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    s += `<path d="M${f(x)} ${f(y - 7)}L${f(x + 6)} ${f(y + 5)}L${f(x - 6)} ${f(y + 5)}Z" fill="${CORAL}"/><text x="${f(x)}" y="${f(y - 10)}" text-anchor="middle" fill="${CORAL}" font-size="10">${esc(th.name)} · ${th.strength}</text>`;
  });
  if (!threats.length) s += `<text x="${cx}" y="${cy - R / 2}" text-anchor="middle" fill="${DIM}" font-size="11">Nothing inside sensor range</text>`;
  return s + '</svg>';
}

/** Scale ruler for the focus bar. */
export function ruler() { return `<svg width="46" height="10" viewBox="0 0 46 10"><path d="M1 1V9H45V1M23 5V9M12 7V9M34 7V9" fill="none" stroke="${BLUE}"/></svg>`; }

/** Title art: a construction drawing of an orbit inside the Vitruvian circle and square. */
export function vitruvian() {
  const c = 250, R = 200;
  let s = `<svg class="vit" viewBox="0 0 500 500">`;
  s += `<rect x="${c - R}" y="${c - R}" width="${R * 2}" height="${R * 2}" fill="none" stroke="${BLUE}" stroke-opacity=".5"/>`;
  s += `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${BLUE}" stroke-opacity=".7"/>`;
  s += `<circle cx="${c}" cy="${c}" r="${R * 0.62}" fill="none" stroke="${TEAL}" stroke-opacity=".6" stroke-dasharray="3 5"/>`;
  s += `<ellipse cx="${c + 40}" cy="${c}" rx="${R * 0.92}" ry="${R * 0.5}" fill="none" stroke="#b48cff" stroke-opacity=".6" transform="rotate(-24 ${c} ${c})"/>`;
  let ticks = '';
  for (let k = 0; k < 120; k++) { const a = k / 120 * Math.PI * 2, L = k % 10 ? 5 : 12; ticks += `M${f(c + Math.cos(a) * (R + 6))} ${f(c + Math.sin(a) * (R + 6))}L${f(c + Math.cos(a) * (R + 6 + L))} ${f(c + Math.sin(a) * (R + 6 + L))}`; }
  s += `<path d="${ticks}" stroke="${BLUE}" stroke-opacity=".6"/>`;
  s += `<path d="M${c - R} ${c - R}L${c + R} ${c + R}M${c + R} ${c - R}L${c - R} ${c + R}M${c} ${c - R - 30}V${c + R + 30}M${c - R - 30} ${c}H${c + R + 30}" stroke="${BLUE}" stroke-opacity=".18"/>`;
  s += `<g class="spin"><path d="M${c} ${c - R}A${R} ${R} 0 0 1 ${c + R * 0.87} ${c - R * 0.5}" fill="none" stroke="${CYAN}" stroke-width="2.5"/></g>`;
  s += `<circle cx="${c}" cy="${c}" r="16" fill="#ffd27a" fill-opacity=".9"/><circle cx="${c}" cy="${c}" r="28" fill="none" stroke="#ffd27a" stroke-opacity=".35"/>`;
  s += `<circle cx="${c + R * 0.62}" cy="${c}" r="7" fill="${BLUE}"/><text x="${c + R * 0.62 + 12}" y="${c + 4}" fill="${INK2}" font-size="12">Earth 1.00 AU</text>`;
  s += `<circle cx="${c - 108}" cy="${c + 150}" r="5" fill="#ff8a5c"/><text x="${c - 96}" y="${c + 154}" fill="${INK2}" font-size="12">Mars 1.52 AU</text>`;
  s += `<text x="${c - R}" y="${c - R - 10}" fill="${DIM}" font-size="11">fig. 1  the inner system, 2060</text>`;
  return s + '</svg>';
}
const CYAN = '#4fd2ff';
