// Procedural spacecraft: the salvage tug (with a cutaway crew deck), the cargo pod and
// Haven Commercial station. Parts are tagged with the hangar module that builds them.
import * as THREE from 'three/webgpu';
import { Fn, uniform, vec3, float, length, uv, exp, smoothstep, mix, sin, time } from 'three/tsl';
import { mats } from './materials';

let TAG = '';
export function setTag(t: string) { TAG = t; }

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D | null, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.userData.mod = TAG;
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

/** Additive round glow sprite; userData.uI is its intensity uniform. */
export function glowSprite(col: THREE.Color, size: number, intensity = 4) {
  const s = new THREE.Sprite(new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const uI = uniform(intensity);
  (s.material as any).colorNode = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2);
    return vec3(col.r, col.g, col.b).mul(exp(d.mul(d).mul(-7)).mul(smoothstep(1, 0.6, d))).mul(uI);
  })();
  s.scale.setScalar(size);
  s.userData.uI = uI; s.userData.mod = TAG;
  s.renderOrder = 5;
  return s;
}

/** Square lattice truss between two points. */
export function truss(parent: THREE.Object3D, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, half: number, mat: THREE.Material) {
  const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2), g = new THREE.Group();
  parent.add(g); g.position.copy(a); g.lookAt(b);
  const len = a.distanceTo(b);
  for (const [x, y] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
    const r = mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 6), mat, g, x, y, len / 2); r.rotation.x = Math.PI / 2;
  }
  const n = Math.max(2, Math.round(len / (half * 2)));
  for (let k = 0; k <= n; k++) {
    const z = len * k / n;
    for (const [x, y, vert] of [[0, -half, 0], [0, half, 0], [-half, 0, 1], [half, 0, 1]]) {
      const r = mesh(new THREE.CylinderGeometry(0.03, 0.03, half * 2, 5), mat, g, x, y, z);
      r.rotation.z = vert ? 0 : Math.PI / 2;
    }
  }
  return g;
}

export interface Tug {
  group: THREE.Group; trim: THREE.Group; arm: THREE.Group; armJoints: THREE.Group[];
  plume: THREE.Mesh; plumeMat: THREE.MeshBasicNodeMaterial; rcs: THREE.Sprite[]; nav: THREE.Sprite[];
  strobe: THREE.Sprite; spot: THREE.SpotLight; shell: THREE.Mesh[]; interior: THREE.Group;
  roomLights: THREE.PointLight[]; crew: THREE.Group[];
}

