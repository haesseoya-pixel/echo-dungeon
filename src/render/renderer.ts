import { ALT_COLORS, COLORS, FLOOR_INTRO_SECONDS, ITEM_KINDS, PLAYER, SONAR, TILE, WALL_MEMORY_ALPHA, type ItemKind } from '@/config';
import type { Input } from '@/core/input';
import { clamp, expDecay, formatClock, lerp, TAU } from '@/core/math';
import type { Blip, Pulse } from '@/entities/types';
import type { Floor } from '@/sim/floor';
import type { GameSim } from '@/sim/game';
import { S } from '@/strings.ko';
import { castFan } from '@/world/raycast';
import { FLOOR, DOOR } from '@/world/grid';

type RGB = readonly [number, number, number];
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a < 0 ? 0 : a > 1 ? 1 : a})`;
const FONT = 'system-ui, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

export type MessageKind = 'info' | 'good' | 'warn' | 'danger';
export interface HudMessage {
  text: string;
  t: number;
  kind: MessageKind;
}

export interface HudState {
  hint: string | null;
  messages: HudMessage[];
  debug: boolean;
  compassAngle: number | null;
  touch: boolean;
  objective: string;
  intro: { title: string; sub: string; t: number } | null;
  hitDir: { angle: number; t: number } | null;
  wallMemory: boolean;
  heartBeat: number;
}

const MSG_COLORS: Record<MessageKind, string> = {
  info: 'rgba(220,232,255,0.92)',
  good: 'rgba(120,255,170,0.95)',
  warn: 'rgba(255,215,110,0.95)',
  danger: 'rgba(255,120,120,0.95)',
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bloom: HTMLCanvasElement = document.createElement('canvas');
  private bctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  camX = 0;
  camY = 0;
  scale = 1;
  private trauma = 0;
  private flashPulse = 0;
  private flashHit = 0;
  private transitionAlpha = 0;
  private time = 0;
  private touchHits = new Float32Array(SONAR.touchRays * 4);
  private frameTimes: number[] = [];
  bloomEnabled = true;
  shakeEnabled = true;
  palette: 'default' | 'alt' = 'default';
  private input: Input;
  private lastFloor: Floor | null = null;

  constructor(canvas: HTMLCanvasElement, input: Input) {
    this.canvas = canvas;
    this.input = input;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.bctx = this.bloom.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect?.width ?? window.innerWidth));
    const h = Math.max(1, Math.floor(rect?.height ?? window.innerHeight));
    const touch = matchMedia('(pointer: coarse)').matches;
    this.dpr = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.bloom.width = Math.max(1, Math.floor(w / 4));
    this.bloom.height = Math.max(1, Math.floor(h / 4));
    this.scale = clamp(Math.min(w / (30 * TILE), h / (18 * TILE)), 0.8, 2.0);
    if (touch) this.scale = clamp(Math.min(w / (16 * TILE), h / (14 * TILE)), 0.9, 2.2);
  }

  get width(): number {
    return this.w;
  }
  get height(): number {
    return this.h;
  }

  addTrauma(v: number): void {
    if (!this.shakeEnabled) return;
    this.trauma = clamp(this.trauma + v, 0, 1);
  }
  pulseFlash(): void {
    this.flashPulse = 1;
  }
  hitFlash(): void {
    this.flashHit = 1;
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.scale + this.camX, (sy - this.h / 2) / this.scale + this.camY];
  }

  snapCamera(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
  }

  private pulseColor(): RGB {
    return this.palette === 'alt' ? ALT_COLORS.pulse : COLORS.pulse;
  }
  private playerColor(): RGB {
    return this.palette === 'alt' ? ALT_COLORS.player : COLORS.player;
  }

  render(sim: GameSim, alpha: number, dtFrame: number, hud: HudState): void {
    const t0 = performance.now();
    this.time += dtFrame;
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const floor = sim.phase === 'TITLE' ? sim.attractFloor : sim.floor;
    this.trauma = Math.max(0, this.trauma - 1.5 * dtFrame);
    this.flashPulse = Math.max(0, this.flashPulse - dtFrame / 0.15);
    this.flashHit = Math.max(0, this.flashHit - dtFrame / 0.2);
    const targetTransition = sim.phase === 'TRANSITION' ? 1 : sim.phase === 'TITLE' ? 0.55 : 0;
    this.transitionAlpha = expDecay(this.transitionAlpha, targetTransition, sim.phase === 'TRANSITION' ? 6 : 3, dtFrame);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    if (floor) {
      if (floor !== this.lastFloor) {
        this.lastFloor = floor;
        this.camX = floor.player.x;
        this.camY = floor.player.y;
      }
      this.drawWorld(ctx, floor, alpha, dtFrame, hud, sim.phase !== 'TITLE');
    }

    // overlays in screen space
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    if (this.flashPulse > 0) {
      ctx.fillStyle = rgba(this.pulseColor(), 0.08 * this.flashPulse);
      ctx.fillRect(0, 0, w, h);
    }
    if (this.flashHit > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(255,40,40,0)');
      g.addColorStop(1, `rgba(255,40,40,${0.55 * this.flashHit})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (hud.hitDir && hud.hitDir.t > 0) this.drawHitDirection(ctx, hud.hitDir.angle, hud.hitDir.t);
    if (this.transitionAlpha > 0.01) {
      ctx.fillStyle = `rgba(0,0,0,${this.transitionAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }
    const hudPhase = sim.phase === 'RUN' || sim.phase === 'PAUSE' || sim.phase === 'TRANSITION' || sim.phase === 'DEAD';
    if (floor && hudPhase) this.drawHud(ctx, sim, floor, hud);
    if (hud.intro && hud.intro.t > 0 && (sim.phase === 'RUN' || sim.phase === 'TRANSITION')) this.drawIntro(ctx, hud.intro);

    // perf governor for bloom
    const ms = performance.now() - t0;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 120) {
      this.frameTimes.shift();
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      if (avg > 20 && this.bloomEnabled) this.bloomEnabled = false;
    }
  }

  private drawWorld(ctx: CanvasRenderingContext2D, f: Floor, alpha: number, dtFrame: number, hud: HudState, live: boolean): void {
    const w = this.w;
    const h = this.h;
    const p = f.player;
    const px = lerp(p.px, p.x, alpha);
    const py = lerp(p.py, p.y, alpha);
    // camera
    let lookX = 0;
    let lookY = 0;
    if (this.input.mouseInside && live) {
      const [ax, ay] = this.screenToWorld(this.input.mouseX, this.input.mouseY);
      lookX = (ax - px) * 0.1;
      lookY = (ay - py) * 0.1;
    }
    const k = 1 - Math.exp(-8 * dtFrame);
    this.camX += (px + lookX - this.camX) * k;
    this.camY += (py + lookY - this.camY) * k;
    const sh = this.trauma * this.trauma;
    const shakeX = 12 * sh * Math.sin(this.time * 63.1) * Math.cos(this.time * 21.7);
    const shakeY = 12 * sh * Math.cos(this.time * 47.3) * Math.sin(this.time * 33.9);
    const rot = 0.017 * sh * Math.sin(this.time * 29);
    const t = f.simTime;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(w / 2 + shakeX, h / 2 + shakeY);
    ctx.rotate(rot);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.camX, -this.camY);
    const bctx = this.bctx;
    if (this.bloomEnabled) {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, this.bloom.width, this.bloom.height);
      bctx.setTransform(0.25, 0, 0, 0.25, 0, 0);
      bctx.translate(w / 2 + shakeX, h / 2 + shakeY);
      bctx.rotate(rot);
      bctx.scale(this.scale, this.scale);
      bctx.translate(-this.camX, -this.camY);
    }
    const halfW = w / 2 / this.scale + TILE * 2;
    const halfH = h / 2 / this.scale + TILE * 2;
    const minX = this.camX - halfW;
    const maxX = this.camX + halfW;
    const minY = this.camY - halfH;
    const maxY = this.camY + halfH;
    const inView = (x: number, y: number) => x > minX && x < maxX && y > minY && y < maxY;

    if (hud.debug) this.drawDebug(ctx, f);

    // wall memory: faint edges of walls the player has already lit
    if (hud.wallMemory && f.memory.seenCount > 0) this.drawSeenWalls(ctx, f, minX, maxX, minY, maxY);

    // footprints
    const fp = f.memory.footprints;
    ctx.fillStyle = rgba(COLORS.footprint, 0.12);
    for (let i = 0; i < f.memory.fpCount; i++) {
      const age = t - fp[i * 3 + 2]!;
      if (age > 12) continue;
      ctx.globalAlpha = 0.14 * (1 - age / 12);
      ctx.beginPath();
      ctx.arc(fp[i * 3]!, fp[i * 3 + 1]!, 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const b of f.memory.persistentBlips()) if (inView(b.x, b.y)) this.drawBlip(ctx, b, 0.35, t);

    this.drawPulseWalls(ctx, f, t, inView);

    // touch sense
    if (live) {
      castFan(f.grid, px, py, SONAR.touchRays, SONAR.touchRange, this.touchHits);
      ctx.strokeStyle = rgba(this.pulseColor(), 0.14);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < SONAR.touchRays; i++) {
        if (this.touchHits[i * 4 + 3] === -1) continue;
        const hx = this.touchHits[i * 4]!;
        const hy = this.touchHits[i * 4 + 1]!;
        ctx.moveTo(hx - 1, hy);
        ctx.lineTo(hx + 1, hy);
      }
      ctx.stroke();
    }

    // ripples
    ctx.lineWidth = 1.5;
    for (const r of f.ripples) {
      const rr = (t - r.t0) * r.speed;
      if (rr <= 0 || rr >= r.maxR) continue;
      const a = r.alpha0 * r.wallAtten * (1 - rr / r.maxR);
      ctx.strokeStyle = rgba(r.color, a);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rr, 0, TAU);
      ctx.stroke();
    }

    // transient blips
    for (const b of f.memory.blips) {
      if (!inView(b.x, b.y)) continue;
      const age = t - b.t0;
      const a = Math.max(0, 1 - age / b.life);
      this.drawBlip(ctx, b, a, t);
      if (this.bloomEnabled && (b.kind === 'hunter' || b.kind === 'predator')) this.drawBlip(bctx, b, a * 0.5, t);
    }

    // stones in flight
    ctx.fillStyle = rgba(COLORS.stone, 0.9);
    for (const s of f.stones) {
      if (!s.alive) continue;
      const sx = lerp(s.px, s.x, alpha);
      const sy = lerp(s.py, s.y, alpha);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, TAU);
      ctx.fill();
    }

    // player
    const pc = this.playerColor();
    const haloR = 26;
    const hg = ctx.createRadialGradient(px, py, 2, px, py, haloR);
    hg.addColorStop(0, rgba(pc, 0.55));
    hg.addColorStop(0.4, rgba(pc, 0.12));
    hg.addColorStop(1, rgba(pc, 0));
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(px, py, haloR, 0, TAU);
    ctx.fill();
    const blinkOn = p.iframes <= 0 || Math.floor(p.blink * 12) % 2 === 0;
    if (blinkOn) {
      ctx.fillStyle = rgba(pc, 1);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = rgba(pc, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px + p.facingX * 6, py + p.facingY * 6);
    ctx.lineTo(px + p.facingX * 11, py + p.facingY * 11);
    ctx.stroke();
    if (p.pulseCd > 0 && live) {
      ctx.strokeStyle = rgba(pc, 0.5);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, 9, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p.pulseCd / PLAYER.pulseCooldown));
      ctx.stroke();
    }
    // exit hold progress
    if (f.exitHoldT > 0 && live) {
      ctx.strokeStyle = rgba(COLORS.exit, 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, 16, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(f.exitHoldT / PLAYER.exitHold, 0, 1));
      ctx.stroke();
    }
    // sneaking indicator
    if (p.sneaking && p.moving && live) {
      ctx.strokeStyle = rgba(pc, 0.35);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // expanding pulse rings (chromatic)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pulse of f.pulses.pulses) {
      if (pulse.expired || pulse.owner === 'touch') continue;
      const r = pulse.speed * (t - pulse.t0);
      if (r <= 0 || r >= pulse.range) continue;
      const a = 0.55 * (1 - r / pulse.range);
      const cols: [RGB, number][] = pulse.owner === 'player' ? [[[255, 80, 80], -2], [pulse.color, 0], [[80, 120, 255], 2]] : [[pulse.color, 0]];
      for (const [c, off] of cols) {
        ctx.strokeStyle = rgba(c, a * (off === 0 ? 1 : 0.5));
        ctx.lineWidth = off === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, Math.max(0, r + off), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
    if (this.bloomEnabled) {
      bctx.fillStyle = rgba(pc, 0.9);
      bctx.beginPath();
      bctx.arc(px, py, 6, 0, TAU);
      bctx.fill();
    }

    if (this.bloomEnabled) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.bloom, 0, 0, w, h);
      ctx.restore();
    }
  }

  private drawSeenWalls(ctx: CanvasRenderingContext2D, f: Floor, minX: number, maxX: number, minY: number, maxY: number): void {
    const g = f.grid;
    const seen = f.memory.seenWalls;
    const tx0 = Math.max(0, Math.floor(minX / TILE));
    const tx1 = Math.min(g.w - 1, Math.floor(maxX / TILE));
    const ty0 = Math.max(0, Math.floor(minY / TILE));
    const ty1 = Math.min(g.h - 1, Math.floor(maxY / TILE));
    ctx.strokeStyle = rgba(this.pulseColor(), WALL_MEMORY_ALPHA);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (seen[ty * g.w + tx] !== 1) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        if (!g.isSolid(tx, ty - 1)) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + TILE, y);
        }
        if (!g.isSolid(tx, ty + 1)) {
          ctx.moveTo(x, y + TILE);
          ctx.lineTo(x + TILE, y + TILE);
        }
        if (!g.isSolid(tx - 1, ty)) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + TILE);
        }
        if (!g.isSolid(tx + 1, ty)) {
          ctx.moveTo(x + TILE, y);
          ctx.lineTo(x + TILE, y + TILE);
        }
      }
    }
    ctx.stroke();
  }

  private drawPulseWalls(ctx: CanvasRenderingContext2D, f: Floor, t: number, inView: (x: number, y: number) => boolean): void {
    const buckets: Path2D[] = [];
    const bucketColors: (RGB | null)[] = [];
    const BUCKETS = 8;
    const colorList: RGB[] = [];
    const colorIndex = (c: RGB) => {
      for (let i = 0; i < colorList.length; i++) if (colorList[i] === c) return i;
      colorList.push(c);
      return colorList.length - 1;
    };
    for (const pulse of f.pulses.pulses) {
      if (pulse.expired || pulse.owner === 'touch') continue;
      const r = pulse.speed * (t - pulse.t0);
      const hits = pulse.hits;
      const runs = pulse.runs;
      const ci = colorIndex(pulse.color);
      for (let k = 0; k < runs.length - 1; k++) {
        const start = runs[k]!;
        const end = this.runEndFor(pulse, k);
        const dMid = hits[start * 4 + 2]!;
        if (dMid > r) continue;
        const age = t - pulse.t0 - dMid / pulse.speed;
        const a = age < 0.2 ? 1 : Math.max(0, 1 - (age - 0.2) / pulse.fade);
        if (a <= 0.02) continue;
        const bucket = Math.min(BUCKETS - 1, Math.round(a * a * (BUCKETS - 1)));
        const idx = ci * BUCKETS + bucket;
        let path = buckets[idx];
        if (!path) {
          path = new Path2D();
          buckets[idx] = path;
          bucketColors[idx] = pulse.color;
        }
        const x0 = hits[start * 4]!;
        const y0 = hits[start * 4 + 1]!;
        if (!inView(x0, y0)) continue;
        if (end - start <= 1) {
          path.moveTo(x0 - 1, y0);
          path.lineTo(x0 + 1, y0);
          continue;
        }
        path.moveTo(x0, y0);
        for (let i = start + 1; i < end; i++) path.lineTo(hits[i * 4]!, hits[i * 4 + 1]!);
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < buckets.length; i++) {
      const path = buckets[i];
      if (!path) continue;
      const color = bucketColors[i]!;
      const a = ((i % BUCKETS) + 0.5) / BUCKETS;
      ctx.strokeStyle = rgba(color, Math.sqrt(a));
      ctx.lineWidth = 2;
      ctx.stroke(path);
      if (this.bloomEnabled) {
        this.bctx.strokeStyle = rgba(color, Math.sqrt(a) * 0.45);
        this.bctx.lineWidth = 7;
        this.bctx.lineCap = 'round';
        this.bctx.stroke(path);
      }
    }
  }

  private runEndFor(pulse: Pulse, k: number): number {
    const runs = pulse.runs;
    const start = runs[k]!;
    const next = runs[k + 1]!;
    const hits = pulse.hits;
    let j = start;
    while (j + 1 < next) {
      const a = j * 4;
      const b = (j + 1) * 4;
      if (hits[b + 3] === -1 || hits[a + 3] !== hits[b + 3]) break;
      if (Math.abs(hits[a + 2]! - hits[b + 2]!) >= 0.75 * TILE) break;
      const ddx = hits[a]! - hits[b]!;
      const ddy = hits[a + 1]! - hits[b + 1]!;
      if (ddx * ddx + ddy * ddy >= 1.44 * TILE * TILE) break;
      if (Math.floor(hits[a + 2]! / SONAR.runGap) !== Math.floor(hits[b + 2]! / SONAR.runGap)) break;
      j++;
    }
    return j + 1;
  }

  private drawBlip(ctx: CanvasRenderingContext2D, b: Blip, a: number, t: number): void {
    if (a <= 0.01) return;
    const x = b.x;
    const y = b.y;
    ctx.lineWidth = 1.5;
    const label = (text: string, color: RGB, dy: number) => {
      ctx.fillStyle = rgba(color, a);
      ctx.font = `600 9px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + dy);
    };
    switch (b.kind) {
      case 'hunter':
      case 'predator': {
        const s = b.kind === 'predator' ? 13 : 8;
        const col = b.kind === 'predator' ? COLORS.predator : COLORS.hunter;
        ctx.strokeStyle = rgba(col, a);
        ctx.fillStyle = rgba(col, a * 0.25);
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s, y);
        ctx.lineTo(x, y + s);
        ctx.lineTo(x - s, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (b.label) label(b.label, col, s + 9);
        break;
      }
      case 'bat': {
        ctx.strokeStyle = rgba(COLORS.bat, a);
        ctx.beginPath();
        ctx.moveTo(x - 7, y - 3);
        ctx.quadraticCurveTo(x - 3, y + 2, x, y - 1);
        ctx.quadraticCurveTo(x + 3, y + 2, x + 7, y - 3);
        ctx.stroke();
        if (b.label) label(b.label, COLORS.bat, 12);
        break;
      }
      case 'spider': {
        ctx.strokeStyle = rgba(COLORS.spider, a);
        for (let i = 0; i < 4; i++) {
          const ang = (i * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(ang) * 7, y - Math.sin(ang) * 7);
          ctx.lineTo(x + Math.cos(ang) * 7, y + Math.sin(ang) * 7);
          ctx.stroke();
        }
        if (b.label) label(b.label, COLORS.spider, 15);
        break;
      }
      case 'web': {
        ctx.strokeStyle = rgba(COLORS.spider, a * 0.5);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'item': {
        ctx.strokeStyle = rgba(COLORS.item, a);
        ctx.fillStyle = rgba(COLORS.item, a * 0.2);
        ctx.beginPath();
        ctx.rect(x - 4, y - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
        if (b.label) label(S.itemName[b.label as ItemKind] ?? '', COLORS.item, 15);
        break;
      }
      case 'key': {
        ctx.strokeStyle = rgba(COLORS.key, a);
        ctx.beginPath();
        ctx.arc(x - 3, y, 3.5, 0, TAU);
        ctx.moveTo(x, y);
        ctx.lineTo(x + 8, y);
        ctx.moveTo(x + 5, y);
        ctx.lineTo(x + 5, y + 3);
        ctx.moveTo(x + 8, y);
        ctx.lineTo(x + 8, y + 3);
        ctx.stroke();
        label('열쇠', COLORS.key, 14);
        break;
      }
      case 'exit': {
        const pulse = 0.6 + 0.4 * Math.sin(t * 3);
        ctx.strokeStyle = rgba(COLORS.exit, a * pulse);
        ctx.fillStyle = rgba(COLORS.exit, a * 0.15);
        ctx.beginPath();
        ctx.rect(x - 10, y - 10, 20, 20);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        for (let i = 1; i < 4; i++) {
          ctx.moveTo(x - 10, y - 10 + i * 5);
          ctx.lineTo(x + 10, y - 10 + i * 5);
        }
        ctx.stroke();
        label('출구', COLORS.exit, 20);
        break;
      }
      case 'stone': {
        ctx.fillStyle = rgba(COLORS.stone, a);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, TAU);
        ctx.fill();
        break;
      }
    }
  }

  private drawDebug(ctx: CanvasRenderingContext2D, f: Floor): void {
    const g = f.grid;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const v = g.get(x, y);
        if (v === FLOOR) ctx.fillStyle = 'rgba(40,50,70,0.5)';
        else if (v === DOOR) ctx.fillStyle = 'rgba(70,60,40,0.6)';
        else continue;
        ctx.fillRect(x * TILE, y * TILE, TILE - 1, TILE - 1);
      }
    }
    ctx.font = '10px monospace';
    for (const e of f.enemies) {
      if (e.dead) continue;
      ctx.fillStyle = e.kind === 'hunter' ? '#f66' : e.kind === 'bat' ? '#c8f' : e.kind === 'spider' ? '#cf6' : '#f36';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(`${e.kind[0]}:${e.state}`, e.x + 8, e.y - 8);
      if (e.path) {
        ctx.strokeStyle = 'rgba(255,255,0,0.4)';
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        for (let i = e.pathIdx; i < e.path.length; i++) ctx.lineTo((e.path[i]![0] + 0.5) * TILE, (e.path[i]![1] + 0.5) * TILE);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#4f4';
    ctx.fillRect(f.exitX - 6, f.exitY - 6, 12, 12);
    if (f.layout.key && !f.keyTaken) {
      ctx.fillStyle = '#fd4';
      ctx.fillRect(f.keyX - 4, f.keyY - 4, 8, 8);
    }
    for (const it of f.items)
      if (!it.taken) {
        ctx.fillStyle = '#9cf';
        ctx.fillRect(it.x - 3, it.y - 3, 6, 6);
      }
  }

  private drawHitDirection(ctx: CanvasRenderingContext2D, angle: number, t: number): void {
    const w = this.w;
    const h = this.h;
    const a = clamp(t / 0.8, 0, 1);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    const rr = Math.min(w, h) * 0.42;
    const g = ctx.createRadialGradient(rr, 0, 10, rr, 0, rr * 0.9);
    g.addColorStop(0, `rgba(255,60,60,${0.55 * a})`);
    g.addColorStop(1, 'rgba(255,60,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rr * 1.4, -0.6, 0.6);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255,90,90,${0.9 * a})`;
    ctx.beginPath();
    ctx.moveTo(rr, 0);
    ctx.lineTo(rr - 16, -10);
    ctx.lineTo(rr - 16, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawIntro(ctx: CanvasRenderingContext2D, intro: { title: string; sub: string; t: number }): void {
    const w = this.w;
    const h = this.h;
    const life = FLOOR_INTRO_SECONDS;
    const age = life - intro.t;
    const a = age < 0.3 ? age / 0.3 : intro.t < 0.6 ? intro.t / 0.6 : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, h * 0.28, w, 96);
    ctx.fillStyle = 'rgba(235,245,255,0.98)';
    ctx.font = `200 40px ${FONT}`;
    ctx.fillText(intro.title, w / 2, h * 0.28 + 34);
    ctx.font = `500 15px ${FONT}`;
    ctx.fillStyle = rgba(this.pulseColor(), 0.95);
    ctx.fillText(intro.sub, w / 2, h * 0.28 + 72);
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, sim: GameSim, f: Floor, hud: HudState): void {
    const w = this.w;
    const h = this.h;
    const p = f.player;
    ctx.textBaseline = 'middle';
    const heartPath = (x: number, y: number, s: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.35);
      ctx.bezierCurveTo(x, y - s * 0.1, x - s * 0.55, y - s * 0.1, x - s * 0.55, y + s * 0.15);
      ctx.bezierCurveTo(x - s * 0.55, y + s * 0.45, x, y + s * 0.65, x, y + s * 0.85);
      ctx.bezierCurveTo(x, y + s * 0.65, x + s * 0.55, y + s * 0.45, x + s * 0.55, y + s * 0.15);
      ctx.bezierCurveTo(x + s * 0.55, y - s * 0.1, x, y - s * 0.1, x, y + s * 0.35);
      ctx.closePath();
    };
    // hearts
    const hurt = p.iframes > 0;
    for (let i = 0; i < p.maxHp; i++) {
      const s = 20 * (hurt && i === p.hp ? 1 + 0.25 * Math.sin(this.time * 40) : 1);
      heartPath(28 + i * 26, 14, s);
      ctx.fillStyle = i < p.hp ? 'rgba(255,90,110,0.95)' : 'rgba(255,255,255,0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,150,160,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // threat indicator (visual heartbeat)
    const near = f.nearestThreat;
    const level = f.anyChase ? 3 : near < 6 ? 2 : near < 10 ? 1 : 0;
    const threatText = level === 3 ? S.threat.chase : level === 2 ? S.threat.danger : level === 1 ? S.threat.caution : S.threat.safe;
    const threatColor = level >= 2 ? 'rgba(255,90,90,0.95)' : level === 1 ? 'rgba(255,215,110,0.95)' : 'rgba(120,200,160,0.6)';
    const beat = 1 + 0.25 * hud.heartBeat;
    const tx = 28 + p.maxHp * 26 + 14;
    ctx.save();
    ctx.translate(tx, 14);
    ctx.scale(beat, beat);
    heartPath(0, 0, 14);
    ctx.fillStyle = threatColor;
    ctx.fill();
    ctx.restore();
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = threatColor;
    ctx.fillText(threatText, tx + 14, 14);

    // floor / timer
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(230,240,255,0.9)';
    const timeMs = Math.round(sim.runTime * 1000);
    ctx.fillText(`${S.floorLabel(sim.floorIndex)} · ${formatClock(timeMs)}${sim.mode === 'daily' ? ' · 오늘의 던전' : ''}`, w / 2, 20);
    // objective
    if (hud.objective) {
      ctx.textAlign = hud.touch ? 'center' : 'right';
      ctx.font = `600 12px ${FONT}`;
      const keyish = p.hasKey || f.exitUnlocked;
      ctx.fillStyle = f.exitHoldT > 0 ? rgba(COLORS.exit, 0.95) : keyish ? rgba(COLORS.exit, 0.85) : rgba(COLORS.key, 0.85);
      ctx.fillText(f.exitHoldT > 0 ? S.objective.escaping : hud.objective, hud.touch ? w / 2 : w - 18, hud.touch ? 40 : 20);
    }
    // message log (under hearts)
    ctx.textAlign = 'left';
    ctx.font = `500 13px ${FONT}`;
    let my = 44;
    for (const m of hud.messages) {
      const a = clamp(m.t / 0.6, 0, 1);
      ctx.fillStyle = 'rgba(6,10,18,0.55)';
      const tw = ctx.measureText(m.text).width + 16;
      ctx.beginPath();
      ctx.roundRect(12, my - 11, tw, 22, 6);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle = MSG_COLORS[m.kind];
      ctx.fillText(m.text, 20, my);
      ctx.globalAlpha = 1;
      my += 26;
    }
    // silencer bar
    if (p.silencerT > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(w / 2 - 60, 34, 120, 5);
      ctx.fillStyle = rgba(COLORS.item, 0.9);
      ctx.fillRect(w / 2 - 60, 34, 120 * (p.silencerT / 12), 5);
      ctx.fillStyle = 'rgba(200,220,255,0.8)';
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`소음기 ${Math.ceil(p.silencerT)}초`, w / 2, 47);
    }
    // items + pulse bar (desktop)
    if (!hud.touch) {
      const slotW = 74;
      const total = ITEM_KINDS.length * slotW;
      const x0 = w / 2 - total / 2;
      const y = h - 34;
      ITEM_KINDS.forEach((k, i) => {
        const x = x0 + i * slotW;
        const n = p.inv[k];
        ctx.fillStyle = n > 0 ? 'rgba(20,28,40,0.75)' : 'rgba(20,28,40,0.4)';
        ctx.strokeStyle = n > 0 ? rgba(COLORS.item, 0.5) : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x + 4, y - 16, slotW - 8, 32, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = n > 0 ? 'rgba(230,240,255,0.95)' : 'rgba(255,255,255,0.3)';
        ctx.font = `600 12px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(`${i + 1}`, x + 12, y - 5);
        ctx.font = `12px ${FONT}`;
        ctx.fillText(S.itemName[k], x + 12, y + 8);
        ctx.textAlign = 'right';
        ctx.font = `700 14px ${FONT}`;
        ctx.fillText(String(n), x + slotW - 12, y + 1);
      });
      // pulse readiness
      const ready = p.pulseCd <= 0;
      const frac = ready ? 1 : 1 - p.pulseCd / PLAYER.pulseCooldown;
      const bx = x0 + total + 10;
      ctx.fillStyle = 'rgba(20,28,40,0.6)';
      ctx.beginPath();
      ctx.roundRect(bx, y - 16, 96, 32, 6);
      ctx.fill();
      ctx.strokeStyle = ready ? rgba(this.pulseColor(), 0.7) : 'rgba(255,255,255,0.15)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(bx + 8, y + 6, 80, 4);
      ctx.fillStyle = rgba(this.pulseColor(), ready ? 0.95 : 0.6);
      ctx.fillRect(bx + 8, y + 6, 80 * frac, 4);
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = ready ? rgba(this.pulseColor(), 0.95) : 'rgba(200,220,255,0.6)';
      ctx.fillText(`Space · ${ready ? S.pulseReady : S.pulseCharging}`, bx + 8, y - 5);
    }
    // compass
    if (hud.compassAngle !== null) {
      const cx = w / 2 + Math.cos(hud.compassAngle) * Math.min(w, h) * 0.4;
      const cy = h / 2 + Math.sin(hud.compassAngle) * Math.min(w, h) * 0.4;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(hud.compassAngle);
      ctx.fillStyle = rgba(COLORS.exit, 0.7);
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, -6);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // hint
    if (hud.hint) {
      ctx.textAlign = 'center';
      const y = hud.touch ? 66 : h - 74;
      ctx.font = `13px ${FONT}`;
      const tw = ctx.measureText(hud.hint).width + 28;
      ctx.fillStyle = 'rgba(8,12,20,0.78)';
      ctx.beginPath();
      ctx.roundRect(w / 2 - tw / 2, y - 14, tw, 28, 14);
      ctx.fill();
      ctx.strokeStyle = rgba(this.pulseColor(), 0.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(230,240,255,0.95)';
      ctx.fillText(hud.hint, w / 2, y);
    }
  }
}
