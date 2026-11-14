// Hopper flight physics: ballistic hops over a round planet with thin or thick air, the rocket
// equation, and the final powered landing. Pure, deterministic, unit-tested in Node.
import { Body } from './world';

export const G0 = 9.80665;

export interface HopperSpec {
  /** Dry mass (kg), propellant capacity (kg), exhaust velocity (m/s), max thrust (N), cargo capacity (kg). */
  dry: number; propCap: number; ve: number; thrust: number; cargoCap: number;
  /** Ballistic coefficient m / (Cd·A) in kg/m², for drag. */
  beta: number;
  /** Touchdown speed the legs survive (m/s); how efficiently the computer lands (0 conservative … 1 sharp). */
  legs: number; autoSkill: number;
}

// ---------------------------------------------------------------- ballistic hop
export interface Arc {
  ok: boolean; gamma: number; v0: number; tof: number; apogee: number;
  vArr: number; gArr: number; range: number;
  /** Samples every few seconds: time (s), ground distance (m), height above datum (m). */
  path: { t: number; s: number; h: number }[];
}
/** Fly a ballistic arc from height h0 at speed v0 and elevation gamma until it comes down to height h1. */
export function integrate(b: Body, beta: number, h0: number, h1: number, v0: number, gamma: number, keepPath = false): Arc {
  const mu = b.g * b.R * b.R, dt = 0.5;
  let x = 0, y = b.R + h0, vx = v0 * Math.cos(gamma), vy = v0 * Math.sin(gamma), t = 0, apo = h0, prevUp = true;
  const path: Arc['path'] = keepPath ? [{ t: 0, s: 0, h: h0 }] : [];
  const acc = (px: number, py: number, qx: number, qy: number) => {
    const r = Math.hypot(px, py), g = -mu / (r * r * r), h = r - b.R, rho = b.rho0 * Math.exp(-Math.max(0, h) / b.H);
    // The climb is powered, so its air drag is booked as a loss in the budget; on the way down the air
    // slows the falling hopper for free. Air moves with the surface; rotation is ignored.
    const sp = Math.hypot(qx, qy), d = px * qx + py * qy < 0 ? rho * sp / (2 * beta) : 0;
    return [g * px - d * qx, g * py - d * qy];
  };
  for (let n = 0; n < 40000; n++) {
    // RK4 step
    const [a1x, a1y] = acc(x, y, vx, vy);
    const [a2x, a2y] = acc(x + vx * dt / 2, y + vy * dt / 2, vx + a1x * dt / 2, vy + a1y * dt / 2);
    const [a3x, a3y] = acc(x + (vx + a1x * dt / 2) * dt / 2, y + (vy + a1y * dt / 2) * dt / 2, vx + a2x * dt / 2, vy + a2y * dt / 2);
    const [a4x, a4y] = acc(x + (vx + a2x * dt / 2) * dt, y + (vy + a2y * dt / 2) * dt, vx + a3x * dt, vy + a3y * dt);
    const nx = x + dt * (vx + dt / 6 * (a1x + a2x + a3x)), ny = y + dt * (vy + dt / 6 * (a1y + a2y + a3y));
    const nvx = vx + dt / 6 * (a1x + 2 * a2x + 2 * a3x + a4x), nvy = vy + dt / 6 * (a1y + 2 * a2y + 2 * a3y + a4y);
    const r = Math.hypot(nx, ny), h = r - b.R, up = nx * nvx + ny * nvy > 0;
    t += dt;
    if (h > apo) apo = h;
    if (!up && prevUp && h < h1) return fail(); // never climbed above the landing site
    prevUp = up;
    if (!up && h <= h1) {
      // Interpolate the crossing for a smooth range.
      const r0 = Math.hypot(x, y) - b.R, f = (r0 - h1) / Math.max(1e-9, r0 - h);
      const fx = x + (nx - x) * f, fy = y + (ny - y) * f, fvx = vx + (nvx - vx) * f, fvy = vy + (nvy - vy) * f;
      const ang = Math.atan2(fx, fy), tt = t - dt + dt * f;
      const rr = Math.hypot(fx, fy), radial = (fx * fvx + fy * fvy) / rr, horiz = (fy * fvx - fx * fvy) / rr;
      if (keepPath) path.push({ t: tt, s: ang * b.R, h: h1 });
      return { ok: true, gamma, v0, tof: tt, apogee: apo, vArr: Math.hypot(fvx, fvy), gArr: Math.atan2(radial, horiz), range: ang * b.R, path };
    }
    x = nx; y = ny; vx = nvx; vy = nvy;
    if (keepPath && n % 8 === 7) path.push({ t, s: Math.atan2(x, y) * b.R, h });
    if (Math.atan2(x, y) > Math.PI * 0.9) return fail();
  }
  return fail();
  function fail(): Arc { return { ok: false, gamma, v0, tof: t, apogee: apo, vArr: 0, gArr: 0, range: 0, path }; }
}
/** Launch speed needed to cover a ground range at a given elevation (bisection on the integrator). */
export function solveArc(b: Body, beta: number, h0: number, h1: number, range: number, gamma: number, keepPath = false): Arc {
  let lo = 20, hi = Math.sqrt(2 * b.g * b.R) * 0.97, best: Arc | null = null;
  for (let k = 0; k < 34; k++) {
    const v = (lo + hi) / 2, a = integrate(b, beta, h0, h1, v, gamma);
    if (!a.ok || a.range < range) lo = v; else { hi = v; best = a; }
    if (hi - lo < 0.05) break;
  }
  if (!best) return { ok: false, gamma, v0: hi, tof: 0, apogee: 0, vArr: 0, gArr: 0, range: 0, path: [] };
  return keepPath ? integrate(b, beta, h0, h1, hi, gamma, true) : best;
}

