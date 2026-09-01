export const TILE = 32;
export const STEP = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;

export type ItemKind = 'stone' | 'flare' | 'silencer' | 'bandage';
export const ITEM_KINDS: readonly ItemKind[] = ['stone', 'flare', 'silencer', 'bandage'];
export const ITEM_CAP: Record<ItemKind, number> = { stone: 5, flare: 2, silencer: 2, bandage: 3 };

export const PLAYER = {
  r: 10,
  walk: 120,
  sneak: 60,
  accel: 20,
  pulseCooldown: 0.6,
  hp: 3,
  hpUnlocked: 4,
  iframes: 1.2,
  knockback: 260,
  stepIntervalWalk: 0.28,
  stepIntervalSneak: 0.45,
  webbedSlow: 0.5,
  webbedTime: 1.5,
  exitHold: 0.4,
  pickupR: 12,
} as const;

export const SONAR = {
  speed: 480,
  range: 448,
  rays: 720,
  raysMobile: 540,
  batRays: 180,
  batRange: 192,
  flareRange: 384,
  flareFade: 6,
  flareRays: 720,
  maxPlayerPulses: 6,
  maxBatPulses: 4,
  arrivalRange: 160,
  touchRays: 64,
  touchRange: 40,
  runGap: 48,
} as const;

/** Noise radii in tiles and loudness 0..1. */
export const NOISE = {
  pulse: { radius: 9, loudness: 0.8 },
  walk: { radius: 2.5, loudness: 0.4 },
  sneak: { radius: 0.5, loudness: 0.15 },
  stone: { radius: 7, loudness: 1.0 },
  flare: { radius: 16, loudness: 1.0 },
  trap: { radius: 12, loudness: 1.0 },
  batSonar: { radius: 6, loudness: 0.5 },
  screech: { radius: 5, loudness: 0.7 },
  bandage: { radius: 1.5, loudness: 0.3 },
  roar: { radius: 8, loudness: 0.9 },
  wallAttenuation: 0.35,
  maxWalls: 2,
} as const;

export const ENEMY = {
  hunter: { r: 11, wander: 55, investigate: 70, investigateBoost: 50, chase: 135, chaseMax: 150, hearing: 1.0, damage: 1, senseR: 2.5, investigateI: 0.25, chaseI: 0.7, chaseD: 3, lose: 2.5, loseD: 4, hardCap: 8, search: 3, stun: 0.8, stepInterval: 0.5 },
  bat: { r: 8, wander: 80, attracted: 95, sonarInterval: 3.5, sonarJitter: 0.5, attractTime: 4, fleeTime: 2, flapInterval: 0.4, redirect: 0.6 },
  spider: { r: 12, damage: 1 },
  predator: { r: 14, wander: 45, investigate: 80, chase: 150, hearing: 1.6, damage: 2, wakeI: 0.6, wakeR: 10, roarInterval: 6, roarSenseR: 8, roarTrack: 3, lose: 4, stepInterval: 0.8, snoreInterval: 2 },
} as const;

export const ITEMS = {
  stone: { speed: 400, maxTiles: 8 },
  silencer: { duration: 12, stepMult: 0.2, pulseMult: 0.5 },
} as const;

export const COLORS = {
  pulse: [80, 230, 255] as const,
  flare: [255, 220, 160] as const,
  bat: [190, 120, 255] as const,
  hunter: [255, 80, 80] as const,
  predator: [255, 40, 60] as const,
  spider: [200, 255, 80] as const,
  key: [255, 210, 80] as const,
  exit: [100, 255, 140] as const,
  item: [200, 220, 255] as const,
  player: [240, 250, 255] as const,
  stone: [200, 200, 210] as const,
  footprint: [120, 160, 200] as const,
} as const;

export const ALT_COLORS = {
  pulse: [255, 170, 60] as const,
  flare: [255, 240, 200] as const,
  player: [255, 245, 220] as const,
} as const;

export interface Difficulty {
  floor: number;
  w: number;
  h: number;
  hunters: number;
  bats: number;
  spiders: number;
  predators: number;
  fade: number;
  hearing: number;
  locked: boolean;
  items: number;
  chaseSpeed: number;
  caveRooms: boolean;
  wideCorridors: boolean;
}

const TABLE: Omit<Difficulty, 'floor' | 'chaseSpeed' | 'caveRooms' | 'wideCorridors'>[] = [
  { w: 40, h: 30, hunters: 2, bats: 0, spiders: 2, predators: 0, fade: 5.0, hearing: 0.8, locked: false, items: 4 },
  { w: 44, h: 34, hunters: 3, bats: 1, spiders: 3, predators: 0, fade: 4.5, hearing: 0.9, locked: false, items: 4 },
  { w: 48, h: 36, hunters: 4, bats: 1, spiders: 4, predators: 0, fade: 4.0, hearing: 1.0, locked: true, items: 4 },
  { w: 52, h: 40, hunters: 5, bats: 2, spiders: 5, predators: 0, fade: 3.6, hearing: 1.0, locked: true, items: 4 },
  { w: 56, h: 42, hunters: 5, bats: 2, spiders: 6, predators: 1, fade: 3.3, hearing: 1.1, locked: true, items: 4 },
  { w: 60, h: 45, hunters: 6, bats: 2, spiders: 7, predators: 1, fade: 3.0, hearing: 1.15, locked: true, items: 5 },
  { w: 64, h: 48, hunters: 7, bats: 3, spiders: 8, predators: 1, fade: 2.8, hearing: 1.2, locked: true, items: 5 },
  { w: 70, h: 52, hunters: 8, bats: 3, spiders: 9, predators: 1, fade: 2.6, hearing: 1.25, locked: true, items: 5 },
  { w: 76, h: 56, hunters: 9, bats: 3, spiders: 10, predators: 2, fade: 2.4, hearing: 1.3, locked: true, items: 6 },
  { w: 80, h: 60, hunters: 10, bats: 4, spiders: 12, predators: 2, fade: 2.2, hearing: 1.35, locked: true, items: 6 },
];

export const WIN_FLOOR = 10;

export function difficultyFor(floor: number): Difficulty {
  const f = Math.max(1, Math.floor(floor));
  const base = TABLE[Math.min(f, TABLE.length) - 1]!;
  const extra = Math.max(0, f - TABLE.length);
  return {
    floor: f,
    w: base.w,
    h: base.h,
    hunters: Math.min(14, base.hunters + extra),
    bats: base.bats,
    spiders: Math.min(16, base.spiders + extra),
    predators: base.predators,
    fade: Math.max(1.8, base.fade - 0.1 * extra),
    hearing: Math.min(1.6, base.hearing + 0.05 * extra),
    locked: base.locked,
    items: base.items,
    chaseSpeed: Math.min(ENEMY.hunter.chaseMax, ENEMY.hunter.chase + 2 * (f - 1)),
    caveRooms: f >= 3,
    wideCorridors: f >= 5,
  };
}
