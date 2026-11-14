// Recovery race: things come down from orbit, and recovery crews race to be first on them.
// Everything is a deterministic function of the shared clock and the player's own orders:
// re-entries are seeded per time slot (the same for every player), rival crews follow fixed
// rules with the same tracking data the player starts with, and nothing is decided by a roll.
import { hash, rng } from '../game/util';
import { LocId, Region, REC_REGIONS, XY, dist } from './world';

// ---------------------------------------------------------------- tuning per location
export interface RecLoc {
  id: LocId; craft: string; craftPlural: string; port: string; portLL: { lat: number; lon: number };
  /** Base craft speed (km/s), tow speed factor, warning before impact (s), slot length (s). */
  speed: number; towFactor: number; warn: number; slot: number;
  /** Prediction zone at announcement: semi-major axis (km); capture radius (km); impact distance from port (km). */
  zone0: number; capture: number; near: number; far: number;
  /** Hazard area at impact: semi-major axis (km); share of the first error the official track never removes. */
  hazMin: number; resid: number;
  /** Running cost per km and per sortie. */
  perKm: number; perSortie: number;
  /** Seconds an object stays recoverable after impact, by kind. */
  lifetime: Record<string, number>;
  upgrades: Upgrade[];
  rivals: RivalDef[];
}
export interface Upgrade { id: string; name: string; blurb: string; cost: number; needs?: string }
export interface RivalDef { id: string; name: string; col: string; style: 'bold' | 'tracker' | 'patient'; port: { lat: number; lon: number }; crane: number; speedK: number; blurb: string }

export const REC_LOCS: Record<LocId, RecLoc> = {
  earth: {
    id: 'earth', craft: 'skimmer', craftPlural: 'skimmers', port: 'Port Canaveral', portLL: { lat: 28.41, lon: -80.6 },
    speed: 240 / 3600, towFactor: 0.55, warn: 540, slot: 360, zone0: 26, capture: 0.4, near: 14, far: 62, hazMin: 3.0, resid: 0.14,
    perKm: 9, perSortie: 250, lifetime: { capsule: 1800, stage: 1200, debris: 600 },
    upgrades: [
      { id: 'engine', name: 'Hydrofoil kit', blurb: 'Skimmers run 25% faster', cost: 14000 },
      { id: 'radar', name: 'Tracking radar', blurb: 'Your predicted zone shrinks sooner and sits closer to the truth', cost: 12000 },
      { id: 'crane', name: 'Heavy crane', blurb: 'Lift up to 20 t: booster stages pay the most', cost: 10000 },
      { id: 'second', name: 'Second skimmer', blurb: 'Chase two re-entries at once', cost: 26000 },
      { id: 'engine2', name: 'Turbine refit', blurb: 'Another 20% on top of the hydrofoils', cost: 30000, needs: 'engine' },
    ],
    rivals: [
      { id: 'amr', name: 'Atlantic Marine Recovery', col: '#ff8a5c', style: 'bold', port: { lat: 28.41, lon: -80.6 }, crane: 8, speedK: 1.14, blurb: 'Leaves the moment anything is announced. Shares your port, with a faster boat.' },
      { id: 'seb', name: 'Sebastian Salvage', col: '#e7c35a', style: 'patient', port: { lat: 27.86, lon: -80.45 }, crane: 20, speedK: 1.18, blurb: 'Waits until the zone is half its size, then holds off the short side of it. Heavy crane, fast boat.' },
      { id: 'cap', name: 'Cape Hooks', col: '#d68cff', style: 'tracker', port: { lat: 28.62, lon: -80.6 }, crane: 8, speedK: 1.1, blurb: 'Leaves early and keeps to whichever side of the zone is nearest.' },
    ],
  },
  mars: {
    id: 'mars', craft: 'rover', craftPlural: 'rovers', port: 'Jezero Port', portLL: { lat: 18.22, lon: 78.3 },
    speed: 100 / 3600, towFactor: 0.6, warn: 600, slot: 420, zone0: 9, capture: 0.25, near: 6, far: 32, hazMin: 1.3, resid: 0.22,
    perKm: 22, perSortie: 300, lifetime: { capsule: 2400, stage: 2400, debris: 2400 },
    upgrades: [
      { id: 'engine', name: 'Fuel-cell drive', blurb: 'Rovers run 25% faster', cost: 14000 },
      { id: 'radar', name: 'Tracking radar', blurb: 'Your predicted zone shrinks sooner and sits closer to the truth', cost: 12000 },
      { id: 'crane', name: 'Heavy crane', blurb: 'Lift up to 20 t: spent landers pay the most', cost: 10000 },
      { id: 'second', name: 'Second rover', blurb: 'Chase two landings at once', cost: 26000 },
      { id: 'engine2', name: 'Lightweight chassis', blurb: 'Another 20% on top of the new drive', cost: 30000, needs: 'engine' },
    ],
    rivals: [
      { id: 'ares', name: 'Ares Logistics', col: '#ff8a5c', style: 'bold', port: { lat: 18.22, lon: 78.3 }, crane: 8, speedK: 1.14, blurb: 'Leaves the moment anything is announced. Shares your port, with a faster rover.' },
      { id: 'coop', name: 'Jezero Co-op', col: '#e7c35a', style: 'patient', port: { lat: 18.29, lon: 78.76 }, crane: 20, speedK: 1.18, blurb: 'Waits until the zone is half its size, then holds off the short side of it. Heavy crane, fast rover.' },
      { id: 'dust', name: 'Red Dust Salvage', col: '#d68cff', style: 'tracker', port: { lat: 17.91, lon: 78.6 }, crane: 8, speedK: 1.1, blurb: 'Leaves early and keeps to whichever side of the zone is nearest.' },
    ],
  },
};
export const REC_GOAL = 60000;

