import { TILE } from '@/config';
import type { Grid } from './grid';

/** Counts solid tiles crossed on the straight line between two world points, capped. */
export function wallsBetween(grid: Grid, ax: number, ay: number, bx: number, by: number, cap = 3, tile = TILE): number {
  let tx = Math.floor(ax / tile);
  let ty = Math.floor(ay / tile);
  const ex = Math.floor(bx / tile);
  const ey = Math.floor(by / tile);
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return grid.isSolid(tx, ty) ? 1 : 0;
  const ux = dx / len;
  const uy = dy / len;
  const stepX = ux > 0 ? 1 : ux < 0 ? -1 : 0;
  const stepY = uy > 0 ? 1 : uy < 0 ? -1 : 0;
  const tDeltaX = ux !== 0 ? Math.abs(tile / ux) : Infinity;
  const tDeltaY = uy !== 0 ? Math.abs(tile / uy) : Infinity;
  let tMaxX = ux !== 0 ? (stepX > 0 ? (tx + 1) * tile - ax : ax - tx * tile) / Math.abs(ux) : Infinity;
  let tMaxY = uy !== 0 ? (stepY > 0 ? (ty + 1) * tile - ay : ay - ty * tile) / Math.abs(uy) : Infinity;
  let walls = grid.isSolid(tx, ty) ? 1 : 0;
  let last = -1;
  for (let guard = 0; guard < 4096; guard++) {
    if (tx === ex && ty === ey) break;
    if (tMaxX < tMaxY) {
      tx += stepX;
      tMaxX += tDeltaX;
    } else {
      ty += stepY;
      tMaxY += tDeltaY;
    }
    if (tMaxX > len && tMaxY > len && (tx !== ex || ty !== ey)) break;
    const idx = ty * grid.w + tx;
    if (grid.isSolid(tx, ty) && idx !== last) {
      walls++;
      last = idx;
      if (walls >= cap) return cap;
    }
  }
  return walls;
}

export function hasLOS(grid: Grid, ax: number, ay: number, bx: number, by: number): boolean {
  return wallsBetween(grid, ax, ay, bx, by, 1) === 0;
}
