import './styles.css';
import { Audio } from './audio/audio';
import { ITEM_KINDS, WIN_FLOOR, type ItemKind } from './config';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { localDateString } from './core/rng';
import { getPlayerName, submitScore } from './rank/leaderboard';
import { Renderer, type HudState } from './render/renderer';
import { getLocalStorage, load, save as saveToStorage, type SaveV1 } from './save/storage';
import { grantUnlocks } from './save/unlocks';
import { GameSim, type SimEvent } from './sim/game';
import { S } from './strings.ko';
import { Screens } from './ui/screens';
import { TouchControls } from './ui/touch';
import { wallsBetween } from './world/los';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const touchRoot = document.getElementById('touch') as HTMLElement;
const storage = getLocalStorage();
const data: SaveV1 = load(storage);
const persist = () => saveToStorage(storage, data);

const coarse = matchMedia('(pointer: coarse)').matches;
const touchWanted = () => data.settings.touch === 'on' || (data.settings.touch === 'auto' && coarse);

const input = new Input(canvas);
const audio = new Audio();
audio.volume = data.settings.volume;
const sim = new GameSim({ mobile: coarse, unlocks: new Set(data.unlocks), palette: data.settings.palette });
const renderer = new Renderer(canvas, input);
renderer.shakeEnabled = data.settings.shake;
renderer.palette = data.settings.palette;
const hud: HudState = { hint: null, toast: null, toastT: 0, debug: false, compassAngle: null, touch: false };
let audioUnlocked = false;

// ---- records / rank helpers --------------------------------------------------
function applyRunToRecords(): { newBest: boolean; newUnlocks: string[] } {
  const st = sim.stats;
  let newBest = false;
  data.progress.totalRuns += 1;
  data.progress.totalPulses += st.pulses;
  if (st.deepest > data.progress.maxFloorEver) data.progress.maxFloorEver = st.deepest;
  if (st.mode === 'normal') {
    data.records.normal.runs += 1;
    if (st.deepest > data.records.normal.bestFloor) {
      data.records.normal.bestFloor = st.deepest;
      newBest = true;
    }
    if (st.cleared && st.clearTimeMs !== null && (data.records.normal.bestClearTimeMs === null || st.clearTimeMs < data.records.normal.bestClearTimeMs)) {
      data.records.normal.bestClearTimeMs = st.clearTimeMs;
      newBest = true;
    }
  } else {
    const key = st.dateKey;
    const rec = data.records.daily[key] ?? { bestFloor: 0, clearTimeMs: null, attempts: 0 };
    rec.attempts += 1;
    if (st.deepest > rec.bestFloor) {
      rec.bestFloor = st.deepest;
      newBest = true;
    }
    if (st.cleared && st.clearTimeMs !== null && (rec.clearTimeMs === null || st.clearTimeMs < rec.clearTimeMs)) {
      rec.clearTimeMs = st.clearTimeMs;
      newBest = true;
    }
    data.records.daily[key] = rec;
    if (st.deepest > data.progress.dailyBestFloorEver) data.progress.dailyBestFloorEver = st.deepest;
  }
  const newUnlocks = grantUnlocks(data, { cleared: st.cleared, dailyFloor: st.mode === 'daily' ? st.deepest : 0 });
  sim.opts.unlocks = new Set(data.unlocks);
  persist();
  return { newBest, newUnlocks };
}

async function submitRun(name: string): Promise<string> {
  const st = sim.stats;
  const time = Math.min(st.timeMs, 1e9 - 1);
  const meta = { floor: st.deepest, timeMs: st.timeMs, cleared: st.cleared, date: st.dateKey };
  const jobs: Promise<string>[] = [];
  jobs.push(submitScore('echo-floor', 'echo', st.deepest * 1e9 + (1e9 - 1 - time), meta, name));
  if (st.cleared && st.clearTimeMs !== null) jobs.push(submitScore('echo-time', 'echo', 1e9 - Math.min(st.clearTimeMs, 1e9 - 1), meta, name));
  if (st.mode === 'daily') jobs.push(submitScore(`echo-daily-${st.dateKey}`, 'echo', st.deepest * 1e9 + (st.cleared && st.clearTimeMs !== null ? 1e9 - 1 - Math.min(st.clearTimeMs, 1e9 - 1) : 0), meta, name));
  const results = await Promise.all(jobs);
  if (results.some((r) => r === 'error')) return S.rank.offline;
  if (results.every((r) => r === 'lower')) return '기존 기록이 더 높아 랭킹은 그대로입니다';
  return S.rank.submitted;
}

