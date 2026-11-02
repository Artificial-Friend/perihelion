// Stage 4: your own government. Claim a site, build a station ring module by module, set
// trade policy, and answer threats you can only see once they enter sensor range.
import { core, V, Vec3 } from '../sim/core';
import { hash, rng } from './util';
import { bodyHelioPos, helioToGeo } from './haul';

export interface Site { id: string; name: string; where: string; blurb: string; cost: number; traffic: number; danger: number }
export const SITES4: Site[] = [
  { id: 'l4', name: 'Earth–Moon L4', where: 'Lagrange point, 60° ahead of the Moon', blurb: 'Stable, central, busy. Close to every nation’s patrols.', cost: 40000, traffic: 1.2, danger: 0.7 },
  { id: 'kamo', name: 'Kamoʻoalewa', where: 'Earth’s quasi-moon', blurb: 'A small rock that never strays far from Earth. Ore in the ground.', cost: 30000, traffic: 0.9, danger: 1 },
  { id: 'deimos', name: 'Deimos', where: 'Outer moon of Mars', blurb: 'Far from Earth’s reach. Rich trade, and pirates know it.', cost: 25000, traffic: 1.4, danger: 1.5 },
];

export interface ModDef { id: string; name: string; blurb: string; cost: number; min: number; heat: number; col: string }
export const MODS: ModDef[] = [
  { id: 'hab', name: 'Habitat ring', blurb: '+200 residents, +¤40/min taxes', cost: 15000, min: 4, heat: 1, col: '#4da3ff' },
  { id: 'dock', name: 'Trade dock', blurb: 'Ships trade here: +¤120/min × policy', cost: 12000, min: 3, heat: 1, col: '#2fd6b5' },
  { id: 'refinery', name: 'Refinery', blurb: '+¤220/min, runs hot', cost: 20000, min: 5, heat: 3, col: '#ffb13d' },
  { id: 'radiator', name: 'Radiator wing', blurb: 'Dumps 4 units of heat', cost: 6000, min: 2, heat: -4, col: '#cfe3ff' },
  { id: 'sensor', name: 'Sensor array', blurb: 'See threats 15 min earlier', cost: 10000, min: 3, heat: 1, col: '#b48cff' },
  { id: 'pd', name: 'Point defence', blurb: '+3 defence against raids', cost: 14000, min: 4, heat: 1, col: '#ff6b5a' },
];
export const modById = (id: string) => MODS.find(m => m.id === id)!;
export const SLOTS = 8;
export type Policy = 'open' | 'licensed' | 'closed';
export const POLICIES: Record<Policy, { name: string; blurb: string; trade: number; threat: number }> = {
  open: { name: 'Open port', blurb: 'Anyone may dock. Most trade, most trouble.', trade: 1.5, threat: 1.6 },
  licensed: { name: 'Licensed', blurb: 'Registered ships only. Balanced.', trade: 1, threat: 1 },
  closed: { name: 'Closed', blurb: 'Your own ships only. Quiet and poor.', trade: 0.35, threat: 0.5 },
};

export interface Threat { id: string; name: string; strength: number; launch: number; arrive: number; demand: number; response?: 'alert' | 'pay' | 'none'; result?: string }
export interface SovSave {
  site: string; name: string; founded: number; policy: Policy;
  slots: ({ mod: string; end: number } | null)[];
  lastTick: number; pop: number; treasuryEarned: number;
  threats: Record<string, Threat>; survived: number; log: string[];
}

export function newSov(site: string, name: string, t: number): SovSave {
  return { site, name, founded: t, policy: 'licensed', slots: Array(SLOTS).fill(null), lastTick: t, pop: 40, treasuryEarned: 0, threats: {}, survived: 0, log: [] };
}

