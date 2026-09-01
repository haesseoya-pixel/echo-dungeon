import type { ItemKind } from '@/config';
import type { EnemyKind } from '@/world/dungeon';

export type EnemyState = 'WANDER' | 'INVESTIGATE' | 'CHASE' | 'SEARCH' | 'RETURN' | 'STUNNED' | 'SLEEP' | 'ATTRACTED' | 'FLEE';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  state: EnemyState;
  stateT: number;
  target: { x: number; y: number } | null;
  lastKnown: { x: number; y: number } | null;
  lastRefresh: number;
  alert: number;
  path: [number, number][] | null;
  pathIdx: number;
  repathT: number;
  home: { x: number; y: number };
  timer: number;
  stepT: number;
  hearing: number;
  dead: boolean;
  facing: number;
  awake: boolean;
  roarT: number;
  investigateSpeed: number;
  seenByPulseT: number;
}

export interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  taken: boolean;
}

export interface Stone {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  travelled: number;
  maxDist: number;
  alive: boolean;
}

export type PulseOwner = 'player' | 'bat' | 'flare' | 'touch';

export interface Pulse {
  x: number;
  y: number;
  t0: number;
  speed: number;
  range: number;
  fade: number;
  n: number;
  hits: Float32Array;
  runs: Uint16Array;
  color: readonly [number, number, number];
  owner: PulseOwner;
  revealed: Set<number>;
  expired: boolean;
}

export interface Ripple {
  x: number;
  y: number;
  t0: number;
  maxR: number;
  speed: number;
  alpha0: number;
  color: readonly [number, number, number];
  wallAtten: number;
  width: number;
}

export type BlipKind = 'hunter' | 'bat' | 'predator' | 'spider' | 'web' | 'item' | 'key' | 'exit' | 'stone';

export interface Blip {
  kind: BlipKind;
  x: number;
  y: number;
  t0: number;
  life: number;
  persistent: boolean;
  ref: number;
  label?: string;
}

export type FloorEventKind =
  | 'pulse'
  | 'touchPulse'
  | 'step'
  | 'sneakStep'
  | 'pickup'
  | 'key'
  | 'hit'
  | 'death'
  | 'exit'
  | 'locked'
  | 'trap'
  | 'growl'
  | 'huff'
  | 'grunt'
  | 'batSonar'
  | 'batClick'
  | 'screech'
  | 'roar'
  | 'predatorStep'
  | 'wake'
  | 'throw'
  | 'land'
  | 'flare'
  | 'bandage'
  | 'silencer'
  | 'hunterStep'
  | 'noItem'
  | 'exitHum'
  | 'keyChime';

export interface FloorEvent {
  kind: FloorEventKind;
  x: number;
  y: number;
  data?: number | string;
}