// ---- screens -------------------------------------------------------------------
let summaryShown = false;
const screens = new Screens(uiRoot, {
  startNormal: () => startRun('normal'),
  startDaily: () => startRun('daily'),
  resume: () => {
    if (sim.phase === 'PAUSE') handleEvents(sim.togglePause());
  },
  toTitle: () => {
    sim.abandon();
    hud.hint = null;
    screens.showTitle();
    audio.setAmbience(false);
    touch.setVisible(false);
  },
  retry: () => startRun(sim.mode, sim.mode === 'daily' ? sim.seedStr : undefined),
  deeper: () => {
    handleEvents(sim.continueDeeper());
    screens.hide();
  },
  getSave: () => data,
  setSetting: (k, v) => {
    (data.settings as Record<string, unknown>)[k] = v;
    persist();
    if (k === 'volume') audio.setVolume(data.settings.volume);
    if (k === 'shake') renderer.shakeEnabled = data.settings.shake;
    if (k === 'palette') {
      renderer.palette = data.settings.palette;
      sim.opts.palette = data.settings.palette;
    }
    if (k === 'touch') touch.setVisible(touchWanted() && sim.phase !== 'TITLE');
  },
  playUi: () => audio.ui(),
  audioUnlocked: () => audioUnlocked,
  submitRank: (name) => submitRun(name),
});

const touch = new TouchControls(touchRoot, input, () => input.queuePause());

function startRun(mode: 'normal' | 'daily', seedStr?: string): void {
  summaryShown = false;
  hud.toast = null;
  tutorialIdx = 0;
  tutorialShownAt = -1;
  handleEvents(sim.startRun(mode, seedStr));
  screens.hide();
  touch.setVisible(touchWanted());
  hud.touch = touch.visible;
  audio.setAmbience(true);
  const f = sim.floor!;
  renderer.snapCamera(f.player.x, f.player.y);
}

