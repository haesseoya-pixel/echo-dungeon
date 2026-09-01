import { describe, expect, it } from 'vitest';
import { TILE } from '@/config';
import { FLOOR, Grid, WALL } from '@/world/grid';
import { hasLOS, wallsBetween } from '@/world/los';
import { castFan, castRay, groupRuns, runEnd } from '@/world/raycast';
import { hearIntensity } from '@/world/noise';

function box(w: number, h: number): Grid {
  const g = new Grid(w, h, WALL);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) g.set(x, y, FLOOR);
  return g;
}

describe('castRay', () => {
  const g = box(5, 5);
  const cx = 2.5 * TILE;
  const cy = 2.5 * TILE;
  it('hits the east wall face', () => {
    const h = castRay(g, cx, cy, 1, 0, 1000);
    expect(h.side).toBe(0);
    expect(h.d).toBeCloseTo(1.5 * TILE);
    expect(h.x).toBeCloseTo(4 * TILE);
  });
  it('hits the north wall face', () => {
    const h = castRay(g, cx, cy, 0, -1, 1000);
    expect(h.side).toBe(1);
    expect(h.y).toBeCloseTo(1 * TILE);
  });
  it('diagonal hits the corner tile', () => {
    const s = Math.SQRT1_2;
    const h = castRay(g, cx, cy, s, s, 1000);
    expect(h.side).not.toBe(-1);
    expect(h.d).toBeCloseTo(1.5 * TILE * Math.SQRT2, 3);
  });
  it('misses when maxDist is shorter than the wall', () => {
    const h = castRay(g, cx, cy, 1, 0, TILE);
    expect(h.side).toBe(-1);
    expect(h.d).toBe(TILE);
  });
  it('castFan returns ordered hits', () => {
    const hits = castFan(g, cx, cy, 8, 1000);
    expect(hits.length).toBe(32);
    expect(hits[3]).toBe(0); // ray 0 (east) hits x-face
    expect(hits[2 * 4 + 3]).toBe(1); // ray 2 (south) hits y-face
    for (let i = 0; i < 8; i++) expect(hits[i * 4 + 3]).not.toBe(-1);
  });
});

describe('groupRuns', () => {
  it('merges straight-wall rays and splits at corners', () => {
    const g = box(12, 12);
    const hits = castFan(g, 6 * TILE, 6 * TILE, 360, 2000);
    const runs = groupRuns(hits, 360);
    expect(runs[runs.length - 1]).toBe(360);
    expect(runs.length - 1).toBeGreaterThanOrEqual(4);
    expect(runs.length - 1).toBeLessThan(80);
    // runEnd agrees with the next start
    for (let k = 0; k < runs.length - 2; k++) {
      expect(runEnd(hits, runs[k]!, 360)).toBeLessThanOrEqual(runs[k + 1]!);
    }
  });
});

describe('los and noise', () => {
  it('wallsBetween counts walls and caps', () => {
    const g = box(9, 5);
    g.set(4, 2, WALL);
    expect(wallsBetween(g, 2.5 * TILE, 2.5 * TILE, 3.5 * TILE, 2.5 * TILE)).toBe(0);
    expect(wallsBetween(g, 2.5 * TILE, 2.5 * TILE, 6.5 * TILE, 2.5 * TILE)).toBe(1);
    expect(hasLOS(g, 2.5 * TILE, 2.5 * TILE, 6.5 * TILE, 2.5 * TILE)).toBe(false);
    expect(hasLOS(g, 2.5 * TILE, 2.5 * TILE, 3.5 * TILE, 2.5 * TILE)).toBe(true);
    g.set(5, 2, WALL);
    g.set(6, 2, WALL);
    expect(wallsBetween(g, 2.5 * TILE, 2.5 * TILE, 7.5 * TILE, 2.5 * TILE, 3)).toBe(3);
  });
  it('hearing falls off with distance and walls', () => {
    const g = box(20, 5);
    const ev = { x: 2.5 * TILE, y: 2.5 * TILE, radius: 5, loudness: 1, source: 'stone' as const, t: 0, player: true };
    const near = hearIntensity(g, 3.5 * TILE, 2.5 * TILE, ev, 1);
    const far = hearIntensity(g, 6.5 * TILE, 2.5 * TILE, ev, 1);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(hearIntensity(g, 9.5 * TILE, 2.5 * TILE, ev, 1)).toBe(0);
    expect(hearIntensity(g, 9.5 * TILE, 2.5 * TILE, ev, 2)).toBeGreaterThan(0);
    g.set(4, 2, WALL);
    const behind = hearIntensity(g, 6.5 * TILE, 2.5 * TILE, ev, 1);
    expect(behind).toBeLessThan(far);
    expect(hearIntensity(g, 5.4 * TILE, 2.5 * TILE, ev, 1)).toBeGreaterThan(0); // still audible through one wall when close
  });
});
