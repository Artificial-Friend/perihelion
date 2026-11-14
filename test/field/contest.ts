// How contested is a naive player's race? Counts rivals chasing the same object.
import { newRecSave, Recovery } from '../../src/field/recovery';
const T0 = 2.0e9;
for (const loc of ['earth', 'mars'] as const) {
  const sp = newRecSave(loc, 'C', T0), P = new Recovery(sp);
  const seen: Record<string, Set<string>> = {};
  for (let t = T0; t < T0 + 6 * 3600; t += 15) {
    P.step(t);
    for (const c of sp.crews) if (c.mode === 'port') {
      const e = P.open(t).filter(e => t < e.tI && e.mass <= c.crane).sort((a, b) => a.tI - b.tI).find(e => P.eta(c, P.pred(e, t).c) < e.tI - t);
      if (e) P.send(c.id, e.id, null, t);
    }
    for (const c of sp.crews) if (c.ev) { seen[c.ev] ||= new Set(); for (const r of sp.rivals) if (r.ev === c.ev) seen[c.ev].add(r.id); }
  }
  const n = Object.keys(seen).length, contested = Object.values(seen).filter(s => s.size > 0).length;
  const busy = sp.rivals.map(r => r.name + ':' + r.mode).join(', ');
  console.log(loc, 'chased', n, 'contested', contested, 'wins', sp.wins, 'losses', sp.losses, '|', busy);
}
