// The game: one save, five layers (stages), all running on the shared world clock.
import * as THREE from 'three/webgpu';
import { core, V, Vec3, Ephem, R_EARTH, DEG } from '../sim/core';
import { worldNow } from '../sim/clock';
import { WorldScene, PLANETS } from '../world/scene';
import { FreeCamera, CamOut, FocusInfo } from '../world/camera';
import { WorldBackend, createBackend } from '../net/backend';
import { Ground, GroundSave, newGround, MODULES, LAUNCH_COST, START_CREDITS } from './ground';
import { RendezvousOp } from './ops';
import { CONTRACTS, Contract, HAVEN, IDLE } from './orbit';
import { Haul, HaulSave, newHaul, portHelio, helioToGeo, PORTS, bodyHelioPos } from './haul';
import { Sovereign, SovSave, newSov, siteGeo, SITES4, MODS } from './sovereign';
import { makeHauler, makeSovStation, Hauler, SovStation } from '../render/big';

export const SPONSORS: Record<string, { id: string; name: string; agency: string; color: string; blurb: string; perk: string }> = {
  us: { id: 'us', name: 'United States', agency: 'Office of Commercial Orbital Services', color: '#5b8cff', blurb: 'Big contracts, big paperwork.', perk: 'Base: Cape Canaveral' },
  eu: { id: 'eu', name: 'European Union', agency: 'European Orbital Stewardship Agency', color: '#ffd24a', blurb: 'Pays well for clean work.', perk: 'Base: Kourou, near the equator' },
  cn: { id: 'cn', name: 'China', agency: 'National Orbital Logistics Bureau', color: '#ff5a4f', blurb: 'Fast-moving and well funded.', perk: 'Base: Wenchang' },
};
export const CREW = [
  { id: 'sofia', name: 'Sofia Reyes', role: 'Pilot', tint: '#4fd2ff' },
  { id: 'taras', name: 'Taras Melnyk', role: 'Engineer', tint: '#ffb13d' },
  { id: 'aiko', name: 'Aiko Tanabe', role: 'EVA specialist', tint: '#7be3a0' },
  { id: 'kwame', name: 'Kwame Mensah', role: 'Quartermaster', tint: '#b48cff' },
];
export const STAGES = [
  { n: 1, name: 'Ground', where: 'Launch site', col: '#4da3ff' },
  { n: 2, name: 'Orbit', where: 'Low Earth orbit', col: '#2fd6b5' },
  { n: 3, name: 'Interplanetary', where: 'Inner solar system', col: '#b48cff' },
  { n: 4, name: 'Sovereign', where: 'Your own station', col: '#ffb13d' },
  { n: 5, name: 'Interstellar', where: 'In design', col: '#ff6b5a' },
];

export interface Company { name: string; sponsor: string; ship: string; hauler: string; credits: number; stars: number; missions: number }
export interface Save {
  v: 4; company: Company; unlocked: number; layer: number; dev?: boolean;
  ground: GroundSave; orbit: { done: Record<string, number>; fuelFactor: number }; haul: HaulSave | null; sov: SovSave | null;
}
export interface Label { k: string; p: number[]; title: string; sub?: string; cls: string; focus?: string; col?: string }

export class Game {
  net: WorldBackend | null = null;
  save: Save | null = null;
  ground: Ground | null = null;
  op: RendezvousOp | null = null;
  opContract: Contract | null = null;
  haul: Haul | null = null;
  sov: Sovereign | null = null;
  barks: { who: string; text: string; t: number }[] = [];
  notes: { text: string; kind: string; t: number }[] = [];
  camOut!: CamOut;
  ephem!: Ephem;
  shipQuat = new THREE.Quaternion();
  haulQuat = new THREE.Quaternion();
  onNet: (() => void) | null = null;
  lastSave = 0;
  labels: Label[] = [];
  hauler: Hauler | null = null;
  sovStation: SovStation | null = null;

  constructor(public world: WorldScene, public cam: FreeCamera) {
    createBackend().then(async b => {
      this.net = b;
      const s = await b.loadSave();
      if (s && s.v === 4) this.load(s);
      this.onNet?.();
    });
  }
  get company() { return this.save?.company || null; }
  get layer() { return this.save?.layer || 1; }
  now() { return worldNow(); }

