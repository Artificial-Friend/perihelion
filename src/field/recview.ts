// Recovery race: the map layer and the panels.
import { esc, money, fmtClock } from '../game/util';
import { XY, dist } from './world';
import { Recovery, RecEvent, Crew, predict, objectAt, edgePoint, edgeAngle, insideEllipse, trackAxes, REC_GOAL } from './recovery';
import { MapView, COL, label, chevron, ellipsePath } from './mapgfx';
import type { FieldUI } from './ui';

const KIND_COL: Record<string, string> = { capsule: COL.cyan, stage: COL.amber, debris: COL.violet };
const MODE_WORD: Record<string, string> = { port: 'In port', out: 'Under way', hold: 'Waiting at the edge', chase: 'Racing in', tow: 'Towing home', back: 'Heading home' };

export class RecView {
  sel: string | null = null; crew = 'c1'; tab = 'events';
  hoverP: XY | null = null; hoverEv: string | null = null;
  constructor(public f: FieldUI, public R: Recovery) {}
  start() {
    const v = this.f.view!;
    v.zoom = 1; v.cx = 0; v.cy = 0;
    // Select the teaching capsule straight away.
    const t = this.f.now(), tut = this.R.s.tut;
    if (tut && t < tut.tI && !this.R.s.claims[tut.id]) this.sel = tut.id;
  }
  ev(t: number) { return this.sel ? this.R.event(this.sel, t) : null; }
  myCrew() { return this.R.s.crews.find(c => c.id === this.crew) || this.R.s.crews[0]; }

