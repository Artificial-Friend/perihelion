// The interface: title, founding, and the main HUD whose panels change with the stage
// (layer) you are looking at. Panels re-render a few times a second from game state.
import * as THREE from 'three/webgpu';
import { core, V, R_EARTH } from '../sim/core';
import { fmtWorldDate } from '../sim/clock';
import { Game, SPONSORS, CREW, STAGES } from '../game/game';
import { WorldScene, PLANETS } from '../world/scene';
import { FreeCamera, fmtScale } from '../world/camera';
import { Gfx } from '../render/gfx';
import { HangarView } from '../render/hangar';
import { MODULES, RESEARCH, LAUNCH_COST, STAGE1_TOTAL, SITES, START_CREDITS } from '../game/ground';
import { CONTRACTS, HAVEN } from '../game/orbit';
import { PORTS, portById, board, tripPlans, portHelio, bodyHelioPos, TripPlan } from '../game/haul';
import { SITES4, MODS, modById, POLICIES, Policy } from '../game/sovereign';
import { esc, money, fmtClock, fmtDur, fmtM, gcDistKm } from '../game/util';
import { Overlay, OvFocus, OvLabel, OvCallout } from './overlay';
import * as C from './charts';
import { morph } from './morph';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z" fill="currentColor"/></svg>';
const PLAN_COL: Record<string, string> = { fast: '#ff6b5a', balanced: '#4da3ff', efficient: '#2fd6b5', economy: '#2fd6b5', cruise: '#4da3ff', sprint: '#ffb13d', stasis: '#b48cff' };

export class UI {
  scr = 'title';
  regions: Record<string, string> = {};
  coName = ''; shipName = ''; sponsor = 'us';
  acc = 0;
  tab = 'passes';
  hangarOpen = false;
  hangar: HangarView;
  ov = new Overlay();
  seenNotes = 0;
  sel3: string | null = null; // Stage 3: chosen contract id or 'go:<port>'
  selSlot: number | null = null;
  claimSite = 'l4';
  dev = new URLSearchParams(location.search).has('dev');

  constructor(public game: Game, public world: WorldScene, public cam: FreeCamera, public gfx: Gfx) {
    this.hangar = new HangarView(gfx.renderer);
    this.hangar.resize(gfx.W, gfx.H);
    window.addEventListener('resize', () => this.hangar.resize(window.innerWidth, window.innerHeight));
    cam.setDist(26000, true);
    this.bindInput();
    this.set('title');
    game.onNet = () => { if (this.scr === 'title') this.set('title'); };
  }
  get renderHangar() { return this.hangarOpen && this.scr === 'main'; }

  set(s: string) { this.scr = s; this.regions = {}; $('#ui').innerHTML = (this as any)['v_' + s](); this.tick(0, true); }
  region(id: string, html: string) {
    if (this.regions[id] === html) return;
    const el = document.getElementById(id); if (!el) return;
    this.regions[id] = html; morph(el, html);
  }
  toast(text: string, kind = '') {
    const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = text;
    $('#toasts').appendChild(d); setTimeout(() => d.remove(), 5500);
  }
  modal(html: string) { $('#mcard').innerHTML = html; $('#modal').hidden = false; }
  closeModal() { $('#modal').hidden = true; }
  av(id: string) { const c = CREW.find(x => x.id === id)!; return `<span class="av" style="--c:${c.tint}"><i>${c.name.split(' ').map(w => w[0]).join('')}</i></span>`; }

  // ---------- screens ----------
  v_title() {
    const co = this.game.company;
    return `<section class="screen title"><div class="scrim"></div><div class="wrap">
      <div>${C.vitruvian()}</div>
      <div>
        <h1>PERI<b>HELION</b></h1>
        <p class="lede">2060. Start on the ground with a control room, a hangar and a loan. Earn your first ship, launch it, and grow from salvage tug to interplanetary carrier to a state of your own, in one shared solar system running in real time.</p>
        <div class="row">${co ? `<button class="btn primary big" data-act="cont">Continue as ${esc(co.name)}</button><button class="btn big" data-act="new">New company</button>` : `<button class="btn primary big" data-act="new">Found your company</button>`}</div>
        <div class="devjump"><div class="k">Development build: start at any stage</div><div class="stg">
          ${STAGES.slice(0, 4).map(s => `<button style="--c:${s.col}" data-act="devjump" data-v="${s.n}"><b>${s.n}</b><span>${s.name}</span></button>`).join('')}
        </div><p class="hint" style="margin-top:6px;font-size:12px">Stage 5 (interstellar) is still in design.</p></div>
        <div class="meta"><span class="${this.gfx.backend === 'WebGPU' ? 'gpu' : ''}">${this.gfx.backend}</span><span data-b="online">…</span></div>
      </div></div>
      <div class="title-foot">Earth imagery: NASA Blue Marble and Black Marble. The world clock runs at real time for every commander.</div></section>`;
  }
  v_found() {
    return `<section class="screen found"><div class="pane"><h2>Found your company</h2><p class="hint">It is 2060. Your licence decides where your base is.</p>
      <div class="fields"><div class="field"><label for="coName">Company</label><input id="coName" maxlength="28" placeholder="Meridian Orbital Salvage" value="${esc(this.coName)}"></div>
      <div class="field"><label for="shipName">First ship</label><input id="shipName" maxlength="20" placeholder="Halyard" value="${esc(this.shipName)}"></div></div>
      <div class="sponsors">${Object.values(SPONSORS).map(s => `<button class="sp${s.id === this.sponsor ? ' sel' : ''}" style="--c:${s.color}" data-act="sponsor" data-v="${s.id}"><span class="flag">${s.id.toUpperCase()} licence</span><b>${s.name}</b><span class="ag">${s.agency}</span><p>${s.blurb}</p><div class="perk">${s.perk}</div></button>`).join('')}</div>
      <div class="go"><button class="btn primary big" data-act="found">Sign the licence</button><button class="btn" data-act="back">Back</button></div></div></section>`;
  }
  v_main() {
    return `<section class="screen main"><header class="top" id="r-top"></header>
      <div class="leftcol"><div class="pane goal" id="r-goal"></div><div id="r-left2"></div><div class="say-wrap" id="r-say"></div></div>
      <div class="pane rightcol" id="r-right"></div>
      <div class="devtray" id="r-dev"></div>
      <div class="pane focusbar" id="r-focus"></div></section>`;
  }

