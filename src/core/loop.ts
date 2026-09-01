import { MAX_STEPS_PER_FRAME, STEP } from '@/config';

export interface LoopCallbacks {
  update: (dt: number) => void;
  render: (alpha: number, dtFrame: number, ts: number) => void;
}

/** Fixed-timestep loop with interpolation alpha for rendering. */
export class Loop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  running = false;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (ts: number) => {
      if (!this.running) return;
      let frame = (ts - this.last) / 1000;
      this.last = ts;
      if (frame > 0.25) frame = 0.25;
      if (frame < 0) frame = 0;
      this.acc += frame;
      let steps = 0;
      try {
        while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
          this.cb.update(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
        this.cb.render(this.acc / STEP, frame, ts);
      } catch (err) {
        // never let one bad frame kill the game loop
        console.error('[loop] frame failed', err);
        this.acc = 0;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Resets timing after a pause so no giant frame is accumulated. */
  resync(): void {
    this.last = performance.now();
    this.acc = 0;
  }
}