// ---------------------------------------------------------------- powered phases
export const HANDOFF_ALT = 1500; // m above the pad where the computer hands the descent over
export interface Budget {
  arc: Arc; m0: number;
  /** Δv (m/s) and propellant (kg) for the climb, the braking burn, and the landing (estimate). */
  dvUp: number; dvBrake: number; dvLand: number; propUp: number; propBrake: number; propLand: number;
  /** Propellant left at hand-off and after an average landing (kg); flight time to hand-off (s). */
  propHandoff: number; propAfter: number; tHandoff: number; ok: boolean;
  /** State handed to the pilot. */
  handoff: LandState;
}
/** The whole hop's budget for a given arc, masses and propellant load. */
export function budget(b: Body, h: HopperSpec, arc: Arc, cargo: number, prop: number): Budget {
  const m0 = h.dry + cargo + prop;
  // Climb: thrust against gravity along a straight-ish pitch-over; the steeper, the more gravity costs.
  const tUp = arc.v0 / Math.max(0.5, h.thrust / m0 - b.g * Math.sin(arc.gamma) * 0.5);
  const dvUp = arc.v0 + b.g * Math.sin(arc.gamma) * tUp * 0.85 + ascentDrag(b, arc);
  const m1 = m0 * Math.exp(-dvUp / h.ve);
  // Braking: kill the arrival speed down to the hand-off speed, again paying gravity on the way.
  const vHand = handoffSpeed(arc.gArr);
  const tBr = Math.max(0, arc.vArr - vHand) / Math.max(0.5, h.thrust / m1 - b.g * 0.3);
  const dvBrake = Math.max(0, arc.vArr - vHand) + b.g * Math.abs(Math.sin(arc.gArr)) * tBr * 0.6;
  const m2 = m1 * Math.exp(-dvBrake / h.ve);
  const propHandoff = m2 - h.dry - cargo;
  // An average pilot's landing from hand-off: the descent speed plus gravity over a ~45 s descent.
  const dvLand = vHand + b.g * 38;
  const m3 = m2 * Math.exp(-dvLand / h.ve);
  const handoff = handoffState(arc.gArr, Math.max(0, propHandoff), h.dry + cargo);
  return {
    arc, m0, dvUp, dvBrake, dvLand, propUp: m0 - m1, propBrake: m1 - m2, propLand: m2 - m3,
    propHandoff, propAfter: m3 - h.dry - cargo, tHandoff: arc.tof + tBr * 0.5, ok: arc.ok && m3 - h.dry - cargo > 0 && cargo <= h.cargoCap && prop <= h.propCap + 1e-6,
    handoff,
  };
}
/** Δv lost to air on the powered climb: large on Earth, small on Mars. */
export const ascentDrag = (b: Body, arc: Arc) => b.rho0 * (110 + 0.05 * arc.v0) * (1 - 0.4 * Math.sin(arc.gamma));
export const handoffSpeed = (gArr: number) => 38 + 18 * Math.abs(Math.sin(gArr));
export function handoffState(gArr: number, prop: number, mass: number): LandState {
  const c = Math.cos(gArr);
  return { x: -460 * c - 60, z: HANDOFF_ALT, vx: 30 * c + 4, vz: -handoffSpeed(gArr), ang: 0.0, thr: 0, prop, mass, t: 0, done: null };
}

