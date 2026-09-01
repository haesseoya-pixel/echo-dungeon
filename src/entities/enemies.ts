import { COLORS, ENEMY, NOISE, SONAR, TILE, type Difficulty } from '@/config';
import { clamp, dist } from '@/core/math';
import type { Rng } from '@/core/rng';
import { findPath } from '@/world/astar';
import type { EnemySpawn } from '@/world/dungeon';
import type { Grid } from '@/world/grid';
import { hasLOS } from '@/world/los';
import { hearIntensity, type NoiseEvent, type NoiseSystem } from '@/world/noise';
import type { PulseSystem } from '@/sim/pulses';
import { resolveCircle } from './collision';
import type { Enemy, FloorEvent } from './types';

export interface EnemyContext {
  grid: Grid;
  t: number;
  dt: number;
  player: { x: number; y: number; r: number; dead: boolean };
  noises: NoiseEvent[];
  diff: Difficulty;
  rng: Rng;
  events: FloorEvent[];
  noiseOut: NoiseSystem;
  pulses: PulseSystem;
  budget: { astar: number };
  ripple: (x: number, y: number, maxRTiles: number, color: readonly [number, number, number], alpha: number) => void;
}

let nextId = 1;

export function createEnemy(spawn: EnemySpawn, rng: Rng): Enemy {
  const kind = spawn.kind;
  const r = kind === 'hunter' ? ENEMY.hunter.r : kind === 'bat' ? ENEMY.bat.r : kind === 'spider' ? ENEMY.spider.r : ENEMY.predator.r;
  const x = (spawn.x + 0.5) * TILE;
  const y = (spawn.y + 0.5) * TILE;
  return {
    id: nextId++,
    kind,
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    r,
    state: kind === 'predator' ? 'SLEEP' : 'WANDER',
    stateT: 0,
    target: null,
    lastKnown: null,
    lastRefresh: -100,
    alert: 0,
    path: null,
    pathIdx: 0,
    repathT: 0,
    home: { x, y },
    timer: kind === 'bat' ? rng() * ENEMY.bat.sonarInterval : rng() * 2,
    stepT: rng(),
    hearing: kind === 'predator' ? ENEMY.predator.hearing : ENEMY.hunter.hearing,
    dead: false,
    facing: rng() * Math.PI * 2,
    awake: kind !== 'predator',
    roarT: ENEMY.predator.roarInterval,
    investigateSpeed: 0,
    seenByPulseT: -100,
  };
}

function tileOf(v: number): number {
  return Math.floor(v / TILE);
}

function stepTowards(e: Enemy, ctx: EnemyContext, tx: number, ty: number, speed: number): boolean {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) return true;
  const step = Math.min(d, speed * ctx.dt);
  const res = resolveCircle(ctx.grid, e.x, e.y, e.r, (dx / d) * step, (dy / d) * step);
  e.vx = (res.x - e.x) / ctx.dt;
  e.vy = (res.y - e.y) / ctx.dt;
  e.x = res.x;
  e.y = res.y;
  if (Math.abs(e.vx) + Math.abs(e.vy) > 1) e.facing = Math.atan2(e.vy, e.vx);
  return d <= step + 0.5;
}