  // ---------- save / lifecycle ----------
  found(name: string, sponsor: string, ship: string) {
    const t = this.now(), co = name.slice(0, 28) || 'Meridian Orbital Salvage';
    this.load({
      v: 4, company: { name: co, sponsor, ship: ship.slice(0, 20) || 'Halyard', hauler: 'Long Reach', credits: START_CREDITS, stars: 0, missions: 0 },
      unlocked: 1, layer: 1, ground: newGround(co, sponsor, t), orbit: { done: {}, fuelFactor: 1 }, haul: null, sov: null,
    });
    this.persist(true);
    this.net?.postFeed(this.company!.name, 'was founded under a ' + SPONSORS[sponsor].name + ' licence.');
  }
  /** Development: a ready-made company at the start of any stage. */
  devJump(stage: number, sponsor = 'eu') {
    const t = this.now(), co = 'Dev Salvage & Haulage';
    const g = newGround(co, sponsor, t);
    const s: Save = {
      v: 4, dev: true, company: { name: co, sponsor, ship: 'Halyard', hauler: 'Long Reach', credits: [0, START_CREDITS, 40000, 150000, 300000, 300000][stage], stars: 0, missions: 0 },
      unlocked: Math.min(stage, 4), layer: Math.min(stage, 4), ground: g, orbit: { done: {}, fuelFactor: 1 }, haul: null, sov: null,
    };
    if (stage >= 2) { for (const m of MODULES) g.build[m.id] = { end: t - 60 }; g.launched = true; }
    if (stage >= 3) { for (const c of CONTRACTS) s.orbit.done[c.id] = 2; s.haul = newHaul(); }
    if (stage >= 4) { s.haul!.delivered = 4; }
    this.op = null;
    this.load(s);
    this.persist(true);
  }
  load(s: Save) {
    this.save = s; this.op = null;
    const pay = (n: number, why: string) => { s.company.credits += n; if (why) this.note(why + ' · +¤' + Math.round(n).toLocaleString('en-US'), 'ok'); this.persist(); };
    const spend = (n: number) => { if (s.company.credits < n) return false; s.company.credits -= n; this.persist(); return true; };
    const note = (t: string, k?: string) => this.note(t, k || '');
    const bark = (w: string, t: string) => this.bark(w, t);
    this.ground = new Ground(s.ground, s.company.sponsor, pay, spend, note);
    this.haul = s.haul ? new Haul(s.haul, s.company.name, pay, spend, note, bark) : null;
    this.sov = s.sov ? new Sovereign(s.sov, s.company.name, pay, spend, note, bark) : null;
  }
  persist(force = false) {
    if (!this.save || !this.net) return;
    if (!force && performance.now() - this.lastSave < 3000) return;
    this.lastSave = performance.now();
    this.net.save(this.save);
    this.net.publishCompany({ name: this.save.company.name, sponsor: this.save.company.sponsor, stage: this.save.unlocked, credits: Math.round(this.save.company.credits) });
  }
  bark(who: string, text: string) { this.barks.push({ who, text, t: performance.now() }); if (this.barks.length > 12) this.barks.shift(); }
  note(text: string, kind = '') { this.notes.push({ text, kind, t: performance.now() }); }

  setLayer(n: number) {
    if (!this.save || n > this.save.unlocked || n > 4) return;
    this.save.layer = n;
    const f = ['base', 'base', 'ship', 'hauler', this.sov ? 'claim' : 'earth'][n];
    this.focus(f);
    this.persist();
  }
  unlock(n: number, msg: string) {
    if (!this.save || this.save.unlocked >= n) return;
    this.save.unlocked = n;
    this.note('Stage ' + n + ' unlocked · ' + msg, 'ok');
    this.persist(true);
  }

