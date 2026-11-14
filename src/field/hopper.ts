// Hopper courier: carry cargo between settlements on ballistic rocket hops. You choose the jobs,
// the load, the propellant and the arc; the ship computer flies the climb and the braking burn;
// the last kilometre and a half of the landing is yours (or the computer's, at a propellant cost).
// The board is seeded per site and time slot (the same for every player); rival couriers take
// jobs at fixed times. Nothing is decided by a roll: running dry, a hard landing or a late
// delivery all come from the numbers you chose.
import { hash, rng } from '../game/util';
import { LocId, Region, HOP_REGIONS, Site, site, dist, Body } from './world';
import { Arc, Budget, HopperSpec, LandState, Touchdown, budget, solveArc, landStep, autopilot, autoLand, Controls, G0 } from './flight';

// ---------------------------------------------------------------- the networks
export interface HopLoc {
  id: LocId; hopper: string; home: string;
  base: HopperSpec; upgrades: HopUpgrade[];
  /** Propellant price per tonne at each site. */
  price: Record<string, number>;
  pay: (km: number, kg: number) => number;
  /** Cost to put a crashed or damaged hopper back in service (per unit of lost condition). */
  repair: number;
  rivals: { id: string; name: string; col: string }[];
  /** The last upgrade that opens Stage 2 if the hopper still can't reach orbit on its own. */
  orbital: HopUpgrade | null;
}
export interface HopUpgrade { id: string; name: string; blurb: string; cost: number; apply: (h: HopperSpec) => void; needs?: string }

const marsSites = (r: Region): Site[] => [
  site(r, 'jez', 'Jezero Port', 'Home pad', 18.22, 78.3, 'The delta settlement and your home pad. Water, labs, the main market.'),
  site(r, 'sei', 'Seitah Field', 'Science camp', 18.6, 77.75, 'A drill camp on the old crater floor.'),
  site(r, 'bel', 'Belva Outpost', 'Mine', 17.35, 79.7, 'Clay and iron mining in Belva crater.'),
  site(r, 'har', 'Hargraves Ice Works', 'Ice mine', 20.66, 75.73, 'Buried ice: the cheapest propellant in the region.'),
  site(r, 'nil', 'Nili Fossae Mine', 'Mine', 22.4, 76.9, 'Olivine and carbonates from the troughs.'),
  site(r, 'tor', 'Toro Station', 'Relay', 16.95, 71.45, 'A relay and power station on the Syrtis plateau.'),
  site(r, 'syr', 'Syrtis Farms', 'Farms', 11.9, 72.4, 'Greenhouses on the volcanic plain.'),
  site(r, 'isi', 'Isidis Centre', 'Town', 13.5, 86.6, 'The basin\'s biggest town, deep and warm.'),
  site(r, 'utg', 'Utopia Gate', 'Depot', 24.3, 86.4, 'Depot on the road north to Utopia.'),
  site(r, 'lib', 'Libya Montes Observatory', 'Observatory', 4.6, 84.0, 'Telescopes on the southern rim.'),
];
const earthSites = (r: Region): Site[] => [
  site(r, 'cape', 'Cape Canaveral', 'Home pad', 28.49, -80.58, 'Your home pad, next to the launch complexes.'),
  site(r, 'orl', 'Orlando Freight', 'Freight hub', 28.43, -81.31, 'Inland air and rail freight hub.'),
  site(r, 'seb', 'Sebastian Pad', 'Pad', 27.82, -80.47, 'A small pad by the inlet.'),
  site(r, 'tpa', 'Tampa Bay Pad', 'Port', 27.94, -82.45, 'Gulf coast port pad.'),
  site(r, 'jax', 'Jacksonville Port', 'Port', 30.36, -81.5, 'Northern container port.'),
  site(r, 'plat', 'Meridian Ocean Pad', 'Sea platform', 27.55, -78.45, 'A floating launch and landing platform. Makes its own methane.'),
  site(r, 'fpo', 'Freeport Spaceport', 'Spaceport', 26.55, -78.72, 'Grand Bahama spaceport.'),
  site(r, 'mia', 'Miami Freight Pad', 'City', 25.8, -80.26, 'Rooftop-scale city pad, busy and well paid.'),
  site(r, 'nas', 'Nassau Medical Pad', 'Hospital', 25.06, -77.35, 'Hospital pad: urgent cargo.'),
  site(r, 'kw', 'Key West Station', 'Station', 24.56, -81.78, 'End of the Keys.'),
];

