import type { Grid } from './grid';

/** 4-neighbour BFS distance field in tiles; -1 = unreachable. */
export function distanceField(grid: Grid, sx: number, sy: number): Int32Array {
  const { w, h } = grid;
  const dist = new Int32Array(w * h).fill(-1);
  if (grid.isSolid(sx, sy)) return dist;
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const start = sy * w + sx;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++]!;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const d = dist[cur]! + 1;
    // right, left, down, up
    if (cx + 1 < w && !grid.isSolid(cx + 1, cy) && dist[cur + 1] === -1) {
      dist[cur + 1] = d;
      queue[tail++] = cur + 1;
    }
    if (cx - 1 >= 0 && !grid.isSolid(cx - 1, cy) && dist[cur - 1] === -1) {
      dist[cur - 1] = d;
      queue[tail++] = cur - 1;
    }
    if (cy + 1 < h && !grid.isSolid(cx, cy + 1) && dist[cur + w] === -1) {
      dist[cur + w] = d;
      queue[tail++] = cur + w;
    }
    if (cy - 1 >= 0 && !grid.isSolid(cx, cy - 1) && dist[cur - w] === -1) {
      dist[cur - w] = d;
      queue[tail++] = cur - w;
    }
  }
  return dist;
}

export function fieldAt(field: Int32Array, w: number, x: number, y: number): number {
  return field[y * w + x] ?? -1;
}
