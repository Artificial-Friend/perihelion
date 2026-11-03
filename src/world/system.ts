// The rest of the solar system, for looking at: Uranus and Neptune, planet poles and rings,
// major moons, the main belt, the Jupiter trojans and the Kuiper belt, named asteroids, dwarf
// planets and comets, interstellar objects, and small rocks passing Earth.
//
// Everything here is two-body motion from published orbital elements (approximate: no planetary
// perturbations, so positions drift over decades). Objects that come and go are generated from
// seeded rng(hash(...)), so every player sees the same rock pass at the same moment.
import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, uniform, positionLocal, positionWorld, normalWorld, normalize, max, dot, pow,
  instancedBufferAttribute, instancedDynamicBufferAttribute, mx_fractal_noise_float,
} from 'three/tsl';
import { core, V, Vec3, AU, MU_SUN, MU_EARTH, R_EARTH, DEG, Ephem } from '../sim/core';
import { rng, hash, fmtDur } from '../game/util';
import type { CamOut, FocusInfo } from './camera';

const KM = 1000, DAY = 86400, YEAR = 365.25 * DAY, CENTURY = 3155760000, LD = 384400;
const J2000_UNIX = Date.UTC(2000, 0, 1, 12) / 1000;
const OBL = 23.4392911 * DEG, cOb = Math.cos(OBL), sOb = Math.sin(OBL);
const ecl2eq = (x: number, y: number, z: number): Vec3 => [x, y * cOb - z * sOb, y * sOb + z * cOb];
/** Seconds since J2000 for a calendar date (UTC). */
const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000 - J2000_UNIX;
const EPOCH_2023 = at(2023, 2, 25), EPOCH_2020 = at(2020, 5, 31);

// ---------- planets beyond Saturn (JPL approximate elements, same form as the core's table) ----------
const JPL: Record<string, number[]> = {
  uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503, -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  pluto: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684, -0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
};
function jplHelio(p: number[], t: number): Vec3 {
  const T = t / CENTURY, e = p[1] + T * p[7], L = (p[3] + T * p[9]) * DEG, varpi = (p[4] + T * p[10]) * DEG;
  let M = (L - varpi) % (2 * Math.PI); if (M > Math.PI) M -= 2 * Math.PI; if (M < -Math.PI) M += 2 * Math.PI;
  let E = M;
  for (let k = 0; k < 30; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-13) break; }
  const O = (p[5] + T * p[11]) * DEG, w = varpi - O, inc = (p[2] + T * p[8]) * DEG, a = (p[0] + T * p[6]) * AU;
  return rot(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), w, inc, O, true);
}
function rot(x: number, y: number, w: number, i: number, O: number, ecl: boolean): Vec3 {
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  const X = (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y;
  const Y = (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y;
  const Z = sw * si * x + cw * si * y;
  return ecl ? ecl2eq(X, Y, Z) : [X, Y, Z];
}
/** Heliocentric equatorial position (km) of planet k in PLANETS order (0 Mercury … 7 Neptune). */
export function planetHelioAt(k: number, t: number, eph?: Ephem): Vec3 {
  if (k < 6) return (eph || core.ephem(t)).planets[k];
  return jplHelio(k === 6 ? JPL.uranus : JPL.neptune, t);
}

/** North pole directions (J2000 equatorial), IAU right ascension and declination in degrees. */
const POLE: Record<string, [number, number]> = {
  mercury: [281.01, 61.42], venus: [272.76, 67.16], mars: [317.68, 52.89], jupiter: [268.06, 64.5],
  saturn: [40.59, 83.54], uranus: [257.31, -15.18], neptune: [299.36, 43.46], pluto: [132.99, -6.16],
};
export function poleOf(name: string): THREE.Vector3 | null {
  const p = POLE[name]; if (!p) return null;
  const ra = p[0] * DEG, de = p[1] * DEG;
  return new THREE.Vector3(Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de));
}

// ---------- conic orbits ----------
/** Perihelion distance q (km), eccentricity, angles in degrees, time of perihelion tp (s since J2000). */
export interface Conic { q: number; e: number; i: number; node: number; peri: number; tp: number; mu: number; ecl: boolean }
function fromMean(aAU: number, e: number, i: number, node: number, peri: number, M0: number, epoch: number): Conic {
  const a = aAU * AU, n = Math.sqrt(MU_SUN / (a * a * a));
  return { q: a * (1 - e), e, i, node, peri, tp: epoch - M0 * DEG / n, mu: MU_SUN, ecl: true };
}
function fromPeri(qAU: number, e: number, i: number, node: number, peri: number, tp: number): Conic {
  return { q: qAU * AU, e, i, node, peri, tp, mu: MU_SUN, ecl: true };
}
export function conicPos(c: Conic, t: number): Vec3 {
  const e = c.e; let x: number, y: number;
  if (e < 1) {
    const a = c.q / (1 - e), n = Math.sqrt(c.mu / (a * a * a));
    let M = (n * (t - c.tp)) % (2 * Math.PI); if (M > Math.PI) M -= 2 * Math.PI; if (M < -Math.PI) M += 2 * Math.PI;
    let E = e < 0.8 ? M : (M < 0 ? -Math.PI : Math.PI) * 0.5 + M * 0.5;
    for (let k = 0; k < 60; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
    x = a * (Math.cos(E) - e); y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  } else {
    const a = c.q / (e - 1), n = Math.sqrt(c.mu / (a * a * a)), M = n * (t - c.tp);
    let H = Math.asinh(M / e);
    for (let k = 0; k < 60; k++) { const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1); H -= d; if (Math.abs(d) < 1e-12) break; }
    x = a * (e - Math.cosh(H)); y = a * Math.sqrt(e * e - 1) * Math.sinh(H);
  }
  return rot(x, y, c.peri * DEG, c.i * DEG, c.node * DEG, c.ecl);
}
/** Points along the conic (by true anomaly), clipped to rMax km from the focus. */
function conicPath(c: Conic, rMax: number, n = 256): Vec3[] {
  const p = c.q * (1 + c.e), lim = (p / rMax - 1) / c.e;
  const nuMax = lim <= -1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, lim)));
  const out: Vec3[] = [];
  for (let k = 0; k <= n; k++) {
    const nu = -nuMax + 2 * nuMax * k / n, r = p / (1 + c.e * Math.cos(nu));
    out.push(rot(r * Math.cos(nu), r * Math.sin(nu), c.peri * DEG, c.i * DEG, c.node * DEG, c.ecl));
  }
  return out;
}

