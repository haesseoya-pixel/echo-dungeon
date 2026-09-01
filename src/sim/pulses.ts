import { SONAR, TILE } from '@/config';
import type { Pulse, PulseOwner } from '@/entities/types';
import type { Grid } from '@/world/grid';
import { castFan, groupRuns } from '@/world/raycast';

export class PulseSystem {
  pulses: Pulse[] = [];
  private scratch = new Float32Array(SONAR.rays * 4);

  emit(grid: Grid, owner: PulseOwner, x: number, y: number, t0: number, n: number, range: number, fade: number, color: readonly [number, number, number]): Pulse {
    const hits = castFan(grid, x, y, n, range);
    const runs = groupRuns(hits, n, TILE, SONAR.runGap);
    const p: Pulse = { x, y, t0, speed: SONAR.speed, range, fade, n, hits, runs, color, owner, revealed: new Set(), expired: false };
    this.pulses.push(p);
    // caps per owner: drop oldest
    const cap = owner === 'player' ? SONAR.maxPlayerPulses : owner === 'bat' ? SONAR.maxBatPulses : owner === 'flare' ? 1 : 1;
    const same = this.pulses.filter((q) => q.owner === owner && !q.expired);
    if (same.length > cap) {
      const oldest = same[0]!;
      oldest.expired = true;
    }
    return p;
  }

  update(t: number): void {
    for (const p of this.pulses) {
      if (!p.expired && t - p.t0 > p.range / p.speed + 0.2 + p.fade) p.expired = true;
    }
    if (this.pulses.some((p) => p.expired)) this.pulses = this.pulses.filter((p) => !p.expired);
  }

  /** Returns true if the ring of pulse p has reached (ex, ey) this tick and the point is visible along the fan. */
  reaches(p: Pulse, t: number, ex: number, ey: number, er: number): boolean {
    const dx = ex - p.x;
    const dy = ey - p.y;
    const de = Math.hypot(dx, dy);
    const r = p.speed * (t - p.t0);
    if (de > r || de > p.range) return false;
    let ang = Math.atan2(dy, dx);
    if (ang < 0) ang += Math.PI * 2;
    const idx = Math.round((ang / (Math.PI * 2)) * p.n) % p.n;
    for (let k = -1; k <= 1; k++) {
      const i = (idx + k + p.n) % p.n;
      const side = p.hits[i * 4 + 3]!;
      const d = p.hits[i * 4 + 2]!;
      if (side === -1 || d >= de - er) return true;
    }
    return false;
  }

  clear(): void {
    this.pulses = [];
  }

  get scratchBuffer(): Float32Array {
    return this.scratch;
  }
}
