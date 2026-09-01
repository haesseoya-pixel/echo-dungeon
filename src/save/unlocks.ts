import type { SaveV1 } from './storage';

export interface UnlockDef {
  id: string;
  check: (s: SaveV1, ctx: { cleared: boolean; dailyFloor: number }) => boolean;
}

export const UNLOCKS: readonly UnlockDef[] = [
  { id: 'stone_start3', check: (s) => s.progress.maxFloorEver >= 3 },
  { id: 'flare_start', check: (s) => s.progress.maxFloorEver >= 5 },
  { id: 'silencer_start', check: (s) => s.progress.maxFloorEver >= 7 },
  { id: 'compass', check: (s) => s.progress.maxFloorEver >= 8 },
  { id: 'heart4', check: (s, ctx) => ctx.cleared || s.records.normal.bestClearTimeMs !== null },
  { id: 'palette_alt', check: (s, ctx) => ctx.dailyFloor >= 5 || s.progress.dailyBestFloorEver >= 5 },
];

/** Grants newly satisfied unlocks in place and returns their ids. */
export function grantUnlocks(s: SaveV1, ctx: { cleared: boolean; dailyFloor: number }): string[] {
  const out: string[] = [];
  for (const u of UNLOCKS) {
    if (s.unlocks.includes(u.id)) continue;
    if (u.check(s, ctx)) {
      s.unlocks.push(u.id);
      out.push(u.id);
    }
  }
  return out;
}