/** Heliocentric position of a claim site. */
export function siteHelio(id: string, t: number): Vec3 {
  if (id === 'l4') {
    const e = core.ephem(t), e2 = core.ephem(t + 600), m = e.moon, mv = V.sub(e2.moon, m);
    const n = V.norm(V.cross(m, mv)), c = Math.cos(Math.PI / 3), s = Math.sin(Math.PI / 3);
    const l4 = V.add(V.add(V.mul(m, c), V.mul(V.cross(n, m), s)), V.mul(n, V.dot(n, m) * (1 - c)));
    return V.add(V.mul(e.sun, -1), l4);
  }
  if (id === 'deimos') return V.add(bodyHelioPos('mars', t), [23460, 0, 0]);
  return bodyHelioPos('kamo', t);
}
export const siteGeo = (id: string, t: number) => helioToGeo(siteHelio(id, t), t);

export class Sovereign {
  constructor(public s: SovSave, public company: string, public pay: (n: number, why: string) => void,
    public spend: (n: number) => boolean, public note: (t: string, k?: string) => void, public bark: (who: string, t: string) => void) {}
  get site() { return SITES4.find(x => x.id === this.s.site)!; }
  built(t: number) { return this.s.slots.filter(x => x && x.end <= t).map(x => x!.mod); }
  count(mod: string, t: number) { return this.built(t).filter(m => m === mod).length; }
  building(t: number) { return this.s.slots.find(x => x && x.end > t) || null; }
  heat(t: number) {
    const b = this.built(t), made = 1 + b.reduce((a, m) => a + Math.max(0, modById(m).heat), 0);
    const cap = 4 + b.reduce((a, m) => a + Math.max(0, -modById(m).heat), 0);
    return { made, cap, over: made > cap };
  }
  defence(t: number) { return 1 + 3 * this.count('pd', t); }
  sensorWarn(t: number) { return 600 + 900 * this.count('sensor', t); }
  income(t: number) {
    const pol = POLICIES[this.s.policy], h = this.heat(t), site = this.site;
    const dock = this.count('dock', t) * 120 * pol.trade * site.traffic;
    const ref = this.count('refinery', t) * 220 * (h.over ? 0.4 : 1);
    const tax = this.count('hab', t) * 40 + this.s.pop * 0.05;
    return { dock, ref, tax, total: dock + ref + tax };
  }
  build(slot: number, mod: string, t: number) {
    if (this.s.slots[slot]) return;
    if (this.building(t)) { this.note('The construction crew is busy with another module.', 'warn'); return; }
    const d = modById(mod);
    if (!this.spend(d.cost)) { this.note('Not enough money for the ' + d.name.toLowerCase() + '.', 'warn'); return; }
    this.s.slots[slot] = { mod, end: t + d.min * 60 };
  }
  setPolicy(p: Policy) { this.s.policy = p; this.bark('kwame', 'New port rules posted: ' + POLICIES[p].name.toLowerCase() + '.'); }