// ---------- catalogue ----------
export type Kind = 'dwarf' | 'asteroid' | 'neo' | 'comet' | 'interstellar' | 'flyby';
export interface SysBody { id: string; name: string; kind: Kind; rKm: number; conic?: Conic; jpl?: number[]; round?: boolean; shape?: [number, number, number]; note: string; col: string }
const COL: Record<Kind, string> = { dwarf: '#c8d4e6', asteroid: '#8fb4ff', neo: '#ffb07a', comet: '#7fe0ff', interstellar: '#b48cff', flyby: '#8fb4ff' };
const B = (id: string, name: string, kind: Kind, rKm: number, conic: Conic | undefined, note: string, extra: Partial<SysBody> = {}): SysBody =>
  ({ id, name, kind, rKm, conic, note, col: COL[kind], ...extra });

/** Named objects with approximate published elements. */
const CATALOGUE: SysBody[] = [
  B('pluto', 'Pluto', 'dwarf', 1188, undefined, 'dwarf planet, Kuiper belt', { jpl: JPL.pluto, round: true, col: '#d9c3a5' }),
  B('eris', 'Eris', 'dwarf', 1163, fromMean(67.864, 0.43607, 44.04, 35.951, 151.639, 205.989, EPOCH_2020), 'dwarf planet, scattered disc', { round: true, col: '#e6e6ea' }),
  B('haumea', 'Haumea', 'dwarf', 816, fromMean(43.116, 0.19642, 28.2137, 122.167, 239.041, 218.205, EPOCH_2020), 'dwarf planet, spins every 3.9 h', { round: true, shape: [1.25, 0.95, 0.6], col: '#e9eef2' }),
  B('makemake', 'Makemake', 'dwarf', 715, fromMean(45.43, 0.16126, 28.9835, 79.62, 294.834, 165.514, EPOCH_2020), 'dwarf planet, Kuiper belt', { round: true, col: '#d8a98a' }),
  B('sedna', 'Sedna', 'dwarf', 500, fromPeri(76.2, 0.8496, 11.93, 144.25, 311.35, at(2076, 3, 15)), 'inbound to perihelion in 2076', { round: true, col: '#c46a4e' }),
  B('vesta', 'Vesta', 'asteroid', 262.7, fromMean(2.3617, 0.0885, 7.142, 103.81, 151.53, 169.4, EPOCH_2023), 'protoplanet, main belt', { round: true, col: '#b9b2a6' }),
  B('pallas', 'Pallas', 'asteroid', 256, fromMean(2.7704, 0.2302, 34.93, 172.92, 310.87, 34.9, EPOCH_2023), 'main belt, steeply inclined', { round: true, col: '#9fa3a8' }),
  B('hygiea', 'Hygiea', 'asteroid', 217, fromMean(3.1415, 0.1125, 3.83, 283.18, 312.32, 26.6, EPOCH_2023), 'main belt', { round: true, col: '#7b7a78' }),
  B('psyche', 'Psyche', 'asteroid', 113, fromMean(2.9238, 0.134, 3.1, 150.03, 229.22, 160, EPOCH_2023), 'metal-rich, main belt'),
  B('eros', 'Eros', 'neo', 8.4, fromMean(1.4583, 0.2228, 10.83, 304.3, 178.88, 310, EPOCH_2023), 'near-Earth asteroid', { shape: [2, 0.7, 0.7] }),
  B('apophis', 'Apophis', 'neo', 0.17, fromMean(0.9224, 0.1911, 3.34, 203.96, 126.65, 260, EPOCH_2023), 'near-Earth asteroid'),
  B('bennu', 'Bennu', 'neo', 0.245, fromMean(1.1264, 0.2037, 6.035, 2.061, 66.22, 101.7, EPOCH_2023), 'near-Earth asteroid, rubble pile'),
  B('ryugu', 'Ryugu', 'neo', 0.45, fromMean(1.1896, 0.1902, 5.884, 251.59, 211.43, 21, EPOCH_2023), 'near-Earth asteroid'),
  B('itokawa', 'Itokawa', 'neo', 0.165, fromMean(1.3241, 0.2801, 1.621, 69.08, 162.82, 129, EPOCH_2023), 'near-Earth asteroid', { shape: [1.6, 0.8, 0.7] }),
  B('didymos', 'Didymos', 'neo', 0.39, fromMean(1.6426, 0.3839, 3.414, 73.2, 319.32, 70, EPOCH_2023), 'binary near-Earth asteroid'),
  B('toutatis', 'Toutatis', 'neo', 2.5, fromMean(2.5435, 0.6247, 0.448, 125.37, 278.71, 23, EPOCH_2023), 'tumbling near-Earth asteroid', { shape: [1.8, 0.9, 0.8] }),
  B('phaethon', 'Phaethon', 'neo', 2.9, fromMean(1.2714, 0.8898, 22.26, 265.22, 322.19, 150, EPOCH_2023), 'parent of the Geminids'),
  B('halley', '1P/Halley', 'comet', 5.5, fromPeri(0.5871, 0.96714, 162.262, 58.42, 111.332, at(2061, 7, 28)), 'returns to perihelion July 2061', { shape: [1.4, 0.8, 0.8] }),
  B('encke', '2P/Encke', 'comet', 2.4, fromPeri(0.3359, 0.8483, 11.78, 334.57, 186.54, at(2023, 10, 22)), 'shortest-period comet, 3.3 years'),
  B('cg67p', '67P/Churyumov–Gerasimenko', 'comet', 2, fromPeri(1.2106, 0.6497, 7.04, 50.14, 12.78, at(2021, 11, 2)), 'Jupiter-family comet', { shape: [1.3, 0.9, 0.8] }),
  B('swift', '109P/Swift–Tuttle', 'comet', 13, fromPeri(0.9595, 0.9632, 113.45, 139.38, 152.98, at(1992, 12, 11)), 'parent of the Perseids'),
  B('oumuamua', '1I/ʻOumuamua', 'interstellar', 0.11, fromPeri(0.2559, 1.2011, 122.74, 24.6, 241.81, at(2017, 9, 9)), 'first known interstellar object, outbound', { shape: [1.8, 0.3, 0.3] }),
  B('borisov', '2I/Borisov', 'interstellar', 0.5, fromPeri(2.006, 3.356, 44.05, 308.15, 209.12, at(2019, 12, 8)), 'interstellar comet, outbound'),
  B('atlas3i', '3I/ATLAS', 'interstellar', 2.5, fromPeri(1.357, 6.14, 175.11, 322.16, 128.01, at(2025, 10, 29)), 'interstellar comet, outbound'),
];

