import { formatClock } from '@/core/math';
import { localDateString } from '@/core/rng';
import { fetchTop, getPlayerId, getPlayerName, isValidName, setPlayerName, type Entry } from '@/rank/leaderboard';
import type { SaveV1 } from '@/save/storage';
import type { RunStats } from '@/sim/game';
import { S } from '@/strings.ko';

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; html?: string; on?: (e: Event) => void; attrs?: Record<string, string> } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props.class) e.className = props.class;
  if (props.text !== undefined) e.textContent = props.text;
  if (props.html !== undefined) e.innerHTML = props.html;
  if (props.on) e.addEventListener('click', props.on);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) e.setAttribute(k, v);
  for (const c of children) if (c) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

export interface ScreenCallbacks {
  startNormal(): void;
  startDaily(): void;
  resume(): void;
  toTitle(): void;
  retry(): void;
  deeper(): void;
  getSave(): SaveV1;
  setSetting<K extends keyof SaveV1['settings']>(k: K, v: SaveV1['settings'][K]): void;
  playUi(): void;
  audioUnlocked(): boolean;
  submitRank(name: string): Promise<string>;
  resetGuide(): void;
}

export type BoardId = 'echo-floor' | 'echo-time' | 'daily';

export interface SummaryOpts {
  stats: RunStats;
  newBest: boolean;
  newUnlocks: string[];
  rankStatus: Promise<string> | null;
  canDeeper: boolean;
  tip: string;
}

