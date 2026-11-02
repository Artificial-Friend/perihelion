// Stage 1: the control room (satellite passes, recovery at sea, research) and the hangar.
import { core, Circ, DEG, R_EARTH, V } from '../sim/core';
import { hash, rng, gcLerp, gcDistKm, LatLon } from './util';

export const SITES: Record<string, { name: string; lat: number; lon: number; port: LatLon; sea: number }> = {
  us: { name: 'Cape Canaveral', lat: 28.49, lon: -80.58, port: { lat: 28.41, lon: -80.6 }, sea: 85 },
  eu: { name: 'Kourou', lat: 5.24, lon: -52.77, port: { lat: 5.16, lon: -52.65 }, sea: 40 },
  cn: { name: 'Wenchang', lat: 19.61, lon: 110.95, port: { lat: 19.55, lon: 111.03 }, sea: 125 },
};

export interface Item { id: string; name: string; blurb: string; cost: number; min: number }
export const MODULES: Item[] = [
  { id: 'frame', name: 'Pressure hull', blurb: 'Crew module and frame', cost: 6000, min: 3 },
  { id: 'life', name: 'Life support', blurb: 'Air, water, heat', cost: 5000, min: 3 },
  { id: 'prop', name: 'Propulsion', blurb: 'Tanks, engine, thrusters', cost: 7000, min: 4 },
  { id: 'power', name: 'Power & radiators', blurb: 'Solar wings, coolant loop', cost: 4500, min: 3 },
  { id: 'arm', name: 'Grapple arm', blurb: 'Makes a tug a salvage tug', cost: 3500, min: 2 },
];
export const RESEARCH: Item[] = [
  { id: 'antenna2', name: 'Second antenna', blurb: 'Track two satellites at once', cost: 4000, min: 4 },
  { id: 'fastboat', name: 'Fast recovery boat', blurb: 'Boat 60% faster', cost: 3000, min: 3 },
  { id: 'lighttank', name: 'Lightweight tanks', blurb: '15% cheaper propellant in orbit', cost: 5000, min: 5 },
];
export const LAUNCH_COST = 6000;
export const START_CREDITS = 24000;
/** Everything Stage 1 asks you to pay for before launch. */
export const STAGE1_TOTAL = MODULES.reduce((a, m) => a + m.cost, 0) + LAUNCH_COST;
const SLOT = 1200, WARN = 1200;

export interface SatDef { name: string; client: string; orbit: Circ }
export interface GroundSave {
  sats: SatDef[]; booked: Record<string, number>; paid: Record<string, 1>;
  build: Record<string, { end: number }>; research: Record<string, { end: number }>;
  boat: { evId: string; from: LatLon; to: LatLon; t0: number; retargeted?: boolean } | null;
  recovered: Record<string, 'ok' | 'miss'>; auto: boolean; launched: boolean; earned: number;
}
export interface PassInfo { id: string; sat: string; client: string; rise: number; set: number; maxEl: number; pay: number; booked: boolean; conflict: boolean; state: 'future' | 'live' | 'done' }
export interface RecoveryEvent { id: string; kind: string; from: string; tLand: number; t0: number; actual: LatLon; guess: LatLon; pay: number }

const CLIENTS = ['Polar Imaging', 'Meshcom', 'Kestrel Weather', 'University of Lviv', 'AgriSat', 'Tidewatch', 'Aurora Labs', 'Orbit Insurance', 'Seagrass Survey', 'Lumen Relay', 'Andes Geodesy', 'Icewatch', 'FarmView', 'Harbor AIS', 'Delta Methane Watch', 'Kyiv Polytechnic', 'Sahel Rainfall', 'Coral Census', 'Northstar Mesh', 'Fjord Ferries', 'Atlas Forestry', 'Monsoon Labs'];
const INCS = [97.6, 53, 51.6, 82, 45, 97.4, 63.4, 70, 98.1, 55, 87, 97.8, 42, 65, 36, 97.5, 20, 30, 53.2, 75, 98, 40];

/** Client CubeSats for a new company; the first one is placed so it rises over the base within a minute or two. */
export function makeSats(company: string, siteId: string, now: number): SatDef[] {
  const site = SITES[siteId], r = rng(hash(company + siteId));
  const sats: SatDef[] = CLIENTS.map((client, k) => ({
    name: client.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() + '-' + (10 + Math.floor(r() * 80)),
    client, orbit: { a: R_EARTH + 430 + r() * 220, i: INCS[k] * DEG, raan: r() * Math.PI * 2, u0: r() * Math.PI * 2, t0: 0 },
  }));
  // Tutorial pass: search the first satellite's plane and phase so a good pass starts ~90 s from now.
  const s0 = sats[0];
  let best = { raan: s0.orbit.raan, u: s0.orbit.u0, score: 1e9 };
  for (let a = 0; a < 24; a++) for (let k = 0; k < 36; k++) {
    const o = { ...s0.orbit, raan: a / 24 * Math.PI * 2, u0: k / 36 * Math.PI * 2 };
    for (const p of core.passes(o, site.lat, site.lon, now, 900, 10)) {
      const dt = p.rise - now, score = Math.abs(dt - 90) + (60 - Math.min(60, p.maxEl)) * 3;
      if (dt > 45 && score < best.score) best = { raan: o.raan, u: o.u0, score };
    }
  }
  s0.orbit.raan = best.raan; s0.orbit.u0 = best.u;
  return sats;
}