export function makeTug(accent = 0x7fd4ff): Tug {
  const M = mats(), group = new THREE.Group();
  const betaD = M.beta.clone(); betaD.side = THREE.DoubleSide;
  const panelD = M.panel.clone(); panelD.side = THREE.DoubleSide;
  const trim = new THREE.Group(); group.add(trim);
  const hull = new THREE.Group(); group.add(hull);
  TAG = 'frame';
  // Hull built from quarter panels so the side facing the camera can be hidden (cutaway).
  const shell: THREE.Mesh[] = [];
  const quarter = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number, sy = 1) => {
    const q = mesh(geo, mat, hull, 0, 0, z);
    q.rotation.x = Math.PI / 2; q.scale.set(1, sy, 1);
    geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new THREE.Vector3()).applyEuler(q.rotation);
    q.userData.dir = new THREE.Vector2(c.x, c.y).normalize();
    shell.push(q);
    return q;
  };
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, w = Math.PI / 2;
    quarter(new THREE.CylinderGeometry(2, 2, 6.4, 14, 1, true, a, w), betaD, 0.2);
    quarter(new THREE.SphereGeometry(2, 14, 12, a, w, 0, Math.PI / 2), panelD, 3.4, 0.55);
    quarter(new THREE.CylinderGeometry(2, 1.6, 0.8, 14, 1, true, a, w), panelD, -3.4);
  }
  mesh(new THREE.TorusGeometry(0.75, 0.12, 12, 40), M.truss, group, 0, 0, 4.48);
  mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.25, 32), M.dark, group, 0, 0, 4.4).rotation.x = Math.PI / 2;
  for (let k = -2; k <= 2; k++) {
    const w = mesh(new THREE.BoxGeometry(0.42, 0.26, 0.05), M.glass, trim, Math.sin(k * 0.33) * 1.55, 0.95, 3.4 + Math.cos(k * 0.33) * 0.7);
    w.lookAt(new THREE.Vector3(Math.sin(k * 0.33) * 4, 2.3, 6)); w.castShadow = false;
  }
  for (const z of [-2.6, -0.5, 1.6]) mesh(new THREE.TorusGeometry(2.02, 0.05, 6, 64), M.truss, trim, 0, 0, z);
  for (const a of [0.7, -0.7, 2.4, -2.4]) {
    const h = mesh(new THREE.CylinderGeometry(0.025, 0.025, 5.4, 6), M.yellow, trim, Math.sin(a) * 2.12, Math.cos(a) * 2.12, 0.3);
    h.rotation.x = Math.PI / 2;
  }
  const accentMat = new THREE.MeshStandardNodeMaterial({ color: accent, metalness: 0.2, roughness: 0.45 });
  mesh(new THREE.CylinderGeometry(2.025, 2.025, 0.35, 48, 1, true), accentMat, trim, 0, 0, 2.3).rotation.x = Math.PI / 2;

  TAG = 'prop';
  for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) truss(group, x * 1.1, y * 1.1, -3.8, x * 1.1, y * 1.1, -8.4, 0.12, M.truss);
  mesh(new THREE.BoxGeometry(2.6, 2.6, 0.18), M.panel, group, 0, 0, -3.9);
  mesh(new THREE.BoxGeometry(2.6, 2.6, 0.18), M.panel, group, 0, 0, -8.3);
  for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) mesh(new THREE.SphereGeometry(1, 32, 20), M.mli, group, x * 1.25, y * 1.25, -6.1);
  mesh(new THREE.CylinderGeometry(0.55, 0.55, 4.2, 24), M.mliSilver, group, 0, 0, -6.1).rotation.x = Math.PI / 2;
  const prof: THREE.Vector2[] = [];
  for (let k = 0; k <= 16; k++) { const t = k / 16; prof.push(new THREE.Vector2(0.28 + 0.62 * Math.pow(t, 1.6), -t * 1.5)); }
  mesh(new THREE.LatheGeometry(prof, 40), M.nozzle, group, 0, 0, -8.5).rotation.x = -Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.5, 0.35, 0.6, 20), M.dark, group, 0, 0, -8.5).rotation.x = Math.PI / 2;
  const plumeMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const uP = uniform(0);
  plumeMat.colorNode = Fn(() => {
    const y = uv().y, flick = sin(time.mul(60)).mul(0.08).add(0.92);
    return mix(vec3(1.2, 1.6, 3.2), vec3(0.4, 0.6, 2), y).mul(float(1).sub(y)).mul(uP).mul(flick);
  })();
  plumeMat.userData.u = uP;
  const plume = mesh(new THREE.ConeGeometry(0.9, 7, 24, 1, true), plumeMat, group, 0, 0, -13.4, false);
  plume.rotation.x = -Math.PI / 2;

  TAG = 'power';
  for (const s of [1, -1]) {
    const boom = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8), M.truss, group, 0, s * 2.6, -6.1);
    boom.position.y = s * 2.6;
    const rad = mesh(new THREE.BoxGeometry(1.6, 0.06, 6.5), M.radiator, group, 0, s * 4.9, -6.1);
    rad.rotation.z = Math.PI / 2;
  }
  for (const s of [1, -1]) {
    const boom = mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), M.truss, group, s * 3.2, 0, -4.8);
    boom.rotation.z = Math.PI / 2;
    const wing = new THREE.Group(); wing.position.set(s * 4.6, 0, -4.8); group.add(wing);
    for (let k = 0; k < 4; k++) {
      mesh(new THREE.BoxGeometry(2.3, 0.04, 2.3), M.solar, wing, s * (1.25 + k * 2.4), 0, 0);
      mesh(new THREE.BoxGeometry(2.3, 0.02, 2.3), M.solarBack, wing, s * (1.25 + k * 2.4), -0.035, 0);
    }
    mesh(new THREE.BoxGeometry(9.8, 0.08, 0.12), M.truss, wing, s * 4.8, 0, 1.2);
    mesh(new THREE.BoxGeometry(9.8, 0.08, 0.12), M.truss, wing, s * 4.8, 0, -1.2);
  }

  TAG = 'prop';
  const rcs: THREE.Sprite[] = [];
  for (const [x, y] of [[2.1, 0], [-2.1, 0], [0, 2.1], [0, -2.1]]) {
    mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), M.dark, group, x * 1.03, y * 1.03, 2.9);
    for (const dz of [0.35, -0.35]) {
      const g = glowSprite(new THREE.Color(0.85, 0.9, 1), 0.9, 6);
      g.position.set(x * 1.15, y * 1.15, 2.9 + dz); g.visible = false; group.add(g); rcs.push(g);
    }
  }

  TAG = 'arm';
  const arm = new THREE.Group(); arm.position.set(0, 2.15, 1.2); group.add(arm);
  mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.4, 16), M.white, arm, 0, 0.1, 0);
  const j1 = new THREE.Group(); j1.position.y = 0.3; arm.add(j1);
  mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.2, 12), M.white, j1, 0, 0, 1.6).rotation.x = Math.PI / 2;
  const j2 = new THREE.Group(); j2.position.z = 3.2; j1.add(j2);
  mesh(new THREE.SphereGeometry(0.2, 16, 12), M.dark, j2);
  mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.8, 12), M.white, j2, 0, 0, 1.4).rotation.x = Math.PI / 2;
  const j3 = new THREE.Group(); j3.position.z = 2.8; j2.add(j3);
  mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.45, 16), M.dark, j3, 0, 0, 0.2).rotation.x = Math.PI / 2;
  j1.rotation.x = -0.35; j2.rotation.x = 0.9;

  TAG = 'frame';
  const navR = glowSprite(new THREE.Color(3, 0.15, 0.1), 0.8, 3); navR.position.set(-14.3, 0, -4.8); group.add(navR);
  const navG = glowSprite(new THREE.Color(0.15, 3, 0.4), 0.8, 3); navG.position.set(14.3, 0, -4.8); group.add(navG);
  const strobe = glowSprite(new THREE.Color(4, 4, 4), 1.4, 5); strobe.position.set(0, 2.4, -1.5); group.add(strobe);
  const spot = new THREE.SpotLight(0xfff0dc, 900, 160, 0.38, 0.45, 1.6);
  spot.position.set(0, -1.2, 4); spot.target.position.set(0, -2, 60); group.add(spot, spot.target);
  const lamp = glowSprite(new THREE.Color(1, 0.95, 0.85), 1, 3); lamp.position.set(0, -1.2, 4.1); group.add(lamp);

  TAG = 'life';
  const interior = new THREE.Group(); interior.visible = false; group.add(interior);
  mesh(new THREE.BoxGeometry(3.4, 0.08, 6), M.floor, interior, 0, -1.05, 0.2, false);
  for (const z of [-2, -0.2, 1.6]) mesh(new THREE.BoxGeometry(3.4, 2.4, 0.06), M.wallIn, interior, 0, 0.1, z, false);
  const innerWall = new THREE.MeshStandardNodeMaterial({ color: 0xcfc4b4, roughness: 0.85, side: THREE.BackSide });
  mesh(new THREE.CylinderGeometry(1.92, 1.92, 6.3, 40, 1, true), innerWall, interior, 0, 0, 0.2, false).rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(2.6, 0.5, 0.6), M.console, interior, 0, -0.35, 3, false).rotation.x = -0.4;
  for (const x of [-0.6, 0.6]) mesh(new THREE.BoxGeometry(0.55, 0.9, 0.55), M.fabric, interior, x, -0.55, 2.2, false);
  mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 20), M.wallIn, interior, 0, -0.4, 0.7, false);
  for (const x of [-1.2, 1.2]) mesh(new THREE.BoxGeometry(0.7, 0.35, 1.6), M.fabric, interior, x, -0.8, 0.7, false);
  mesh(new THREE.BoxGeometry(1.8, 0.1, 0.6), M.panel, interior, -0.5, -0.3, -1.1, false);
  mesh(new THREE.BoxGeometry(0.9, 1.2, 0.5), M.console, interior, 1.1, -0.4, -1.1, false);
  for (const x of [-0.7, 0.7]) mesh(new THREE.CapsuleGeometry(0.28, 0.9, 6, 12), M.white, interior, x, 0, -2.7, false);
  const roomLights: THREE.PointLight[] = [];
  for (const [z, col, inten] of [[2.6, 0x9fd8ff, 7], [0.7, 0xffb066, 9], [-1.1, 0xffcf8a, 8], [-2.7, 0xff9a62, 6]]) {
    const L = new THREE.PointLight(col, inten, 4.5, 2); L.position.set(0, 0.8, z); interior.add(L); roomLights.push(L);
    const g = glowSprite(new THREE.Color(col), 0.35, 2); g.position.set(0, 0.95, z); interior.add(g);
  }
  const crew: THREE.Group[] = [], tints = [0x7fd4ff, 0xffb347, 0x9be7a8, 0xe7a3ff];
  for (let k = 0; k < 4; k++) {
    const c = new THREE.Group();
    mesh(new THREE.CapsuleGeometry(0.19, 0.55, 6, 12), new THREE.MeshStandardNodeMaterial({ color: 0x3c4552, roughness: 0.8 }), c, 0, 0.45, 0, false);
    mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardNodeMaterial({ color: 0xe0b89a, roughness: 0.7 }), c, 0, 1, 0, false);
    mesh(new THREE.BoxGeometry(0.4, 0.06, 0.05), new THREE.MeshStandardNodeMaterial({ color: tints[k], roughness: 0.5, emissive: new THREE.Color(tints[k]), emissiveIntensity: 0.3 }), c, 0, 0.68, 0.17, false);
    c.position.set([-0.6, 0, -0.5, 0.7][k], -1, [2.2, 0.7, -1.1, -2.6][k]);
    interior.add(c); crew.push(c);
  }
  TAG = '';
  group.traverse((o: any) => { if (o.isMesh && o.material && !o.material.transparent) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; } });
  return { group, trim, arm, armJoints: [j1, j2, j3], plume, plumeMat, rcs, nav: [navR, navG], strobe, spot, shell, interior, roomLights, crew };
}

