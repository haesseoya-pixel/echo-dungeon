import type { Blip, BlipKind } from '@/entities/types';

const FOOTPRINT_MAX = 48;

/** Per-floor memory: revealed markers, transient blips, footprints. */
export class Memory {
  blips: Blip[] = [];
  private persistent = new Map<string, Blip>();
  footprints = new Float32Array(FOOTPRINT_MAX * 3); // x, y, t0
  private fpHead = 0;
  fpCount = 0;

  addBlip(kind: BlipKind, x: number, y: number, t0: number, life: number, ref: number, persistent = false, label?: string): void {
    if (persistent) {
      const key = `${kind}:${ref}`;
      const existing = this.persistent.get(key);
      if (existing) {
        existing.x = x;
        existing.y = y;
        existing.t0 = t0;
        return;
      }
      const b: Blip = { kind, x, y, t0, life: Infinity, persistent: true, ref, label };
      this.persistent.set(key, b);
      return;
    }
    this.blips.push({ kind, x, y, t0, life, persistent: false, ref, label });
  }

  removePersistent(kind: BlipKind, ref: number): void {
    this.persistent.delete(`${kind}:${ref}`);
  }

  hasPersistent(kind: BlipKind, ref: number): boolean {
    return this.persistent.has(`${kind}:${ref}`);
  }

  persistentBlips(): IterableIterator<Blip> {
    return this.persistent.values();
  }

  addFootprint(x: number, y: number, t0: number): void {
    const b = this.fpHead * 3;
    this.footprints[b] = x;
    this.footprints[b + 1] = y;
    this.footprints[b + 2] = t0;
    this.fpHead = (this.fpHead + 1) % FOOTPRINT_MAX;
    if (this.fpCount < FOOTPRINT_MAX) this.fpCount++;
  }

  update(t: number): void {
    if (this.blips.length && this.blips.some((b) => t - b.t0 > b.life)) this.blips = this.blips.filter((b) => t - b.t0 <= b.life);
  }
}
