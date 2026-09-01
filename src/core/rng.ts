export type Seed4 = [number, number, number, number];
export type Rng = () => number;

/** cyrb128: hashes a string into four 32-bit seeds. */
export function cyrb128(str: string): Seed4 {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32: small fast counter PRNG, 128-bit state. */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function rngFromSeed(seed: Seed4, salt = 0, discard = 16): Rng {
  const r = sfc32(seed[0], seed[1], seed[2], (seed[3] ^ salt) >>> 0);
  for (let i = 0; i < discard; i++) r();
  return r;
}

export function floorRng(seed: Seed4, floorIndex: number): Rng {
  return rngFromSeed(seed, Math.imul(floorIndex, 0x9e3779b1) >>> 0);
}

export function simRng(seed: Seed4, floorIndex: number): Rng {
  return rngFromSeed(seed, (Math.imul(floorIndex, 0x9e3779b1) ^ 0xa5a5a5a5) >>> 0);
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dailySeedString(date = new Date()): string {
  return `echo-daily-${localDateString(date)}`;
}

export function randomSeedString(): string {
  return `echo-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export const rngInt = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
export const rngRange = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);
export function rngPick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))] as T;
}
export function rngShuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}