export function makePod() {
  const M = mats(), g = new THREE.Group();
  mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 32), M.mli, g).rotation.x = Math.PI / 2;
  for (const z of [1.35, -1.35]) mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 32), M.white, g, 0, 0, z).rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.5, 16), M.dark, g, 0, 0, 1.6).rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), M.yellow, g, 0, 0, 1.86);
  const beacon = glowSprite(new THREE.Color(4, 1.6, 0.3), 0.9, 4); beacon.position.set(0, 1.25, 0); g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}

/** A dead satellite: box bus, one torn solar wing, a dish. */
export function makeDeadSat() {
  const M = mats(), g = new THREE.Group();
  mesh(new THREE.BoxGeometry(1.4, 1.4, 1.8), M.mli, g);
  mesh(new THREE.CylinderGeometry(0.5, 0.1, 0.3, 20), M.white, g, 0, 0.9, 0.3);
  const w = new THREE.Group(); w.position.set(0.9, 0, 0); w.rotation.z = 0.5; g.add(w);
  for (let k = 0; k < 2; k++) mesh(new THREE.BoxGeometry(1.8, 0.03, 1.2), M.solar, w, 1 + k * 1.9, 0, 0);
  const beacon = glowSprite(new THREE.Color(4, 1.6, 0.3), 0.6, 2); beacon.position.set(0, 1.1, 0); g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}

