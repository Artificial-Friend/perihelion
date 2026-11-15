// Hopper courier: whole loops headlessly — first contract, flight timeline, landings by the
// computer and by a sharp "human" controller, deadlines, rivals, upgrades to orbit.
import { newHopSave, Hopper, HOP_LOCS, HopWorld } from '../../src/field/hopper';
import { landStep, LandState, HopperSpec, Controls } from '../../src/field/flight';
import { Body } from '../../src/field/world';
let fails = 0;
const ok = (c: any, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const T0 = 2.0e9;
/** A good human: lets it fall, then brakes late and hard (a "suicide burn"), killing drift on the way. */
function human(b: Body, h: HopperSpec, s: LandState): Controls {
  const m = s.mass + s.prop, net = h.thrust / m - b.g;
  const vzRef = -Math.max(1.0, Math.sqrt(2 * 0.55 * net * Math.max(0, s.z - 6)));
  const lim = Math.min(25, 0.2 * s.z + 0.2), vxRef = Math.max(-lim, Math.min(lim, -0.1 * s.x));
  const ax = (vxRef - s.vx) * 0.9, az = (vzRef - s.vz) * 3 + b.g;
  const ang = Math.atan2(ax, Math.max(0.1, az));
  return { throttle: Math.max(0, Math.min(1, m * Math.hypot(ax, Math.max(0.1, az)) / h.thrust)), tilt: s.z < 3 ? 0 : Math.max(-1, Math.min(1, ang / 0.6)) };
}
for (const loc of ['mars', 'earth'] as const) {
  console.log('--', loc);
  const L = HOP_LOCS[loc], s = newHopSave(loc, 'Test', T0), H = new Hopper(s);
  const first = H.firstOffer()!;
  ok(first && H.board(T0).some(j => j.id === first.id), 'first contract is on the home board');
  ok(H.accept(first.id, T0 + 5) === null, 'accept the first contract');
  let tq = Date.now(); const g = H.bestGamma(first.to), p = H.plan(first.to, g, null)!; console.log('     arcs for one route:', Date.now() - tq, 'ms');
  console.log(`     first hop: ${H.W.site(first.from).name} → ${H.W.site(first.to).name}, ${H.W.km(first.from, first.to).toFixed(0)} km, γ ${g.toFixed(0)}°, Δv ${(p.b.dvUp + p.b.dvBrake + p.b.dvLand).toFixed(0)} m/s, load ${p.b.m0 - H.spec().dry - first.kg} kg, buy ${p.refuel.toFixed(0)} kg for ¤${p.cost.toFixed(0)}, hand-off at +${p.b.tHandoff.toFixed(0)} s`);
  ok(p.b.ok, 'the first hop is feasible with the suggested load');
  ok(p.b.tHandoff < 240, 'the first landing starts within 4 minutes of launch');
  ok(H.launch(first.to, g, null, T0 + 30) === null, 'launch');
  const w = H.where(T0 + 60)!;
  ok(w.phase === 'climb' || w.phase === 'coast', 'in the air a little after launch (' + w.phase + ')');
  // A human lands it.
  const tH = s.flight!.tHandoff, h = H.spec(), b = H.body();
  let st: LandState = { ...s.flight!.handoff };
  while (!st.done) st = landStep(b, h, st, human(b, h, st));
  console.log('     human landing:', st.done!.kind, 'vz', st.done!.vz.toFixed(2), 'x', st.done!.x.toFixed(1), 'prop used', (s.flight!.handoff.prop - st.prop).toFixed(0), 'kg in', st.t.toFixed(0), 's');
  for (let k = 0; k < 200 && s.flight && !s.flight.result; k++) H.landTick(null, 60, tH + k);
  const auto = H.lastResult!;
  console.log('     computer landing:', auto.d.kind, 'prop used', (s.flight ? 0 : (p.b.propHandoff - auto.d.prop)).toFixed(0), 'kg');
  ok(auto.d.kind === 'pad' && auto.earned === first.pay, 'computer lands it on the pad and the contract pays (' + auto.earned + ')');
  ok(st.done!.kind === 'pad' && st.prop > auto.d.prop, 'a sharp human uses less propellant than the computer (' + (st.prop - auto.d.prop).toFixed(0) + ' kg saved)');
  ok(s.site === first.to && !s.flight, 'docked at the destination');

  // Board: deterministic, rivals take jobs over time.
  const W1 = new HopWorld(L), W2 = new HopWorld(L);
  ok(JSON.stringify(W1.board(L.home, T0 + 7200)) === JSON.stringify(W2.board(L.home, T0 + 7200)), 'boards are identical for every player');
  const at = W1.board(L.home, T0 + 7200), later = W1.board(L.home, T0 + 7200 + 900);
  ok(at.some(j => !later.find(x => x.id === j.id)), 'rival couriers take jobs off the board within 15 minutes');
  ok(W1.rivalFlights(T0 + 7200).length > 0, 'rival hops are in the air');

  // Deadline penalty.
  const s2 = newHopSave(loc, 'Late', T0), H2 = new Hopper(s2);
  H2.accept(H2.firstOffer()!.id, T0); const c0 = s2.credits;
  H2.tick(T0 + 3700);
  ok(s2.manifest.length === 0 && s2.credits < c0, 'a missed deadline costs a penalty');

  // A careless overloaded hop runs dry and crashes.
  const s3 = newHopSave(loc, 'Greedy', T0), H3 = new Hopper(s3);
  const far = [...H3.W.sites].sort((a, b) => H3.W.km(L.home, b.id) - H3.W.km(L.home, a.id))[3];
  s3.manifest.push({ id: 'x', from: L.home, to: far.id, cargo: 'Ballast', kg: H3.spec().cargoCap, pay: 1, tA: T0, tTaken: T0, deadline: T0 + 1e6, urgent: false, rival: '' });
  const gp = H3.plan(far.id, H3.bestGamma(far.id), H3.spec().propCap);
  console.log('     overloaded hop to', far.name, H3.W.km(L.home, far.id).toFixed(0), 'km: prop at hand-off', gp?.b.propHandoff.toFixed(0), 'feasible', gp?.b.ok);
  if (gp && !gp.b.ok) { H3.launch(far.id, gp.gamma, H3.spec().propCap, T0); H3.tick(s3.flight!.tHandoff + 30); ok(['crash', 'hard'].includes(s3.flight?.result?.kind || H3.lastResult!.d.kind), 'flying an infeasible hop ends in a crash (' + H3.lastResult!.d.kind + ')'); ok(s3.condition < 0.5, 'and the hopper needs repairs'); }

  // The ladder: all upgrades take Mars to orbit; Earth needs the upper stage.
  const s4 = newHopSave(loc, 'Rich', T0), H4 = new Hopper(s4); s4.credits = 1e6;
  const dv0 = H4.maxDv();
  for (const u of L.upgrades) H4.buy(u.id, T0);
  console.log('     Δv empty: start', dv0.toFixed(0), '→ all upgrades', H4.maxDv().toFixed(0), 'of', H4.body().orbitDv, 'for orbit');
  if (loc === 'mars') ok(H4.orbitCapable() && s4.orbital, 'all upgrades make the Mars hopper orbit-capable');
  else { ok(!H4.orbitCapable(), 'upgrades alone do not reach orbit from Earth'); H4.buy('stage', T0); ok(s4.orbital, 'the upper stage opens orbit'); }
  // Reach: which sites can the starter reach with 1.5 t, and after tanks?
  const reach = (HH: Hopper) => HH.W.sites.filter(x => x.id !== L.home).filter(x => { HH.s.manifest = [{ id: 'r', from: L.home, to: x.id, cargo: '', kg: 1500, pay: 0, tA: 0, tTaken: 0, deadline: 1e12, urgent: false, rival: '' }]; const q = HH.plan(x.id, HH.bestGamma(x.id), HH.spec().propCap); return q && q.b.ok; }).map(x => x.id + ':' + Math.round(HH.W.km(L.home, x.id)));
  const s5 = newHopSave(loc, 'R', T0), H5 = new Hopper(s5);
  console.log('     starter reaches:', reach(H5).join(' '));
  s5.upg.tanks = 1; (H5 as any).arcCache.clear();
  console.log('     with tanks:', reach(H5).join(' '));
  s5.upg.engine = 1; s5.upg.structure = 1;
  console.log('     fully upgraded:', reach(H5).join(' '));
}
// Resume: save mid-flight, reload from JSON later; the computer lands it and the contract pays.
for (const loc of ['mars', 'earth'] as const) {
  const s = newHopSave(loc, 'Resume', T0), H = new Hopper(s), first = H.firstOffer()!;
  H.accept(first.id, T0); H.launch(first.to, H.bestGamma(first.to), null, T0 + 10);
  const saved = JSON.stringify(s), tH = s.flight!.tHandoff;
  const H2 = new Hopper(JSON.parse(saved));
  H2.tick(tH - 5);
  ok(!!H2.s.flight && !H2.s.flight.result, loc + ': still in the air just before hand-off after a reload');
  H2.tick(tH + 600);
  ok(!H2.s.flight && H2.s.site === first.to && H2.s.earned === first.pay, loc + ': reloaded later, the computer landed it and it paid (' + H2.s.earned + ')');
  const H3 = new Hopper(JSON.parse(saved)); H3.tick(tH + 600);
  ok(JSON.stringify(H3.s) === JSON.stringify(H2.s), loc + ': the same reload gives the same result');
}
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
