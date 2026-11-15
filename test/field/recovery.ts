// Recovery race: drives whole loops headlessly with the world clock and checks the rules.
import { newRecSave, Recovery, REC_LOCS, objectAt, predict, RecSave, edgePoint } from '../../src/field/recovery';
import { dist } from '../../src/field/world';
let fails = 0;
const ok = (c: any, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const T0 = 2.0e9; // any world time

for (const loc of ['earth', 'mars'] as const) {
  console.log('--', loc);
  // 1. The teaching contract: send at once to the predicted centre, it should be ours.
  const s = newRecSave(loc, 'Test Co', T0), R = new Recovery(s);
  const tut = s.tut!;
  ok(tut.tI - T0 < 420 && tut.tI - T0 > 150, 'teaching capsule lands within 7 minutes (' + Math.round(tut.tI - T0) + ' s)');
  R.step(T0 + 10);
  const err = R.send('c1', tut.id, null, T0 + 10);
  ok(err === null, 'can send to the teaching capsule');
  const eta = R.eta(s.crews[0], predict(tut, T0 + 10, false, REC_LOCS[loc]).c);
  ok(eta < tut.tI - T0 - 10, 'reachable before impact (eta ' + Math.round(eta) + ' s)');
  R.step(tut.tI + 60);
  ok(s.claims[tut.id]?.mine, 'teaching capsule claimed by us within a minute of landing');
  R.step(tut.tI + 1800);
  ok(s.earned >= tut.pay, 'paid on delivery (' + s.earned + ')');
  ok(s.crews[0].mode === 'port', 'crew back in port');

  // 2. Determinism: two identical runs agree exactly.
  const run = () => { const s2 = newRecSave(loc, 'Twin', T0), R2 = new Recovery(s2); R2.step(T0 + 4 * 3600); return JSON.stringify(s2); };
  ok(run() === run(), 'identical inputs give identical worlds');

  // 3. Rivals compete: over six hours of shared events, rivals claim things without us.
  const s3 = newRecSave(loc, 'Idle', T0), R3 = new Recovery(s3);
  R3.step(T0 + 6 * 3600);
  const byR: Record<string, number> = {};
  for (const c of Object.values(s3.claims)) byR[c.by] = (byR[c.by] || 0) + 1;
  const evs = R3.W.shared(T0, T0 + 6 * 3600 - 3000).filter(e => e.tA > T0 + 60);
  console.log('     events in 6 h:', evs.length, 'rival claims:', JSON.stringify(byR));
  ok(Object.keys(byR).length >= 2, 'at least two rivals win recoveries');
  ok(Object.values(byR).reduce((a, b) => a + b, 0) < evs.length, 'some re-entries go unclaimed or lost');

  // 4. A playing strategy: every time a crew is idle, chase the next reachable re-entry (centre),
  //    with a smart variant that goes to the landing point along the track (uses radar).
  const play = (smart: boolean, hours = 6) => {
    const sp = newRecSave(loc, 'Player ' + smart, T0), P = new Recovery(sp);
    for (let t = T0; t < T0 + hours * 3600; t += 15) {
      P.step(t);
      if (smart && !sp.upg.radar && sp.credits > 14000) P.buy('radar', t);
      if (smart && !sp.upg.engine && sp.upg.radar && sp.credits > 16000) P.buy('engine', t);
      for (const c of sp.crews) {
        if (c.mode === 'port') {
          const e = P.open(t).filter(e => t < e.tI && e.mass <= c.crane).sort((a, b) => a.tI - b.tI)
            .find(e => P.eta(c, P.pred(e, t).c) < e.tI - t);
          if (e) P.send(c.id, e.id, null, t);
        } else if (smart && (c.mode === 'out' || c.mode === 'hold') && c.ev) {
          // With radar, wait on the side of the hazard area your own track says it will hit.
          const e = P.event(c.ev, t), pr = e && P.pred(e, t);
          if (e && pr && pr.own && t < e.tI && t - e.tA > 45 && t - e.tA < 60) {
            // Your own track has pulled away from the official centre: that offset is the error the
            // official track will still carry at impact. Large → wait at that end; small → the short side.
            const L = P.L, k = pr.k, w = k * (1 - L.resid) + L.resid, f = Math.pow(k, 1.9);
            const ua = { x: Math.cos(pr.heading), y: Math.sin(pr.heading) };
            const diff = (pr.own.c.x - pr.c.x) * ua.x + (pr.own.c.y - pr.c.y) * ua.y, errA = diff / (f - w);
            const resid = -errA * L.resid; // where the truth sits from the official centre at impact, along track
            if (Math.abs(resid) > L.hazMin * 0.45) P.send(c.id, e.id, edgePoint(pr, resid > 0 ? 0 : Math.PI, -0.5), t);
          }
        }
      }
    }
    P.step(T0 + hours * 3600 + 3000);
    return sp;
  };
  const a = play(false), b = play(true);
  console.log('     naive: wins', a.wins, 'losses', a.losses, 'earned', a.earned, 'credits', Math.round(a.credits));
  console.log('     smart: wins', b.wins, 'losses', b.losses, 'earned', b.earned, 'credits', Math.round(b.credits), 'upg', Object.keys(b.upg).join(','));
  ok(a.wins > 2 && a.losses > 0, 'a naive player wins some and loses some');
  ok(b.wins / Math.max(1, b.wins + b.losses) > a.wins / Math.max(1, a.wins + a.losses), 'a better-informed player wins a larger share of races');
  ok(a.losses >= 2, 'a naive player loses real races (' + a.losses + ')');

  // 5. Resume: step in one go vs. many small steps gives the same world.
  const r1 = newRecSave(loc, 'Resume', T0), r2 = newRecSave(loc, 'Resume', T0);
  const A = new Recovery(r1), B = new Recovery(r2);
  A.send('c1', r1.tut!.id, null, T0 + 6); B.send('c1', r2.tut!.id, null, T0 + 6);
  A.step(T0 + 2 * 3600);
  for (let t = T0; t <= T0 + 2 * 3600; t += 7) B.step(t);
  B.step(T0 + 2 * 3600);
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'one big catch-up equals many small steps');

  // 5b. Nobody sits inside a hazard area before impact.
  { const sh = newRecSave(loc, 'Haz', T0), H = new Recovery(sh); let bad = 0;
    for (let t = T0; t < T0 + 3 * 3600; t += 6) { H.step(t);
      for (const e of H.hazards(t)) { const pr = H.pred(e, t, false); for (const c of [...sh.crews, ...sh.rivals]) if (c.mode === 'hold') { const { insideEllipse } = require('../../src/field/recovery'); if (insideEllipse({ ...pr, a: pr.a - 0.01, b: pr.b - 0.01 }, c.p)) bad++; } } }
    ok(bad === 0, 'no crew inside a live hazard area (' + bad + ' violations)'); }
  // 6. Heavy objects need the crane.
  const heavy = R3.W.shared(T0, T0 + 6 * 3600).find(e => e.mass > 8 && e.tA > T0 + 10)!;
  const s6 = newRecSave(loc, 'Crane', heavy.tA - 5), R6 = new Recovery(s6);
  ok(R6.send('c1', heavy.id, null, heavy.tA + 1)?.startsWith('Too heavy'), 'heavy stage refused without the crane');
  // 7. The object drifts on Earth after impact, not on Mars.
  const d = dist(objectAt(heavy, heavy.tI), objectAt(heavy, heavy.tI + 600));
  ok(loc === 'earth' ? d > 0.1 : d === 0, 'drift after impact: ' + d.toFixed(2) + ' km in 10 min');
}
// No soft-lock in Recovery either: broke after losses, a sortie still goes out on credit.
{ const s = newRecSave('mars', 'Broke', T0), R = new Recovery(s); s.credits = 100;
  ok(R.send('c1', s.tut!.id, null, T0 + 5) === null, 'a sortie goes out on credit when nearly broke'); }
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