export function newGround(company: string, siteId: string, now: number): GroundSave {
  return { sats: makeSats(company, siteId, now), booked: {}, paid: {}, build: {}, research: {}, boat: null, recovered: {}, auto: false, launched: false, earned: 0 };
}

export class Ground {
  site: typeof SITES[string];
  now = 0;
  private passCache = { t: -1e9, list: [] as PassInfo[] };
  constructor(public s: GroundSave, siteId: string, public pay: (n: number, why: string) => void,
    public spend: (n: number) => boolean, public note: (t: string, k?: string) => void) {
    this.site = SITES[siteId];
  }
  get sats() { return this.s.sats; }
  antennas() { return this.done('research', 'antenna2', this.now) ? 2 : 1; }
  done(kind: 'build' | 'research', id: string, t: number) { const j = (kind === 'build' ? this.s.build : this.s.research)[id]; return !!j && j.end <= t; }
  inProgress(kind: 'build' | 'research', t: number) {
    const m = kind === 'build' ? this.s.build : this.s.research;
    return Object.entries(m).find(([, j]) => j.end > t)?.[0] || null;
  }
  builtCount(t: number) { return MODULES.filter(m => this.done('build', m.id, t)).length; }

  passes(t: number): PassInfo[] {
    if (t - this.passCache.t > 45) {
      const list: PassInfo[] = [];
      for (const s of this.sats) for (const p of core.passes(s.orbit, this.site.lat, this.site.lon, t - 900, 3 * 3600, 8)) {
        const pay = Math.round((600 + p.maxEl * 25 + (p.set - p.rise) * 1.5) / 50) * 50;
        list.push({ id: s.name + '@' + Math.round(p.rise / 30), sat: s.name, client: s.client, rise: p.rise, set: p.set, maxEl: p.maxEl, pay, booked: false, conflict: false, state: 'future' });
      }
      list.sort((a, b) => a.rise - b.rise);
      this.passCache = { t, list };
    }
    const list = this.passCache.list;
    for (const p of list) { p.booked = !!this.s.booked[p.id]; p.state = t < p.rise ? 'future' : t < p.set ? 'live' : 'done'; }
    for (const p of list) p.conflict = !p.booked && this.overlaps(p, list) >= this.antennas();
    return list;
  }
  overlaps(p: PassInfo, list: PassInfo[]) { return list.filter(q => q.booked && q.id !== p.id && q.rise < p.set && p.rise < q.set).length; }
  book(id: string, t: number) {
    const p = this.passes(t).find(x => x.id === id);
    if (!p || p.state === 'done') return;
    if (p.booked) { if (p.state === 'future') delete this.s.booked[id]; return; }
    if (p.conflict) { this.note('The antenna is busy then. Research a second antenna, or pick another pass.', 'warn'); return; }
    this.s.booked[id] = p.pay;
  }