// ---------------------------------------------------------------- events
export type ObjKind = 'capsule' | 'stage' | 'debris';
export interface RecEvent {
  id: string; kind: ObjKind; name: string; from: string; client: string | null;
  mass: number; pay: number; tA: number; tI: number; P: XY;
  /** Ground-track direction of travel (radians, east = 0, north = π/2). */
  heading: number;
  /** Where the tracking network's first estimate sits relative to the truth (km, along and across track). */
  errAlong: number; errCross: number;
  /** Surface drift after impact (km/s), and how long it can be recovered (s). */
  drift: XY; life: number;
  /** Private contract (the first, teaching one) or shared with every crew. */
  own: boolean;
  /** Size of the first prediction relative to the usual (the teaching contract is better tracked). */
  zk: number;
}

const EARTH_FROM = ['Vandenberg', 'Starbase', 'Wallops', 'Kourou', 'Haven Commercial', 'Shackleton Gateway', 'Low orbit'];
const MARS_FROM = ['Phobos Depot', 'Deimos Yard', 'Areostationary relay', 'Low Mars orbit', 'Earth transfer'];
const CLIENTS = ['Haven Commercial', 'Meshcom', 'Aurora Labs', 'Orbit Insurance', 'Kestrel Pharma', 'Lumen Relay', 'Tidewatch', 'Andes Geodesy'];
const MARS_CLIENTS = ['Jezero Assembly', 'Isidis Water', 'Nili Mining', 'Phobos Depot', 'Syrtis Agronomy', 'Mars Medical'];

/** Unit vectors along and across a ground track. */
export const trackAxes = (h: number) => ({ a: { x: Math.cos(h), y: Math.sin(h) }, c: { x: -Math.sin(h), y: Math.cos(h) } });