export function makeStation() {
  const M = mats(), g = new THREE.Group();
  const seg = (len: number, r: number, z: number, mat: THREE.Material = M.beta) => {
    const m = mesh(new THREE.CylinderGeometry(r, r, len, 40), mat, g, 0, 0, z); m.rotation.x = Math.PI / 2;
    for (const e of [z - len / 2, z + len / 2]) mesh(new THREE.TorusGeometry(r + 0.02, 0.07, 6, 48), M.truss, g, 0, 0, e);
    return m;
  };
  seg(9, 2.1, 0); seg(7.5, 2.1, 9.2); seg(6, 1.8, -8.2); seg(4, 1.4, 15.5, M.panel);
  mesh(new THREE.SphereGeometry(2.4, 32, 20), M.beta, g, 0, 0, 4.6);
  mesh(new THREE.CylinderGeometry(1.8, 1.8, 7, 32), M.beta, g, 0, 5.6, 4.6);
  truss(g, -38, 2.8, 4.6, 38, 2.8, 4.6, 0.5, M.truss);
  for (const s of [1, -1]) {
    for (const x of [22, 34]) {
      const a = new THREE.Group(); a.position.set(s * x, 2.8, 4.6); g.add(a);
      for (const c of [1, -1]) {
        mesh(new THREE.BoxGeometry(4.2, 0.05, 15), M.solar, a, 0, 0, c * 8.6);
        mesh(new THREE.BoxGeometry(4.2, 0.03, 15), M.solarBack, a, 0, -0.04, c * 8.6);
        mesh(new THREE.CylinderGeometry(0.08, 0.08, 17, 8), M.truss, a, 0, 0.05, c * 8.6).rotation.x = Math.PI / 2;
      }
    }
    for (const x of [9, 13]) mesh(new THREE.BoxGeometry(3, 0.08, 11), M.radiator, g, s * x, -3.6, 4.6);
  }
  const beacon = glowSprite(new THREE.Color(3, 3, 3.6), 1.6, 4); beacon.position.set(0, 2.2, 17.6); g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}
