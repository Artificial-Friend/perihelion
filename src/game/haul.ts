// Stage 3: interplanetary hauling with a fusion torch. Real planet and Moon positions;
// trips are accelerate-flip-brake arcs computed by the ship computer from the real
// motion of departure and arrival points. The player chooses the plan and the crew state.
import { core, V, Vec3, AU, DEG, MU_SUN, R_EARTH } from '../sim/core';
import { HAVEN } from './orbit';
import { hash, rng } from './util';

const G0 = 9.80665e-3; // km/s^2
const OBL = 23.4392911 * DEG;
const J2000_JD = 2451545.0;

interface Elements { a: number; e: number; i: number; node: number; peri: number; M0: number; epochJD: number }
/** Heliocentric J2000 equatorial position (km) of a small body from osculating elements. */
function bodyHelio(el: Elements, t: number): Vec3 {
  const a = el.a * AU, n = Math.sqrt(MU_SUN / (a * a * a)), dt = t - (el.epochJD - J2000_JD) * 86400;
  let M = (el.M0 * DEG + n * dt) % (2 * Math.PI), E = M;
  for (let k = 0; k < 12; k++) E = E - (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  const x = a * (Math.cos(E) - el.e), y = a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const w = el.peri * DEG, O = el.node * DEG, i = el.i * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  const X = (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y;
  const Y = (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y;
  const Z = (sw * si) * x + (cw * si) * y;
  return [X, Y * Math.cos(OBL) - Z * Math.sin(OBL), Y * Math.sin(OBL) + Z * Math.cos(OBL)];
}
const CERES: Elements = { a: 2.7663, e: 0.0789, i: 10.587, node: 80.393, peri: 73.924, M0: 6.072, epochJD: J2000_JD };
const KAMO: Elements = { a: 1.00105, e: 0.10289, i: 7.792, node: 66.04, peri: 306.1, M0: 92, epochJD: J2000_JD };

export interface Port { id: string; name: string; where: string; body: string; risk: number; col: string }
export const PORTS: Port[] = [
  { id: 'haven', name: 'Haven Commercial', where: 'Low Earth orbit', body: 'earth', risk: 0.02, col: '#4da3ff' },
  { id: 'gateway', name: 'Shackleton Gateway', where: 'Lunar orbit', body: 'moon', risk: 0.05, col: '#c8d4e6' },
  { id: 'kamo', name: 'Kamoʻoalewa Mine', where: 'Near-Earth asteroid', body: 'kamo', risk: 0.12, col: '#b48cff' },
  { id: 'phobos', name: 'Phobos Depot', where: 'Mars orbit', body: 'mars', risk: 0.18, col: '#ff8a5c' },
  { id: 'ceres', name: 'Ceres Station', where: 'Main belt', body: 'ceres', risk: 0.3, col: '#2fd6b5' },
];
export const portById = (id: string) => PORTS.find(p => p.id === id)!;

/** Heliocentric position (km) of a port. */
export function portHelio(id: string, t: number): Vec3 {
  const e = core.ephem(t), earth = V.mul(e.sun, -1);
  switch (id) {
    case 'haven': return V.add(earth, core.circ(HAVEN, t).r);
    case 'gateway': return V.add(V.add(earth, e.moon), V.mul(V.norm(e.moon), -3000));
    case 'phobos': return V.add(e.planets[3], [0, 9376, 0]);
    case 'kamo': return bodyHelio(KAMO, t);
    case 'ceres': return bodyHelio(CERES, t);
  }
  return earth;
}
export function bodyHelioPos(body: string, t: number): Vec3 {
  if (body === 'kamo') return bodyHelio(KAMO, t);
  if (body === 'ceres') return bodyHelio(CERES, t);
  return portHelio(body === 'moon' ? 'gateway' : body === 'mars' ? 'phobos' : 'haven', t);
}
export function portVel(id: string, t: number): Vec3 { return V.mul(V.sub(portHelio(id, t + 30), portHelio(id, t - 30)), 1 / 60); }
/** Convert heliocentric to the geocentric frame the renderer uses. */
export function helioToGeo(p: number[], t: number): Vec3 { return V.add(p, core.ephem(t).sun); }

// Hermite arc between two moving points, matching both positions and velocities.
function herm(P0: number[], V0: number[], P1: number[], V1: number[], T: number, s: number): Vec3 {
  const s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return [0, 1, 2].map(k => h00 * P0[k] + h10 * T * V0[k] + h01 * P1[k] + h11 * T * V1[k]) as Vec3;
}
function hermAcc(P0: number[], V0: number[], P1: number[], V1: number[], T: number, s: number): Vec3 {
  return [0, 1, 2].map(k => ((12 * s - 6) * P0[k] + (6 * s - 4) * T * V0[k] + (-12 * s + 6) * P1[k] + (6 * s - 2) * T * V1[k]) / (T * T)) as Vec3;
}

export interface TripPlan { id: string; label: string; g: number; stasis: boolean; T: number; dv: number; fuel: number; risk: number; note: string; peakG: number }
export interface Trip { from: string; to: string; t0: number; T: number; g: number; stasis: boolean; P0: Vec3; V0: Vec3; P1: Vec3; V1: Vec3; contract: HaulContract | null; planId: string; event?: TripEvent }
export interface TripEvent { t: number; kind: 'raid' | 'storm'; text: string; outcome: string; loss: number; shown?: boolean }
export interface HaulContract { id: string; from: string; to: string; cargo: string; tonnes: number; pay: number; deadline: number }
export interface HaulSave { port: string | null; trip: Trip | null; delivered: number; earned: number; log: string[]; taken: Record<string, 1> }

const FUEL_PER_KMS = 6;

/** Solve trip duration for a constant drive acceleration (g), departing now. */
export function solveTrip(from: string, to: string, t0: number, g: number) {
  const a = g * G0, P0 = portHelio(from, t0), V0 = portVel(from, t0);
  let T = 2 * Math.sqrt(V.dist(P0, portHelio(to, t0)) / a);
  let P1 = P0, V1 = V0;
  for (let k = 0; k < 40; k++) {
    P1 = portHelio(to, t0 + T); V1 = portVel(to, t0 + T);
    const peak = Math.max(V.len(hermAcc(P0, V0, P1, V1, T, 0)), V.len(hermAcc(P0, V0, P1, V1, T, 1)));
    const nT = T * Math.sqrt(peak / (1.5 * a));
    if (Math.abs(nT - T) < 1) { T = nT; break; }
    T = 0.5 * T + 0.5 * nT;
  }
  P1 = portHelio(to, t0 + T); V1 = portVel(to, t0 + T);
  let dv = 0;
  for (let k = 0; k < 24; k++) dv += V.len(hermAcc(P0, V0, P1, V1, T, (k + 0.5) / 24)) * T / 24;
  return { T, dv, P0, V0, P1, V1 };
}

export function tripPlans(from: string, to: string, t0: number, tonnes: number, crewTough = 1): TripPlan[] {
  const dist = V.dist(portHelio(from, t0), portHelio(to, t0)), cis = dist < 2e6;
  const route = Math.max(portById(from).risk, portById(to).risk);
  const defs = cis
    ? [{ id: 'cruise', label: 'Cruise', g: 1, stasis: false, note: 'Crew awake at 1 g. They can work, repair and fight.' },
       { id: 'sprint', label: 'Sprint', g: 12, stasis: false, note: 'Crew awake on acceleration drugs at 12 g. Hard on them; fast.' },
       { id: 'stasis', label: 'Stasis', g: 100, stasis: true, note: 'Crew asleep at 100 g. Fastest. The computer alone defends the ship.' }]
    : [{ id: 'economy', label: 'Economy', g: 0.3, stasis: false, note: 'Gentle 0.3 g, crew awake. Cheapest propellant.' },
       { id: 'cruise', label: 'Cruise', g: 1, stasis: false, note: 'Crew awake at 1 g. The standard long haul.' },
       { id: 'stasis', label: 'Stasis', g: 8 * crewTough, stasis: true, note: 'Crew asleep at 8 g. Much faster; the computer alone defends the ship.' }];
  return defs.map(d => {
    const s = solveTrip(from, to, t0, d.g);
    const fuel = Math.round(s.dv * FUEL_PER_KMS * (1 + tonnes / 60) / 10) * 10;
    const risk = Math.min(0.6, route * (d.stasis ? 1.6 : 1));
    return { ...d, T: s.T, dv: s.dv, fuel, risk, peakG: d.g * 1.5 };
  });
}

const CARGO: Record<string, string[]> = {
  haven: ['Machine parts', 'Medical supplies', 'Crew rotation', 'Reactor fuel pellets', 'Seed stock'],
  gateway: ['Helium-3', 'Regolith bricks', 'Liquid oxygen'],
  kamo: ['Platinum-group ore', 'Nickel-iron slabs'],
  phobos: ['Deuterium', 'Mars rover spares', 'Science samples'],
  ceres: ['Water ice', 'Ammonia', 'Carbonaceous ore'],
};

/** Contract board at a port: deterministic for everyone, refreshed every 30 minutes. */
export function board(port: string, t: number): HaulContract[] {
  const slot = Math.floor(t / 1800), r = rng(hash(port + slot)), out: HaulContract[] = [];
  const others = PORTS.filter(p => p.id !== port);
  // The nearest port always appears twice, so there is short work as well as long hauls.
  const near = [...others].sort((a, b) => V.dist(portHelio(port, t), portHelio(a.id, t)) - V.dist(portHelio(port, t), portHelio(b.id, t)))[0];
  for (let k = 0; k < 4; k++) {
    const to = k < 2 ? near.id : others[Math.floor(r() * others.length)].id, tonnes = Math.round(20 + r() * 180);
    const cruise = solveTrip(port, to, t, 1);
    const far = Math.log10(Math.max(1e4, V.dist(portHelio(port, t), portHelio(to, t))));
    const pay = Math.round((2500 + Math.pow(Math.max(0, far - 3.5), 2.2) * 1800 + tonnes * 25) * (0.85 + r() * 0.4) / 100) * 100;
    const list = CARGO[port];
    out.push({ id: port + slot + '-' + k, from: port, to, cargo: list[Math.floor(r() * list.length)], tonnes, pay, deadline: slot * 1800 + cruise.T * (1.6 + r()) + 1800 });
  }
  return out;
}

export class Haul {
  constructor(public s: HaulSave, public company: string, public pay: (n: number, why: string) => void,
    public spend: (n: number) => boolean, public note: (t: string, k?: string) => void, public bark: (who: string, t: string) => void) {}

  shipHelio(t: number): Vec3 {
    const tr = this.s.trip;
    if (!tr) return portHelio(this.s.port || 'haven', t);
    const s = Math.min(1, Math.max(0, (t - tr.t0) / tr.T));
    return herm(tr.P0, tr.V0, tr.P1, tr.V1, tr.T, s);
  }
  shipVel(t: number): Vec3 { return V.mul(V.sub(this.shipHelio(t + 5), this.shipHelio(t - 5)), 0.1); }
  shipGeo(t: number) { return helioToGeo(this.shipHelio(t), t); }
  progress(t: number) { const tr = this.s.trip; return tr ? Math.min(1, (t - tr.t0) / tr.T) : 0; }
  path(n = 120): Vec3[] {
    const tr = this.s.trip; if (!tr) return [];
    const out: Vec3[] = [];
    for (let k = 0; k <= n; k++) out.push(herm(tr.P0, tr.V0, tr.P1, tr.V1, tr.T, k / n));
    return out;
  }

  depart(to: string, plan: TripPlan, contract: HaulContract | null, t: number) {
    if (!this.s.port || this.s.trip) return;
    if (!this.spend(plan.fuel)) { this.note('Not enough money for propellant.', 'warn'); return; }
    const s = solveTrip(this.s.port, to, t, plan.g);
    const trip: Trip = { from: this.s.port, to, t0: t, T: s.T, g: plan.g, stasis: plan.stasis, P0: s.P0, V0: s.V0, P1: s.P1, V1: s.V1, contract, planId: plan.id };
    // Decide now (deterministically) whether anything happens on the way.
    const r = rng(hash(this.company + t.toFixed(0) + to));
    if (r() < plan.risk) {
      const defended = r() < (plan.stasis ? 0.5 : 0.85), loss = defended ? 0 : 0.3 + r() * 0.3;
      trip.event = {
        t: t + s.T * (0.3 + r() * 0.4), kind: 'raid', loss,
        text: plan.stasis ? 'Pirate skiff matched course while the crew slept.' : 'Pirate skiff matched course and hailed us.',
        outcome: defended ? (plan.stasis ? 'The computer burned hard and outran them.' : 'Kwame talked them down while Sofia turned the drive plume on them. They broke off.')
          : 'They cut into the cargo bay and took ' + Math.round(loss * 100) + '% of the cargo.',
      };
    } else if (!plan.stasis && s.T > 6 * 3600 && r() < 0.35) {
      trip.event = { t: t + s.T * (0.2 + r() * 0.5), kind: 'storm', loss: 0, text: 'Solar proton storm.', outcome: 'Crew sheltered behind the water tanks. Dose kept low.' };
    }
    if (contract) this.s.taken[contract.id] = 1;
    this.s.trip = trip; this.s.port = null;
    this.bark('sofia', 'Torch lit. ' + (plan.stasis ? 'Sleep well, everyone; see you at ' : 'Settle in. Next stop ') + portById(to).name + '.');
  }
  /** Dev helper: arrive now. */
  skip(t: number) { if (this.s.trip) this.s.trip.t0 = t - this.s.trip.T - 1; }

  tick(t: number) {
    const tr = this.s.trip; if (!tr) return;
    if (tr.event && !tr.event.shown && t >= tr.event.t) {
      tr.event.shown = true;
      const k = tr.event.loss > 0 ? 'bad' : 'ok';
      this.note(tr.event.text + ' ' + tr.event.outcome, k);
      this.s.log.unshift(tr.event.text + ' ' + tr.event.outcome);
    }
    if (t >= tr.t0 + tr.T) {
      this.s.trip = null; this.s.port = tr.to;
      const c = tr.contract;
      if (c) {
        const late = t > c.deadline + 60, loss = tr.event?.loss || 0;
        const amount = Math.round(c.pay * (1 - loss) * (late ? 0.5 : 1));
        this.s.delivered++; this.s.earned += amount;
        this.pay(amount, c.tonnes + ' t of ' + c.cargo.toLowerCase() + ' delivered to ' + portById(tr.to).name + (late ? ' (late, half pay)' : ''));
        this.s.log.unshift('Delivered ' + c.cargo + ' to ' + portById(tr.to).name + ' for ¤' + amount.toLocaleString('en-US') + '.');
      } else this.note('Arrived at ' + portById(tr.to).name + '.', 'ok');
      this.bark('sofia', 'Flip-and-burn complete. Docked at ' + portById(tr.to).name + '.');
    }
  }
}

export function newHaul(): HaulSave { return { port: 'haven', trip: null, delivered: 0, earned: 0, log: [], taken: {} }; }
export { G0, R_EARTH };
