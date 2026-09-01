import { describe, expect, it } from 'vitest';
import { cyrb128, dailySeedString, floorRng, localDateString, sfc32 } from '@/core/rng';

describe('rng', () => {
  it('same seed gives identical sequences', () => {
    const a = sfc32(1, 2, 3, 4);
    const b = sfc32(1, 2, 3, 4);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });
  it('different seeds differ', () => {
    const a = sfc32(1, 2, 3, 4);
    const b = sfc32(1, 2, 3, 5);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a() === b()) same++;
    expect(same).toBeLessThan(5);
  });
  it('cyrb128 is stable', () => {
    expect(cyrb128('echo-daily-2026-09-02')).toEqual(cyrb128('echo-daily-2026-09-02'));
    expect(cyrb128('a')).not.toEqual(cyrb128('b'));
    for (const v of cyrb128('hello')) expect(v).toBeGreaterThanOrEqual(0);
  });
  it('daily seed string uses the local date', () => {
    expect(localDateString(new Date(2026, 8, 2))).toBe('2026-09-02');
    expect(dailySeedString(new Date(2026, 8, 2))).toBe('echo-daily-2026-09-02');
    expect(dailySeedString(new Date(2026, 0, 9))).toBe('echo-daily-2026-01-09');
  });
  it('floor rng differs per floor and is deterministic', () => {
    const seed = cyrb128('seed');
    const f3 = floorRng(seed, 3);
    const f3b = floorRng(seed, 3);
    const f4 = floorRng(seed, 4);
    expect(f3()).toBe(f3b());
    expect(f3()).not.toBe(f4());
  });
  it('is roughly uniform', () => {
    const r = sfc32(9, 8, 7, 6);
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += r();
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });
});
