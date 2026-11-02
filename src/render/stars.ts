// Procedural star field (three cell-noise layers) and a soft Milky Way band, on a unit
// sphere that the scene rescales to sit just beyond the near plane every frame.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec3, float, length, floor, exp, pow, smoothstep, mix, dot, abs, max, normalize, positionLocal,
  mx_cell_noise_vec3, mx_cell_noise_float, mx_fractal_noise_float,
} from 'three/tsl';

const d2r = Math.PI / 180;
// Galactic north pole and galactic centre directions in J2000 equatorial coordinates.
const GNP = new THREE.Vector3(Math.cos(27.13 * d2r) * Math.cos(192.86 * d2r), Math.cos(27.13 * d2r) * Math.sin(192.86 * d2r), Math.sin(27.13 * d2r));
const GC = new THREE.Vector3(Math.cos(-28.94 * d2r) * Math.cos(266.4 * d2r), Math.cos(-28.94 * d2r) * Math.sin(266.4 * d2r), Math.sin(-28.94 * d2r));

export class Stars {
  mesh: THREE.Mesh;
  uPix = uniform(0.001);
  uBright = uniform(1);
  constructor(scale: number) {
    const { uPix: pix, uBright: bright } = this;
    const gnp = vec3(GNP.x, GNP.y, GNP.z), gc = vec3(GC.x, GC.y, GC.z);
    const layer = (dir: any, cells: number, density: any, gain: number) => {
      const p = dir.mul(cells), cell = floor(p), jit = mx_cell_noise_vec3(cell), pick = mx_cell_noise_float(cell.add(vec3(13.7, 3.1, 7.9)));
      const centre = cell.add(jit.mul(0.6).add(0.2)), d = length(p.sub(centre)).div(cells);
      const w = pix.mul(0.75), core = exp(d.mul(d).negate().div(w.mul(w).mul(2)));
      const mag = pow(mx_cell_noise_float(cell.add(vec3(5.3, 11.2, 1.7))), 9);
      const keep = float(1).sub(density), on = smoothstep(keep, keep.add(0.002), pick);
      const tint = mix(vec3(1, 0.72, 0.45), vec3(0.72, 0.82, 1), mx_cell_noise_float(cell.add(vec3(2.2, 8.8, 4.4))));
      const fade = smoothstep(0.42, 0.3, length(p.sub(centre)));
      return tint.mul(core).mul(fade).mul(mag.mul(gain).add(0.08 * gain)).mul(on);
    };
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false });
    mat.colorNode = Fn(() => {
      const dir = normalize(positionLocal), b = abs(dot(dir, gnp)), band = exp(b.mul(b).negate().div(0.02));
      const bulge = pow(max(dot(dir, gc), 0), 6);
      let c: any = layer(dir, 90, float(0.04), 3);
      c = c.add(layer(dir, 220, float(0.03).add(band.mul(0.08)), 1.5));
      c = c.add(layer(dir, 480, float(0.02).add(band.mul(0.12)), 0.8));
      const n1 = mx_fractal_noise_float(dir.mul(9), 5, 2, 0.55, 1), n2 = mx_fractal_noise_float(dir.mul(11), 3, 2, 0.5, 1);
      const glow = band.mul(float(0.55).add(n1.mul(0.35))).add(bulge).mul(smoothstep(-0.5, 0.4, n2.add(0.2)));
      c = c.add(vec3(0.85, 0.8, 0.95).mul(max(glow, 0)).mul(0.006));
      return c.mul(bright);
    })();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), mat);
    this.mesh.scale.setScalar(scale);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }
}
