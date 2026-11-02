// Typed wrapper over the deterministic C++ simulation core (WebAssembly).
// All data passes through one shared Float64 IO buffer exported by the module.
import { CORE_WASM_B64 } from './core_wasm';

export const MU_EARTH = 398600.4418; // km^3/s^2
export const MU_SUN = 132712440018; // km^3/s^2
export const R_EARTH = 6371; // km
export const AU = 149597870.7; // km
export const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];
export interface State { r: Vec3; v: Vec3 }
/** Circular orbit: radius a (km), inclination, RAAN, argument of latitude u0 at epoch t0 (s). */
export interface Circ { a: number; i: number; raan: number; u0: number; t0: number }

let ex: any;
let IO: Float64Array;

function b64(s: string) {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function initCore() {
  const { instance } = await WebAssembly.instantiate(b64(CORE_WASM_B64));
  ex = instance.exports;
  IO = new Float64Array(ex.memory.buffer, ex.io(), 8192);
}

const getState = (o = 0): State => ({ r: [IO[o], IO[o + 1], IO[o + 2]], v: [IO[o + 3], IO[o + 4], IO[o + 5]] });
const putState = (s: State, o = 0) => {
  IO[o] = s.r[0]; IO[o + 1] = s.r[1]; IO[o + 2] = s.r[2];
  IO[o + 3] = s.v[0]; IO[o + 4] = s.v[1]; IO[o + 5] = s.v[2];
};
const putCirc = (c: Circ, o: number) => { IO[o] = c.a; IO[o + 1] = c.i; IO[o + 2] = c.raan; IO[o + 3] = c.u0; IO[o + 4] = c.t0; };
const put3 = (v: number[], o: number) => { IO[o] = v[0]; IO[o + 1] = v[1]; IO[o + 2] = v[2]; };

export interface Ephem { sun: Vec3; moon: Vec3; gmst: number; planets: Vec3[] }
export interface Pass { rise: number; set: number; maxEl: number; tMax: number }

export const core = {
  /** Universal-variable Kepler propagation by dt seconds. */
  kepler(s: State, dt: number, mu = MU_EARTH): State { putState(s); IO[6] = dt; IO[7] = mu; ex.kepler(); return getState(); },
  circ(c: Circ, t: number): State { putCirc(c, 0); IO[5] = t; ex.circ(); return getState(); },
  /** Relative state of ship w.r.t. target in the target's LVLH frame: p in metres, w in m/s. */
  rel(ship: State, tgt: State) { putState(ship, 0); putState(tgt, 6); ex.rel(); return { p: [IO[0], IO[1], IO[2]] as Vec3, w: [IO[3], IO[4], IO[5]] as Vec3 }; },
  abs(p: number[], w: number[], tgt: State): State { put3(p, 0); put3(w, 3); putState(tgt, 6); ex.abs(); return getState(); },
  basis(s: State) { putState(s); ex.basis(); return { V: [IO[0], IO[1], IO[2]] as Vec3, R: [IO[3], IO[4], IO[5]] as Vec3, H: [IO[6], IO[7], IO[8]] as Vec3 }; },
  orbitInfo(s: State, mu = MU_EARTH, rBody = R_EARTH) {
    putState(s); IO[6] = mu; IO[7] = rBody; ex.orbit_info();
    return { a: IO[0], e: IO[1], periAlt: IO[2], apoAlt: IO[3], alt: IO[4], period: IO[5], inc: IO[6] };
  },
  /** Sun and Moon geocentric (km), GMST, and heliocentric planets 0..5 (Mercury..Saturn). */
  ephem(t: number): Ephem {
    IO[0] = t; ex.ephem();
    const planets: Vec3[] = [];
    for (let k = 0; k < 6; k++) planets.push([IO[7 + 3 * k], IO[8 + 3 * k], IO[9 + 3 * k]]);
    return { sun: [IO[0], IO[1], IO[2]], moon: [IO[3], IO[4], IO[5]], gmst: IO[6], planets };
  },
  sunFraction(r: number[], sun: number[]) { put3(r, 0); put3(sun, 3); ex.sun_fraction(); return IO[0]; },
  latLon(r: number[], t: number) { put3(r, 0); IO[3] = t; ex.lat_lon(); return { lat: IO[0], lon: IO[1] }; },
  dose(alt: number, lat: number, lon: number, storm: boolean, shield: number) {
    IO[0] = alt; IO[1] = lat; IO[2] = lon; IO[3] = storm ? 1 : 0; IO[4] = shield; ex.dose();
    return { rate: IO[0], saa: IO[1] };
  },
  thermal(T: number, sunFrac: number, earthView: number, area: number, dt: number, power: number, rad = 200, cap = 278) {
    IO[0] = T; IO[1] = sunFrac; IO[2] = earthView; IO[3] = area; IO[4] = dt; IO[5] = power; IO[6] = rad; IO[7] = cap; ex.thermal();
    return { T: IO[0], qin: IO[1], qout: IO[2] };
  },
  /** Closest approach of a free ship to a circular target; also returns the relative path (LVLH metres). */
  closest(ship: State, tgt: Circ, t0: number, horizon: number, n: number) {
    putState(ship, 0); putCirc(tgt, 6); IO[11] = t0; IO[12] = horizon; IO[13] = n; ex.closest();
    const pts = new Float32Array(n * 3);
    for (let k = 0; k < n * 3; k++) pts[k] = IO[100 + k];
    return { d: IO[0], t: IO[1], p: [IO[2], IO[3], IO[4]] as Vec3, pts };
  },
  /** Lambert intercept: leave now, arrive at hold (LVLH m) next to the target after tof seconds. */
  intercept(ship: State, tgt: Circ, hold: number[], t0: number, tof: number) {
    putState(ship, 0); putCirc(tgt, 6); put3(hold, 11); IO[14] = t0; IO[15] = tof; ex.intercept();
    return { ok: IO[0] > 0, dv1: [IO[1], IO[2], IO[3]] as Vec3, dv2: [IO[4], IO[5], IO[6]] as Vec3, dv: IO[7], periAlt: IO[8] };
  },
  site(lat: number, lon: number, t: number): Vec3 { IO[0] = lat; IO[1] = lon; IO[2] = t; ex.site(); return [IO[0], IO[1], IO[2]]; },
  elevation(site: number[], sat: number[]) { put3(site, 0); put3(sat, 3); ex.elevation(); return IO[0]; },
  passes(sat: Circ, lat: number, lon: number, t0: number, horizon: number, minEl: number): Pass[] {
    putCirc(sat, 0); IO[5] = lat; IO[6] = lon; IO[7] = t0; IO[8] = horizon; IO[9] = minEl; ex.passes();
    const out: Pass[] = [];
    for (let k = 0; k < IO[0]; k++) out.push({ rise: IO[1 + 4 * k], set: IO[2 + 4 * k], maxEl: IO[3 + 4 * k], tMax: IO[4 + 4 * k] });
    return out;
  },
};

/** Small vector helpers on plain arrays. */
export const V = {
  add: (a: number[], b: number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: number[], b: number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  addm: (a: number[], b: number[], s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: number[], b: number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: number[]) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: number[]): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  dist: (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  lerp: (a: number[], b: number[], t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
