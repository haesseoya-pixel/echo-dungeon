import { describe, expect, it } from 'vitest';
import { difficultyFor } from '@/config';
import { cyrb128 } from '@/core/rng';
import { distanceField } from '@/world/bfs';
import { generateFloor } from '@/world/dungeon';
import { FLOOR, WALL } from '@/world/grid';

const FLOORS = [1, 3, 6, 10];
const SEEDS = 20;

describe('dungeon generation', () => {
  it('every floor tile is reachable from start; borders are solid', () => {
    for (let s = 0; s < SEEDS; s++) {
      for (const f of FLOORS) {
        const L = generateFloor(cyrb128(`seed-${s}`), f);
        const d = distanceField(L.grid, L.start.x, L.start.y);
        for (let i = 0; i < L.grid.t.length; i++) {
          if (L.grid.t[i] !== WALL) expect(d[i]).toBeGreaterThanOrEqual(0);
        }
        for (let x = 0; x < L.w; x++) {
          expect(L.grid.get(x, 0)).toBe(WALL);
          expect(L.grid.get(x, L.h - 1)).toBe(WALL);
        }
        for (let y = 0; y < L.h; y++) {
          expect(L.grid.get(0, y)).toBe(WALL);
          expect(L.grid.get(L.w - 1, y)).toBe(WALL);
        }
      }
    }
  });
  it('start, exit and key are distinct floor tiles with distance rules', () => {
    for (let s = 0; s < SEEDS; s++) {
      for (const f of FLOORS) {
        const L = generateFloor(cyrb128(`seed-${s}`), f);
        expect(L.grid.isSolid(L.start.x, L.start.y)).toBe(false);
        expect(L.grid.isSolid(L.exit.x, L.exit.y)).toBe(false);
        expect(L.start).not.toEqual(L.exit);
        let maxD = 0;
        for (let i = 0; i < L.dStart.length; i++) if (L.dStart[i]! > maxD) maxD = L.dStart[i]!;
        expect(L.dStart[L.exit.y * L.w + L.exit.x]).toBeGreaterThanOrEqual(0.5 * maxD);
        if (difficultyFor(f).locked) {
          expect(L.key).not.toBeNull();
          const k = L.key!;
          expect(L.grid.get(k.x, k.y)).toBe(FLOOR);
          expect(L.dStart[k.y * L.w + k.x]).toBeGreaterThanOrEqual(8);
          expect(L.dExit[k.y * L.w + k.x]).toBeGreaterThanOrEqual(6);
        } else {
          expect(L.key).toBeNull();
        }
      }
    }
  });
  it('entities sit on floor tiles, away from start; spiders only on open room tiles', () => {
    for (let s = 0; s < SEEDS; s++) {
      for (const f of FLOORS) {
        const L = generateFloor(cyrb128(`seed-${s}`), f);
        const diff = difficultyFor(f);
        expect(L.enemies.filter((e) => e.kind === 'hunter').length).toBe(diff.hunters);
        for (const e of L.enemies) {
          expect(L.grid.isSolid(e.x, e.y)).toBe(false);
          const d = L.dStart[e.y * L.w + e.x]!;
          if (e.kind === 'hunter' || e.kind === 'predator') expect(d).toBeGreaterThanOrEqual(12);
          if (e.kind === 'bat') expect(d).toBeGreaterThanOrEqual(10);
          if (e.kind === 'spider') {
            expect(d).toBeGreaterThanOrEqual(8);
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) expect(L.grid.get(e.x + ox, e.y + oy)).toBe(FLOOR);
          }
        }
        const spiders = L.enemies.filter((e) => e.kind === 'spider');
        for (let i = 0; i < spiders.length; i++) {
          for (let j = i + 1; j < spiders.length; j++) {
            expect(Math.hypot(spiders[i]!.x - spiders[j]!.x, spiders[i]!.y - spiders[j]!.y)).toBeGreaterThanOrEqual(3);
          }
        }
        for (const it of L.items) {
          expect(L.grid.isSolid(it.x, it.y)).toBe(false);
          expect(L.dStart[it.y * L.w + it.x]).toBeGreaterThanOrEqual(4);
        }
        if (f === 1) {
          expect(L.items.filter((i) => i.kind === 'stone').length).toBeGreaterThanOrEqual(2);
          expect(L.items.some((i) => i.kind === 'bandage')).toBe(true);
        }
      }
    }
  });
  it('is deterministic per (seed, floor) and differs across floors', () => {
    const seed = cyrb128('determinism');
    const a = generateFloor(seed, 2);
    const b = generateFloor(seed, 2);
    expect(Array.from(a.grid.t)).toEqual(Array.from(b.grid.t));
    expect(a.enemies).toEqual(b.enemies);
    expect(a.items).toEqual(b.items);
    const c = generateFloor(seed, 3);
    expect(Array.from(a.grid.t)).not.toEqual(Array.from(c.grid.t));
  });
  it('difficulty table is monotonic and capped', () => {
    let prevFade = Infinity;
    let prevHunters = 0;
    for (let f = 1; f <= 30; f++) {
      const d = difficultyFor(f);
      expect(d.fade).toBeLessThanOrEqual(prevFade);
      expect(d.hunters).toBeGreaterThanOrEqual(prevHunters);
      expect(d.hunters).toBeLessThanOrEqual(14);
      expect(d.spiders).toBeLessThanOrEqual(16);
      expect(d.fade).toBeGreaterThanOrEqual(1.8);
      expect(d.hearing).toBeLessThanOrEqual(1.6);
      prevFade = d.fade;
      prevHunters = d.hunters;
    }
  });
});
