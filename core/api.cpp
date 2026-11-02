// Flat C ABI over one shared double buffer, for the browser (WebAssembly) and native tests.
// Each export reads its inputs from IO[0..] and writes its results back to IO[0..].
#include "sim.h"
using namespace sim;

#ifdef __wasm__
#define EXPORT(name) extern "C" __attribute__((export_name(#name)))
#else
#define EXPORT(name) extern "C"
#endif

static double IO[8192];
static V3 PATH[2000];
static Pass PASSES[48];

static State getState(int o) { return {{IO[o], IO[o + 1], IO[o + 2]}, {IO[o + 3], IO[o + 4], IO[o + 5]}}; }
static void putState(const State& s, int o) {
  IO[o] = s.r.x; IO[o + 1] = s.r.y; IO[o + 2] = s.r.z; IO[o + 3] = s.v.x; IO[o + 4] = s.v.y; IO[o + 5] = s.v.z;
}
static V3 getV3(int o) { return {IO[o], IO[o + 1], IO[o + 2]}; }
static void putV3(V3 v, int o) { IO[o] = v.x; IO[o + 1] = v.y; IO[o + 2] = v.z; }
static Circ getCirc(int o) { return {IO[o], IO[o + 1], IO[o + 2], IO[o + 3], IO[o + 4]}; }

EXPORT(io) double* io() { return IO; }
EXPORT(version) int version() { return 1; }

