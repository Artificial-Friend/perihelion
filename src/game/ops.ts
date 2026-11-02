// Stage 2 rendezvous, decision-based: the ship computer works out Lambert plans, the
// player picks one, the computer flies it, brakes and station-keeps; the player grapples.
import { core, Circ, State, V, MU_EARTH } from '../sim/core';

const FUEL_PER_MS = 260; // ¤ per m/s of Δv
const RCS_ACC = 0.06, MAIN_ACC = 1.5; // m/s^2

export interface Plan { id: string; label: string; tof: number; dv: number; fuelCost: number; arriveLit: boolean; note: string }
export type Phase = 'plan' | 'transfer' | 'braking' | 'holding' | 'grappled';

export class RendezvousOp {
  phase: Phase = 'plan';
  plans: Plan[] = [];
  planT = -1e9;
  chosen: Plan | null = null;
  arriveT = 0; departT = 0;
  burnLeft: number[] | null = null;
  burnAcc = RCS_ACC;
  dv = 0; thrust = 0; grappleT = 0;
  ended: { stars: number; reward: number; dv: number; minutes: number; fuel: number } | null = null;
  startT: number; t: number;
  shown = false;

  constructor(public ship: State, public target: Circ, t: number, public onBark: (who: string, text: string) => void,
    public opts: { hold: number[]; reward: number; fuelFactor: number; name: string }) {
    this.startT = t; this.t = t;
  }
  get hold() { return this.opts.hold; }
  targetState(t: number) { return core.circ(this.target, t); }
  rel() { return core.rel(this.ship, this.targetState(this.t)); }
  /** Distance to the hold point's target (m). */
  dist() { return V.len(this.rel().p); }

  computePlans(): Plan[] {
    const t = this.t;
    if (t - this.planT < 8 && this.plans.length) return this.plans;
    this.planT = t;
    const T = 2 * Math.PI * Math.sqrt(this.target.a ** 3 / MU_EARTH), c: { tof: number; dv: number }[] = [];
    for (const f of [0.08, 0.1, 0.13, 0.17, 0.22, 0.28, 0.36, 0.45, 0.55, 0.66, 0.78, 0.88, 1.1, 1.4]) {
      const r = core.intercept(this.ship, this.target, this.hold, t, T * f);
      if (r.ok && r.periAlt > 150) c.push({ tof: T * f, dv: r.dv });
    }
    if (!c.length) return (this.plans = []);
    const fast = c.filter(x => x.dv < 30)[0] || c[0];
    const eff = c.reduce((a, b) => b.dv < a.dv ? b : a);
    const mid = (fast.tof + eff.tof) / 2, bal = c.reduce((a, b) => Math.abs(b.tof - mid) < Math.abs(a.tof - mid) ? b : a);
    const mk = (id: string, label: string, x: { tof: number; dv: number }, note: string): Plan => {
      const p = this.targetState(t + x.tof), sun = core.ephem(t + x.tof).sun;
      return { id, label, tof: x.tof, dv: x.dv, fuelCost: Math.round(x.dv * FUEL_PER_MS * this.opts.fuelFactor / 10) * 10, arriveLit: core.sunFraction(p.r, sun) > 0.5, note };
    };
    return (this.plans = [
      mk('fast', 'Fast', fast, 'A steep arc straight there. Burns the most propellant.'),
      mk('balanced', 'Balanced', bal, 'A shallower arc: a little longer, far cheaper.'),
      mk('efficient', 'Efficient', eff, 'Change height slightly and let the orbit carry you. Slowest, cheapest.'),
    ]);
  }
  choose(id: string) {
    const p = this.computePlans().find(x => x.id === id);
    if (!p || this.phase !== 'plan') return;
    const r = core.intercept(this.ship, this.target, this.hold, this.t, p.tof);
    if (!r.ok) return;
    this.chosen = p; this.burnLeft = r.dv1;
    this.burnAcc = V.len(r.dv1) * 1000 > 2 ? MAIN_ACC : RCS_ACC;
    this.departT = this.t; this.arriveT = this.t + p.tof; this.phase = 'transfer';
    this.onBark('sofia', p.label + ' plan locked in. Burning ' + (V.len(r.dv1) * 1000).toFixed(2) + ' m/s now; arriving in ' + Math.round(p.tof / 60) + ' minutes.');
  }
  replan() {
    if (this.phase !== 'transfer' && this.phase !== 'braking') return;
    this.phase = 'plan'; this.burnLeft = null; this.planT = -1e9; this.chosen = null;
    this.onBark('sofia', 'Replanning from here.');
  }
  canGrapple() { return this.phase === 'holding' && V.dist(this.rel().p, this.hold) < 8 && V.len(this.rel().w) < 0.25; }
  grapple() {
    if (!this.canGrapple()) return;
    this.phase = 'grappled'; this.grappleT = 0;
    this.onBark('aiko', 'Arm has it. Hard dock.');
    const fuel = Math.round(this.dv * FUEL_PER_MS * this.opts.fuelFactor / 10) * 10;
    const stars = this.dv < 1.2 ? 3 : this.dv < 4 ? 2 : 1;
    this.ended = { stars, reward: this.opts.reward - fuel, dv: this.dv, minutes: (this.t - this.startT) / 60, fuel };
  }
  /** Dev helper: jump to the end of the transfer, holding at the target. */
  skip() {
    if (this.phase === 'plan') return;
    this.ship = core.abs(this.hold, [0, 0, 0], this.targetState(this.t));
    this.burnLeft = null; this.phase = 'holding';
  }
  private applyDv(d: number[]) { this.ship = { r: this.ship.r, v: V.add(this.ship.v, d) }; this.dv += V.len(d) * 1000; this.thrust = 0.3; }

