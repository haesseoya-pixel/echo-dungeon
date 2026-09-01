export const SAVE_KEY = 'echo-dungeon:save';

export interface DailyRecord {
  bestFloor: number;
  clearTimeMs: number | null;
  attempts: number;
}

export interface SaveV1 {
  v: 1;
  settings: { volume: number; shake: boolean; touch: 'auto' | 'on' | 'off'; palette: 'default' | 'alt'; wallMemory: boolean };
  records: {
    normal: { bestFloor: number; bestClearTimeMs: number | null; runs: number };
    daily: Record<string, DailyRecord>;
  };
  unlocks: string[];
  progress: { maxFloorEver: number; totalPulses: number; totalRuns: number; tutorialSeen: string[]; dailyBestFloorEver: number; guideSeen: boolean };
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function defaultSave(): SaveV1 {
  return {
    v: 1,
    settings: { volume: 0.7, shake: true, touch: 'auto', palette: 'default', wallMemory: true },
    records: { normal: { bestFloor: 0, bestClearTimeMs: null, runs: 0 }, daily: {} },
    unlocks: [],
    progress: { maxFloorEver: 0, totalPulses: 0, totalRuns: 0, tutorialSeen: [], dailyBestFloorEver: 0, guideSeen: false },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Merges an untrusted object over defaults; never throws. */
export function sanitize(raw: unknown): SaveV1 {
  const d = defaultSave();
  if (!isObj(raw)) return d;
  const s = isObj(raw.settings) ? raw.settings : {};
  const r = isObj(raw.records) ? raw.records : {};
  const rn = isObj(r.normal) ? r.normal : {};
  const p = isObj(raw.progress) ? raw.progress : {};
  const daily: Record<string, DailyRecord> = {};
  if (isObj(r.daily)) {
    const keys = Object.keys(r.daily)
      .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort()
      .slice(-30);
    for (const k of keys) {
      const v = (r.daily as Record<string, unknown>)[k];
      if (!isObj(v)) continue;
      daily[k] = { bestFloor: num(v.bestFloor, 0, 0, 999), clearTimeMs: numOrNull(v.clearTimeMs), attempts: num(v.attempts, 0, 0, 1e6) };
    }
  }
  return {
    v: 1,
    settings: {
      volume: num(s.volume, d.settings.volume, 0, 1),
      shake: typeof s.shake === 'boolean' ? s.shake : d.settings.shake,
      touch: s.touch === 'on' || s.touch === 'off' ? s.touch : 'auto',
      palette: s.palette === 'alt' ? 'alt' : 'default',
      wallMemory: typeof s.wallMemory === 'boolean' ? s.wallMemory : true,
    },
    records: {
      normal: { bestFloor: num(rn.bestFloor, 0, 0, 999), bestClearTimeMs: numOrNull(rn.bestClearTimeMs), runs: num(rn.runs, 0, 0, 1e7) },
      daily,
    },
    unlocks: Array.isArray(raw.unlocks) ? raw.unlocks.filter((x): x is string => typeof x === 'string').slice(0, 32) : [],
    progress: {
      maxFloorEver: num(p.maxFloorEver, 0, 0, 999),
      totalPulses: num(p.totalPulses, 0, 0, 1e9),
      totalRuns: num(p.totalRuns, 0, 0, 1e7),
      tutorialSeen: Array.isArray(p.tutorialSeen) ? p.tutorialSeen.filter((x): x is string => typeof x === 'string').slice(0, 32) : [],
      dailyBestFloorEver: num(p.dailyBestFloorEver, 0, 0, 999),
      guideSeen: p.guideSeen === true,
    },
  };
}

export function load(storage: StorageLike | null): SaveV1 {
  if (!storage) return defaultSave();
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function save(storage: StorageLike | null, s: SaveV1): boolean {
  if (!storage) return false;
  try {
    // trim daily map to the newest 30 entries
    const keys = Object.keys(s.records.daily).sort();
    while (keys.length > 30) delete s.records.daily[keys.shift()!];
    storage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function getLocalStorage(): StorageLike | null {
  try {
    const ls = globalThis.localStorage;
    ls.setItem('__echo_probe__', '1');
    ls.removeItem('__echo_probe__');
    return ls;
  } catch {
    return null;
  }
}