  // ---------- per-frame ----------
  tick(dt: number, force = false) {
    this.acc += dt;
    if (this.renderHangar) this.hangar.step(dt);
    this.drawOverlay();
    const ns = this.game.notes;
    while (this.seenNotes < ns.length) { const n = ns[this.seenNotes++]; this.toast(n.text, n.kind); }
    if (!force && this.acc < 0.25) return;
    this.acc = 0;
    if (this.scr === 'title') document.querySelectorAll('[data-b=online]').forEach(e => e.textContent = this.game.net?.online ? 'Shared world online' : 'Single player');
    if (this.scr === 'main' && this.game.save) this.mainTick();
  }

  mainTick() {
    const g = this.game, s = g.save!, co = s.company, t = g.now(), sp = SPONSORS[co.sponsor];
    this.region('r-top', `<div class="co">${C.emblem(sp.color)}<div><b>${esc(co.name)}</b><span>${esc(SITES[co.sponsor].name)} · ${sp.id.toUpperCase()} licence</span></div></div>
      <div class="track">${C.stageTrack(STAGES, s.unlocked, s.layer)}</div>
      <div class="stat">World time<b class="num">${fmtWorldDate(t).slice(11)}</b></div>
      <div class="stat money">Credits<b class="num">${money(co.credits)}</b></div>
      <span class="pill${g.net?.online ? '' : ' off'}"><i></i>${g.net?.online ? (g.net.onlineCount() + 1) + ' online' : 'Offline'}</span>
      <button class="btn slim" data-act="help" aria-label="Help">?</button>`);
    this.region('r-goal', this.goalHTML());
    this.region('r-left2', s.layer === 1 && !this.hangarOpen ? `<div class="pane hcard">${this.hangarCardHTML(t)}</div>` : '');
    const now = performance.now();
    this.region('r-say', g.barks.filter(b => now - b.t < 9000).slice(-2).map(b => {
      const c = CREW.find(x => x.id === b.who)!;
      return `<div class="say" style="--c:${c.tint}">${this.av(b.who)}<p><b>${c.name.split(' ')[0]}</b>${esc(b.text)}</p></div>`;
    }).join(''));
    let right = '';
    if (s.layer === 1) right = this.hangarOpen ? this.hangarHTML(t) : this.controlRoomHTML(t);
    else if (s.layer === 2) right = g.op ? this.opHTML(t) : this.contractsHTML();
    else if (s.layer === 3) right = this.haulHTML(t);
    else right = this.sovHTML(t);
    this.region('r-right', right);
    this.region('r-focus', this.focusHTML());
    this.region('r-dev', s.dev || this.dev ? this.devHTML() : '');
    if (g.op && g.op.ended && !g.op.shown) { g.op.shown = true; setTimeout(() => this.debrief(), 1400); }
    if (this.hangarOpen) this.hangar.setBuilt(Object.fromEntries(MODULES.map(m => [m.id, g.ground!.done('build', m.id, t)])), g.ground!.inProgress('build', t));
    this.intro(s.layer);
  }

  intro(layer: number) {
    const s = this.game.save! as any;
    s.seen ??= {};
    if (s.seen[layer] || !$('#modal').hidden) return;
    s.seen[layer] = 1;
    const txt: Record<number, [string, string, string]> = {
      1: ['taras', 'Stage 1 · On the ground', `<p>We have a control room, a hangar and a loan of <b>${money(START_CREDITS)}</b>. The goal is simple: <b>build the five modules of our first ship and pay for its launch</b>, ${money(STAGE1_TOTAL)} in all.</p><p>Money comes from two jobs. <b>Book satellite passes</b> in the control room and we're paid when the downlink finishes. When a <b>booster comes down at sea</b>, send the boat early and re-target it as the landing prediction tightens.</p><p>Everything runs in real time. Start a module, book a pass, and the work carries on while you look away. The panel on the left always says what to do next.</p>`],
      2: ['sofia', 'Stage 2 · Orbit', '<p>We\'re in orbit beside Haven Commercial. Take contracts from the board: I work out the flight plans, you pick one, and I fly it. When we\'re holding next to the target, you give the order to grapple.</p><p>Finish all three contracts to earn an interplanetary licence.</p>'],
      3: ['kwame', 'Stage 3 · Interplanetary', '<p>The torch ship is fuelled at Haven. Pick a cargo contract, then a flight plan. Awake crews fly slower but can defend the ship. Stasis is fast, but only the computer is watching.</p><p>Trips take real time, minutes to the Moon and days to Mars, so you can manage the other stages while we fly. Deliver four cargoes to earn the right to claim territory.</p>'],
      4: ['kwame', 'Stage 4 · Sovereign', '<p>Choose a site, plant a flag and build a station ring. Trade policy decides how rich and how dangerous we are. Raiders show up on the sensors only once they\'re in range, so sensors buy time and point defence buys safety.</p>'],
    };
    const [who, title, body] = txt[layer];
    const c = CREW.find(x => x.id === who)!;
    setTimeout(() => this.modal(`<div class="mhead">${this.av(who)}<div><b>${c.name}</b><span>${c.role}</span></div></div><h2>${title}</h2>${body}<div class="mfoot"><button class="btn primary big" data-act="close">Let's go</button></div>`), 500);
  }

  goalHTML() {
    const o = this.game.objective(), s = this.game.save!;
    const col = STAGES[s.layer - 1].col;
    let h = `<div class="gh">${C.ring(o.progress, 54, col)}<div><div class="k" style="margin:0">Stage ${s.layer} goal</div><h3>${esc(o.title)}</h3></div></div><ul>`;
    for (const st of o.steps) h += `<li class="${st.done ? 'done' : ''}"><span><i class="tick"></i>${esc(st.text)}</span><em class="num">${esc(st.val)}</em></li>`;
    h += '</ul>';
    if (s.layer === 1 && !this.game.ground!.s.launched) {
      const co = s.company, need = o.need, k = Math.min(1, co.credits / Math.max(1, need));
      h += `<div class="money-bar"><div class="lbl"><span>Money for what's left</span><span class="num">${money(co.credits)} / ${money(need)}</span></div><div class="bar"><i style="width:${(k * 100).toFixed(1)}%"></i></div>${o.short > 0 ? `<div class="lbl"><span>Still to earn</span><span class="num" style="color:var(--amber)">${money(o.short)}</span></div>` : ''}</div>`;
    }
    return h + `<div class="next"><b>Next</b>${esc(o.next)}</div>`;
  }

