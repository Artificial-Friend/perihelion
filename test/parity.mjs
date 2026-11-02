// Bit-for-bit parity between two builds of the simulation core.
// usage: node test/parity.mjs [reference.wasm] [candidate.wasm] [cases] [--native build/core_native]
// Defaults: test/core-v3.wasm (the v3 reference build) vs build/core.wasm (fresh build).
// With --native, every case is also run through the native build and must match bit for bit.
import fs from 'fs';
import { spawnSync } from 'child_process';

const argv = process.argv.slice(2), ni = argv.indexOf('--native');
const nativePath = ni >= 0 ? argv.splice(ni, 2)[1] : null;
const [refPath = 'test/core-v3.wasm', candPath = 'build/core.wasm', casesArg = '10000'] = argv;
const CASES = +casesArg;

async function load(p) {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(p));
  const ex = instance.exports;
  return { ex, IO: new Float64Array(ex.memory.buffer, ex.io(), 8192) };
}
const A = await load(refPath), B = await load(candPath);

// Deterministic RNG so failures can be replayed.
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; let t = seed ^ (seed >>> 15); t = Math.imul(t, 2246822519) >>> 0; return (t ^ (t >>> 13)) / 4294967296 + Math.random() * 0; };
const U = (a, b) => a + (b - a) * rnd();
const MU = 398600.4418, RE = 6371, DEG = Math.PI / 180;
const T0 = 1.9e9; // around 2060 in seconds since J2000

function leoState() {
  const a = RE + U(200, 2000), i = U(0, Math.PI), O = U(0, 2 * Math.PI), u = U(0, 2 * Math.PI), v = Math.sqrt(MU / a) * U(0.9, 1.1);
  const r = [a * (Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.cos(i) * Math.sin(u)), a * (Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.cos(i) * Math.sin(u)), a * Math.sin(i) * Math.sin(u)];
  const vv = [v * (-Math.cos(O) * Math.sin(u) - Math.sin(O) * Math.cos(i) * Math.cos(u)), v * (-Math.sin(O) * Math.sin(u) + Math.cos(O) * Math.cos(i) * Math.cos(u)), v * Math.sin(i) * Math.cos(u)];
  return [...r, ...vv.map(x => x + U(-0.05, 0.05))];
}
const circ = () => [RE + U(250, 1200), U(0, Math.PI), U(0, 2 * Math.PI), U(0, 2 * Math.PI), U(-1e4, 1e4)];
const near = (s, m) => s.map((x, k) => x + (k < 3 ? U(-m, m) : U(-m * 1e-3, m * 1e-3)));