/** Follows / recomputes a tile path to the target. Returns true when the target point is reached. */
function pathTo(e: Enemy, ctx: EnemyContext, tx: number, ty: number, speed: number, repathInterval: number): boolean {
  const d = dist(e.x, e.y, tx, ty);
  if (d < 6) return true;
  e.repathT -= ctx.dt;
  const goalTx = tileOf(tx);
  const goalTy = tileOf(ty);
  const needPath = !e.path || e.repathT <= 0 || e.pathIdx >= e.path.length;
  if (needPath && ctx.budget.astar > 0) {
    ctx.budget.astar--;
    e.repathT = repathInterval;
    const p = findPath(ctx.grid, tileOf(e.x), tileOf(e.y), goalTx, goalTy, 4000);
    e.path = p;
    e.pathIdx = 0;
  }
  if (e.path && e.pathIdx < e.path.length) {
    // skip waypoints we can see past
    while (e.pathIdx + 1 < e.path.length) {
      const nx = (e.path[e.pathIdx + 1]![0] + 0.5) * TILE;
      const ny = (e.path[e.pathIdx + 1]![1] + 0.5) * TILE;
      if (hasLOS(ctx.grid, e.x, e.y, nx, ny) && dist(e.x, e.y, nx, ny) < TILE * 3) e.pathIdx++;
      else break;
    }
    const wp = e.path[e.pathIdx]!;
    const wx = (wp[0] + 0.5) * TILE;
    const wy = (wp[1] + 0.5) * TILE;
    const arrived = stepTowards(e, ctx, e.pathIdx === e.path.length - 1 ? tx : wx, e.pathIdx === e.path.length - 1 ? ty : wy, speed);
    if (arrived) e.pathIdx++;
    return e.pathIdx >= e.path.length && dist(e.x, e.y, tx, ty) < 8;
  }
  // greedy fallback
  return stepTowards(e, ctx, tx, ty, speed * 0.7);
}

