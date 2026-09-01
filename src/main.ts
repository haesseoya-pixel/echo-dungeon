import './styles.css';
import { Audio } from './audio/audio';
import { FLOOR_INTRO_SECONDS, ITEM_KINDS, WIN_FLOOR, type ItemKind } from './config';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { localDateString } from './core/rng';
import { getPlayerName, submitScore } from './rank/leaderboard';
import { Renderer, type HudState, type MessageKind } from './render/renderer';
import { getLocalStorage, load, save as saveToStorage, type SaveV1 } from './save/storage';
import { grantUnlocks } from './save/unlocks';
import { GameSim, type SimEvent } from './sim/game';
import { S } from './strings.ko';
import { Screens } from './ui/screens';
import { TouchControls } from './ui/touch';
import type { EnemyKind } from './world/dungeon';
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
const hud: HudState = { hint: null, messages: [], debug: false, compassAngle: null, touch: false, objective: '', intro: null, hitDir: null, wallMemory: data.settings.wallMemory, heartBeat: 0 };
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

/** Tip shown on the summary screen: relevant to the cause of death when possible, otherwise rotating. */
function pickTip(): string {
  const cause = sim.stats.deathCause;
  if (cause === 'spider') return S.tips[5]!;
  if (cause === 'predator') return S.tips[6]!;
  if (cause === 'hunter' && sim.stats.stones === 0) return S.tips[1]!;
  if (cause === 'hunter') return S.tips[Math.random() < 0.5 ? 0 : 3]!;
  return S.tips[data.progress.totalRuns % S.tips.length]!;
}

// ---- messages ----------------------------------------------------------------
function message(text: string, kind: MessageKind = 'info', secs = 3.2): void {
  hud.messages.push({ text, t: secs, kind });
  while (hud.messages.length > 4) hud.messages.shift();
}

function objectiveText(): string {
  const f = sim.floor;
  if (!f) return '';
  if (f.layout.locked && !f.keyTaken) return S.objective.findKey;
  if (f.layout.locked && f.keyTaken) return S.objective.toExit;
  return S.objective.findExit;
}

function floorIntro(floor: number): void {
  const f = sim.floor;
  const sub = floor === WIN_FLOOR ? S.floorIntro.lastFloor : floor > WIN_FLOOR ? S.floorIntro.endless : f && f.layout.locked ? S.floorIntro.findKey : S.floorIntro.findExit;
  hud.intro = { title: S.floorLabel(floor), sub, t: FLOOR_INTRO_SECONDS };
}

// ---- screens -------------------------------------------------------------------
let summaryShown = false;
const screens = new Screens(uiRoot, {
  startNormal: () => beginRun('normal'),
  startDaily: () => beginRun('daily'),
  resume: () => {
    if (sim.phase === 'PAUSE') handleEvents(sim.togglePause());
  },
  toTitle: () => {
    sim.abandon();
    hud.hint = null;
    hud.messages = [];
    hud.intro = null;
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
    if (k === 'wallMemory') hud.wallMemory = data.settings.wallMemory;
    if (k === 'palette') {
      renderer.palette = data.settings.palette;
      sim.opts.palette = data.settings.palette;
    }
    if (k === 'touch') touch.setVisible(touchWanted() && sim.phase !== 'TITLE');
  },
  playUi: () => audio.ui(),
  audioUnlocked: () => audioUnlocked,
  submitRank: (name) => submitRun(name),
  resetGuide: () => {
    data.progress.guideSeen = false;
    data.progress.tutorialSeen = [];
    persist();
  },
});

const touch = new TouchControls(touchRoot, input, () => input.queuePause());

/** Shows the guide first for brand-new players, then starts the run. */
function beginRun(mode: 'normal' | 'daily'): void {
  if (!data.progress.guideSeen) {
    screens.showGuide(0, () => screens.showTitle(), () => {
      data.progress.guideSeen = true;
      persist();
      startRun(mode);
    });
    return;
  }
  startRun(mode);
}

