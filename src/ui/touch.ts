import { ITEM_KINDS, type ItemKind } from '@/config';
import type { Input } from '@/core/input';
import { S } from '@/strings.ko';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Virtual joystick + buttons for touch devices. */
export class TouchControls {
  private root: HTMLElement;
  private joy: HTMLElement;
  private knob: HTMLElement;
  private sneakBtn: HTMLElement;
  private itemBtns: Record<ItemKind, HTMLElement>;
  private joyPointer: number | null = null;
  private joyCx = 0;
  private joyCy = 0;
  visible = false;

  constructor(root: HTMLElement, private input: Input, private onPause: () => void) {
    this.root = root;
    this.joy = el('div', 'joy');
    this.knob = el('div', 'knob');
    this.joy.append(this.knob);
    const pulse = el('div', 'tbtn pulse', '펄스');
    this.sneakBtn = el('div', 'tbtn sneak', '살금');
    const pause = el('div', 'tbtn pause', 'II');
    this.itemBtns = {} as Record<ItemKind, HTMLElement>;
    ITEM_KINDS.forEach((k, i) => {
      const b = el('div', 'tbtn item empty', `<span>${S.itemName[k]}</span><small>0</small>`);
      b.style.right = `${28 + (ITEM_KINDS.length - 1 - i) * 58}px`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.queueItem(k);
      });
      this.itemBtns[k] = b;
      root.append(b);
    });
    root.append(this.joy, pulse, this.sneakBtn, pause);

    const joyMove = (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointer) return;
      const dx = e.clientX - this.joyCx;
      const dy = e.clientY - this.joyCy;
      const R = 60;
      let mx = dx / R;
      let my = dy / R;
      const mag = Math.hypot(mx, my);
      if (mag > 1) {
        mx /= mag;
        my /= mag;
      }
      const dead = 0.15;
      if (mag < dead) {
        mx = 0;
        my = 0;
      }
      input.touchMoveX = mx;
      input.touchMoveY = my;
      input.touchActive = true;
      this.knob.style.transform = `translate(${mx * R}px, ${my * R}px)`;
    };
    this.joy.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.joyPointer !== null) return;
      this.joyPointer = e.pointerId;
      const r = this.joy.getBoundingClientRect();
      this.joyCx = r.left + r.width / 2;
      this.joyCy = r.top + r.height / 2;
      this.joy.setPointerCapture(e.pointerId);
      joyMove(e);
    });
    this.joy.addEventListener('pointermove', joyMove);
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointer) return;
      this.joyPointer = null;
      input.touchMoveX = 0;
      input.touchMoveY = 0;
      this.knob.style.transform = '';
    };
    this.joy.addEventListener('pointerup', joyEnd);
    this.joy.addEventListener('pointercancel', joyEnd);
    pulse.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.queuePulse();
    });
    this.sneakBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.touchSneakToggle = !input.touchSneakToggle;
      this.sneakBtn.classList.toggle('on', input.touchSneakToggle);
    });
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPause();
    });
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.hidden = !v;
    this.input.touchActive = v;
    if (!v) {
      this.input.touchMoveX = 0;
      this.input.touchMoveY = 0;
      this.input.touchSneakToggle = false;
      this.sneakBtn.classList.remove('on');
    }
  }

  updateInventory(inv: Record<ItemKind, number>): void {
    for (const k of ITEM_KINDS) {
      const b = this.itemBtns[k];
      const small = b.querySelector('small');
      if (small && small.textContent !== String(inv[k])) small.textContent = String(inv[k]);
      b.classList.toggle('empty', inv[k] <= 0);
    }
  }
}