export class RecWorld {
  region: Region; port: XY; cache = new Map<number, RecEvent[]>();
  constructor(public L: RecLoc) {
    this.region = REC_REGIONS[L.id];
    this.port = this.region.toXY(L.portLL);
  }
  /** Ocean current (Earth) at a point, km/s. The Gulf Stream runs north offshore; Mars has none. */
  drift(p: XY): XY {
    if (this.L.id !== 'earth') return { x: 0, y: 0 };
    const off = Math.max(0, Math.min(1, (p.x - this.port.x - 30) / 50));
    return { x: 0.00012, y: (0.00025 + 0.0016 * off) };
  }
  /** A landing point at a given distance band from port, on water (Earth) or open ground (Mars). */
  private place(r: () => number, near: number, far: number): XY {
    for (let k = 0; k < 40; k++) {
      const d = near + (far - near) * r(), a = (this.L.id === 'earth' ? -1.1 + 2.0 * r() : r() * Math.PI * 2);
      const o = this.L.id === 'earth' ? this.port : { x: 0, y: 0 }, dd = this.L.id === 'earth' ? d : d * 0.7;
      const p = { x: o.x + dd * Math.cos(a), y: o.y + dd * Math.sin(a) };
      const h = this.region.half - 4;
      if (Math.abs(p.x) > h || Math.abs(p.y) > h) continue;
      if (this.L.id === 'earth' ? this.region.isWater(p.x, p.y) && this.region.heightAt(p.x, p.y) < -8 : true) return p;
    }
    return { x: this.port.x + near, y: this.port.y };
  }
  private make(id: string, r: () => number, tA: number, own: boolean, near = this.L.near, far = this.L.far): RecEvent {
    const L = this.L, mars = L.id === 'mars', roll = r();
    const kind: ObjKind = own ? 'capsule' : roll < 0.45 ? 'capsule' : roll < 0.72 ? 'stage' : 'debris';
    const P = this.place(r, near, far);
    const from = (mars ? MARS_FROM : EARTH_FROM)[Math.floor(r() * (mars ? MARS_FROM.length : EARTH_FROM.length))];
    const client = kind === 'capsule' ? (mars ? MARS_CLIENTS : CLIENTS)[Math.floor(r() * (mars ? MARS_CLIENTS.length : CLIENTS.length))] : null;
    const mass = kind === 'capsule' ? 3 + r() * 4 : kind === 'stage' ? 11 + r() * 8 : 0.6 + r() * 3;
    const pay = Math.round((kind === 'capsule' ? 4200 + r() * 2600 : kind === 'stage' ? 7000 + mass * 260 : 1400 + mass * 700) / 100) * 100;
    const name = kind === 'capsule' ? (mars ? 'Cargo lander' : 'Cargo capsule') : kind === 'stage' ? (mars ? 'Spent descent stage' : 'Booster stage') : (mars ? 'Debris from a broken relay' : 'Fairing half');
    const heading = (mars ? r() * Math.PI * 2 : (-0.35 + r() * 0.7) + (r() < 0.5 ? 0 : Math.PI)) as number;
    const errAlong = (r() < 0.5 ? -1 : 1) * L.zone0 * (0.35 + 0.45 * r()), errCross = (r() - 0.5) * L.zone0 * 0.35;
    const life = L.lifetime[kind];
    return { id, kind, name, from, client, mass: Math.round(mass * 10) / 10, pay, tA, tI: tA + L.warn + Math.round(r() * 60), P, heading, errAlong, errCross, drift: this.drift(P), life, own, zk: 1 };
  }
  /** Re-entries announced in one slot: one or two, the same for every player. */
  slotEvents(k: number): RecEvent[] {
    let ev = this.cache.get(k);
    if (ev) return ev;
    const L = this.L, r = rng(hash('rec:' + L.id + ':' + k));
    ev = [this.make(L.id + '-' + k, r, k * L.slot + Math.round(r() * L.slot * 0.5), false)];
    if (r() < 0.3) ev.push(this.make(L.id + '-' + k + 'b', r, k * L.slot + Math.round(L.slot * (0.45 + r() * 0.45)), false));
    this.cache.set(k, ev);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!);
    return ev;
  }
  /** Shared events whose life overlaps [t0, t1]. */
  shared(t0: number, t1: number): RecEvent[] {
    const L = this.L, out: RecEvent[] = [], span = L.warn + 120 + Math.max(...Object.values(L.lifetime));
    for (let k = Math.floor((t0 - span) / L.slot); k <= Math.floor(t1 / L.slot); k++)
      for (const e of this.slotEvents(k)) if (e.tA <= t1 && e.tI + e.life >= t0) out.push(e);
    return out;
  }
  /** The private teaching contract: announced on founding, lands close to port in about three minutes. */
  tutorial(company: string, t0: number): RecEvent {
    const r = rng(hash('rec-tut:' + company + this.L.id));
    // Far enough out that port is clear of its hazard area, close enough to reach well before impact.
    const L = this.L, zk = 0.35, d = (L.hazMin + L.zone0 * zk) * 1.3;
    const e = this.make('tut-' + Math.round(t0), r, t0 + 4, true, d, d);
    const a = r() * Math.PI * 2; e.P = { x: this.port.x + d * Math.cos(a), y: this.port.y + d * Math.sin(a) };
    if (L.id === 'earth') e.P = { x: this.port.x + d * Math.cos(a * 0.3), y: this.port.y + d * Math.sin(a * 0.3) }; // out to sea
    e.drift = this.drift(e.P);
    e.zk = zk; e.errAlong = Math.sign(e.errAlong) * L.zone0 * zk * 0.6; e.errCross *= zk;
    e.tI = e.tA + Math.round(dist(this.port, e.P) / L.speed * 1.35 + 60); e.pay = 3600; e.name = this.L.id === 'mars' ? 'Sample return pod' : 'Cargo capsule'; e.mass = 2.4;
    e.client = this.L.id === 'mars' ? 'Jezero Assembly' : 'Haven Commercial'; e.life = 1800;
    return e;
  }
}

