import { TILE } from '@/config';
import type { Grid } from './grid';

export interface RayHit {
  x: number;
  y: number;
  d: number;
  /** 0 = hit an x-facing wall face, 1 = y-facing, -1 = miss */
  side: number;
}

const angleTables = new Map<number, { cos: Float32Array; sin: Float32Array }>();

export function angleTable(n: number): { cos: Float32Array; sin: Float32Array } {
  let t = angleTables.get(n);
  if (!t) {
    const cos = new Float32Array(n);
    const sin = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      cos[i] = Math.cos(a);
      sin[i] = Math.sin(a);
    }
    t = { cos, sin };
    angleTables.set(n, t);
  }
  return t;
}

/** DDA ray march on the tile grid. Origin and result in world pixels. */
export function castRay(grid: Grid, ox: number, oy: number, dx: number, dy: number, maxDist: number, tile = TILE): RayHit {
  let tx = Math.floor(ox / tile);
  let ty = Math.floor(oy / tile);
  if (grid.isSolid(tx, ty)) return { x: ox, y: oy, d: 0, side: 0 };
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = dx !== 0 ? Math.abs(tile / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(tile / dy) : Infinity;
  let tMaxX = dx !== 0 ? (stepX > 0 ? (tx + 1) * tile - ox : ox - tx * tile) / Math.abs(dx) : Infinity;
  let tMaxY = dy !== 0 ? (stepY > 0 ? (ty + 1) * tile - oy : oy - ty * tile) / Math.abs(dy) : Infinity;
  for (let guard = 0; guard < 4096; guard++) {
    let d: number;
    let side: number;
    if (tMaxX < tMaxY) {
      d = tMaxX;
      tx += stepX;
      tMaxX += tDeltaX;
      side = 0;
    } else {
      d = tMaxY;
      ty += stepY;
      tMaxY += tDeltaY;
      side = 1;
    }
    if (d > maxDist) return { x: ox + dx * maxDist, y: oy + dy * maxDist, d: maxDist, side: -1 };
    if (grid.isSolid(tx, ty)) return { x: ox + dx * d, y: oy + dy * d, d, side };
  }
  return { x: ox + dx * maxDist, y: oy + dy * maxDist, d: maxDist, side: -1 };
}

/** Casts n evenly spaced rays. Output stride 4: hx, hy, dist, side. */
export function castFan(grid: Grid, ox: number, oy: number, n: number, range: number, out?: Float32Array): Float32Array {
  const hits = out && out.length >= n * 4 ? out : new Float32Array(n * 4);
  const { cos, sin } = angleTable(n);
  for (let i = 0; i < n; i++) {
    const h = castRay(grid, ox, oy, cos[i]!, sin[i]!, range);
    const b = i * 4;
    hits[b] = h.x;
    hits[b + 1] = h.y;
    hits[b + 2] = h.d;
    hits[b + 3] = h.side;
  }
  return hits;
}

/**
 * Groups consecutive rays into polyline runs along wall faces.
 * Returns run start indices followed by a terminating n. Runs never wrap around index 0.
 */
export function groupRuns(hits: Float32Array, n: number, tile = TILE, runGap = 48): Uint16Array {
  const starts: number[] = [];
  let i = 0;
  while (i < n) {
    if (hits[i * 4 + 3] === -1) {
      i++;
      continue;
    }
    starts.push(i);
    let j = i;
    while (j + 1 < n) {
      const a = j * 4;
      const b = (j + 1) * 4;
      if (hits[b + 3] === -1) break;
      if (hits[a + 3] !== hits[b + 3]) break;
      if (Math.abs(hits[a + 2]! - hits[b + 2]!) >= 0.75 * tile) break;
      const ddx = hits[a]! - hits[b]!;
      const ddy = hits[a + 1]! - hits[b + 1]!;
      if (ddx * ddx + ddy * ddy >= 1.44 * tile * tile) break;
      if (Math.floor(hits[a + 2]! / runGap) !== Math.floor(hits[b + 2]! / runGap)) break;
      j++;
    }
    i = j + 1;
  }
  const out = new Uint16Array(starts.length + 1);
  for (let k = 0; k < starts.length; k++) out[k] = starts[k]!;
  out[starts.length] = n;
  return out;
}

/** For a run starting at `start`, returns its exclusive end index. */
export function runEnd(hits: Float32Array, start: number, n: number, tile = TILE, runGap = 48): number {
  let j = start;
  while (j + 1 < n) {
    const a = j * 4;
    const b = (j + 1) * 4;
    if (hits[b + 3] === -1) break;
    if (hits[a + 3] !== hits[b + 3]) break;
    if (Math.abs(hits[a + 2]! - hits[b + 2]!) >= 0.75 * tile) break;
    const ddx = hits[a]! - hits[b]!;
    const ddy = hits[a + 1]! - hits[b + 1]!;
    if (ddx * ddx + ddy * ddy >= 1.44 * tile * tile) break;
    if (Math.floor(hits[a + 2]! / runGap) !== Math.floor(hits[b + 2]! / runGap)) break;
    j++;
  }
  return j + 1;
}