function startRun(mode: 'normal' | 'daily', seedStr?: string): void {
  summaryShown = false;
  hud.messages = [];
  hud.hitDir = null;
  currentHint = null;
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
function handleEvents(events: SimEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'floorStart':
        floorIntro(ev.floor);
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
        screens.showSummary({ stats: sim.stats, newBest, newUnlocks, rankStatus, canDeeper: ev.type === 'win' && sim.mode === 'normal', tip: pickTip() });
        touch.setVisible(false);
        break;
      }
      case 'transition':
        audio.stairs();
        hud.messages = [];
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
      message(S.pickup[e.data as ItemKind] ?? '', 'good');
      break;
    case 'noItem':
      audio.denied();
      if (e.data === 'full') message(S.itemFull, 'warn', 2);
      else if (e.data === 'hpFull') message(S.hpFull, 'warn', 2);
      else message(S.noItem[e.data as ItemKind] ?? '', 'warn', 2);
      break;
    case 'key':
      audio.key();
      message(S.keyTaken, 'good', 4);
      break;
    case 'locked':
      audio.locked();
      message(S.locked, 'warn', 2.5);
      break;
    case 'hit': {
      audio.hit();
      renderer.hitFlash();
      const kind = e.data as EnemyKind;
      renderer.addTrauma(kind === 'predator' ? 0.9 : 0.6);
      hud.hitDir = { angle: Math.atan2(dy, dx), t: 0.8 };
      message(S.hit[kind] ?? '피격!', 'danger', 2.5);
      break;
    }
    case 'trap':
      audio.trap(dx, dy, walls());
      renderer.hitFlash();
      renderer.addTrauma(0.4);
      hud.hitDir = { angle: Math.atan2(dy, dx), t: 0.8 };
      message(S.hit.spider, 'danger', 3);
      break;
    case 'throw':
      audio.throwStone();
      message(S.used.stone, 'info', 2);
      break;
    case 'land':
      audio.stoneLand(dx, dy, walls());
      break;
    case 'flare':
      audio.flare();
      renderer.pulseFlash();
      message(S.used.flare, 'warn', 3);
      break;
    case 'bandage':
      audio.bandage();
      message(S.used.bandage, 'good', 2);
      break;
    case 'silencer':
      audio.silencer();
      message(S.used.silencer, 'good', 2.5);
      break;
    case 'firstSeen':
      message(S.firstSeen[e.data as EnemyKind] ?? '', e.data === 'bat' ? 'info' : 'warn', 4.5);
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
      if (e.kind === 'wake') message('포식자가 깨어났습니다!', 'danger', 3);
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
let beatTimer = 0;
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
    const events = sim.update(dt, inp);
    if (events.length) handleEvents(events);
    for (const m of hud.messages) m.t -= dt;
    if (hud.messages.length && hud.messages[0]!.t <= 0) hud.messages = hud.messages.filter((m) => m.t > 0);
    if (hud.intro) {
      hud.intro.t -= dt;
      if (hud.intro.t <= 0) hud.intro = null;
    }
    if (hud.hitDir) {
      hud.hitDir.t -= dt;
      if (hud.hitDir.t <= 0) hud.hitDir = null;
    }
    if (sim.phase === 'RUN' && sim.floor) {
      const f = sim.floor;
      audio.heartbeat(dt, f.nearestThreat, f.anyChase, true);
      // visual heartbeat mirrors the audio interval
      const d = Math.min(10, f.nearestThreat) / 10;
      const interval = f.nearestThreat > 10 ? 1.4 : 0.35 + 0.85 * Math.pow(d, 1.3);
      beatTimer += dt;
      if (beatTimer >= interval) beatTimer = 0;
      hud.heartBeat = Math.max(0, 1 - beatTimer / 0.25);
      updateTutorial();
      hud.objective = objectiveText();
      if (f.compass && (f.exitUnlocked || f.keyTaken) && f.player.stillT >= 1) hud.compassAngle = Math.atan2(f.exitY - f.player.y, f.exitX - f.player.x);
      else hud.compassAngle = null;
      if (touch.visible) touch.updateInventory(f.player.inv);
    } else {
      audio.heartbeat(dt, Infinity, false, false);
      hud.compassAngle = null;
      hud.heartBeat = 0;
      if (sim.phase !== 'PAUSE') hud.hint = null;
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
  screens.hideTapHint();
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

screens.showTitle();
loop.start();

if (import.meta.env.DEV) (window as unknown as { echo: unknown }).echo = { sim, renderer, audio, data, screens, hud, handleEvents, message, ITEM_KINDS, WIN_FLOOR, localDateString };
