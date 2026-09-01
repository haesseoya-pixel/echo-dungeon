import type { ItemKind } from '@/config';
import { ITEM_KINDS } from '@/config';

export interface InputState {
  moveX: number;
  moveY: number;
  sneak: boolean;
  /** edge-triggered: true for the tick in which the key went down */
  pulse: boolean;
  item: ItemKind | null;
  pause: boolean;
  /** world-space aim point (set by renderer from mouse), may be null on touch */
  aimX: number | null;
  aimY: number | null;
  confirm: boolean;
  debug: boolean;
  any: boolean;
}

const KEY_MOVE: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const KEY_ITEM: Record<string, ItemKind> = { Digit1: 'stone', Digit2: 'flare', Digit3: 'silencer', Digit4: 'bandage', Numpad1: 'stone', Numpad2: 'flare', Numpad3: 'silencer', Numpad4: 'bandage' };

/** Keyboard + mouse + virtual (touch) input merged into a per-tick snapshot. */
export class Input {
  private down = new Set<string>();
  private pulseQueued = false;
  private itemQueued: ItemKind | null = null;
  private pauseQueued = false;
  private confirmQueued = false;
  private debugQueued = false;
  private anyQueued = false;
  mouseX = 0;
  mouseY = 0;
  mouseInside = false;
  // touch overrides
  touchMoveX = 0;
  touchMoveY = 0;
  touchActive = false;
  touchSneakToggle = false;
  lastFacingX = 1;
  lastFacingY = 0;
  onFirstGesture: (() => void) | null = null;
  private gestured = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      this.gesture();
      if (e.repeat) {
        if (KEY_MOVE[e.code] || e.code === 'Space') e.preventDefault();
        return;
      }
      this.anyQueued = true;
      if (KEY_MOVE[e.code]) {
        this.down.add(e.code);
        e.preventDefault();
      } else if (e.code === 'Space') {
        this.pulseQueued = true;
        e.preventDefault();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.down.add('Shift');
      } else if (KEY_ITEM[e.code]) {
        this.itemQueued = KEY_ITEM[e.code]!;
      } else if (e.code === 'Escape') {
        this.pauseQueued = true;
      } else if (e.code === 'Enter') {
        this.confirmQueued = true;
      } else if (e.code === 'F3') {
        this.debugQueued = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (KEY_MOVE[e.code]) this.down.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.down.delete('Shift');
    });
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = target.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      this.mouseInside = true;
    });
    target.addEventListener('pointerleave', () => {
      this.mouseInside = false;
    });
    target.addEventListener('pointerdown', (e) => {
      this.gesture();
      if (e.pointerType === 'touch') return;
      if (e.button === 0) {
        this.pulseQueued = true;
        this.anyQueued = true;
      }
      if (e.button === 2) this.itemQueued = 'stone';
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private gesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.onFirstGesture?.();
  }

  queuePulse(): void {
    this.pulseQueued = true;
    this.anyQueued = true;
    this.gesture();
  }
  queueItem(k: ItemKind): void {
    this.itemQueued = k;
    this.gesture();
  }
  queuePause(): void {
    this.pauseQueued = true;
  }
  queueConfirm(): void {
    this.confirmQueued = true;
    this.anyQueued = true;
  }

  /** Consumes edge-triggered inputs and returns the snapshot for this tick. */
  poll(): InputState {
    let mx = 0;
    let my = 0;
    for (const code of this.down) {
      const v = KEY_MOVE[code];
      if (v) {
        mx += v[0];
        my += v[1];
      }
    }
    let sneak = this.down.has('Shift');
    if (this.touchActive) {
      mx = this.touchMoveX;
      my = this.touchMoveY;
      const mag = Math.hypot(mx, my);
      if (mag > 1) {
        mx /= mag;
        my /= mag;
      }
      if (mag > 0.05 && mag < 0.5) sneak = true;
      if (mag > 0.05 && mag < 1) {
        mx /= Math.max(mag, 0.5);
        my /= Math.max(mag, 0.5);
      }
    } else {
      const l = Math.hypot(mx, my);
      if (l > 1) {
        mx /= l;
        my /= l;
      }
    }
    if (this.touchSneakToggle) sneak = true;
    if (mx !== 0 || my !== 0) {
      const l = Math.hypot(mx, my) || 1;
      this.lastFacingX = mx / l;
      this.lastFacingY = my / l;
    }
    const s: InputState = {
      moveX: mx,
      moveY: my,
      sneak,
      pulse: this.pulseQueued,
      item: this.itemQueued,
      pause: this.pauseQueued,
      aimX: null,
      aimY: null,
      confirm: this.confirmQueued,
      debug: this.debugQueued,
      any: this.anyQueued,
    };
    this.pulseQueued = false;
    this.itemQueued = null;
    this.pauseQueued = false;
    this.confirmQueued = false;
    this.debugQueued = false;
    this.anyQueued = false;
    return s;
  }

  static isItem(k: string): k is ItemKind {
    return (ITEM_KINDS as readonly string[]).includes(k);
  }
}
