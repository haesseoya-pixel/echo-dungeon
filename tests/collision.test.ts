import { describe, expect, it } from 'vitest';
import { TILE } from '@/config';
import { circleOverlapsSolid, resolveCircle } from '@/entities/collision';
import { FLOOR, Grid, WALL } from '@/world/grid';

function box(w: number, h: number): Grid {
  const g = new Grid(w, h, WALL);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) g.set(x, y, FLOOR);
  return g;
}

describe('resolveCircle', () => {
  const g = box(8, 8);
  const r = 10;
  it('pushes out of a wall along the moved axis', () => {
    // start 20px from the east wall (x = 7*TILE), move 30px right
    const x = 7 * TILE - 20;
    const y = 4 * TILE;
    const res = resolveCircle(g, x, y, r, 30, 0);
    expect(res.hitX).toBe(true);
    expect(res.x).toBeCloseTo(7 * TILE - r, 3);
    expect(res.y).toBe(y);
    expect(circleOverlapsSolid(g, res.x, res.y, r)).toBe(false);
  });
  it('keeps the tangential component when sliding along a wall', () => {
    const x = 7 * TILE - 12;
    const y = 4 * TILE;
    const res = resolveCircle(g, x, y, r, 10, 15);
    expect(res.hitX).toBe(true);
    expect(res.hitY).toBe(false);
    expect(res.y).toBeCloseTo(y + 15, 6);
    expect(res.x).toBeCloseTo(7 * TILE - r, 3);
  });
  it('does not tunnel through a corner at chase speed', () => {
    const step = 150 / 60;
    let x = 1.5 * TILE;
    let y = 1.5 * TILE;
    for (let i = 0; i < 200; i++) {
      const res = resolveCircle(g, x, y, r, -step, -step);
      x = res.x;
      y = res.y;
      expect(circleOverlapsSolid(g, x, y, r)).toBe(false);
    }
    expect(x).toBeCloseTo(TILE + r, 2);
    expect(y).toBeCloseTo(TILE + r, 2);
  });
  it('is stable when already touching a wall', () => {
    const res = resolveCircle(g, TILE + r, 4 * TILE, r, -1, 0);
    expect(res.x).toBeCloseTo(TILE + r, 3);
  });
});
