// Hopper physics: arc solver sanity, Δv budgets, and autopilot landings on both planets.
import { BODIES } from '../../src/field/world';
import { solveArc, integrate, budget, autoLand, HopperSpec, handoffState } from '../../src/field/flight';
let fails = 0;
const ok = (c: any, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const KESTREL: HopperSpec = { dry: 7500, propCap: 9000, ve: 345 * 9.80665, thrust: 120e3, cargoCap: 4000, beta: 1500, legs: 2.5, autoSkill: 0 };
const PELICAN: HopperSpec = { dry: 22000, propCap: 60000, ve: 340 * 9.80665, thrust: 1300e3, cargoCap: 8000, beta: 3000, legs: 2.5, autoSkill: 0 };
// Flat-ground check: on Mars with no air, a short 45° hop ≈ v²/g.
const vac = { ...BODIES.mars, rho0: 0 };
const a = solveArc(vac, 1500, 0, 0, 60e3, Math.PI / 4);
ok(Math.abs(a.v0 - Math.sqrt(60e3 * vac.g)) / Math.sqrt(60e3 * vac.g) < 0.02, '60 km hop on airless Mars needs ≈ √(gR) (' + a.v0.toFixed(0) + ' m/s)');
ok(Math.abs(a.tof - 2 * a.v0 * Math.sin(Math.PI / 4) / vac.g) < 4, 'flight time matches the flat formula (' + a.tof.toFixed(0) + ' s)');
for (const [name, b, H] of [['mars', BODIES.mars, KESTREL], ['earth', BODIES.earth, PELICAN]] as const) {
  console.log('--', name);
  for (const km of [30, 70, 120, 200, 300, 450]) {
    let best: any = null;
    for (let g = 20; g <= 75; g += 5) {
      const arc = solveArc(b, H.beta, 0, 0, km * 1e3, g * Math.PI / 180);
      if (!arc.ok) continue;
      const bu = budget(b, H, arc, H.cargoCap * 0.5, H.propCap);
      if (!bu.arc.ok) continue;
      if (!best || bu.dvUp + bu.dvBrake < best.dvUp + best.dvBrake) best = bu;
    }
    if (!best) { console.log('  ', km, 'km: no arc'); continue; }
    console.log(`  ${km} km: best γ ${(best.arc.gamma * 180 / Math.PI).toFixed(0)}°  v0 ${best.arc.v0.toFixed(0)}  tof ${best.arc.tof.toFixed(0)} s  apogee ${(best.arc.apogee / 1e3).toFixed(0)} km  vArr ${best.arc.vArr.toFixed(0)}  Δv ${(best.dvUp + best.dvBrake + best.dvLand).toFixed(0)}  prop left at hand-off ${best.propHandoff.toFixed(0)} kg  after ${best.propAfter.toFixed(0)}  ok ${best.ok}`);
  }
  // Autopilot from a range of hand-off states.
  let landed = 0, n = 0, used = 0;
  for (const gArr of [-0.3, -0.6, -0.9, -1.2]) for (const prop of [H.propCap * 0.25, H.propCap * 0.4]) {
    const s = handoffState(gArr, prop, H.dry + H.cargoCap * 0.5), e = autoLand(b, H, s);
    n++; if (e.done!.kind === 'pad') landed++; used += prop - e.prop;
    if (e.done!.kind !== 'pad') console.log('   autopilot', gArr, prop.toFixed(0), JSON.stringify(e.done));
  }
  ok(landed === n, 'autopilot lands on the pad every time (' + landed + '/' + n + '), avg propellant ' + (used / n).toFixed(0) + ' kg');
  const sharp = { ...H, autoSkill: 1 }, s0 = handoffState(-0.7, H.propCap * 0.4, H.dry + H.cargoCap * 0.5);
  const e0 = autoLand(b, H, s0), e1 = autoLand(b, sharp, s0);
  if (e1.done!.kind !== 'pad') console.log('   sharp', JSON.stringify(e1.done));
  ok(e1.done!.kind === 'pad' && e1.prop > e0.prop, 'better autopilot saves propellant (' + (e1.prop - e0.prop).toFixed(0) + ' kg)');
  const dry = handoffState(-0.7, H.propCap * 0.02, H.dry + H.cargoCap * 0.5), ed = autoLand(b, H, dry);
  ok(ed.done!.kind === 'crash' || ed.done!.kind === 'hard', 'too little propellant ends badly (' + ed.done!.kind + ')');
}
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