/** An ellipse on the map: centre, semi-axes (km) and the ground-track heading its long axis follows. */
export interface Ellipse { c: XY; a: number; b: number; heading: number }
/** What the tracking network publishes: the hazard area every crew must stay out of until impact. */
export interface Prediction extends Ellipse { k: number; landed: boolean; p: XY; own: Ellipse | null }
function errAt(e: RecEvent, w: number): XY {
  const { a: ua, c: uc } = trackAxes(e.heading);
  return { x: e.P.x + (ua.x * e.errAlong + uc.x * e.errCross) * w, y: e.P.y + (ua.y * e.errAlong + uc.y * e.errCross) * w };
}
export function predict(e: RecEvent, t: number, radar: boolean, L: RecLoc): Prediction {
  const k = Math.max(0, Math.min(1, (e.tI - t) / (e.tI - e.tA))), landed = t >= e.tI, p = objectAt(e, t);
  // The public track converges, but never fully: a residual along-track error stays until impact.
  const c = errAt(e, k * (1 - L.resid) + L.resid);
  const z = L.zone0 * (e.zk || 1), a = L.hazMin + z * k, b = L.hazMin * 0.45 + z * 0.28 * k;
  // Your own radar narrows in on the truth faster and all the way.
  const f = Math.pow(k, 1.9), own = radar && !landed ? { c: errAt(e, f), a: L.capture + z * 0.7 * f, b: L.capture + z * 0.2 * f, heading: e.heading } : null;
  return landed ? { c: p, a: 0, b: 0, heading: e.heading, k, landed, p, own: null } : { c, a, b, heading: e.heading, k, landed, p, own };
}
/** Point on an ellipse's edge at parameter angle ang (0 = forward along the track), pushed out by margin km. */
export function edgePoint(el: Ellipse, ang: number, margin = 0.15): XY {
  const { a: ua, c: uc } = trackAxes(el.heading), x = (el.a + margin) * Math.cos(ang), y = (el.b + margin) * Math.sin(ang);
  return { x: el.c.x + ua.x * x + uc.x * y, y: el.c.y + ua.y * x + uc.y * y };
}
/** The ellipse parameter angle that points from the centre toward p. */
export function edgeAngle(el: Ellipse, p: XY) {
  const { a: ua, c: uc } = trackAxes(el.heading), dx = p.x - el.c.x, dy = p.y - el.c.y;
  return Math.atan2((dx * uc.x + dy * uc.y) / Math.max(1e-6, el.b), (dx * ua.x + dy * ua.y) / Math.max(1e-6, el.a));
}
export function insideEllipse(el: Ellipse, p: XY) {
  const { a: ua, c: uc } = trackAxes(el.heading), dx = p.x - el.c.x, dy = p.y - el.c.y;
  const u = (dx * ua.x + dy * ua.y) / el.a, v = (dx * uc.x + dy * uc.y) / el.b;
  return u * u + v * v < 1;
}
/** True position of the object: on its way down before impact (for drawing), drifting after. */
export function objectAt(e: RecEvent, t: number): XY {
  if (t >= e.tI) { const s = t - e.tI; return { x: e.P.x + e.drift.x * s, y: e.P.y + e.drift.y * s }; }
  const { a } = trackAxes(e.heading), back = Math.max(0, e.tI - t) * 0.25; // last stretch of the ground track
  return { x: e.P.x - a.x * back, y: e.P.y - a.y * back };
}

