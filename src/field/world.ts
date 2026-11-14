// Field operations: the planets, regions and terrain that the Recovery and Hopper modes play on.
// Pure TypeScript, no DOM and no core: every height and coastline is a deterministic function,
// so every player sees the same ground and the logic runs in Node tests.
import { hash } from '../game/util';

export type LocId = 'earth' | 'mars';
export const DEG = Math.PI / 180;

export interface Body {
  id: LocId; name: string;
  /** Surface gravity (m/s²), radius (m), surface air density (kg/m³), scale height (m). */
  g: number; R: number; rho0: number; H: number;
  /** Δv a hopper needs to reach low orbit from the surface (m/s), losses included. */
  orbitDv: number;
}
export const BODIES: Record<LocId, Body> = {
  earth: { id: 'earth', name: 'Earth', g: 9.81, R: 6371e3, rho0: 1.225, H: 8500, orbitDv: 9400 },
  mars: { id: 'mars', name: 'Mars', g: 3.721, R: 3389.5e3, rho0: 0.02, H: 11100, orbitDv: 4100 },
};

export interface LL { lat: number; lon: number }
export interface XY { x: number; y: number }

// ---------------------------------------------------------------- noise
function h2(ix: number, iy: number, seed: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * (3 - 2 * t);
/** Smooth value noise in [0, 1]. */
export function vnoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fade(x - ix), fy = fade(y - iy);
  const a = h2(ix, iy, seed), b = h2(ix + 1, iy, seed), c = h2(ix, iy + 1, seed), d = h2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Fractal noise in roughly [-1, 1]. */
export function fbm(x: number, y: number, seed: number, oct = 5) {
  let s = 0, amp = 0.5, f = 1;
  for (let k = 0; k < oct; k++) { s += amp * (vnoise(x * f, y * f, seed + k * 17) * 2 - 1); f *= 2.03; amp *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- geometry
export function pointInPoly(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function distToPoly(x: number, y: number, poly: number[][]) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i], dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}
export const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------- Earth: Florida and the Bahamas
// Approximate coastlines (lat, lon), drawn at the scale of a regional chart.
const FLORIDA: number[][] = [
  [31.6, -85.0], [31.6, -81.45], [30.70, -81.44], [30.40, -81.40], [30.29, -81.39], [29.90, -81.29], [29.62, -81.20],
  [29.21, -81.01], [29.03, -80.90], [28.86, -80.79], [28.62, -80.62], [28.47, -80.53], [28.40, -80.58], [28.32, -80.60],
  [28.08, -80.55], [27.86, -80.45], [27.45, -80.29], [26.94, -80.07], [26.71, -80.03], [26.12, -80.10], [25.77, -80.13],
  [25.60, -80.30], [25.40, -80.33], [25.25, -80.42], [25.13, -80.90], [25.14, -81.10], [25.40, -81.20], [25.86, -81.39],
  [26.14, -81.80], [26.45, -81.97], [26.72, -82.25], [26.95, -82.35], [27.33, -82.58], [27.60, -82.72], [27.97, -82.83],
  [28.17, -82.78], [28.60, -82.67], [29.14, -83.04], [29.70, -83.40], [30.05, -83.95], [30.10, -85.0],
];
const KEYS: number[][][] = [
  [[25.02, -80.50], [24.92, -80.62], [24.74, -80.92], [24.70, -81.05], [24.66, -81.40], [24.60, -81.55], [24.56, -81.80], [24.54, -81.78], [24.62, -81.40], [24.68, -81.05], [24.88, -80.62], [25.00, -80.47]],
];
const BAHAMAS: number[][][] = [
  [[26.70, -78.99], [26.53, -78.95], [26.50, -78.68], [26.60, -78.20], [26.66, -77.88], [26.76, -77.92], [26.70, -78.55]],
  [[26.95, -77.85], [26.88, -77.30], [26.55, -77.02], [26.02, -77.12], [25.86, -77.24], [26.30, -77.26], [26.70, -77.46], [26.86, -77.74]],
  [[25.15, -78.06], [24.70, -77.74], [24.18, -77.54], [24.08, -77.90], [24.58, -78.32], [25.04, -78.42]],
  [[25.09, -77.55], [25.00, -77.52], [24.99, -77.28], [25.06, -77.25], [25.10, -77.40]],
  [[25.77, -79.30], [25.70, -79.30], [25.70, -79.26], [25.77, -79.26]],
  [[25.55, -76.80], [25.30, -76.40], [24.80, -76.15], [24.65, -76.20], [25.25, -76.58], [25.50, -76.78]],
];
// Shallow banks around the Bahamas (the Great and Little Bahama Banks), as seabed outlines.
const BANKS: number[][][] = [
  [[27.30, -79.00], [26.95, -79.05], [26.40, -78.90], [26.35, -78.20], [26.55, -77.20], [26.20, -76.95], [25.85, -77.05], [26.45, -77.70], [27.10, -78.40]],
  [[25.85, -79.35], [25.30, -79.30], [24.20, -79.00], [23.40, -78.20], [23.50, -77.40], [24.20, -77.20], [25.20, -77.30], [25.70, -78.10]],
];

// ---------------------------------------------------------------- Mars: Isidis Planitia and Jezero
const ISIDIS: LL = { lat: 13.0, lon: 87.5 };
interface Crater { lat: number; lon: number; r: number; d: number }
const MARS_CRATERS: Crater[] = (() => {
  const named: Crater[] = [
    { lat: 18.44, lon: 77.58, r: 23.5, d: 900 },   // Jezero
    { lat: 20.66, lon: 75.73, r: 33, d: 1100 },    // Hargraves
    { lat: 16.95, lon: 71.45, r: 21, d: 800 },     // Toro
    { lat: 17.62, lon: 79.75, r: 14, d: 600 },     // Belva
    { lat: 7.4, lon: 79.6, r: 18, d: 700 },
    { lat: 22.4, lon: 84.6, r: 12, d: 500 },
  ];
  const out = [...named];
  for (let k = 0; k < 170; k++) {
    const a = hash('crater' + k), b = hash('crater-b' + k), c = hash('crater-c' + k);
    const u = (a % 10000) / 10000, v = (b % 10000) / 10000, w = (c % 10000) / 10000;
    const r = 2 + 16 * w * w * w;
    out.push({ lat: 2 + u * 26, lon: 66 + v * 28, r, d: r * 38 });
  }
  return out;
})();
const KM_PER_DEG_MARS = BODIES.mars.R / 1000 * DEG;

/** Mars terrain height (m) at a latitude and longitude, relative to the datum. */
export function marsHeight(lat: number, lon: number) {
  const cx = (lon - ISIDIS.lon) * Math.cos(lat * DEG), cy = lat - ISIDIS.lat;
  const d = Math.hypot(cx, cy) * KM_PER_DEG_MARS;
  // Isidis: a 1,100 km impact basin, floor near −3,800 m, a broken rim, highlands outside.
  let h = d < 520 ? -3800 + 400 * (d / 520) ** 2 : d < 680 ? -3400 + 4200 * ((d - 520) / 160) ** 1.5 : 800 - 0.9 * (d - 680);
  h = Math.max(h, -3900);
  // Syrtis Major: a broad volcanic plateau to the west.
  if (lon < 74) h += 900 * Math.min(1, (74 - lon) / 4);
  // Nili Fossae: long troughs running north-east.
  if (lat > 19 && lat < 27 && lon > 73 && lon < 82) {
    const s = (lon - 73) * 0.86 - (lat - 19) * 0.5, wave = Math.abs(Math.sin(s * 2.1));
    h -= 520 * Math.max(0, 1 - wave * 6) * Math.min(1, (27 - lat) / 2, (lat - 19) / 2);
  }
  for (const c of MARS_CRATERS) {
    const dx = (lon - c.lon) * Math.cos(lat * DEG) * KM_PER_DEG_MARS, dy = (lat - c.lat) * KM_PER_DEG_MARS;
    const q = Math.hypot(dx, dy) / c.r;
    if (q > 2.2) continue;
    h += q < 1 ? -c.d * (1 - q * q) + c.d * 0.25 : c.d * 0.25 * Math.exp(-(((q - 1) / 0.35) ** 2));
  }
  return h + 260 * fbm(lon * 1.7, lat * 1.7, 7) + 60 * fbm(lon * 9, lat * 9, 11, 3);
}

// ---------------------------------------------------------------- regions
export interface Site { id: string; name: string; kind: string; ll: LL; p: XY; blurb: string; water?: boolean }
export interface Region {
  id: string; loc: LocId; body: Body; name: string; center: LL; half: number;
  /** Land polygons in map kilometres (Earth only). */
  land: number[][][]; banks: number[][][];
  toXY(ll: LL): XY; toLL(p: XY): LL;
  /** Ground height in metres (negative is sea depth on Earth). */
  heightAt(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
}

export function makeRegion(id: string, loc: LocId, name: string, center: LL, half: number): Region {
  const body = BODIES[loc], kmDeg = body.R / 1000 * DEG, cos0 = Math.cos(center.lat * DEG);
  const toXY = (ll: LL): XY => ({ x: (ll.lon - center.lon) * cos0 * kmDeg, y: (ll.lat - center.lat) * kmDeg });
  const toLL = (p: XY): LL => ({ lat: center.lat + p.y / kmDeg, lon: center.lon + p.x / (cos0 * kmDeg) });
  const conv = (poly: number[][]) => poly.map(([la, lo]) => { const p = toXY({ lat: la, lon: lo }); return [p.x, p.y]; });
  const land = loc === 'earth' ? [FLORIDA, ...KEYS, ...BAHAMAS].map(conv) : [];
  const banks = loc === 'earth' ? BANKS.map(conv) : [];
  const onLand = (x: number, y: number) => land.some(pl => pointInPoly(x, y, pl));
  const heightAt = loc === 'earth'
    ? (x: number, y: number) => {
      if (onLand(x, y)) return 3 + 25 * Math.max(0, fbm(x / 40, y / 40, 3));
      let dc = Infinity;
      for (const pl of land) dc = Math.min(dc, distToPoly(x, y, pl));
      const bank = banks.some(pl => pointInPoly(x, y, pl));
      let depth = bank ? 6 + 9 * (0.5 + 0.5 * fbm(x / 25, y / 25, 4)) : Math.min(4200, 12 + 24 * dc + 900 * Math.max(0, (dc - 30) / 60));
      if (!bank) for (const pl of banks) { const db = distToPoly(x, y, pl); if (db < 25) depth = Math.min(depth, 15 + db * 120); }
      return -depth * (1 + 0.08 * fbm(x / 30, y / 30, 5));
    }
    : (x: number, y: number) => { const ll = toLL({ x, y }); return marsHeight(ll.lat, ll.lon); };
  return {
    id, loc, body, name, center, half, land, banks, toXY, toLL, heightAt,
    isWater: loc === 'earth' ? (x, y) => !onLand(x, y) : () => false,
  };
}

/** Recovery regions: the stretch of sea or plain your crews race across. */
export const REC_REGIONS: Record<LocId, Region> = {
  earth: makeRegion('rec-earth', 'earth', 'Off Cape Canaveral', { lat: 28.33, lon: -80.06 }, 72),
  mars: makeRegion('rec-mars', 'mars', 'Isidis rim, east of Jezero', { lat: 18.15, lon: 78.55 }, 48),
};
/** Hopper regions: the network of settlements a courier serves. */
export const HOP_REGIONS: Record<LocId, Region> = {
  earth: makeRegion('hop-earth', 'earth', 'Florida and the Bahamas', { lat: 27.25, lon: -79.95 }, 430),
  mars: makeRegion('hop-mars', 'mars', 'Isidis and Syrtis', { lat: 14.6, lon: 79.6 }, 660),
};

export function site(r: Region, id: string, name: string, kind: string, lat: number, lon: number, blurb: string): Site {
  const ll = { lat, lon }, p = r.toXY(ll);
  return { id, name, kind, ll, p, blurb, water: r.isWater(p.x, p.y) };
}