  // ---------- Stage 1 ----------
  launch() {
    const g = this.ground!, t = this.now();
    if (!g.shipReady(t) || g.s.launched) return;
    if (!g.spend(LAUNCH_COST)) { this.note('The ride to orbit costs ¤' + LAUNCH_COST.toLocaleString('en-US') + '. Earn a little more first.', 'warn'); return; }
    g.s.launched = true;
    this.bark('sofia', 'We are in orbit. Haven Commercial has us on approach lights.');
    this.net?.postFeed(this.company!.name, 'launched its first tug, ' + this.company!.ship + '.');
    this.unlock(2, this.company!.ship + ' is in orbit next to Haven Commercial.');
    this.save!.layer = 2;
    this.cam.setFocus('ship', this.focusInfo(this.cam.focusId)?.pos || null, 0.08);
    this.persist(true);
  }

  // ---------- Stage 2 ----------
  idleShip(t: number) { return core.circ(IDLE, t); }
  shipState(t: number) { return !this.save || this.save.unlocked < 2 ? null : this.op ? this.op.ship : this.idleShip(t); }
  startContract(id: string) {
    const c = CONTRACTS.find(x => x.id === id); if (!c || this.op) return;
    const t = this.now(), ff = this.ground!.done('research', 'lighttank', t) ? 0.85 : 1;
    this.opContract = c;
    this.op = new RendezvousOp(this.idleShip(t), c.target, t, (w, x) => this.bark(w, x), { hold: c.hold, reward: c.reward, fuelFactor: ff, name: c.name });
    this.op.computePlans();
    this.barks = [];
    this.bark('sofia', c.brief + ' I have three ways to get there. Pick one.');
    this.cam.setFocus('ship', this.focusInfo('ship')?.pos || null, 0.09);
  }
  abortContract() { this.op = null; this.opContract = null; this.bark('sofia', 'Standing down. Back to Haven.'); }
  finishContract() {
    const op = this.op, c = this.opContract; if (!op?.ended || !c) return;
    const co = this.company!, e = op.ended;
    co.credits += e.reward; co.stars += e.stars; co.missions++;
    this.save!.orbit.done[c.id] = Math.max(this.save!.orbit.done[c.id] || 0, e.stars);
    this.net?.postFeed(co.name, 'completed "' + c.title + '" near Haven (' + e.stars + '★).');
    this.op = null; this.opContract = null;
    if (CONTRACTS.every(x => this.save!.orbit.done[x.id])) {
      if (!this.save!.haul) { this.save!.haul = newHaul(); this.load(this.save!); }
      this.unlock(3, 'Your licence now covers interplanetary hauling. The torch ship ' + co.hauler + ' waits at Haven.');
    }
    this.persist(true);
  }

  // ---------- Stage 3 ----------
  afterDelivery() {
    if (this.haul && this.haul.s.delivered >= 4) this.unlock(4, 'You can now claim territory and found your own station.');
  }

  // ---------- Stage 4 ----------
  claim(site: string, name: string) {
    const s = SITES4.find(x => x.id === site); if (!s || !this.save || this.save.sov) return;
    if (this.save.company.credits < s.cost) { this.note('Claiming ' + s.name + ' costs ¤' + s.cost.toLocaleString('en-US') + '.', 'warn'); return; }
    this.save.company.credits -= s.cost;
    this.save.sov = newSov(site, name || s.name + ' Free Station', this.now());
    this.load(this.save);
    this.net?.postFeed(this.company!.name, 'claimed ' + s.name + ' and declared ' + this.save.sov!.name + '.');
    this.bark('kwame', 'The flag is up. Every module we add is ours to defend.');
    this.focus('claim');
    this.persist(true);
  }

