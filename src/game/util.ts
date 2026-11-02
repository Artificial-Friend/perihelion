// Shared helpers: deterministic hashing/RNG, great-circle maths and formatting.
import { DEG, R_EARTH, V } from '../sim/core';

export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
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
export interface LatLon { lat: number; lon: number }
const unit = (p: LatLon) => [Math.cos(p.lat * DEG) * Math.cos(p.lon * DEG), Math.cos(p.lat * DEG) * Math.sin(p.lon * DEG), Math.sin(p.lat * DEG)];
/** Great-circle interpolation. */
export function gcLerp(a: LatLon, b: LatLon, t: number): LatLon {
  const ua = unit(a), ub = unit(b), w = Math.acos(Math.max(-1, Math.min(1, V.dot(ua, ub))));
  if (w < 1e-9) return { ...a };
  const s = Math.sin(w), p = V.add(V.mul(ua, Math.sin((1 - t) * w) / s), V.mul(ub, Math.sin(t * w) / s));
  return { lat: Math.asin(p[2]) / DEG, lon: Math.atan2(p[1], p[0]) / DEG };
}
export function gcDistKm(a: LatLon, b: LatLon) {
  const h = Math.sin((b.lat - a.lat) * DEG / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin((b.lon - a.lon) * DEG / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const esc = (s: any) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
export const money = (n: number) => '¤' + Math.round(n).toLocaleString('en-US');
export function fmtClock(s: number) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') : m + ':' + String(sec).padStart(2, '0');
}
export function fmtDur(s: number) {
  s = Math.max(0, s);
  if (s < 90) return Math.round(s) + ' s';
  if (s < 5400) return Math.round(s / 60) + ' min';
  if (s < 2 * 86400) return (s / 3600).toFixed(1) + ' h';
  return (s / 86400).toFixed(1) + ' days';
}
export function fmtM(m: number) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 1e4 ? 2 : 1) + ' km'; }
export function fmtKm(km: number) {
  if (km < 1e4) return Math.round(km).toLocaleString('en-US') + ' km';
  if (km < 1e7) return (km / 1e3).toFixed(0) + 'k km';
  return (km / 1e6).toFixed(1) + 'M km';
}