// Major moons: circular orbits in the parent's equatorial plane. Phases are seeded, not ephemeris.
interface MoonDef { id: string; name: string; parent: string; r: number; a: number; P: number; col: string; rock?: boolean }
export const MOONS: MoonDef[] = [
  { id: 'phobos', name: 'Phobos', parent: 'mars', r: 11.3, a: 9376, P: 0.31891, col: '#8a7d70', rock: true },
  { id: 'deimos', name: 'Deimos', parent: 'mars', r: 6.2, a: 23463, P: 1.26244, col: '#9a8d7e', rock: true },
  { id: 'io', name: 'Io', parent: 'jupiter', r: 1821.6, a: 421700, P: 1.769138, col: '#e3cf6a' },
  { id: 'europa', name: 'Europa', parent: 'jupiter', r: 1560.8, a: 671034, P: 3.551181, col: '#d9cdb8' },
  { id: 'ganymede', name: 'Ganymede', parent: 'jupiter', r: 2634.1, a: 1070412, P: 7.154553, col: '#a3998c' },
  { id: 'callisto', name: 'Callisto', parent: 'jupiter', r: 2410.3, a: 1882709, P: 16.689017, col: '#6e655c' },
  { id: 'enceladus', name: 'Enceladus', parent: 'saturn', r: 252.1, a: 237948, P: 1.370218, col: '#f1f4f6' },
  { id: 'titan', name: 'Titan', parent: 'saturn', r: 2574.7, a: 1221870, P: 15.945, col: '#d49a45' },
  { id: 'titania', name: 'Titania', parent: 'uranus', r: 788.4, a: 435910, P: 8.706234, col: '#b5aca4' },
  { id: 'triton', name: 'Triton', parent: 'neptune', r: 1353.4, a: 354759, P: -5.876854, col: '#cfc6c4' },
];

