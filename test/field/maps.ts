// Renders each field region's height map to a PPM image for a visual check.
import fs from 'fs';
import { REC_REGIONS, HOP_REGIONS, Region } from '../../src/field/world';
const out = process.argv[2] || '.';
function render(r: Region, N = 300) {
  const buf: number[] = [];
  let lo = Infinity, hi = -Infinity;
  const hs: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -r.half + 2 * r.half * (i + .5) / N, y = r.half - 2 * r.half * (j + .5) / N, h = r.heightAt(x, y);
    hs.push(h); lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  for (const h of hs) {
    if (r.loc === 'earth') { if (h > 0) buf.push(90, 140, 80); else { const k = Math.min(1, -h / 1500); buf.push(20, 60 + 80 * (1 - k), 120 + 100 * (1 - k)); } }
    else { const k = (h - lo) / (hi - lo); buf.push(60 + 180 * k, 30 + 110 * k, 20 + 70 * k); }
  }
  fs.writeFileSync(`${out}/${r.id}.ppm`, Buffer.concat([Buffer.from(`P6 ${N} ${N} 255\n`), Buffer.from(buf.map(v => Math.max(0, Math.min(255, Math.round(v)))))]));
  console.log(r.id, 'height', Math.round(lo), Math.round(hi));
}
for (const r of [REC_REGIONS.earth, REC_REGIONS.mars, HOP_REGIONS.earth, HOP_REGIONS.mars]) render(r);