function randomReachableTile(e: Enemy, ctx: EnemyContext, radiusTiles: number): { x: number; y: number } | null {
  for (let i = 0; i < 12; i++) {
    const tx = tileOf(e.x) + Math.round((ctx.rng() * 2 - 1) * radiusTiles);
    const ty = tileOf(e.y) + Math.round((ctx.rng() * 2 - 1) * radiusTiles);
    if (ctx.grid.isSolid(tx, ty)) continue;
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
  return null;
}

function setState(e: Enemy, s: Enemy['state']): void {
  if (e.state !== s) {
    e.state = s;
    e.stateT = 0;
    e.path = null;
    e.repathT = 0;
  }
}

function loudestPlayerNoise(e: Enemy, ctx: EnemyContext, includeNonPlayer: boolean): { ev: NoiseEvent; I: number } | null {
  let best: { ev: NoiseEvent; I: number } | null = null;
  for (const ev of ctx.noises) {
    if (!includeNonPlayer && !ev.player) continue;
    const I = hearIntensity(ctx.grid, e.x, e.y, ev, e.hearing * ctx.diff.hearing);
    if (I > 0 && (!best || I > best.I)) best = { ev, I };
  }
  return best;
}

function stepRipples(e: Enemy, ctx: EnemyContext, interval: number, radiusTiles: number, color: readonly [number, number, number], eventKind: FloorEvent['kind']): void {
  const moving = Math.abs(e.vx) + Math.abs(e.vy) > 5;
  if (!moving) return;
  e.stepT += ctx.dt;
  if (e.stepT >= interval) {
    e.stepT = 0;
    ctx.ripple(e.x, e.y, radiusTiles, color, 0.5);
    ctx.events.push({ kind: eventKind, x: e.x, y: e.y });
  }
}

function updateHunter(e: Enemy, ctx: EnemyContext): void {
  const H = ENEMY.hunter;
  const p = ctx.player;
  const dP = dist(e.x, e.y, p.x, p.y);
  e.stateT += ctx.dt;
  e.alert = Math.max(0, e.alert - 0.2 * ctx.dt);
  const heard = loudestPlayerNoise(e, ctx, true);
  const playerHeard = heard && heard.ev.player ? heard : null;

  if (e.state === 'STUNNED') {
    if (e.stateT >= H.stun) setState(e, 'SEARCH');
    return;
  }

  // proximity sense (sneaking does not prevent it)
  if (!p.dead && dP <= H.senseR * TILE && hasLOS(ctx.grid, e.x, e.y, p.x, p.y)) {
    if (e.state !== 'CHASE') {
      setState(e, 'CHASE');
      ctx.events.push({ kind: 'growl', x: e.x, y: e.y });
    }
    e.target = { x: p.x, y: p.y };
    e.lastRefresh = ctx.t;
  }

  if (e.state !== 'CHASE' && heard) {
    e.alert += heard.I;
    if (heard.I >= H.chaseI && dist(e.x, e.y, heard.ev.x, heard.ev.y) <= H.chaseD * TILE && heard.ev.player) {
      setState(e, 'CHASE');
      e.target = { x: heard.ev.x, y: heard.ev.y };
      e.lastRefresh = ctx.t;
      ctx.events.push({ kind: 'growl', x: e.x, y: e.y });
    } else if (heard.I >= H.investigateI) {
      const wasInvestigating = e.state === 'INVESTIGATE';
      setState(e, 'INVESTIGATE');
      e.target = { x: heard.ev.x, y: heard.ev.y };
      e.investigateSpeed = H.investigate + H.investigateBoost * clamp(heard.I, 0, 1);
      if (!wasInvestigating) ctx.events.push({ kind: 'huff', x: e.x, y: e.y });
    }
  } else if (e.state === 'CHASE' && playerHeard) {
    // stone decoys only work once the player has gone quiet for a second
    e.target = { x: playerHeard.ev.x, y: playerHeard.ev.y };
    e.lastRefresh = ctx.t;
  } else if (e.state === 'CHASE' && heard && !heard.ev.player && heard.ev.source === 'stone' && ctx.t - e.lastRefresh > 1.0) {
    setState(e, 'INVESTIGATE');
    e.target = { x: heard.ev.x, y: heard.ev.y };
    e.investigateSpeed = H.investigate + H.investigateBoost;
  }

  switch (e.state) {
    case 'WANDER': {
      if (!e.target) {
        e.timer -= ctx.dt;
        if (e.timer <= 0) {
          e.target = randomReachableTile(e, ctx, 8);
          e.timer = 1 + ctx.rng();
        }
        e.vx = e.vy = 0;
      } else if (pathTo(e, ctx, e.target.x, e.target.y, H.wander, 1.0)) {
        e.target = null;
        e.vx = e.vy = 0;
      }
      break;
    }
    case 'INVESTIGATE': {
      if (!e.target || pathTo(e, ctx, e.target.x, e.target.y, e.investigateSpeed || H.investigate, 1.0)) {
        setState(e, 'SEARCH');
        e.lastKnown = e.target;
        e.target = null;
      }
      break;
    }
    case 'CHASE': {
      const t = e.target ?? { x: p.x, y: p.y };
      pathTo(e, ctx, t.x, t.y, ctx.diff.chaseSpeed, 0.5);
      const since = ctx.t - e.lastRefresh;
      if ((since > H.lose && dP > H.loseD * TILE) || since > H.hardCap) {
        e.lastKnown = e.target;
        setState(e, 'SEARCH');
        e.target = null;
      }
      break;
    }
    case 'SEARCH': {
      if (!e.target) {
        const base = e.lastKnown ?? { x: e.x, y: e.y };
        const tx = base.x + (ctx.rng() * 2 - 1) * 2 * TILE;
        const ty = base.y + (ctx.rng() * 2 - 1) * 2 * TILE;
        e.target = ctx.grid.isSolid(tileOf(tx), tileOf(ty)) ? { x: base.x, y: base.y } : { x: tx, y: ty };
      } else if (pathTo(e, ctx, e.target.x, e.target.y, H.wander, 1.0)) {
        e.target = null;
      }
      if (e.stateT >= H.search) {
        setState(e, 'RETURN');
        e.target = null;
      }
      break;
    }
    case 'RETURN': {
      if (pathTo(e, ctx, e.home.x, e.home.y, H.wander, 1.0) || e.stateT > 20) {
        setState(e, 'WANDER');
        e.target = null;
      }
      break;
    }
    default:
      setState(e, 'WANDER');
  }
  stepRipples(e, ctx, H.stepInterval, 2, COLORS.hunter, 'hunterStep');
  // idle grunts when near
  if (dP < 12 * TILE) {
    e.timer -= ctx.dt * 0.35;
    if (e.state !== 'WANDER' && e.timer <= 0) {
      e.timer = 4 + ctx.rng() * 3;
      ctx.events.push({ kind: 'grunt', x: e.x, y: e.y });
    }
  }
}

function updateBat(e: Enemy, ctx: EnemyContext): void {
  const B = ENEMY.bat;
  const p = ctx.player;
  e.stateT += ctx.dt;
  // sonar
  e.timer -= ctx.dt;
  if (e.timer <= 0) {
    e.timer = B.sonarInterval + (ctx.rng() * 2 - 1) * B.sonarJitter;
    ctx.pulses.emit(ctx.grid, 'bat', e.x, e.y, ctx.t, SONAR.batRays, SONAR.batRange, ctx.diff.fade * 0.7, COLORS.bat);
    ctx.noiseOut.emit({ x: e.x, y: e.y, radius: NOISE.batSonar.radius, loudness: NOISE.batSonar.loudness, source: 'bat', t: ctx.t, player: false });
    ctx.events.push({ kind: 'batSonar', x: e.x, y: e.y });
  }
  // attracted by player pulses
  for (const ev of ctx.noises) {
    if (ev.player && ev.source === 'pulse' && hearIntensity(ctx.grid, e.x, e.y, ev, 1.2) > 0) {
      setState(e, 'ATTRACTED');
      e.target = { x: ev.x, y: ev.y };
    }
  }
  // bump the player: screech and flee
  const dP = dist(e.x, e.y, p.x, p.y);
  if (!p.dead && dP < e.r + p.r && e.state !== 'FLEE') {
    setState(e, 'FLEE');
    ctx.noiseOut.emit({ x: e.x, y: e.y, radius: NOISE.screech.radius, loudness: NOISE.screech.loudness, source: 'screech', t: ctx.t, player: false });
    ctx.events.push({ kind: 'screech', x: e.x, y: e.y });
  }
  let speed: number = B.wander;
  if (e.state === 'ATTRACTED') {
    speed = B.attracted;
    if (e.stateT > B.attractTime || !e.target) setState(e, 'WANDER');
    else {
      const dx = e.target.x - e.x;
      const dy = e.target.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < TILE) setState(e, 'WANDER');
      e.facing = Math.atan2(dy, dx) + Math.sin(ctx.t * 7 + e.id) * 0.5;
    }
  } else if (e.state === 'FLEE') {
    speed = B.attracted;
    e.facing = Math.atan2(e.y - p.y, e.x - p.x) + Math.sin(ctx.t * 9) * 0.4;
    if (e.stateT > B.fleeTime) setState(e, 'WANDER');
  } else {
    e.stateT += 0;
    e.repathT -= ctx.dt;
    if (e.repathT <= 0) {
      e.repathT = B.redirect;
      e.facing += (ctx.rng() * 2 - 1) * 1.6;
    }
  }
  const dx = Math.cos(e.facing) * speed * ctx.dt;
  const dy = Math.sin(e.facing) * speed * ctx.dt;
  const res = resolveCircle(ctx.grid, e.x, e.y, e.r, dx, dy);
  if (res.hitX) e.facing = Math.PI - e.facing + (ctx.rng() - 0.5) * 0.4;
  if (res.hitY) e.facing = -e.facing + (ctx.rng() - 0.5) * 0.4;
  e.vx = (res.x - e.x) / ctx.dt;
  e.vy = (res.y - e.y) / ctx.dt;
  e.x = res.x;
  e.y = res.y;
  e.stepT += ctx.dt;
  if (e.stepT >= B.flapInterval) {
    e.stepT = 0;
    ctx.ripple(e.x, e.y, 1, COLORS.bat, 0.4);
    ctx.events.push({ kind: 'batClick', x: e.x, y: e.y });
  }
}

