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
}

export type BoardId = 'echo-floor' | 'echo-time' | 'daily';

export interface SummaryOpts {
  stats: RunStats;
  newBest: boolean;
  newUnlocks: string[];
  rankStatus: Promise<string> | null;
  canDeeper: boolean;
}

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
        this.btn(S.controls, () => this.showControls(() => this.showTitle()), 'ghost'),
      ),
      h('div', { class: 'small dim-text center', text: save.records.normal.bestFloor > 0 ? `${S.recordsLabels.bestFloor} B${save.records.normal.bestFloor}${save.records.normal.bestClearTimeMs !== null ? ` · ${S.recordsLabels.bestTime} ${formatClock(save.records.normal.bestClearTimeMs)}` : ''}` : '소리로 길을 찾고, 소리로 적을 피하세요.', attrs: { style: 'margin-top:14px' } }),
    );
    this.show('title', card, false);
    if (!this.cb.audioUnlocked()) this.root.append(h('div', { class: 'tap-hint', text: S.tapToStart }));
  }

  showPause(): void {
    const card = h(
      'div',
      { class: 'card' },
      h('h2', { class: 'big', text: S.paused }),
      h(
        'div',
        { class: 'menu' },
        this.btn(S.resume, () => this.cb.resume(), 'primary'),
        this.btn(S.settings, () => this.showSettings(() => this.showPause())),
        this.btn(S.controls, () => this.showControls(() => this.showPause())),
        this.btn(S.toTitle, () => {
          if (window.confirm(S.toTitleConfirm)) this.cb.toTitle();
        }, 'ghost'),
      ),
    );
    this.show('pause', card);
  }

  showSummary(o: SummaryOpts): void {
    const st = o.stats;
    const title = st.cleared && !st.died ? S.escaped : st.died ? S.died : S.escaped;
    const sub = st.cleared && !st.died ? S.win : st.died ? S.fellAt(st.floor) : '';
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
      nameBox.append(h('div', { class: 'section', text: S.ranking }), h('div', { class: 'name-row' }, input, submit), msg);
    }
    const actions = h('div', { class: 'actions center' });
    if (o.canDeeper) actions.append(this.btn(S.deeper, () => this.cb.deeper(), 'primary'));
    actions.append(this.btn(S.retry, () => this.cb.retry(), o.canDeeper ? '' : 'primary'), this.btn(S.ranking, () => this.showRanking(st.mode === 'daily' ? 'daily' : 'echo-floor', () => this.showSummary(o))), this.btn(S.toTitle, () => this.cb.toTitle(), 'ghost'));
    const card = h(
      'div',
      { class: 'card' },
      h('h2', { class: `big ${st.cleared && !st.died ? 'win' : st.died ? 'dead' : 'win'}`, text: title }),
      sub ? h('div', { class: 'sub center', text: sub }) : null,
      st.mode === 'daily' ? h('div', { class: 'small muted center', text: `${S.daily} · ${st.dateKey}` }) : null,
      stats,
      badges,
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
    const shake = h('button', { class: `switch ${s.shake ? 'on' : ''}` });
    shake.addEventListener('click', () => {
      const v = !this.cb.getSave().settings.shake;
      this.cb.setSetting('shake', v);
      shake.classList.toggle('on', v);
    });
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
    const card = h(
      'div',
      { class: 'card' },
      h('h2', { text: S.settings }),
      h('div', { class: 'setting-row' }, h('div', { attrs: { style: 'flex:1' } }, h('label', { text: S.settingsLabels.volume }), vol)),
      h('div', { class: 'setting-row' }, h('div', {}, h('label', { text: S.settingsLabels.shake }), h('div', { class: 'desc', text: '피격·펄스 시 화면 흔들림' })), shake),
      h('div', { class: 'setting-row' }, h('div', {}, h('label', { text: S.settingsLabels.touch }), h('div', { class: 'desc', text: '가상 조이스틱과 버튼' })), seg('touch', [['auto', S.settingsLabels.touchAuto, true], ['on', S.settingsLabels.touchOn, true], ['off', S.settingsLabels.touchOff, true]])),
      h('div', { class: 'setting-row' }, h('div', {}, h('label', { text: S.settingsLabels.palette }), h('div', { class: 'desc', text: altUnlocked ? '해금됨' : `해금 조건: ${S.unlockHint.palette_alt}` })), seg('palette', [['default', S.settingsLabels.paletteDefault, true], ['alt', S.settingsLabels.paletteAlt, altUnlocked]])),
      h('div', { class: 'setting-row' }, h('div', { attrs: { style: 'flex:1' } }, h('label', { text: S.settingsLabels.nickname }), name, nameMsg)),
      h('div', { class: 'actions' }, this.btn(S.close, back, 'primary')),
    );
    this.show('settings', card);
  }

  showControls(back: () => void): void {
    const table = h('table', { class: 'controls-table' });
    for (const [k, v] of S.controlsText) table.append(h('tr', {}, h('td', { text: k }), h('td', { html: v })));
    const card = h(
      'div',
      { class: 'card' },
      h('h2', { text: S.controls }),
      h('div', { class: 'sub', text: '화면은 암흑입니다. 펄스로 벽을 보고, 소리로 적의 위치를 느끼세요. 소리는 적도 부릅니다.' }),
      table,
      h('div', { class: 'small muted', attrs: { style: 'margin-top:12px' } }, '적: ', h('b', { text: '사냥꾼' }), '(소리를 따라옴) · ', h('b', { text: '박쥐' }), '(스스로 소나를 쏨, 벽을 공짜로 보여주지만 사냥꾼도 부름) · ', h('b', { text: '거미' }), '(밟으면 피해+큰 소음) · ', h('b', { text: '포식자' }), '(5층부터, 잠들어 있음)'),
      h('div', { class: 'actions' }, this.btn(S.close, back, 'primary')),
    );
    this.show('controls', card);
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
    for (const [id, label] of boards) {
      tabs.append(h('button', { text: label, class: id === board ? 'active' : '', on: () => this.showRanking(id, back) }));
    }
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
