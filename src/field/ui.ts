// Field operations: the screen that hosts the Recovery race and the Hopper courier. It owns its
// own saves (separate from the main company), the map canvas and its input, and routes actions.
import { worldNow, setClockSkew, fmtWorldDate } from '../sim/clock';
import { esc, money } from '../game/util';
import { LocId } from './world';
import { Recovery, RecSave, foundRec } from './recovery';
import { Hopper, HopSave, newHopSave } from './hopper';
import { MapView, baseChart } from './mapgfx';
import { RecView } from './recview';
import { HopView } from './hopview';

export interface Host {
  set(s: string): void;
  region(id: string, html: string): void;
  toast(text: string, kind?: string): void;
  modal(html: string): void;
  closeModal(): void;
  regions: Record<string, string>;
}
interface FieldSaves { v: 1; rec: Partial<Record<LocId, RecSave>>; hop: Partial<Record<LocId, HopSave>>; seen: Record<string, 1> }
const KEY = 'perihelion-field-v1';
export type FieldMode = 'rec' | 'hop';

export const MODES: Record<FieldMode, { name: string; tag: string; blurb: string; locs: Record<LocId, string> }> = {
  rec: {
    name: 'Recovery race', tag: 'Race rival crews to whatever falls from orbit',
    blurb: 'Capsules, spent stages and debris come down every few minutes. The tracking network publishes a hazard area that shrinks as each one falls. Wait at its edge, read the track, and be first on the object when it lands.',
    locs: { earth: 'Earth · skimmers off Cape Canaveral', mars: 'Mars · rovers on the Isidis rim' },
  },
  hop: {
    name: 'Hopper courier', tag: 'Fly cargo between settlements on rocket hops',
    blurb: 'Take jobs before rival couriers do, load cargo and propellant, pick your arc, and land the last kilometre and a half yourself. Every upgrade adds Δv, and enough Δv reaches orbit.',
    locs: { earth: 'Earth · Florida and the Bahamas', mars: 'Mars · Isidis and Syrtis' },
  },
};

export class FieldUI {
  mode: FieldMode | null = null; loc: LocId = 'mars';
  saves: FieldSaves;
  rec: Recovery | null = null; hop: Hopper | null = null;
  recView: RecView | null = null; hopView: HopView | null = null;
  view: MapView | null = null; chart: HTMLCanvasElement | null = null;
  cv: HTMLCanvasElement | null = null; ctx: CanvasRenderingContext2D | null = null;
  acc = 0; lastSave = 0; skew = 0;
  dev: boolean;
  keys = new Set<string>();
  private drag: { x: number; y: number; moved: number; id: number } | null = null;

  constructor(public host: Host) {
    this.saves = this.load();
    const q = new URLSearchParams(location.search);
    this.dev = q.has('dev') || /(^#|-)dev\b/.test(location.hash);
    window.addEventListener('keydown', e => {
      if (!this.mode || (e.target as HTMLElement).tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      if (this.hopView?.onKey(e.key.toLowerCase(), true)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.key.toLowerCase()); this.hopView?.onKey(e.key.toLowerCase(), false); });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('resize', () => this.resize());
  }
  now() { return worldNow(); }

  // ---------- saves
  load(): FieldSaves {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) return { seen: {}, ...s }; } catch {}
    return { v: 1, rec: {}, hop: {}, seen: {} };
  }
  persist(force = false) {
    if (!force && performance.now() - this.lastSave < 3000) return;
    this.lastSave = performance.now();
    if (this.rec) this.saves.rec[this.rec.s.loc] = this.rec.s;
    if (this.hop) this.saves.hop[this.hop.s.loc] = this.hop.s;
    try { localStorage.setItem(KEY, JSON.stringify(this.saves)); } catch {}
  }

  // ---------- title screen block
  titleHTML() {
    const card = (m: FieldMode) => {
      const M = MODES[m];
      return `<div class="fcard"><div class="fh"><b>${M.name}</b><span>${M.tag}</span></div><div class="flocs">` +
        (['earth', 'mars'] as LocId[]).map(l => {
          const sv = m === 'rec' ? this.saves.rec[l] : this.saves.hop[l];
          const sub = sv ? 'Continue · ' + money(sv.credits) : M.locs[l].split(' · ')[1];
          return `<button class="floc ${l}" data-act="field-enter" data-v="${m}:${l}"><b>${l === 'earth' ? 'Earth' : 'Mars'}</b><span>${esc(sub)}</span></button>`;
        }).join('') + `</div></div>`;
    };
    return `<div class="fieldops"><div class="k">Field operations · prototypes</div><div class="fcards">${card('rec')}${card('hop')}</div></div>`;
  }

