import { TILE } from '@/config';
import type { Grid } from '@/world/grid';

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

function pushOutAxis(grid: Grid, x: number, y: number, r: number, axis: 'x' | 'y'): { v: number; hit: boolean } {
  let hit = false;
  let val = axis === 'x' ? x : y;
  const minTx = Math.floor((x - r) / TILE);
  const maxTx = Math.floor((x + r) / TILE);
  const minTy = Math.floor((y - r) / TILE);
  const maxTy = Math.floor((y + r) / TILE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!grid.isSolid(tx, ty)) continue;
      const left = tx * TILE;
      const top = ty * TILE;
      const cx = axis === 'x' ? val : x;
      const cy = axis === 'y' ? val : y;
      const nx = Math.max(left, Math.min(cx, left + TILE));
      const ny = Math.max(top, Math.min(cy, top + TILE));
      const dx = cx - nx;
      const dy = cy - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2);
      hit = true;
      if (axis === 'x') {
        if (d > 1e-6) val += (dx / d) * (r - d) * (Math.abs(dx) > 1e-6 ? 1 : 0) + (Math.abs(dx) <= 1e-6 ? 0 : 0);
        if (Math.abs(dx) <= 1e-6) {
          // centre is inside the tile's x-span: push toward the nearer x edge
          const toLeft = cx - left;
          const toRight = left + TILE - cx;
          val += toLeft < toRight ? -(toLeft + r) : toRight + r;
        } else if (d <= 1e-6) {
          val += cx < left + TILE / 2 ? -r : r;
        }
      } else {
        if (d > 1e-6 && Math.abs(dy) > 1e-6) val += (dy / d) * (r - d);
        else if (Math.abs(dy) <= 1e-6) {
          const toTop = cy - top;
          const toBottom = top + TILE - cy;
          val += toTop < toBottom ? -(toTop + r) : toBottom + r;
        } else {
          val += cy < top + TILE / 2 ? -r : r;
        }
      }
    }
  }
  return { v: val, hit };
}

/** Moves a circle by (dx, dy) with axis-separated wall sliding. */
export function resolveCircle(grid: Grid, x: number, y: number, r: number, dx: number, dy: number): MoveResult {
  let nx = x + dx;
  let ny = y;
  const rx = pushOutAxis(grid, nx, ny, r, 'x');
  nx = rx.v;
  ny = y + dy;
  const ry = pushOutAxis(grid, nx, ny, r, 'y');
  ny = ry.v;
  return { x: nx, y: ny, hitX: rx.hit, hitY: ry.hit };
}

export function circleOverlapsSolid(grid: Grid, x: number, y: number, r: number): boolean {
  const minTx = Math.floor((x - r) / TILE);
  const maxTx = Math.floor((x + r) / TILE);
  const minTy = Math.floor((y - r) / TILE);
  const maxTy = Math.floor((y + r) / TILE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!grid.isSolid(tx, ty)) continue;
      const nx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
      const ny = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
      if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r) return true;
    }
  }
  return false;
}