// Each case: [export, input vector, number of output slots to compare]
const gens = {
  probe: () => [[U(-1, 1) * 10 ** U(-6, 4)], 10],
  kepler: () => [[...leoState(), U(-2e4, 2e4), MU], 6],
  circ: () => [[...circ(), U(-1e5, 1e5)], 6],
  elements: () => [[RE + U(300, 5e5), U(0, 0.95), U(0, Math.PI), U(0, 6.28), U(0, 6.28), U(-10, 10), U(-1e4, 1e4), MU, U(-1e6, 1e6)], 6],
  rel: () => { const t = leoState(); return [[...near(t, 50), ...t], 6]; },
  abs: () => [[U(-5e4, 5e4), U(-5e4, 5e4), U(-5e4, 5e4), U(-50, 50), U(-50, 50), U(-50, 50), ...leoState()], 6],
  basis: () => [leoState(), 9],
  orbit_info: () => [[...leoState(), MU, RE], 7],
  ephem: () => [[T0 + U(-3e9, 3e9)], 25],
  sun_fraction: () => { const r = leoState().slice(0, 3), e = (T0 + U(-1e9, 1e9)); A.IO[0] = e; A.ex.ephem(); const s = [A.IO[0], A.IO[1], A.IO[2]]; return [[...r, ...s], 1]; },
  lat_lon: () => [[...leoState().slice(0, 3), T0 + U(-1e9, 1e9)], 2],
  dose: () => [[U(-90, 90), U(-180, 180), U(0, 3) * (rnd() > 0.5 ? 1 : 0), rnd() > 0.7 ? 1 : 0, U(0, 1)], 2],
  thermal: () => [[U(150, 400), U(0.1, 60), U(1, 100), U(0, 5000), U(0, 1), U(0.1, 1), U(1e3, 1e6), U(50, 200)], 3],
  site: () => [[U(-90, 90), U(-180, 180), T0 + U(-1e9, 1e9)], 3],
  elevation: () => { const s = leoState().slice(0, 3); const site = s.map(x => x * RE / Math.hypot(...s) + U(-500, 500)); return [[...s, ...site], 1]; },
  intercept: () => { const c = circ(), t = T0 + U(0, 1e5); A.IO.set([...c, t], 0); A.ex.circ(); const tg = Array.from(A.IO.slice(0, 6)); return [[...near(tg, 30), ...c, U(-50, 50), U(-5, 5), U(-5, 5), t, U(300, 6000)], 9]; },
  closest: () => { const c = circ(), t = T0 + U(0, 1e5); A.IO.set([...c, t], 0); A.ex.circ(); const tg = Array.from(A.IO.slice(0, 6)); const n = Math.floor(U(2, 260)); return [[...near(tg, 20), ...c, t, U(60, 6000), n], 100 + 3 * Math.max(2, n)]; },
  passes: () => [[...circ(), U(-60, 60), U(-180, 180), T0 + U(0, 1e7), U(3600, 4 * 3600), U(0, 20)], 1 + 4 * 48],
};
const heavy = process.env.FULL ? {} : { closest: 0.1, intercept: 0.3, passes: 0.05 };  // FULL=1 runs every export at the full count

const bits = (x) => { const b = new BigUint64Array(new Float64Array([x]).buffer)[0]; return b; };
let total = 0, fails = 0;
const nativeCases = [];
const hex = (x) => bits(x).toString(16);
for (const [name, gen] of Object.entries(gens)) {
  const n = Math.max(200, Math.round(CASES * (heavy[name] || 1)));
  let bad = 0, first = null;
  for (let c = 0; c < n; c++) {
    const [inp, outN] = gen();
    A.IO.fill(0, 0, 8192); B.IO.fill(0, 0, 8192);
    A.IO.set(inp, 0); B.IO.set(inp, 0);
    A.ex[name](); B.ex[name]();
    if (nativePath) nativeCases.push({ name, inp, outN, out: Array.from(B.IO.slice(0, outN), hex) });
    for (let k = 0; k < outN; k++) {
      const a = A.IO[k], b = B.IO[k];
      if (!(Number.isNaN(a) && Number.isNaN(b)) && bits(a) !== bits(b)) { bad++; if (!first) first = { inp, k, a, b }; break; }
    }
  }
  total += n; fails += bad;
  console.log((bad ? 'FAIL ' : 'ok   ') + name.padEnd(13) + String(n).padStart(6) + ' cases' + (bad ? `  ${bad} mismatched; first at slot ${first.k}: ${first.a} vs ${first.b}\n      input ${JSON.stringify(first.inp)}` : ''));
}
if (nativePath) {
  const text = nativeCases.map(c => `${c.name} ${c.inp.length} ${c.inp.map(hex).join(' ')} ${c.outN}`).join('\n') + '\n';
  const res = spawnSync(nativePath, { input: text, maxBuffer: 1 << 30 });
  const lines = res.stdout.toString().trim().split('\n');
  let nbad = 0;
  nativeCases.forEach((c, i) => {
    const got = (lines[i] || '').trim().split(' ');
    if (c.out.some((h, k) => h !== got[k] && !(Number.isNaN(B.IO[0]) && false))) { if (!nbad) console.log('native mismatch: ' + c.name + ' ' + JSON.stringify(c.inp)); nbad++; }
  });
  console.log(nbad ? `native: ${nbad} of ${nativeCases.length} cases differ` : `native: all ${nativeCases.length} cases bit-identical to WebAssembly`);
  fails += nbad;
}
console.log(fails ? `\n${fails} of ${total} cases differ` : `\nall ${total} cases bit-identical`);
process.exit(fails ? 1 : 0);
