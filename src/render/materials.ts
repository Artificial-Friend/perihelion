// Procedural canvas textures for spacecraft (MLI, beta cloth, solar cells, radiators,
// panels) turned into PBR node materials. Built once and shared.
import * as THREE from 'three/webgpu';

export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function tex(c: HTMLCanvasElement, srgb: boolean, rep = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
/** Height canvas -> tangent-space normal map canvas. */
function normalFrom(src: HTMLCanvasElement, k: number) {
  const w = src.width, h = src.height, d = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, g] = canvas2d(w, h), img = g.createImageData(w, h), o = img.data;
  const H = (x: number, y: number) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * k, dy = (H(x, y + 1) - H(x, y - 1)) * k, l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (-dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export type Mats = Record<'beta' | 'mli' | 'mliSilver' | 'solar' | 'solarBack' | 'radiator' | 'panel' | 'white' | 'dark' | 'truss' | 'nozzle' | 'glass' | 'yellow' | 'red' | 'floor' | 'wallIn' | 'console' | 'fabric', THREE.MeshStandardNodeMaterial>;
let cache: Mats | null = null;

export function mats(): Mats {
  if (cache) return cache;
  // MLI crinkle
  const [mc, mg] = canvas2d(512, 512), r1 = rng(7);
  mg.fillStyle = '#808080'; mg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = r1() * 512, y = r1() * 512, s = 8 + r1() * 40, v = 90 + r1() * 90;
    mg.fillStyle = `rgb(${v},${v},${v})`; mg.beginPath();
    const n = 5 + Math.floor(r1() * 4);
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + r1() * 0.6, rr = s * (0.6 + r1() * 0.6); mg.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    mg.closePath(); mg.globalAlpha = 0.35; mg.fill(); mg.globalAlpha = 1;
  }
  mg.strokeStyle = 'rgba(40,40,40,0.5)'; mg.lineWidth = 1.2;
  for (let i = 0; i < 160; i++) {
    mg.beginPath(); let x = r1() * 512, y = r1() * 512; mg.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (r1() - 0.5) * 70; y += (r1() - 0.5) * 70; mg.lineTo(x, y); }
    mg.stroke();
  }
  const mliN = tex(normalFrom(mc, 3.2), false, 2);
  const [rc, rg] = canvas2d(256, 256), r2 = rng(3);
  rg.fillStyle = '#3a3a3a'; rg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) { const v = 30 + r2() * 70; rg.fillStyle = `rgb(${v},${v},${v})`; rg.fillRect(r2() * 256, r2() * 256, 6 + r2() * 30, 6 + r2() * 30); }
  const mliR = tex(rc, false, 2);
  // Beta cloth with seams
  const [bc, bg] = canvas2d(1024, 1024), r3 = rng(11);
  bg.fillStyle = '#d9d6cf'; bg.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 3000; i++) { const v = 200 + r3() * 30; bg.fillStyle = `rgba(${v},${v - 3},${v - 8},0.15)`; bg.fillRect(r3() * 1024, r3() * 1024, 2 + r3() * 10, 2 + r3() * 10); }
  bg.strokeStyle = 'rgba(90,85,78,0.55)'; bg.lineWidth = 3;
  for (let x = 0; x <= 1024; x += 256) { bg.beginPath(); bg.moveTo(x, 0); bg.lineTo(x, 1024); bg.stroke(); }
  for (let y = 0; y <= 1024; y += 128) { bg.beginPath(); bg.moveTo(0, y); bg.lineTo(1024, y); bg.stroke(); }
  bg.strokeStyle = 'rgba(120,112,100,0.35)'; bg.lineWidth = 1; bg.setLineDash([4, 5]);
  for (let x = 0; x <= 1024; x += 256) { bg.beginPath(); bg.moveTo(x + 7, 0); bg.lineTo(x + 7, 1024); bg.stroke(); }
  bg.setLineDash([]);
  for (let i = 0; i < 40; i++) { bg.fillStyle = 'rgba(60,55,50,0.06)'; bg.beginPath(); bg.arc(r3() * 1024, r3() * 1024, 20 + r3() * 90, 0, 7); bg.fill(); }
  const betaMap = tex(bc, true, 1);
  const [bs] = canvas2d(512, 512); bs.getContext('2d')!.drawImage(bc, 0, 0, 512, 512);
  const betaN = tex(normalFrom(bs, 1.4), false, 1);
  // Solar cells
  const [sc, sg] = canvas2d(512, 512);
  sg.fillStyle = '#0b1530'; sg.fillRect(0, 0, 512, 512);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const x = i * 64, y = j * 64, gr = sg.createLinearGradient(x, y, x + 64, y + 64);
    gr.addColorStop(0, '#13265a'); gr.addColorStop(1, '#0a1838'); sg.fillStyle = gr; sg.fillRect(x + 2, y + 2, 60, 60);
    sg.strokeStyle = 'rgba(160,170,190,0.35)'; sg.lineWidth = 0.7;
    for (let k = 1; k < 6; k++) { sg.beginPath(); sg.moveTo(x + 2, y + k * 10.5); sg.lineTo(x + 62, y + k * 10.5); sg.stroke(); }
  }
  sg.fillStyle = '#c0c4cc';
  for (let k = 0; k <= 8; k++) { sg.fillRect(k * 64 - 1, 0, 2, 512); sg.fillRect(0, k * 64 - 1, 512, 2); }
  const solarMap = tex(sc, true, 1);
  // Radiator
  const [dc, dg] = canvas2d(512, 512);
  dg.fillStyle = '#e8eaec'; dg.fillRect(0, 0, 512, 512);
  for (let x = 16; x < 512; x += 32) { dg.fillStyle = '#c9ccd1'; dg.fillRect(x - 3, 0, 6, 512); dg.fillStyle = '#f6f7f8'; dg.fillRect(x - 1, 0, 2, 512); }
  dg.fillStyle = '#b4b8be'; dg.fillRect(0, 0, 512, 10); dg.fillRect(0, 502, 512, 10);
  const radMap = tex(dc, true, 1);
  const [hc] = canvas2d(256, 256), hg = hc.getContext('2d')!;
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, 256, 256);
  for (let x = 8; x < 256; x += 16) { const gr = hg.createLinearGradient(x - 4, 0, x + 4, 0); gr.addColorStop(0, '#808080'); gr.addColorStop(0.5, '#e0e0e0'); gr.addColorStop(1, '#808080'); hg.fillStyle = gr; hg.fillRect(x - 4, 0, 8, 256); }
  const radN = tex(normalFrom(hc, 2), false, 1);
  // Panel
  const [pc, pg] = canvas2d(512, 512), r4 = rng(19);
  pg.fillStyle = '#9aa0a8'; pg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2000; i++) { const v = 140 + r4() * 30; pg.fillStyle = `rgba(${v},${v + 4},${v + 10},0.12)`; pg.fillRect(r4() * 512, r4() * 512, 3, 3); }
  pg.strokeStyle = 'rgba(40,44,50,0.7)'; pg.lineWidth = 2;
  for (let x = 0; x <= 512; x += 128) { pg.beginPath(); pg.moveTo(x, 0); pg.lineTo(x, 512); pg.stroke(); }
  for (let y = 0; y <= 512; y += 64) { pg.beginPath(); pg.moveTo(0, y); pg.lineTo(512, y); pg.stroke(); }
  pg.fillStyle = 'rgba(30,30,30,0.6)';
  for (let x = 0; x <= 512; x += 128) for (let y = 0; y <= 512; y += 64) { pg.fillRect(x + 4, y + 4, 2, 2); pg.fillRect(x + 122, y + 4, 2, 2); }
  const panelMap = tex(pc, true, 1);

  const M = (o: any) => new THREE.MeshStandardNodeMaterial(o);
  cache = {
    beta: M({ map: betaMap, normalMap: betaN, roughness: 0.82, metalness: 0, color: 0xffffff }),
    mli: M({ color: 0xd9a441, metalness: 1, roughness: 0.32, roughnessMap: mliR, normalMap: mliN, normalScale: new THREE.Vector2(0.9, 0.9) }),
    mliSilver: M({ color: 0xd8dde4, metalness: 1, roughness: 0.28, roughnessMap: mliR, normalMap: mliN }),
    solar: M({ map: solarMap, metalness: 0.6, roughness: 0.25, color: 0xffffff }),
    solarBack: M({ color: 0xd8d4c8, metalness: 0, roughness: 0.7 }),
    radiator: M({ map: radMap, normalMap: radN, metalness: 0.05, roughness: 0.45 }),
    panel: M({ map: panelMap, metalness: 0.55, roughness: 0.48 }),
    white: M({ color: 0xe9e8ec, metalness: 0.1, roughness: 0.55 }),
    dark: M({ color: 0x24272c, metalness: 0.7, roughness: 0.42 }),
    truss: M({ color: 0xb8bcc4, metalness: 0.85, roughness: 0.35 }),
    nozzle: M({ color: 0x2b2522, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }),
    glass: M({ color: 0x0a0f16, metalness: 0.2, roughness: 0.05, emissive: new THREE.Color(0xffb070), emissiveIntensity: 0.6 }),
    yellow: M({ color: 0xe8b52a, metalness: 0.2, roughness: 0.5 }),
    red: M({ color: 0xb8322a, metalness: 0.2, roughness: 0.55 }),
    floor: M({ color: 0x6b6258, roughness: 0.85, side: THREE.DoubleSide }),
    wallIn: M({ color: 0xd8d0c2, roughness: 0.8, side: THREE.DoubleSide }),
    console: M({ color: 0x2a2f36, roughness: 0.5, metalness: 0.3, emissive: new THREE.Color(0x58b8ff), emissiveIntensity: 0.25 }),
    fabric: M({ color: 0x8a5a3c, roughness: 0.9 }),
  };
  return cache;
}
