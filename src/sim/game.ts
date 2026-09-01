import { ALT_COLORS, COLORS, ITEM_KINDS, PLAYER, WIN_FLOOR, difficultyFor, type ItemKind } from '@/config';
import type { InputState } from '@/core/input';
import { cyrb128, dailySeedString, localDateString, randomSeedString, type Seed4 } from '@/core/rng';
import type { FloorEvent } from '@/entities/types';
import { Floor } from './floor';

export type Phase = 'TITLE' | 'RUN' | 'PAUSE' | 'DEAD' | 'SUMMARY' | 'TRANSITION' | 'WIN';
export type Mode = 'normal' | 'daily';

export interface RunStats {
  mode: Mode;
  seedStr: string;
  dateKey: string;
  floor: number;
  deepest: number;
  timeMs: number;
  clearTimeMs: number | null;
  pulses: number;
  stones: number;
  damage: number;
  seen: number;
  cleared: boolean;
  died: boolean;
}

export type SimEvent =
  | { type: 'floor'; event: FloorEvent }
  | { type: 'floorStart'; floor: number }
  | { type: 'dead' }
  | { type: 'summary' }
  | { type: 'win' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'transition' };

export interface SimOptions {
  mobile: boolean;
  unlocks: Set<string>;
  palette: 'default' | 'alt';
}

export class GameSim {
  phase: Phase = 'TITLE';
  mode: Mode = 'normal';
  seedStr = '';
  seed: Seed4 = [0, 0, 0, 0];
  floorIndex = 0;
  floor: Floor | null = null;
  runTime = 0;
  transitionT = 0;
  deadT = 0;
  stats: RunStats = this.emptyStats();
  opts: SimOptions;
  private carryHp: number = PLAYER.hp;
  private carryInv: Record<ItemKind, number> | null = null;
  private wonAlready = false;
  attractFloor: Floor | null = null;
  private attractT = 0;

  constructor(opts: SimOptions) {
    this.opts = opts;
  }

  private emptyStats(): RunStats {
    return { mode: 'normal', seedStr: '', dateKey: localDateString(), floor: 1, deepest: 1, timeMs: 0, clearTimeMs: null, pulses: 0, stones: 0, damage: 0, seen: 0, cleared: false, died: false };
  }

  get maxHp(): number {
    return this.opts.unlocks.has('heart4') ? PLAYER.hpUnlocked : PLAYER.hp;
  }

  get pulseColor(): readonly [number, number, number] {
    return this.opts.palette === 'alt' ? ALT_COLORS.pulse : COLORS.pulse;
  }

  startingInventory(): Record<ItemKind, number> {
    const u = this.opts.unlocks;
    return { stone: u.has('stone_start3') ? 3 : 2, flare: u.has('flare_start') ? 1 : 0, silencer: u.has('silencer_start') ? 1 : 0, bandage: 0 };
  }

  startRun(mode: Mode, seedStr?: string): SimEvent[] {
    this.mode = mode;
    this.seedStr = seedStr ?? (mode === 'daily' ? dailySeedString() : randomSeedString());
    this.seed = cyrb128(this.seedStr);
    this.floorIndex = 0;
    this.runTime = 0;
    this.wonAlready = false;
    this.stats = this.emptyStats();
    this.stats.mode = mode;
    this.stats.seedStr = this.seedStr;
    this.carryHp = this.maxHp;
    this.carryInv = this.startingInventory();
    this.attractFloor = null;
    return this.nextFloor();
  }

  nextFloor(): SimEvent[] {
    if (this.floor) {
      this.carryHp = this.floor.player.hp;
      this.carryInv = { ...this.floor.player.inv };
      this.accumulate(this.floor);
    }
    this.floorIndex += 1;
    this.floor = new Floor({
      seed: this.seed,
      floorIndex: this.floorIndex,
      diff: difficultyFor(this.floorIndex),
      maxHp: this.maxHp,
      hp: this.carryHp,
      inv: this.carryInv,
      mobile: this.opts.mobile,
      compass: this.opts.unlocks.has('compass'),
      pulseColor: this.pulseColor,
    });
    this.stats.floor = this.floorIndex;
    this.stats.deepest = Math.max(this.stats.deepest, this.floorIndex);
    this.phase = 'RUN';
    return [{ type: 'floorStart', floor: this.floorIndex }];
  }

