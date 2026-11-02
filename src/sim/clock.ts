// One world clock for every player: real time, shifted so that 2026 reads as 2060.
// Seconds since J2000 (2000-01-01 12:00 TT, approximated as UTC here).
const J2000_UNIX = 946728000;
const YEAR_OFFSET_S = (Date.UTC(2060, 0, 1) - Date.UTC(2026, 0, 1)) / 1000;
let skew = 0;

/** Debug only: shifts this client's clock. Never used by the game itself. */
export function setClockSkew(s: number) { skew = s; }

export function worldNow() { return Date.now() / 1000 + skew - J2000_UNIX + YEAR_OFFSET_S; }

export function worldDate(t: number) { return new Date((t + J2000_UNIX) * 1000); }

export function fmtWorldDate(t: number) {
  const d = worldDate(t), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
