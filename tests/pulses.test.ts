import { describe, expect, it } from 'vitest';
import { SONAR, TILE } from '@/config';
import { PulseSystem } from '@/sim/pulses';
import { FLOOR, Grid, WALL } from '@/world/grid';

function box(w: number, h: number): Grid {
  const g = new Grid(w, h, WALL);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) g.set(x, y, FLOOR);
  return g;
}

describe('PulseSystem', () => {
  it('reveals an entity in the open once the ring passes it, and not one behind a wall', () => {
    const g = box(20, 9);
    g.set(8, 4, WALL);
    g.set(8, 3, WALL);
    g.set(8, 5, WALL);
    const ps = new PulseSystem();
    const ox = 3.5 * TILE;
    const oy = 4.5 * TILE;
    const p = ps.emit(g, 'player', ox, oy, 0, 360, SONAR.range, 3, [1, 2, 3]);
    const openX = 6.5 * TILE;
    const behindX = 11.5 * TILE;
    // ring has not reached yet
    expect(ps.reaches(p, 0.05, openX, oy, 8)).toBe(false);
    const tOpen = (openX - ox) / SONAR.speed + 0.01;
    expect(ps.reaches(p, tOpen, openX, oy, 8)).toBe(true);
    const tBehind = (behindX - ox) / SONAR.speed + 0.01;
    expect(ps.reaches(p, tBehind, behindX, oy, 8)).toBe(false);
  });
  it('expires and caps pulses per owner', () => {
    const g = box(12, 12);
    const ps = new PulseSystem();
    for (let i = 0; i < SONAR.maxPlayerPulses + 3; i++) ps.emit(g, 'player', 5 * TILE, 5 * TILE, i * 0.1, 90, SONAR.range, 3, [1, 2, 3]);
    ps.update(1);
    expect(ps.pulses.filter((p) => p.owner === 'player').length).toBe(SONAR.maxPlayerPulses);
    ps.update(100);
    expect(ps.pulses.length).toBe(0);
  });
});
