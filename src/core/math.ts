export const TAU = Math.PI * 2;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const expDecay = (a: number, b: number, rate: number, dt: number): number => b + (a - b) * Math.exp(-rate * dt);
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax: number, ay: number, bx: number, by: number): number => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInQuad = (t: number): number => clamp(t, 0, 1) * clamp(t, 0, 1);
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function normalize(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? [x / l, y / l] : [0, 0];
}
export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`;
}
