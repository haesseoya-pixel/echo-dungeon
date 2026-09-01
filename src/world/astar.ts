import type { Grid } from './grid';

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= k[i]!) break;
      [k[p], k[i]] = [k[i]!, k[p]!];
      [v[p], v[i]] = [v[i]!, v[p]!];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0]!;
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length > 0) {
      k[0] = lastK;
      v[0] = lastV;
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && k[l]! < k[m]!) m = l;
        if (r < n && k[r]! < k[m]!) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [v[m], v[i]] = [v[i]!, v[m]!];
        i = m;
      }
    }
    return top;
  }
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * 8-directional A* without corner cutting. Returns tile path from start (exclusive) to goal (inclusive), or null.
 * Scratch buffers are reused between calls for the same grid size.
 */
let gScore = new Float32Array(0);
let cameFrom = new Int32Array(0);
let closed = new Uint8Array(0);
let stamp = 0;
let stampArr = new Uint32Array(0);

export function findPath(grid: Grid, sx: number, sy: number, tx: number, ty: number, maxNodes = 6000): [number, number][] | null {
  const { w, h } = grid;
  const n = w * h;
  if (grid.isSolid(tx, ty) || grid.isSolid(sx, sy)) return null;
  if (gScore.length !== n) {
    gScore = new Float32Array(n);
    cameFrom = new Int32Array(n);
    closed = new Uint8Array(n);
    stampArr = new Uint32Array(n);
    stamp = 0;
  }
  stamp++;
  if (stamp === 0xffffffff) {
    stampArr.fill(0);
    stamp = 1;
  }
  const start = sy * w + sx;
  const goal = ty * w + tx;
  const heap = new MinHeap();
  gScore[start] = 0;
  cameFrom[start] = -1;
  stampArr[start] = stamp;
  closed[start] = 0;
  const hFn = (x: number, y: number) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  heap.push(hFn(sx, sy), start);
  let expanded = 0;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goal) {
      const path: [number, number][] = [];
      let c = cur;
      while (c !== start && c !== -1) {
        const cx = c % w;
        path.push([cx, (c - cx) / w]);
        c = cameFrom[c]!;
      }
      path.reverse();
      return path;
    }
    if (closed[cur] === 1 && stampArr[cur] === stamp) continue;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const g = gScore[cur]!;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (grid.isSolid(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (grid.isSolid(cx + dx, cy) || grid.isSolid(cx, cy + dy))) continue; // no corner cutting
      const ni = ny * w + nx;
      const ng = g + cost;
      if (stampArr[ni] === stamp) {
        if (closed[ni] === 1 || ng >= gScore[ni]!) continue;
      } else {
        stampArr[ni] = stamp;
        closed[ni] = 0;
      }
      gScore[ni] = ng;
      cameFrom[ni] = cur;
      heap.push(ng + hFn(nx, ny), ni);
    }
  }
  return null;
}