  /** Raiders launched in each 20-minute slot; each is seen only when inside sensor range. */
  scheduled(t: number): Threat[] {
    const out: Threat[] = [], pol = POLICIES[this.s.policy], site = this.site;
    for (let k = Math.floor(t / 1200) - 3; k <= Math.floor(t / 1200) + 1; k++) {
      if (k * 1200 < this.s.founded + 600) continue;
      const r = rng(hash(this.company + this.s.site + k));
      if (r() > 0.45 * pol.threat * site.danger) continue;
      const launch = k * 1200 + r() * 600, travel = 1500 + r() * 1500, strength = 2 + Math.floor(r() * 5 * site.danger);
      const names = ['Vesper Free Company', 'The Long Knives', 'Red Hand salvagers', 'Kessler Boys', 'Orphan Fleet'];
      out.push({ id: 'th' + k, name: names[Math.floor(r() * names.length)], strength, launch, arrive: launch + travel, demand: Math.round(strength * 2500 / 100) * 100 });
    }
    return out;
  }
  /** Threats currently visible (inside sensor range) and not yet resolved. */
  visible(t: number) {
    const warn = this.sensorWarn(t);
    return this.scheduled(t).filter(x => t >= x.launch && t >= x.arrive - warn && !this.s.threats[x.id]?.result).map(x => ({ ...x, ...(this.s.threats[x.id] || {}) }));
  }
  respond(id: string, resp: 'alert' | 'pay' | 'none', t: number) {
    const th = [...this.scheduled(t), ...Object.values(this.s.threats)].find(x => x.id === id); if (!th) return;
    if (resp === 'pay' && !this.spend(th.demand)) { this.note('The treasury can’t cover the tribute.', 'warn'); return; }
    this.s.threats[id] = { ...th, ...(this.s.threats[id] || {}), response: resp };
    if (resp === 'pay') this.resolve(th, t);
  }
  /** Dev helper: next raid launches now, five minutes out. */
  spawnSoon(t: number) {
    const id = 'dev' + Math.floor(t);
    (this as any).devThreat = { id, name: 'Test raiders', strength: 4, launch: t, arrive: t + 300, demand: 10000 };
  }
  private resolve(th: Threat, t: number) {
    const rec = this.s.threats[th.id] = { ...th, ...(this.s.threats[th.id] || {}) };
    if (rec.response === 'pay') {
      rec.result = 'Paid ' + th.name + ' ¤' + th.demand.toLocaleString('en-US') + ' to go away.';
      this.note(rec.result, 'warn');
    } else {
      const def = this.defence(t) + (rec.response === 'alert' ? 2 : 0);
      if (def >= th.strength) {
        const prize = th.strength * 1500;
        rec.result = th.name + ' attacked and were driven off. Salvage: ¤' + prize.toLocaleString('en-US') + '.';
        this.s.survived++; this.pay(prize, 'Raid repelled');
      } else {
        // Less defence, more destruction: one module lost per two points of shortfall.
        const lose = Math.ceil((th.strength - def) / 2), r = rng(hash(th.id + 'dmg'));
        const lost: string[] = [];
        for (let k = 0; k < lose; k++) {
          const idx = this.s.slots.map((x, i) => x && x.end <= t ? i : -1).filter(i => i >= 0);
          if (!idx.length) break;
          const i = idx[Math.floor(r() * idx.length)]; lost.push(modById(this.s.slots[i]!.mod).name); this.s.slots[i] = null;
        }
        rec.result = th.name + ' broke through (strength ' + th.strength + ' vs defence ' + def + ')' + (lost.length ? ' and destroyed: ' + lost.join(', ') + '.' : '.');
        this.note(rec.result, 'bad');
      }
    }
    this.s.log.unshift(rec.result!);
  }
  tick(t: number) {
    const dev = (this as any).devThreat as Threat | undefined;
    if (dev && !this.s.threats[dev.id]) this.s.threats[dev.id] = { ...dev };
    // Income accrues per whole minute.
    const mins = Math.floor((t - this.s.lastTick) / 60);
    if (mins > 0) {
      const inc = this.income(t).total * Math.min(mins, 600);
      this.s.lastTick += mins * 60;
      const habs = this.count('hab', t);
      this.s.pop = Math.min(40 + habs * 200, this.s.pop + mins * (2 + habs * 3));
      if (inc > 0) { this.s.treasuryEarned += inc; this.payQuiet(inc); }
    }
    const all = [...this.scheduled(t), ...Object.values(this.s.threats).filter(x => x.id.startsWith('dev'))];
    for (const th of all) if (t >= th.arrive && !this.s.threats[th.id]?.result && t < th.arrive + 3600) this.resolve(th, t);
  }
  payQuiet(n: number) { this.pay(n, ''); }
  allVisible(t: number) {
    const v = this.visible(t);
    for (const x of Object.values(this.s.threats)) if (x.id.startsWith('dev') && !x.result) v.push(x);
    return v;
  }
}
