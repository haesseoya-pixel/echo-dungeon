import { ITEM_CAP, ITEMS, PLAYER, type ItemKind } from '@/config';
import type { InputState } from '@/core/input';
import { expDecay } from '@/core/math';
import type { Grid } from '@/world/grid';
import { resolveCircle } from './collision';

export interface MoveOutcome {
  stepped: boolean;
  sneak: boolean;
  moving: boolean;
}

export class Player {
  x: number;
  y: number;
  px: number;
  py: number;
  vx = 0;
  vy = 0;
  r = PLAYER.r;
  hp: number;
  maxHp: number;
  iframes = 0;
  webbed = 0;
  sneaking = false;
  facingX = 1;
  facingY = 0;
  stepT = 0;
  pulseCd = 0;
  silencerT = 0;
  inv: Record<ItemKind, number> = { stone: 0, flare: 0, silencer: 0, bandage: 0 };
  hasKey = false;
  kbx = 0;
  kby = 0;
  stillT = 0;
  moving = false;
  dead = false;
  blink = 0;

  constructor(x: number, y: number, maxHp: number) {
    this.x = x;
    this.y = y;
    this.px = x;
    this.py = y;
    this.hp = maxHp;
    this.maxHp = maxHp;
  }

  get silenced(): boolean {
    return this.silencerT > 0;
  }

  addItem(kind: ItemKind): boolean {
    if (this.inv[kind] >= ITEM_CAP[kind]) return false;
    this.inv[kind]++;
    return true;
  }

  useItem(kind: ItemKind): boolean {
    if (this.inv[kind] <= 0) return false;
    this.inv[kind]--;
    return true;
  }

  heal(n: number): boolean {
    if (this.hp >= this.maxHp) return false;
    this.hp = Math.min(this.maxHp, this.hp + n);
    return true;
  }

  /** Returns true if damage was applied (not in i-frames). */
  damage(n: number, fromX: number, fromY: number): boolean {
    if (this.iframes > 0 || this.dead) return false;
    this.hp -= n;
    this.iframes = PLAYER.iframes;
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    this.kbx = (dx / d) * PLAYER.knockback;
    this.kby = (dy / d) * PLAYER.knockback;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
    return true;
  }

  move(dt: number, grid: Grid, input: InputState): MoveOutcome {
    this.px = this.x;
    this.py = this.y;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.webbed > 0) this.webbed -= dt;
    if (this.pulseCd > 0) this.pulseCd -= dt;
    if (this.silencerT > 0) this.silencerT -= dt;
    this.blink += dt;
    const sneak = input.sneak;
    this.sneaking = sneak;
    let speed = sneak ? PLAYER.sneak : PLAYER.walk;
    if (this.webbed > 0) speed *= PLAYER.webbedSlow;
    const tx = input.moveX * speed;
    const ty = input.moveY * speed;
    this.vx = expDecay(this.vx, tx, PLAYER.accel, dt);
    this.vy = expDecay(this.vy, ty, PLAYER.accel, dt);
    this.kbx = expDecay(this.kbx, 0, 8, dt);
    this.kby = expDecay(this.kby, 0, 8, dt);
    if (Math.abs(this.kbx) < 1) this.kbx = 0;
    if (Math.abs(this.kby) < 1) this.kby = 0;
    const dx = (this.vx + this.kbx) * dt;
    const dy = (this.vy + this.kby) * dt;
    const res = resolveCircle(grid, this.x, this.y, this.r, dx, dy);
    this.x = res.x;
    this.y = res.y;
    if (res.hitX) {
      this.vx *= 0.2;
      this.kbx = 0;
    }
    if (res.hitY) {
      this.vy *= 0.2;
      this.kby = 0;
    }
    if (input.moveX !== 0 || input.moveY !== 0) {
      this.facingX = input.moveX;
      this.facingY = input.moveY;
    }
    const sp = Math.hypot(this.vx, this.vy);
    const moving = sp > 5;
    this.moving = moving;
    let stepped = false;
    if (moving) {
      this.stillT = 0;
      this.stepT += dt * (sp / (sneak ? PLAYER.sneak : PLAYER.walk));
      const interval = sneak ? PLAYER.stepIntervalSneak : PLAYER.stepIntervalWalk;
      if (this.stepT >= interval) {
        this.stepT -= interval;
        stepped = true;
      }
    } else {
      this.stillT += dt;
      this.stepT = Math.min(this.stepT, 0.1);
    }
    return { stepped, sneak, moving };
  }

  stoneMaxDist(): number {
    return ITEMS.stone.maxTiles;
  }
}
