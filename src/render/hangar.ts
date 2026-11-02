// The 3D hangar: a separate scene with the tug on cradles, one hull side open, crew at
// work, and unbuilt modules drawn as an animated blueprint that fills in as work finishes.
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, smoothstep, fract, positionWorld, time, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { mats } from './materials';
import { makeTug, glowSprite, Tug } from './ships';

export class HangarView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  pipeline: THREE.RenderPipeline;
  tug: Tug;
  blueprint: THREE.MeshBasicNodeMaterial;
  yaw = 1.15; pitch = 0.3; dist = 26;
  tYaw = 1.15; tPitch = 0.3; tDist = 26;
  parts: any[] = [];
  /** Representative world point of each module, for the infographic callouts. */
  anchors: Record<string, THREE.Vector3> = {};

  constructor(renderer: THREE.WebGPURenderer) {
    const s = this.scene, M = mats();
    s.background = new THREE.Color(0x0b1220);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshStandardNodeMaterial({ color: 0x3a4250, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const lineMat = new THREE.MeshStandardNodeMaterial({ color: 0x3d8bff, roughness: 0.7, emissive: new THREE.Color(0x1a4fb0), emissiveIntensity: 0.6 });
    for (const x of [-9, 9]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 40), lineMat); l.rotation.x = -Math.PI / 2; l.position.set(x, 0.01, 0); s.add(l); }
    // Floor circle + square: the hangar's own Vitruvian mark under the ship.
    const ring = new THREE.Mesh(new THREE.RingGeometry(11.8, 12, 128), lineMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.015; s.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(8.4, 8.5, 128), lineMat); ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.015; s.add(ring2);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(90, 34, 70), new THREE.MeshStandardNodeMaterial({ color: 0x1e2633, roughness: 0.85, side: THREE.BackSide }));
    walls.position.y = 17; s.add(walls);
    for (let k = -3; k <= 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(90, 0.6, 0.6), M.truss); b.position.set(0, 30, k * 9); s.add(b); }
    for (const [x, z] of [[-4.6, 1.2], [4.6, 1.2], [-4.6, -10.5], [4.6, -10.5]]) {
      for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 2.2), M.yellow); p.position.set(x, 1.5 + k * 2.5, z); s.add(p); }
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 8, 6), M.truss); p.position.set(x + dx, 4, z + dz); s.add(p); }
    }
    for (const [x, z, col, i] of [[-12, -10, 0xd8e8ff, 320], [12, -10, 0xffe0b0, 320], [-12, 12, 0xc8dcff, 260], [12, 12, 0xffe8c8, 260], [0, 0, 0xf2f6ff, 520]]) {
      const L = new THREE.PointLight(col, i, 60, 1.6); L.position.set(x, 24, z); s.add(L);
      const g = glowSprite(new THREE.Color(col), 2.4, 3); g.position.set(x, 24, z); s.add(g);
    }
    const key = new THREE.DirectionalLight(0xbfd4ff, 0.9);
    key.position.set(30, 25, 40); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 120 });
    s.add(key, new THREE.AmbientLight(0x3a5a8a, 0.35));

    this.tug = makeTug();
    const g = this.tug.group; g.position.y = 3.6; s.add(g);
    this.tug.interior.visible = true; this.tug.trim.visible = true;
    for (const q of this.tug.shell) if ((q.userData.dir as THREE.Vector2).x > 0.3) q.visible = false;
    this.tug.plume.visible = false;
    for (const r of this.tug.rcs) r.visible = false;
    for (const z of [-2.2, 2.4]) { const c = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.6, 0.8), M.dark); c.position.set(0, 0.8, z); s.add(c); }

    const bp = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    bp.colorNode = Fn(() => {
      const scan = smoothstep(0.92, 1, fract(positionWorld.y.mul(0.8).sub(time.mul(0.6))));
      const grid = smoothstep(0.94, 1, fract(positionWorld.y.mul(4))).add(smoothstep(0.94, 1, fract(positionWorld.x.mul(4))));
      return vec3(0.3, 0.75, 1).mul(float(0.08).add(grid.mul(0.25)).add(scan.mul(0.6)));
    })();
    this.blueprint = bp;
    const sums: Record<string, { v: THREE.Vector3; n: number }> = {};
    g.updateMatrixWorld(true);
    g.traverse((o: any) => {
      if (o.userData.mod && (o.isMesh || o.isSprite)) {
        o.userData.orig = o.material; this.parts.push(o);
        if (o.isMesh) {
          const p = o.getWorldPosition(new THREE.Vector3()), m = o.userData.mod;
          (sums[m] ??= { v: new THREE.Vector3(), n: 0 }); sums[m].v.add(p); sums[m].n++;
        }
      }
    });
    for (const k in sums) this.anchors[k] = sums[k].v.divideScalar(sums[k].n);
    this.tug.crew.forEach((c, k) => {
      const cc = c.clone();
      cc.position.set([6.5, -6, 4.6, 7.5][k], [0, 0, 4.06, 0][k], [4, 3, 1.2, -8][k]);
      cc.rotation.y = [-2.2, 2.4, -1.6, -0.6][k];
      s.add(cc);
    });
    this.pipeline = new THREE.RenderPipeline(renderer);
    const out = pass(s, this.camera, { samples: 4 } as any).getTextureNode('output');
    this.pipeline.outputNode = out.add(bloom(out, 0.22, 0.4, 0.9)).mul(0.85);
  }

  setBuilt(built: Record<string, boolean>, building: string | null) {
    for (const p of this.parts) {
      const m = p.userData.mod, done = !!built[m];
      if (p.isSprite) { p.visible = done; continue; }
      p.material = done ? p.userData.orig : this.blueprint;
      p.castShadow = done;
      p.visible = done || m !== 'life' || building === 'life';
    }
    this.tug.interior.visible = !!built.life || building === 'life';
  }

  step(dt: number) {
    const k = 1 - Math.exp(-dt * 5);
    this.yaw += (this.tYaw - this.yaw) * k; this.pitch += (this.tPitch - this.pitch) * k; this.dist += (this.tDist - this.dist) * k;
    const c = Math.cos(this.pitch);
    this.camera.position.set(Math.sin(this.yaw) * c * this.dist, 3.6 + Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * c * this.dist - 2);
    this.camera.lookAt(0, 3.6, -2);
  }
  resize(w: number, h: number) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  /** Screen position of a world point in this view, or null when behind the camera. */
  project(p: THREE.Vector3, W: number, H: number): [number, number] | null {
    const v = p.clone().project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  }
  render() { this.pipeline.render(); }
}