  // ---------- objectives ----------
  /** The current layer's goal, as a checklist with a next-step hint. */
  objective() {
    const s = this.save!, t = this.now(), g = this.ground!, co = s.company;
    const L = s.layer;
    if (L === 1) {
      const built = g.builtCount(t), busy = g.inProgress('build', t);
      const need = g.remainingCost(), short = Math.max(0, need - co.credits);
      const steps = [
        { done: built === MODULES.length, text: 'Build all five modules', val: built + '/5' },
        { done: g.s.launched, text: 'Pay for the launch', val: '¤' + LAUNCH_COST.toLocaleString('en-US') },
      ];
      let next = '';
      const live = g.passes(t).filter(p => p.state !== 'done');
      const nextFree = live.find(p => p.state === 'future' && !p.booked && !p.conflict);
      const rec = g.activeRecovery(t);
      const affordable = MODULES.find(m => !g.s.build[m.id] && m.cost <= co.credits);
      if (g.s.launched) next = 'Stage 1 is complete. The control room keeps earning in the background.';
      else if (g.shipReady(t)) next = co.credits >= LAUNCH_COST ? 'Your ship is ready. Press Launch.' : 'Ship ready. Earn ¤' + (LAUNCH_COST - co.credits).toLocaleString('en-US') + ' more for the launch.';
      else if (!busy && affordable) next = 'Start the next module in the hangar: ' + affordable.name + '.';
      else if (rec && !g.s.boat && rec.tLand - t < 1100 && g.boatReach(rec, t)) next = 'A ' + rec.kind.toLowerCase() + ' is coming down. Send the boat now, re-target in the last 3 minutes.';
      else if (rec && g.s.boat && rec.tLand - t < 240 && rec.tLand > t) next = 'Splashdown soon. Re-target the boat to the latest prediction.';
      else if (nextFree && !g.s.auto) next = 'Book the next satellite pass: ' + nextFree.client + ' pays ¤' + nextFree.pay.toLocaleString('en-US') + '.';
      else if (busy) next = 'The crew is building. Passes and recoveries pay for the rest.';
      else next = 'Earn ¤' + short.toLocaleString('en-US') + ' more from passes and recoveries.';
      return { title: 'Launch your first ship', steps, need, short, next, progress: (built + (g.s.launched ? 1 : 0)) / 6 };
    }
    if (L === 2) {
      const done = CONTRACTS.filter(c => s.orbit.done[c.id]).length;
      return {
        title: 'Prove yourself in orbit', progress: done / CONTRACTS.length, need: 0, short: 0,
        steps: CONTRACTS.map(c => ({ done: !!s.orbit.done[c.id], text: c.title, val: s.orbit.done[c.id] ? '★'.repeat(s.orbit.done[c.id]) : '¤' + c.reward.toLocaleString('en-US') })),
        next: this.op ? (this.op.phase === 'plan' ? 'Pick a flight plan. Sofia flies it.' : this.op.phase === 'holding' ? 'Holding off the target. Grapple it.' : 'The computer is flying. Watch, or check the ground.') : done < 3 ? 'Take a contract from the board.' : 'Stage 2 complete. Interplanetary hauling is open.',
      };
    }
    if (L === 3) {
      const h = this.haul!, d = h.s.delivered;
      return {
        title: 'Run the inner system', progress: Math.min(1, d / 4), need: 0, short: 0,
        steps: [{ done: d >= 4, text: 'Deliver four cargoes', val: Math.min(d, 4) + '/4' }],
        next: h.s.trip ? 'In flight. The world keeps running; manage another stage meanwhile.' : 'Pick a contract at ' + (PORTS.find(p => p.id === h.s.port)?.name || '') + ', then a flight plan.',
      };
    }
    const sv = this.sov;
    const n = sv ? sv.built(t).length : 0, surv = sv ? sv.s.survived : 0;
    return {
      title: 'Found your own state', progress: sv ? Math.min(1, (n / 6 + Math.min(surv, 2) / 2) / 2) : 0, need: 0, short: 0,
      steps: [{ done: !!sv, text: 'Claim a site', val: sv ? sv.site.name : '' }, { done: n >= 6, text: 'Build six modules', val: n + '/6' }, { done: surv >= 2, text: 'Repel two raids', val: Math.min(surv, 2) + '/2' }],
      next: !sv ? 'Choose where to plant your flag.' : sv.allVisible(t).length ? 'Raiders inbound. Decide how to meet them.' : n < 6 ? 'Add modules to the ring.' : 'Hold what you have built.',
    };
  }