  /** Catch the op up to world time: exact Kepler jumps while coasting, 0.5 s substeps while manoeuvring. */
  step(tNow: number, dt = 0) {
    const gap = tNow - this.t;
    if (gap <= 0) return;
    if (this.phase === 'holding' && gap > 30) { this.ship = core.abs(this.hold, [0, 0, 0], this.targetState(tNow)); this.t = tNow; return; }
    if (this.phase === 'plan' || this.phase === 'grappled' || (this.phase === 'transfer' && !this.burnLeft)) {
      const to = this.phase === 'transfer' ? Math.min(tNow, this.arriveT) : tNow;
      if (to - this.t > 1) { this.ship = core.kepler(this.ship, to - this.t); this.t = to; }
      if (this.phase === 'grappled') this.ship = core.abs(this.hold, [0, 0, 0], this.targetState(this.t));
    }
    let n = 0;
    while (this.t < tNow - 1e-6 && n++ < 20000) this.sub(Math.min(0.5, tNow - this.t));
    if (this.thrust > 0) this.thrust = Math.max(0, this.thrust - dt);
    if (this.phase === 'grappled') this.grappleT += dt;
  }
  private sub(h: number) {
    const t = this.t + h;
    this.ship = core.kepler(this.ship, h);
    if (this.burnLeft) {
      const left = V.len(this.burnLeft) * 1000, d = Math.min(left, this.burnAcc * h), dv = V.mul(V.norm(this.burnLeft), d / 1000);
      this.applyDv(dv);
      this.burnLeft = left - d < 1e-4 ? null : V.sub(this.burnLeft, dv);
    }
    if (this.phase === 'transfer' && t >= this.arriveT && !this.burnLeft) {
      const want = core.abs(this.hold, [0, 0, 0], this.targetState(t));
      this.burnLeft = V.sub(want.v, this.ship.v);
      this.burnAcc = V.len(this.burnLeft) * 1000 > 2 ? MAIN_ACC : RCS_ACC;
      this.phase = 'braking';
      this.onBark('sofia', 'Arriving. Braking to hold ' + Math.round(Math.abs(this.hold[0])) + ' metres off the ' + this.opts.name + '.');
    }
    if ((this.phase === 'braking' && !this.burnLeft) || this.phase === 'holding') this.stationKeep(t, h);
    this.t = t;
  }
  private stationKeep(t: number, h: number) {
    const tgt = this.targetState(t), r = core.rel(this.ship, tgt), err = V.sub(r.p, this.hold), e = V.len(err);
    const want = e < 0.3 ? [0, 0, 0] : V.mul(V.norm(err), -Math.min(0.8, 0.08 * e + 0.02));
    const dw = V.sub(want, r.w), l = V.len(dw);
    if (this.phase === 'braking' && e < 3 && V.len(r.w) < 0.08) {
      this.phase = 'holding';
      this.onBark('sofia', 'Holding at ' + Math.round(Math.abs(this.hold[0])) + ' metres. Your call, Commander.');
    }
    if (l < 0.003) return;
    const B = core.basis(tgt);
    const eci = [B.V[0] * dw[0] + B.R[0] * dw[1] - B.H[0] * dw[2], B.V[1] * dw[0] + B.R[1] * dw[1] - B.H[1] * dw[2], B.V[2] * dw[0] + B.R[2] * dw[1] - B.H[2] * dw[2]];
    this.applyDv(V.mul(V.norm(eci), Math.min(l, RCS_ACC * h) / 1000));
  }
  path() {
    const horizon = this.phase === 'transfer' ? Math.max(30, this.arriveT - this.t) : 600;
    return core.closest(this.ship, this.target, this.t, horizon, 200);
  }
}