  // ---------- Stage 1 ----------
  hangarCardHTML(t: number) {
    const g = this.game.ground!, busy = g.inProgress('build', t), ready = g.shipReady(t);
    const segs = MODULES.map(m => g.done('build', m.id, t) ? 1 : busy === m.id ? 0.5 : 0);
    let ringSvg = '<svg width="58" height="58" viewBox="0 0 58 58">';
    segs.forEach((v, i) => {
      const a0 = -Math.PI / 2 + i / 5 * Math.PI * 2 + 0.06, a1 = a0 + Math.PI * 2 / 5 - 0.12, r = 24;
      const col = v === 1 ? '#2fd6b5' : v ? '#4fd2ff' : 'rgba(106,168,255,.25)';
      ringSvg += `<path d="M${29 + Math.cos(a0) * r} ${29 + Math.sin(a0) * r}A${r} ${r} 0 0 1 ${29 + Math.cos(a1) * r} ${29 + Math.sin(a1) * r}" fill="none" stroke="${col}" stroke-width="4"/>`;
    });
    ringSvg += `<text x="29" y="34" text-anchor="middle" fill="#e4eeff" font-size="14" font-family="Saira Semi Condensed" font-weight="600">${g.builtCount(t)}/5</text></svg>`;
    const job = busy ? MODULES.find(m => m.id === busy)! : null;
    return `<div class="k">Hangar</div><div class="row" style="flex-wrap:nowrap;gap:12px">${ringSvg}<div><h3>${esc(this.game.company!.ship)}</h3><p class="hint">${ready ? (g.s.launched ? 'In orbit.' : 'Ready to fly. A ride to orbit costs ' + money(LAUNCH_COST) + '.') : job ? job.name + ' · ' + fmtClock(g.s.build[busy!].end - t) + ' left' : 'No work in progress.'}</p></div></div>
      <div class="row" style="margin-top:10px"><button class="btn ${ready ? '' : 'primary'}" data-act="openhangar">Open the hangar</button>${ready && !g.s.launched ? '<button class="btn primary" data-act="launch">Launch to orbit</button>' : ''}</div>`;
  }
  hangarHTML(t: number) {
    const g = this.game.ground!, busy = g.inProgress('build', t);
    return `<div class="k">Hangar · ${esc(g.site.name)}</div><h3>${esc(this.game.company!.ship)}</h3><p class="hint">Blue parts are still blueprints. The crew builds one module at a time.</p><div class="list">` +
      MODULES.map(m => {
        const j = g.s.build[m.id], done = g.done('build', m.id, t);
        const r = done ? '<span class="ok">Built</span>' : j ? `<span class="live num">${fmtClock(j.end - t)}</span>` : `<button class="btn slim" data-act="build" data-v="${m.id}"${busy || this.game.company!.credits < m.cost ? ' disabled' : ''}>Build</button>`;
        return `<div class="it"><div><b>${m.name}</b><span class="s">${m.blurb} · ${m.min} min</span></div><span class="pay num">${done || j ? '' : money(m.cost)}</span>${r}</div>`;
      }).join('') + '</div>' +
      (g.shipReady(t) && !g.s.launched ? `<button class="btn primary big wide" style="margin-top:12px" data-act="launch">Launch to orbit · ${money(LAUNCH_COST)}</button>` : '<p class="hint" style="margin-top:10px">Drag to walk around the ship. Scroll to zoom.</p>');
  }
  controlRoomHTML(t: number) {
    const g = this.game.ground!;
    const tabs = `<div class="tabs">${[['passes', 'Passes'], ['recovery', 'Recovery'], ['research', 'Research']].map(([id, n]) => `<button class="${this.tab === id ? 'on' : ''}" data-act="tab" data-v="${id}">${n}${id === 'recovery' && g.activeRecovery(t) ? ' ●' : ''}</button>`).join('')}</div>`;
    let b = '';
    if (this.tab === 'passes') {
      const list = g.passes(t), shown = list.filter(p => p.state !== 'done' || (p.booked && t - p.set < 120)).slice(0, 5);
      const tq = Math.floor(t / 5) * 5;
      b = `<p class="hint">Each arc is a satellite crossing your sky: wider is longer, taller is higher. Higher and longer passes pay more. Click an arc or Book.</p>${C.passTimeline(list, tq)}<div class="list">` +
        shown.map(p => {
          const st = p.state === 'live' ? `<span class="live">${p.booked ? 'Tracking' : 'Overhead'} · ${fmtClock(p.set - t)}</span>` : p.state === 'done' ? '<span class="ok">Downlinked</span>' : 'in ' + fmtClock(p.rise - t);
          const btn = p.state === 'future' ? `<button class="btn slim${p.booked ? ' on' : ''}" data-act="book" data-v="${esc(p.id)}"${p.conflict ? ' disabled title="Antenna busy"' : ''}>${p.booked ? 'Booked' : 'Book'}</button>` : '<span></span>';
          return `<div class="it${p.booked ? ' bk' : ''}"><div><b>${esc(p.client)}</b><span class="s">${esc(p.sat)} · ${Math.round((p.set - p.rise) / 60)} min · peak ${Math.round(p.maxEl)}° · ${st}</span></div><span class="pay num">${money(p.pay)}</span>${btn}</div>`;
        }).join('') + `</div><div class="switch${g.s.auto ? ' on' : ''}" data-act="auto" role="switch" aria-checked="${g.s.auto}"><i></i>Taras runs the control room (books passes and sends the boat)</div><p class="hint" style="margin-top:6px">${g.antennas()} antenna${g.antennas() > 1 ? 's' : ''}: overlapping passes can't both be booked.</p>`;
    } else if (this.tab === 'recovery') {
      const e = g.activeRecovery(t), last = Object.entries(g.s.recovered).slice(-1)[0];
      if (!e) b = `<p class="hint">No splashdowns predicted off ${esc(g.site.name)} right now. A new one is announced about every 20 minutes, 20 minutes before it lands.</p>${C.seaChart(g.site.port, g.site.sea, null, null, null, 0, 1)}`;
      else {
        const pr = g.prediction(e, t), bp = g.boatPos(t), from = bp ? bp.pos : g.site.port, d = gcDistKm(from, pr.centre), eta = d / g.boatSpeed() * 3600, mine = g.s.boat && g.s.boat.evId === e.id;
        b = `<div class="row" style="justify-content:space-between"><b style="font:600 16px var(--f-head)">${e.kind} from ${e.from}</b><span class="pay num" style="color:var(--amber);font-weight:600">${money(e.pay)}</span></div>
          ${C.seaChart(g.site.port, g.site.sea, e, t < e.tLand ? pr : null, bp ? { pos: bp.pos, to: g.s.boat?.to } : null, e.tLand - t, e.tLand - e.t0)}
          <div class="kv"><span>Splashdown in</span><b class="num">${t < e.tLand ? fmtClock(e.tLand - t) : 'now'}</b><span>Predicted zone</span><b class="num">${Math.round(pr.radiusKm * 2)} km wide</b><span>Boat to zone centre</span><b class="num">${Math.round(d)} km · ${fmtClock(eta)}</b>${mine ? `<span>Boat</span><b>${bp!.arrived ? 'On station' : 'Under way · ' + fmtClock(bp!.eta)}</b>` : ''}</div>
          <p class="hint">The zone shrinks as re-entry nears. Leave early so you're close, then re-target in the last few minutes to sit right under it.</p>
          ${mine ? `<button class="btn wide" data-act="dispatch" data-v="${e.id}">Re-target to the latest prediction</button>` : g.boatReach(e, t) ? `<button class="btn primary wide" data-act="dispatch" data-v="${e.id}">Send the boat · ${money(500)}</button>` : `<p class="hint" style="color:var(--amber)">Too far to reach before it lands. The next splashdown is announced within 20 minutes.</p>`}`;
      }
      if (last) b += `<p class="hint" style="margin-top:8px">Last recovery: ${last[1] === 'ok' ? '<span class="ok">success</span>' : '<span class="bad">missed</span>'}.</p>`;
    } else {
      const busy = g.inProgress('research', t);
      b = `<p class="hint">One project at a time. Each pays for itself later.</p><div class="list">` + RESEARCH.map(r => {
        const j = g.s.research[r.id], done = g.done('research', r.id, t);
        const st = done ? '<span class="ok">Done</span>' : j ? `<span class="live num">${fmtClock(j.end - t)}</span>` : `<button class="btn slim" data-act="research" data-v="${r.id}"${busy ? ' disabled' : ''}>Start</button>`;
        return `<div class="it"><div><b>${r.name}</b><span class="s">${r.blurb} · ${r.min} min</span></div><span class="pay num">${done || j ? '' : money(r.cost)}</span>${st}</div>`;
      }).join('') + '</div>';
    }
    return `<div class="k">Control room · ${esc(g.site.name)}</div>${tabs}${b}`;
  }

