import { NOISE, TILE } from '@/config';
import type { Grid } from './grid';
import { wallsBetween } from './los';

export type NoiseSource = 'pulse' | 'step' | 'stone' | 'flare' | 'trap' | 'bat' | 'bandage' | 'screech' | 'roar';

export interface NoiseEvent {
  x: number;
  y: number;
  /** radius in tiles */
  radius: number;
  loudness: number;
  source: NoiseSource;
  t: number;
  /** true when made by the player (enemies track the player through these) */
  player: boolean;
}

export class NoiseSystem {
  events: NoiseEvent[] = [];

  emit(e: NoiseEvent): void {
    this.events.push(e);
  }

  drain(): NoiseEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}

/** Intensity (0 = unheard) of a noise event for a listener at (lx, ly). */
export function hearIntensity(grid: Grid, lx: number, ly: number, e: NoiseEvent, hearingMult: number, tile = TILE): number {
  const d = Math.hypot(e.x - lx, e.y - ly);
  const maxR = e.radius * tile * hearingMult;
  if (d > maxR) return 0;
  const walls = Math.min(NOISE.maxWalls, wallsBetween(grid, lx, ly, e.x, e.y, NOISE.maxWalls + 1, tile));
  const effR = maxR * (1 - NOISE.wallAttenuation * walls);
  if (d > effR || effR <= 0) return 0;
  return e.loudness * (1 - d / effR);
}
