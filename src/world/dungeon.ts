import { difficultyFor, type Difficulty, type ItemKind } from '@/config';
import { floorRng, rngInt, rngPick, rngShuffle, type Rng, type Seed4 } from '@/core/rng';
import { distanceField } from './bfs';
import { DOOR, FLOOR, Grid, WALL } from './grid';

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  cave: boolean;
  index: number;
}

export type EnemyKind = 'hunter' | 'bat' | 'spider' | 'predator';

export interface EnemySpawn {
  kind: EnemyKind;
  x: number;
  y: number;
  room: number;
}

export interface ItemSpawn {
  kind: ItemKind;
  x: number;
  y: number;
}

export interface FloorLayout {
  seed: Seed4;
  floorIndex: number;
  w: number;
  h: number;
  grid: Grid;
  rooms: Room[];
  start: { x: number; y: number };
  exit: { x: number; y: number };
  key: { x: number; y: number } | null;
  locked: boolean;
  enemies: EnemySpawn[];
  items: ItemSpawn[];
  dStart: Int32Array;
  dExit: Int32Array;
  attempts: number;
}

function carveRoom(grid: Grid, x: number, y: number, w: number, h: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid.set(xx, yy, FLOOR);
}

function overlaps(a: { x: number; y: number; w: number; h: number }, rooms: Room[], margin: number): boolean {
  for (const r of rooms) {
    if (a.x - margin < r.x + r.w && a.x + a.w + margin > r.x && a.y - margin < r.y + r.h && a.y + a.h + margin > r.y) return true;
  }
  return false;
}

/** Cellular-automata cave inside a bbox; guarantees a 3x3 floor at the centre. Returns floor tile count. */
function carveCave(grid: Grid, rng: Rng, x: number, y: number, w: number, h: number): void {
  let cells = new Uint8Array(w * h);
  for (let i = 0; i < cells.length; i++) cells[i] = rng() < 0.45 ? 1 : 0; // 1 = wall
  const idx = (xx: number, yy: number) => yy * w + xx;
  for (let iter = 0; iter < 4; iter++) {
    const next = new Uint8Array(w * h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        let walls = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = xx + ox;
            const ny = yy + oy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) walls++;
            else walls += cells[idx(nx, ny)]!;
          }
        }
        next[idx(xx, yy)] = walls >= 5 ? 1 : walls <= 3 ? 0 : cells[idx(xx, yy)]!;
      }
    }
    cells = next;
  }
  // keep largest floor component
  const comp = new Int32Array(w * h).fill(-1);
  let best = -1;
  let bestSize = 0;
  let compId = 0;
  const stack: number[] = [];
  for (let s = 0; s < cells.length; s++) {
    if (cells[s] === 1 || comp[s] !== -1) continue;
    let size = 0;
    stack.push(s);
    comp[s] = compId;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const cx = c % w;
      const cy = (c - cx) / w;
      const nb = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ] as const;
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = idx(nx, ny);
        if (cells[ni] === 0 && comp[ni] === -1) {
          comp[ni] = compId;
          stack.push(ni);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = compId;
    }
    compId++;
  }
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      if (cells[idx(xx, yy)] === 0 && comp[idx(xx, yy)] === best) grid.set(x + xx, y + yy, FLOOR);
    }
  }
  const mx = x + Math.floor(w / 2);
  const my = y + Math.floor(h / 2);
  carveRoom(grid, mx - 1, my - 1, 3, 3);
}

function carveCorridor(grid: Grid, rng: Rng, ax: number, ay: number, bx: number, by: number, wide: boolean): void {
  const horizontalFirst = rng() < 0.5;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    for (;;) {
      grid.set(x, y, grid.get(x, y) === WALL ? FLOOR : grid.get(x, y));
      if (wide) {
        if (dx !== 0) grid.set(x, y + 1, grid.get(x, y + 1) === WALL ? FLOOR : grid.get(x, y + 1));
        else grid.set(x + 1, y, grid.get(x + 1, y) === WALL ? FLOOR : grid.get(x + 1, y));
      }
      if (x === x1 && y === y1) break;
      if (x !== x1) x += dx;
      else y += dy;
    }
  };
  if (horizontalFirst) {
    line(ax, ay, bx, ay);
    line(bx, ay, bx, by);
  } else {
    line(ax, ay, ax, by);
    line(ax, by, bx, by);
  }
}

function markDoors(grid: Grid, rooms: Room[]): void {
  for (const r of rooms) {
    if (r.cave) continue;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (grid.get(x, r.y - 1) === FLOOR) grid.set(x, r.y - 1, DOOR);
      if (grid.get(x, r.y + r.h) === FLOOR) grid.set(x, r.y + r.h, DOOR);
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      if (grid.get(r.x - 1, y) === FLOOR) grid.set(r.x - 1, y, DOOR);
      if (grid.get(r.x + r.w, y) === FLOOR) grid.set(r.x + r.w, y, DOOR);
    }
  }
}

function roomTiles(grid: Grid, r: Room): [number, number][] {
  const out: [number, number][] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (grid.get(x, y) === FLOOR) out.push([x, y]);
  return out;
}