// [0..5] state, [6] dt, [7] mu -> [0..5]
EXPORT(kepler) void k_kepler() { putState(kepler(getState(0), IO[6], IO[7]), 0); }
// [0..4] circ, [5] t -> [0..5]
EXPORT(circ) void k_circ() { putState(circ_state(getCirc(0), IO[5]), 0); }
// [0..7] a e i raan argp M0 t0 mu, [8] t -> [0..5]
EXPORT(elements) void k_elements() {
  Elements el{IO[0], IO[1], IO[2], IO[3], IO[4], IO[5], IO[6], IO[7]};
  putState(elements_state(el, IO[8]), 0);
}
// [0..5] ship, [6..11] target -> [0..2] p (m), [3..5] w (m/s), target LVLH
EXPORT(rel) void k_rel() {
  V3 p, w;
  rel_state(getState(0), getState(6), p, w);
  putV3(p, 0); putV3(w, 3);
}
// [0..2] p, [3..5] w, [6..11] target -> [0..5] state
EXPORT(abs) void k_abs() { putState(abs_state(getV3(0), getV3(3), getState(6)), 0); }
// [0..5] state -> [0..2] V, [3..5] R, [6..8] H
EXPORT(basis) void k_basis() {
  Basis B = lvlh(getState(0));
  putV3(B.V, 0); putV3(B.R, 3); putV3(B.H, 6);
}
// [0..5] state, [6] mu, [7] body radius -> a e periAlt apoAlt alt period inc
EXPORT(orbit_info) void k_orbit_info() {
  OrbitInfo o = orbit_info(getState(0), IO[6], IO[7]);
  IO[0] = o.a; IO[1] = o.e; IO[2] = o.periAlt; IO[3] = o.apoAlt; IO[4] = o.alt; IO[5] = o.period; IO[6] = o.inc;
}
// [0] t -> [0..2] sun, [3..5] moon (geocentric), [6] gmst, [7..24] planets 0..5 (heliocentric)
EXPORT(ephem) void k_ephem() {
  double t = IO[0];
  putV3(sun_eci(t), 0);
  putV3(moon_eci(t), 3);
  IO[6] = gmst(t);
  for (int k = 0; k < 6; k++) putV3(planet_helio(k, t), 7 + 3 * k);
}
// [0..2] r, [3..5] sun -> [0] visible fraction of the Sun's disc
EXPORT(sun_fraction) void k_sun_fraction() { IO[0] = sun_fraction(getV3(0), getV3(3)); }
// [0..2] r, [3] t -> [0] lat, [1] lon (degrees)
EXPORT(lat_lon) void k_lat_lon() {
  double lat, lon;
  lat_lon(getV3(0), IO[3], lat, lon);
  IO[0] = lat; IO[1] = lon;
}
// [0] lat, [1] lon, [2] solar-proton intensity, [3] storm flag, [4] shielding -> [0] rate, [1] SAA factor
EXPORT(dose) void k_dose() {
  double lat = IO[0], lon = IO[1], spe = IO[2], shield = IO[4];
  int storm = (int)IO[3];
  double saa = saa_factor(lat, lon);
  IO[0] = dose_rate(lat, lon, spe, storm != 0, shield);
  IO[1] = saa;
}
// [0] T, [1] dt, [2] area, [3] power, [4] sun fraction, [5] absorptivity, [6] heat capacity, [7] T floor -> [0] T, [1] qin, [2] qout
EXPORT(thermal) void k_thermal() {
  double qin, qout;
  double T = thermal_step(IO[0], IO[1], IO[2], IO[3], IO[4], IO[5], IO[6], IO[7], qin, qout);
  IO[0] = T; IO[1] = qin; IO[2] = qout;
}
// [0..5] ship, [6..10] target circ, [11] t0, [12] horizon, [13] samples -> [0] d (m), [1] t, [2..4] p, path at [100 + 3k]
EXPORT(closest) void k_closest() {
  State ship = getState(0);
  Circ tgt = getCirc(6);
  int n = (int)IO[13];
  n = n > 2 ? (n < 2000 ? n : 2000) : 2;
  Closest c = closest_approach(ship, tgt, IO[11], IO[12], n, PATH);
  IO[0] = c.d; IO[1] = c.t; putV3(c.p, 2);
  for (int k = 0; k < n; k++) putV3(PATH[k], 100 + 3 * k);
}
// [0..5] ship, [6..10] target circ, [11..13] hold (m), [14] t0, [15] tof -> [0] ok, [1..3] dv1, [4..6] dv2, [7] dv (m/s), [8] periAlt
EXPORT(intercept) void k_intercept() {
  Intercept r = intercept(getState(0), getCirc(6), getV3(11), IO[14], IO[15]);
  IO[0] = r.ok; putV3(r.dv1, 1); putV3(r.dv2, 4); IO[7] = r.dv; IO[8] = r.periAlt;
}
// [0] lat, [1] lon, [2] t -> [0..2] site position
EXPORT(site) void k_site() { putV3(site_eci(IO[0], IO[1], IO[2]), 0); }
// [0..2] satellite, [3..5] site -> [0] elevation (degrees)
EXPORT(elevation) void k_elevation() { IO[0] = elevation_deg(getV3(0), getV3(3)); }
// [0..4] circ, [5] lat, [6] lon, [7] t0, [8] horizon, [9] min elevation -> [0] n, then rise set maxEl tMax per pass
EXPORT(passes) void k_passes() {
  Circ c = getCirc(0);
  int n = find_passes(c, IO[5], IO[6], IO[7], IO[8], IO[9], PASSES, 48);
  IO[0] = n;
  for (int k = 0; k < n; k++) {
    IO[1 + 4 * k] = PASSES[k].rise; IO[2 + 4 * k] = PASSES[k].set;
    IO[3 + 4 * k] = PASSES[k].maxEl; IO[4 + 4 * k] = PASSES[k].tMax;
  }
}
// Parity probe for the math library: [0] x -> sin cos atan exp log atan2 asin sinh cbrt pow
EXPORT(probe) void k_probe() {
  double x = IO[0];
  IO[0] = pm::sin(x); IO[1] = pm::cos(x); IO[2] = pm::atan(x);
  IO[3] = pm::exp(x * 0.01); IO[4] = pm::log(pm::fabs(x) + 0.001);
  IO[5] = pm::atan2(x, 1.3); IO[6] = pm::asin(pm::sin(x));
  IO[7] = pm::sinh(x * 0.01); IO[8] = pm::cbrt(x); IO[9] = pm::pow(pm::fabs(x) + 1.0, 1.5);
}
