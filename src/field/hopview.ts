// Hopper courier: the network map, the board, the flight planner, and the hands-on landing.
import { esc, money, fmtClock } from '../game/util';
import { XY, dist } from './world';
import { Hopper, Plan, Job } from './hopper';
import { HANDOFF_ALT, PAD_HALF, NEAR, LandState, budget, solveArc, MAX_TILT } from './flight';
import { MapView, COL, label, chevron } from './mapgfx';
import type { FieldUI } from './ui';

const PHASE_WORD: Record<string, string> = { climb: 'Climbing', coast: 'Coasting on the arc', brake: 'Braking burn', landing: 'Landing', down: 'Down' };
const KIND_WORD: Record<string, string> = { pad: 'On the pad', near: 'Off the pad', field: 'Out in the field', hard: 'Hard landing', crash: 'Crashed' };

export class HopView {
  tab = 'board'; dest: string | null = null; gamma: number | null = null; prop: number | null = null;
  plan: Plan | null = null; planKey = ''; profile: { s: number; h: number }[] = [];
  reach = 0; reachKey = ''; hoverSite: string | null = null;
  // landing controls
  thr = 0; tiltL = false; tiltR = false; up = false; down = false; landAcc = 0;
  showResult = false; landingOpen = false; lastFlight: any = null;
  constructor(public f: FieldUI, public H: Hopper) {}
  start() {
    const v = this.f.view!, home = this.H.W.site(this.H.s.site);
    v.focus({ x: home.p.x * 0.5, y: home.p.y * 0.5 }, 1.25);
    document.addEventListener('input', this.onInput);
  }
  onInput = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset || !el.dataset.in || this.f.hopView !== this) return;
    if (el.dataset.in === 'gamma') this.gamma = +el.value;
    if (el.dataset.in === 'prop') this.prop = +el.value * 1000;
    if (el.dataset.in === 'thr') this.thr = +el.value / 100;
    this.planKey = '';
    this.f.host.regions['f-bottom'] = '';
  };

  // ---------------------------------------------------------------- planning state
  site(id: string) { return this.H.W.site(id); }
  ensurePlan() {
    const H = this.H, s = H.s;
    if (s.flight || !this.dest || this.dest === s.site) { this.plan = null; return; }
    const key = [s.site, this.dest, this.gamma, this.prop, H.manifestKg(), s.prop, Object.keys(s.upg).join()].join('|');
    if (key === this.planKey) return;
    this.planKey = key;
    if (this.gamma === null) this.gamma = Math.round(H.bestGamma(this.dest));
    this.plan = H.plan(this.dest, this.gamma, this.prop);
    if (this.plan) {
      const h = H.spec(), arc = solveArc(H.body(), h.beta, H.W.elev(s.site), H.W.elev(this.dest), H.W.km(s.site, this.dest) * 1000, this.plan.arc.gamma, true);
      this.profile = arc.path;
    }
  }
  /** Furthest hop (km) with full tanks and the current manifest. */
  ensureReach() {
    const H = this.H, key = [H.s.site, H.manifestKg(), Object.keys(H.s.upg).join()].join('|');
    if (key === this.reachKey) return;
    this.reachKey = key;
    const h = H.spec(), b = H.body(), cargo = H.manifestKg();
    let lo = 5, hi = H.W.region.half * 2.4;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2, arc = solveArc(b, h.beta, 0, 0, m * 1000, 36 * Math.PI / 180);
      if (arc.ok && budget(b, h, arc, cargo, h.propCap).propAfter > 0) lo = m; else hi = m;
    }
    this.reach = lo;
  }

  // ---------------------------------------------------------------- frame
  frame(dt: number, t: number) {
    const H = this.H, fl = H.s.flight;
    H.tick(t);
    if (fl && !fl.result && t >= fl.tHandoff) {
      if (!this.landingOpen) { this.landingOpen = true; this.thr = 0; this.lastFlight = fl; }
      const step = this.controls(dt);
      this.landAcc += dt * 60;
      const n = Math.min(12, Math.floor(this.landAcc)); this.landAcc -= n;
      if (n) H.landTick(step, n, t);
      this.lastLand = H.liveLanding() || (H.lastResult ? { ...(this.lastLand as LandState), ...H.lastResult.d, z: 0, thr: 0, done: H.lastResult.d } : this.lastLand);
      if (!H.s.flight) { this.showResult = true; this.dest = null; this.gamma = null; this.prop = null; this.planKey = ''; this.f.persist(true); }
    }
    if (H.lastResult && !this.landingOpen && !this.showResult) {
      // Landed while nobody was watching: the computer flew it. Say how it went.
      const r = H.lastResult;
      this.f.host.toast('While you were away the computer landed at ' + r.dest + ': ' + KIND_WORD[r.d.kind].toLowerCase() + (r.earned ? ', paid ' + money(r.earned) : '') + '.', r.d.kind === 'pad' ? 'ok' : 'warn');
      H.lastResult = null;
    }
    if (this.landingOpen || this.showResult) {
      if (!this.showResult) this.lastLand = H.liveLanding() || this.lastLand;
      this.drawLanding(t);
      this.f.host.region('f-land', this.landingHTML(t));
      const wrap = document.getElementById('f-landwrap');
      if (wrap && wrap.hidden) wrap.hidden = false;
    }
  }
  controls(dt: number) {
    const rate = 1.5;
    if (this.up) this.thr = Math.min(1, this.thr + rate * dt);
    if (this.down) this.thr = Math.max(0, this.thr - rate * dt);
    return { throttle: this.thr, tilt: (this.tiltR ? 1 : 0) - (this.tiltL ? 1 : 0) };
  }
  onKey(k: string, down: boolean): boolean {
    if (!this.landingOpen) return false;
    switch (k) {
      case 'w': case 'arrowup': this.up = down; return true;
      case 's': case 'arrowdown': this.down = down; return true;
      case 'a': case 'arrowleft': this.tiltL = down; return true;
      case 'd': case 'arrowright': this.tiltR = down; return true;
      case ' ': case 'z': if (down) this.thr = 0; return true;
      case 'x': if (down) this.thr = 1; return true;
      case 'h': if (down) { const st = this.H.liveLanding(); if (st) this.thr = Math.min(1, (st.mass + st.prop) * this.H.body().g / this.H.spec().thrust); } return true;
      case 'c': if (down) this.H.setManual(!(this.H.s.flight?.manual ?? true)); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- map
  draw(ctx: CanvasRenderingContext2D, v: MapView, t: number) {
    ctx.save();
    const a0 = v.toScr({ x: -v.r.half, y: v.r.half }), b0 = v.toScr({ x: v.r.half, y: -v.r.half });
    ctx.beginPath(); ctx.rect(Math.max(v.box.x, a0.x), Math.max(v.box.y, a0.y), Math.min(v.box.x + v.box.w, b0.x) - Math.max(v.box.x, a0.x), Math.min(v.box.y + v.box.h, b0.y) - Math.max(v.box.y, a0.y)); ctx.clip();
    this.drawInner(ctx, v, t);
    ctx.restore();
  }
  private drawInner(ctx: CanvasRenderingContext2D, v: MapView, t: number) {
    const H = this.H, s = H.s, here = this.site(s.site);
    // Rival hops.
    for (const r of H.W.rivalFlights(t)) {
      const a = v.toScr(this.site(r.from).p), b = v.toScr(this.site(r.to).p), k = (t - r.t0) / r.tof;
      const col = H.L.rivals.find(x => x.id === r.rival)?.col || COL.dim;
      this.arcLine(ctx, a, b, col, 0.25, [3, 5]);
      const q = this.arcPoint(a, b, k);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Reach with full tanks and today's cargo.
    if (!s.flight) {
      this.ensureReach();
      const c = v.toScr(here.p);
      ctx.strokeStyle = 'rgba(47,214,181,.45)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(c.x, c.y, this.reach * v.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, 'Reach with full tanks: ' + Math.round(this.reach) + ' km', c.x, c.y - this.reach * v.scale - 10, 'rgba(47,214,181,.85)', 11, 500, 'center');
    }
    // Planned route or flight.
    const fl = s.flight;
    if (fl) {
      const a = v.toScr(this.site(fl.from).p), b = v.toScr(this.site(fl.to).p), w = H.where(t)!;
      this.arcLine(ctx, a, b, COL.teal, 0.9, []);
      const q = this.arcPoint(a, b, w.frac);
      chevron(ctx, q.x, q.y, Math.atan2(-(b.y - a.y), b.x - a.x), COL.teal, 11);
      label(ctx, PHASE_WORD[w.phase] + (w.h > 0 ? ' · ' + (w.h / 1000).toFixed(1) + ' km up' : ''), q.x + 14, q.y - 12, COL.teal, 12, 600);
    } else if (this.dest && this.dest !== s.site) {
      const a = v.toScr(here.p), b = v.toScr(this.site(this.dest).p), ok = this.plan?.b.ok;
      this.arcLine(ctx, a, b, ok ? COL.blue : COL.coral, 0.9, [6, 4]);
      const m = this.arcPoint(a, b, 0.5);
      label(ctx, Math.round(H.W.km(s.site, this.dest)) + ' km', m.x, m.y - 12, ok ? COL.blue : COL.coral, 12, 600, 'center');
    }
    // Sites. Labels go right of the marker unless another site sits close on that side.
    const jobsTo = new Set(s.manifest.map(j => j.to));
    const scr = H.W.sites.map(st => v.toScr(st.p));
    H.W.sites.forEach((st, i) => {
      const q = scr[i], isHere = st.id === s.site && !fl, sel = st.id === this.dest, hov = st.id === this.hoverSite;
      const left = scr.some((o, k) => k !== i && o.x > q.x && o.x - q.x < 170 && Math.abs(o.y - q.y) < 26 && (o.x < q.x + 170));
      const lx = left ? q.x - 10 : q.x + 10, al: CanvasTextAlign = left ? 'right' : 'left';
      const col = isHere ? COL.teal : jobsTo.has(st.id) ? COL.amber : sel ? COL.blue : COL.ink2;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(5,12,26,.9)'; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(q.x, q.y, isHere ? 7 : 5.5, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
      if (sel || hov) { ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, Math.PI * 2); ctx.stroke(); }
      label(ctx, st.name, lx, q.y - 1, col, isHere || sel ? 13 : 11.5, 600, al);
      label(ctx, st.kind + ' · fuel ' + money(H.L.price[st.id]) + '/t', lx, q.y + 12, 'rgba(169,191,223,.75)', 10, 500, al);
    });
  }
  private arcPoint(a: XY, b: XY, k: number): XY {
    const lift = Math.min(90, dist(a, b) * 0.22);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(Math.PI * k) * lift };
  }
  private arcLine(ctx: CanvasRenderingContext2D, a: XY, b: XY, col: string, alpha: number, dash: number[]) {
    ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineWidth = 1.5; ctx.setLineDash(dash);
    ctx.beginPath(); for (let k = 0; k <= 32; k++) { const p = this.arcPoint(a, b, k / 32); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  click(_p: XY, sx: number, sy: number) {
    const st = this.siteAt(sx, sy);
    if (!st) return;
    if (this.H.s.flight) return;
    if (st === this.H.s.site) { this.dest = null; this.tab = 'board'; }
    else { this.dest = st; this.gamma = null; this.prop = null; this.planKey = ''; }
    this.f.host.regions['f-bottom'] = ''; this.f.host.regions['f-right'] = '';
  }
  hover(_p: XY, sx: number, sy: number) { this.hoverSite = this.siteAt(sx, sy); if (this.f.cv) this.f.cv.style.cursor = this.hoverSite ? 'pointer' : 'grab'; }
  private siteAt(sx: number, sy: number) {
    const v = this.f.view!;
    let best: string | null = null, bd = 16;
    for (const st of this.H.W.sites) { const q = v.toScr(st.p), d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; best = st.id; } }
    return best;
  }

  // ---------------------------------------------------------------- panels
  goalHTML() {
    const H = this.H, dv = H.maxDv(), need = H.body().orbitDv;
    const k = H.orbitCapable() ? 1 : Math.min(0.99, dv / need);
    const txt = H.L.orbital ? 'Goal: fit an upper stage and reach orbit' : 'Goal: an empty hopper with ' + (need / 1000).toFixed(1) + ' km/s reaches orbit';
    return `<div class="gl"><span>${txt}</span><b class="num">${H.orbitCapable() ? 'Orbit-capable' : (dv / 1000).toFixed(2) + ' / ' + (need / 1000).toFixed(1) + ' km/s'}</b></div><div class="bar"><i style="width:${(k * 100).toFixed(1)}%"></i></div>`;
  }
  panels(t: number) {
    const H = this.H, s = H.s;
    const tabs = `<div class="tabs">${[['board', 'Board'], ['manifest', 'Cargo' + (s.manifest.length ? ' · ' + s.manifest.length : '')], ['hopper', 'Hopper'], ['log', 'Log']].map(([id, n]) => `<button class="${this.tab === id ? 'on' : ''}" data-act="hop-tab" data-v="${id}">${n}</button>`).join('')}</div>`;
    let body = '';
    const here = this.site(s.site);
    if (this.tab === 'board') {
      const jobs = s.flight ? [] : H.board(t);
      body = `<div class="k">${s.flight ? 'In flight' : 'Board at ' + esc(here.name)}</div>` + (s.flight ? '<p class="hint">The board is for the pad you are on. You will see the next one when you land.</p>' :
        jobs.length ? `<div class="list">${jobs.map(j => this.jobRow(j, t, true)).join('')}</div>` : '<p class="hint">Nothing posted right now. New jobs go up every few minutes.</p>') +
        `<p class="hint" style="margin-top:8px">Rival couriers (${H.L.rivals.map(r => `<span style="color:${r.col}">${esc(r.name)}</span>`).join(', ')}) take jobs that sit on the board too long.</p>`;
    } else if (this.tab === 'manifest') {
      const kg = H.manifestKg(), cap = H.spec().cargoCap;
      body = `<div class="k">Cargo aboard · ${(kg / 1000).toFixed(1)} of ${(cap / 1000).toFixed(0)} t</div>` + (s.manifest.length ? `<div class="list">${s.manifest.map(j => this.jobRow(j, t, false)).join('')}</div>` : '<p class="hint">Empty. Take jobs from the board.</p>');
    } else if (this.tab === 'hopper') {
      const h = H.spec(), dv = H.maxDv();
      const allUp = [...H.L.upgrades, ...(H.L.orbital ? [H.L.orbital] : [])];
      body = `<div class="k">${esc(H.L.hopper)}</div><div class="kv">
        <span>Dry mass</span><b class="num">${(h.dry / 1000).toFixed(1)} t</b>
        <span>Propellant</span><b class="num">${(s.prop / 1000).toFixed(1)} of ${(h.propCap / 1000).toFixed(0)} t</b>
        <span>Engine</span><b class="num">Isp ${Math.round(h.ve / 9.80665)} s · ${Math.round(h.thrust / 1000)} kN</b>
        <span>Cargo limit</span><b class="num">${(h.cargoCap / 1000).toFixed(0)} t</b>
        <span>Legs survive</span><b class="num">${h.legs.toFixed(1)} m/s</b>
        <span>Δv, empty, full tanks</span><b class="num">${(dv / 1000).toFixed(2)} km/s</b>
        <span>Condition</span><b class="num ${s.condition < 0.5 ? 'bad' : s.condition < 1 ? 'warn' : 'ok'}">${Math.round(s.condition * 100)}%</b></div>
        ${s.condition < 1 ? `<button class="btn ${s.condition < 0.5 ? 'primary' : ''} wide" data-act="hop-repair"${s.flight ? ' disabled' : ''}>Repair · ${money(H.repairCost())}</button>` : ''}
        <div class="k" style="margin-top:14px">Upgrades</div><div class="list">` + allUp.map(u => {
          const have = !!s.upg[u.id], lock = u.needs && !s.upg[u.needs];
          return `<div class="it"><div><b>${esc(u.name)}</b><span class="s">${esc(u.blurb)}</span></div><span class="pay num">${have ? '' : money(u.cost)}</span>${have ? '<span class="ok">Fitted</span>' : `<button class="btn slim" data-act="hop-buy" data-v="${u.id}"${lock || s.credits < u.cost || s.flight ? ' disabled' : ''}>Fit</button>`}</div>`;
        }).join('') + `</div><p class="hint" style="margin-top:8px">${s.hops} hops, ${s.pads} on the pad${s.bestLand !== null ? ', softest touchdown ' + s.bestLand.toFixed(2) + ' m/s' : ''}. Earned ${money(s.earned)}.</p>`;
    } else {
      body = s.log.length ? `<div class="flog">${s.log.map(l => `<p class="${l.kind}"><span class="num">${fmtClock(t - l.t)} ago</span>${esc(l.text)}</p>`).join('')}</div>` : '<p class="hint">Nothing yet.</p>';
    }
    this.f.host.region('f-right', tabs + `<div class="fscroll">${body}</div>`);
    this.f.host.region('f-bottom', s.flight ? this.flightHTML(t) : this.planHTML(t));
    this.f.host.region('f-legend', `<div class="lg"><i class="sw me"></i>You are here</div><div class="lg"><i class="sw amb"></i>Your cargo goes here</div><div class="lg"><i class="sw reach"></i>Reach with full tanks</div><div class="lg"><i class="sw riv"></i>Rival hops</div><p class="hint">Click a pad to plan a hop. Drag to pan, scroll to zoom.</p>`);
    const wrap = document.getElementById('f-landwrap');
    if (wrap) wrap.hidden = !(this.landingOpen || this.showResult);
  }
  private jobRow(j: Job, t: number, board: boolean) {
    const H = this.H, km = H.W.km(j.from, j.to), to = this.site(j.to);
    const left = j.deadline - t, tight = left < 900;
    const far = board && km > this.reach + 1;
    const act = board ? `<button class="btn slim" data-act="hop-accept" data-v="${esc(j.id)}">Take</button>` : `<button class="btn slim" data-act="hop-drop" data-v="${esc(j.id)}"${H.s.flight ? ' disabled' : ''}>Drop</button>`;
    return `<div class="it job${j.urgent ? ' urgent' : ''}"><div><b>${esc(j.cargo)}${j.own ? ' <em class="tag">contract</em>' : ''}${j.urgent ? ' <em class="tag u">urgent</em>' : ''}</b>
      <span class="s"><a data-act="hop-dest" data-v="${to.id}">→ ${esc(to.name)}</a> · ${Math.round(km)} km · ${(j.kg / 1000).toFixed(2)} t · <span class="num${tight ? ' warn' : ''}">due in ${fmtClock(left)}</span>${far ? ' · <span class="warn">beyond full-tank reach</span>' : ''}</span></div>
      <span class="pay num">${money(j.pay)}</span>${act}</div>`;
  }
  private planHTML(t: number) {
    const H = this.H, s = H.s, here = this.site(s.site);
    this.ensurePlan();
    if (!this.dest) {
      const dests = [...new Set(s.manifest.map(j => j.to))];
      return `<div class="pane fplan empty"><div class="k">Flight plan</div><p class="hint">${s.manifest.length ? 'Cargo aboard for ' + dests.map(d => `<a data-act="hop-dest" data-v="${d}">${esc(this.site(d).name)}</a>`).join(', ') + '. Click it here or on the map to plan the hop.' : 'Take a job from the board, then pick its destination on the map. You are at ' + esc(here.name) + '.'}</p>${s.condition < 0.5 ? '<p class="hint bad">The hopper needs repairs before it can fly (Hopper tab).</p>' : ''}</div>`;
    }
    const to = this.site(this.dest), p = this.plan, h = H.spec();
    if (!p) return `<div class="pane fplan"><div class="k">Flight plan · ${esc(here.name)} → ${esc(to.name)}</div><p class="hint bad">No arc reaches ${esc(to.name)} from here.</p></div>`;
    const b = p.b, carrying = s.manifest.filter(j => j.to === this.dest), other = s.manifest.filter(j => j.to !== this.dest);
    // The computer's landing burns about 1.3× an average pilot's.
    const compNeed = b.propLand * 1.3, after = b.propHandoff;
    const margin = after - compNeed, sharp = after - b.propLand * 0.7;
    const verdict = after <= 0 ? ['bad', 'Runs dry before the landing: this hop ends in a crash.']
      : sharp < 0 ? ['bad', 'Not enough to land, even flown perfectly.']
      : after < b.propLand ? ['warn', 'Only a sharp hand-flown landing makes it. The computer would run dry.']
      : margin < 0 ? ['warn', 'Enough for you, tight for the computer: fly the landing yourself.']
      : ['ok', 'Margin for either you or the computer to land.'];
    const loadT = (b.m0 - h.dry - H.manifestKg()) / 1000;
    const pay = carrying.reduce((a, j) => a + j.pay, 0);
    return `<div class="pane fplan"><div class="row" style="justify-content:space-between"><div class="k" style="margin:0">Flight plan · ${esc(here.name)} → ${esc(to.name)} · ${Math.round(p.arc.range / 1000)} km</div><button class="btn slim" data-act="hop-dest" data-v="">Close</button></div>
      <div class="pgrid"><div class="prof">${this.profileSVG()}</div>
      <div class="pctl">
        <label class="sl"><span>Launch angle <b class="num">${Math.round(p.gamma)}°</b></span><input type="range" min="18" max="76" step="2" value="${Math.round(p.gamma)}" data-in="gamma" aria-label="Launch angle"></label>
        <label class="sl"><span>Propellant load <b class="num">${loadT.toFixed(1)} t</b></span><input type="range" min="${(s.prop / 1000).toFixed(1)}" max="${(h.propCap / 1000).toFixed(1)}" step="0.1" value="${loadT.toFixed(1)}" data-in="prop" aria-label="Propellant load"></label>
        <div class="kv tight"><span>Flight to hand-off</span><b class="num">${fmtClock(b.tHandoff)}</b><span>Apogee</span><b class="num">${(p.arc.apogee / 1000).toFixed(0)} km</b><span>Δv climb · brake · land</span><b class="num">${Math.round(b.dvUp)} · ${Math.round(b.dvBrake)} · ~${Math.round(b.dvLand)} m/s</b>
        <span>Left at hand-off</span><b class="num ${verdict[0]}">${(after / 1000).toFixed(2)} t</b><span>Landing needs</span><b class="num">you ~${(b.propLand / 1000).toFixed(2)} t · computer ~${(compNeed / 1000).toFixed(2)} t</b></div>
        <p class="hint ${verdict[0]}">${verdict[1]}</p>
      </div>
      <div class="pgo"><div class="kv tight"><span>Cargo for ${esc(to.name)}</span><b class="num">${carrying.length} job${carrying.length === 1 ? '' : 's'} · ${money(pay)}</b>${other.length ? `<span>Also aboard</span><b class="num">${(other.reduce((a, j) => a + j.kg, 0) / 1000).toFixed(1)} t for elsewhere</b>` : ''}<span>Buy propellant</span><b class="num">${(p.refuel / 1000).toFixed(1)} t · ${money(p.cost)}</b></div>
        <button class="btn primary big wide" data-act="hop-launch"${s.condition < 0.5 || s.credits < p.cost ? ' disabled' : ''}>Launch</button>
        ${s.credits < p.cost ? '<p class="hint bad">Not enough money for that propellant.</p>' : s.condition < 0.5 ? '<p class="hint bad">Needs repairs first.</p>' : carrying.length ? '' : '<p class="hint">No cargo for this pad: a repositioning hop.</p>'}</div></div></div>`;
  }
  private profileSVG() {
    const H = this.H, W = 330, Hh = 128, path = this.profile;
    if (!path.length) return '';
    const range = path[path.length - 1].s || 1, apo = Math.max(...path.map(q => q.h)), top = apo * 1.15 + 1000;
    const from = this.site(H.s.site), to = this.site(this.dest!);
    const X = (sv: number) => 8 + sv / range * (W - 16), Y = (h: number) => Hh - 18 - h / top * (Hh - 34);
    // Terrain under the route, exaggerated so you can see it.
    let ground = '';
    const ex = H.L.id === 'mars' ? 6 : 1;
    for (let k = 0; k <= 60; k++) {
      const q = { x: from.p.x + (to.p.x - from.p.x) * k / 60, y: from.p.y + (to.p.y - from.p.y) * k / 60 };
      const hh = H.L.id === 'mars' ? H.W.region.heightAt(q.x, q.y) : Math.max(0, H.W.region.heightAt(q.x, q.y));
      ground += (k ? 'L' : 'M') + X(range * k / 60).toFixed(1) + ' ' + Math.min(Hh - 4, Y(hh * ex)).toFixed(1);
    }
    const arc = path.map((q, i) => (i ? 'L' : 'M') + X(q.s).toFixed(1) + ' ' + Y(q.h).toFixed(1)).join('');
    const apoP = path.reduce((a, b) => b.h > a.h ? b : a);
    return `<svg viewBox="0 0 ${W} ${Hh}" class="profsvg" role="img" aria-label="Side view of the planned arc">
      <path d="${ground}L${X(range)} ${Hh}L${X(0)} ${Hh}Z" fill="rgba(106,168,255,.08)" stroke="rgba(106,168,255,.35)" stroke-width="1"/>
      <path d="${arc}" fill="none" stroke="#4da3ff" stroke-width="1.6"/>
      <line x1="${X(apoP.s)}" x2="${X(apoP.s)}" y1="${Y(apoP.h)}" y2="${Hh - 18}" stroke="rgba(106,168,255,.3)" stroke-dasharray="2 3"/>
      <text x="${X(apoP.s)}" y="${Y(apoP.h) - 6}" text-anchor="middle" class="t">${(apoP.h / 1000).toFixed(0)} km</text>
      <text x="8" y="${Hh - 4}" class="t">${esc(from.name)}</text><text x="${W - 8}" y="${Hh - 4}" text-anchor="end" class="t">${esc(to.name)}</text>
      ${H.L.id === 'mars' ? `<text x="${W - 8}" y="12" text-anchor="end" class="t dim">ground ×${ex}</text>` : ''}</svg>`;
  }
  private flightHTML(t: number) {
    const H = this.H, fl = H.s.flight!, w = H.where(t)!;
    const prog = Math.min(1, (t - fl.t0) / (fl.tHandoff - fl.t0));
    return `<div class="pane fplan flying"><div class="k">${esc(this.site(fl.from).name)} → ${esc(this.site(fl.to).name)} · ${PHASE_WORD[w.phase]}</div>
      <div class="pgrid"><div class="prof">${this.flightProfileSVG(w.k)}</div>
      <div class="pctl"><div class="kv tight"><span>Hand-off in</span><b class="num big">${t < fl.tHandoff ? fmtClock(fl.tHandoff - t) : 'now'}</b><span>Height</span><b class="num">${(w.h / 1000).toFixed(1)} km</b><span>Cargo</span><b class="num">${(fl.cargo / 1000).toFixed(1)} t</b><span>Propellant at hand-off</span><b class="num">${(fl.propHandoff / 1000).toFixed(2)} t</b></div>
      <div class="bar"><i style="width:${(prog * 100).toFixed(1)}%"></i></div></div>
      <div class="pgo"><p class="hint">At ${HANDOFF_ALT.toLocaleString('en-US')} m the computer hands the descent to you.</p>
      <div class="switch${fl.manual ? '' : ' on'}" data-act="hop-auto" role="switch" aria-checked="${!fl.manual}"><i></i>Let the computer land it</div></div></div></div>`;
  }
  private flightProfileSVG(k: number) {
    const fl = this.H.s.flight!, W = 330, Hh = 128, path = fl.path;
    if (!path.length) return '';
    const range = path[path.length - 1].s || 1, top = Math.max(...path.map(q => q.h)) * 1.15 + 1000;
    const X = (sv: number) => 8 + sv / range * (W - 16), Y = (h: number) => Hh - 18 - h / top * (Hh - 34);
    const arc = path.map((q, i) => (i ? 'L' : 'M') + X(q.s).toFixed(1) + ' ' + Y(q.h).toFixed(1)).join('');
    const tt = k * fl.tof; let p = path[0]; for (const q of path) { if (q.t > tt) break; p = q; }
    return `<svg viewBox="0 0 ${W} ${Hh}" class="profsvg"><line x1="8" x2="${W - 8}" y1="${Hh - 18}" y2="${Hh - 18}" stroke="rgba(106,168,255,.35)"/><path d="${arc}" fill="none" stroke="rgba(47,214,181,.5)" stroke-width="1.4" stroke-dasharray="3 3"/><circle cx="${X(p.s)}" cy="${Y(p.h)}" r="4.5" fill="#2fd6b5"/></svg>`;
  }

  // ---------------------------------------------------------------- landing view
  private landingHTML(t: number) {
    const H = this.H;
    if (this.showResult) {
      const r = this.lastResultCache || H.lastResult;
      if (r) this.lastResultCache = r;
      if (!r) return '';
      const d = r.d, good = d.kind === 'pad', bad = d.kind === 'crash' || d.kind === 'hard';
      const used = (this.lastFlight?.propHandoff ?? 0) - d.prop;
      return `<div class="pane lres"><div class="k">${r.auto ? 'Computer landing' : 'Your landing'} · ${esc(r.dest)}</div><h2 class="${good ? 'ok' : bad ? 'bad' : 'warn'}">${KIND_WORD[d.kind]}</h2>
        <div class="kv"><span>Touchdown</span><b class="num">${Math.abs(d.vz).toFixed(2)} m/s down · ${Math.abs(d.vx).toFixed(2)} m/s across</b><span>From the pad centre</span><b class="num">${Math.abs(d.x).toFixed(0)} m</b><span>Propellant used landing</span><b class="num">${Math.max(0, used).toFixed(0)} kg</b><span>Left in the tanks</span><b class="num">${(d.prop / 1000).toFixed(2)} t</b><span>Paid</span><b class="num pay">${money(r.earned)}</b></div>
        ${d.kind === 'hard' ? `<p class="hint warn">The legs took it hard. Repairs: ${money(H.repairCost())} (Hopper tab).</p>` : d.kind === 'crash' ? `<p class="hint bad">The hopper is wrecked and the cargo is lost, with penalties. Repairs: ${money(H.repairCost())}.</p>` : ''}
        <button class="btn primary big wide" data-act="hop-result">Continue</button></div>`;
    }
    if (!this.landingOpen) return '';
    const st = H.liveLanding(), fl = H.s.flight;
    if (!st || !fl) return '';
    const h = H.spec(), m = st.mass + st.prop, burn = st.prop / (h.thrust / h.ve), legs = h.legs;
    const vzc = Math.abs(st.vz) <= legs ? 'ok' : Math.abs(st.vz) <= legs * 2 ? 'warn' : 'bad';
    const vxc = Math.abs(st.vx) <= 2 ? 'ok' : Math.abs(st.vx) <= 5 ? 'warn' : 'bad';
    const xc = Math.abs(st.x) <= PAD_HALF ? 'ok' : Math.abs(st.x) <= NEAR ? 'warn' : 'bad';
    const twr = h.thrust / (m * H.body().g);
    return `<div class="lhud"><div class="lk">Landing · ${esc(this.site(fl.to).name)} · ${fl.manual ? 'you have control' : 'the computer is flying'}</div>
      <div class="kv"><span>Height</span><b class="num big">${st.z.toFixed(0)} m</b><span>Falling</span><b class="num big ${vzc}">${(-st.vz).toFixed(1)} m/s</b><span>Sideways</span><b class="num ${vxc}">${st.vx.toFixed(1)} m/s</b><span>From pad</span><b class="num ${xc}">${st.x >= 0 ? '+' : '−'}${Math.abs(st.x).toFixed(0)} m</b>
      <span>Throttle</span><b class="num">${Math.round(st.thr * 100)}%</b><span>Tilt</span><b class="num">${(st.ang * 180 / Math.PI).toFixed(0)}°</b><span>Propellant</span><b class="num ${burn < 6 ? 'bad' : burn < 15 ? 'warn' : ''}">${st.prop.toFixed(0)} kg · ${burn.toFixed(0)} s</b><span>Thrust/weight</span><b class="num">${twr.toFixed(2)}</b></div>
      <p class="hint">Touch down under ${legs.toFixed(1)} m/s, upright, on the ${PAD_HALF * 2} m pad.</p>
      <div class="lkeys"><span><kbd>W</kbd><kbd>S</kbd> throttle</span><span><kbd>A</kbd><kbd>D</kbd> tilt</span><span><kbd>H</kbd> hover · <kbd>X</kbd> full · <kbd>Space</kbd> cut</span><span><kbd>C</kbd> computer</span></div>
      <button class="btn wide${fl.manual ? '' : ' on'}" data-act="hop-auto">${fl.manual ? 'Hand over to the computer' : 'Take back control'}</button></div>
      <div class="ltouch"><div class="tl"><button class="tb" data-hold="tl" aria-label="Tilt left">◀</button><button class="tb" data-hold="tr" aria-label="Tilt right">▶</button></div><div class="tcol"><button class="tb" data-hold="up" aria-label="More throttle">▲</button><button class="tb" data-hold="dn" aria-label="Less throttle">▼</button></div></div>`;
  }
  lastResultCache: any = null;
  /** The landing as last drawn, kept after touchdown so the scene stays on screen under the result. */
  lastLand: LandState | null = null;
  /** The side view of the landing, drawn on its own canvas under the HUD. */
  drawLanding(_t: number) {
    const wrap = document.getElementById('f-landwrap'), cv = document.getElementById('f-lcv') as HTMLCanvasElement | null;
    if (!wrap || !cv || !(this.landingOpen || this.showResult)) return;
    this.bindTouch(wrap);
    const st = this.H.liveLanding() || this.lastLand; if (!st) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = window.innerWidth, Hh = window.innerHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mars = this.H.L.id === 'mars';
    // Camera: follow the hopper, zooming in as it nears the ground.
    // Keep the hopper and the pad both in frame, and zoom in as they close.
    const span = Math.max(60, Math.min(2200, Math.max(st.z * 1.25 + 45, (Math.abs(st.x) + 40) * 2.4 * Hh / W))), sc = Hh / span;
    const cxm = st.x * 0.5, gy = Hh * 0.84, X = (x: number) => W / 2 + (x - cxm) * sc, Y = (z: number) => gy - z * sc;
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    if (mars) { sky.addColorStop(0, '#1b0f0c'); sky.addColorStop(1, '#5a3424'); } else { sky.addColorStop(0, '#08162e'); sky.addColorStop(1, '#3d6a9a'); }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, gy);
    // Ground with a little texture, and the pad.
    ctx.fillStyle = mars ? '#6d3c26' : '#1f3a2e'; ctx.fillRect(0, gy, W, Hh - gy);
    ctx.strokeStyle = mars ? 'rgba(255,190,150,.18)' : 'rgba(180,230,200,.15)'; ctx.lineWidth = 1;
    const tick = span > 900 ? 100 : span > 300 ? 50 : 10;
    for (let x = Math.floor((cxm - W / 2 / sc) / tick) * tick; x < cxm + W / 2 / sc; x += tick) { ctx.beginPath(); ctx.moveTo(X(x), gy); ctx.lineTo(X(x), gy + (x % (tick * 5) === 0 ? 10 : 5)); ctx.stroke(); }
    ctx.fillStyle = '#9fb3c8'; ctx.fillRect(X(-PAD_HALF), gy - 3, PAD_HALF * 2 * sc, 4);
    ctx.fillStyle = '#ffb13d'; for (const x of [-PAD_HALF, PAD_HALF]) { ctx.beginPath(); ctx.arc(X(x), gy - 4, 2.5, 0, Math.PI * 2); ctx.fill(); }
    label(ctx, 'PAD', X(0), gy + 14, '#cfe3ff', 11, 600, 'center');
    // Hopper: 4.5 m wide, 15 m tall, legs, and the flame.
    const hx = X(st.x), hz = Y(st.z), bw = Math.max(5, 4.5 * sc), bh = Math.max(14, 15 * sc);
    ctx.save(); ctx.translate(hx, hz); ctx.rotate(st.ang);
    if (st.thr > 0.01 && st.prop > 0) {
      const fl = (8 + 26 * st.thr) * Math.max(1, sc * 0.5) * (0.9 + 0.2 * Math.random());
      const g = ctx.createLinearGradient(0, 0, 0, fl); g.addColorStop(0, 'rgba(255,240,200,.95)'); g.addColorStop(0.4, 'rgba(255,170,80,.75)'); g.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-bw * 0.3, 0); ctx.lineTo(bw * 0.3, 0); ctx.lineTo(0, fl); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#d9e6f5'; ctx.strokeStyle = '#0a1830'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-bw / 2, 0); ctx.lineTo(-bw / 2, -bh * 0.8); ctx.lineTo(0, -bh); ctx.lineTo(bw / 2, -bh * 0.8); ctx.lineTo(bw / 2, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#9fb3c8'; ctx.lineWidth = Math.max(1, sc * 0.4);
    ctx.beginPath(); ctx.moveTo(-bw / 2, -bh * 0.15); ctx.lineTo(-bw * 0.95, 0); ctx.moveTo(bw / 2, -bh * 0.15); ctx.lineTo(bw * 0.95, 0); ctx.stroke();
    ctx.restore();
    // Velocity vector and where it would hit with the engine off.
    ctx.strokeStyle = 'rgba(79,210,255,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(hx, hz); ctx.lineTo(hx + st.vx * 2.2, hz - st.vz * 2.2); ctx.stroke();
    if (!st.done && st.vz < 0) {
      const g = this.H.body().g, tHit = (st.vz + Math.sqrt(st.vz * st.vz + 2 * g * st.z)) / g, xi = st.x + st.vx * tHit;
      ctx.strokeStyle = 'rgba(255,107,90,.8)'; ctx.beginPath(); ctx.moveTo(X(xi) - 6, gy - 6); ctx.lineTo(X(xi) + 6, gy + 6); ctx.moveTo(X(xi) + 6, gy - 6); ctx.lineTo(X(xi) - 6, gy + 6); ctx.stroke();
    }
    // Throttle and tilt gauges on the left.
    const gx = 26, gh = Hh * 0.38, gt = Hh * 0.3;
    ctx.strokeStyle = 'rgba(106,168,255,.6)'; ctx.strokeRect(gx, gt, 14, gh);
    ctx.fillStyle = '#ffb13d'; ctx.fillRect(gx + 1, gt + gh * (1 - st.thr), 12, gh * st.thr);
    const hover = (st.mass + st.prop) * this.H.body().g / this.H.spec().thrust;
    if (hover < 1) { ctx.strokeStyle = '#2fd6b5'; ctx.beginPath(); ctx.moveTo(gx - 4, gt + gh * (1 - hover)); ctx.lineTo(gx + 18, gt + gh * (1 - hover)); ctx.stroke(); label(ctx, 'hover', gx + 22, gt + gh * (1 - hover), '#2fd6b5', 10, 600); }
    label(ctx, 'THR', gx + 7, gt - 10, '#a9bfdf', 10, 600, 'center');
    ctx.save(); ctx.translate(gx + 7, gt + gh + 34); ctx.strokeStyle = 'rgba(106,168,255,.5)'; ctx.beginPath(); ctx.arc(0, 0, 18, Math.PI, 0); ctx.stroke();
    ctx.rotate(st.ang); ctx.strokeStyle = '#4fd2ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -18); ctx.stroke(); ctx.restore();
    label(ctx, 'TILT ±' + Math.round(MAX_TILT * 180 / Math.PI) + '°', gx + 7, gt + gh + 46, '#a9bfdf', 10, 600, 'center');
  }
  private touchBound: HTMLElement | null = null;
  private bindTouch(host: HTMLElement) {
    if (this.touchBound === host) return;
    this.touchBound = host;
    const set = (k: string, on: boolean) => { if (k === 'up') this.up = on; if (k === 'dn') this.down = on; if (k === 'tl') this.tiltL = on; if (k === 'tr') this.tiltR = on; };
    host.addEventListener('pointerdown', e => { const b = (e.target as HTMLElement).closest('[data-hold]') as HTMLElement | null; if (b) { e.preventDefault(); set(b.dataset.hold!, true); b.setPointerCapture(e.pointerId); } });
    const off = (e: PointerEvent) => { const b = (e.target as HTMLElement).closest('[data-hold]') as HTMLElement | null; if (b) set(b.dataset.hold!, false); };
    host.addEventListener('pointerup', off); host.addEventListener('pointercancel', off);
  }

  act(a: string, v: string, t: number): boolean {
    const H = this.H;
    const err = (e: string | null) => { if (e) this.f.host.toast(e, 'warn'); };
    switch (a) {
      case 'hop-tab': this.tab = v; return true;
      case 'hop-accept': {
        err(H.accept(v, t));
        // Plan toward the job's destination straight away if nothing is planned.
        const j = H.s.manifest.find(x => x.id === v);
        if (j && !this.dest) { this.dest = j.to; this.gamma = null; this.prop = null; this.planKey = ''; }
        return true;
      }
      case 'hop-drop': H.drop(v, t); this.planKey = ''; return true;
      case 'hop-dest': this.dest = v || null; this.gamma = null; this.prop = null; this.planKey = ''; this.f.host.regions['f-bottom'] = ''; return true;
      case 'hop-launch': {
        this.lastLand = null;
        if (!this.dest || !this.plan) return true;
        const e = H.launch(this.dest, this.plan.gamma, this.prop ?? (this.plan.b.m0 - H.spec().dry - H.manifestKg()), t);
        err(e);
        if (!e) { this.tab = 'manifest'; this.landingOpen = false; this.showResult = false; this.lastResultCache = null; this.f.persist(true); }
        this.f.host.regions['f-bottom'] = '';
        return true;
      }
      case 'hop-auto': H.setManual(!(H.s.flight?.manual ?? true)); return true;
      case 'hop-result': this.showResult = false; this.landingOpen = false; this.lastResultCache = null; H.lastResult = null; this.tab = 'board'; { const w = document.getElementById('f-landwrap'); if (w) w.hidden = true; } return true;
      case 'hop-repair': err(H.repair(t)); return true;
      case 'hop-buy': err(H.buy(v, t)); this.planKey = ''; this.reachKey = ''; return true;
    }
    return false;
  }
}
