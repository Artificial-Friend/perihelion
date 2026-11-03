// The world scene with a floating origin: the camera sits at (0,0,0) and everything is
// placed relative to it in metres, while simulation positions stay double-precision km.
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, dot, max, mix, smoothstep, normalize, positionLocal, uniform, length, step, abs, normalWorld, positionWorld, mx_fractal_noise_float, mx_worley_noise_float } from 'three/tsl';
import { core, V, Vec3, State, Ephem, AU, R_EARTH } from '../sim/core';
import { Gfx } from '../render/gfx';
import { Earth, EarthTex } from '../render/earth';
import { Stars } from '../render/stars';
import { makeTug, makePod, makeStation, makeDeadSat, glowSprite, Tug } from '../render/ships';
import { CamOut } from './camera';
import { SolarSystem, planetHelioAt, poleOf } from './system';
import { worldNow } from '../sim/clock';

export const KM = 1000; // scene units (m) per km

export const PLANETS = [
  { name: 'Mercury', r: 2439.7, col: 0x9a948c, period: 87.97 },
  { name: 'Venus', r: 6051.8, col: 0xe8d8a8, period: 224.7 },
  { name: 'Earth', r: 6371, col: 0x4f7bd8, period: 365.256 },
  { name: 'Mars', r: 3389.5, col: 0xc1663a, period: 686.98 },
  { name: 'Jupiter', r: 69911, col: 0xd4b48c, period: 4332.6 },
  { name: 'Saturn', r: 58232, col: 0xe2cd9c, period: 10759 },
  { name: 'Uranus', r: 25362, col: 0xa6dbe3, period: 30687 },
  { name: 'Neptune', r: 24622, col: 0x4f78d6, period: 60190 },
];

// Ring systems: inner and outer radius (km) and a radial opacity profile.
const RINGS: Record<string, [number, number]> = { Saturn: [74658, 140220], Uranus: [41837, 51149] };

export class WorldScene {
  gfx: Gfx;
  earth: Earth;
  stars: Stars;
  moon: THREE.Mesh;
  planets: (THREE.Mesh | null)[] = [];
  orbits: THREE.Line[] = [];
  moonOrbit: THREE.Line | null = null;
  tug: Tug;
  pod: THREE.Group;
  deadSat: THREE.Group;
  station: THREE.Group;
  uMoonSun = uniform(new THREE.Vector3(1, 0, 0));
  uPlanetSun = uniform(new THREE.Vector3(1, 0, 0));
  /** The Sun's camera-relative position (m): lighting for bodies far from Earth. */
  uSunRel = uniform(new THREE.Vector3(1, 0, 0));
  ghost: THREE.Line;
  q = new THREE.Quaternion();
  m = new THREE.Matrix4();
  cam!: CamOut;
  earthQuat = new THREE.Quaternion();
  sunGeo: Vec3 = [AU, 0, 0];
  objects: Record<string, THREE.Object3D> = {};
  system!: SolarSystem;