/** Inline SVG illustrations for the guide slides (no assets). */
const GUIDE_SVG: string[] = [
  `<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="140" fill="#000"/>
   <path d="M60 30h200M60 30v80M60 110h80M200 110h60M260 30v80" stroke="#50e6ff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"/>
   <circle cx="160" cy="72" r="26" fill="none" stroke="#50e6ff" stroke-width="2" opacity=".6"/><circle cx="160" cy="72" r="48" fill="none" stroke="#50e6ff" stroke-width="1.5" opacity=".3"/>
   <circle cx="160" cy="72" r="5" fill="#fff"/><rect x="150" y="105" width="20" height="10" rx="2" fill="none" stroke="#c8dcff" opacity=".8"/><text x="160" y="129" fill="#c8dcff" font-size="9" text-anchor="middle" opacity=".8">돌멩이</text></svg>`,
  `<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="140" fill="#000"/>
   <circle cx="90" cy="72" r="5" fill="#fff"/><circle cx="90" cy="72" r="22" fill="none" stroke="#fff" stroke-width="1.5" opacity=".5"/><circle cx="90" cy="72" r="40" fill="none" stroke="#fff" stroke-width="1" opacity=".25"/>
   <path d="M236 60l12 12-12 12-12-12z" fill="rgba(255,80,80,.3)" stroke="#ff5050" stroke-width="2"/>
   <path d="M215 72h-70" stroke="#ff5050" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/><path d="M150 66l-8 6 8 6" fill="none" stroke="#ff5050" stroke-width="2"/>
   <rect x="52" y="104" width="76" height="22" rx="5" fill="rgba(80,230,255,.12)" stroke="#50e6ff"/><text x="90" y="119" fill="#c8f4ff" font-size="11" text-anchor="middle" font-weight="700">Shift 살금살금</text>
   <text x="236" y="102" fill="#ff8080" font-size="10" text-anchor="middle">사냥꾼</text></svg>`,
  `<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="140" fill="#000"/>
   <circle cx="70" cy="60" r="5" fill="#fff"/>
   <path d="M236 48l10 10-10 10-10-10z" fill="rgba(255,80,80,.25)" stroke="#ff5050" stroke-width="1.5"/><circle cx="236" cy="58" r="18" fill="none" stroke="#ff5050" stroke-width="1.5" opacity=".7"/><circle cx="236" cy="58" r="34" fill="none" stroke="#ff5050" stroke-width="1" opacity=".35"/>
   <path d="M150 20c-3-6-12-6-14 1-2 8 8 14 14 19 6-5 16-11 14-19-2-7-11-7-14-1z" fill="#ff5a6e"/><text x="150" y="60" fill="#ff9aa6" font-size="10" text-anchor="middle">심장이 빨라진다</text>
   <rect x="52" y="96" width="20" height="20" fill="rgba(100,255,140,.15)" stroke="#64ff8c" stroke-width="1.5"/><circle cx="62" cy="106" r="22" fill="none" stroke="#64ff8c" stroke-width="1.2" opacity=".5"/><text x="96" y="110" fill="#8cffb0" font-size="10">출구: 초록 파문</text>
   <circle cx="236" cy="106" r="4" fill="none" stroke="#ffd250" stroke-width="1.5"/><circle cx="236" cy="106" r="16" fill="none" stroke="#ffd250" stroke-width="1.2" opacity=".5"/><text x="262" y="110" fill="#ffe08a" font-size="10">열쇠: 금색</text></svg>`,
  `<svg viewBox="0 0 320 140" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="140" fill="#000"/>
   <text x="40" y="34" fill="#c8dcff" font-size="12" font-weight="700">B1 → B2 → B3 (열쇠) → … → B10 탈출</text>
   <rect x="40" y="52" width="20" height="20" fill="rgba(100,255,140,.15)" stroke="#64ff8c" stroke-width="1.5"/><path d="M40 57h20M40 62h20M40 67h20" stroke="#64ff8c" opacity=".7"/><text x="68" y="66" fill="#8cffb0" font-size="10">출구</text>
   <circle cx="126" cy="60" r="4" fill="none" stroke="#ffd250" stroke-width="1.5"/><path d="M130 62h10M136 62v3M140 62v3" stroke="#ffd250" stroke-width="1.5"/><text x="152" y="66" fill="#ffe08a" font-size="10">열쇠 (3층부터)</text>
   <g font-size="10" fill="#c8dcff"><rect x="40" y="90" width="56" height="30" rx="5" fill="rgba(20,28,40,.8)" stroke="rgba(200,220,255,.4)"/><text x="68" y="103" text-anchor="middle" font-weight="700">1 돌멩이</text><text x="68" y="115" text-anchor="middle" opacity=".7">유인</text>
   <rect x="104" y="90" width="56" height="30" rx="5" fill="rgba(20,28,40,.8)" stroke="rgba(200,220,255,.4)"/><text x="132" y="103" text-anchor="middle" font-weight="700">2 조명탄</text><text x="132" y="115" text-anchor="middle" opacity=".7">넓게 밝힘</text>
   <rect x="168" y="90" width="56" height="30" rx="5" fill="rgba(20,28,40,.8)" stroke="rgba(200,220,255,.4)"/><text x="196" y="103" text-anchor="middle" font-weight="700">3 소음기</text><text x="196" y="115" text-anchor="middle" opacity=".7">12초 정숙</text>
   <rect x="232" y="90" width="56" height="30" rx="5" fill="rgba(20,28,40,.8)" stroke="rgba(200,220,255,.4)"/><text x="260" y="103" text-anchor="middle" font-weight="700">4 붕대</text><text x="260" y="115" text-anchor="middle" opacity=".7">체력 +1</text></g></svg>`,
];

export class Screens {
  private root: HTMLElement;
  private cb: ScreenCallbacks;
  current: string | null = null;