  recoveryEvents(t: number): RecoveryEvent[] {
    const out: RecoveryEvent[] = [];
    for (let k = Math.floor(t / SLOT) - 1; k <= Math.floor(t / SLOT) + 1; k++) {
      const r = rng(hash(this.site.name + k)), tLand = k * SLOT + 300 + r() * 600, t0 = tLand - WARN;
      if (t < t0 || t > tLand + 900) continue;
      const bearing = (this.site.sea + (r() - 0.5) * 60) * DEG, dist = 40 + r() * 50;
      const at = (d: number, b: number): LatLon => ({
        lat: this.site.port.lat + d / 111 * Math.cos(b),
        lon: this.site.port.lon + d / (111 * Math.cos(this.site.port.lat * DEG)) * Math.sin(b),
      });
      const actual = at(dist, bearing), guess = at(dist + (r() - 0.5) * 50, bearing + (r() - 0.5) * 0.5);
      out.push({ id: 'rec' + k, kind: r() > 0.5 ? 'Booster' : 'Capsule', from: ['Vandenberg', 'Baikonur', 'Sriharikota', 'Tanegashima', 'Esrange'][Math.floor(r() * 5)], tLand, t0, actual, guess, pay: Math.round((4000 + r() * 3000) / 100) * 100 });
    }
    return out;
  }
  /** The active (next) splashdown not yet resolved. */
  activeRecovery(t: number) { return this.recoveryEvents(t).find(e => t < e.tLand + 60 && !this.s.recovered[e.id]) || null; }
  prediction(e: RecoveryEvent, t: number) {
    const k = Math.min(1, Math.max(0, (t - e.t0) / (e.tLand - e.t0)));
    return { centre: gcLerp(e.guess, e.actual, k * k), radiusKm: 3 + 45 * (1 - k) };
  }
  boatSpeed() { return this.done('research', 'fastboat', this.now) ? 720 : 450; }
  boatPos(t: number) {
    const b = this.s.boat; if (!b) return null;
    const d = gcDistKm(b.from, b.to), dur = d / this.boatSpeed() * 3600, k = dur <= 0 ? 1 : Math.min(1, (t - b.t0) / dur);
    return { pos: gcLerp(b.from, b.to, k), arrived: k >= 1, eta: Math.max(0, b.t0 + dur - t) };
  }
  dispatch(e: RecoveryEvent, t: number) {
    const from = this.boatPos(t)?.pos || this.site.port, pr = this.prediction(e, t);
    if (!this.s.boat && !this.spend(500)) { this.note('Not enough money to fuel the boat.', 'warn'); return; }
    this.s.boat = { evId: e.id, from, to: pr.centre, t0: t };
  }
  start(kind: 'build' | 'research', id: string, t: number) {
    const list = kind === 'build' ? MODULES : RESEARCH, item = list.find(x => x.id === id)!, m = kind === 'build' ? this.s.build : this.s.research;
    if (m[id]) return;
    if (this.inProgress(kind, t)) { this.note(kind === 'build' ? 'The hangar crew is busy with another module.' : 'The lab is busy.', 'warn'); return; }
    if (!this.spend(item.cost)) { this.note('Not enough money yet. Book satellite passes and recover boosters to earn more.', 'warn'); return; }
    m[id] = { end: t + item.min * 60 };
  }
  /** Can the boat still reach the zone before splashdown? */
  boatReach(e: RecoveryEvent, t: number) {
    const from = this.boatPos(t)?.pos || this.site.port, d = gcDistKm(from, this.prediction(e, t).centre);
    return d / this.boatSpeed() * 3600 < e.tLand - t + 60;
  }
  shipReady(t: number) { return MODULES.every(m => this.done('build', m.id, t)); }
  /** What Stage 1 still needs you to pay for. */
  remainingCost() { return MODULES.filter(m => !this.s.build[m.id]).reduce((a, m) => a + m.cost, 0) + (this.s.launched ? 0 : LAUNCH_COST); }

  tick(t: number) {
    this.now = t;
    const list = this.passes(t);
    for (const p of list) if (p.booked && p.state === 'done' && !this.s.paid[p.id]) {
      this.s.paid[p.id] = 1; this.s.earned += this.s.booked[p.id];
      this.pay(this.s.booked[p.id], 'Downlink complete · ' + p.client);
    }
    if (this.s.auto) for (const p of list.filter(x => x.state === 'future' && !x.booked && !x.conflict).sort((a, b) => b.pay - a.pay))
      if (this.overlaps(p, list) < this.antennas()) this.s.booked[p.id] = p.pay;
    if (this.s.auto) {
      // Taras runs the boat too: leave early, then re-target once the prediction is tight.
      const e = this.activeRecovery(t);
      if (e && t < e.tLand) {
        const left = e.tLand - t;
        if (!this.s.boat && left < 1000) this.dispatch(e, t);
        else if (this.s.boat && this.s.boat.evId === e.id && left < 200 && !this.s.boat.retargeted) { this.dispatch(e, t); this.s.boat!.retargeted = true; }
      }
    }
    const b = this.s.boat;
    if (b) {
      const e = this.recoveryEvents(t).find(x => x.id === b.evId) || this.recoveryEvents(t - 1200).find(x => x.id === b.evId);
      if (e && t >= e.tLand && !this.s.recovered[e.id]) {
        const bp = this.boatPos(t)!, d = gcDistKm(bp.pos, e.actual);
        const ok = bp.arrived ? d < 8 : d < 5;
        if (ok || t > e.tLand + 900) {
          this.s.recovered[e.id] = ok ? 'ok' : 'miss';
          if (ok) { this.s.earned += e.pay; this.pay(e.pay, e.kind + ' recovered, ' + d.toFixed(1) + ' km from the boat'); }
          else this.note('The ' + e.kind.toLowerCase() + ' came down ' + Math.round(d) + ' km from the boat and sank.', 'bad');
          this.s.boat = null;
        }
      }
      if (!e) this.s.boat = null;
    }
  }
  siteECI(t: number) { return core.site(this.site.lat, this.site.lon, t); }
  llECI(p: LatLon, t: number, altKm = 0) { return V.mul(core.site(p.lat, p.lon, t), (R_EARTH + altKm) / R_EARTH); }
}