  // ---------- camera ----------
  focusInfo(id: string): FocusInfo | null {
    const t = this.now(), e = this.ephem || core.ephem(t), sunHelio = V.mul(e.sun, -1);
    switch (id) {
      case 'ship': { const s = this.shipState(t); return s ? { pos: s.r, minKm: 0.0075, defaultKm: 0.08, parent: 'earth', promoteKm: 6e4 } : null; }
      case 'hauler': return this.haul ? { pos: this.haulerGeo(t), minKm: 0.04, defaultKm: 0.3, parent: 'sun', promoteKm: 2e8 } : null;
      case 'claim': return this.sov ? { pos: siteGeo(this.sov.s.site, t), minKm: 0.05, defaultKm: 0.22, parent: 'sun', promoteKm: 2e8 } : null;
      case 'base': return this.ground ? { pos: this.ground.siteECI(t), minKm: 25, defaultKm: 1800, parent: 'earth', promoteKm: 6e4 } : null;
      case 'earth': return { pos: [0, 0, 0], minKm: R_EARTH * 1.03, defaultKm: 26000, parent: 'sun', promoteKm: 6e7 };
      case 'moon': return { pos: e.moon, minKm: 1737 * 1.05, defaultKm: 9000, parent: 'sun', promoteKm: 6e7 };
      case 'sun': return { pos: e.sun, minKm: 696000 * 1.2, defaultKm: 5e8 };
      case 'kamo': case 'ceres': return { pos: helioToGeo(bodyHelioPos(id, t), t), minKm: 50, defaultKm: 2e5, parent: 'sun', promoteKm: 2e8 };
    }
    const k = PLANETS.findIndex(p => p.name.toLowerCase() === id);
    return k >= 0 && k !== 2 ? { pos: V.sub(e.planets[k], sunHelio), minKm: PLANETS[k].r * 1.05, defaultKm: PLANETS[k].r * 9, parent: 'sun', promoteKm: 6e7 } : null;
  }
  focus(id: string) {
    const from = this.camOut?.focus || null, f = this.focusInfo(id);
    if (!f) return;
    this.cam.setFocus(id, from, f.defaultKm);
    if (id === 'base') {
      // Look down at the base from above, north up.
      const up = new THREE.Vector3(...V.norm(f.pos)), north = new THREE.Vector3(0, 0, 1).sub(up.clone().multiplyScalar(up.z)).normalize();
      const eye = up.clone().multiplyScalar(0.8).addScaledVector(north, -0.6).normalize();
      this.cam.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, new THREE.Vector3(), north));
    }
  }
  haulerGeo(t: number): Vec3 {
    const h = this.haul!;
    if (h.s.trip) return h.shipGeo(t);
    if (h.s.port === 'haven') return V.add(core.circ(HAVEN, t).r, [0.25, 0.25, 0]);
    return helioToGeo(portHelio(h.s.port!, t), t);
  }

  // ---------- simulation step ----------
  step(dt: number) {
    const t = this.now();
    if (!this.save) return;
    this.ground?.tick(t);
    this.op?.step(t, dt);
    if (this.haul) { const d = this.haul.s.delivered; this.haul.tick(t); if (this.haul.s.delivered !== d) { this.afterDelivery(); this.persist(true); } }
    this.sov?.tick(t);
  }

  // ---------- rendering ----------
  render(dt: number) {
    const t = this.now(), w = this.world;
    this.ephem = core.ephem(t);
    this.camOut = this.cam.compute(id => this.focusInfo(id));
    const env = w.update(t, this.camOut, this.ephem);
    const labels: Label[] = [];
    const op = this.op, ship = this.shipState(t), tug = w.tug, near = this.camOut.dist < 6e4;
    tug.group.visible = !!ship;
    const tgt = op ? op.targetState(t) : null;
    const model = this.opContract?.model === 'sat' ? w.deadSat : w.pod;
    w.pod.visible = !!(op && op.phase !== 'grappled' && model === w.pod);
    w.deadSat.visible = !!(op && op.phase !== 'grappled' && model === w.deadSat);
    const haven = core.circ(HAVEN, t);
    w.rel(haven.r, w.station.position); w.station.quaternion.copy(w.lvlhQuat(haven));
    if (ship) {
      const lv = w.lvlhQuat(ship), fwd = new THREE.Vector3(1, 0, 0);
      if (op && tgt) { const p = op.rel().p; if (Math.hypot(...p) > 3) fwd.set(-p[0], -p[1], -p[2]).normalize(); }
      const look = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, new THREE.Vector3(0, 1, 0)))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      this.shipQuat.slerp(lv.clone().multiply(look), 1 - Math.exp(-dt * 2));
      w.rel(ship.r, tug.group.position); tug.group.quaternion.copy(this.shipQuat);
      if (tgt) { w.rel(tgt.r, model.position); model.quaternion.copy(w.lvlhQuat(tgt)); }
      if (op && op.phase === 'grappled') { const k = Math.min(1, op.grappleT / 2); tug.armJoints[0].rotation.x = -0.35 + k * 0.25; tug.armJoints[1].rotation.x = 0.9 - k * 0.5; }
      const firing = !!(op && op.thrust > 0);
      for (const r of tug.rcs) r.visible = firing && Math.random() > 0.35;
      tug.plume.visible = false;
      const blink = performance.now() / 1000 % 1.6;
      tug.strobe.visible = blink < 0.08;
      model.userData.beacon.visible = blink > 0.8 && blink < 0.95;
      const deck = this.camOut.deck;
      tug.interior.visible = deck > 0.02;
      const toCam = new THREE.Vector3().sub(tug.group.position).applyQuaternion(this.shipQuat.clone().invert());
      const d2 = new THREE.Vector2(toCam.x, toCam.y).normalize();
      for (const q of tug.shell) q.visible = !(deck > 0.3 && (q.userData.dir as THREE.Vector2).dot(d2) > -0.2);
      tug.trim.visible = deck < 0.3;
    }
    // Lighting follows whatever the camera is looking at.
    const focusGeo = this.camOut.focus;
    if (V.len(focusGeo) < 5e5 && V.len(focusGeo) > R_EARTH) {
      w.updateEnv(focusGeo, this.ephem.sun);
      const down = new THREE.Vector3(...V.norm(V.mul(focusGeo, -1)));
      const fr = w.rel(focusGeo, new THREE.Vector3());
      w.gfx.earthLight.intensity = 0.15 + 0.55 * Math.max(0, -down.dot(env.sunDir));
      w.gfx.earthLight.position.copy(fr).addScaledVector(down, -100); w.gfx.earthLight.target.position.copy(fr);
    } else w.gfx.earthLight.intensity = 0;
    const vis = core.sunFraction(focusGeo, this.ephem.sun);
    w.gfx.sunLight.intensity = 3.2 * vis;
    w.gfx.sunLight.castShadow = this.camOut.dist < 0.4;
    // Far from Earth there is no earthshine: lift the ambient fill so hulls stay readable.
    const farOut = V.len(focusGeo) > 5e5;
    w.gfx.ambient.intensity = farOut ? 0.6 : 0.22;
    const big = this.camOut.focusId === 'claim' || this.camOut.focusId === 'hauler' ? 70 : 30, sc = w.gfx.sunLight.shadow.camera;
    if (sc.right !== big) { sc.left = -big; sc.right = big; sc.top = big; sc.bottom = -big; sc.updateProjectionMatrix(); }
    w.stars.uBright.value = this.camOut.dist < 1 && vis > 0.5 ? 0.35 : 1;

    // Stage 2 ghost path
    const showGhost = !!(op && tgt && (op.phase === 'transfer' || op.phase === 'braking') && this.camOut.dist < 80);
    w.ghost.visible = showGhost;
    if (showGhost && op && tgt) {
      const p = op.path();
      w.ghost.geometry.setAttribute('position', new THREE.BufferAttribute(p.pts, 3)); w.ghost.geometry.computeBoundingSphere();
      w.rel(tgt.r, w.ghost.position); w.ghost.quaternion.copy(w.lvlhQuat(tgt));
    }
    if (op && tgt && op.phase !== 'grappled' && this.camOut.focusId === 'ship' && this.camOut.dist < 60 && this.camOut.dist > 0.02)
      labels.push({ k: 'tgt', p: tgt.r, title: this.opContract!.title, sub: (op.dist() < 1000 ? Math.round(op.dist()) + ' m' : (op.dist() / 1000).toFixed(2) + ' km'), cls: 'tg', col: '#ffb13d' });
    if (ship && this.camOut.focusId === 'ship' && this.camOut.dist < 60 && this.camOut.dist > 0.02)
      labels.push({ k: 'haven', p: haven.r, title: 'Haven Commercial', sub: 'station', cls: 'dim', col: '#8fb4ff' });
    if (ship && (this.camOut.focusId !== 'ship' || this.camOut.dist > 3) && this.camOut.dist < 3e5)
      labels.push({ k: 'ship', p: ship.r, title: this.company!.ship, sub: 'salvage tug', cls: 'me', focus: 'ship', col: '#2fd6b5' });

    // Stage 1 overlays
    const g = this.ground;
    if (g && this.save) {
      const site = g.siteECI(t);
      w.marker('base', new THREE.Color(0.4, 0.8, 1.6), near ? site : null, 9, 4);
      if (near) labels.push({ k: 'base', p: site, title: g.site.name, sub: 'your base', cls: 'me', focus: 'base', col: '#4da3ff' });
      const list = g.passes(t), live = list.filter(p => p.state === 'live' && p.booked);
      g.sats.forEach((s, k) => {
        const p = list.find(x => x.sat === s.name && x.state !== 'done' && x.rise - t < 1200), r = core.circ(s.orbit, t).r;
        w.marker('sat' + k, p && p.booked ? new THREE.Color(1.4, 1, 0.4) : new THREE.Color(0.6, 0.85, 1.2), near && p ? r : null, p && p.booked ? 7 : 5, 3);
        if (near && p && (p.state === 'live' || p.booked)) labels.push({ k: 'sat' + k, p: r, title: s.name, sub: p.state === 'live' ? (p.booked ? 'tracking' : 'overhead') : 'booked', cls: 'tg', col: p.booked ? '#ffb13d' : '#8fb4ff' });
      });
      const trk = live[0] ? g.sats.find(s => s.name === live[0].sat) : null;
      w.polyline('beam', 0xffc46a, trk && near ? [site, core.circ(trk.orbit, t).r] : null, 0.8);
      const rec = g.activeRecovery(t);
      if (rec && near) {
        const pr = g.prediction(rec, t), ring: number[][] = [];
        for (let k = 0; k < 64; k++) {
          const a = k / 64 * Math.PI * 2, d = pr.radiusKm / 111;
          ring.push(g.llECI({ lat: pr.centre.lat + d * Math.cos(a), lon: pr.centre.lon + d * Math.sin(a) / Math.cos(pr.centre.lat * DEG) }, t, 2));
        }
        w.polyline('zone', 0xff8a4a, ring, 0.9, true);
        w.marker('zoneC', new THREE.Color(1.4, 0.6, 0.2), g.llECI(pr.centre, t, 2), 6, 3);
        labels.push({ k: 'zone', p: g.llECI(pr.centre, t, 2), title: rec.kind + ' splashdown', sub: Math.round(pr.radiusKm * 2) + ' km zone', cls: 'tg', col: '#ff8a5c' });
      } else { w.polyline('zone', 0xff8a4a, null); w.marker('zoneC', new THREE.Color(1, 0.5, 0.2), null); }
      const bp = g.boatPos(t);
      w.marker('boat', new THREE.Color(0.5, 1.4, 0.7), bp && near ? g.llECI(bp.pos, t, 2) : null, 7, 3);
      w.polyline('boatpath', 0x7fe3a5, bp && near && g.s.boat ? [g.llECI(bp.pos, t, 2), g.llECI(g.s.boat.to, t, 2)] : null, 0.6);
    }

    // Stage 3: hauler
    if (this.haul) {
      if (!this.hauler) { this.hauler = makeHauler(); w.gfx.scene.add(this.hauler.group); }
      const hp = this.haulerGeo(t), H = this.hauler!;
      w.rel(hp, H.group.position);
      const tr = this.haul.s.trip;
      let dir = new THREE.Vector3(...V.norm(haven.v));
      if (tr) {
        const s = (t - tr.t0) / tr.T, flip = s > 0.5;
        const v = this.haul.shipVel(t), to = V.sub(tr.P1, this.haul.shipHelio(t));
        dir = new THREE.Vector3(...V.norm(flip ? V.mul(v, -1) : to));
        H.uPlume.value = 0.6 + Math.min(1.4, Math.log10(1 + tr.g));
      } else H.uPlume.value = 0;
      H.plume.visible = !!tr;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.haulQuat.slerp(q, 1 - Math.exp(-dt * 1.5));
      H.group.quaternion.copy(this.haulQuat);
      if (this.camOut.focusId !== 'hauler' || this.camOut.dist > 2)
        labels.push({ k: 'hauler', p: hp, title: this.company!.hauler, sub: tr ? 'in flight · ' + tr.g + ' g' : 'docked', cls: 'me', focus: 'hauler', col: '#b48cff' });
      if (tr) {
        const pts = this.haul.path(160).map(p => helioToGeo(p, t));
        w.polyline('trip', 0xb48cff, pts, 0.85);
        const mid = helioToGeo(this.haul.path(2)[1], t);
        w.marker('flip', new THREE.Color(1.6, 1, 2.2), mid, 6, 3);
        if (this.camOut.dist > 1e4) labels.push({ k: 'flip', p: mid, title: 'Flip and burn', sub: 'midpoint', cls: 'dim', col: '#b48cff' });
      } else { w.polyline('trip', 0xb48cff, null); w.marker('flip', new THREE.Color(1, 1, 1), null); }
      if (this.camOut.dist > 3e4) for (const p of PORTS) {
        if (p.id === 'haven') continue;
        const pos = helioToGeo(portHelio(p.id, t), t);
        labels.push({ k: 'port-' + p.id, p: pos, title: p.name, sub: p.where, cls: 'port', col: p.col, focus: p.id === 'gateway' ? 'moon' : p.id === 'phobos' ? 'mars' : p.id });
      }
    }
    // Stage 4: station
    if (this.sov) {
      if (!this.sovStation) { this.sovStation = makeSovStation(); w.gfx.scene.add(this.sovStation.group); }
      const S = this.sovStation, sp = siteGeo(this.sov.s.site, t);
      w.rel(sp, S.group.position);
      S.group.rotation.set(0.4, 0, (t / 600) % (Math.PI * 2));
      this.sov.s.slots.forEach((x, i) => S.setSlot(i, x ? x.mod : null, !!x && x.end > t));
      if (this.camOut.focusId !== 'claim' || this.camOut.dist > 2)
        labels.push({ k: 'claim', p: sp, title: this.sov.s.name, sub: this.sov.site.name, cls: 'me', focus: 'claim', col: '#ffb13d' });
    }
    // Bodies
    const dist = this.camOut.dist;
    if (dist > 1e10) labels.push({ k: 'sun', p: this.ephem.sun, title: 'Sun', sub: 'the solar system', cls: 'body', focus: 'sun', col: '#ffd27a' });
    else {
      if (dist > 4e4) labels.push({ k: 'earth', p: [0, 0, 0], title: 'Earth', cls: 'body', focus: 'earth', col: '#4da3ff' });
      if (dist > 2e3) labels.push({ k: 'moon', p: this.ephem.moon, title: 'Moon', cls: 'body', focus: 'moon', col: '#c8d4e6' });
      if (dist > 2e6) {
        labels.push({ k: 'sun', p: this.ephem.sun, title: 'Sun', cls: 'body', focus: 'sun', col: '#ffd27a' });
        const sunHelio = V.mul(this.ephem.sun, -1);
        PLANETS.forEach((p, k) => { if (p.name !== 'Earth') labels.push({ k: 'pl' + k, p: V.sub(this.ephem.planets[k], sunHelio), title: p.name, cls: 'body', focus: p.name.toLowerCase(), col: '#' + p.col.toString(16).padStart(6, '0') }); });
      }
    }
    this.labels = labels;
  }
}

export { MODS, SITES4, PORTS };
