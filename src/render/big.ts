// Larger craft for Stages 3-4: the torch hauler and the sovereign station ring.
import * as THREE from 'three/webgpu';
import { Fn, uniform, vec3, float, uv, mix, sin, time } from 'three/tsl';
import { mats } from './materials';
import { mesh, glowSprite, truss } from './ships';

export interface Hauler { group: THREE.Group; plume: THREE.Mesh; uPlume: any; cargo: THREE.Group }

export function makeHauler(): Hauler {
  const M = mats(), g = new THREE.Group();
  // Spine along +z (forward). Crew module at the nose, cargo racks mid, torch aft.
  truss(g, 0, 0, -30, 0, 0, 34, 0.9, M.truss);
  const nose = mesh(new THREE.CylinderGeometry(3, 3.4, 9, 32), M.beta, g, 0, 0, 38); nose.rotation.x = Math.PI / 2;
  mesh(new THREE.SphereGeometry(3, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.panel, g, 0, 0, 42.5).rotation.x = Math.PI / 2;
  for (const z of [36, 40]) mesh(new THREE.TorusGeometry(3.45, 0.12, 8, 48), M.truss, g, 0, 0, z);
  const glass = mesh(new THREE.BoxGeometry(2.4, 0.5, 0.2), M.glass, g, 0, 1.8, 44.4); glass.rotation.x = -0.6;
  const cargo = new THREE.Group(); g.add(cargo);
  const cmats = [M.yellow, M.white, M.red, M.panel];
  for (let k = 0; k < 6; k++) for (let a = 0; a < 4; a++) {
    const ang = a * Math.PI / 2 + Math.PI / 4;
    const c = mesh(new THREE.BoxGeometry(3, 3, 7), cmats[(k + a) % 4], cargo, Math.cos(ang) * 3.3, Math.sin(ang) * 3.3, 24 - k * 7.6);
    c.rotation.z = ang;
  }
  // Shielded reactor and the torch.
  const shield = mesh(new THREE.CylinderGeometry(4.2, 4.2, 1.2, 40), M.dark, g, 0, 0, -22); shield.rotation.x = Math.PI / 2;
  mesh(new THREE.SphereGeometry(3, 32, 20), M.mliSilver, g, 0, 0, -27);
  const prof: THREE.Vector2[] = [];
  for (let k = 0; k <= 16; k++) { const t = k / 16; prof.push(new THREE.Vector2(0.8 + 3.2 * Math.pow(t, 1.4), -t * 6)); }
  mesh(new THREE.LatheGeometry(prof, 48), M.nozzle, g, 0, 0, -30).rotation.x = -Math.PI / 2;
  for (const s of [1, -1]) {
    const w = mesh(new THREE.BoxGeometry(26, 0.12, 9), M.radiator, g, s * 17, 0, -14);
    w.rotation.z = s * 0.08;
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 4, 8), M.truss, g, s * 3, 0, -14).rotation.z = Math.PI / 2;
  }
  const uPlume = uniform(0);
  const pm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  pm.colorNode = Fn(() => {
    const y = uv().y, f = sin(time.mul(40)).mul(0.06).add(0.94);
    return mix(vec3(2.4, 2.8, 4.5), vec3(0.6, 0.4, 2.2), y).mul(float(1).sub(y).pow(1.5)).mul(uPlume).mul(f);
  })();
  const plume = mesh(new THREE.ConeGeometry(4, 90, 32, 1, true), pm, g, 0, 0, -81, false);
  plume.rotation.x = -Math.PI / 2;
  const nav = glowSprite(new THREE.Color(0.4, 0.8, 4), 3, 4); nav.position.set(0, 4, 40); g.add(nav);
  return { group: g, plume, uPlume, cargo };
}