  // ---------------------------------------------------------------- map
  draw(ctx: CanvasRenderingContext2D, v: MapView, t: number) {
    ctx.save();
    const a0 = v.toScr({ x: -v.r.half, y: v.r.half }), b0 = v.toScr({ x: v.r.half, y: -v.r.half });
    ctx.beginPath(); ctx.rect(Math.max(v.box.x, a0.x), Math.max(v.box.y, a0.y), Math.min(v.box.x + v.box.w, b0.x) - Math.max(v.box.x, a0.x), Math.min(v.box.y + v.box.h, b0.y) - Math.max(v.box.y, a0.y)); ctx.clip();
    this.drawInner(ctx, v, t);
    ctx.restore();
  }
  private drawInner(ctx: CanvasRenderingContext2D, v: MapView, t: number) {
    const R = this.R, L = R.L, s = R.s;
    // Ports.
    const ports = new Map<string, { p: XY; names: string[] }>();
    for (const c of [...s.crews, ...s.rivals]) {
      const k = c.home.x.toFixed(1) + ',' + c.home.y.toFixed(1);
      const e = ports.get(k) || { p: c.home, names: [] };
      if (!c.mine && !e.names.includes(c.name)) e.names.push(c.name);
      ports.set(k, e);
    }
    for (const [, e] of ports) {
      const q = v.toScr(e.p), mine = dist(e.p, R.W.port) < 0.5;
      ctx.fillStyle = mine ? COL.teal : COL.ink2; ctx.strokeStyle = 'rgba(5,12,26,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(q.x - 4, q.y - 4, 8, 8); ctx.stroke(); ctx.fill();
      if (mine) label(ctx, L.port, q.x - 9, q.y, COL.teal, 11, 600, 'right');
    }
    // Events.
    for (const e of R.events(t)) {
      const claim = s.claims[e.id];
      if (claim && t - claim.t > 4) continue;
      if (t > e.tI + e.life) continue;
      this.drawEvent(ctx, v, e, t);
    }
    // Crews: rivals first, yours on top.
    for (const c of [...s.rivals, ...s.crews]) this.drawCrew(ctx, v, c, t);
    // Where the selected crew would wait if you clicked here.
    const e = this.ev(t), c = this.myCrew();
    if (e && this.hoverP && t < e.tI && c.mode !== 'tow' && !s.claims[e.id] && e.mass <= c.crane) {
      const pr = R.pred(e, t);
      if (dist(this.hoverP, pr.c) < pr.a * 2.2 + 3) {
        const q = v.toScr(edgePoint(pr, edgeAngle(pr, this.hoverP)));
        ctx.strokeStyle = COL.teal; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        label(ctx, 'Wait here (click)', q.x + 13, q.y, COL.teal, 11, 600);
      }
    }
  }
  private drawEvent(ctx: CanvasRenderingContext2D, v: MapView, e: RecEvent, t: number) {
    const R = this.R, pr = R.pred(e, t), sel = e.id === this.sel, kc = KIND_COL[e.kind];
    const { a: ua } = trackAxes(e.heading), s = v.scale;
    if (!pr.landed) {
      // Ground track: where it is coming from and going, through the official centre.
      const p0 = v.toScr({ x: pr.c.x - ua.x * R.W.region.half * 2, y: pr.c.y - ua.y * R.W.region.half * 2 });
      const p1 = v.toScr({ x: pr.c.x + ua.x * (pr.a + 6), y: pr.c.y + ua.y * (pr.a + 6) });
      ctx.strokeStyle = sel ? 'rgba(180,140,255,.75)' : 'rgba(180,140,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.setLineDash([]);
      chevron(ctx, p1.x, p1.y, e.heading, sel ? COL.violet : 'rgba(180,140,255,.6)', 6);
      // Hazard area.
      ellipsePath(ctx, v, pr.c, pr.a, pr.b, e.heading);
      ctx.fillStyle = sel ? 'rgba(255,107,90,.13)' : 'rgba(255,107,90,.07)'; ctx.fill();
      ctx.setLineDash([6, 4]); ctx.lineWidth = sel ? 2 : 1.2; ctx.strokeStyle = sel ? COL.coral : 'rgba(255,107,90,.7)'; ctx.stroke(); ctx.setLineDash([]);
      // Your own radar track.
      if (pr.own) {
        ellipsePath(ctx, v, pr.own.c, pr.own.a, pr.own.b, e.heading);
        ctx.fillStyle = 'rgba(47,214,181,.10)'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(47,214,181,.85)'; ctx.stroke();
        const q = v.toScr(pr.own.c); ctx.fillStyle = COL.teal; ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      // The object on its way down (the last stretch of its ground track).
      if (e.tI - t < 300) {
        const q = v.toScr(objectAt(e, t));
        ctx.strokeStyle = kc; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(q.x - ua.x * 14, q.y + ua.y * 14); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.fillStyle = kc; ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      const top = v.toScr(pr.c), off = Math.max(pr.a, pr.b) * s * 0.55 + 8;
      if (sel || e.id === this.hoverEv) label(ctx, (e.own ? 'Contract · ' : '') + e.name + ' · ' + money(e.pay), top.x, top.y - off - 14, COL.ink, sel ? 13 : 12, 600, 'center');
      label(ctx, fmtClock(e.tI - t), top.x, top.y - off, sel ? COL.coral : 'rgba(255,107,90,.9)', sel ? 12 : 11, 600, 'center');
    } else {
      // Down: the object itself, drifting on Earth, with how long it stays recoverable.
      const q = v.toScr(objectAt(e, t)), pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = kc; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(q.x, q.y, 8 + 6 * pulse, 0, Math.PI * 2); ctx.globalAlpha = 0.6 * (1 - pulse) + 0.2; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = kc; ctx.fillRect(-4.5, -4.5, 9, 9); ctx.restore();
      if (e.drift.y || e.drift.x) {
        const q0 = v.toScr(e.P); ctx.strokeStyle = 'rgba(255,177,61,.4)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
      }
      if (!this.R.s.claims[e.id]) {
        if (sel || e.id === this.hoverEv) label(ctx, e.name + ' · ' + money(e.pay) + ' · ' + (this.R.L.id === 'earth' ? 'sinks in ' : 'operator collects it in ') + fmtClock(e.tI + e.life - t), q.x, q.y - 18, COL.amber, 12, 600, 'center');
        else label(ctx, money(e.pay), q.x, q.y - 16, 'rgba(255,177,61,.85)', 10.5, 600, 'center');
      }
    }
  }
  private drawCrew(ctx: CanvasRenderingContext2D, v: MapView, c: Crew, t: number) {
    if (c.mode === 'port' && !c.mine) return;
    const q = v.toScr(c.p), col = c.mine ? (c.id === this.crew ? COL.teal : COL.cyan) : c.col;
    if (c.dest && c.mode !== 'port') {
      const d = v.toScr(c.dest);
      ctx.strokeStyle = col; ctx.globalAlpha = c.mine ? 0.7 : 0.4; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(d.x, d.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (c.mode === 'port') return;
    const ang = c.dest && dist(c.p, c.dest) > 0.01 ? Math.atan2(c.dest.y - c.p.y, c.dest.x - c.p.x) : Math.PI / 2;
    if (c.mode === 'hold') { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, q.y, 12, 0, Math.PI * 2); ctx.stroke(); }
    if (c.mode === 'tow') { ctx.save(); ctx.translate(q.x - Math.cos(ang) * 12, q.y + Math.sin(ang) * 12); ctx.rotate(Math.PI / 4); ctx.fillStyle = COL.amber; ctx.fillRect(-3, -3, 6, 6); ctx.restore(); }
    chevron(ctx, q.x, q.y, ang, col, c.mine ? 10 : 8);
    label(ctx, c.mine ? c.name : this.R.L.rivals.find(r => r.id === c.id)?.short || c.name, q.x + 12, q.y + 12, col, c.mine ? 12 : 10.5, 600);
  }

  // ---------------------------------------------------------------- input
  click(p: XY, sx: number, sy: number) {
    const R = this.R, t = this.f.now(), v = this.f.view!;
    // Pick an event: inside its hazard area or on its object.
    const hit = R.events(t).filter(e => !R.s.claims[e.id] && t < e.tI + e.life).find(e => {
      const pr = R.pred(e, t);
      if (pr.landed) { const q = v.toScr(objectAt(e, t)); return Math.hypot(q.x - sx, q.y - sy) < 16; }
      return insideEllipse({ ...pr, a: pr.a * 1.05 + 0.5, b: pr.b * 1.05 + 0.5 }, p);
    });
    if (hit && hit.id !== this.sel) { this.sel = hit.id; this.tab = 'events'; this.f.host.regions['f-right'] = ''; return; }
    const e = this.ev(t);
    if (!e) return;
    const pr = R.pred(e, t);
    if (!pr.landed && dist(p, pr.c) < pr.a * 2.2 + 3) {
      const c = this.myCrew(), err = R.send(c.id, e.id, p, t);
      if (err) this.f.host.toast(err, 'warn'); else this.f.persist(true);
    } else if (!hit) { this.sel = null; }
    this.f.host.regions['f-right'] = '';
  }
  hover(p: XY, sx?: number, sy?: number) {
    this.hoverP = p;
    const R = this.R, t = this.f.now(), v = this.f.view!;
    const hit = R.events(t).filter(e => !R.s.claims[e.id] && t < e.tI + e.life).find(e => {
      const pr = R.pred(e, t);
      if (pr.landed) { const q = v.toScr(objectAt(e, t)); return Math.hypot(q.x - (sx || 0), q.y - (sy || 0)) < 16; }
      return insideEllipse({ ...pr, a: pr.a * 1.05 + 0.5, b: pr.b * 1.05 + 0.5 }, p);
    });
    this.hoverEv = hit ? hit.id : null;
    if (this.f.cv) this.f.cv.style.cursor = hit ? 'pointer' : 'grab';
  }

  // ---------------------------------------------------------------- panels
  goalHTML() {
    const k = this.R.goal();
    return `<div class="gl"><span>Goal: earn ${money(REC_GOAL)} for an orbital salvage tug</span><b class="num">${Math.round(k * 100)}%</b></div><div class="bar"><i style="width:${(k * 100).toFixed(1)}%"></i></div>`;
  }
  panels(t: number) {
    const R = this.R, s = R.s, L = R.L;
    const tabs = `<div class="tabs">${[['events', 'Re-entries'], ['crews', 'Crews'], ['upg', 'Upgrades'], ['log', 'Log']].map(([id, n]) => `<button class="${this.tab === id ? 'on' : ''}" data-act="rec-tab" data-v="${id}">${n}</button>`).join('')}</div>`;
    let body = '';
    if (this.tab === 'events') body = this.detailHTML(t) + this.listHTML(t);
    else if (this.tab === 'crews') {
      body = `<div class="k">Your ${L.craftPlural}</div><div class="list">` + s.crews.map(c => {
        const e = c.ev ? R.event(c.ev, t) : null;
        return `<div class="it"><div><b style="color:${c.id === this.crew ? 'var(--teal)' : 'var(--cyan)'}">${esc(c.name)}</b><span class="s">${MODE_WORD[c.mode]}${e ? ' · ' + esc(e.name) : ''} · crane ${c.crane} t · ${Math.round(L.speed * c.speedK * 3600)} km/h</span></div><span class="num s">${Math.round(c.km)} km</span>${c.mode !== 'port' && c.mode !== 'tow' ? `<button class="btn slim" data-act="rec-recall" data-v="${c.id}">Recall</button>` : '<span></span>'}</div>`;
      }).join('') + `</div><div class="k" style="margin-top:14px">Rival crews</div><div class="list">` + s.rivals.map(c => {
        const def = L.rivals.find(r => r.id === c.id)!, e = c.ev ? R.W.shared(t - 3600, t).find(x => x.id === c.ev) : null;
        const wins = Object.values(s.claims).filter(x => x.by === c.id).length;
        return `<div class="it rv"><div><b style="color:${c.col}">${esc(c.name)}</b><span class="s">${esc(def.blurb)}</span><span class="s">${MODE_WORD[c.mode]}${e ? ' · ' + esc(e.name) : ''}</span></div><span class="num s">${wins} won</span><span></span></div>`;
      }).join('') + `</div><p class="hint" style="margin-top:8px">You: ${s.wins} won, ${s.losses} lost to rivals. Running costs: ${money(L.perSortie)} per sortie, ${money(L.perKm)} per km.</p>`;
    } else if (this.tab === 'upg') {
      body = `<div class="list">` + L.upgrades.map(u => {
        const have = R.has(u.id), lock = u.needs && !R.has(u.needs);
        return `<div class="it"><div><b>${esc(u.name)}</b><span class="s">${esc(u.blurb)}${lock ? ' · needs ' + esc(L.upgrades.find(x => x.id === u.needs)!.name) : ''}</span></div><span class="pay num">${have ? '' : money(u.cost)}</span>${have ? '<span class="ok">Fitted</span>' : `<button class="btn slim" data-act="rec-buy" data-v="${u.id}"${lock || s.credits < u.cost ? ' disabled' : ''}>Buy</button>`}</div>`;
      }).join('') + `</div><p class="hint" style="margin-top:8px">Earned so far ${money(s.earned)}; spent ${money(s.spent)} on sorties, fuel and upgrades.</p>`;
    } else {
      body = s.log.length ? `<div class="flog">${s.log.map(l => `<p class="${l.kind}"><span class="num">${fmtClock((t - l.t))} ago</span>${esc(l.text)}</p>`).join('')}</div>` : '<p class="hint">Nothing yet.</p>';
    }
    this.f.host.region('f-right', tabs + `<div class="fscroll">${body}</div>`);
    this.f.host.region('f-legend', `<div class="lg"><i class="sw haz"></i>Hazard area: stay out until impact</div><div class="lg"><i class="sw trk"></i>Ground track, direction of travel</div>${R.radar() ? '<div class="lg"><i class="sw own"></i>Your own radar track</div>' : ''}<div class="lg"><i class="sw me"></i>Your ${L.craftPlural}</div><div class="lg"><i class="sw riv"></i>Rival crews</div><p class="hint">Drag to pan, scroll to zoom.</p>`);
  }
  private listHTML(t: number) {
    const R = this.R, list = R.open(t).sort((a, b) => a.tI - b.tI);
    if (!list.length) return `<p class="hint">Nothing coming down right now. Re-entries are announced every few minutes, ${fmtClock(R.L.warn)} before they land.</p>`;
    return `<div class="k" style="margin-top:12px">Coming down</div><div class="list">` + list.map(e => {
      const who = [...R.s.crews, ...R.s.rivals].filter(c => c.ev === e.id);
      const when = t < e.tI ? 'lands in ' + fmtClock(e.tI - t) : 'down · ' + fmtClock(e.tI + e.life - t) + ' left';
      return `<div class="it ev${e.id === this.sel ? ' sel' : ''}" data-act="rec-sel" data-v="${e.id}"><div><b><i class="dot" style="background:${KIND_COL[e.kind]}"></i>${esc(e.name)}</b><span class="s">${e.mass} t · ${when}${who.length ? ' · ' + who.map(c => `<i class="dot" style="background:${c.mine ? 'var(--teal)' : c.col}"></i>`).join('') : ''}</span></div><span class="pay num">${money(e.pay)}</span><span></span></div>`;
    }).join('') + `</div>`;
  }
  private detailHTML(t: number) {
    const R = this.R, L = R.L, e = this.ev(t);
    if (!e || R.s.claims[e.id] || t > e.tI + e.life) return `<p class="hint">Select a re-entry on the map or in the list.</p>`;
    const pr = R.pred(e, t), c = this.myCrew();
    const head = `<div class="row" style="justify-content:space-between;align-items:baseline"><b class="fttl">${esc(e.name)}</b><span class="pay num big">${money(e.pay)}</span></div>
      <p class="hint">${e.client ? 'Contract for ' + esc(e.client) : 'Salvage: yours if you get there first'} · from ${esc(e.from)} · ${e.mass} t</p>`;
    let kv: string[] = [];
    if (!pr.landed) {
      kv.push('Lands in', `<b class="num warn">${fmtClock(e.tI - t)}</b>`);
      kv.push('Hazard area', `<b class="num">${(pr.a * 2).toFixed(1)} × ${(pr.b * 2).toFixed(1)} km</b>`);
      if (pr.own) {
        const { a: ua } = trackAxes(e.heading), u = ((pr.own.c.x - pr.c.x) * ua.x + (pr.own.c.y - pr.c.y) * ua.y) / pr.a;
        kv.push('Your radar', `<b>${Math.abs(u) < 0.15 ? 'near the centre' : u > 0 ? 'toward the forward end' : 'toward the back end'}</b>`);
      }
    } else kv.push('Down', `<b class="num">${R.L.id === 'earth' ? 'sinks in ' : 'the operator collects it in '}${fmtClock(e.tI + e.life - t)}</b>`);
    const racers = [...R.s.crews, ...R.s.rivals].filter(x => x.ev === e.id);
    const target = pr.landed ? objectAt(e, t) : pr.c;
    const rows = racers.map(x => `<div class="it slim"><div><b style="color:${x.mine ? 'var(--teal)' : x.col}">${esc(x.name)}</b><span class="s">${MODE_WORD[x.mode]}</span></div><span class="num s">${dist(x.p, target).toFixed(1)} km</span><span></span></div>`).join('');
    const crewChips = R.s.crews.length > 1 ? `<div class="chips">${R.s.crews.map(x => `<button class="chip${x.id === c.id ? ' on' : ''}" data-act="rec-crew" data-v="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : '';
    let actions = '';
    const busy = c.mode === 'tow';
    if (e.mass > c.crane) actions = `<p class="hint warn">Too heavy for your crane (${c.crane} t). The heavy crane lifts 20 t.</p>`;
    else if (busy) actions = `<p class="hint">${esc(c.name)} is towing a recovery home.</p>`;
    else if (c.ev === e.id && !pr.landed) {
      actions = `<p class="hint">${esc(c.name)} is ${c.mode === 'hold' ? 'waiting at the edge' : 'on its way to the edge'}. Click the map near the zone to change sides, or:</p>
        <div class="row"><button class="btn slim" data-act="rec-send" data-v="safe">Short side</button><button class="btn slim" data-act="rec-send" data-v="fwd">Forward end</button><button class="btn slim" data-act="rec-send" data-v="aft">Back end</button><button class="btn slim warn" data-act="rec-recall" data-v="${c.id}">Recall</button></div>`;
    } else if (c.ev === e.id) actions = `<p class="hint">${esc(c.name)} is racing in.</p>`;
    else {
      const eta = R.eta(c, pr.landed ? objectAt(e, t) : edgePoint(pr, edgeAngle(pr, c.p)));
      const late = !pr.landed && eta > e.tI - t;
      actions = `<p class="hint">${esc(c.name)} reaches ${pr.landed ? 'it' : 'the edge'} in about ${fmtClock(eta)}${late ? ', after impact' : ''}${c.ev ? ' (it will drop its current job)' : ''}.</p>
        <button class="btn primary wide" data-act="rec-send" data-v="safe">${pr.landed ? 'Race to it' : 'Send to the short side'}${c.mode === 'port' ? ' · ' + money(L.perSortie) : ''}</button>
        ${pr.landed ? '' : '<p class="hint" style="margin-top:6px">Or click the map beside the hazard area to choose where to wait.</p>'}`;
    }
    return `<div class="fsel">${head}<div class="kv">${kv.map(x => x.startsWith('<') ? x : `<span>${x}</span>`).join('')}</div>
      ${rows ? `<div class="k" style="margin-top:8px">Racing for it</div><div class="list">${rows}</div>` : ''}${crewChips}<div class="facts">${actions}</div></div>`;
  }

  act(a: string, v: string, t: number): boolean {
    const R = this.R;
    switch (a) {
      case 'rec-tab': this.tab = v; return true;
      case 'rec-sel': this.sel = v; this.tab = 'events'; return true;
      case 'rec-crew': this.crew = v; return true;
      case 'rec-recall': R.recall(v, t); return true;
      case 'rec-buy': { const err = R.buy(v, t); if (err) this.f.host.toast(err, 'warn'); return true; }
      case 'rec-send': {
        const e = this.ev(t); if (!e) return true;
        const pr = R.pred(e, t), c = this.myCrew();
        const at = pr.landed || v === 'safe' ? null : edgePoint(pr, v === 'fwd' ? 0 : Math.PI, -0.3);
        const err = R.send(c.id, e.id, at, t);
        if (err) this.f.host.toast(err, 'warn');
        return true;
      }
    }
    return false;
  }
}
