import { initCore } from '../src/sim/core';
import { worldNow } from '../src/sim/clock';
import { newGround, Ground } from '../src/game/ground';
(globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
(async () => {
  await initCore();
  for (const site of ['us', 'eu', 'cn']) for (const name of ['Meridian', 'Acme', 'Kestrel']) {
    const t0 = worldNow() + Math.random() * 86400, s = newGround(name, site, t0);
    const g = new Ground(s, site, () => {}, () => true, () => {});
    const list = g.passes(t0).filter(p => p.rise > t0 && p.rise < t0 + 3600);
    // greedy single antenna
    let busy = 0, pay = 0, n = 0;
    for (const p of list) if (p.rise >= busy) { busy = p.set; pay += p.pay; n++; }
    const first = list[0];
    const recs = new Set<string>(); for (let t = t0; t < t0 + 3600; t += 60) for (const e of g.recoveryEvents(t)) recs.add(e.id);
    console.log(site, name, 'first pass in', Math.round((first.rise - t0)), 's peak', Math.round(first.maxEl), '| passes/h', list.length, 'bookable', n, 'pay/h', pay, '| recoveries/h', recs.size);
  }
})();