// ---------- seeded visitors ----------
const HALF_MONTH = 'ABCDEFGHJKLMNOPQRSTUVWXY';
function designation(t: number, r: () => number) {
  const d = new Date((t + J2000_UNIX) * 1000), y = d.getUTCFullYear();
  const half = HALF_MONTH[Math.min(23, d.getUTCMonth() * 2 + (d.getUTCDate() > 15 ? 1 : 0))];
  return { y, half, n: 1 + Math.floor(r() * 9), l2: HALF_MONTH[Math.floor(r() * 24)] };
}
const randAngles = (r: () => number) => ({ i: Math.acos(1 - 2 * r()) / DEG, node: r() * 360, peri: r() * 360 });

/** Interstellar objects and long-period comets whose perihelion falls in year slot y. */
function visitorsFor(y: number): SysBody[] {
  const out: SysBody[] = [], r = rng(hash('visitors:' + y));
  const nI = r() < 0.45 ? 1 : 0;
  for (let j = 0; j < nI; j++) {
    const tp = (y + r()) * YEAR, q = (0.3 + r() * 4) * AU, vinf = 15 + r() * 45, ang = randAngles(r);
    const d = designation(tp, r), rKm = 0.05 + Math.pow(r(), 2) * 1.5;
    out.push(B(`iso${y}_${j}`, `C/${d.y} ${d.half}${d.n}`, 'interstellar', rKm,
      { q, e: 1 + q * vinf * vinf / MU_SUN, ...ang, tp, mu: MU_SUN, ecl: true }, `interstellar object · ${Math.round(vinf)} km/s excess`));
  }
  const nC = r() < 0.75 ? 1 : 2;
  for (let j = 0; j < nC; j++) {
    const tp = (y + r()) * YEAR, q = (0.2 + r() * 3.3) * AU, e = 0.995 + r() * 0.00495, ang = randAngles(r);
    const d = designation(tp, r);
    out.push(B(`lpc${y}_${j}`, `C/${d.y} ${d.l2}${d.n}`, 'comet', 0.5 + r() * 7, { q, e, ...ang, tp, mu: MU_SUN, ecl: true }, 'long-period comet from the Oort cloud'));
  }
  return out;
}
const SLOT = 6 * 3600;
const fmtGeo = (km: number) => km < 1e6 ? Math.round(km).toLocaleString('en-US') + ' km' : (km / 1e6).toFixed(2) + ' million km';
/** Small near-Earth asteroids passing Earth, closest approach in 6-hour slot s (geocentric). */
function flybysFor(s: number): SysBody[] {
  const out: SysBody[] = [], r = rng(hash('flyby:' + s)), n = r() < 0.5 ? 1 : 0;
  for (let j = 0; j < n; j++) {
    const tca = (s + r()) * SLOT, rp = R_EARTH + 15000 * Math.pow(100, r()), vinf = 4 + r() * 21, ang = randAngles(r);
    const m = 4 * Math.pow(40, r()), d = designation(tca, r);
    out.push(B(`fb${s}_${j}`, `${d.y} ${d.half}${d.l2}${d.n + 10 * Math.floor(r() * 30)}`, 'flyby', m / 2000,
      { q: rp, e: 1 + rp * vinf * vinf / MU_EARTH, ...ang, tp: tca, mu: MU_EARTH, ecl: false },
      `${Math.round(m)} m asteroid · ${vinf.toFixed(1)} km/s`, { col: rp < LD ? '#ff6b5e' : '#8fb4ff' }));
  }
  return out;
}

// ---------- belts ----------
interface Belt { n: number; el: Float64Array; col: Float32Array }
/** Deterministic belt populations: per body a, e, i, node, peri, M0 (at epoch t0), mean motion. */
function makeBelts(t0: number) {
  const r = rng(hash('belts')), list: number[][] = [], cols: number[][] = [];
  const gauss = () => { let s = 0; for (let k = 0; k < 4; k++) s += r(); return (s - 2) * 1.73; };
  const add = (a: number, e: number, i: number, node: number, peri: number, M: number, c: number[]) => { list.push([a * AU, e, i, node, peri, M]); cols.push(c); };
  // Main belt, 2.1–3.3 AU with the Kirkwood gaps (3:1, 5:2, 7:3, 2:1 resonances with Jupiter).
  const gaps = [2.502, 2.825, 2.958, 3.279];
  for (let k = 0; k < 9000;) {
    const a = 2.1 + r() * 1.2;
    if (gaps.some(g => Math.abs(a - g) < 0.03 && r() < 0.92)) continue;
    const shade = 0.55 + r() * 0.45, c = a < 2.7 ? [0.75, 0.68, 0.6] : [0.55, 0.57, 0.62];
    add(a, Math.abs(gauss() * 0.07 + 0.12) % 0.33, Math.abs(gauss() * 7), r() * 360, r() * 360, r() * 360, c.map(x => x * shade));
    k++;
  }
  // Jupiter trojans, clustered 60° ahead of and behind Jupiter.
  const T = t0 / CENTURY, LJ = 34.39644051 + 3034.74612775 * T;
  for (let k = 0; k < 2200; k++) {
    const node = r() * 360, peri = r() * 360, lam = LJ + (k % 2 ? 60 : -60) + gauss() * 14;
    add(5.2026 + gauss() * 0.06, Math.abs(gauss() * 0.05), Math.abs(gauss() * 12), node, peri, lam - node - peri, [0.7, 0.55, 0.45].map(x => x * (0.5 + r() * 0.5)));
  }
  // Kuiper belt: plutinos at 39.4 AU, the cold classical belt 42–47 AU, a hot scattered population.
  for (let k = 0; k < 4200; k++) {
    const kind = r(), shade = 0.4 + r() * 0.5;
    if (kind < 0.25) add(39.4 + gauss() * 0.2, 0.1 + r() * 0.2, Math.abs(gauss() * 10), r() * 360, r() * 360, r() * 360, [0.55, 0.62, 0.75].map(x => x * shade));
    else if (kind < 0.75) add(42 + r() * 5, r() * 0.08, Math.abs(gauss() * 2.5), r() * 360, r() * 360, r() * 360, [0.62, 0.55, 0.52].map(x => x * shade));
    else add(35 + r() * 25, 0.05 + r() * 0.35, Math.abs(gauss() * 15), r() * 360, r() * 360, r() * 360, [0.5, 0.55, 0.68].map(x => x * shade * 0.8));
  }
  const n = list.length, el = new Float64Array(n * 10), col = new Float32Array(n * 3);
  list.forEach((b, k) => {
    const [a, e, i, node, peri, M] = b, w = peri * DEG, inc = i * DEG, O = node * DEG;
    const P = rot(1, 0, w, inc, O, true), Q = rot(0, 1, w, inc, O, true);
    el.set([a, e, M * DEG, Math.sqrt(MU_SUN / (a * a * a)), P[0], P[1], P[2], Q[0], Q[1], Q[2]], k * 10);
    col.set(cols[k], k * 3);
  });
  return { n, el, col } as Belt;
}