export const HOP_LOCS: Record<LocId, HopLoc> = {
  mars: {
    id: 'mars', hopper: 'Kestrel', home: 'jez',
    base: { dry: 7500, propCap: 9000, ve: 345 * G0, thrust: 120e3, cargoCap: 4000, beta: 1500, legs: 2.5, autoSkill: 0 },
    upgrades: [
      { id: 'legs', name: 'Crushable legs', blurb: 'Survive touchdowns up to 4 m/s', cost: 5000, apply: h => { h.legs = 4; } },
      { id: 'avionics', name: 'Landing software', blurb: 'The computer lands sharper, using less propellant', cost: 7000, apply: h => { h.autoSkill = 1; } },
      { id: 'bay', name: 'Cargo bay', blurb: 'Carry 8 t instead of 4 t', cost: 10000, apply: h => { h.cargoCap = 8000; } },
      { id: 'tanks', name: 'Stretched tanks', blurb: '+5 t of propellant: longer hops', cost: 16000, apply: h => { h.propCap += 5000; } },
      { id: 'structure', name: 'Composite structure', blurb: '1.3 t lighter: every hop costs less', cost: 18000, apply: h => { h.dry -= 1300; } },
      { id: 'engine', name: 'Full-flow engine', blurb: 'Better exhaust velocity and 25% more thrust', cost: 22000, apply: h => { h.ve = 375 * G0; h.thrust = 150e3; } },
    ],
    price: { jez: 230, sei: 260, bel: 250, har: 130, nil: 170, tor: 280, syr: 300, isi: 260, utg: 210, lib: 380 },
    pay: (km, kg) => 1400 + 16 * km + 0.6 * kg,
    repair: 14000,
    rivals: [{ id: 'red', name: 'Redline Couriers', col: '#ff8a5c' }, { id: 'pho', name: 'Phobos Express', col: '#d68cff' }],
    orbital: null,
  },
  earth: {
    id: 'earth', hopper: 'Pelican', home: 'cape',
    base: { dry: 22000, propCap: 40000, ve: 340 * G0, thrust: 900e3, cargoCap: 8000, beta: 3000, legs: 2.5, autoSkill: 0 },
    upgrades: [
      { id: 'legs', name: 'Crushable legs', blurb: 'Survive touchdowns up to 4 m/s', cost: 6000, apply: h => { h.legs = 4; } },
      { id: 'avionics', name: 'Landing software', blurb: 'The computer lands sharper, using less propellant', cost: 8000, apply: h => { h.autoSkill = 1; } },
      { id: 'bay', name: 'Cargo bay', blurb: 'Carry 16 t instead of 8 t', cost: 12000, apply: h => { h.cargoCap = 16000; } },
      { id: 'tanks', name: 'Stretched tanks', blurb: '+25 t of propellant: reach the Keys and Nassau', cost: 20000, apply: h => { h.propCap += 25000; } },
      { id: 'structure', name: 'Composite structure', blurb: '4 t lighter: every hop costs less', cost: 22000, apply: h => { h.dry -= 4000; } },
      { id: 'engine', name: 'Full-flow engine', blurb: 'Better exhaust velocity and 25% more thrust', cost: 26000, apply: h => { h.ve = 360 * G0; h.thrust = 1125e3; } },
    ],
    price: { cape: 150, orl: 175, seb: 165, tpa: 170, jax: 160, plat: 95, fpo: 190, mia: 185, nas: 240, kw: 260 },
    pay: (km, kg) => 3000 + 30 * km + 0.5 * kg,
    repair: 30000,
    rivals: [{ id: 'gulf', name: 'Gulfstream Hop', col: '#ff8a5c' }, { id: 'bah', name: 'Bahama Air Freight', col: '#d68cff' }],
    orbital: { id: 'stage', name: 'Upper stage', blurb: 'A second stage on top: the only way to orbit from Earth', cost: 60000, apply: () => {}, needs: 'engine' },
  },
};