  constructor(gfx: Gfx, tex: EarthTex) {
    this.gfx = gfx;
    const s = gfx.scene;
    this.stars = new Stars(1e12); s.add(this.stars.mesh);
    this.earth = new Earth(tex, KM, 256); s.add(this.earth.group);
    const ms = this.uMoonSun, mm = new THREE.MeshBasicNodeMaterial();
    mm.colorNode = Fn(() => {
      const n = normalize(positionLocal);
      const maria = smoothstep(0.1, 0.45, mx_fractal_noise_float(n.mul(2.2), 4, 2, 0.5, 1));
      const craters = mx_worley_noise_float(n.mul(18)).mul(0.25).add(mx_worley_noise_float(n.mul(60)).mul(0.15));
      return mix(vec3(0.42, 0.41, 0.39), vec3(0.18, 0.18, 0.19), maria).mul(float(0.8).add(craters)).mul(max(dot(n, ms), 0)).mul(3);
    })();
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1737.4 * KM, 96, 48), mm); s.add(this.moon);
    const sr = this.uSunRel, ps = normalize(sr.sub(positionWorld));
    for (const p of PLANETS) {
      if (p.name === 'Earth') { this.planets.push(null); continue; }
      const mat = new THREE.MeshBasicNodeMaterial(), c = new THREE.Color(p.col);
      mat.colorNode = Fn(() => {
        const n = normalize(positionLocal);
        // Bands run around the local z axis, which the mesh turns to the planet's north pole.
        const bands = p.name === 'Jupiter' || p.name === 'Saturn'
          ? mx_fractal_noise_float(vec3(n.x.mul(0.5), n.z.mul(14), n.y.mul(0.5)), 3, 2, 0.5, 1).mul(0.25).add(1)
          : p.name === 'Uranus' || p.name === 'Neptune' ? mx_fractal_noise_float(vec3(n.x.mul(0.4), n.z.mul(9), n.y.mul(0.4)), 3, 2, 0.5, 1).mul(p.name === 'Neptune' ? 0.18 : 0.06).add(1)
          : p.name === 'Mars' ? mx_fractal_noise_float(n.mul(3), 4, 2, 0.5, 1).mul(0.35).add(1) : float(1);
        // Lighting uses the world-space normal, so the Sun stays put however the planet is tilted.
        return vec3(c.r, c.g, c.b).mul(bands).mul(max(dot(normalWorld, ps), 0)).mul(3);
      })();
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.r * KM, 64, 32), mat);
      const pole = poleOf(p.name.toLowerCase());
      if (pole) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pole);
      const ring = RINGS[p.name];
      if (ring) mesh.add(this.makeRing(p.name, ring[0], ring[1]));
      s.add(mesh); this.planets.push(mesh);
    }
    this.tug = makeTug(); s.add(this.tug.group);
    this.pod = makePod(); s.add(this.pod);
    this.deadSat = makeDeadSat(); s.add(this.deadSat); this.deadSat.visible = false;
    this.station = makeStation(); s.add(this.station);
    this.ghost = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicNodeMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.7, depthWrite: false }));
    this.ghost.frustumCulled = false; s.add(this.ghost);
    this.system = new SolarSystem(s, this.uSunRel, worldNow());
  }

  /** A ring system in the planet's equatorial (local xy) plane, opacity from its radial profile. */
  makeRing(name: string, r0: number, r1: number) {
    const ps = normalize(this.uSunRel.sub(positionWorld)), mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const sat = name === 'Saturn';
    const prof = Fn(() => {
      const r = length(positionLocal.xy).div(KM);
      const band = (a: number, b: number, v: number) => step(a, r).mul(step(r, b)).mul(v);
      if (sat) {
        const fine = float(0.75).add(mx_fractal_noise_float(vec3(r.mul(0.0035), 0.5, 0.5), 3, 2, 0.5, 1).mul(0.5));
        return band(74658, 92000, 0.12).add(band(92000, 117580, 0.85)).add(band(117580, 122170, 0.05))
          .add(band(122170, 133400, 0.55)).add(band(133700, 136775, 0.5)).add(band(140100, 140300, 0.4)).mul(fine);
      }
      // Uranus: nine narrow dark rings, epsilon the widest.
      let o: any = float(0);
      for (const [c, w] of [[41837, 8], [42234, 8], [42571, 8], [44718, 6], [45661, 6], [47176, 4], [47627, 6], [48300, 10], [51149, 60]]) o = o.add(band(c - w, c + w, 0.35));
      return o;
    });
    mat.colorNode = Fn(() => {
      const base = sat ? vec3(0.86, 0.78, 0.64) : vec3(0.45, 0.47, 0.5);
      return base.mul(float(0.25).add(abs(dot(normalWorld, ps)).mul(0.75))).mul(2.2);
    })();
    mat.opacityNode = prof();
    const m = new THREE.Mesh(new THREE.RingGeometry(r0 * KM, r1 * KM, 256, 1), mat);
    m.frustumCulled = false;
    return m;
  }

  /** Register an extra model (hauler, sovereign station...) by id. */
  object(id: string, make: () => THREE.Object3D) {
    let o = this.objects[id];
    if (!o) { o = make(); this.gfx.scene.add(o); this.objects[id] = o; }
    return o;
  }

  buildOrbits(t: number) {
    const s = this.gfx.scene;
    for (const o of this.orbits) s.remove(o);
    this.orbits = [];
    PLANETS.forEach((p, k) => {
      const arr = new Float32Array(361 * 3);
      for (let i = 0; i <= 360; i++) { const h = planetHelioAt(k, t + i / 360 * p.period * 86400); arr.set([h[0] * KM, h[1] * KM, h[2] * KM], i * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const l = new THREE.Line(g, new THREE.LineBasicNodeMaterial({ color: p.col, transparent: true, opacity: 0.45, depthWrite: false }));
      l.frustumCulled = false; s.add(l); this.orbits.push(l);
    });
    const n = 240, arr = new Float32Array((n + 1) * 3);
    for (let i = 0; i <= n; i++) { const m = core.ephem(t + i / n * 27.32 * 86400).moon; arr.set([m[0] * KM, m[1] * KM, m[2] * KM], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    if (this.moonOrbit) s.remove(this.moonOrbit);
    this.moonOrbit = new THREE.Line(g, new THREE.LineBasicNodeMaterial({ color: 0xaab4c4, transparent: true, opacity: 0.35, depthWrite: false }));
    this.moonOrbit.frustumCulled = false; s.add(this.moonOrbit);
  }

  /** Camera-relative scene position (m) of a geocentric point (km). */
  rel(p: number[], out = new THREE.Vector3()) {
    const c = this.cam.pos;
    return out.set((p[0] - c[0]) * KM, (p[1] - c[1]) * KM, (p[2] - c[2]) * KM);
  }

  /** Orientation of the local-vertical/local-horizontal frame for a state. */
  lvlhQuat(s: State, out = new THREE.Quaternion()) {
    const R = V.norm(s.r), H = V.norm(V.cross(s.r, s.v)), Vv = V.cross(H, R);
    this.m.makeBasis(new THREE.Vector3(...Vv), new THREE.Vector3(...R), new THREE.Vector3(-H[0], -H[1], -H[2]));
    return out.setFromRotationMatrix(this.m);
  }

  update(t: number, cam: CamOut, eph: Ephem) {
    this.cam = cam;
    const g = this.gfx, c = g.camera;
    c.quaternion.copy(cam.quat); c.position.set(0, 0, 0); c.up.copy(cam.up);
    const dm = cam.dist * KM;
    c.near = Math.max(dm * 0.002, 0.02); c.far = Math.max(1e13, dm * 1e3); c.updateProjectionMatrix();
    // The overlay projects with this camera before the frame renders: refresh its matrices now, or labels trail the view by a frame.
    c.updateMatrixWorld(true);
    this.sunGeo = eph.sun;
    const camR = V.len(cam.pos);
    this.rel([0, 0, 0], this.earth.group.position);
    this.m.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
    const base = new THREE.Quaternion().setFromRotationMatrix(this.m);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), eph.gmst);
    this.earthQuat.copy(spin).multiply(base);
    this.earth.group.quaternion.copy(this.earthQuat);
    const inv = this.earthQuat.clone().invert(), sunDir = new THREE.Vector3(...V.norm(eph.sun));
    this.earth.uSun.value.copy(sunDir).applyQuaternion(inv);
    this.earth.uCam.value.set(cam.pos[0], cam.pos[1], cam.pos[2]).applyQuaternion(inv);
    this.earth.uDetail.value = Math.min(1, Math.max(0, (4000 - (camR - R_EARTH)) / 3200));
    this.earth.uCloudShift.value = (t / 86400 * 0.004) % 1;
    this.rel(eph.moon, this.moon.position);
    this.uMoonSun.value.set(...V.norm(V.sub(eph.sun, eph.moon)));
    const sunHelio = V.mul(eph.sun, -1); // Earth's heliocentric position
    PLANETS.forEach((p, k) => {
      const m = this.planets[k]; if (!m) return;
      const geo = V.sub(planetHelioAt(k, t, eph), sunHelio);
      this.rel(geo, m.position);
      m.visible = cam.wSun > 0.02 || V.dist(geo, cam.pos) < 5e7;
    });
    this.uPlanetSun.value.copy(sunDir);
    const sunRel = this.rel(eph.sun, new THREE.Vector3());
    this.uSunRel.value.copy(sunRel);
    this.system.update(t, cam, eph, (p, o) => this.rel(p, o), (id) => {
      const k = PLANETS.findIndex(q => q.name.toLowerCase() === id);
      return k < 0 ? null : k === 2 ? [0, 0, 0] : V.sub(planetHelioAt(k, t, eph), sunHelio);
    }, sunDir);
    for (const o of this.orbits) { o.position.copy(sunRel); o.visible = cam.wSun > 0.01; (o.material as any).opacity = 0.45 * cam.wSun; }
    if (this.moonOrbit) {
      this.rel([0, 0, 0], this.moonOrbit.position);
      this.moonOrbit.visible = cam.dist > 2e4;
      (this.moonOrbit.material as any).opacity = 0.35 * Math.min(1, (cam.dist - 2e4) / 8e4);
    }
    this.stars.uPix.value = c.fov * Math.PI / 180 / g.H;
    this.stars.mesh.scale.setScalar(c.near * 40);
    const vis = core.sunFraction(cam.pos, eph.sun);
    g.placeSun(sunRel.clone().normalize(), vis, V.dist(eph.sun, cam.pos));
    const f = this.rel(cam.focus, new THREE.Vector3());
    g.sunLight.position.copy(f).addScaledVector(sunDir, 200);
    g.sunLight.target.position.copy(f);
    return { sunDir, sunVis: vis };
  }

  // Simple image-based light for hulls: a lit Earth below, black space above.
  envTex: THREE.DataTexture | null = null;
  envKey = '';
  updateEnv(shipR: number[], sun: number[]) {
    const down = V.norm(V.mul(shipR, -1)), sd = V.norm(V.sub(sun, shipR));
    const key = down.map(x => Math.round(x * 40)).join() + '|' + sd.map(x => Math.round(x * 40)).join();
    if (key === this.envKey) return;
    this.envKey = key;
    const W = 128, H = 64, data = new Float32Array(W * H * 4), r = V.len(shipR), ang = Math.asin(Math.min(1, R_EARTH / r));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ph = (x + 0.5) / W * Math.PI * 2, th = (y + 0.5) / H * Math.PI;
      const dir = [-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)];
      const a = Math.acos(Math.max(-1, Math.min(1, V.dot(dir, down))));
      let c: number[] = [0, 0, 0];
      if (a < ang) {
        const b = V.dot(shipR, dir), disc = b * b - (V.dot(shipR, shipR) - R_EARTH * R_EARTH), tt = -b - Math.sqrt(Math.max(0, disc));
        const n = V.norm(V.addm(shipR, dir, tt)), l = Math.max(0, V.dot(n, sd));
        c = [0.32 * l, 0.42 * l, 0.58 * l];
        const rim = Math.pow(a / ang, 8) * Math.max(0, V.dot(n, sd) + 0.2);
        c = V.add(c, [0.1 * rim, 0.25 * rim, 0.6 * rim]);
      }
      const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 1;
    }
    if (this.envTex) { (this.envTex.image as any).data = data; }
    else {
      this.envTex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
      this.envTex.mapping = THREE.EquirectangularReflectionMapping;
      this.envTex.magFilter = THREE.LinearFilter; this.envTex.minFilter = THREE.LinearFilter;
      this.gfx.scene.environment = this.envTex;
    }
    this.envTex.needsUpdate = true;
  }

  mk: Record<string, THREE.Sprite> = {};
  lines: Record<string, THREE.Line> = {};
  /** Constant-screen-size glow marker at a geocentric point; pass null to hide. */
  marker(id: string, col: THREE.Color, p: number[] | null, px = 10, inten = 3) {
    let m = this.mk[id];
    if (!m) { m = glowSprite(col, 1, inten); m.renderOrder = 6; this.gfx.scene.add(m); this.mk[id] = m; }
    if (!p) { m.visible = false; return; }
    m.visible = true; this.rel(p, m.position);
    const a = this.gfx.camera.fov * Math.PI / 180 / this.gfx.H;
    m.scale.setScalar(Math.max(0.001, m.position.length() * a * px));
  }
  /** Polyline through geocentric points (km); pass null to hide. */
  polyline(id: string, col: number, pts: number[][] | null, opacity = 0.9, loop = false) {
    let l = this.lines[id];
    if (!l) {
      l = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicNodeMaterial({ color: col, transparent: true, opacity, depthWrite: false }));
      l.frustumCulled = false; l.renderOrder = 5; this.gfx.scene.add(l); this.lines[id] = l;
    }
    if (!pts || pts.length < 2) { l.visible = false; return; }
    l.visible = true;
    if (loop) pts = [...pts, pts[0]];
    const c = this.cam.pos, arr = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { arr[i * 3] = (p[0] - c[0]) * KM; arr[i * 3 + 1] = (p[1] - c[1]) * KM; arr[i * 3 + 2] = (p[2] - c[2]) * KM; });
    l.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    l.geometry.computeBoundingSphere();
    l.position.set(0, 0, 0);
  }
  /** Screen position [x, y, distance m] of a geocentric point; null if off-screen or behind Earth. */
  project(p: number[]): [number, number, number] | null {
    const v = this.rel(p, new THREE.Vector3()), d = v.length();
    v.project(this.gfx.camera);
    if (v.z > 1 || v.z < -1) return null;
    const c = this.cam.pos, dir = V.sub(p, c), dd = V.dot(dir, dir), tt = -V.dot(c, dir) / dd;
    if (tt > 0 && tt < 1 && V.len(V.addm(c, dir, tt)) < R_EARTH) return null;
    return [(v.x + 1) / 2 * this.gfx.W, (1 - v.y) / 2 * this.gfx.H, d];
  }
  /** Apparent screen radius (px) of a sphere of radius rKm at geocentric p. */
  screenRadius(p: number[], rKm: number) {
    const d = V.dist(p, this.cam.pos);
    if (d <= rKm) return 1e5;
    return Math.atan(rKm / d) / (this.gfx.camera.fov * Math.PI / 180) * this.gfx.H;
  }
}
