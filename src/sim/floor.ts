import { COLORS, ITEMS, ITEM_KINDS, NOISE, PLAYER, SONAR, TILE, type Difficulty, type ItemKind } from '@/config';
import type { InputState } from '@/core/input';
import { dist } from '@/core/math';
import { simRng, type Rng, type Seed4 } from '@/core/rng';
import { resolveCircle } from '@/entities/collision';
import { createEnemy, stunEnemy, updateEnemy, type EnemyContext } from '@/entities/enemies';
import { Player } from '@/entities/player';
import type { Enemy, FloorEvent, Item, Ripple, Stone } from '@/entities/types';
import { generateFloor, type FloorLayout } from '@/world/dungeon';
import type { Grid } from '@/world/grid';
import { wallsBetween } from '@/world/los';
import { NoiseSystem } from '@/world/noise';
import { Memory } from './memory';
import { PulseSystem } from './pulses';

export interface FloorInit {
  seed: Seed4;
  floorIndex: number;
  diff: Difficulty;
  maxHp: number;
  hp: number;
  inv: Record<ItemKind, number> | null;
  mobile: boolean;
  compass: boolean;
  pulseColor: readonly [number, number, number];
}

export interface FloorStats {
  pulses: number;
  stones: number;
  damage: number;
  seen: Set<number>;
}

export class Floor {
  readonly layout: FloorLayout;
  readonly grid: Grid;
  readonly diff: Difficulty;
  readonly floorIndex: number;
  readonly player: Player;
  enemies: Enemy[] = [];
  items: Item[] = [];
  stones: Stone[] = [];
  readonly pulses = new PulseSystem();
  readonly noise = new NoiseSystem();
  readonly memory = new Memory();
  ripples: Ripple[] = [];
  simTime = 0;
  keyTaken = false;
  exitUnlocked: boolean;
  exitHoldT = 0;
  finished: 'exit' | 'dead' | null = null;
  events: FloorEvent[] = [];
  readonly rng: Rng;
  readonly stats: FloorStats = { pulses: 0, stones: 0, damage: 0, seen: new Set() };
  nearestThreat = Infinity;
  anyChase = false;
  private exitHumT = 1.5;
  private keyChimeT = 2.5;
  private lockedMsgT = 0;
  private itemMsgT = 0;
  readonly exitX: number;
  readonly exitY: number;
  readonly keyX: number;
  readonly keyY: number;
  readonly mobile: boolean;
  readonly compass: boolean;
  readonly pulseColor: readonly [number, number, number];
  private webSeq = 1000;

  constructor(init: FloorInit) {
    this.layout = generateFloor(init.seed, init.floorIndex, init.diff);
    this.grid = this.layout.grid;
    this.diff = init.diff;
    this.floorIndex = init.floorIndex;
    this.mobile = init.mobile;
    this.compass = init.compass;
    this.pulseColor = init.pulseColor;
    this.rng = simRng(init.seed, init.floorIndex);
    this.player = new Player((this.layout.start.x + 0.5) * TILE, (this.layout.start.y + 0.5) * TILE, init.maxHp);
    this.player.hp = Math.max(1, Math.min(init.maxHp, init.hp));
    if (init.inv) for (const k of ITEM_KINDS) this.player.inv[k] = init.inv[k];
    this.exitUnlocked = !this.layout.locked;
    this.exitX = (this.layout.exit.x + 0.5) * TILE;
    this.exitY = (this.layout.exit.y + 0.5) * TILE;
    this.keyX = this.layout.key ? (this.layout.key.x + 0.5) * TILE : -1;
    this.keyY = this.layout.key ? (this.layout.key.y + 0.5) * TILE : -1;
    for (const s of this.layout.enemies) this.enemies.push(createEnemy(s, this.rng));
    let id = 1;
    for (const it of this.layout.items) this.items.push({ id: id++, kind: it.kind, x: (it.x + 0.5) * TILE, y: (it.y + 0.5) * TILE, taken: false });
    // arrival pulse: weak, silent
    this.pulses.emit(this.grid, 'player', this.player.x, this.player.y, 0, this.rayCount(), SONAR.arrivalRange, this.diff.fade, this.pulseColor);
  }

