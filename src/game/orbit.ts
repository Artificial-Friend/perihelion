// Stage 2 contracts around Haven Commercial. Each target flies a real circular orbit.
import { Circ, DEG, R_EARTH } from '../sim/core';

export const HAVEN: Circ = { a: R_EARTH + 425, i: 51.6 * DEG, raan: 40 * DEG, u0: 0, t0: 0 };
/** Where the tug idles: 120 m ahead of Haven. */
export const IDLE: Circ = { ...HAVEN, u0: HAVEN.u0 + 0.12 / HAVEN.a };

export interface Contract {
  id: string; title: string; client: string; brief: string; physics: string;
  target: Circ; hold: number[]; reward: number; model: 'pod' | 'sat'; name: string;
}

const ahead = (km: number, dAlt = 0): Circ => ({ ...HAVEN, a: HAVEN.a + dAlt, u0: HAVEN.u0 + (0.12 + km) / (HAVEN.a + dAlt) });

export const CONTRACTS: Contract[] = [
  {
    id: 'pod', title: 'Drifting cargo pod', client: 'Haven Commercial', name: 'pod',
    brief: 'A cargo pod slipped its berth and drifts 2.8 km ahead of you, in the same orbit.',
    physics: 'To catch something ahead in your own orbit you first drop slightly lower: a lower orbit is a faster orbit.',
    target: ahead(2.8), hold: [-15, 0, 0], reward: 9000, model: 'pod',
  },
  {
    id: 'bag', title: 'Lost sensor package', client: 'Aurora Labs', name: 'package',
    brief: 'An EVA crew lost a sensor package. It is 6 km behind Haven and 1.2 km lower.',
    physics: 'The package is lower, so it is slowly overtaking you. Waiting lets it come closer for free.',
    target: ahead(-6, -1.2), hold: [-15, 0, 0], reward: 7500, model: 'pod',
  },
  {
    id: 'sat', title: 'Dead CubeSat', client: 'Orbit Insurance', name: 'satellite',
    brief: 'A dead CubeSat tumbles 14 km ahead and 3.5 km higher. The insurer wants it removed before it breaks up.',
    physics: 'Higher orbits are slower. To reach something above and ahead you must climb, which costs more.',
    target: ahead(14, 3.5), hold: [-20, 0, 0], reward: 13000, model: 'sat',
  },
];