// ---------------------------------------------------------------- jobs
export interface Job {
  id: string; from: string; to: string; cargo: string; kg: number; pay: number;
  tA: number; tTaken: number; deadline: number; urgent: boolean; rival: string; own?: boolean;
}
const CARGO: Record<LocId, string[]> = {
  mars: ['Drill bits', 'Greenhouse seed stock', 'Medical supplies', 'Water ice', 'Lab samples', 'Reactor spares', 'Spare suits', 'Oxygen candles', 'Rover batteries', 'Mail and parcels', 'Clay bricks', 'Olivine ore samples'],
  earth: ['Medical supplies', 'Satellite parts', 'Seafood', 'Electronics', 'Organ transplant kit', 'Pharmaceuticals', 'Mail and parcels', 'Tourist luggage', 'Engine spares', 'Fresh flowers', 'Data storage', 'Lab reagents'],
};
export const JOB_SLOT = 600;

export class HopWorld {
  region: Region; sites: Site[]; cache = new Map<string, Job[]>();
  constructor(public L: HopLoc) {
    this.region = HOP_REGIONS[L.id];
    this.sites = L.id === 'mars' ? marsSites(this.region) : earthSites(this.region);
  }
  site(id: string) { return this.sites.find(s => s.id === id)!; }
  km(a: string, b: string) { return dist(this.site(a).p, this.site(b).p); }
  /** Pad height above the datum (m): sea level on Earth, the terrain on Mars. */
  elev(id: string) { const p = this.site(id).p; return this.region.loc === 'earth' ? 0 : this.region.heightAt(p.x, p.y); }
  /** Jobs posted at a site in one slot: the same for every player. */
  slotJobs(from: string, k: number): Job[] {
    const key = from + ':' + k;
    let jobs = this.cache.get(key);
    if (jobs) return jobs;
    const L = this.L, r = rng(hash('hop:' + L.id + ':' + key)), n = 3 + Math.floor(r() * 3);
    const others = this.sites.filter(s => s.id !== from);
    jobs = [];
    for (let i = 0; i < n; i++) {
      // Nearer destinations are more common, but there is always something far away and well paid.
      const sorted = [...others].sort((a, b) => this.km(from, a.id) - this.km(from, b.id));
      const to = sorted[Math.min(sorted.length - 1, Math.floor(Math.pow(r(), 1.6) * sorted.length))];
      const km = this.km(from, to.id), urgent = r() < 0.22;
      const kg = Math.round((300 + r() * (L.id === 'mars' ? 2800 : 6200)) / 50) * 50;
      const pay = Math.round(L.pay(km, kg) * (urgent ? 1.45 : 1) * (0.9 + r() * 0.25) / 50) * 50;
      const tA = k * JOB_SLOT + Math.round(r() * JOB_SLOT * 0.6);
      const rv = L.rivals[Math.floor(r() * L.rivals.length)];
      jobs.push({
        id: L.id + ':' + key + ':' + i, from, to: to.id, cargo: CARGO[L.id][Math.floor(r() * CARGO[L.id].length)], kg, pay,
        tA, tTaken: tA + Math.round((urgent ? 120 : 240) + r() * (urgent ? 420 : 900)),
        deadline: tA + Math.round((urgent ? 900 : 1800) + km * (L.id === 'mars' ? 2.2 : 1.6) + r() * 1200), urgent, rival: rv.id,
      });
    }
    this.cache.set(key, jobs);
    if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value!);
    return jobs;
  }
  /** Jobs on a site's board at time t (posted, not yet taken by a rival, deadline not past). */
  board(from: string, t: number): Job[] {
    const out: Job[] = [];
    for (let k = Math.floor(t / JOB_SLOT) - 3; k <= Math.floor(t / JOB_SLOT); k++)
      for (const j of this.slotJobs(from, k)) if (t >= j.tA && t < j.tTaken && t < j.deadline - 300) out.push(j);
    return out.sort((a, b) => a.tA - b.tA);
  }
  /** Rival hops in progress (for the map): each job a rival took becomes a flight a minute later. */
  rivalFlights(t: number) {
    const out: { from: string; to: string; t0: number; tof: number; rival: string; id: string }[] = [];
    for (const s of this.sites) for (let k = Math.floor(t / JOB_SLOT) - 3; k <= Math.floor(t / JOB_SLOT); k++)
      for (const j of this.slotJobs(s.id, k)) {
        const t0 = j.tTaken + 60, km = this.km(j.from, j.to), g = this.region.body.g;
        const v = Math.sqrt(km * 1000 * g), tof = 2 * v * Math.SQRT1_2 / g * (this.region.loc === 'earth' ? 0.9 : 1);
        if (t >= t0 && t < t0 + tof) out.push({ from: j.from, to: j.to, t0, tof, rival: j.rival, id: j.id });
      }
    return out;
  }
}