  // ---------- Stage 2 ----------
  contractsHTML() {
    const s = this.game.save!, ahead: Record<string, [number, number]> = { pod: [2.8, 0], bag: [-6, -1.2], sat: [14, 3.5] };
    return `<div class="k">Contract board · Haven Commercial</div><p class="hint">Every target flies its own real orbit. Sofia computes the plans; you choose.</p>` +
      CONTRACTS.map(c => {
        const st = s.orbit.done[c.id];
        return `<div class="card${st ? ' done' : ''}"><h4>${esc(c.title)}<span class="num">${money(c.reward)}</span></h4><p>${esc(c.brief)}</p>${C.targetChart(...ahead[c.id])}
          <div class="row" style="justify-content:space-between;margin-top:6px"><span class="hint">${esc(c.client)}${st ? ' · best ' + '★'.repeat(st) : ''}</span><button class="btn ${st ? '' : 'primary'} slim" data-act="contract" data-v="${c.id}">${st ? 'Fly again' : 'Take the job'}</button></div></div>`;
      }).join('');
  }
  opHTML(t: number) {
    const op = this.game.op!, c = this.game.opContract!, d = op.dist();
    const title = { plan: 'Choose a flight plan', transfer: 'On the way', braking: 'Arriving', holding: 'Holding at ' + Math.abs(op.hold[0]) + ' m', grappled: 'Captured' }[op.phase];
    let h = `<div class="k">${esc(c.title)}</div><h3 style="font-size:20px">${title}</h3><div class="kv"><span>Distance to target</span><b class="num">${fmtM(d)}</b><span>Δv used</span><b class="num">${op.dv.toFixed(2)} m/s</b></div>`;
    if (op.phase === 'plan') {
      const plans = op.computePlans();
      h += `<p class="hint">${esc(c.physics)}</p>${C.planChart(plans, PLAN_COL)}` + plans.map(p => `<button class="plan" style="--c:${PLAN_COL[p.id]}" data-act="plan" data-v="${p.id}"><div class="ph"><b>${p.label}</b><span class="num">${Math.round(p.tof / 60)} min</span></div><div class="pn"><span>Δv <b class="num">${p.dv.toFixed(2)} m/s</b></span><span>Propellant <b class="num">${money(p.fuelCost)}</b></span><span>${p.arriveLit ? 'Arrive in sunlight' : 'Arrive in shadow'}</span></div><p>${p.note}</p></button>`).join('')
        + `<button class="btn slim" style="margin-top:10px" data-act="abort">Back to the board</button>`;
    } else if (op.phase === 'transfer') {
      const k = (t - op.departT) / Math.max(1, op.arriveT - op.departT);
      h += `<div class="bigtime num">${fmtClock(op.arriveT - t)}</div><div class="meter" style="--c:var(--teal)"><i style="width:${(k * 100).toFixed(1)}%"></i></div><p class="hint">until arrival. The computer will brake and hold. The world keeps running, so check the ground meanwhile.</p><button class="btn" data-act="replan">Replan from here</button>`;
    } else if (op.phase === 'braking') h += `<p class="hint">Matching the target's motion and closing in.</p>`;
    else if (op.phase === 'holding') {
      const lit = core.sunFraction(op.ship.r, this.game.ephem.sun) > 0.5;
      h += `<p class="hint">${lit ? 'Good light. The arm is ready.' : "In Earth's shadow: floodlights only, but the arm is ready."}</p><button class="btn primary big wide" data-act="grapple"${op.canGrapple() ? '' : ' disabled'}>Grapple</button>`;
    } else h += `<p class="hint">Securing the ${esc(c.name)}.</p>`;
    return h;
  }
  debrief() {
    const e = this.game.op!.ended!, c = this.game.opContract!;
    this.modal(`<div class="k">Contract complete</div><h2>${esc(c.title)}</h2><div class="stars">${[0, 1, 2].map(k => `<span style="color:${k < e.stars ? 'var(--amber)' : 'rgba(255,255,255,.15)'}">${STAR}</span>`).join('')}</div>
      <div class="kv"><span>Flight time</span><b>${Math.round(e.minutes)} min</b><span>Δv spent</span><b>${e.dv.toFixed(1)} m/s</b><span>Propellant</span><b>${money(e.fuel)}</b><span>Paid after propellant</span><b style="color:var(--amber)">${money(e.reward)}</b></div>
      <div class="lesson"><b>The physics behind the plans</b>${esc(c.physics)} The fast plan forces a steep arc and pays for it in propellant.</div>
      <div class="mfoot"><button class="btn primary big" data-act="done">Back to the board</button></div>`);
  }

