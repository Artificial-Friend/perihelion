// PERIHELION simulation core: two-body orbits, rendezvous geometry, ephemerides and
// the small environment models. Pure functions over doubles; no state, no allocation.
// Units: km, km/s, seconds since J2000; relative (LVLH) quantities in metres and m/s.
#pragma once
#include "pmath.h"

namespace sim {
using pm::sin; using pm::cos; using pm::atan; using pm::atan2; using pm::asin; using pm::acos;
using pm::sqrt; using pm::floor; using pm::fabs; using pm::exp; using pm::pow; using pm::clamp;
using pm::PI; using pm::TWO_PI; using pm::HALF_PI;

constexpr double MU_EARTH = 398600.4418;   // km^3/s^2
constexpr double R_EARTH = 6371.0;         // km
constexpr double R_SUN = 695700.0;         // km
constexpr double AU = 149597870.7;         // km
constexpr double DEG = 0.017453292519943295;
constexpr double DAY = 86400.0;
constexpr double CENTURY = 3155760000.0;   // Julian century, s
constexpr double PRECESSION_DEG_PER_CENTURY = 1.39697;
constexpr double SIN_OBL = 0.3977769780087639, COS_OBL = 0.9174821392082875;  // J2000 obliquity

struct V3 { double x, y, z; };
struct State { V3 r, v; };
struct Circ { double a, i, raan, u0, t0; };  // circular orbit, argument of latitude u0 at t0
struct Elements { double a, e, i, raan, argp, M0, t0, mu; };
struct Basis { V3 V, R, H; };               // along-track, radial, orbit normal
struct Pass { double rise, set, maxEl, tMax; };

inline V3 add(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 sub(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 mul(V3 a, double s) { return {a.x * s, a.y * s, a.z * s}; }
inline double dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline double len(V3 a) { return sqrt(dot(a, a)); }
inline V3 norm(V3 a) { double l = len(a); return l > 0.0 ? mul(a, 1.0 / l) : a; }

// ---------- universal-variable Kepler propagation ----------
inline double stumpC(double z) {
  if (z > 1e-8) return (1.0 - cos(sqrt(z))) / z;
  if (z < -1e-8) return (pm::cosh(sqrt(-z)) - 1.0) / -z;
  return 0.5 - z / 24.0;
}
inline double stumpS(double z) {
  if (z > 1e-8) { double s = sqrt(z); return (s - sin(s)) / (s * s * s); }
  if (z < -1e-8) { double s = sqrt(-z); return (pm::sinh(s) - s) / (s * s * s); }
  return 1.0 / 6.0 - z / 120.0;
}
inline State kepler(State s, double dt, double mu) {
  if (fabs(dt) < 1e-9) return s;
  double r0 = len(s.r), vr0 = dot(s.r, s.v) / r0, v0 = len(s.v);
  double smu = sqrt(mu), alpha = 2.0 / r0 - v0 * v0 / mu, smt = smu * dt;
  double chi = alpha > 0.0 ? smu * alpha * dt : smt / r0;
  double k1 = 1.0 - r0 * alpha, k2 = r0 * vr0 / smu;
  for (int it = 0; it < 60; it++) {
    double z = chi * (alpha * chi), C = stumpC(z), S = stumpS(z);
    double q = k2 * chi, b = chi * (k1 * chi);
    double F = (r0 * chi + (chi * q * C + chi * b * S)) - smt;
    double dF = r0 + (b * C + q * (1.0 - z * S));
    double d = F / dF;
    chi -= d;
    if (fabs(d) < 1e-11) break;
  }
  double z = chi * (alpha * chi), C = stumpC(z), S = stumpS(z), chi2 = chi * chi;
  double f = 1.0 - C * (chi2 / r0), g = dt - chi * chi2 * S / smu;
  V3 r = add(mul(s.r, f), mul(s.v, g));
  double rm = len(r);
  double fd = (S * (chi * z) - chi) * (smu / (r0 * rm)), gd = 1.0 - C * (chi2 / rm);
  return {r, add(mul(s.r, fd), mul(s.v, gd))};
}

inline State circ_state(const Circ& c, double t) {
  double ci = cos(c.i), si = sin(c.i), cO = cos(c.raan), sO = sin(c.raan);
  double n = sqrt(MU_EARTH / (c.a * c.a * c.a)), u = c.u0 + n * (t - c.t0);
  double cu = cos(u), su = sin(u), v = c.a * n;
  V3 P{cO, sO, 0.0}, Q{sO * -ci, ci * cO, si};
  return {mul(add(mul(P, cu), mul(Q, su)), c.a), mul(sub(mul(Q, cu), mul(P, su)), v)};
}

inline State elements_state(const Elements& el, double t) {
  double M = pm::wrapPi(el.M0 + (t - el.t0) * sqrt(el.mu / (el.a * el.a * el.a)));
  double e = el.e, E = e < 0.8 ? M : PI;
  for (int it = 0; it < 40; it++) {
    double d = (E - e * sin(E) - M) / (1.0 - e * cos(E));
    E -= d;
    if (fabs(d) < 1e-14) break;
  }
  double cE = cos(E), sE = sin(E), a = el.a, b = sqrt(1.0 - e * e);
  double cO = cos(el.raan), sO = sin(el.raan), cw = cos(el.argp), sw = sin(el.argp), ci = cos(el.i), si = sin(el.i);
  double r = a * (1.0 - cE * e), h = sqrt(a * el.mu);
  double x = a * (cE - e), y = sE * (a * b), vx = sE * (-h / r), vy = cE * (b * (h / r));
  double sOcw = sO * cw, cOcw = cO * cw, sOsw = sO * sw;
  V3 P{cOcw - sOsw * ci, sOcw + ci * (cO * sw), sw * si};
  V3 Q{sw * -cO - sOcw * ci, ci * cOcw - sOsw, cw * si};
  return {add(mul(P, x), mul(Q, y)), add(mul(P, vx), mul(Q, vy))};
}

// ---------- local frames ----------
inline Basis lvlh(const State& s) {
  V3 R = norm(s.r), H = norm(cross(s.r, s.v));
  return {cross(H, R), R, H};
}
// Ship relative to target in the target's LVLH frame: p in metres, w in m/s.
inline void rel_state(const State& ship, const State& tgt, V3& p, V3& w) {
  Basis B = lvlh(tgt);
  V3 om = mul(cross(tgt.r, tgt.v), 1.0 / dot(tgt.r, tgt.r));
  V3 dr = sub(ship.r, tgt.r), dv = sub(sub(ship.v, tgt.v), cross(om, dr));
  p = {dot(dr, B.V) * 1000.0, dot(dr, B.R) * 1000.0, -dot(dr, B.H) * 1000.0};
  w = {dot(dv, B.V) * 1000.0, dot(dv, B.R) * 1000.0, -dot(dv, B.H) * 1000.0};
}
inline State abs_state(V3 p, V3 w, const State& tgt) {
  Basis B = lvlh(tgt);
  V3 om = mul(cross(tgt.r, tgt.v), 1.0 / dot(tgt.r, tgt.r));
  V3 dr = mul(sub(add(mul(B.R, p.y), mul(B.V, p.x)), mul(B.H, p.z)), 0.001);
  V3 dv = mul(sub(add(mul(B.R, w.y), mul(B.V, w.x)), mul(B.H, w.z)), 0.001);
  return {add(tgt.r, dr), add(add(tgt.v, dv), cross(om, dr))};
}
inline V3 rel_pos(const State& ship, const State& tgt) { V3 p, w; rel_state(ship, tgt, p, w); return p; }

// ---------- orbit summary ----------
struct OrbitInfo { double a, e, periAlt, apoAlt, alt, period, inc; };
inline OrbitInfo orbit_info(const State& s, double mu, double rBody) {
  OrbitInfo o;
  double r = len(s.r), v = len(s.v), eps = v * v * 0.5 - mu / r;
  o.alt = r - rBody;
  o.a = -mu / (eps + eps);
  V3 h = cross(s.r, s.v);
  V3 ev = sub(mul(cross(s.v, h), 1.0 / mu), mul(s.r, 1.0 / r));
  o.e = len(ev);
  o.periAlt = o.a * (1.0 - o.e) - rBody;
  bool bound = eps < 0.0;
  o.apoAlt = bound ? o.a * (1.0 + o.e) - rBody : 1e30;
  o.period = bound ? sqrt(o.a * o.a * o.a / mu) * TWO_PI : 1e30;
  o.inc = acos(clamp(h.z / len(h), -1.0, 1.0));
  return o;
}

// ---------- ephemerides (low precision, J2000 equatorial, geocentric km) ----------
inline double precession(double t) { return t / CENTURY * PRECESSION_DEG_PER_CENTURY; }  // degrees
inline double gmst(double t) {
  return pm::wrap2pi(((t / DAY) * 360.98564736629 + 280.46061837 - precession(t)) * DEG);
}
inline V3 ecl_to_eq(V3 e) { return {e.x, e.y * COS_OBL - e.z * SIN_OBL, e.y * SIN_OBL + e.z * COS_OBL}; }

inline V3 sun_eci(double t) {
  double d = t / DAY, g = (d * 0.9856003 + 357.528) * DEG;
  double L = (d * 0.9856474 + 280.46) * DEG;
  double lam = L + (1.915 * sin(g) + 0.02 * sin(g + g) - precession(t)) * DEG;
  double R = ((1.00014 - 0.01671 * cos(g)) - 0.00014 * cos(g + g)) * AU;
  return ecl_to_eq({cos(lam) * R, sin(lam) * R, R * 0.0});
}

inline V3 moon_eci(double t) {
  double T = t / CENTURY;
  double a1 = (T * 477198.87 + 135.0) * DEG, a2 = (T * -413335.36 + 259.3) * DEG;
  double a3 = (T * 890534.22 + 235.7) * DEG, a4 = (T * 954397.74 + 269.9) * DEG;
  double lam = ((((((((T * 481267.881 + 218.32) + 6.29 * sin(a1)) + -1.27 * sin(a2)) + 0.66 * sin(a3)) + 0.21 * sin(a4)) +
                -0.19 * sin((T * 35999.05 + 357.5) * DEG)) + -0.11 * sin((T * 966404.03 + 186.5) * DEG)) + T * -PRECESSION_DEG_PER_CENTURY) * DEG;
  double beta = (((5.13 * sin((T * 483202.02 + 93.3) * DEG) + 0.28 * sin((T * 960400.89 + 228.2) * DEG)) -
                 0.28 * sin((T * 6003.15 + 318.3) * DEG)) + -0.17 * sin((T * -407332.21 + 217.6) * DEG)) * DEG;
  double par = ((((0.9508 + 0.0518 * cos(a1)) + 0.0095 * cos(a2)) + 0.0078 * cos(a3)) + 0.0028 * cos(a4)) * DEG;
  double dist = 6378.14 / sin(par), cb = cos(beta);
  return ecl_to_eq({dist * (cb * cos(lam)), dist * (cb * sin(lam)), dist * sin(beta)});
}

// JPL approximate Keplerian elements (1800-2050), J2000 ecliptic, per century rates:
// a [AU], e, i [deg], L [deg], long. perihelion [deg], long. node [deg].
static const double PLANET_EL[6][12] = {
  {0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 3.7e-07, 1.906e-05, -0.00594749, 149472.67411175, 0.16047689, -0.12534081},
  {0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 3.9e-06, -4.107e-05, -0.0007889, 58517.81538729, 0.00268329, -0.27769418},
  {1.00000261, 0.01671123, -1.531e-05, 100.46457166, 102.93768193, 0.0, 5.62e-06, -4.392e-05, -0.01294668, 35999.37244981, 0.32327364, 0.0},
  {1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 1.847e-05, 7.882e-05, -0.00813131, 19140.30268499, 0.44441088, -0.29257343},
  {5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106},
  {9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794},
};
// Heliocentric J2000 equatorial position (km) of planet 0..5 (Mercury..Saturn).
inline V3 planet_helio(int k, double t) {
  const double* p = PLANET_EL[k];
  double T = t / CENTURY;
  double e = p[1] + T * p[7], L = (p[3] + T * p[9]) * DEG, varpi = (p[4] + T * p[10]) * DEG;
  double M = pm::wrapPi(L - varpi), E = e < 0.8 ? M : PI;
  for (int it = 0; it < 40; it++) {
    double d = (E - e * sin(E) - M) / (1.0 - e * cos(E));
    E -= d;
    if (fabs(d) < 1e-14) break;
  }
  double cE = cos(E), sE = sin(E);
  double O = (p[5] + T * p[11]) * DEG, w = varpi - O, inc = (p[2] + T * p[8]) * DEG;
  double cw = cos(w), sw = sin(w), cO = cos(O), sO = sin(O), ci = cos(inc), si = sin(inc);
  double a = (p[0] + T * p[6]) * AU;
  double x = a * (cE - e), y = sE * (a * sqrt(1.0 - e * e));
  double cwcO = cw * cO, swsO = sw * sO, cwsO = cw * sO;
  V3 ecl{x * (cwcO - ci * swsO) + y * (cO * -sw - ci * cwsO),
         x * (cwsO + ci * (sw * cO)) + y * (cwcO * ci - swsO),
         x * (sw * si) + y * (cw * si)};
  return ecl_to_eq(ecl);
}

// Fraction of the Sun's disc visible from r (geocentric km), Earth as the occulting body.
inline double sun_fraction(V3 r, V3 sun) {
  double rm = len(r);
  V3 d = sub(sun, r);
  double ds = len(d);
  double aS = asin(R_SUN / ds), aE = asin(R_EARTH / rm);
  double th = acos(dot({-r.x, -r.y, -r.z}, d) / (rm * ds));
  if (th >= aS + aE) return 1.0;
  if (th <= aE - aS) return 0.0;
  double aS2 = aS * aS;
  if (th <= aS - aE) return 1.0 - aE * aE / aS2;
  double aE2 = aE * aE, th2 = th * th;
  double c1 = acos(clamp((aS2 + th2 - aE2) / (aS * (th + th)), -1.0, 1.0));
  double c2 = acos(clamp((aE2 + th2 - aS2) / (aE * (th + th)), -1.0, 1.0));
  double s = aS + th, K = (aE + s) * ((aE + (th - aS)) * ((aE + (aS - th)) * (s - aE)));
  double area = (aS2 * c1 + aE2 * c2) - 0.5 * sqrt(K < 0.0 ? 0.0 : K);
  return clamp(1.0 - area / (PI * aS * aS), 0.0, 1.0);
}

inline void lat_lon(V3 r, double t, double& lat, double& lon) {
  double g = gmst(t), cg = cos(g), sg = sin(g);
  double x = cg * r.x + sg * r.y, y = cg * r.y - sg * r.x;
  lat = asin(r.z / len(r)) / DEG;
  lon = pm::wrapPi(atan2(y, x)) / DEG;
}

// ---------- environment ----------
inline double saa_factor(double lat, double lon) {
  double u = (lat + 27.0) / 22.0, v = (lon + 45.0) / 55.0, q = u * u + v * v;
  return q < 1.0 ? 1.0 + 14.0 * (1.0 - q) : 1.0;
}
// Dose rate: trapped belts (with the South Atlantic Anomaly), storms, solar protons by latitude.
inline double dose_rate(double lat, double lon, double spe, bool storm, double shield) {
  double rate = (storm ? 4.0 : 1.0) * (0.02 * saa_factor(lat, lon));
  if (spe > 0.0) {
    double a = fabs(lat), latf = a > 50.0 ? 1.0 : a > 40.0 ? 0.45 : a > 30.0 ? 0.12 : 0.02;
    rate = rate + (storm ? 1.0 : shield) * (spe * 6.0 * latf);
  }
  return rate;
}
// One explicit thermal step; returns the new temperature (K) and reports heat in and out.
inline double thermal_step(double T, double dt, double area, double power, double sunFrac, double absorb,
                           double capacity, double Tmin, double& qin, double& qout) {
  qin = power + sunFrac * (area * 0.2722 * absorb + 3.0);
  qout = area * 4.81981825615e-08 * T * T * T * T / 1000.0;
  double Tn = T + dt * (qin - qout) / capacity;
  return Tn < Tmin ? Tmin : Tn;
}

// ---------- rendezvous ----------
struct Closest { double d, t; V3 p; };
// Closest approach of a coasting ship to a circular target within [t0, t0+horizon]:
// n samples, then golden-section refinement around the best one. Optionally records the path.
inline Closest closest_approach(const State& ship, const Circ& tgt, double t0, double horizon, int n, V3* path) {
  auto at = [&](double dt) { return rel_pos(kepler(ship, dt, MU_EARTH), circ_state(tgt, dt + t0)); };
  Closest c{1e30, 0.0, {0.0, 0.0, 0.0}};
  for (int k = 1; k <= n; k++) {
    double dt = k * horizon / n;
    V3 p = at(dt);
    if (path) path[k - 1] = p;
    double d = len(p);
    if (d < c.d) c = {d, dt, p};
  }
  double h = horizon / n, lo = c.t - h, hi = h + c.t;
  if (lo < 0.0) lo = 0.0;
  for (int it = 0; it < 40; it++) {
    double w = hi - lo, a = lo + w * 0.381966, b = lo + w * 0.618034;
    if (len(at(a)) < len(at(b))) hi = b; else lo = a;
  }
  double tm = (hi + lo) * 0.5;
  V3 p = at(tm);
  double d = len(p);
  if (d < c.d) c = {d, tm, p};
  return c;
}

struct Lambert { int ok; V3 v1, v2; };
// Universal-variable Lambert solver (bisection on z), prograde about hN.
inline Lambert lambert(V3 r1, V3 r2, double tof, V3 hN, double mu) {
  Lambert out{0, {0.0, 0.0, 0.0}, {0.0, 0.0, 0.0}};
  double r1m = len(r1), r2m = len(r2), rr = r1m * r2m;
  double dth = acos(clamp(dot(r1, r2) / rr, -1.0, 1.0));
  if (dot(cross(r1, r2), hN) < 0.0) dth = TWO_PI - dth;
  double A = sin(dth) * sqrt(rr / (1.0 - cos(dth)));
  if (!(fabs(A) > 1e-9)) return out;
  double rs = r1m + r2m, target = sqrt(mu) * tof;
  auto y = [&](double z) { return rs + A * (z * stumpS(z) - 1.0) / sqrt(stumpC(z)); };
  auto F = [&](double z) {
    double yz = y(z);
    if (yz < 0.0) return -1e30;
    return (A * sqrt(yz) + pow(yz / stumpC(z), 1.5) * stumpS(z)) - target;
  };
  const double zmax = 39.478416604357434;  // just under 4 pi^2
  double lo = -60.0;
  while (lo < zmax && y(lo) < 0.0) lo += 0.25;
  double hi = zmax;
  if (F(lo) > 0.0 || F(hi) < 0.0) return out;
  for (int it = 0; it < 90; it++) {
    double m = (hi + lo) * 0.5;
    if (F(m) > 0.0) hi = m; else lo = m;
  }
  double z = (hi + lo) * 0.5, yz = y(z);
  double f = 1.0 - yz / r1m, gd = 1.0 - yz / r2m, ig = 1.0 / (A * sqrt(yz / mu));
  out.ok = 1;
  out.v1 = mul(sub(r2, mul(r1, f)), ig);
  out.v2 = mul(sub(mul(r2, gd), r1), ig);
  return out;
}

struct Intercept { int ok; V3 dv1, dv2; double dv, periAlt; };
// Leave now (t0) and arrive at hold (LVLH metres) beside the target after tof seconds.
inline Intercept intercept(const State& ship, const Circ& tgt, V3 hold, double t0, double tof) {
  Intercept out{0, {0.0, 0.0, 0.0}, {0.0, 0.0, 0.0}, 0.0, 0.0};
  State aim = abs_state(hold, {0.0, 0.0, 0.0}, circ_state(tgt, t0 + tof));
  Lambert L = lambert(ship.r, aim.r, tof, norm(cross(ship.r, ship.v)), MU_EARTH);
  if (!L.ok) return out;
  out.dv1 = sub(L.v1, ship.v);
  out.dv2 = sub(aim.v, L.v2);
  out.dv = (len(out.dv1) + len(out.dv2)) * 1000.0;
  out.periAlt = orbit_info({ship.r, L.v1}, MU_EARTH, R_EARTH).periAlt;
  out.ok = 1;
  return out;
}

// ---------- ground stations ----------
inline V3 site_eci(double lat, double lon, double t) {
  double la = lat * DEG, ang = lon * DEG + gmst(t), cl = cos(la);
  return {cl * cos(ang) * R_EARTH, cl * sin(ang) * R_EARTH, sin(la) * R_EARTH};
}
inline double elevation_deg(V3 sat, V3 site) {
  V3 d = sub(sat, site);
  return asin(dot(d, norm(site)) / len(d)) / DEG;
}
// Passes of a circular-orbit satellite over a site: 20 s steps, bisection on rise and set.
inline int find_passes(const Circ& sat, double lat, double lon, double t0, double horizon, double minEl, Pass* out, int maxN) {
  auto el = [&](double t) { return elevation_deg(circ_state(sat, t).r, site_eci(lat, lon, t)); };
  auto edge = [&](double a, double b) {
    double fa = el(a) - minEl;
    for (int it = 0; it < 40; it++) {
      double m = (a + b) * 0.5, fm = el(m) - minEl;
      if ((fa > 0.0) != (fm > 0.0)) b = m; else { a = m; fa = fm; }
    }
    return (a + b) * 0.5;
  };
  int n = 0;
  double prev = el(t0) - minEl, rise = prev > 0.0 ? t0 : -1.0, best = -90.0, tBest = t0, end = t0 + horizon, tp = t0;
  for (double t = t0 + 20.0; t <= end && n < maxN; t += 20.0) {
    double cur = el(t) - minEl;
    if (prev <= 0.0 && cur > 0.0) { rise = edge(tp, t); best = -90.0; }
    if (cur > 0.0 && cur + minEl > best) { tBest = t; best = cur + minEl; }
    if (prev > 0.0 && cur <= 0.0 && rise >= 0.0) {
      out[n++] = {rise, edge(tp, t), best, tBest};
      rise = -1.0;
    }
    tp = t; prev = cur;
  }
  return n;
}

}  // namespace sim