// ---------------------------------------------------------------- the company
export interface Flight {
  from: string; to: string; t0: number; gamma: number; cargo: number; propLoad: number; jobs: string[];
  tof: number; v0: number; apogee: number; vArr: number; gArr: number; range: number;
  tUp: number; tHandoff: number; propHandoff: number; handoff: LandState;
  path: { t: number; s: number; h: number }[];
  manual: boolean; result: Touchdown | null;
}
export interface HopSave {
  v: 1; loc: LocId; company: string; founded: number;
  credits: number; earned: number; spent: number;
  site: string; prop: number; condition: number; upg: Record<string, 1>;
  manifest: Job[]; taken: Record<string, 1>; flight: Flight | null;
  log: { t: number; text: string; kind: string }[];
  hops: number; pads: number; bestLand: number | null; orbital: boolean;
  /** The first contract, offered on your home board until you take it. */
  offer: Job | null;
}
export interface HopMsg { text: string; kind: string }
export const HOP_START = 12000;

export function newHopSave(loc: LocId, company: string, t: number): HopSave {
  const L = HOP_LOCS[loc], W = new HopWorld(L);
  // The first contract: a short hop from home, yours alone, posted the moment you start.
  const near = [...W.sites].filter(s => s.id !== L.home).sort((a, b) => W.km(L.home, a.id) - W.km(L.home, b.id))[0];
  const km = W.km(L.home, near.id);
  const first: Job = {
    id: 'first-' + Math.round(t), from: L.home, to: near.id, cargo: loc === 'mars' ? 'Core samples for the lab' : 'Medical supplies',
    kg: loc === 'mars' ? 1200 : 3000, pay: Math.round(L.pay(km, 1500) / 50) * 50, tA: t, tTaken: t + 1e9, deadline: t + 3600, urgent: false, rival: '', own: true,
  };
  return {
    v: 1, loc, company, founded: t, credits: HOP_START, earned: 0, spent: 0, site: L.home, prop: L.base.propCap * 0.5, condition: 1, upg: {},
    manifest: [], taken: { [first.id]: 1 }, flight: null, log: [], hops: 0, pads: 0, bestLand: null, orbital: false, offer: first,
  };
}

export interface Plan { gamma: number; arc: Arc; b: Budget; cost: number; refuel: number }

export class Hopper {
  L: HopLoc; W: HopWorld; msgs: HopMsg[] = [];
  /** The landing being flown right now (in this browser), from hand-off to touchdown. */
  live: LandState | null = null;
  private arcCache = new Map<string, Arc[]>();
  constructor(public s: HopSave) { this.L = HOP_LOCS[s.loc]; this.W = new HopWorld(this.L); }

