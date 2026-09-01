import { TILE } from '@/config';

/**
 * Web Audio synthesis for every cue in the game. No audio assets.
 * Spatial cues take a world offset relative to the player for panning, distance gain and wall muffling.
 */
export class Audio {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private brownBuf: AudioBuffer | null = null;
  private heartTimer = 0;
  private ambientStarted = false;
  volume = 0.7;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    const sfx = ctx.createGain();
    const amb = ctx.createGain();
    amb.gain.value = 0;
    sfx.connect(master);
    amb.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.sfx = sfx;
    this.ambientGain = amb;
    if (ctx.state === 'suspended') void ctx.resume();
    // iOS: play a silent buffer to fully unlock
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private noise(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this.noiseBuf) {
      const len = ctx.sampleRate * 2;
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    return this.noiseBuf;
  }

  private brown(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this.brownBuf) {
      const len = ctx.sampleRate * 3;
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
      this.brownBuf = b;
    }
    return this.brownBuf;
  }

  /** Builds pan/gain/lowpass chain for a sound located dx,dy px from the player behind `walls` walls. */
  private spatialChain(dx: number, dy: number, walls: number, maxTiles = 12): { node: AudioNode; gain: number } | null {
    const ctx = this.ctx;
    const out = this.sfx;
    if (!ctx || !out) return null;
    const d = Math.hypot(dx, dy) / TILE;
    if (d > maxTiles) return null;
    const g = Math.pow(1 - d / maxTiles, 2) * Math.pow(0.55, walls);
    if (g < 0.01) return null;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, dx / (8 * TILE)));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(300, 4000 * Math.pow(0.45, walls) * (1 - d / (maxTiles * 1.5)));
    lp.connect(pan);
    pan.connect(out);
    return { node: lp, gain: g };
  }

  private tone(dest: AudioNode | null, o: { type: OscillatorType; f: number; fEnd?: number; start?: number; a?: number; d: number; g: number; lp?: number; lpEnd?: number; detune?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !dest) return;
    const t0 = ctx.currentTime + (o.start ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.detune) osc.detune.value = o.detune;
    const total = (o.a ?? 0.005) + o.d;
    if (o.fEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.fEnd), t0 + total);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g), t0 + (o.a ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + total);
    let node: AudioNode = osc;
    if (o.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(o.lp, t0);
      if (o.lpEnd) lp.frequency.exponentialRampToValueAtTime(o.lpEnd, t0 + total);
      osc.connect(lp);
      node = lp;
    }
    node.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + total + 0.05);
  }

  private burst(dest: AudioNode | null, o: { start?: number; d: number; g: number; filter?: BiquadFilterType; f?: number; fEnd?: number; q?: number; brown?: boolean; rate?: number }): void {
    const ctx = this.ctx;
    if (!ctx || !dest) return;
    const t0 = ctx.currentTime + (o.start ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? this.brown() : this.noise();
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.d);
    let node: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.f ?? 1000, t0);
      if (o.fEnd) f.frequency.exponentialRampToValueAtTime(o.fEnd, t0 + o.d);
      if (o.q) f.Q.value = o.q;
      src.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest);
    src.start(t0);
    src.stop(t0 + o.d + 0.05);
  }

  // ---- player cues ---------------------------------------------------------
  ping(): void {
    this.tone(this.sfx, { type: 'sine', f: 880, fEnd: 440, d: 0.35, g: 0.22, lp: 3000 });
    this.tone(this.sfx, { type: 'sine', f: 1320, d: 0.12, g: 0.05 });
  }
  touchPulse(): void {
    this.tone(this.sfx, { type: 'sine', f: 660, fEnd: 500, d: 0.1, g: 0.04 });
  }
  step(sneak: boolean): void {
    this.burst(this.sfx, { d: 0.08, g: sneak ? 0.05 : 0.14, filter: 'bandpass', f: sneak ? 180 : 300, q: 1, rate: 0.9 + Math.random() * 0.2 });
  }
  throwStone(): void {
    this.burst(this.sfx, { d: 0.06, g: 0.08, filter: 'highpass', f: 800, fEnd: 3000 });
  }
  pickup(): void {
    this.tone(this.sfx, { type: 'sine', f: 1200, fEnd: 1800, d: 0.08, g: 0.12 });
  }
  key(): void {
    this.tone(this.sfx, { type: 'sine', f: 880, d: 0.3, g: 0.12 });
    this.tone(this.sfx, { type: 'sine', f: 1320, start: 0.05, d: 0.3, g: 0.1 });
  }
  hit(): void {
    this.burst(this.sfx, { d: 0.25, g: 0.5, filter: 'lowpass', f: 1200 });
    this.tone(this.sfx, { type: 'sawtooth', f: 120, fEnd: 40, d: 0.3, g: 0.4, lp: 600 });
  }
  death(): void {
    this.tone(this.sfx, { type: 'sawtooth', f: 90, fEnd: 30, d: 1.4, g: 0.35, lp: 500, lpEnd: 100 });
    this.burst(this.sfx, { d: 1.2, g: 0.3, filter: 'lowpass', f: 600, fEnd: 80, brown: true });
  }
  stairs(): void {
    [440, 554, 659, 880].forEach((f, i) => this.tone(this.sfx, { type: 'triangle', f, start: i * 0.12, d: 0.35, g: 0.12 }));
  }
  locked(): void {
    this.tone(this.sfx, { type: 'square', f: 140, d: 0.08, g: 0.08, lp: 700 });
    this.tone(this.sfx, { type: 'square', f: 110, start: 0.1, d: 0.12, g: 0.08, lp: 600 });
  }
  flare(): void {
    this.burst(this.sfx, { d: 0.6, g: 0.3, filter: 'highpass', f: 200, fEnd: 4000 });
    this.tone(this.sfx, { type: 'sine', f: 1500, fEnd: 900, d: 0.5, g: 0.1 });
  }
  bandage(): void {
    this.burst(this.sfx, { d: 0.25, g: 0.07, filter: 'bandpass', f: 1500, q: 0.7 });
    this.tone(this.sfx, { type: 'sine', f: 520, fEnd: 780, start: 0.1, d: 0.25, g: 0.08 });
  }
  silencer(): void {
    this.tone(this.sfx, { type: 'sine', f: 600, fEnd: 200, d: 0.4, g: 0.1, lp: 1200 });
  }
  denied(): void {
    this.tone(this.sfx, { type: 'square', f: 200, d: 0.06, g: 0.05, lp: 900 });
  }
  ui(): void {
    this.tone(this.sfx, { type: 'sine', f: 1000, d: 0.03, g: 0.05 });
  }
  win(): void {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(this.sfx, { type: 'triangle', f, start: i * 0.13, d: 0.6, g: 0.12 }));
  }

  // ---- spatial enemy / world cues ------------------------------------------
  growl(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 14);
    if (!c) return;
    this.tone(c.node, { type: 'sawtooth', f: 75, fEnd: 60, d: 0.5, g: 0.35 * c.gain, lp: 400 });
    this.burst(c.node, { d: 0.4, g: 0.12 * c.gain, filter: 'lowpass', f: 300, brown: true });
  }
  huff(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls);
    if (!c) return;
    this.burst(c.node, { d: 0.15, g: 0.18 * c.gain, filter: 'bandpass', f: 500, q: 1.2 });
  }
  grunt(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls);
    if (!c) return;
    this.tone(c.node, { type: 'sawtooth', f: 95, fEnd: 70, d: 0.18, g: 0.14 * c.gain, lp: 350 });
  }
  hunterStep(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 10);
    if (!c) return;
    this.burst(c.node, { d: 0.07, g: 0.12 * c.gain, filter: 'bandpass', f: 220, q: 1 });
  }
  batClick(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 9);
    if (!c) return;
    for (let i = 0; i < 3; i++) this.tone(c.node, { type: 'square', f: 2500, start: i * 0.06, d: 0.015, g: 0.05 * c.gain });
  }
  batSonar(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 12);
    if (!c) return;
    this.tone(c.node, { type: 'sine', f: 3000, fEnd: 1500, d: 0.2, g: 0.12 * c.gain });
  }
  screech(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 12);
    if (!c) return;
    this.tone(c.node, { type: 'sawtooth', f: 2200, fEnd: 3200, d: 0.25, g: 0.14 * c.gain, lp: 5000 });
  }
  roar(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 20);
    if (!c) return;
    this.tone(c.node, { type: 'sawtooth', f: 45, fEnd: 38, d: 0.9, g: 0.5 * c.gain, lp: 250 });
    this.burst(c.node, { d: 0.9, g: 0.25 * c.gain, filter: 'lowpass', f: 200, brown: true });
  }
  predatorStep(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 16);
    if (!c) return;
    this.tone(c.node, { type: 'sine', f: 40, d: 0.2, g: 0.35 * c.gain });
  }
  stoneLand(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 14);
    if (!c) return;
    this.burst(c.node, { d: 0.04, g: 0.25 * c.gain, filter: 'highpass', f: 1500 });
    this.tone(c.node, { type: 'sine', f: 200, fEnd: 120, d: 0.15, g: 0.15 * c.gain });
  }
  trap(dx: number, dy: number, walls: number): void {
    this.burst(this.sfx, { d: 0.08, g: 0.3, filter: 'highpass', f: 1000 });
    this.tone(this.sfx, { type: 'square', f: 3000, d: 0.05, g: 0.08 });
    this.growl(dx, dy, walls);
  }
  exitHum(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 12);
    if (!c) return;
    this.tone(c.node, { type: 'sine', f: 110, d: 0.9, a: 0.2, g: 0.14 * c.gain });
    this.tone(c.node, { type: 'sine', f: 165, d: 0.9, a: 0.25, g: 0.07 * c.gain });
  }
  keyChime(dx: number, dy: number, walls: number): void {
    const c = this.spatialChain(dx, dy, walls, 10);
    if (!c) return;
    this.tone(c.node, { type: 'sine', f: 1760, d: 0.35, g: 0.08 * c.gain });
    this.tone(c.node, { type: 'sine', f: 2637, start: 0.08, d: 0.3, g: 0.05 * c.gain });
  }

  // ---- heartbeat & ambience ------------------------------------------------
  /** Call every tick during a run with the nearest threat distance in tiles. */
  heartbeat(dt: number, nearestTiles: number, chase: boolean, active: boolean): void {
    if (!active || !this.ready) {
      this.heartTimer = 0;
      return;
    }
    let interval: number;
    let vol: number;
    if (nearestTiles > 10) {
      interval = 1.4;
      vol = 0.08;
    } else {
      const d = Math.max(0, nearestTiles) / 10;
      interval = 0.35 + 0.85 * Math.pow(d, 1.3);
      vol = 0.15 + 0.6 * (1 - d);
    }
    if (chase) vol += 0.1;
    this.heartTimer -= dt;
    if (this.heartTimer <= 0) {
      this.heartTimer = interval;
      this.tone(this.sfx, { type: 'sine', f: 55, d: 0.12, g: vol * 0.8 });
      this.tone(this.sfx, { type: 'sine', f: 50, start: 0.14, d: 0.14, g: vol * 0.6 });
    }
  }

  startAmbience(): void {
    const ctx = this.ctx;
    const amb = this.ambientGain;
    if (!ctx || !amb || this.ambientStarted) return;
    this.ambientStarted = true;
    for (const f of [55, 55.5]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.03;
      o.connect(g);
      g.connect(amb);
      o.start();
    }
    const src = ctx.createBufferSource();
    src.buffer = this.brown();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const g = ctx.createGain();
    g.gain.value = 0.02;
    src.connect(lp);
    lp.connect(g);
    g.connect(amb);
    src.start();
  }

  setAmbience(on: boolean): void {
    if (!this.ctx || !this.ambientGain) return;
    if (on) this.startAmbience();
    this.ambientGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 1.0);
  }
}