  constructor(root: HTMLElement, cb: ScreenCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  hide(): void {
    this.current = null;
    this.root.replaceChildren();
  }

  hideTapHint(): void {
    this.root.querySelector('.tap-hint')?.remove();
  }

  private show(name: string, node: HTMLElement, dim = true): void {
    this.current = name;
    this.root.replaceChildren(h('div', { class: `screen ${dim ? 'dim' : ''}` }, node));
  }

  private btn(text: string, on: () => void, cls = ''): HTMLButtonElement {
    return h('button', {
      class: cls,
      text,
      on: () => {
        this.cb.playUi();
        on();
      },
    });
  }

  showTitle(): void {
    const save = this.cb.getSave();
    const best = save.records.normal;
    const card = h(
      'div',
      { class: 'card' },
      h('div', { class: 'title-logo' }, h('h1', { text: S.title }), h('div', { class: 'sub', text: S.subtitle })),
      h(
        'div',
        { class: 'menu' },
        this.btn(S.normal, () => this.cb.startNormal(), 'primary'),
        this.btn(`${S.daily} · ${localDateString()}`, () => this.cb.startDaily()),
        h('div', { class: 'row3' }, this.btn(S.ranking, () => this.showRanking('echo-floor', () => this.showTitle())), this.btn(S.records, () => this.showRecords(() => this.showTitle())), this.btn(S.settings, () => this.showSettings(() => this.showTitle()))),
        this.btn(save.progress.guideSeen ? S.controls : S.howTo, () => this.showGuide(0, () => this.showTitle(), null), 'ghost'),
      ),
      h('div', { class: 'small dim-text center', text: best.bestFloor > 0 ? `${S.recordsLabels.bestFloor} B${best.bestFloor}${best.bestClearTimeMs !== null ? ` · ${S.recordsLabels.bestTime} ${formatClock(best.bestClearTimeMs)}` : ''} · ${S.recordsLabels.runs} ${best.runs}` : '소리로 길을 찾고, 소리로 적을 피하세요.', attrs: { style: 'margin-top:14px' } }),
    );
    this.show('title', card, false);
    if (!this.cb.audioUnlocked()) this.root.append(h('div', { class: 'tap-hint', text: S.tapToStart }));
  }

  /** Four-slide illustrated guide. `onStart` (when set) starts the run at the end. */
  showGuide(slide: number, back: () => void, onStart: (() => void) | null): void {
    const g = S.guide[slide]!;
    const dots = h('div', { class: 'dots' });
    S.guide.forEach((_, i) => dots.append(h('span', { class: `dot ${i === slide ? 'on' : ''}` })));
    const last = slide === S.guide.length - 1;
    const actions = h('div', { class: 'actions', attrs: { style: 'justify-content:space-between' } });
    actions.append(
      slide > 0 ? this.btn(S.prev, () => this.showGuide(slide - 1, back, onStart), 'ghost') : this.btn(onStart ? S.skip : S.close, () => (onStart ? onStart() : back()), 'ghost'),
      last ? this.btn(onStart ? S.startNow : S.close, () => (onStart ? onStart() : back()), 'primary') : this.btn(S.next, () => this.showGuide(slide + 1, back, onStart), 'primary'),
    );
    const card = h(
      'div',
      { class: 'card' },
      h('div', { class: 'guide-art', html: GUIDE_SVG[slide] ?? '' }),
      h('h2', { text: `${slide + 1}. ${g.title}` }),
      h('p', { class: 'guide-body', text: g.body }),
      last ? this.legendTable() : null,
      dots,
      actions,
    );
    this.show('guide', card);
  }

  private legendTable(): HTMLElement {
    const t = h('table', { class: 'controls-table small' });
    for (const [k, v] of S.legend) t.append(h('tr', {}, h('td', { text: k }), h('td', { text: v })));
    return h('details', { class: 'legend' }, h('summary', { text: '표시 기호 보기' }), t);
  }

  showPause(): void {
    const controls = h('table', { class: 'controls-table small' });
    for (const [k, v] of S.controlsText) controls.append(h('tr', {}, h('td', { text: k }), h('td', { text: v })));
    const card = h(
      'div',
      { class: 'card' },
      h('h2', { class: 'big', text: S.paused }),
      h(
        'div',
        { class: 'menu' },
        this.btn(S.resume, () => this.cb.resume(), 'primary'),
        h('div', { class: 'row2' }, this.btn(S.settings, () => this.showSettings(() => this.showPause())), this.btn(S.controls, () => this.showGuide(0, () => this.showPause(), null))),
        this.btn(S.toTitle, () => {
          if (window.confirm(S.toTitleConfirm)) this.cb.toTitle();
        }, 'ghost'),
      ),
      h('div', { class: 'section', text: S.controls }),
      controls,
    );
    this.show('pause', card);
  }

  showSummary(o: SummaryOpts): void {
    const st = o.stats;
    const won = st.cleared && !st.died;
    const title = won ? S.escaped : st.died ? S.died : S.escaped;
    const cause = st.died && st.deathCause ? S.deathBy[st.deathCause as keyof typeof S.deathBy] : null;
    const sub = won ? S.win : st.died ? `${S.fellAt(st.floor)}${cause ? ` · ${cause}` : ''}` : '';
    const stats = h(
      'div',
      { class: 'stat-grid' },
      this.stat(S.stats.floor, `B${st.deepest}`),
      this.stat(st.cleared ? S.stats.clear : S.stats.time, formatClock(st.cleared && st.clearTimeMs !== null ? st.clearTimeMs : st.timeMs)),
      this.stat(S.stats.pulses, String(st.pulses)),
      this.stat(S.stats.stones, String(st.stones)),
      this.stat(S.stats.damage, String(st.damage)),
      this.stat(S.stats.seen, String(st.seen)),
    );
    const badges = h('div');
    if (o.newBest) badges.append(h('span', { class: 'badge', text: S.newBest }));
    for (const u of o.newUnlocks) badges.append(h('span', { class: 'badge unlock', text: `${S.newUnlocks}: ${S.unlockName[u as keyof typeof S.unlockName] ?? u}` }));
    const rankLine = h('div', { class: 'msg' });
    const nameBox = h('div');
    if (o.rankStatus) {
      rankLine.textContent = S.rank.loading;
      void o.rankStatus.then((msg) => {
        rankLine.textContent = msg;
        rankLine.className = 'msg ok';
      });
    } else {
      const input = h('input', { attrs: { type: 'text', maxlength: '12', placeholder: S.rank.namePrompt } }) as HTMLInputElement;
      const msg = h('div', { class: 'msg' });
      const submit = this.btn(S.rank.nameSave, () => {
        if (!isValidName(input.value)) {
          msg.textContent = S.rank.namePrompt;
          msg.className = 'msg err';
          return;
        }
        setPlayerName(input.value);
        submit.disabled = true;
        msg.textContent = S.rank.loading;
        void this.cb.submitRank(input.value).then((r) => {
          msg.textContent = r;
          msg.className = 'msg ok';
        });
      }, 'primary');
      nameBox.append(h('div', { class: 'section', text: `${S.ranking} 등록` }), h('div', { class: 'name-row' }, input, submit), msg);
    }
    const actions = h('div', { class: 'actions center' });
    if (o.canDeeper) actions.append(this.btn(S.deeper, () => this.cb.deeper(), 'primary'));
    actions.append(this.btn(S.retry, () => this.cb.retry(), o.canDeeper ? '' : 'primary'), this.btn(S.ranking, () => this.showRanking(st.mode === 'daily' ? 'daily' : 'echo-floor', () => this.showSummary(o))), this.btn(S.toTitle, () => this.cb.toTitle(), 'ghost'));
    const card = h(
      'div',
      { class: 'card' },
      h('h2', { class: `big ${won ? 'win' : st.died ? 'dead' : 'win'}`, text: title }),
      sub ? h('div', { class: 'sub center', text: sub }) : null,
      st.mode === 'daily' ? h('div', { class: 'small muted center', text: `${S.daily} · ${st.dateKey}` }) : null,
      stats,
      badges,
      h('div', { class: 'tip' }, h('b', { text: `${S.tipLabel} ` }), o.tip),
      rankLine,
      nameBox,
      actions,
    );
    this.show('summary', card);
  }

  private stat(k: string, v: string): HTMLElement {
    return h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }));
  }

  showSettings(back: () => void): void {
    const s = this.cb.getSave().settings;
    const vol = h('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) } }) as HTMLInputElement;
    vol.addEventListener('input', () => this.cb.setSetting('volume', parseFloat(vol.value)));
    const toggle = (key: 'shake' | 'wallMemory') => {
      const b = h('button', { class: `switch ${this.cb.getSave().settings[key] ? 'on' : ''}` });
      b.addEventListener('click', () => {
        const v = !this.cb.getSave().settings[key];
        this.cb.setSetting(key, v);
        b.classList.toggle('on', v);
      });
      return b;
    };
    const seg = <T extends string>(key: 'touch' | 'palette', opts: [T, string, boolean][]) => {
      const wrap = h('div', { class: 'seg' });
      const btns: HTMLButtonElement[] = [];
      for (const [val, label, enabled] of opts) {
        const b = h('button', { text: label, class: this.cb.getSave().settings[key] === val ? 'active' : '' });
        b.disabled = !enabled;
        b.addEventListener('click', () => {
          this.cb.setSetting(key, val as never);
          for (const x of btns) x.classList.toggle('active', x === b);
        });
        btns.push(b);
        wrap.append(b);
      }
      return wrap;
    };
    const altUnlocked = this.cb.getSave().unlocks.includes('palette_alt');
    const name = h('input', { attrs: { type: 'text', maxlength: '12', value: getPlayerName(), placeholder: S.rank.namePrompt } }) as HTMLInputElement;
    const nameMsg = h('div', { class: 'msg' });
    name.addEventListener('change', () => {
      if (isValidName(name.value)) {
        setPlayerName(name.value);
        nameMsg.textContent = '저장됨';
        nameMsg.className = 'msg ok';
      } else {
        nameMsg.textContent = S.rank.namePrompt;
        nameMsg.className = 'msg err';
      }
    });
    const guideMsg = h('span', { class: 'small muted' });
    const card = h(
      'div',
      { class: 'card' },
      h('h2', { text: S.settings }),
      h('div', { class: 'setting-row' }, h('div', { attrs: { style: 'flex:1' } }, h('label', { text: S.settingsLabels.volume }), vol)),
      h('div', { class: 'setting-row' }, h('div', {}, h('label', { text: S.settingsLabels.wallMemory }), h('div', { class: 'desc', text: S.settingsLabels.wallMemoryDesc })), toggle('wallMemory')),
      h('div', { class: 'setting-row' }, h('div', {}, h('label', { text: S.settingsLabels.shake }), h('div', { class: 'desc', text: '피격·펄스 시 화면 흔들림' })), toggle('shake')),
      h('div', { class: 'setting-row' }, h('div', {}, h('label', { text: S.settingsLabels.touch }), h('div', { class: 'desc', text: '가상 조이스틱과 버튼' })), seg('touch', [['auto', S.settingsLabels.touchAuto, true], ['on', S.settingsLabels.touchOn, true], ['off', S.settingsLabels.touchOff, true]])),
      h('div', { class: 'setting-row' }, h('div', {}, h('label', { text: S.settingsLabels.palette }), h('div', { class: 'desc', text: altUnlocked ? '해금됨' : `해금 조건: ${S.unlockHint.palette_alt}` })), seg('palette', [['default', S.settingsLabels.paletteDefault, true], ['alt', S.settingsLabels.paletteAlt, altUnlocked]])),
      h('div', { class: 'setting-row' }, h('div', { attrs: { style: 'flex:1' } }, h('label', { text: S.settingsLabels.nickname }), name, nameMsg)),
      h(
        'div',
        { class: 'setting-row' },
        guideMsg,
        this.btn(S.settingsLabels.resetGuide, () => {
          this.cb.resetGuide();
          guideMsg.textContent = S.settingsLabels.resetGuideDone;
        }),
      ),
      h('div', { class: 'actions' }, this.btn(S.close, back, 'primary')),
    );
    this.show('settings', card);
  }

  showRecords(back: () => void): void {
    const save = this.cb.getSave();
    const n = save.records.normal;
    const daily = Object.entries(save.records.daily).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const list = h('div', { class: 'daily-list' });
    if (daily.length === 0) list.append(h('div', { class: 'dim-text', text: S.recordsLabels.none }));
    for (const [date, r] of daily) list.append(h('div', {}, h('span', { text: date }), h('span', { text: `B${r.bestFloor}${r.clearTimeMs !== null ? ` · ${formatClock(r.clearTimeMs)}` : ''} · ${r.attempts}회` })));
    const unlocks = h('div');
    for (const id of Object.keys(S.unlockName) as (keyof typeof S.unlockName)[]) {
      const has = save.unlocks.includes(id);
      unlocks.append(h('span', { class: `badge ${has ? 'unlock' : ''}`, text: has ? S.unlockName[id] : `${S.unlockName[id]} — ${S.unlockHint[id]}`, attrs: { style: has ? '' : 'opacity:.45' } }));
    }
    const card = h(
      'div',
      { class: 'card' },
      h('h2', { text: S.records }),
      h('div', { class: 'stat-grid' }, this.stat(S.recordsLabels.bestFloor, n.bestFloor > 0 ? `B${n.bestFloor}` : '-'), this.stat(S.recordsLabels.bestTime, n.bestClearTimeMs !== null ? formatClock(n.bestClearTimeMs) : '-'), this.stat(S.recordsLabels.runs, String(n.runs))),
      h('div', { class: 'section', text: S.recordsLabels.dailyList }),
      list,
      h('div', { class: 'section', text: '해금' }),
      unlocks,
      h('div', { class: 'actions' }, this.btn(S.close, back, 'primary')),
    );
    this.show('records', card);
  }

  showRanking(board: BoardId, back: () => void): void {
    const wrap = h('div', { class: 'rank-wrap' });
    const status = h('div', { class: 'msg muted', text: S.rank.loading });
    const tabs = h('div', { class: 'seg' });
    const boards: [BoardId, string][] = [
      ['echo-floor', S.rank.floorBoard],
      ['echo-time', S.rank.timeBoard],
      ['daily', S.rank.dailyBoard],
    ];
    for (const [id, label] of boards) tabs.append(h('button', { text: label, class: id === board ? 'active' : '', on: () => this.showRanking(id, back) }));
    const card = h(
      'div',
      { class: 'card wide' },
      h('div', { attrs: { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap' } }, h('h2', { text: S.rank.title }), tabs),
      board === 'daily' ? h('div', { class: 'small muted', text: `${S.daily} · ${localDateString()}` }) : null,
      status,
      wrap,
      h('div', { class: 'actions' }, this.btn(S.close, back, 'primary')),
    );
    this.show('ranking', card);
    const boardName = board === 'daily' ? `echo-daily-${localDateString()}` : board;
    void fetchTop(boardName, 50)
      .then((entries) => {
        if (this.current !== 'ranking') return;
        status.textContent = '';
        wrap.replaceChildren(this.rankTable(entries, board));
        const me = entries.findIndex((e) => e.pid === getPlayerId());
        if (me >= 0) status.textContent = `${S.rank.you}: ${S.rank.rankOf(me + 1)}`;
      })
      .catch(() => {
        status.textContent = S.rank.offline;
        status.className = 'msg err';
      });
  }

  private rankTable(entries: Entry[], board: BoardId): HTMLElement {
    if (entries.length === 0) return h('div', { class: 'muted small', text: S.rank.empty, attrs: { style: 'padding:14px' } });
    const table = h('table', { class: 'rank' });
    table.append(h('tr', {}, h('th', { text: '#' }), h('th', { text: '이름' }), h('th', { text: board === 'echo-time' ? '클리어' : '층' }), h('th', { text: board === 'echo-time' ? '' : '시간' })));
    const pid = getPlayerId();
    entries.forEach((e, i) => {
      const floor = Number(e.meta.floor ?? 0);
      const time = Number(e.meta.timeMs ?? 0);
      const cleared = e.meta.cleared === true;
      const rankCls = i === 0 ? 'rank-top1' : i === 1 ? 'rank-top2' : i === 2 ? 'rank-top3' : '';
      table.append(
        h(
          'tr',
          { class: e.pid === pid ? 'me' : '' },
          h('td', { class: rankCls, text: String(i + 1) }),
          h('td', { class: 'n', text: e.name }),
          h('td', { text: board === 'echo-time' ? formatClock(time) : `B${floor}${cleared ? ' ✓' : ''}` }),
          h('td', { class: 'r muted', text: board === 'echo-time' ? '' : formatClock(time) }),
        ),
      );
    });
    return table;
  }
}