// ---------------------------------------------------------------- crews
export type Mode = 'port' | 'out' | 'hold' | 'chase' | 'tow' | 'back';
export interface Crew {
  id: string; name: string; col: string; mine: boolean; style?: RivalDef['style'];
  p: XY; home: XY; mode: Mode; ev: string | null; dest: XY | null;
  crane: number; speedK: number; lastRetarget: number; km: number;
  /** Which side of the hazard area to wait on: ellipse parameter angle, kept as the zone shrinks. */
  aim: number | null;
}
export interface RecSave {
  v: 1; loc: LocId; company: string; founded: number; t: number;
  credits: number; earned: number; spent: number;
  upg: Record<string, 1>; crews: Crew[]; rivals: Crew[];
  claims: Record<string, { by: string; name: string; t: number; mine: boolean; pay: number; paid?: boolean }>;
  tut: RecEvent | null; log: { t: number; text: string; kind: string }[];
  wins: number; losses: number;
}
export interface RecMsg { text: string; kind: 'ok' | 'bad' | 'warn' | '' ; who?: string }

export const START_CREDITS = 9000;

export function newRecSave(loc: LocId, company: string, t: number): RecSave {
  const L = REC_LOCS[loc], W = new RecWorld(L);
  const crew = (id: string, name: string, col: string, home: XY, mine: boolean, crane: number, style?: RivalDef['style']): Crew =>
    ({ id, name, col, mine, style, p: { ...home }, home: { ...home }, mode: 'port', ev: null, dest: null, crane, speedK: 1, lastRetarget: -1e9, km: 0, aim: null });
  return {
    v: 1, loc, company, founded: t, t, credits: START_CREDITS, earned: 0, spent: 0, upg: {},
    crews: [crew('c1', L.craft === 'skimmer' ? 'Skimmer One' : 'Rover One', '#2fd6b5', W.port, true, 8)],
    rivals: L.rivals.map(r => ({ ...crew(r.id, r.name, r.col, W.region.toXY(r.port), false, r.crane, r.style), speedK: r.speedK })),
    claims: {}, tut: W.tutorial(company, t), log: [], wins: 0, losses: 0,
  };
}

export class Recovery {
  L: RecLoc; W: RecWorld; msgs: RecMsg[] = [];
  static STEP = 2;
  constructor(public s: RecSave) { this.L = REC_LOCS[s.loc]; this.W = new RecWorld(this.L); }

