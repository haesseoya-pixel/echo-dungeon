export const WALL = 0;
export const FLOOR = 1;
export const DOOR = 2;

export class Grid {
  readonly w: number;
  readonly h: number;
  readonly t: Uint8Array;

  constructor(w: number, h: number, fill = WALL) {
    this.w = w;
    this.h = h;
    this.t = new Uint8Array(w * h);
    if (fill !== 0) this.t.fill(fill);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return WALL;
    return this.t[y * this.w + x]!;
  }

  set(x: number, y: number, v: number): void {
    if (this.inBounds(x, y)) this.t[y * this.w + x] = v;
  }

  /** Out of bounds counts as solid. */
  isSolid(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return true;
    return this.t[y * this.w + x] === WALL;
  }

  isWalkable(x: number, y: number): boolean {
    return !this.isSolid(x, y);
  }

  /** Solid test in world pixels. */
  solidAtPx(px: number, py: number, tile: number): boolean {
    return this.isSolid(Math.floor(px / tile), Math.floor(py / tile));
  }

  countFloor(): number {
    let n = 0;
    for (let i = 0; i < this.t.length; i++) if (this.t[i] !== WALL) n++;
    return n;
  }

  clone(): Grid {
    const g = new Grid(this.w, this.h);
    g.t.set(this.t);
    return g;
  }
}