  spec(): HopperSpec {
    const h = { ...this.L.base };
    for (const u of this.L.upgrades) if (this.s.upg[u.id]) u.apply(h);
    return h;
  }
  body(): Body { return this.W.region.body; }
  /** Δv with full tanks and no cargo: how close you are to orbit. */
  maxDv() { const h = this.spec(); return h.ve * Math.log((h.dry + h.propCap) / h.dry); }
  orbitCapable() { return this.L.orbital ? !!this.s.upg[this.L.orbital.id] : this.maxDv() >= this.body().orbitDv; }
  firstOffer(): Job | null { return this.s.offer; }
  board(t: number): Job[] {
    const b = this.W.board(this.s.site, t).filter(j => !this.s.taken[j.id]);
    const f = this.firstOffer();
    return f && this.s.site === f.from ? [f, ...b] : b;
  }
  manifestKg() { return this.s.manifest.reduce((a, j) => a + j.kg, 0); }
  accept(id: string, t: number): string | null {
    this.tick(t);
    if (this.s.flight) return 'In flight.';
    const j = this.board(t).find(x => x.id === id);
    if (!j) return 'That job is gone.';
    if (this.manifestKg() + j.kg > this.spec().cargoCap) return 'Over your cargo limit of ' + (this.spec().cargoCap / 1000) + ' t.';
    this.s.manifest.push(j); this.s.taken[j.id] = 1;
    if (j.own) this.s.offer = null;
    return null;
  }
  drop(id: string, t: number) {
    this.tick(t);
    if (this.s.flight) return;
    const j = this.s.manifest.find(x => x.id === id);
    if (!j) return;
    this.s.manifest = this.s.manifest.filter(x => x.id !== id);
    if (j.own) this.s.offer = j; // the first contract goes back on your board
  }