  private accumulate(f: Floor): void {
    this.stats.pulses += f.stats.pulses;
    this.stats.stones += f.stats.stones;
    this.stats.damage += f.stats.damage;
    this.stats.seen += f.stats.seen.size;
  }

  ensureAttract(): Floor {
    if (!this.attractFloor) {
      this.attractFloor = new Floor({ seed: cyrb128('attract-' + localDateString()), floorIndex: 2, diff: difficultyFor(2), maxHp: 3, hp: 3, inv: null, mobile: this.opts.mobile, compass: false, pulseColor: this.pulseColor });
    }
    return this.attractFloor;
  }

  updateAttract(dt: number): void {
    const f = this.ensureAttract();
    this.attractT += dt;
    const idle: InputState = { moveX: 0, moveY: 0, sneak: false, pulse: false, item: null, pause: false, aimX: null, aimY: null, confirm: false, debug: false, any: false };
    if (this.attractT >= 2.5) {
      this.attractT = 0;
      f.player.pulseCd = 0;
      idle.pulse = true;
    }
    f.player.iframes = 99; // invulnerable demo
    f.update(dt, idle);
    if (f.finished) this.attractFloor = null;
  }

  togglePause(): SimEvent[] {
    if (this.phase === 'RUN') {
      this.phase = 'PAUSE';
      return [{ type: 'pause' }];
    }
    if (this.phase === 'PAUSE') {
      this.phase = 'RUN';
      return [{ type: 'resume' }];
    }
    return [];
  }

  abandon(): void {
    this.phase = 'TITLE';
    this.floor = null;
  }

  update(dt: number, input: InputState): SimEvent[] {
    const out: SimEvent[] = [];
    switch (this.phase) {
      case 'RUN': {
        const f = this.floor;
        if (!f) return out;
        if (input.pause) {
          out.push(...this.togglePause());
          return out;
        }
        f.update(dt, input);
        this.runTime += dt;
        for (const e of f.events) out.push({ type: 'floor', event: e });
        if (f.finished === 'dead') {
          this.phase = 'DEAD';
          this.deadT = 0;
          this.stats.died = true;
          this.accumulate(f);
          this.stats.timeMs = Math.round(this.runTime * 1000);
          out.push({ type: 'dead' });
        } else if (f.finished === 'exit') {
          if (this.floorIndex >= WIN_FLOOR && !this.wonAlready) {
            this.wonAlready = true;
            this.stats.cleared = true;
            this.stats.clearTimeMs = Math.round(this.runTime * 1000);
            this.stats.timeMs = this.stats.clearTimeMs;
            this.accumulate(f);
            this.phase = 'WIN';
            out.push({ type: 'win' });
          } else if (this.mode === 'daily' && this.floorIndex >= WIN_FLOOR) {
            this.phase = 'WIN';
            out.push({ type: 'win' });
          } else {
            this.phase = 'TRANSITION';
            this.transitionT = 0;
            out.push({ type: 'transition' });
          }
        }
        break;
      }
      case 'TRANSITION': {
        this.transitionT += dt;
        if (this.transitionT >= 0.9) out.push(...this.nextFloor());
        break;
      }
      case 'DEAD': {
        this.deadT += dt;
        const f = this.floor;
        if (f && this.deadT < 0.5) {
          // slow-motion tail: only ripples/pulses keep animating via simTime
          f.simTime += dt * 0.3;
        }
        if (this.deadT >= 1.2) {
          this.phase = 'SUMMARY';
          out.push({ type: 'summary' });
        }
        break;
      }
      case 'PAUSE':
        if (input.pause) out.push(...this.togglePause());
        break;
      case 'TITLE':
        this.updateAttract(dt);
        break;
      default:
        break;
    }
    return out;
  }

  /** After a win, continue into endless floors. */
  continueDeeper(): SimEvent[] {
    if (this.phase !== 'WIN' || this.mode === 'daily') return [];
    this.phase = 'TRANSITION';
    this.transitionT = 0;
    return [{ type: 'transition' }];
  }

  currentFloorDisplay(): number {
    return this.floorIndex;
  }

  inventory(): Record<ItemKind, number> {
    const inv = this.floor?.player.inv;
    const out = {} as Record<ItemKind, number>;
    for (const k of ITEM_KINDS) out[k] = inv ? inv[k] : 0;
    return out;
  }
}