// ---- tutorial ------------------------------------------------------------------
type Hint = { id: string; text: () => string; when: () => boolean; done: () => boolean; min: number };
const HINTS: Hint[] = [
  { id: 'move', text: () => (hud.touch ? S.tutorial.moveTouch : S.tutorial.move), when: () => sim.floorIndex === 1, done: () => !!sim.floor && sim.floor.player.moving, min: 0 },
  { id: 'pulse', text: () => (hud.touch ? S.tutorial.pulseTouch : S.tutorial.pulse), when: () => sim.floorIndex === 1, done: () => !!sim.floor && sim.floor.stats.pulses >= 1, min: 0 },
  { id: 'noise', text: () => (hud.touch ? S.tutorial.noiseTouch : S.tutorial.noise), when: () => sim.floorIndex === 1 && !!sim.floor && sim.floor.stats.pulses >= 1, done: () => !!sim.floor && (sim.floor.player.sneaking || sim.runTime > 40), min: 5 },
  { id: 'stone', text: () => (hud.touch ? S.tutorial.stoneTouch : S.tutorial.stone), when: () => !!sim.floor && sim.floor.player.inv.stone > 0 && sim.runTime > 12, done: () => !!sim.floor && sim.floor.stats.stones >= 1, min: 5 },
  { id: 'heart', text: () => S.tutorial.heart, when: () => !!sim.floor && sim.floor.nearestThreat < 7, done: () => !!sim.floor && sim.floor.nearestThreat > 9, min: 4 },
  { id: 'key', text: () => S.tutorial.key, when: () => !!sim.floor && sim.floor.layout.locked && !sim.floor.keyTaken, done: () => !!sim.floor && sim.floor.keyTaken, min: 5 },
  { id: 'listen', text: () => S.tutorial.listen, when: () => sim.floorIndex === 1 && sim.runTime > 25 && !!sim.floor && !sim.floor.memory.hasPersistent('exit', 0), done: () => !!sim.floor && sim.floor.memory.hasPersistent('exit', 0), min: 6 },
];
let tutorialIdx = 0;
let tutorialShownAt = -1;
let currentHint: Hint | null = null;
function updateTutorial(): void {
  if (sim.phase !== 'RUN') {
    hud.hint = null;
    return;
  }
  const seen = data.progress.tutorialSeen;
  if (currentHint) {
    const elapsed = sim.runTime - tutorialShownAt;
    if (currentHint.done() && elapsed >= currentHint.min) {
      if (!seen.includes(currentHint.id)) {
        seen.push(currentHint.id);
        persist();
      }
      currentHint = null;
      hud.hint = null;
    } else if (elapsed > 14) {
      currentHint = null;
      hud.hint = null;
    } else {
      hud.hint = currentHint.text();
      return;
    }
  }
  for (const hnt of HINTS) {
    if (seen.includes(hnt.id)) continue;
    if (hnt.done()) {
      seen.push(hnt.id);
      continue;
    }
    if (hnt.when()) {
      currentHint = hnt;
      tutorialShownAt = sim.runTime;
      hud.hint = hnt.text();
      return;
    }
  }
  hud.hint = null;
}

// ---- event handling ------------------------------------------------------------
function toast(text: string, secs = 2.2): void {
  hud.toast = text;
  hud.toastT = secs;
}

function handleEvents(events: SimEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'floorStart':
        toast(S.floorLabel(ev.floor), 1.8);
        if (sim.floor) renderer.snapCamera(sim.floor.player.x, sim.floor.player.y);
        break;
      case 'pause':
        screens.showPause();
        audio.setAmbience(false);
        break;
      case 'resume':
        screens.hide();
        audio.setAmbience(true);
        loop.resync();
        break;
      case 'dead':
        audio.death();
        renderer.addTrauma(0.9);
        audio.setAmbience(false);
        break;
      case 'summary':
      case 'win': {
        if (summaryShown) break;
        summaryShown = true;
        if (ev.type === 'win') audio.win();
        const { newBest, newUnlocks } = applyRunToRecords();
        const name = getPlayerName();
        const rankStatus = name ? submitRun(name) : null;
        screens.showSummary({ stats: sim.stats, newBest, newUnlocks, rankStatus, canDeeper: ev.type === 'win' && sim.mode === 'normal' });
        touch.setVisible(false);
        break;
      }
      case 'transition':
        audio.stairs();
        break;
      case 'floor':
        handleFloorEvent(ev.event);
        break;
    }
  }
}