/** Sovereign station: a hub with a ring of eight module slots. */
export interface SovStation { group: THREE.Group; slots: THREE.Group[]; setSlot(i: number, mod: string | null, building: boolean): void; ring: THREE.Mesh }
export function makeSovStation(): SovStation {
  const M = mats(), g = new THREE.Group();
  const hub = mesh(new THREE.CylinderGeometry(4, 4, 14, 40), M.beta, g); hub.rotation.x = Math.PI / 2;
  mesh(new THREE.SphereGeometry(4, 32, 20), M.panel, g, 0, 0, 7);
  mesh(new THREE.SphereGeometry(4, 32, 20), M.panel, g, 0, 0, -7);
  const ring = mesh(new THREE.TorusGeometry(26, 1.2, 16, 120), M.white, g);
  for (let k = 0; k < 4; k++) { const sp = mesh(new THREE.CylinderGeometry(0.5, 0.5, 22, 10), M.truss, g); sp.rotation.z = k * Math.PI / 4; sp.position.set(0, 0, 0); sp.geometry.translate(0, 0, 0); sp.scale.set(1, 2.35, 1); }
  const bp = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.3, color: 0x4da3ff, depthWrite: false, blending: THREE.AdditiveBlending });
  const slots: THREE.Group[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, s = new THREE.Group();
    s.position.set(Math.cos(a) * 26, Math.sin(a) * 26, 0); s.rotation.z = a; g.add(s); slots.push(s);
  }
  const build = (mod: string): THREE.Object3D => {
    const o = new THREE.Group();
    switch (mod) {
      case 'hab': { const c = mesh(new THREE.CylinderGeometry(3.2, 3.2, 10, 32), M.beta, o, 4, 0, 0); c.rotation.x = Math.PI / 2; for (const z of [-4, 0, 4]) mesh(new THREE.TorusGeometry(3.25, 0.12, 6, 40), M.truss, o, 4, 0, z); mesh(new THREE.BoxGeometry(0.4, 0.3, 6), M.glass, o, 7.2, 0, 0); break; }
      case 'dock': { mesh(new THREE.BoxGeometry(10, 2, 2), M.panel, o, 6, 0, 0); for (const z of [-3, 3]) { const p = mesh(new THREE.CylinderGeometry(1, 1, 3, 20), M.white, o, 11, 0, z); p.rotation.z = Math.PI / 2; } o.add(glowSprite(new THREE.Color(0.3, 2, 1.6), 2, 3)); o.children[o.children.length - 1].position.set(12.8, 0, 0); break; }
      case 'refinery': { mesh(new THREE.BoxGeometry(7, 5, 6), M.panel, o, 5, 0, 0); for (const z of [-2, 2]) { const t = mesh(new THREE.CylinderGeometry(1.2, 1.2, 6, 20), M.mli, o, 5, 3.6, z); t.rotation.z = Math.PI / 2; } const glow = glowSprite(new THREE.Color(3, 1.2, 0.3), 3, 2); glow.position.set(9, 0, 0); o.add(glow); break; }
      case 'radiator': { const w = mesh(new THREE.BoxGeometry(14, 0.1, 6), M.radiator, o, 8, 0, 0); w.rotation.x = Math.PI / 2; break; }
      case 'sensor': { mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 8), M.truss, o, 3, 0, 0).rotation.z = Math.PI / 2; const d = mesh(new THREE.SphereGeometry(3, 24, 12, 0, Math.PI * 2, 0, 0.9), M.white, o, 7, 0, 0); d.rotation.z = -Math.PI / 2; break; }
      case 'pd': { mesh(new THREE.BoxGeometry(3, 3, 3), M.dark, o, 3, 0, 0); for (const z of [-1, 1]) { const b = mesh(new THREE.CylinderGeometry(0.25, 0.25, 4, 10), M.truss, o, 6, 0.8, z); b.rotation.z = Math.PI / 2; } break; }
    }
    return o;
  };
  const station: SovStation = {
    group: g, slots, ring,
    setSlot(i, mod, building) {
      const s = slots[i], key = (mod || '') + (building ? '*' : '');
      if (s.userData.key === key) return;
      s.userData.key = key; s.clear();
      if (!mod) return;
      const o = build(mod);
      if (building) o.traverse((x: any) => { if (x.isMesh) x.material = bp; });
      s.add(o);
    },
  };
  return station;
}
