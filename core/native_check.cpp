// Native driver for parity tests: reads "name n x0 .. xn-1 outN" lines from stdin, runs the
// same export as the WebAssembly build, prints outN results as hex bit patterns.
#include <cstdio>
#include <cstring>
#include <cstdint>
#include "api.cpp"

int main() {
  char name[32];
  int n, outN;
  struct { const char* n; void (*f)(); } fns[] = {
    {"probe", k_probe}, {"kepler", k_kepler}, {"circ", k_circ}, {"elements", k_elements}, {"rel", k_rel}, {"abs", k_abs},
    {"basis", k_basis}, {"orbit_info", k_orbit_info}, {"ephem", k_ephem}, {"sun_fraction", k_sun_fraction},
    {"lat_lon", k_lat_lon}, {"dose", k_dose}, {"thermal", k_thermal}, {"closest", k_closest}, {"intercept", k_intercept},
    {"site", k_site}, {"elevation", k_elevation}, {"passes", k_passes}};
  while (scanf("%31s %d", name, &n) == 2) {
    double* io = IO;
    memset(io, 0, sizeof(IO));
    for (int k = 0; k < n; k++) { unsigned long long b; scanf("%llx", &b); memcpy(&io[k], &b, 8); }
    scanf("%d", &outN);
    for (auto& f : fns) if (!strcmp(f.n, name)) f.f();
    for (int k = 0; k < outN; k++) { unsigned long long b; memcpy(&b, &io[k], 8); printf("%llx ", b); }
    printf("\n");
  }
}