function handleFloorEvent(e: { kind: string; x: number; y: number; data?: number | string }): void {
  const f = sim.floor;
  if (!f) return;
  const p = f.player;
  const dx = e.x - p.x;
  const dy = e.y - p.y;
  const walls = () => wallsBetween(f.grid, p.x, p.y, e.x, e.y, 3);
  switch (e.kind) {
    case 'pulse':
      audio.ping();
      renderer.pulseFlash();
      renderer.addTrauma(0.05);
      break;
    case 'step':
      audio.step(false);
      break;
    case 'sneakStep':
      audio.step(true);
      break;
    case 'pickup':
      audio.pickup();
      toast(S.pickup[e.data as ItemKind] ?? '');
      break;
    case 'noItem':
      audio.denied();
      if (e.data === 'full') toast(S.itemFull);
      else if (e.data === 'hpFull') toast(S.hpFull);
      break;
    case 'key':
      audio.key();
      toast(S.keyTaken, 3);
      break;
    case 'locked':
      audio.locked();
      toast(S.locked, 2.5);
      break;
    case 'hit':
      audio.hit();
      renderer.hitFlash();
      renderer.addTrauma(e.data === 2 ? 0.9 : 0.6);
      break;
    case 'trap':
      audio.trap(dx, dy, walls());
      renderer.hitFlash();
      renderer.addTrauma(0.4);
      break;
    case 'throw':
      audio.throwStone();
      break;
    case 'land':
      audio.stoneLand(dx, dy, walls());
      break;
    case 'flare':
      audio.flare();
      renderer.pulseFlash();
      break;
    case 'bandage':
      audio.bandage();
      break;
    case 'silencer':
      audio.silencer();
      break;
    case 'growl':
      audio.growl(dx, dy, walls());
      break;
    case 'huff':
      audio.huff(dx, dy, walls());
      break;
    case 'grunt':
      audio.grunt(dx, dy, walls());
      break;
    case 'hunterStep':
      audio.hunterStep(dx, dy, walls());
      break;
    case 'batClick':
      audio.batClick(dx, dy, walls());
      break;
    case 'batSonar':
      audio.batSonar(dx, dy, walls());
      break;
    case 'screech':
      audio.screech(dx, dy, walls());
      break;
    case 'roar':
    case 'wake':
      audio.roar(dx, dy, walls());
      renderer.addTrauma(0.25);
      break;
    case 'predatorStep':
      audio.predatorStep(dx, dy, walls());
      break;
    case 'exitHum':
      audio.exitHum(dx, dy, walls());
      break;
    case 'keyChime':
      audio.keyChime(dx, dy, walls());
      break;
  }
}

// ---- loop --------------------------------------------------------------------
let debugOn = false;
const loop = new Loop({
  update: (dt) => {
    const inp = input.poll();
    if (inp.debug) {
      debugOn = !debugOn;
      hud.debug = debugOn;
    }
    if (inp.any && !audioUnlocked) unlockAudio();
    if (input.mouseInside && !touch.visible) {
      const [wx, wy] = renderer.screenToWorld(input.mouseX, input.mouseY);
      inp.aimX = wx;
      inp.aimY = wy;
    }
    if (sim.phase === 'PAUSE' && inp.pause) {
      // handled by sim; screens updated via events
    }
    const events = sim.update(dt, inp);
    if (events.length) handleEvents(events);
    if (sim.phase === 'RUN' && sim.floor) {
      const f = sim.floor;
      audio.heartbeat(dt, f.nearestThreat, f.anyChase, true);
      if (hud.toastT > 0) hud.toastT -= dt;
      updateTutorial();
      // compass
      if (f.compass && (f.exitUnlocked || f.keyTaken) && f.player.stillT >= 1) hud.compassAngle = Math.atan2(f.exitY - f.player.y, f.exitX - f.player.x);
      else hud.compassAngle = null;
      if (touch.visible) touch.updateInventory(f.player.inv);
    } else {
      audio.heartbeat(dt, Infinity, false, false);
      hud.compassAngle = null;
    }
    if (sim.phase === 'TITLE' && inp.any && screens.current === null) screens.showTitle();
  },
  render: (alpha, dtFrame) => {
    renderer.render(sim, alpha, dtFrame, hud);
  },
});

function unlockAudio(): void {
  audio.unlock();
  audioUnlocked = true;
  if (screens.current === 'title') screens.showTitle();
}
input.onFirstGesture = unlockAudio;
uiRoot.addEventListener('pointerdown', () => unlockAudio(), { passive: true });

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 150));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (sim.phase === 'RUN') handleEvents(sim.togglePause());
    audio.suspend();
  } else {
    audio.resume();
    loop.resync();
  }
});
window.addEventListener('blur', () => {
  if (sim.phase === 'RUN') handleEvents(sim.togglePause());
});

screens.showTitle();
loop.start();

if (import.meta.env.DEV) (window as unknown as { echo: unknown }).echo = { sim, renderer, audio, data, screens, ITEM_KINDS, WIN_FLOOR, localDateString };