  // ---------- entering and leaving
  enter(mode: FieldMode, loc: LocId) {
    this.leaveSim();
    this.mode = mode; this.loc = loc;
    const t = this.now();
    if (mode === 'rec') {
      const s = this.saves.rec[loc] || foundRec(loc, loc === 'mars' ? 'Ridgeline Recovery' : 'Meridian Recovery', t);
      this.saves.rec[loc] = s;
      this.rec = new Recovery(s);
      this.rec.step(t);
      this.recView = new RecView(this, this.rec);
      this.view = new MapView(this.rec.W.region);
    } else {
      const s = this.saves.hop[loc] || newHopSave(loc, loc === 'mars' ? 'Redrock Hop Co.' : 'Coastline Hop Co.', t);
      this.saves.hop[loc] = s;
      this.hop = new Hopper(s);
      this.hop.tick(t);
      this.hopView = new HopView(this, this.hop);
      this.view = new MapView(this.hop.W.region);
    }
    this.host.set('field');
    // The 3D world is not drawn in field mode; hiding its canvas saves compositing it every frame.
    const gl = document.getElementById('gl'); if (gl) gl.style.visibility = 'hidden';
    this.cv = document.getElementById('fmap') as HTMLCanvasElement;
    this.ctx = this.cv.getContext('2d');
    this.bindCanvas();
    this.resize();
    this.chart = baseChart(this.view.r, this.view.r.loc === 'mars' ? 560 : 640);
    this.recView?.start(); this.hopView?.start();
    this.persist(true);
    const key = mode + ':' + loc;
    if (!this.saves.seen[key]) { this.saves.seen[key] = 1; this.persist(true); this.intro(); }
  }
  leaveSim() {
    this.persist(true);
    this.rec = null; this.hop = null; this.recView = null; this.hopView = null; this.mode = null;
  }
  exit() {
    this.leaveSim();
    const gl = document.getElementById('gl'); if (gl) gl.style.visibility = '';
    this.host.set('title');
  }

  intro() {
    if (this.mode === 'rec') {
      const L = this.rec!.L;
      this.host.modal(`<div class="k">${MODES.rec.name} · ${this.loc === 'mars' ? 'Mars' : 'Earth'}</div><h2>First on it wins it</h2>
        <p>${MODES.rec.blurb}</p>
        <ul class="fbul"><li><b>Coral dashed ellipse</b>: the official hazard area. No crew may enter it until the object is down, and it shrinks as the object falls.</li>
        <li><b>Where to wait.</b> The tracking error runs mostly <i>along</i> the ground track (violet arrow). The short sides of the ellipse are the safe bet; an end of the long axis is a gamble that pays when the object lands near that end.</li>
        <li><b>At impact</b> the hazard lifts and every crew dashes in. The closest wins and tows it home to ${esc(L.port)}.</li>
        <li><b>Your first job</b> is a contract capsule only you are tracking. Select it, then send your ${L.craft}.</li></ul>
        <div class="mfoot"><button class="btn primary big" data-act="close">Start</button></div>`);
    } else {
      const L = this.hop!.L;
      this.host.modal(`<div class="k">${MODES.hop.name} · ${this.loc === 'mars' ? 'Mars' : 'Earth'}</div><h2>Every hop is a rocket launch</h2>
        <p>${MODES.hop.blurb}</p>
        <ul class="fbul"><li><b>Board</b>: jobs at the pad you are on. Rival couriers take them if you wait too long.</li>
        <li><b>Plan</b>: pick a destination on the map. A lower arc is quicker; the cheapest arc is usually 30–40°. Load more propellant than the plan needs and you have margin to land; load less and you carry more cargo.</li>
        <li><b>Landing</b>: at ${'1,500'} m the computer hands you the descent. W/S or ↑/↓ for throttle (H sets hover), A/D or ←/→ to tilt. Touch down under ${L.base.legs} m/s on the pad. The computer can land for you, but it burns more propellant.</li>
        <li><b>Your first job</b> is waiting on the board: a short hop, yours alone.</li></ul>
        <div class="mfoot"><button class="btn primary big" data-act="close">Start</button></div>`);
    }
  }

  screenHTML() {
    return `<section class="screen field ${this.mode}"><canvas id="fmap" aria-label="Map"></canvas>
      <header class="top ftop" id="f-top"></header>
      <div class="pane fpanel" id="f-right"></div>
      <div class="fbottom" id="f-bottom"></div>
      <div class="flegend pane" id="f-legend"></div>
      <div class="devtray" id="f-dev"></div>
      <div class="fland" id="f-landwrap" hidden><canvas id="f-lcv" class="lcv" aria-label="Side view of the landing"></canvas><div id="f-land"></div></div></section>`;
  }