  // ---------- Stage 3 ----------
  haulHTML(t: number) {
    const g = this.game, h = g.haul!, tr = h.s.trip, co = g.company!;
    const bodies = PORTS.map(p => ({ id: p.id, name: p.name.split(' ')[0], p: portHelio(p.id, t), col: p.col }));
    const map = C.systemMap(bodies, h.shipHelio(t), h.path(80), h.s.port);
    let x = `<div class="k">${esc(co.hauler)} · torch hauler</div>${map}`;
    if (tr) {
      const p = h.progress(t), left = tr.t0 + tr.T - t, half = p < 0.5;
      x += `<h3 style="font-size:19px">${esc(portById(tr.from).name)} to ${esc(portById(tr.to).name)}</h3>${C.tripBar(p)}
        <div class="kv"><span>Arrival in</span><b class="num">${left > 36000 ? fmtDur(left) : fmtClock(left)}</b><span>Drive</span><b>${tr.g} g · ${half ? 'accelerating' : 'braking'}</b><span>Crew</span><b>${tr.stasis ? 'in stasis' : 'awake'}</b>${tr.contract ? `<span>Cargo</span><b>${tr.contract.tonnes} t ${esc(tr.contract.cargo.toLowerCase())}</b><span>Pay on delivery</span><b style="color:var(--amber)">${money(tr.contract.pay)}</b>` : ''}</div>
        <p class="hint">The ship accelerates toward where the destination will be, flips at the midpoint and brakes the rest of the way.</p>`;
    } else {
      const port = h.s.port!, list = board(port, t).filter(c => !h.s.taken[c.id]);
      x += `<h3 style="font-size:19px">Docked at ${esc(portById(port).name)}</h3><p class="hint">${esc(portById(port).where)}. New contracts every 30 minutes.</p>`;
      if (!this.sel3) {
        x += list.map(c => `<button class="plan" data-act="sel3" data-v="${c.id}"><div class="ph"><b>${esc(c.cargo)}</b><span class="num" style="color:var(--amber)">${money(c.pay)}</span></div><div class="pn"><span>to <b>${esc(portById(c.to).name)}</b></span><span><b class="num">${c.tonnes} t</b></span><span>due in <b class="num">${fmtDur(c.deadline - t)}</b></span></div></button>`).join('');
        x += `<div class="k" style="margin-top:12px">Or fly empty</div><div class="row">${PORTS.filter(p => p.id !== port).map(p => `<button class="btn slim" data-act="sel3" data-v="go:${p.id}">${esc(p.name.split(' ')[0])}</button>`).join('')}</div>`;
      } else {
        const ct = list.find(c => c.id === this.sel3) || null, to = ct ? ct.to : this.sel3.startsWith('go:') ? this.sel3.slice(3) : null;
        if (!to) { this.sel3 = null; return x; }
        const plans = tripPlans(port, to, t, ct ? ct.tonnes : 0);
        x += `<div class="card"><h4>${ct ? esc(ct.cargo) + ' · ' + ct.tonnes + ' t' : 'Empty transfer'}<span>${ct ? money(ct.pay) : ''}</span></h4><p>To ${esc(portById(to).name)}${ct ? ', due in ' + fmtDur(ct.deadline - t) : ''}. Pick how hard to burn.</p></div>`;
        x += plans.map(p => this.tripPlanHTML(p, ct ? ct.deadline - t : 1e12, co.credits)).join('');
        x += `<button class="btn slim" style="margin-top:10px" data-act="sel3" data-v="">Back</button>`;
      }
    }
    if (h.s.log.length) x += `<div class="log">${h.s.log.slice(0, 5).map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
    return x;
  }
  tripPlanHTML(p: TripPlan, due: number, credits: number) {
    const late = p.T > due;
    return `<button class="plan" style="--c:${PLAN_COL[p.id]}" data-act="depart" data-v="${p.id}"${credits < p.fuel ? ' disabled' : ''}><div class="ph"><b>${p.label} · ${p.g} g</b><span class="num">${fmtDur(p.T)}</span></div>
      <div class="pn"><span>Propellant <b class="num">${money(p.fuel)}</b></span><span>Raid risk <b class="num" style="color:${p.risk > 0.2 ? 'var(--coral)' : 'inherit'}">${Math.round(p.risk * 100)}%</b></span><span>${p.stasis ? 'Crew asleep' : 'Crew awake'}</span>${late ? '<span style="color:var(--coral)">Arrives late: half pay</span>' : ''}</div><p>${p.note}</p></button>`;
  }

  // ---------- Stage 4 ----------
  sovHTML(t: number) {
    const g = this.game, sv = g.sov;
    if (!sv) {
      return `<div class="k">Claim a site</div><p class="hint">Your station needs a place. Busier sites trade more and draw more raiders.</p>` +
        SITES4.map(s => `<button class="plan" style="--c:${s.id === this.claimSite ? 'var(--amber)' : ''}" data-act="site" data-v="${s.id}"><div class="ph"><b>${esc(s.name)}</b><span class="num" style="color:var(--amber)">${money(s.cost)}</span></div><div class="pn"><span>${esc(s.where)}</span></div>
          <div class="pn"><span>Trade</span><span style="flex:1"><span class="meter" style="--c:var(--teal);display:block;margin:6px 0"><i style="width:${s.traffic / 1.5 * 100}%"></i></span></span><span>Danger</span><span style="flex:1"><span class="meter" style="--c:var(--coral);display:block;margin:6px 0"><i style="width:${s.danger / 1.5 * 100}%"></i></span></span></div><p>${esc(s.blurb)}</p></button>`).join('') +
        `<div class="field" style="margin-top:10px"><label for="sovName">Name your station</label><input id="sovName" type="text" maxlength="28" placeholder="${esc(SITES4.find(s => s.id === this.claimSite)!.name)} Free Station"></div>
        <button class="btn primary big wide" style="margin-top:10px" data-act="claim">Plant the flag</button>`;
    }
    const inc = sv.income(t), heat = sv.heat(t), b = sv.building(t);
    const slots = sv.s.slots.map(x => x ? { mod: x.mod, col: modById(x.mod).col, name: modById(x.mod).name.split(' ')[0], building: x.end > t, progress: x.end > t ? 1 - (x.end - t) / (modById(x.mod).min * 60) : 1 } : { mod: null, col: '', name: '', building: false, progress: 0 });
    let h = `<div class="k">${esc(sv.s.name)} · ${esc(sv.site.name)}</div>${C.stationRing(slots, this.selSlot)}`;
    if (this.selSlot != null) {
      const cur = sv.s.slots[this.selSlot];
      if (!cur) h += `<div class="card"><h4>Slot ${this.selSlot + 1}<span></span></h4><div class="list">${MODS.map(m => `<div class="it"><div><b style="color:${m.col}">${m.name}</b><span class="s">${m.blurb} · ${m.min} min · heat ${m.heat > 0 ? '+' : ''}${m.heat}</span></div><span class="pay num">${money(m.cost)}</span><button class="btn slim" data-act="buildmod" data-v="${m.id}"${b || g.company!.credits < m.cost ? ' disabled' : ''}>Build</button></div>`).join('')}</div></div>`;
      else h += `<div class="card"><h4>${modById(cur.mod).name}<span></span></h4><p>${modById(cur.mod).blurb}${cur.end > t ? ' · ready in ' + fmtClock(cur.end - t) : ''}</p></div>`;
    } else h += `<p class="hint">Click a slot on the ring to build there.</p>`;
    h += `<div class="kv"><span>Income</span><b class="num" style="color:var(--amber)">${money(inc.total)}/min</b><span>Trade · industry · taxes</span><b class="num">${Math.round(inc.dock)} · ${Math.round(inc.ref)} · ${Math.round(inc.tax)}</b><span>Residents</span><b class="num">${Math.round(sv.s.pop)}</b></div>
      <div class="pn" style="font-size:12px;color:var(--ink-2);display:flex;justify-content:space-between"><span>Heat ${heat.made} of ${heat.cap} radiated</span>${heat.over ? `<span class="bad">${sv.count('refinery', t) ? 'Overheating: refinery throttled' : 'Running hot'} · add a radiator wing</span>` : ''}</div><div class="meter" style="--c:${heat.over ? 'var(--coral)' : 'var(--amber)'}"><i style="width:${Math.min(100, heat.made / heat.cap * 100)}%"></i></div>
      <div class="k" style="margin-top:8px">Port policy</div><div class="seg">${(Object.keys(POLICIES) as Policy[]).map(p => `<button class="${sv.s.policy === p ? 'on' : ''}" data-act="policy" data-v="${p}">${POLICIES[p].name}</button>`).join('')}</div><p class="hint" style="margin-top:4px">${POLICIES[sv.s.policy].blurb}</p>`;
    const th = sv.allVisible(t);
    let sens = `<div class="k" style="margin-top:10px">Sensors</div>${C.threatRadar(th.map(x => ({ name: x.name, eta: Math.max(0, x.arrive - t), strength: x.strength })), sv.sensorWarn(t), sv.defence(t))}`;
    for (const x of th) sens += `<div class="card"><h4>${esc(x.name)}<span class="num" style="color:var(--coral)">${fmtClock(x.arrive - t)}</span></h4><p>Strength ${x.strength} against your defence ${sv.defence(t)}${x.response === 'alert' ? ' + 2 on alert' : ''}. They demand ${money(x.demand)}. If they break through, every two points of shortfall costs a module.</p>
      <div class="row"><button class="btn slim${x.response === 'alert' ? ' on' : ''}" data-act="respond" data-v="${x.id}:alert">Alert defences</button><button class="btn slim" data-act="respond" data-v="${x.id}:pay">Pay ${money(x.demand)}</button><button class="btn slim${x.response === 'none' ? ' on' : ''}" data-act="respond" data-v="${x.id}:none">Let them come</button></div></div>`;
    h = th.length ? h.replace(C.stationRing(slots, this.selSlot), sens + C.stationRing(slots, this.selSlot)) : h + sens;
    if (sv.s.log.length) h += `<div class="log">${sv.s.log.slice(0, 5).map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
    return h;
  }

  // ---------- shared ----------
  focusHTML() {
    if (this.hangarOpen) return `<button class="chip on" data-act="closehangar">Back outside</button>`;
    const g = this.game, s = g.save!, id = this.cam.focusId;
    const chips: [string, string][] = [['base', 'Base']];
    if (s.unlocked >= 2) chips.push(['ship', s.company.ship]);
    if (g.haul) chips.push(['hauler', s.company.hauler]);
    if (g.sov) chips.push(['claim', g.sov.s.name.split(' ')[0]]);
    chips.push(['earth', 'Earth'], ['moon', 'Moon']);
    if (s.unlocked >= 3) chips.push(['kamo', 'Kamoʻoalewa'], ['mars', 'Mars'], ['ceres', 'Ceres']);
    else chips.push(['mars', 'Mars'], ['venus', 'Venus']);
    chips.push(['jupiter', 'Jupiter'], ['sun', 'Sun']);
    const label = chips.find(c => c[0] === id)?.[1] || id;
    return chips.map(([k, n]) => `<button class="chip${id === k ? ' on' : ''}" data-act="focus" data-v="${k}">${esc(n)}</button>`).join('') +
      `<span class="scale">${C.ruler()}<span class="num">${fmtScale(this.cam.distKm)} from ${esc(label)}</span></span>`;
  }
  devHTML() {
    const L = this.game.layer, b = (a: string, n: string) => `<button class="btn" data-act="${a}">${n}</button>`;
    return b('dev-money', '+¤50k') + (L === 1 ? b('dev-timers', 'Finish build') : '') + (L === 2 ? b('dev-hold', 'Skip to hold') : '') + (L === 3 ? b('dev-arrive', 'Arrive now') : '') + (L === 4 ? b('dev-timers', 'Finish module') + b('dev-raid', 'Raid in 5 min') : '') + b('dev-title', 'Stage select');
  }

  // ---------- overlay ----------
  drawOverlay() {
    const W = this.gfx.W, H = this.gfx.H;
    if (this.scr !== 'main' || !this.game.camOut) { this.ov.clear(); return; }
    if (this.hangarOpen) {
      const g = this.game.ground!, t = this.game.now(), busy = g.inProgress('build', t);
      const cs: OvCallout[] = [];
      for (const m of MODULES) {
        const a = this.hangar.anchors[m.id]; if (!a) continue;
        const p = this.hangar.project(a, W, H); if (!p) continue;
        const done = g.done('build', m.id, t), j = g.s.build[m.id];
        cs.push({ x: p[0], y: p[1], title: m.name, sub: done ? 'Built' : busy === m.id ? 'Building · ' + fmtClock(j.end - t) : money(m.cost) + ' · ' + m.min + ' min', col: '', state: done ? 'done' : busy === m.id ? 'now' : 'todo' });
      }
      this.ov.draw(W, H, null, [], cs);
      return;
    }
    const game = this.game, co = game.camOut, id = co.focusId, info = game.focusInfo(id);
    let focus: OvFocus | null = null;
    if (info) {
      const p = this.world.project(info.pos) || (id === 'earth' ? [W / 2, H / 2, 0] as any : null);
      if (p) {
        const meta = this.focusMeta(id);
        const sunCam = new THREE.Vector3(...V.norm(V.sub(game.ephem.sun, co.pos))).applyQuaternion(this.gfx.camera.quaternion.clone().invert());
        focus = { x: p[0], y: p[1], r: Math.max(30, this.world.screenRadius(info.pos, meta.rKm)), name: meta.name, meas: meta.meas, detail: meta.detail, col: meta.col, sunAng: id === 'sun' ? null : Math.atan2(-sunCam.y, sunCam.x) };
      }
    }
    const labels: OvLabel[] = [];
    for (const l of game.labels) {
      if (l.focus && l.focus === id) continue;
      const p = this.world.project(l.p); if (!p) continue;
      if (p[0] < -20 || p[1] < -20 || p[0] > W + 20 || p[1] > H + 20) continue;
      labels.push({ k: l.k, x: p[0], y: p[1], title: l.title, sub: l.sub, col: l.col, focus: l.focus });
    }
    this.ov.draw(W, H, focus, labels);
  }
  focusMeta(id: string): { name: string; meas: string; detail: string; col: string; rKm: number } {
    const g = this.game, t = g.now(), co = g.company!;
    const P = PLANETS.find(p => p.name.toLowerCase() === id);
    switch (id) {
      case 'earth': return { name: 'Earth', meas: 'Ø 12,742 km', detail: fmtScale(this.cam.distKm) + ' away', col: '#4da3ff', rKm: R_EARTH };
      case 'moon': return { name: 'Moon', meas: 'Ø 3,475 km', detail: Math.round(V.len(g.ephem.moon)).toLocaleString('en-US') + ' km from Earth', col: '#c8d4e6', rKm: 1737 };
      case 'sun': return { name: 'Sun', meas: 'Ø 1.39 million km', detail: '', col: '#ffd27a', rKm: 696000 };
      case 'base': { const gr = g.ground!; return { name: gr.site.name, meas: gr.site.lat.toFixed(2) + '°, ' + gr.site.lon.toFixed(2) + '°', detail: gr.antennas() + ' antenna' + (gr.antennas() > 1 ? 's' : '') + ' · boat ' + (gr.s.boat ? 'at sea' : 'in port'), col: '#4da3ff', rKm: 40 }; }
      case 'ship': { const s = g.shipState(t); const oi = s ? core.orbitInfo(s) : null; return { name: co.ship, meas: 'Salvage tug · 29 m', detail: oi ? 'altitude ' + Math.round(oi.alt) + ' km · ' + (V.len(s!.v)).toFixed(2) + ' km/s' : '', col: '#2fd6b5', rKm: 0.015 }; }
      case 'hauler': { const h = g.haul!, tr = h.s.trip; return { name: co.hauler, meas: 'Torch hauler · 96 m', detail: tr ? (V.len(h.shipVel(t))).toFixed(0) + ' km/s · ' + tr.g + ' g' : 'docked at ' + portById(h.s.port!).name, col: '#b48cff', rKm: 0.05 }; }
      case 'claim': { const sv = g.sov!; return { name: sv.s.name, meas: 'Station ring Ø 52 m', detail: sv.built(t).length + ' modules · ' + Math.round(sv.s.pop) + ' residents', col: '#ffb13d', rKm: 0.03 }; }
      case 'kamo': return { name: 'Kamoʻoalewa', meas: '≈ 40–100 m asteroid', detail: 'Earth’s quasi-moon', col: '#b48cff', rKm: 0.05 };
      case 'ceres': return { name: 'Ceres', meas: 'Ø 940 km', detail: 'dwarf planet, main belt', col: '#2fd6b5', rKm: 470 };
    }
    if (P) return { name: P.name, meas: 'Ø ' + Math.round(P.r * 2).toLocaleString('en-US') + ' km', detail: '', col: '#' + P.col.toString(16).padStart(6, '0'), rKm: P.r };
    return { name: id, meas: '', detail: '', col: '#4da3ff', rKm: 1 };
  }

  // ---------- actions ----------
  act(a: string, v: string) {
    const g = this.game, t = g.now(), gr = g.ground;
    switch (a) {
      case 'new': this.coName = ''; this.shipName = ''; this.set('found'); break;
      case 'cont': this.enter(); break;
      case 'back': this.set('title'); break;
      case 'devjump': g.devJump(+v, this.sponsor); this.hangarOpen = false; this.enter(); break;
      case 'sponsor': this.coName = ($('#coName') as HTMLInputElement).value; this.shipName = ($('#shipName') as HTMLInputElement).value; this.sponsor = v; this.set('found'); break;
      case 'found': g.found(($('#coName') as HTMLInputElement).value.trim(), this.sponsor, ($('#shipName') as HTMLInputElement).value.trim()); this.enter(); break;
      case 'layer': g.setLayer(+v); this.hangarOpen = false; this.sel3 = null; this.selSlot = null; break;
      case 'tab': this.tab = v; break;
      case 'book': gr!.book(v, t); g.persist(); break;
      case 'auto': gr!.s.auto = !gr!.s.auto; g.persist(); break;
      case 'dispatch': { const e = gr!.recoveryEvents(t).find(x => x.id === v); if (e) { gr!.dispatch(e, t); g.persist(); } break; }
      case 'research': gr!.start('research', v, t); g.persist(); break;
      case 'build': gr!.start('build', v, t); g.persist(); break;
      case 'openhangar': this.hangarOpen = true; break;
      case 'closehangar': this.hangarOpen = false; break;
      case 'launch': this.hangarOpen = false; g.launch(); break;
      case 'focus': g.focus(v); break;
      case 'contract': g.startContract(v); break;
      case 'abort': g.abortContract(); break;
      case 'plan': g.op?.choose(v); break;
      case 'replan': g.op?.replan(); break;
      case 'grapple': g.op?.grapple(); break;
      case 'done': this.closeModal(); g.finishContract(); break;
      case 'sel3': this.sel3 = v || null; break;
      case 'depart': {
        const h = g.haul!, port = h.s.port!, ct = board(port, t).find(c => c.id === this.sel3) || null;
        const to = ct ? ct.to : this.sel3?.startsWith('go:') ? this.sel3.slice(3) : null;
        if (!to) break;
        const p = tripPlans(port, to, t, ct ? ct.tonnes : 0).find(x => x.id === v);
        if (p) { h.depart(to, p, ct, t); this.sel3 = null; g.focus('hauler'); g.persist(true); }
        break;
      }
      case 'site': this.claimSite = v; break;
      case 'claim': g.claim(this.claimSite, (($('#sovName') as HTMLInputElement)?.value || '').trim()); break;
      case 'slot': this.selSlot = this.selSlot === +v ? null : +v; break;
      case 'buildmod': if (this.selSlot != null) { g.sov!.build(this.selSlot, v, t); this.selSlot = null; g.persist(); } break;
      case 'policy': g.sov!.setPolicy(v as Policy); g.persist(); break;
      case 'respond': { const [id, r] = v.split(':'); g.sov!.respond(id, r as any, t); g.persist(); break; }
      case 'dev-money': g.company!.credits += 50000; break;
      case 'dev-timers': {
        for (const j of [...Object.values(gr!.s.build), ...Object.values(gr!.s.research)]) if (j.end > t) j.end = t - 1;
        if (g.sov) for (const x of g.sov.s.slots) if (x && x.end > t) x.end = t - 1;
        break;
      }
      case 'dev-rec': this.toast('Splashdowns follow the shared clock; the next is announced within 20 minutes. Use the recovery tab to watch it.'); break;
      case 'dev-hold': g.op?.skip(); break;
      case 'dev-arrive': g.haul?.skip(t); break;
      case 'dev-raid': g.sov?.spawnSoon(t); break;
      case 'dev-title': this.hangarOpen = false; this.set('title'); break;
      case 'close': this.closeModal(); break;
      case 'help': this.modal(`<h2>How to play</h2><div class="helpgrid"><div>Drag</div><div>Rotate the view any way you like</div><div>Scroll or pinch</div><div>Zoom without limits, from a ship's deck to light-years</div><div>Click a name</div><div>Focus the camera on it</div><div>Stage track</div><div>The diamonds at the top switch between the stages you have unlocked. Earlier stages keep running.</div><div>Left panel</div><div>Your goal for this stage, and what to do next</div><div>Right panel</div><div>Everything you can do in this stage</div></div><p class="hint" style="margin-top:12px">The world runs in real time for everyone. Builds, passes and flights continue while you are away.</p><div class="mfoot"><button class="btn primary" data-act="close">Got it</button></div>`); break;
    }
    this.regions = {};
    this.tick(0, true);
  }
  enter() {
    this.set('main');
    const L = this.game.layer;
    this.game.focus(L === 1 ? 'base' : L === 2 ? 'ship' : L === 3 ? 'hauler' : this.game.sov ? 'claim' : 'earth');
  }

  bindInput() {
    document.addEventListener('click', e => {
      const el = (e.target as Element).closest('[data-act]') as HTMLElement | null;
      if (el && !(el as any).disabled) this.act(el.dataset.act!, el.dataset.v || '');
    });
    const cv = document.getElementById('gl')!, pts = new Map<number, { x: number; y: number }>();
    let pinch = 0, last = { x: 0, y: 0, t: 0 };
    cv.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY, t: performance.now() }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) this.zoom(pinch / d); pinch = d; return; }
      const now = performance.now(), dx = (e.clientX - last.x) * 0.005, dy = (e.clientY - last.y) * 0.005;
      if (this.renderHangar) { this.hangar.tYaw -= dx; this.hangar.tPitch = Math.min(1.2, Math.max(0.02, this.hangar.tPitch + dy)); }
      else this.cam.drag(dx, dy, (now - last.t) / 1000);
      last = { x: e.clientX, y: e.clientY, t: now };
    });
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) this.cam.release(); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === '+' || e.key === '=') this.zoom(0.7); else if (e.key === '-') this.zoom(1.4); else if (e.key === '?') this.act('help', '');
      else if (e.key === 'Escape') this.closeModal();
    });
  }
  zoom(f: number) { if (this.renderHangar) this.hangar.tDist = Math.min(60, Math.max(8, this.hangar.tDist * f)); else this.cam.zoom(f); }
}
export { HAVEN, bodyHelioPos };
