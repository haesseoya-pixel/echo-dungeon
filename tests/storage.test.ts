import { describe, expect, it } from 'vitest';
import { defaultSave, load, sanitize, save, SAVE_KEY, type StorageLike } from '@/save/storage';
import { grantUnlocks } from '@/save/unlocks';

class Mem implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('storage', () => {
  it('corrupt JSON gives defaults', () => {
    const st = new Mem();
    st.setItem(SAVE_KEY, '{oops');
    expect(load(st)).toEqual(defaultSave());
  });
  it('sanitizes partial objects and trims daily to 30', () => {
    const daily: Record<string, unknown> = {};
    for (let i = 1; i <= 40; i++) daily[`2026-01-${String(i).padStart(2, '0')}`] = { bestFloor: i, clearTimeMs: null, attempts: 1 };
    daily['bad key'] = { bestFloor: 99 };
    const s = sanitize({ settings: { volume: 5, touch: 'weird' }, records: { daily }, unlocks: ['compass', 3] });
    expect(s.settings.volume).toBe(1);
    expect(s.settings.touch).toBe('auto');
    expect(Object.keys(s.records.daily).length).toBe(30);
    expect(s.records.daily['2026-01-40']?.bestFloor).toBe(40);
    expect(s.records.daily['2026-01-01']).toBeUndefined();
    expect(s.unlocks).toEqual(['compass']);
  });
  it('roundtrips through save/load', () => {
    const st = new Mem();
    const s = defaultSave();
    s.records.normal.bestFloor = 7;
    s.progress.maxFloorEver = 7;
    expect(save(st, s)).toBe(true);
    expect(load(st)).toEqual(s);
    expect(save(null, s)).toBe(false);
  });
});

describe('unlocks', () => {
  it('grants by floor milestones, idempotently', () => {
    const s = defaultSave();
    s.progress.maxFloorEver = 5;
    expect(grantUnlocks(s, { cleared: false, dailyFloor: 0 }).sort()).toEqual(['flare_start', 'stone_start3']);
    expect(grantUnlocks(s, { cleared: false, dailyFloor: 0 })).toEqual([]);
    s.progress.maxFloorEver = 8;
    expect(grantUnlocks(s, { cleared: false, dailyFloor: 0 }).sort()).toEqual(['compass', 'silencer_start']);
    expect(grantUnlocks(s, { cleared: true, dailyFloor: 5 }).sort()).toEqual(['heart4', 'palette_alt']);
  });
});