  has(u: string) { return !!this.s.upg[u]; }
  speed(c: Crew) { return this.L.speed * c.speedK; }
  radar() { return this.has('radar'); }
  /** Every event a player can see at time t: the shared ones plus the private contract. */
  events(t: number): RecEvent[] {
    const out = this.W.shared(t - 60, t).filter(e => t >= e.tA);
    const tut = this.s.tut;
    if (tut && t >= tut.tA && t <= tut.tI + tut.life) out.unshift(tut);
    return out;
  }
  /** Events still worth acting on: announced, not claimed, not lost. */
  open(t: number) { return this.events(t).filter(e => !this.s.claims[e.id] && t < e.tI + e.life); }
  event(id: string, t: number) { return this.events(t).find(e => e.id === id) || (this.s.tut?.id === id ? this.s.tut : null); }
  pred(e: RecEvent, t: number, radar = this.radar()) { return predict(e, t, radar, this.L); }

  // ---------- orders
  /** Send a crew toward an event, to a chosen point (or the predicted centre). */
  send(crewId: string, evId: string, at: XY | null, t: number): string | null {
    this.step(t);
    const c = this.s.crews.find(x => x.id === crewId), e = this.event(evId, t);
    if (!c || !e) return 'Nothing to send.';
    if (c.mode === 'tow') return c.name + ' is towing a recovery home.';
    if (this.s.claims[e.id]) return 'Someone already has it.';
    if (e.mass > c.crane) return 'Too heavy: ' + e.mass + ' t. Your crane lifts ' + c.crane + ' t.';
    if (c.mode === 'port') { if (!this.pay(this.L.perSortie, 'sortie')) return 'Not enough money for a sortie (' + this.L.perSortie + ').'; }
    const pr = this.pred(e, t);
    c.ev = e.id; c.mode = t >= e.tI ? 'chase' : 'out'; c.lastRetarget = t;
    // No side chosen: the safe default, the near end of the short axis (the error runs along the track).
    const side = edgeAngle(pr, at ? this.clamp(at) : c.p);
    c.aim = at ? side : Math.sin(side) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    c.dest = t >= e.tI ? objectAt(e, t) : edgePoint(pr, c.aim);
    return null;
  }
  recall(crewId: string, t: number) {
    this.step(t);
    const c = this.s.crews.find(x => x.id === crewId);
    if (!c || c.mode === 'tow' || c.mode === 'port') return;
    c.mode = 'back'; c.ev = null; c.aim = null; c.dest = { ...c.home };
  }
  buy(id: string, t: number): string | null {
    this.step(t);
    const u = this.L.upgrades.find(x => x.id === id);
    if (!u || this.s.upg[id]) return null;
    if (u.needs && !this.s.upg[u.needs]) return 'Needs ' + this.L.upgrades.find(x => x.id === u.needs)!.name + ' first.';
    if (this.s.credits < u.cost) return 'Not enough money yet.';
    this.s.credits -= u.cost; this.s.spent += u.cost; this.s.upg[id] = 1;
    if (id === 'engine' || id === 'engine2') for (const c of this.s.crews) c.speedK = this.speedK();
    if (id === 'crane') for (const c of this.s.crews) c.crane = 20;
    if (id === 'second') {
      const c0 = this.s.crews[0];
      this.s.crews.push({ ...c0, id: 'c2', name: this.L.craft === 'skimmer' ? 'Skimmer Two' : 'Rover Two', col: '#4fd2ff', p: { ...c0.home }, mode: 'port', ev: null, dest: null, km: 0, lastRetarget: -1e9, aim: null });
    }
    this.log(u.name + ' bought.', 'ok', t);
    return null;
  }
  speedK() { return (this.has('engine') ? 1.25 : 1) * (this.has('engine2') ? 1.2 : 1); }
  private clamp(p: XY): XY { const h = this.W.region.half; return { x: Math.max(-h, Math.min(h, p.x)), y: Math.max(-h, Math.min(h, p.y)) }; }
  private pay(n: number, _why: string) { if (this.s.credits < n) return false; this.s.credits -= n; this.s.spent += n; return true; }
  private log(text: string, kind: string, t: number) { this.s.log.unshift({ t, text, kind }); if (this.s.log.length > 40) this.s.log.pop(); this.msgs.push({ text, kind: kind as any }); }