  // ---------- canvas
  resize() {
    if (!this.cv || !this.view) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = window.innerWidth, H = window.innerHeight;
    this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
    this.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view.W = W; this.view.H = H;
    const narrow = W < 820, right = narrow ? 0 : Math.min(420, W * 0.36) + 24;
    this.view.box = narrow ? { x: 0, y: 64, w: W, h: Math.max(240, H * 0.52) } : { x: 12, y: 64, w: W - right - 24, h: H - 64 - (this.mode === 'hop' ? 300 : 24) };
  }
  bindCanvas() {
    const cv = this.cv!;
    cv.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy); this.drag.x = e.clientX; this.drag.y = e.clientY;
        if (this.drag.moved > 6) this.view?.pan(dx, dy);
      } else this.hover(e.clientX, e.clientY);
    });
    const up = (e: PointerEvent) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const click = this.drag.moved <= 6; this.drag = null;
      if (click) this.click(e.clientX, e.clientY);
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { this.drag = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.view?.zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY); }, { passive: false });
  }
  click(x: number, y: number) { const p = this.view!.toKm(x, y); this.recView?.click(p, x, y); this.hopView?.click(p, x, y); }
  hover(x: number, y: number) { if (!this.view) return; const p = this.view.toKm(x, y); this.recView?.hover(p, x, y); this.hopView?.hover(p, x, y); }

  // ---------- per frame
  frame(dt: number) {
    if (!this.mode || !this.ctx || !this.view) return;
    const t = this.now();
    if (this.rec) { this.rec.step(t); for (const m of this.rec.msgs.splice(0)) this.host.toast(m.text, m.kind); }
    if (this.hop) { this.hopView!.frame(dt, t); for (const m of this.hop.msgs.splice(0)) this.host.toast(m.text, m.kind); }
    this.view.drawBase(this.ctx, this.chart!);
    this.recView?.draw(this.ctx, this.view, t);
    this.hopView?.draw(this.ctx, this.view, t);
    this.acc += dt;
    if (this.acc >= 0.25) { this.acc = 0; this.panels(t); }
    this.persist();
  }
  panels(t: number) {
    const s = this.rec?.s || this.hop!.s, M = MODES[this.mode!];
    const goal = this.rec ? this.recView!.goalHTML() : this.hopView!.goalHTML();
    this.host.region('f-top', `<button class="btn slim" data-act="field-exit" aria-label="Back to the title screen">← Title</button>
      <div class="co"><div><b>${esc(s.company)}</b><span>${M.name} · ${this.loc === 'mars' ? 'Mars' : 'Earth'}</span></div></div>
      <div class="fgoal">${goal}</div>
      <div class="stat">World time<b class="num">${fmtWorldDate(t).slice(11)}</b></div>
      <div class="stat money">Credits<b class="num${s.credits < 0 ? ' neg' : ''}">${money(s.credits)}</b></div>
      <button class="btn slim" data-act="field-help" aria-label="How to play">?</button>`);
    if (this.rec) this.recView!.panels(t); else this.hopView!.panels(t);
    this.host.region('f-dev', this.dev ? `<b>Dev</b><button class="btn slim" data-act="field-skip" data-v="30">+30 s</button><button class="btn slim" data-act="field-skip" data-v="60">+1 min</button><button class="btn slim" data-act="field-skip" data-v="300">+5 min</button><button class="btn slim" data-act="field-money">+¤20k</button><button class="btn slim" data-act="field-reset">Reset this save</button>` : '');
  }

  act(a: string, v: string): boolean {
    const t = this.now();
    switch (a) {
      case 'field-enter': { const [m, l] = v.split(':'); this.enter(m as FieldMode, l as LocId); return true; }
      case 'field-exit': this.exit(); return true;
      case 'field-help': this.intro(); return true;
      case 'field-skip': this.skew += +v; setClockSkew(this.skew); return true;
      case 'field-money': { const s = this.rec?.s || this.hop?.s; if (s) s.credits += 20000; return true; }
      case 'field-reset': {
        const m = this.mode!, l = this.loc;
        if (m === 'rec') delete this.saves.rec[l]; else delete this.saves.hop[l];
        delete this.saves.seen[m + ':' + l];
        this.rec = null; this.hop = null;
        try { localStorage.setItem(KEY, JSON.stringify(this.saves)); } catch {}
        this.enter(m, l); return true;
      }
    }
    if (this.recView?.act(a, v, t)) { this.persist(true); this.host.regions['f-right'] = ''; return true; }
    if (this.hopView?.act(a, v, t)) { this.persist(true); this.host.regions['f-right'] = ''; return true; }
    return false;
  }
}
