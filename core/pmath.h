// Deterministic math for the simulation core.
// Every function is built only from IEEE-754 basic operations (+ - * / sqrt floor),
// so results are bit-identical in WebAssembly, on native x86/ARM and on a server,
// provided the build uses -ffp-contract=off and no fast-math.
#pragma once
#include <stdint.h>

namespace pm {

constexpr double PI = 3.141592653589793;
constexpr double TWO_PI = 6.283185307179586;
constexpr double HALF_PI = 1.5707963267948966;
constexpr double INF = __builtin_inf();

inline double fabs(double x) { return __builtin_fabs(x); }
inline double floor(double x) { return __builtin_floor(x); }
inline double sqrt(double x) { return __builtin_sqrt(x); }
inline double clamp(double x, double lo, double hi) { return x < lo ? lo : (x > hi ? hi : x); }

inline uint64_t bits(double x) { return __builtin_bit_cast(uint64_t, x); }
inline double from_bits(uint64_t b) { return __builtin_bit_cast(double, b); }

// ---------- sin / cos: Cody-Waite reduction by pi/2, Taylor kernels ----------
inline double k_sin(double r, double z) {
  return r + (r * z) * (-0.16666666666666666 + z * (0.008333333333333333 + z * (-0.0001984126984126984 +
         z * (2.7557319223985893e-06 + z * (-2.505210838544172e-08 + z * (1.6059043836821613e-10 +
         z * (-7.647163731819816e-13 + z * (2.8114572543455206e-15 + z * -8.22063524662433e-18))))))));
}
inline double k_cos(double z) {
  return (1.0 + z * -0.5) + (z * z) * (0.041666666666666664 + z * (-0.001388888888888889 + z * (2.48015873015873e-05 +
         z * (-2.755731922398589e-07 + z * (2.08767569878681e-09 + z * (-1.1470745597729725e-11 +
         z * (4.779477332387385e-14 + z * -1.5619206968586225e-16)))))));
}
// x = k*pi/2 + r, |r| <= pi/4; pi/2 split into four parts so r stays exact for large x.
inline double reduce(double x, long long& q) {
  double k = floor(x * 0.6366197723675814 + 0.5);
  double r = (((x + k * -1.5707963267341256) + k * -6.077100506303966e-11) + k * -2.0222662487111665e-21) + k * -8.4784276603689e-32;
  q = (long long)k;
  return r;
}
inline double sin(double x) {
  long long q; double r = reduce(x, q), z = r * r;
  switch (q & 3) {
    case 0: return k_sin(r, z);
    case 1: return k_cos(z);
    case 2: return -k_sin(r, z);
    default: return -k_cos(z);
  }
}
inline double cos(double x) {
  long long q; double r = reduce(x, q), z = r * r;
  switch (q & 3) {
    case 0: return k_cos(z);
    case 1: return -k_sin(r, z);
    case 2: return -k_cos(z);
    default: return k_sin(r, z);
  }
}

// ---------- atan family ----------
inline double atan_series(double t) {
  double z = t * t;
  return t * (1.0 - z * (0.3333333333333333 - z * (0.2 - z * (0.14285714285714285 - z * (0.1111111111111111 -
         z * (0.09090909090909091 - z * (0.07692307692307693 - z * (0.06666666666666667 - z * (0.058823529411764705 -
         z * (0.05263157894736842 - z * (0.047619047619047616 - z * (0.043478260869565216 - z * (0.04 -
         z * (0.037037037037037035 - z * (0.034482758620689655 - z * 0.03225806451612903)))))))))))))));
}
inline double atan(double x) {
  double a = fabs(x);
  bool inv = a > 1.0;
  double t = inv ? 1.0 / a : a, r;
  if (t > 0.2679491924311227) {  // tan(pi/12): shift by pi/6 to keep the series short
    double u = (t * 1.7320508075688772 - 1.0) / (t + 1.7320508075688772);
    r = 0.5235987755982988 + atan_series(u);
  } else {
    r = atan_series(t);
  }
  if (inv) r = HALF_PI - r;
  return x < 0.0 ? -r : r;
}
inline double atan2(double y, double x) {
  if (x > 0.0) return atan(y / x);
  if (x < 0.0) {
    double a = atan(y / x);
    return y >= 0.0 ? a + PI : a - PI;
  }
  return y > 0.0 ? HALF_PI : (y < 0.0 ? -HALF_PI : 0.0);
}
inline double asin(double x) { x = clamp(x, -1.0, 1.0); return atan2(x, sqrt((1.0 - x) * (1.0 + x))); }
inline double acos(double x) { x = clamp(x, -1.0, 1.0); return atan2(sqrt((1.0 - x) * (1.0 + x)), x); }

// ---------- exp / log / pow / cbrt ----------
inline double scalbn(double x, int n) {
  while (n > 1000) { x *= 0x1p1000; n -= 1000; }
  while (n < -1000) { x *= 0x1p-1000; n += 1000; }
  return x * from_bits((uint64_t)(uint32_t)(n + 1023) << 52);
}
inline double exp(double x) {
  if (x > 709.0) return INF;
  if (x < -745.0) return 0.0;
  double k = floor(x * 1.4426950408889634 + 0.5);
  double r = (x + k * -0.6931471803691238) + k * -1.9082149292705877e-10;
  double p = 1.0 + r * (1.0 + r * (0.5 + r * (0.16666666666666666 + r * (0.041666666666666664 + r * (0.008333333333333333 +
             r * (0.001388888888888889 + r * (0.0001984126984126984 + r * (2.48015873015873e-05 + r * (2.7557319223985893e-06 +
             r * (2.755731922398589e-07 + r * (2.505210838544172e-08 + r * (2.08767569878681e-09 + r * (1.6059043836821613e-10 +
             r * 1.1470745597729725e-11)))))))))))));
  return scalbn(p, (int)k);
}
inline double log(double x) {
  if (!(x > 0.0)) return -INF;
  uint64_t b = bits(x);
  int e = (int)((b >> 52) & 0x7ff);
  if (e == 0) { b = bits(x * 0x1p54); e = (int)((b >> 52) & 0x7ff) - 1077; }  // subnormal
  else e -= 1023;
  double m = from_bits((b & 0xFFFFFFFFFFFFFull) | 0x3FF0000000000000ull);  // [1, 2)
  if (m > 1.4142135623730951) { m *= 0.5; e += 1; }
  double s = (m - 1.0) / (m + 1.0), z = s * s, k = e;
  return k * 0.6931471803691238 + (k * 1.9082149292705877e-10 + (s + s) * (1.0 + z * (0.3333333333333333 + z * (0.2 +
         z * (0.14285714285714285 + z * (0.1111111111111111 + z * (0.09090909090909091 + z * (0.07692307692307693 +
         z * (0.06666666666666667 + z * (0.058823529411764705 + z * (0.05263157894736842 + z * (0.047619047619047616 +
         z * (0.043478260869565216 + z * 0.04)))))))))))));
}
inline double pow(double x, double y) {  // x >= 0 only
  if (x == 0.0) return y == 0.0 ? 1.0 : 0.0;
  double l = x > 0.0 ? log(x) : -INF;
  return exp(y * l);
}
inline double cbrt(double x) {
  if (x == 0.0) return 0.0;
  double a = fabs(x);
  double y = exp(log(a) / 3.0);
  y = y - (y * y * y - a) / (3.0 * y * y);  // one Newton step
  return x < 0.0 ? -y : y;
}
inline double sinh(double x) { double e = exp(x); return (e - 1.0 / e) * 0.5; }
inline double cosh(double x) { double e = exp(x); return (e + 1.0 / e) * 0.5; }

// ---------- angle wrapping ----------
inline double wrap2pi(double a) { return a - floor(a / TWO_PI) * TWO_PI; }
inline double wrapPi(double a) { a = wrap2pi(a); return a > PI ? a - TWO_PI : a; }

}  // namespace pm