// ---------- meshes ----------
/** A lumpy cratered rock of unit size, the same for everyone. */
function rockGeometry(seed: string) {
  const g = new THREE.IcosahedronGeometry(1, 5), pos = g.attributes.position as THREE.BufferAttribute, r = rng(hash(seed));
  const lumps = Array.from({ length: 6 }, () => [r() * 3 + 1, r() * 3 + 1, r() * 3 + 1, r() * 6, r() * 0.12 + 0.04]);
  const craters = Array.from({ length: 30 }, () => { const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(); return [v, 0.08 + r() * 0.3, 0.03 + r() * 0.08] as const; });
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).normalize();
    let h = 1;
    for (const [fx, fy, fz, ph, amp] of lumps) h += amp * Math.sin(v.x * fx + ph) * Math.sin(v.y * fy + ph * 0.7) * Math.sin(v.z * fz + ph * 1.3);
    for (const [c, rad, depth] of craters) {
      const d = v.distanceTo(c) / rad;
      if (d < 1.3) h += d < 1 ? -depth * (1 - d * d) : depth * 0.6 * (1.3 - d) / 0.3 * (d - 1) / 0.3 * 4;
    }
    v.multiplyScalar(h); pos.setXYZ(k, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class SolarSystem {
  scene: THREE.Scene;
  belt: Belt;
  beltSprite: THREE.Sprite;
  beltPos: THREE.InstancedBufferAttribute;
  beltT = -Infinity;
  uBelt = uniform(0);
  orbitLines = new Map<string, THREE.Line>();
  flybyLines = new Map<string, THREE.Line>();
  rock: THREE.Mesh;
  ball: THREE.Mesh;
  uBall = uniform(new THREE.Color(0xffffff));
  tails: { mesh: THREE.Mesh; op: any }[] = [];
  moonMeshes = new Map<string, THREE.Mesh>();
  dyn: SysBody[] = [];
  private dynKey = '';
  private planetPos: (id: string) => Vec3 | null = () => null;

  constructor(scene: THREE.Scene, uSunRel: any, t0: number) {
    this.scene = scene; this.t0 = t0;
    // Belts: one instanced point sprite per body, positions refreshed once a second.
    this.belt = makeBelts(t0);
    const n = this.belt.n;
    this.beltPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.beltPos.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.InstancedBufferAttribute(this.belt.col, 3);
    const bm = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending });
    bm.positionNode = instancedDynamicBufferAttribute(this.beltPos);
    bm.colorNode = instancedBufferAttribute(colAttr) as any;
    bm.opacityNode = this.uBelt;
    bm.sizeNode = float(2);
    this.beltSprite = new THREE.Sprite(bm);
    this.beltSprite.count = n;
    this.beltSprite.frustumCulled = false;
    scene.add(this.beltSprite);

    // Orbits of the named objects.
    for (const b of CATALOGUE) this.addOrbit(b);

    // Focus models: an irregular rock and a round body, lit by the scene's Sun.
    this.rock = new THREE.Mesh(rockGeometry('rock'), new THREE.MeshStandardNodeMaterial({ color: 0x8f877e, roughness: 0.95, metalness: 0 }));
    const bm2 = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 }), uc = this.uBall;
    bm2.colorNode = Fn(() => (uc as any).mul(float(0.8).add(mx_fractal_noise_float(positionLocal.mul(3), 4, 2, 0.5, 1).mul(0.35))))();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), bm2);
    this.rock.visible = this.ball.visible = false;
    scene.add(this.rock, this.ball);

    // Comet tails: additive cones pointing away from the Sun, fading along their length.
    const tg = new THREE.ConeGeometry(1, 1, 24, 1, true); tg.translate(0, -0.5, 0);
    for (let k = 0; k < 8; k++) {
      const op = uniform(0), m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      m.colorNode = vec3(0.55, 0.85, 1);
      m.opacityNode = pow(float(1).add(positionLocal.y), 2).mul(op);
      const mesh = new THREE.Mesh(tg, m); mesh.visible = false; mesh.frustumCulled = false;
      scene.add(mesh); this.tails.push({ mesh, op });
    }

    // Moons, lit like the planets.
    for (const mo of MOONS) {
      const mat = new THREE.MeshBasicNodeMaterial(), c = new THREE.Color(mo.col);
      mat.colorNode = Fn(() => {
        const nn = normalize(positionLocal), tex = float(0.8).add(mx_fractal_noise_float(nn.mul(4), 4, 2, 0.5, 1).mul(0.3));
        return vec3(c.r, c.g, c.b).mul(tex).mul(max(dot(normalWorld, normalize(uSunRel.sub(positionWorld))), 0)).mul(3);
      })();
      const geo = mo.rock ? rockGeometry('moon:' + mo.id) : new THREE.SphereGeometry(1, 48, 24);
      const mesh = new THREE.Mesh(geo, mat); mesh.scale.setScalar(mo.r * KM);
      scene.add(mesh); this.moonMeshes.set(mo.id, mesh);
    }
  }

  private addOrbit(b: SysBody) {
    const seeded = /^(iso|lpc)/.test(b.id), pts = b.conic ? conicPath(b.conic, (seeded ? 40 : 120) * AU) : null;
    let arr: Float32Array;
    if (pts) { arr = new Float32Array(pts.length * 3); pts.forEach((p, k) => arr.set([p[0] * KM, p[1] * KM, p[2] * KM], k * 3)); }
    else {  // Pluto from its JPL elements: one full revolution.
      const P = 248 * YEAR; arr = new Float32Array(361 * 3);
      for (let k = 0; k <= 360; k++) { const p = jplHelio(b.jpl!, k / 360 * P); arr.set([p[0] * KM, p[1] * KM, p[2] * KM], k * 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const l = new THREE.Line(g, new THREE.LineBasicNodeMaterial({ color: new THREE.Color(b.col), transparent: true, opacity: 0.25, depthWrite: false }));
    l.userData.dim = seeded ? 0.4 : b.kind === 'neo' ? 0.6 : 1;
    l.frustumCulled = false; l.visible = false; this.scene.add(l); this.orbitLines.set(b.id, l);
  }
  private addFlybyLine(b: SysBody) {
    const c = b.conic!, n = 160, arr = new Float32Array((n + 1) * 3);
    for (let k = 0; k <= n; k++) { const p = conicPos(c, c.tp + (k / n * 2 - 1) * 1.2 * DAY); arr.set([p[0] * KM, p[1] * KM, p[2] * KM], k * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const l = new THREE.Line(g, new THREE.LineBasicNodeMaterial({ color: new THREE.Color(b.col), transparent: true, opacity: 0.28, depthWrite: false }));
    l.frustumCulled = false; this.scene.add(l); this.flybyLines.set(b.id, l);
  }
  private dropLine(map: Map<string, THREE.Line>, id: string) {
    const l = map.get(id); if (!l) return;
    this.scene.remove(l); l.geometry.dispose(); (l.material as THREE.Material).dispose(); map.delete(id);
  }

  /** Seeded objects currently in view of the inner system (rebuilt when a slot rolls over). */
  private refreshDynamic(t: number) {
    const y = Math.floor(t / YEAR), s = Math.floor(t / SLOT), key = y + ':' + s;
    if (key === this.dynKey) return;
    this.dynKey = key;
    const next: SysBody[] = [];
    for (let k = y - 4; k <= y + 1; k++) for (const b of visitorsFor(k)) if (Math.abs(t - b.conic!.tp) < (b.kind === 'comet' ? 2 : 3) * YEAR) next.push(b);
    for (let k = s - 5; k <= s + 5; k++) for (const b of flybysFor(k)) if (Math.abs(t - b.conic!.tp) < 1.2 * DAY) next.push(b);
    const ids = new Set(next.map(b => b.id));
    for (const b of this.dyn) if (!ids.has(b.id)) { this.dropLine(this.orbitLines, b.id); this.dropLine(this.flybyLines, b.id); }
    for (const b of next) if (!this.orbitLines.has(b.id) && !this.flybyLines.has(b.id)) b.kind === 'flyby' ? this.addFlybyLine(b) : this.addOrbit(b);
    this.dyn = next;
  }
  bodies(t: number) { this.refreshDynamic(t); return [...CATALOGUE, ...this.dyn]; }
  body(id: string) { return CATALOGUE.find(b => b.id === id) || this.dyn.find(b => b.id === id) || null; }

  /** Geocentric position (km) of a catalogue or seeded body. */
  geo(b: SysBody, t: number, eph: Ephem): Vec3 {
    if (b.kind === 'flyby') return conicPos(b.conic!, t);
    return V.add(b.jpl ? jplHelio(b.jpl, t) : conicPos(b.conic!, t), eph.sun);
  }
  helio(b: SysBody, t: number): Vec3 { return b.jpl ? jplHelio(b.jpl, t) : conicPos(b.conic!, t); }
  moonGeo(mo: MoonDef, t: number): Vec3 | null {
    const pp = this.planetPos(mo.parent), pole = poleOf(mo.parent);
    if (!pp || !pole) return null;
    const u = new THREE.Vector3(0, 0, 1).cross(pole).normalize(), w = pole.clone().cross(u);
    const th = rng(hash('moonphase:' + mo.id))() * 2 * Math.PI + 2 * Math.PI * t / (mo.P * DAY);
    return [pp[0] + mo.a * (Math.cos(th) * u.x + Math.sin(th) * w.x), pp[1] + mo.a * (Math.cos(th) * u.y + Math.sin(th) * w.y), pp[2] + mo.a * (Math.cos(th) * u.z + Math.sin(th) * w.z)];
  }

  // ---------- camera support ----------
  focusInfo(id: string, t: number, eph: Ephem): FocusInfo | null {
    if (id.startsWith('sat:')) {
      const mo = MOONS.find(m => m.id === id.slice(4)); if (!mo) return null;
      const p = this.moonGeo(mo, t); return p ? { pos: p, minKm: mo.r * 1.05, defaultKm: Math.max(mo.r * 6, 0.1) } : null;
    }
    const b = this.body(id.slice(3)); if (!b) return null;
    return { pos: this.geo(b, t, eph), minKm: b.rKm * 1.6 * (b.shape ? b.shape[0] : 1), defaultKm: Math.max(b.rKm * 9, 0.04) };
  }
  meta(id: string, t: number, eph: Ephem) {
    if (id.startsWith('sat:')) {
      const mo = MOONS.find(m => m.id === id.slice(4))!;
      return { name: mo.name, meas: 'Ø ' + Math.round(mo.r * 2).toLocaleString('en-US') + ' km', detail: 'moon of ' + mo.parent[0].toUpperCase() + mo.parent.slice(1) + ' · ' + Math.round(mo.a).toLocaleString('en-US') + ' km out', col: mo.col, rKm: mo.r };
    }
    const b = this.body(id.slice(3));
    if (!b) return { name: id, meas: '', detail: '', col: '#8fb4ff', rKm: 1 };
    const d = b.rKm * 2, meas = d < 2 ? '≈ ' + Math.round(d * 1000) + ' m' : 'Ø ' + Math.round(d).toLocaleString('en-US') + ' km';
    // Size and where it is on the second line, what it is on the third: both short enough to sit beside the reticle.
    if (b.kind === 'flyby') {
      const dt = b.conic!.tp - t, rp = (b.conic!.q / LD).toFixed(2);
      return { name: b.name, meas: meas + ' · ' + fmtGeo(V.len(conicPos(b.conic!, t))) + ' from Earth', detail: dt > 0 ? `closest ${rp} LD in ${fmtDur(dt)}` : `passed ${rp} LD ${fmtDur(-dt)} ago`, col: b.col, rKm: b.rKm };
    }
    const h = this.helio(b, t), h2 = this.helio(b, t + 60), v = V.len(V.sub(h2, h)) / 60;
    return { name: b.name, meas: meas + ' · ' + (V.len(h) / AU).toFixed(2) + ' AU from Sun · ' + v.toFixed(1) + ' km/s', detail: b.note, col: b.col, rKm: b.rKm };
  }

  /** Labels for objects at the scale the camera is looking at. */
  labels(t: number, cam: CamOut, eph: Ephem) {
    const out: { k: string; p: Vec3; title: string; sub?: string; cls: string; focus: string; col: string }[] = [];
    const dist = cam.dist, nearEarth = V.len(cam.focus) < 3e6;
    // Moons of the planet in focus, or of the moon's own parent.
    const fid = cam.focusId, parent = fid.startsWith('sat:') ? MOONS.find(m => m.id === fid.slice(4))?.parent : fid;
    for (const mo of MOONS) if (mo.parent === parent && dist < mo.a * 40) {
      const p = this.moonGeo(mo, t); if (p) out.push({ k: 'sat' + mo.id, p, title: mo.name, cls: 'body', focus: 'sat:' + mo.id, col: mo.col });
    }
    // Rocks passing Earth.
    if (nearEarth && dist > 3e3 && dist < 3e7) for (const b of this.bodies(t)) if (b.kind === 'flyby') {
      const p = conicPos(b.conic!, t), dt = b.conic!.tp - t;
      if (V.len(p) > dist * 8) continue;
      out.push({ k: 'sb' + b.id, p, title: b.name, sub: (dt > 0 ? 'closest in ' + fmtDur(dt) : 'outbound') + ' · ' + (b.conic!.q / LD).toFixed(2) + ' LD', cls: 'tg', focus: 'sb:' + b.id, col: b.col });
    }
    // The wider system.
    if (dist > 2e7) {
      const order: Kind[] = ['dwarf', 'comet', 'interstellar', 'asteroid', 'neo'];
      const all = this.bodies(t).filter(b => b.kind !== 'flyby').sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      for (const b of all) {
        const p = this.geo(b, t, eph);
        if (V.dist(p, cam.focus) > dist * 12) continue;
        const h = V.len(V.sub(p, eph.sun)) / AU;
        out.push({ k: 'sb' + b.id, p, title: b.name, sub: b.kind === 'comet' || b.kind === 'interstellar' ? h.toFixed(1) + ' AU from Sun' : undefined, cls: 'dim', focus: 'sb:' + b.id, col: b.col });
      }
    }
    return out;
  }

  // ---------- per frame ----------
  update(t: number, cam: CamOut, eph: Ephem, rel: (p: number[], out?: THREE.Vector3) => THREE.Vector3, planetPos: (id: string) => Vec3 | null, sunDir: THREE.Vector3) {
    this.planetPos = planetPos;
    const bodies = this.bodies(t), sunRel = rel(eph.sun);
    // Belts fade in once the view is wider than the inner system.
    const fade = Math.min(1, Math.max(0, (Math.log(cam.dist) - Math.log(3e7)) / (Math.log(6e8) - Math.log(3e7))));
    this.uBelt.value = fade * 0.9;
    this.beltSprite.visible = fade > 0.001;
    if (this.beltSprite.visible) {
      this.beltSprite.position.copy(sunRel);
      if (Math.abs(t - this.beltT) > 1) { this.beltT = t; this.updateBelt(t); }
    }
    // Orbit lines: brighter for the object in focus.
    for (const [id, l] of this.orbitLines) {
      l.position.copy(sunRel);
      const on = cam.focusId === 'sb:' + id;
      l.visible = cam.wSun > 0.01 || on;
      (l.material as any).opacity = on ? 0.6 : 0.2 * cam.wSun * l.userData.dim;
    }
    const earthRel = rel([0, 0, 0]);
    for (const [id, l] of this.flybyLines) {
      l.position.copy(earthRel);
      l.visible = (V.len(cam.focus) < 3e6 && cam.dist > 3e3 && cam.dist < 3e7) || cam.focusId === 'sb:' + id;
    }
    // Moons.
    for (const mo of MOONS) {
      const m = this.moonMeshes.get(mo.id)!, p = this.moonGeo(mo, t);
      if (!p) { m.visible = false; continue; }
      rel(p, m.position); m.visible = V.dist(p, cam.pos) < 5e7;
    }
    // Comet tails, longer close to the Sun.
    let k = 0;
    for (const b of bodies) {
      if ((b.kind !== 'comet' && b.kind !== 'interstellar') || k >= this.tails.length) continue;
      const h = this.helio(b, t), r = V.len(h) / AU;
      if (r > 4 || b.id === 'oumuamua') continue;
      const tl = this.tails[k++], L = Math.min(1.5e8, 2.5e7 / (r * r)) * Math.min(1, b.rKm / 2 + 0.3), wdt = L * 0.07;
      rel(V.add(h, eph.sun), tl.mesh.position);
      tl.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...V.norm(h)));
      tl.mesh.scale.set(wdt * KM, L * KM, wdt * KM);
      tl.mesh.visible = true; tl.op.value = Math.min(0.55, 0.9 / r) * Math.max(cam.wSun, cam.focusId === 'sb:' + b.id ? 1 : 0);
    }
    for (; k < this.tails.length; k++) this.tails[k].mesh.visible = false;
    // The body in focus gets a model.
    this.rock.visible = this.ball.visible = false;
    if (cam.focusId.startsWith('sb:')) {
      const b = this.body(cam.focusId.slice(3));
      if (b) {
        const m = b.round ? this.ball : this.rock, s = b.shape || [1, 1, 1];
        rel(this.geo(b, t, eph), m.position);
        m.scale.set(b.rKm * KM * s[0], b.rKm * KM * s[1], b.rKm * KM * s[2]);
        m.rotation.set(0.4, (t / (b.round ? 36000 : 4 * 3600)) % (2 * Math.PI), 0.2);
        if (b.round) this.uBall.value.set(b.col);
        m.visible = true;
      }
    }
    void sunDir;
  }

  private updateBelt(t: number) {
    const { n, el } = this.belt, out = this.beltPos.array as Float32Array, t0 = this.t0;
    for (let k = 0; k < n; k++) {
      const o = k * 10, a = el[o], e = el[o + 1], M = el[o + 2] + el[o + 3] * (t - t0);
      let E = M + e * Math.sin(M);
      for (let it = 0; it < 4; it++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const x = a * (Math.cos(E) - e) * KM, y = a * Math.sqrt(1 - e * e) * Math.sin(E) * KM;
      out[k * 3] = x * el[o + 4] + y * el[o + 7]; out[k * 3 + 1] = x * el[o + 5] + y * el[o + 8]; out[k * 3 + 2] = x * el[o + 6] + y * el[o + 9];
    }
    this.beltPos.needsUpdate = true;
  }
  t0 = 0;
}