  private rayCount(): number {
    return this.mobile ? SONAR.raysMobile : SONAR.rays;
  }

  private ripple(x: number, y: number, maxRTiles: number, color: readonly [number, number, number], alpha: number): void {
    const p = this.player;
    const d = dist(x, y, p.x, p.y);
    if (d > 16 * TILE) return;
    const walls = wallsBetween(this.grid, p.x, p.y, x, y, 3);
    if (walls >= 3) return;
    const atten = Math.pow(0.6, walls);
    this.ripples.push({ x, y, t0: this.simTime, maxR: maxRTiles * TILE, speed: 140, alpha0: alpha, color, wallAtten: atten, width: 1.5 });
  }

  private playerNoise(radius: number, loudness: number, source: 'pulse' | 'step' | 'stone' | 'flare' | 'bandage' | 'trap', x = this.player.x, y = this.player.y, player = true): void {
    this.noise.emit({ x, y, radius, loudness, source, t: this.simTime, player });
    this.ripple(x, y, radius, source === 'stone' ? COLORS.stone : COLORS.player, source === 'step' ? 0.18 : 0.3);
  }

  emitPlayerPulse(): boolean {
    const p = this.player;
    if (p.pulseCd > 0) return false;
    p.pulseCd = PLAYER.pulseCooldown;
    this.pulses.emit(this.grid, 'player', p.x, p.y, this.simTime, this.rayCount(), SONAR.range, this.diff.fade, this.pulseColor);
    const radius = NOISE.pulse.radius * (p.silenced ? ITEMS.silencer.pulseMult : 1);
    this.playerNoise(radius, NOISE.pulse.loudness, 'pulse');
    this.stats.pulses++;
    this.events.push({ kind: 'pulse', x: p.x, y: p.y });
    return true;
  }

  useItem(kind: ItemKind, aimX: number | null, aimY: number | null): boolean {
    const p = this.player;
    if (p.inv[kind] <= 0) {
      this.events.push({ kind: 'noItem', x: p.x, y: p.y, data: kind });
      return false;
    }
    switch (kind) {
      case 'stone': {
        let dx: number;
        let dy: number;
        if (aimX !== null && aimY !== null && dist(aimX, aimY, p.x, p.y) > 4) {
          dx = aimX - p.x;
          dy = aimY - p.y;
        } else {
          dx = p.facingX;
          dy = p.facingY;
        }
        const d = Math.hypot(dx, dy) || 1;
        p.useItem('stone');
        this.stones.push({ x: p.x, y: p.y, px: p.x, py: p.y, vx: (dx / d) * ITEMS.stone.speed, vy: (dy / d) * ITEMS.stone.speed, travelled: 0, maxDist: ITEMS.stone.maxTiles * TILE, alive: true });
        this.stats.stones++;
        this.events.push({ kind: 'throw', x: p.x, y: p.y });
        return true;
      }
      case 'flare': {
        p.useItem('flare');
        this.pulses.emit(this.grid, 'flare', p.x, p.y, this.simTime, SONAR.flareRays, SONAR.flareRange, SONAR.flareFade, COLORS.flare);
        this.playerNoise(NOISE.flare.radius, NOISE.flare.loudness, 'flare');
        this.events.push({ kind: 'flare', x: p.x, y: p.y });
        return true;
      }
      case 'silencer': {
        p.useItem('silencer');
        p.silencerT = ITEMS.silencer.duration;
        this.events.push({ kind: 'silencer', x: p.x, y: p.y });
        return true;
      }
      case 'bandage': {
        if (p.hp >= p.maxHp) {
          this.events.push({ kind: 'noItem', x: p.x, y: p.y, data: 'hpFull' });
          return false;
        }
        p.useItem('bandage');
        p.heal(1);
        this.playerNoise(NOISE.bandage.radius, NOISE.bandage.loudness, 'bandage');
        this.events.push({ kind: 'bandage', x: p.x, y: p.y });
        return true;
      }
    }
  }