function openTile(grid: Grid, x: number, y: number): boolean {
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (grid.get(x + ox, y + oy) !== FLOOR) return false;
  return true;
}

function attempt(seed: Seed4, floorIndex: number, diff: Difficulty, attemptNo: number): FloorLayout | null {
  const rng = floorRng(seed, floorIndex + attemptNo * 7919);
  const { w, h } = diff;
  const grid = new Grid(w, h, WALL);
  const rooms: Room[] = [];
  const target = Math.max(6, Math.min(14, Math.floor((w * h) / 220)));
  for (let tries = 0; tries < 200 && rooms.length < target; tries++) {
    const cave = diff.caveRooms && rng() < 0.25;
    const rw = cave ? rngInt(rng, 8, 14) : rngInt(rng, 4, 10);
    const rh = cave ? rngInt(rng, 6, 10) : rngInt(rng, 4, 8);
    const x = rngInt(rng, 2, w - rw - 3);
    const y = rngInt(rng, 2, h - rh - 3);
    if (overlaps({ x, y, w: rw, h: rh }, rooms, 2)) continue;
    const room: Room = { x, y, w: rw, h: rh, cx: x + Math.floor(rw / 2), cy: y + Math.floor(rh / 2), cave, index: rooms.length };
    if (cave) carveCave(grid, rng, x, y, rw, rh);
    else carveRoom(grid, x, y, rw, rh);
    rooms.push(room);
  }
  if (rooms.length < 4) return null;

  // Prim MST over room centres
  const inTree = new Uint8Array(rooms.length);
  inTree[0] = 1;
  const edges: [number, number][] = [];
  for (let k = 1; k < rooms.length; k++) {
    let bestD = Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < rooms.length; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < rooms.length; j++) {
        if (inTree[j]) continue;
        const d = Math.hypot(rooms[i]!.cx - rooms[j]!.cx, rooms[i]!.cy - rooms[j]!.cy);
        if (d < bestD) {
          bestD = d;
          bi = i;
          bj = j;
        }
      }
    }
    inTree[bj] = 1;
    edges.push([bi, bj]);
  }
  // extra loops
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
      const d = Math.hypot(rooms[i]!.cx - rooms[j]!.cx, rooms[i]!.cy - rooms[j]!.cy);
      if (d < 25 && rng() < 0.15) edges.push([i, j]);
    }
  }
  for (const [a, b] of edges) {
    const ra = rooms[a]!;
    const rb = rooms[b]!;
    carveCorridor(grid, rng, ra.cx, ra.cy, rb.cx, rb.cy, diff.wideCorridors && rng() < 0.3);
  }
  // border always wall
  for (let x = 0; x < w; x++) {
    grid.set(x, 0, WALL);
    grid.set(x, h - 1, WALL);
  }
  for (let y = 0; y < h; y++) {
    grid.set(0, y, WALL);
    grid.set(w - 1, y, WALL);
  }
  markDoors(grid, rooms);

  const startRoom = rooms[0]!;
  const start = { x: startRoom.cx, y: startRoom.cy };
  if (grid.isSolid(start.x, start.y)) return null;
  // connectivity: unreachable floor becomes wall
  let dStart = distanceField(grid, start.x, start.y);
  let reachableRooms = 0;
  for (const r of rooms) if (dStart[r.cy * w + r.cx]! >= 0) reachableRooms++;
  if (reachableRooms < Math.ceil(rooms.length * 0.8)) return null;
  for (let i = 0; i < grid.t.length; i++) if (grid.t[i] !== WALL && dStart[i]! < 0) grid.t[i] = WALL;
  dStart = distanceField(grid, start.x, start.y);
  const reachable = rooms.filter((r) => dStart[r.cy * w + r.cx]! >= 0);
  if (reachable.length < 4) return null;

  // exit: farthest room centre
  let maxD = 0;
  let exitRoom = reachable[reachable.length - 1]!;
  for (const r of reachable) {
    const d = dStart[r.cy * w + r.cx]!;
    if (d > maxD) {
      maxD = d;
      exitRoom = r;
    }
  }
  const exit = { x: exitRoom.cx, y: exitRoom.cy };
  const dExit = distanceField(grid, exit.x, exit.y);
  const used = new Set<number>([start.y * w + start.x, exit.y * w + exit.x]);
  const isUsed = (x: number, y: number) => used.has(y * w + x);
  const use = (x: number, y: number) => used.add(y * w + x);

  // key
  let key: { x: number; y: number } | null = null;
  if (diff.locked) {
    let bestScore = -1;
    for (const r of reachable) {
      if (r === startRoom || r === exitRoom) continue;
      for (const [x, y] of roomTiles(grid, r)) {
        const ds = dStart[y * w + x]!;
        const de = dExit[y * w + x]!;
        if (ds < 0.4 * maxD || de < 12) continue;
        const sc = Math.min(ds, de) + rng() * 0.5;
        if (sc > bestScore) {
          bestScore = sc;
          key = { x, y };
        }
      }
    }
    if (!key) {
      // fallback: any tile far enough
      for (const r of reachable) {
        if (r === startRoom) continue;
        for (const [x, y] of roomTiles(grid, r)) {
          const ds = dStart[y * w + x]!;
          const de = dExit[y * w + x]!;
          if (ds >= 8 && de >= 6) {
            key = { x, y };
            break;
          }
        }
        if (key) break;
      }
    }
    if (!key) return null;
    use(key.x, key.y);
  }

  // enemies
  const enemies: EnemySpawn[] = [];
  const perRoom = new Map<number, number>();
  const candidateRooms = reachable.filter((r) => r !== startRoom);
  const placeEnemy = (kind: EnemyKind, minD: number, roomFilter: (r: Room) => boolean, maxPerRoom: number): boolean => {
    const rooms2 = rngShuffle(rng, candidateRooms.filter(roomFilter));
    for (const r of rooms2) {
      if ((perRoom.get(r.index) ?? 0) >= maxPerRoom) continue;
      const tiles = rngShuffle(rng, roomTiles(grid, r));
      for (const [x, y] of tiles) {
        if (dStart[y * w + x]! < minD || isUsed(x, y)) continue;
        enemies.push({ kind, x, y, room: r.index });
        use(x, y);
        perRoom.set(r.index, (perRoom.get(r.index) ?? 0) + 1);
        return true;
      }
    }
    return false;
  };
  if (diff.predators > 0) {
    const big = [...candidateRooms].filter((r) => r !== exitRoom && !(key && key.x >= r.x && key.x < r.x + r.w && key.y >= r.y && key.y < r.y + r.h)).sort((a, b) => b.w * b.h - a.w * a.h);
    for (let i = 0; i < diff.predators; i++) {
      const r = big[i % Math.max(1, big.length)];
      if (!r) break;
      placeEnemy('predator', 12, (x) => x === r, 3);
    }
  }
  for (let i = 0; i < diff.hunters; i++) placeEnemy('hunter', 12, () => true, 2);
  for (let i = 0; i < diff.bats; i++) placeEnemy('bat', 10, () => true, 4);
  // spiders: open tiles only, away from key/exit/items/other spiders
  const spiders: [number, number][] = [];
  for (let i = 0; i < diff.spiders; i++) {
    const rooms2 = rngShuffle(rng, [...candidateRooms]);
    let placed = false;
    for (const r of rooms2) {
      const tiles = rngShuffle(rng, roomTiles(grid, r));
      for (const [x, y] of tiles) {
        if (dStart[y * w + x]! < 8 || isUsed(x, y) || !openTile(grid, x, y)) continue;
        if (key && Math.hypot(key.x - x, key.y - y) < 2) continue;
        if (Math.hypot(exit.x - x, exit.y - y) < 2) continue;
        if (spiders.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 3)) continue;
        spiders.push([x, y]);
        enemies.push({ kind: 'spider', x, y, room: r.index });
        use(x, y);
        placed = true;
        break;
      }
      if (placed) break;
    }
  }

  // items
  const items: ItemSpawn[] = [];
  const guaranteed: ItemKind[] = floorIndex === 1 ? ['stone', 'stone', 'bandage'] : [];
  const weights: [ItemKind, number][] = [
    ['stone', 45],
    ['bandage', 25],
    ['flare', floorIndex >= 2 ? 15 : 0],
    ['silencer', floorIndex >= 3 ? 15 : 0],
  ];
  const pickKind = (): ItemKind => {
    const total = weights.reduce((a, [, wgt]) => a + wgt, 0);
    let r = rng() * total;
    for (const [k, wgt] of weights) {
      r -= wgt;
      if (r <= 0) return k;
    }
    return 'stone';
  };
  const itemRooms = new Set<number>();
  const count = Math.min(6, diff.items);
  for (let i = 0; i < count; i++) {
    const kind = guaranteed[i] ?? pickKind();
    const rooms2 = rngShuffle(rng, reachable.filter((r) => !itemRooms.has(r.index) && r !== exitRoom));
    for (const r of rooms2) {
      const tiles = rngShuffle(rng, roomTiles(grid, r));
      let placed = false;
      for (const [x, y] of tiles) {
        if (dStart[y * w + x]! < 4 || isUsed(x, y)) continue;
        if (spiders.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 2)) continue;
        items.push({ kind, x, y });
        use(x, y);
        itemRooms.add(r.index);
        placed = true;
        break;
      }
      if (placed) break;
    }
  }

  return { seed, floorIndex, w, h, grid, rooms: reachable, start, exit, key, locked: diff.locked, enemies, items, dStart, dExit, attempts: attemptNo + 1 };
}

export function generateFloor(seed: Seed4, floorIndex: number, diff: Difficulty = difficultyFor(floorIndex)): FloorLayout {
  for (let a = 0; a < 40; a++) {
    const layout = attempt(seed, floorIndex, diff, a);
    if (layout) return layout;
  }
  // last resort: shrink the room target by using a tiny fixed layout
  const fallback = attempt(seed, floorIndex, { ...diff, w: Math.max(diff.w, 40), h: Math.max(diff.h, 30), caveRooms: false }, 99);
  if (fallback) return fallback;
  throw new Error('dungeon generation failed');
}

export const pickAny = rngPick;