function updatePredator(e: Enemy, ctx: EnemyContext): void {
  const P = ENEMY.predator;
  const p = ctx.player;
  const dP = dist(e.x, e.y, p.x, p.y);
  e.stateT += ctx.dt;
  if (e.state === 'SLEEP') {
    e.timer -= ctx.dt;
    if (e.timer <= 0) {
      e.timer = P.snoreInterval;
      ctx.ripple(e.x, e.y, 3, COLORS.predator, 0.35);
    }
    for (const ev of ctx.noises) {
      const I = hearIntensity(ctx.grid, e.x, e.y, ev, e.hearing * ctx.diff.hearing);
      if (I >= P.wakeI && dist(e.x, e.y, ev.x, ev.y) <= P.wakeR * TILE) {
        e.awake = true;
        setState(e, 'INVESTIGATE');
        e.target = { x: ev.x, y: ev.y };
        ctx.events.push({ kind: 'wake', x: e.x, y: e.y });
        ctx.events.push({ kind: 'roar', x: e.x, y: e.y });
        e.roarT = P.roarInterval;
        break;
      }
    }
    return;
  }
  // roar
  e.roarT -= ctx.dt;
  if (e.roarT <= 0) {
    e.roarT = P.roarInterval;
    ctx.events.push({ kind: 'roar', x: e.x, y: e.y });
    ctx.ripple(e.x, e.y, 6, COLORS.predator, 0.7);
    ctx.noiseOut.emit({ x: e.x, y: e.y, radius: NOISE.roar.radius, loudness: NOISE.roar.loudness, source: 'roar', t: ctx.t, player: false });
    if (!p.dead && dP <= P.roarSenseR * TILE) {
      setState(e, 'CHASE');
      e.target = { x: p.x, y: p.y };
      e.lastRefresh = ctx.t + P.roarTrack; // exact tracking for a while
    }
  }
  const heard = loudestPlayerNoise(e, ctx, true);
  if (heard && heard.ev.player) {
    if (e.state !== 'CHASE') {
      if (heard.I >= 0.7 && dist(e.x, e.y, heard.ev.x, heard.ev.y) <= 4 * TILE) setState(e, 'CHASE');
      else setState(e, 'INVESTIGATE');
    }
    e.target = { x: heard.ev.x, y: heard.ev.y };
    e.lastRefresh = Math.max(e.lastRefresh, ctx.t);
  } else if (heard && e.state !== 'CHASE' && heard.ev.source === 'stone') {
    setState(e, 'INVESTIGATE');
    e.target = { x: heard.ev.x, y: heard.ev.y };
  }
  if (!p.dead && dP <= 3 * TILE && hasLOS(ctx.grid, e.x, e.y, p.x, p.y)) {
    if (e.state !== 'CHASE') setState(e, 'CHASE');
    e.target = { x: p.x, y: p.y };
    e.lastRefresh = Math.max(e.lastRefresh, ctx.t);
  }
  if (e.state === 'CHASE' && ctx.t < e.lastRefresh) e.target = { x: p.x, y: p.y };

  switch (e.state) {
    case 'CHASE': {
      const t = e.target ?? { x: p.x, y: p.y };
      pathTo(e, ctx, t.x, t.y, P.chase, 0.5);
      if (ctx.t - e.lastRefresh > P.lose) {
        setState(e, 'INVESTIGATE');
        e.target = e.target ? { ...e.target } : null;
      }
      break;
    }
    case 'INVESTIGATE': {
      if (!e.target || pathTo(e, ctx, e.target.x, e.target.y, P.investigate, 1.0)) {
        setState(e, 'WANDER');
        e.target = null;
      }
      break;
    }
    default: {
      if (!e.target) {
        e.timer -= ctx.dt;
        if (e.timer <= 0) {
          e.target = randomReachableTile(e, ctx, 10);
          e.timer = 1.5 + ctx.rng() * 2;
        }
        e.vx = e.vy = 0;
      } else if (pathTo(e, ctx, e.target.x, e.target.y, P.wander, 1.0)) {
        e.target = null;
      }
    }
  }
  stepRipples(e, ctx, P.stepInterval, 4, COLORS.predator, 'predatorStep');
}

export function updateEnemy(e: Enemy, ctx: EnemyContext): void {
  if (e.dead) return;
  e.px = e.x;
  e.py = e.y;
  switch (e.kind) {
    case 'hunter':
      updateHunter(e, ctx);
      break;
    case 'bat':
      updateBat(e, ctx);
      break;
    case 'predator':
      updatePredator(e, ctx);
      break;
    case 'spider':
      break;
  }
}

export function stunEnemy(e: Enemy): void {
  if (e.kind === 'hunter') {
    e.state = 'STUNNED';
    e.stateT = 0;
    e.vx = e.vy = 0;
  }
}

export const HUNTER_STEP_INTERVAL = ENEMY.hunter.stepInterval;