  // ---------- planning
  /** Arcs to a destination for every launch elevation 18°–76° (cached per route and hopper). */
  arcs(to: string): Arc[] {
    const h = this.spec(), key = this.s.site + '>' + to + ':' + h.beta;
    let a = this.arcCache.get(key);
    if (a) return a;
    const b = this.body(), range = this.W.km(this.s.site, to) * 1000, h0 = this.W.elev(this.s.site), h1 = this.W.elev(to);
    a = [];
    for (let g = 18; g <= 76; g += 2) a.push(solveArc(b, h.beta, h0, h1, range, g * Math.PI / 180));
    this.arcCache.set(key, a);
    return a;
  }
  /** A full plan: arc, budget, propellant to buy and its cost. propLoad null = just enough plus a margin. */
  plan(to: string, gammaDeg: number, propLoad: number | null): Plan | null {
    const h = this.spec(), arcs = this.arcs(to).filter(a => a.ok);
    if (!arcs.length) return null;
    const arc = arcs.reduce((a, b) => Math.abs(b.gamma - gammaDeg * Math.PI / 180) < Math.abs(a.gamma - gammaDeg * Math.PI / 180) ? b : a);
    const cargo = this.manifestKg();
    let load = propLoad ?? this.suggestLoad(arc, cargo);
    load = Math.max(this.s.prop, Math.min(h.propCap, load));
    const bu = budget(this.body(), h, arc, cargo, load);
    const refuel = Math.max(0, load - this.s.prop), cost = refuel / 1000 * this.L.price[this.s.site];
    return { gamma: arc.gamma * 180 / Math.PI, arc, b: bu, cost, refuel };
  }
  /** Least-Δv elevation for a route with the current load. */
  bestGamma(to: string): number {
    const h = this.spec(), cargo = this.manifestKg();
    let best = 45, bd = Infinity;
    for (const a of this.arcs(to)) if (a.ok) { const b = budget(this.body(), h, a, cargo, h.propCap); const d = b.dvUp + b.dvBrake; if (d < bd) { bd = d; best = a.gamma * 180 / Math.PI; } }
    return best;
  }
  /** Propellant for the hop plus an average landing plus 35% of that landing as margin. */
  suggestLoad(arc: Arc, cargo: number) {
    const h = this.spec();
    let lo = 0, hi = h.propCap;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2, b = budget(this.body(), h, arc, cargo, m);
      if (b.propAfter - b.propLand * 0.35 > 0) hi = m; else lo = m;
    }
    return Math.min(h.propCap, Math.ceil(hi / 100) * 100);
  }

  // ---------- flying
  launch(to: string, gammaDeg: number, propLoad: number | null, t: number): string | null {
    this.tick(t);
    const s = this.s;
    if (s.flight) return 'Already flying.';
    if (to === s.site) return 'Pick another pad.';
    if (s.condition < 0.5) return 'The hopper needs repairs first.';
    const p = this.plan(to, gammaDeg, propLoad);
    if (!p) return 'No arc reaches that far.';
    if (this.manifestKg() > this.spec().cargoCap) return 'Over the cargo limit.';
    if (s.credits < p.cost) return 'Not enough money for that much propellant (¤' + Math.round(p.cost).toLocaleString('en-US') + ').';
    s.credits -= p.cost; s.spent += p.cost; s.prop = p.b.m0 - this.spec().dry - this.manifestKg();
    const b = p.b, a = p.arc, full = this.W.km(s.site, to) * 1000;
    const tUp = Math.min(a.tof * 0.3, a.v0 / Math.max(1, this.spec().thrust / b.m0));
    s.flight = {
      from: s.site, to, t0: t, gamma: a.gamma, cargo: this.manifestKg(), propLoad: s.prop, jobs: s.manifest.map(j => j.id),
      tof: a.tof, v0: a.v0, apogee: a.apogee, vArr: a.vArr, gArr: a.gArr, range: full,
      tUp, tHandoff: t + b.tHandoff, propHandoff: b.propHandoff, handoff: b.handoff,
      path: solveArc(this.body(), this.spec().beta, this.W.elev(s.site), this.W.elev(to), full, a.gamma, true).path,
      manual: true, result: null,
    };
    s.prop = Math.max(0, b.propHandoff);
    return null;
  }
  /** Where the hopper is: phase, ground fraction of the route, height (m), seconds to hand-off. */
  where(t: number) {
    const f = this.s.flight;
    if (!f) return null;
    const dt = t - f.t0, total = f.tHandoff - f.t0;
    const phase = dt < f.tUp ? 'climb' : t < f.tHandoff - Math.min(60, total * 0.25) ? 'coast' : t < f.tHandoff ? 'brake' : f.result ? 'down' : 'landing';
    const k = Math.min(1, dt / total), tt = k * f.tof;
    let p = f.path[0];
    for (const q of f.path) { if (q.t > tt) break; p = q; }
    return { phase, frac: Math.min(1, p.s / f.range), h: t >= f.tHandoff ? 0 : p.h, toHandoff: f.tHandoff - t, k };
  }
  /** One frame of a live landing: manual controls or the computer. */
  landTick(c: Controls | null, frames: number, t: number) {
    const f = this.s.flight;
    if (!f || f.result || t < f.tHandoff) return;
    const b = this.body(), h = this.spec();
    let st = this.live || { ...f.handoff };
    for (let k = 0; k < frames && !st.done; k++) st = landStep(b, h, st, c && f.manual ? c : autopilot(b, h, st));
    this.live = st;
    if (st.done) this.touchdown(st.done, t);
  }
  liveLanding(): LandState | null { return this.live; }
  setManual(on: boolean) { if (this.s.flight) this.s.flight.manual = on; }

  /** Catch up with the clock: a landing nobody is watching is flown by the computer. */
  tick(t: number) {
    const f = this.s.flight, s = this.s;
    if (f && !f.result && t >= f.tHandoff + 25 && !this.live) {
      const end = autoLand(this.body(), this.spec(), f.handoff);
      this.touchdown(end.done!, t, true);
    }
    // Missed deadlines on cargo you are holding.
    if (!s.flight) for (const j of [...s.manifest]) if (t > j.deadline) {
      s.manifest = s.manifest.filter(x => x !== j);
      const fine = Math.round(j.pay * 0.25 / 50) * 50;
      s.credits -= fine; s.spent += fine;
      this.log('Missed the deadline for ' + j.cargo.toLowerCase() + ' to ' + this.W.site(j.to).name + '. Penalty ¤' + fine.toLocaleString('en-US') + '.', 'bad', t);
    }
  }
  private touchdown(d: Touchdown, t: number, auto = false) {
    const s = this.s, f = s.flight!;
    f.result = d; this.live = null;
    s.prop = Math.max(0, d.prop); s.site = f.to; s.hops++;
    const dest = this.W.site(f.to).name;
    const q = { pad: 1, near: 0.95, field: 0.8, hard: 0.85, crash: 0 }[d.kind];
    const words = {
      pad: 'Down on the pad at ' + dest + ', ' + Math.abs(d.vz).toFixed(1) + ' m/s.',
      near: 'Down ' + Math.round(Math.abs(d.x)) + ' m off the pad at ' + dest + '. The cargo goes the rest of the way by cart.',
      field: 'Down ' + Math.round(Math.abs(d.x)) + ' m out in the field near ' + dest + '. A long haul for the ground crew.',
      hard: 'Hard landing at ' + dest + ': ' + Math.abs(d.vz).toFixed(1) + ' m/s. Legs bent; the cargo survived.',
      crash: 'The hopper hit the ground at ' + Math.hypot(d.vz, d.vx).toFixed(0) + ' m/s near ' + dest + '. Cargo lost.',
    }[d.kind];
    this.log((auto ? '(Computer landing) ' : '') + words, d.kind === 'pad' ? 'ok' : d.kind === 'crash' || d.kind === 'hard' ? 'bad' : 'warn', t);
    if (d.kind === 'pad') { s.pads++; if (!auto && (s.bestLand === null || Math.abs(d.vz) < s.bestLand)) s.bestLand = Math.abs(d.vz); }
    if (d.kind === 'hard') s.condition = Math.max(0, s.condition - 0.3);
    if (d.kind === 'crash') s.condition = 0;
    let earned = 0;
    for (const j of [...s.manifest]) {
      if (d.kind === 'crash') {
        const fine = Math.round(j.pay * 0.25 / 50) * 50;
        s.credits -= fine; s.spent += fine; s.manifest = s.manifest.filter(x => x !== j);
        continue;
      }
      if (j.to !== f.to) continue;
      const late = t > j.deadline, pay = Math.round(j.pay * q * (late ? 0.5 : 1) / 10) * 10;
      earned += pay; s.manifest = s.manifest.filter(x => x !== j);
    }
    if (earned) { s.credits += earned; s.earned += earned; this.log('Delivered at ' + dest + ' · +¤' + earned.toLocaleString('en-US'), 'ok', t); }
    s.flight = null;
    this.lastResult = { d, earned, auto, dest };
  }
  lastResult: { d: Touchdown; earned: number; auto: boolean; dest: string } | null = null;
  repairCost() { return Math.round((1 - this.s.condition) * this.L.repair / 100) * 100; }
  repair(t: number): string | null {
    this.tick(t);
    const c = this.repairCost();
    if (!c) return null;
    if (this.s.flight) return 'In flight.';
    this.s.credits -= c; this.s.spent += c; this.s.condition = 1;
    this.log('Repaired for ¤' + c.toLocaleString('en-US') + '.', '', t);
    return null;
  }
  buy(id: string, t: number): string | null {
    this.tick(t);
    const u = [...this.L.upgrades, ...(this.L.orbital ? [this.L.orbital] : [])].find(x => x.id === id);
    if (!u || this.s.upg[id]) return null;
    if (this.s.flight) return 'Upgrades happen on the ground.';
    if (u.needs && !this.s.upg[u.needs]) return 'Needs the ' + this.L.upgrades.find(x => x.id === u.needs)!.name.toLowerCase() + ' first.';
    if (this.s.credits < u.cost) return 'Not enough money yet.';
    this.s.credits -= u.cost; this.s.spent += u.cost; this.s.upg[id] = 1;
    this.s.prop = Math.min(this.s.prop, this.spec().propCap);
    this.arcCache.clear();
    this.log(u.name + ' fitted.', 'ok', t);
    if (this.orbitCapable() && !this.s.orbital) { this.s.orbital = true; this.log('Your hopper can now reach orbit. Stage 2 is open to you.', 'ok', t); }
    return null;
  }
  private log(text: string, kind: string, t: number) { this.s.log.unshift({ t, text, kind }); if (this.s.log.length > 40) this.s.log.pop(); this.msgs.push({ text, kind }); }
}
