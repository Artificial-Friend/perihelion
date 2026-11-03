// One continuous free camera: trackball rotation about its own axes (no fixed up),
// logarithmic zoom from a ship's deck to light-years, and smooth focus changes.
import * as THREE from 'three/webgpu';
import { V, Vec3, AU, R_EARTH } from '../sim/core';

export const LY = 9.4607e12; // km
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** What the camera can focus on. `up` + `minElev` keep the camera above a surface site's horizon. */
export interface FocusInfo { pos: Vec3; minKm: number; defaultKm: number; up?: Vec3; minElev?: number }
export interface CamOut {
  pos: Vec3; focus: Vec3; quat: THREE.Quaternion; up: THREE.Vector3; dist: number; focusId: string;
  deck: number; level: 'deck' | 'ship' | 'ground' | 'orbit' | 'system' | 'deep'; wSun: number;
}

export class FreeCamera {
  q = new THREE.Quaternion();
  logD = Math.log(25000);
  tLogD = Math.log(25000);
  focusId = 'earth';
  fromPos: Vec3 | null = null;
  fromCam: Vec3 | null = null;
  lastPos: Vec3 | null = null;
  blend = 1;
  spin = new THREE.Vector2();
  dragging = false;
  maxLog = Math.log(LY * 20);
  // Orientation glide (used when the camera dives to a new focus and turns to its view).
  private qFrom = new THREE.Quaternion();
  private qTo = new THREE.Quaternion();
  private oBlend = 1;

  constructor() { this.q.setFromEuler(new THREE.Euler(-0.35, 0.6, 0, 'YXZ')); }

  rotate(dx: number, dy: number) {
    const a = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx);
    const b = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy);
    this.q.multiply(a).multiply(b).normalize();
  }
  drag(dx: number, dy: number, dt: number) {
    this.dragging = true; this.oBlend = 1; this.rotate(dx, dy);
    if (dt > 0) this.spin.set(dx / dt, dy / dt).clampLength(0, 6);
  }
  release() { this.dragging = false; }
  zoom(f: number) { this.tLogD = Math.min(this.maxLog, this.tLogD + Math.log(f)); }
  setDist(km: number, now = false) { this.tLogD = Math.min(this.maxLog, Math.log(km)); if (now) this.logD = this.tLogD; }
  get distKm() { return Math.exp(this.logD); }

  setFocus(id: string, currentPos: Vec3 | null, km?: number) {
    if (id === this.focusId && km == null) return;
    this.fromPos = currentPos; this.fromCam = this.lastPos;
    this.blend = currentPos ? 0 : 1;
    this.focusId = id;
    if (km != null) this.tLogD = Math.log(km);
  }
  /** Turn smoothly to an orientation over the next ~1.4 s. */
  turnTo(q: THREE.Quaternion) { this.qFrom.copy(this.q); this.qTo.copy(q); this.oBlend = 0; this.spin.set(0, 0); }
  get moving() { return this.blend < 1 || this.oBlend < 1; }
  snap() { this.blend = 1; this.logD = this.tLogD; if (this.oBlend < 1) { this.q.copy(this.qTo); this.oBlend = 1; } }

  step(dt: number) {
    const k = 1 - Math.exp(-dt * 7);
    this.logD += (this.tLogD - this.logD) * k;
    if (!this.dragging && this.spin.lengthSq() > 1e-6) { this.rotate(this.spin.x * dt, this.spin.y * dt); this.spin.multiplyScalar(Math.exp(-dt * 4)); }
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / 1.4);
    if (this.oBlend < 1) {
      this.oBlend = Math.min(1, this.oBlend + dt / 1.4);
      const e = this.oBlend * this.oBlend * (3 - 2 * this.oBlend);
      this.q.slerpQuaternions(this.qFrom, this.qTo, e);
    }
  }

  compute(resolve: (id: string) => FocusInfo | null): CamOut {
    let f = resolve(this.focusId);
    if (!f) { this.focusId = 'earth'; f = resolve('earth')!; }
    const minLog = Math.log(f.minKm);
    if (this.tLogD < minLog) this.tLogD = minLog;
    if (this.logD < minLog) this.logD = minLog;
    // Surface sites: never let the camera sink below the horizon.
    if (f.up && f.minElev != null && this.oBlend >= 1) {
      const off0 = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q), up = new THREE.Vector3(...f.up);
      const sinMin = Math.sin(f.minElev), dd = off0.dot(up);
      if (dd < sinMin) {
        const axis = new THREE.Vector3().crossVectors(off0, up);
        if (axis.lengthSq() > 1e-12) {
          const turn = Math.asin(sinMin) - Math.asin(Math.max(-1, Math.min(1, dd)));
          this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis.normalize(), turn)).normalize();
        }
      }
    }
    const b = this.blend < 1 && this.fromPos ? this.blend * this.blend * (3 - 2 * this.blend) : 1;
    const focus = this.fromPos && b < 1 ? V.lerp(this.fromPos, f.pos, b) : f.pos;
    const d = Math.exp(this.logD);
    const off = new THREE.Vector3(0, 0, d).applyQuaternion(this.q);
    let pos: Vec3 = [focus[0] + off.x, focus[1] + off.y, focus[2] + off.z];
    if (b < 1 && this.fromCam) {
      const target: Vec3 = [f.pos[0] + off.x, f.pos[1] + off.y, f.pos[2] + off.z];
      pos = V.lerp(this.fromCam, target, b);
      const l = V.len(pos);
      if (l < R_EARTH * 1.02) pos = V.mul(pos, R_EARTH * 1.02 / l);
    }
    this.lastPos = pos;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    const id = this.focusId;
    const deck = id === 'ship' ? smooth(0.019, 0.013, d) : 0;
    const level: CamOut['level'] = id === 'ship' && d < 0.016 ? 'deck' : id === 'ship' && d < 5 ? 'ship'
      : id === 'base' && d < 4000 ? 'ground' : d < 3e6 ? 'orbit' : d < 15e9 ? 'system' : 'deep';
    return { pos, focus, quat: this.q.clone(), up, dist: d, focusId: id, deck, level, wSun: smooth(Math.log(4e6), Math.log(1.5e8), Math.log(Math.max(1, V.len(V.sub(pos, focus))))) };
  }
}

export function fmtScale(km: number) {
  if (km < 1) return Math.round(km * 1000) + ' m';
  if (km < 1e4) return Math.round(km).toLocaleString() + ' km';
  if (km < 1e7) return (km / 1e3).toFixed(0) + ' thousand km';
  if (km < 15e9) return (km / AU).toFixed(km < 1.5e9 ? 2 : 1) + ' AU';
  if (km < LY * 0.1) return (km / AU).toFixed(0) + ' AU';
  return (km / LY).toFixed(km < LY * 10 ? 2 : 1) + ' light-years';
}