// ---------------------------------------------------------------- landing
export interface LandState {
  /** Offset from the pad centre (m, + downrange), height above the pad (m), velocities (m/s), tilt (rad, + leans downrange). */
  x: number; z: number; vx: number; vz: number; ang: number; thr: number;
  /** Propellant left (kg) and mass without propellant (kg); time since hand-off (s). */
  prop: number; mass: number; t: number;
  done: Touchdown | null;
}
export interface Touchdown {
  kind: 'pad' | 'near' | 'field' | 'hard' | 'crash';
  vz: number; vx: number; x: number; ang: number; prop: number; t: number;
}
export interface Controls { throttle: number; tilt: number }
export const PAD_HALF = 22, NEAR = 320, MAX_TILT = 0.6, TILT_RATE = 0.7, THR_RATE = 1.6;
export const LAND_DT = 1 / 60;

/** Advance the landing by one fixed step with the given throttle (0..1) and tilt target (−1..1). */
export function landStep(b: Body, h: HopperSpec, s: LandState, c: Controls): LandState {
  if (s.done) return s;
  const dt = LAND_DT, n = { ...s };
  const wantAng = Math.max(-1, Math.min(1, c.tilt)) * MAX_TILT;
  n.ang += Math.max(-TILT_RATE * dt, Math.min(TILT_RATE * dt, wantAng - n.ang));
  n.thr += Math.max(-THR_RATE * dt, Math.min(THR_RATE * dt, Math.max(0, Math.min(1, c.throttle)) - n.thr));
  const T = n.prop > 0 ? n.thr * h.thrust : 0, m = n.mass + n.prop;
  const ax = T / m * Math.sin(n.ang), az = T / m * Math.cos(n.ang) - b.g;
  n.prop = Math.max(0, n.prop - T / h.ve * dt);
  n.vx += ax * dt; n.vz += az * dt; n.x += n.vx * dt; n.z += n.vz * dt; n.t += dt;
  if (n.z <= 0) {
    n.z = 0;
    const tilt = Math.abs(n.ang), safe = Math.abs(n.vz) <= h.legs && Math.abs(n.vx) <= 2 && tilt <= 0.16;
    const hard = Math.abs(n.vz) <= h.legs * 2.2 && Math.abs(n.vx) <= 5 && tilt <= 0.35;
    const kind: Touchdown['kind'] = safe ? (Math.abs(n.x) <= PAD_HALF ? 'pad' : Math.abs(n.x) <= NEAR ? 'near' : 'field') : hard ? 'hard' : 'crash';
    n.done = { kind, vz: n.vz, vx: n.vx, x: n.x, ang: n.ang, prop: n.prop, t: n.t };
    n.thr = 0;
  }
  if (n.t > 400 && !n.done) n.done = { kind: 'crash', vz: n.vz, vx: n.vx, x: n.x, ang: n.ang, prop: n.prop, t: n.t };
  return n;
}
/** The flight computer's landing: safe, conservative, a little wasteful. Better software lands sharper. */
export function autopilot(b: Body, h: HopperSpec, s: LandState): Controls {
  const k = 0.11 + 0.07 * h.autoSkill;
  const vzRef = -Math.max(1.1, Math.min(48, k * s.z + 1.1));
  const lim = Math.min(14, 0.25 * s.z + 0.3);
  const vxRef = Math.max(-lim, Math.min(lim, -0.07 * s.x));
  const ax = (vxRef - s.vx) * 0.8, az = (vzRef - s.vz) * 1.4 + b.g;
  const m = s.mass + s.prop, T = m * Math.hypot(ax, Math.max(0.1, az));
  const ang = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan2(ax, Math.max(0.1, az))));
  // Stand up straight for the last few metres.
  const tilt = s.z < 3 ? 0 : ang / MAX_TILT;
  return { throttle: Math.max(0, Math.min(1, T / h.thrust)), tilt };
}
/** Run a landing to the end with the autopilot (used when nobody is at the controls). */
export function autoLand(b: Body, h: HopperSpec, s: LandState): LandState {
  let n = s;
  for (let k = 0; k < 60 * 400 && !n.done; k++) n = landStep(b, h, n, autopilot(b, h, n));
  return n;
}