  update(dt: number, input: InputState): void {
    if (this.finished) return;
    this.simTime += dt;
    const t = this.simTime;
    const p = this.player;
    this.events = [];

    // ---- player actions
    if (input.pulse) this.emitPlayerPulse();
    if (input.item) this.useItem(input.item, input.aimX, input.aimY);
    const mv = p.move(dt, this.grid, input);
    if (mv.stepped) {
      const base = mv.sneak ? NOISE.sneak : NOISE.walk;
      const speedRatio = Math.min(1, Math.hypot(p.vx, p.vy) / PLAYER.walk);
      const radius = (mv.sneak ? base.radius : base.radius * Math.max(0.4, speedRatio)) * (p.silenced ? ITEMS.silencer.stepMult : 1);
      this.playerNoise(radius, base.loudness, 'step');
      this.memory.addFootprint(p.x, p.y, t);
      this.events.push({ kind: mv.sneak ? 'sneakStep' : 'step', x: p.x, y: p.y });
    }

    // ---- stones
    for (const s of this.stones) {
      if (!s.alive) continue;
      s.px = s.x;
      s.py = s.y;
      const dx = s.vx * dt;
      const dy = s.vy * dt;
      const res = resolveCircle(this.grid, s.x, s.y, 4, dx, dy);
      s.travelled += Math.hypot(res.x - s.x, res.y - s.y);
      s.x = res.x;
      s.y = res.y;
      if (res.hitX || res.hitY || s.travelled >= s.maxDist) {
        s.alive = false;
        this.playerNoise(NOISE.stone.radius, NOISE.stone.loudness, 'stone', s.x, s.y, false);
        this.memory.addBlip('stone', s.x, s.y, t, 2.5, 0);
        this.events.push({ kind: 'land', x: s.x, y: s.y });
      }
    }
    if (this.stones.length > 12) this.stones = this.stones.filter((s) => s.alive);

    // ---- pickups, key, exit
    this.itemMsgT -= dt;
    for (const it of this.items) {
      if (it.taken) continue;
      if (dist(it.x, it.y, p.x, p.y) < PLAYER.pickupR + p.r) {
        if (p.addItem(it.kind)) {
          it.taken = true;
          this.memory.removePersistent('item', it.id);
          this.events.push({ kind: 'pickup', x: it.x, y: it.y, data: it.kind });
        } else if (this.itemMsgT <= 0) {
          this.itemMsgT = 1.5;
          this.events.push({ kind: 'noItem', x: it.x, y: it.y, data: 'full' });
        }
      }
    }
    if (this.layout.key && !this.keyTaken && dist(this.keyX, this.keyY, p.x, p.y) < PLAYER.pickupR + p.r) {
      this.keyTaken = true;
      p.hasKey = true;
      this.exitUnlocked = true;
      this.memory.removePersistent('key', 0);
      this.events.push({ kind: 'key', x: this.keyX, y: this.keyY });
    }
    this.lockedMsgT -= dt;
    if (dist(this.exitX, this.exitY, p.x, p.y) < TILE * 0.7) {
      if (this.exitUnlocked) {
        this.exitHoldT += dt;
        if (this.exitHoldT >= PLAYER.exitHold) {
          this.finished = 'exit';
          this.events.push({ kind: 'exit', x: this.exitX, y: this.exitY });
          return;
        }
      } else if (this.lockedMsgT <= 0) {
        this.lockedMsgT = 2.5;
        this.events.push({ kind: 'locked', x: this.exitX, y: this.exitY });
      }
    } else {
      this.exitHoldT = 0;
    }

    // ---- pulses & reveals
    this.pulses.update(t);
    for (const pulse of this.pulses.pulses) {
      if (pulse.expired) continue;
      for (const e of this.enemies) {
        if (e.dead || pulse.revealed.has(e.id)) continue;
        if (this.pulses.reaches(pulse, t, e.x, e.y, e.r)) {
          pulse.revealed.add(e.id);
          this.stats.seen.add(e.id);
          e.seenByPulseT = t;
          if (e.kind === 'spider') this.memory.addBlip('spider', e.x, e.y, t, Infinity, e.id, true);
          else this.memory.addBlip(e.kind, e.x, e.y, t, pulse.fade * 0.6, e.id);
        }
      }
      for (const it of this.items) {
        const ref = 10000 + it.id;
        if (it.taken || pulse.revealed.has(ref)) continue;
        if (this.pulses.reaches(pulse, t, it.x, it.y, 8)) {
          pulse.revealed.add(ref);
          this.memory.addBlip('item', it.x, it.y, t, Infinity, it.id, true, it.kind);
        }
      }
      if (this.layout.key && !this.keyTaken && !pulse.revealed.has(-1) && this.pulses.reaches(pulse, t, this.keyX, this.keyY, 8)) {
        pulse.revealed.add(-1);
        this.memory.addBlip('key', this.keyX, this.keyY, t, Infinity, 0, true);
      }
      if (!pulse.revealed.has(-2) && this.pulses.reaches(pulse, t, this.exitX, this.exitY, 10)) {
        pulse.revealed.add(-2);
        this.memory.addBlip('exit', this.exitX, this.exitY, t, Infinity, 0, true);
      }
    }

    // ---- enemies
    const noises = this.noise.drain();
    const ctx: EnemyContext = {
      grid: this.grid,
      t,
      dt,
      player: { x: p.x, y: p.y, r: p.r, dead: p.dead },
      noises,
      diff: this.diff,
      rng: this.rng,
      events: this.events,
      noiseOut: this.noise,
      pulses: this.pulses,
      budget: { astar: 6 },
      ripple: (x, y, r, c, a) => this.ripple(x, y, r, c, a),
    };
    let nearest = Infinity;
    let anyChase = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      updateEnemy(e, ctx);
      const d = dist(e.x, e.y, p.x, p.y);
      if (e.kind === 'spider') {
        if (d < e.r + p.r * 0.6) {
          e.dead = true;
          this.memory.removePersistent('spider', e.id);
          this.memory.addBlip('web', e.x, e.y, t, Infinity, this.webSeq++, true);
          if (p.damage(1, e.x, e.y)) this.stats.damage += 1;
          p.webbed = PLAYER.webbedTime;
          this.playerNoise(NOISE.trap.radius, NOISE.trap.loudness, 'trap', e.x, e.y, true);
          this.events.push({ kind: 'trap', x: e.x, y: e.y });
        }
        continue;
      }
      if (e.kind === 'bat') continue;
      if (e.kind === 'predator' && !e.awake) {
        nearest = Math.min(nearest, d / TILE + 4);
        continue;
      }
      nearest = Math.min(nearest, d / TILE);
      if (e.state === 'CHASE') anyChase = true;
      if (!p.dead && d < e.r + p.r && e.state !== 'STUNNED') {
        const dmg = e.kind === 'predator' ? 2 : 1;
        if (p.damage(dmg, e.x, e.y)) {
          this.stats.damage += dmg;
          this.events.push({ kind: 'hit', x: p.x, y: p.y, data: dmg });
          if (e.kind === 'hunter') stunEnemy(e);
        }
      }
    }
    this.nearestThreat = nearest;
    this.anyChase = anyChase;
    if (p.dead) {
      this.finished = 'dead';
      this.events.push({ kind: 'death', x: p.x, y: p.y });
      return;
    }

    // ---- ambient navigation sounds
    this.exitHumT -= dt;
    if (this.exitHumT <= 0) {
      this.exitHumT = 3;
      if (dist(this.exitX, this.exitY, p.x, p.y) < 12 * TILE) {
        this.ripple(this.exitX, this.exitY, 2.5, COLORS.exit, 0.5);
        this.events.push({ kind: 'exitHum', x: this.exitX, y: this.exitY });
      }
    }
    if (this.layout.key && !this.keyTaken) {
      this.keyChimeT -= dt;
      if (this.keyChimeT <= 0) {
        this.keyChimeT = 4;
        if (dist(this.keyX, this.keyY, p.x, p.y) < 10 * TILE) {
          this.ripple(this.keyX, this.keyY, 2, COLORS.key, 0.5);
          this.events.push({ kind: 'keyChime', x: this.keyX, y: this.keyY });
        }
      }
    }

    // ---- ripples & memory housekeeping
    if (this.ripples.length) this.ripples = this.ripples.filter((r) => (t - r.t0) * r.speed < r.maxR);
    this.memory.update(t);
  }
}