  // ---------- simulation
  /** Advance the world to time t in fixed steps. Rivals act only on what the tracking network shows. */
  step(t: number) {
    const s = this.s, h = Recovery.STEP;
    if (t - s.t > 6 * 3600) s.t = t - 6 * 3600; // a very long absence: replay the last 6 hours only
    while (s.t + h <= t) { s.t += h; this.tick(s.t, h); }
  }
  private tick(t: number, h: number) {
    for (const r of this.s.rivals) this.think(r, t);
    for (const c of [...this.s.crews, ...this.s.rivals]) if (c.ev && c.aim !== null && (c.mode === 'out' || c.mode === 'hold')) {
      const e = this.findEv(c.ev, t);
      if (e && t < e.tI) { c.dest = edgePoint(predict(e, t, false, this.L), c.aim); if (c.mode === 'hold' && dist(c.p, c.dest) > 0.02) c.mode = 'out'; }
    }
    for (const c of [...this.s.crews, ...this.s.rivals]) this.move(c, t, h);
    this.resolve(t);
  }
  /** Rival behaviour: the same predictions the player starts with, three temperaments. */
  private think(r: Crew, t: number) {
    const L = this.L;
    if (r.mode === 'port' || r.mode === 'back') {
      const best = this.W.shared(t - 60, t).filter(e => t >= e.tA && t < e.tI && !this.s.claims[e.id] && e.mass <= r.crane)
        .map(e => ({ e, pr: this.pred(e, t, false) }))
        .filter(({ e, pr }) => {
          if (r.style === 'patient' && pr.a > L.zone0 * 0.55 + L.capture) return false; // waits for a tighter zone
          return dist(r.p, pr.c) / this.speed(r) < e.tI - t + 150;
        })
        .sort((a, b) => a.e.tI - b.e.tI)[0];
      if (best) {
        r.ev = best.e.id; r.mode = 'out'; r.lastRetarget = t;
        // Patient crews know the error runs along the track and wait at the near end of the short axis.
        const side = edgeAngle(best.pr, r.p);
        r.aim = r.style === 'patient' ? (Math.sin(side) >= 0 ? Math.PI / 2 : -Math.PI / 2) : side;
        r.dest = edgePoint(best.pr, r.aim);
      }
      return;
    }
    if (r.mode === 'out' || r.mode === 'hold') {
      const e = r.ev ? this.W.shared(t - 3600, t).find(x => x.id === r.ev) : null;
      if (!e || this.s.claims[e.id]) { this.home(r); return; }
      // Trackers keep moving to the side of the zone nearest them as it shifts; the others hold their chosen side.
      if (r.style === 'tracker' && t < e.tI && t - r.lastRetarget >= 30) { r.aim = edgeAngle(this.pred(e, t, false), r.p); r.lastRetarget = t; }
    }
  }
  private home(c: Crew) { c.mode = 'back'; c.ev = null; c.aim = null; c.dest = { ...c.home }; }
  private move(c: Crew, t: number, h: number) {
    if (c.mode === 'port' || c.mode === 'hold') {
      if (c.mode === 'hold' && c.ev) { const e = this.findEv(c.ev, t); if (e && t >= e.tI) c.mode = 'chase'; }
      if (c.mode !== 'chase') return;
    }
    const e = c.ev ? this.findEv(c.ev, t) : null;
    if ((c.mode === 'out' || c.mode === 'chase') && e && t >= e.tI) { c.mode = 'chase'; c.dest = objectAt(e, t); }
    if (!c.dest) return;
    const v = this.speed(c) * (c.mode === 'tow' ? this.L.towFactor : 1), stepKm = v * h;
    // A crew caught inside a hazard area (a new announcement over it) first clears it by the shortest way out.
    const live = this.hazards(t).map(e => predict(e, t, false, this.L)), trap = live.find(pr => insideEllipse(pr, c.p));
    if (trap) {
      const out = edgePoint(trap, edgeAngle(trap, c.p), 0.1), d0 = dist(c.p, out), k = Math.min(1, stepKm / Math.max(1e-9, d0));
      c.km += d0 * k; if (c.mine) this.fuel(d0 * k);
      c.p = { x: c.p.x + (out.x - c.p.x) * k, y: c.p.y + (out.y - c.p.y) * k };
      return;
    }
    const d = dist(c.p, c.dest);
    if (d <= stepKm) {
      c.km += d; if (c.mine) this.fuel(d);
      c.p = { ...c.dest };
      if (c.mode === 'out') c.mode = 'hold';
      else if (c.mode === 'back' || c.mode === 'tow') this.arrive(c, t);
    } else {
      const k = stepKm / d; c.km += stepKm; if (c.mine) this.fuel(stepKm);
      c.p = { x: c.p.x + (c.dest.x - c.p.x) * k, y: c.p.y + (c.dest.y - c.p.y) * k };
    }
    // Range safety: no crossing into a hazard area before its object comes down; slide along its edge instead.
    for (const pr of live) if (insideEllipse(pr, c.p)) c.p = edgePoint(pr, edgeAngle(pr, c.p), 0.02);
    if (c.mode === 'chase' && e && t > e.tI + e.life) { if (c.mine) this.log(e.name + ' was lost before anyone reached it.', 'bad', t); this.home(c); }
  }
  /** Events whose hazard area is in force: announced and not yet down. */
  hazards(t: number) {
    const out = this.W.shared(t - 60, t).filter(e => t >= e.tA && t < e.tI);
    const tut = this.s.tut;
    if (tut && t >= tut.tA && t < tut.tI) out.push(tut);
    return out;
  }
  private fuel(km: number) { const n = km * this.L.perKm; this.s.credits -= n; this.s.spent += n; }
  private findEv(id: string, t: number) { return this.s.tut?.id === id ? this.s.tut : this.W.shared(t - 7200, t).find(x => x.id === id) || null; }
  private arrive(c: Crew, t: number) {
    if (c.mode === 'tow' && c.mine) {
      const cl = Object.entries(this.s.claims).find(([, v]) => v.by === c.id && v.pay > 0 && !v.paid);
      if (cl) {
        cl[1].paid = true; this.s.credits += cl[1].pay; this.s.earned += cl[1].pay;
        this.log(cl[1].name + ' delivered to ' + this.L.port + ' · +¤' + cl[1].pay.toLocaleString('en-US'), 'ok', t);
      }
    }
    c.mode = 'port'; c.ev = null; c.aim = null; c.dest = null; c.p = { ...c.home };
  }
  /** First crew inside the capture radius after impact claims the object. */
  private resolve(t: number) {
    const all = [...this.s.crews, ...this.s.rivals];
    const inside = all.filter(c => c.mode === 'chase' && c.ev).map(c => {
      const e = this.findEv(c.ev!, t);
      return { c, e, d: e && t >= e.tI && !this.s.claims[e.id] ? dist(c.p, objectAt(e, t)) : Infinity };
    }).filter(x => x.d <= this.L.capture).sort((a, b) => a.d - b.d);
    for (const { c, e } of inside) {
      if (!e || this.s.claims[e.id]) continue;
      this.s.claims[e.id] = { by: c.id, name: e.name, t, mine: c.mine, pay: c.mine ? e.pay : 0 };
      c.mode = 'tow'; c.aim = null; c.dest = { ...c.home };
      const late = t - e.tI;
      if (c.mine) { this.s.wins++; this.log(c.name + ' has the ' + e.name.toLowerCase() + ', ' + Math.round(late) + ' s after it came down. Towing it home.', 'ok', t); }
      else if (all.some(o => o.mine && o.ev === e.id)) { this.s.losses++; this.log(c.name + ' got to the ' + e.name.toLowerCase() + ' first.', 'bad', t); }
      for (const o of all) if (o !== c && o.ev === e.id) this.home(o);
    }
  }
  /** Seconds a crew needs to reach a point. */
  eta(c: Crew, p: XY) { return dist(c.p, p) / this.speed(c); }
  goal() { return Math.min(1, this.s.earned / REC_GOAL); }
}
