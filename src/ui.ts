import { drawPower, powerColor } from './art';
import { COMBO_TIME, FEVER_COMBO, FEVER_TIME, SAVED_COMBO, type Game } from './game';
import { LAP_EVENT_NAMES, LAP_EVENT_TEXT } from './progression';
import { POWER_KINDS, POWER_NAMES, POWER_TEXT, POWER_TIME, type PowerKind } from './items';
import { medalFor, missionText, nextMedal } from './missions';
import { PATCH_NOTES, VERSION } from './version';
import { Pager } from './pager';
import { AIR_COOLDOWN, canAirJump, HOLD_MAX } from './physics';
import type { Device, MenuAction } from './input';
import type { SaveFile } from './storage';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
export type ScreenName = 'title' | 'pause' | 'result' | 'settings' | 'credits' | 'maps' | 'editor' | 'ranking' | 'account' | 'admin' | 'maptimes' | 'items' | 'welcome' | 'achievements' | 'notes';
export type Act = 'start' | 'resume' | 'restart' | 'home' | 'settings' | 'credits' | 'back' | 'mute' | 'music' | 'sfx' | 'shake'
  | 'maps' | 'ranking' | 'achievements' | 'account' | 'admin' | 'logout' | 'items' | 'notes' | 'signup' | 'login' | 'guest' | 'newmap' | 'import' | 'ed-back' | 'ed-save' | 'ed-test';
const SCREENS: ScreenName[] = ['title', 'pause', 'result', 'settings', 'credits', 'maps', 'editor', 'ranking', 'account', 'admin', 'maptimes', 'items', 'welcome', 'achievements', 'notes'];
const GOAL_NAMES = { coins: '동전', perfects: '퍼펙트', stomps: '밟기', risks: '위험' } as const;
const VOLUME = ['끔', '작게', '보통', '크게'];
const KEYS: Record<Device, string> = {
  key: '점프 Space · ↑ · 클릭　　슬라이드 ↓　　일시정지 P · Esc　　음소거 M',
  touch: '화면을 눌러 점프 · ↓ 버튼으로 슬라이드',
  pad: '점프 아래 버튼　　슬라이드 ↓ · 왼쪽 버튼　　일시정지 스타트',
};
/** The key on each card of the title's guide, for the device in hand. */
const GUIDE_KEYS: Record<Device, Record<'jump' | 'air' | 'slide', string>> = {
  key: { jump: 'Space', air: '공중 Space', slide: '↓' },
  touch: { jump: '탭', air: '공중 탭', slide: '↓ 버튼' },
  pad: { jump: 'Ⓐ', air: '공중 Ⓐ', slide: '↓' },
};
const HINTS: Record<Device, string> = {
  key: 'Space를 짧게 / 길게 눌러 점프 높이를 조절하세요',
  touch: '화면을 짧게 / 길게 눌러 점프 높이를 조절하세요',
  pad: '아래 버튼을 짧게 / 길게 눌러 점프 높이를 조절하세요',
};
const SPEAKER = '<path d="M0 3h2l2-2v6L2 5H0z"/>';
const WAVES = '<path d="M5 3h1v2H5zM7 1h1v6H7z"/>';
const CROSS = '<path d="M5 2h1v1H5zM7 2h1v1H7zM6 3h1v2H6zM5 5h1v1H5zM7 5h1v1H7z"/>';
const num = (n: number) => n.toLocaleString('ko-KR');

export class UI {
  screen: ScreenName | null = null;
  onAct: (a: Act) => void = () => {};
  private device: Device = 'key';
  private pips = [...document.querySelectorAll<HTMLElement>('#boost i')];
  private cache = new Map<string, string>();
  /** The HUD updates every frame: look elements up once, and skip writes that change nothing. */
  private nodes = new Map<string, HTMLElement>();
  private styles = new Map<string, string>();
  private attrs = new Map<string, string>();
  private chips = new Map<PowerKind, { el: HTMLElement; bar: HTMLElement; n: HTMLElement; on: boolean }>();
  /** Screens shown a page at a time. */
  private pagers = new Map<ScreenName, Pager>();

  constructor(private save: SaveFile) {
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-act]'))
      b.addEventListener('click', () => this.onAct(b.dataset.act as Act));
    $('btn-mute').addEventListener('click', () => { this.onAct('mute'); $('btn-mute').blur(); });
    this.buildPowers();
    this.buildNotes();
    this.refresh();
  }

  /** The version on the title, and every release's notes on their own screen. */
  private buildNotes(): void {
    $('version-label').textContent = `v${VERSION}`;
    this.paged('notes', 'notes-list', 'notes-pager').set(PATCH_NOTES.map((n, i) => {
      const card = document.createElement('article');
      card.className = i === 0 ? 'note latest' : 'note';
      const head = document.createElement('h3'), when = document.createElement('small'), list = document.createElement('ul');
      head.textContent = `v${n.version} · ${n.title}`;
      when.textContent = n.date;
      for (const t of n.notes) { const li = document.createElement('li'); li.textContent = t; list.append(li); }
      card.append(head, when, list);
      return card;
    }));
  }
  /** A word about a release just applied, next to the version. */
  versionNews(t: string): void { this.text('version-news', t); }

  /** A picture of an item, for the HUD and the list. */
  private picture(kind: PowerKind): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.className = 'pic';
    c.width = c.height = 19;
    const g = c.getContext('2d');
    if (g) drawPower(g, kind, 9, 9, 0);
    return c;
  }

  private buildPowers(): void {
    const cards: HTMLElement[] = [];
    for (const kind of POWER_KINDS) {
      const el = document.createElement('div');
      el.hidden = true;
      el.title = POWER_NAMES[kind];
      const n = document.createElement('span'), box = document.createElement('i'), bar = document.createElement('b');
      bar.style.background = powerColor(kind);
      box.append(bar);
      el.append(this.picture(kind), POWER_TIME[kind] ? box : n);
      $('effects').append(el);
      this.chips.set(kind, { el, bar, n, on: false });
      const row = document.createElement('div'), words = document.createElement('p'), name = document.createElement('b');
      name.textContent = POWER_NAMES[kind];
      name.style.color = powerColor(kind);
      words.append(name, document.createElement('br'), POWER_TEXT[kind]);
      row.append(this.picture(kind), words);
      cards.push(row);
    }
    // The rules come after the items, on the same pages.
    for (const rule of $('rule-list').querySelectorAll('p')) { rule.classList.add('rule'); cards.push(rule); }
    this.paged('items', 'item-list', 'items-pager').set(cards);
  }

  /** A screen's list shown a page at a time. */
  paged(screen: ScreenName, list: string, nav: string): Pager {
    const pager = new Pager($(list), $(nav));
    this.pagers.set(screen, pager);
    return pager;
  }

  private el(id: string): HTMLElement {
    let node = this.nodes.get(id);
    if (!node) { node = $(id); this.nodes.set(id, node); }
    return node;
  }

  private text(id: string, v: string): void {
    if (this.cache.get(id) === v) return;
    this.cache.set(id, v);
    this.el(id).textContent = v;
  }

  /** Changing a style or attribute marks the DOM dirty even when the value is identical. */
  private style(id: string, prop: string, v: string): void {
    const key = `${id}.${prop}`;
    if (this.styles.get(key) === v) return;
    this.styles.set(key, v);
    (this.el(id).style as unknown as Record<string, string>)[prop] = v;
  }

  private attr(id: string, name: string, v: string): void {
    const key = `${id}.${name}`;
    if (this.attrs.get(key) === v) return;
    this.attrs.set(key, v);
    this.el(id).setAttribute(name, v);
  }

  /** Read the live flag so a change made elsewhere is never overwritten from a stale cache. */
  private hidden(id: string, hide: boolean): void {
    const node = this.el(id);
    if (node.hidden !== hide) node.hidden = hide;
  }

  show(name: ScreenName | null): void {
    this.screen = name;
    for (const s of SCREENS) $(s).hidden = s !== name;
    if (name) this.pagers.get(name)?.fit();
    this.refresh();
    if (name) {
      // Every screen is opened from its top.
      $(name).scrollTop = 0;
      const primary = this.buttons().filter((b) => b.classList.contains('primary'));
      // A screen's own main action comes before the way home at its top.
      (primary.find((b) => !b.closest('.screen-top')) ?? primary[0])?.focus({ preventScroll: true });
    }
    else (document.activeElement as HTMLElement | null)?.blur();
  }
  hud(on: boolean): void { $('hud').hidden = !on; }
  hint(on: boolean): void { $('hint').hidden = !on; }
  count(n: number | null): void {
    this.hidden('count', n === null);
    if (n !== null) this.text('count', String(n));
  }

  private buttons(): HTMLButtonElement[] {
    return this.screen ? [...$(this.screen).querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.disabled && b.checkVisibility()) : [];
  }

  menu(a: MenuAction): boolean {
    if (!this.screen) return false;
    const list = this.buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (a === 'up' || a === 'down') list[(i + (a === 'up' ? -1 : 1) + list.length * 2) % list.length]?.focus();
    else if (a === 'back') {
      if (this.screen === 'settings' || this.screen === 'credits' || this.screen === 'items' || this.screen === 'notes') this.onAct('back');
      else if (this.screen === 'pause') this.onAct('resume');
      else if (this.screen === 'welcome') this.onAct('guest');
      else if (this.screen === 'result' || this.screen === 'maps' || this.screen === 'ranking' || this.screen === 'achievements' || this.screen === 'account') this.onAct('home');
      else if (this.screen === 'admin') this.onAct('account');
      else if (this.screen === 'maptimes') this.onAct('maps');
      else if (this.screen === 'editor') this.onAct('ed-back');
    } else (list[i] ?? list.find((b) => b.classList.contains('primary')))?.click();
    return true;
  }

  /** Runs inside the input's own event, so it writes only what depends on the device. */
  setDevice(d: Device): void { this.device = d; this.deviceWords(); }

  private deviceWords(): void {
    document.querySelectorAll('[data-keys]').forEach((k) => { k.textContent = KEYS[this.device]; });
    document.querySelectorAll<HTMLElement>('.guide kbd[data-key]').forEach((k) => {
      const key = k.dataset.key as keyof (typeof GUIDE_KEYS)['key'];
      if (key in GUIDE_KEYS[this.device]) k.textContent = GUIDE_KEYS[this.device][key];
    });
    this.text('hint', HINTS[this.device]);
    this.hidden('btn-slide', this.device !== 'touch');
  }

  refresh(): void {
    const s = this.save.data;
    const set = (a: Act, t: string) =>
      document.querySelectorAll(`#settings [data-act=${a}]`).forEach((b) => { b.textContent = t; });
    set('mute', `전체 소리: ${s.muted ? '꺼짐' : '켜짐'}`);
    set('music', `음악: ${VOLUME[s.music]}`);
    set('sfx', `효과음: ${VOLUME[s.sfx]}`);
    set('shake', `화면 흔들림: ${s.shake ? '켜짐' : '꺼짐'}`);
    const mute = $('btn-mute');
    mute.setAttribute('aria-label', s.muted ? '소리 켜기' : '음소거');
    mute.innerHTML = `<svg viewBox="0 0 8 8">${SPEAKER}${s.muted ? CROSS : WAVES}</svg>`;
    this.deviceWords();
    document.querySelectorAll<HTMLElement>('[data-nosave]').forEach((e) => { e.hidden = this.save.available; });
    this.text('best', num(s.best));
  }

  update(g: Game, held = false): void {
    const charge = held && g.player.vy < 0 ? Math.min(1, g.player.holdTime / HOLD_MAX) : 0;
    this.style('jump-fill', 'transform', `scaleX(${charge})`);
    this.attr('jump-pressure', 'aria-valuenow', String(Math.round(charge * 100)));
    const meter = this.el('jump-meter');
    meter.classList.toggle('charging', charge > 0);
    meter.classList.toggle('full', charge >= 0.99);
    this.text('jump-label', charge >= 0.99 ? '최대 높이!' : charge > 0 ? '꾹 누르는 중…' : '길게 누를수록 높게');
    this.text('score', num(g.score));
    this.text('dist', `${Math.floor(g.distance)}m`);
    this.text('coins', String(g.coins));
    this.text('lv', g.progress === null ? `속도 ${g.level}` : `${Math.floor(g.progress * 100)}%`);
    const bestRow = this.el('best').parentElement!;
    if (bestRow.hidden !== (g.progress !== null)) bestRow.hidden = g.progress !== null;
    this.el('air').classList.toggle('ready', canAirJump(g.player));
    this.style('air-bar', 'transform', `scaleX(${1 - g.player.airCooldown / AIR_COOLDOWN})`);
    for (const [kind, chip] of this.chips) {
      const left = g.effect(kind), on = left > 0;
      if (on !== chip.on) { chip.on = on; chip.el.hidden = !on; }
      if (!on) continue;
      if (POWER_TIME[kind]) chip.bar.style.transform = `scaleX(${Math.min(1, left / POWER_TIME[kind])})`;
      else { const t = `x${left}`; if (chip.n.textContent !== t) chip.n.textContent = t; }
    }
    this.district(g);
    // Told a few seconds ahead, however fast the run: the sign alone comes into view late at top speed.
    const p = g.player;
    this.hidden('route-note', p.inside !== 0 || !g.world.roofs.some((r) => r.route && r.route.x + r.route.hatch > p.x && r.route.x - p.x < p.vx * 2.5));
    const m = g.mission;
    this.hidden('mission', !m);
    if (m) {
      const from = m.from ?? 0;
      this.text('mission-text', `미션 ${missionText(m)} (${Math.min(m.goal, g.tally[m.what]) - from}/${m.goal - from}) +${num(m.reward)}`);
    }
    this.combo(g);
    this.pips.forEach((p, i) => p.classList.toggle('on', g.player.boost >= i + 0.5));
  }

  /** The combo, its clock (red when it is about to run out), the saves that keep it, and the fever gauge. */
  private combo(g: Game): void {
    const fever = g.feverTime > 0, gauge = g.combo >= FEVER_COMBO || g.fever > 0 || fever;
    this.hidden('combo', g.combo < 2 && g.comboSaves === 0 && !fever);
    this.el('combo').classList.toggle('fever-on', fever);
    this.text('combo-n', String(g.combo));
    this.text('combo-x', `x${g.mult}`);
    this.style('combo-bar', 'transform', `scaleX(${Math.max(0, Math.min(1, g.comboTimer / COMBO_TIME))})`);
    this.el('combo-timer').classList.toggle('danger', this.danger(g));
    const saves = this.el('saves');
    if (saves.dataset.n !== String(g.comboSaves)) {
      saves.dataset.n = String(g.comboSaves);
      saves.setAttribute('aria-label', `콤보 세이브 ${g.comboSaves}칸`);
      saves.querySelectorAll('i').forEach((i, n) => i.classList.toggle('on', n < g.comboSaves));
      saves.hidden = g.comboSaves === 0;
    }
    this.hidden('fever', !gauge);
    this.el('fever').classList.toggle('on', fever);
    this.text('fever-label', fever ? `피버 x2 ${Math.ceil(g.feverTime)}초` : '피버');
    this.style('fever-bar', 'transform', `scaleX(${fever ? g.feverTime / FEVER_TIME : Math.min(1, g.fever)})`);
  }
  /** A combo worth keeping with under a second left on its clock. */
  danger(g: Game): boolean { return g.combo >= SAVED_COMBO && g.keepTime <= 0 && g.comboTimer > 0 && g.comboTimer < 1; }

  /** The district under the runner, its goal and the way to the next: endless runs only. */
  private district(g: Game): void {
    const info = g.districtGoal;
    const box = this.el('district');
    this.hidden('district', !info);
    if (!info) return;
    const d = info.district;
    this.text('district-name', d.lap > 1 ? `${d.name} ${d.lap}회차` : d.name);
    this.text('district-left', `다음 ${Math.ceil(d.remaining)}m`);
    this.text('district-goal', info.done ? '목표 달성' : `${GOAL_NAMES[d.goal.what]} ${info.current}/${info.goal}`);
    box.classList.toggle('done', info.done);
    this.style('district', 'borderColor', d.palette.accent);
    const event = g.lapEvent;
    this.hidden('district-event', event === 'none');
    if (event !== 'none') {
      this.text('district-event', `${LAP_EVENT_NAMES[event]} · ${LAP_EVENT_TEXT[event]}`);
      this.el('district-event').dataset.event = event;
    }
  }

  onlineNote(t: string): void { this.text('r-online', t); }
  pauseNote(t: string): void { this.text('pause-note', t); }
  /** Replaces the result's line about the best score, for runs ranked otherwise. */
  bestNote(t: string): void { this.text('r-best', t); }
  wait(t: string): void {
    $('hint').hidden = !t;
    this.text('hint', t || HINTS[this.device]);
  }

  /** Where the home button leads depends on what is being played. */
  homeLabel(t: string): void {
    document.querySelectorAll('#pause [data-act=home], #result [data-act=home]').forEach((b) => { b.textContent = t; });
  }

  /** best is null for a test play, which keeps no record. */
  result(g: Game, isBest: boolean, best: number | null): void {
    $('r-title').classList.toggle('new', isBest || g.finished);
    this.text('r-title', g.finished ? (isBest ? '완주! 신기록' : '완주!') : g.deathCause === 'traffic' ? '차량 충돌!' : isBest ? '신기록!' : '추락!');
    this.text('r-score', num(g.score));
    this.text('r-best', best === null ? '이 판은 기록을 남기지 않습니다' : `최고 점수 ${num(best)}`);
    this.text('r-dist', `${Math.floor(g.distance)}m`);
    this.text('r-coins', String(g.coins));
    this.text('r-combo', String(g.maxCombo));
    this.text('r-perfect', String(g.perfects));
    this.text('r-stomp', `${g.stomps} / ${g.slides}`);
    this.text('r-diamond', String(g.diamonds));
    this.text('r-risk', String(g.risks));
    this.text('r-power', String(g.powers));
    this.text('r-mission', String(g.missionsDone));
    const medal = g.progress === null ? medalFor(g.score) : null, next = g.progress === null ? nextMedal(g.score) : null;
    this.text('r-medal', [medal && `${medal} 획득!`, next && `${next.name}까지 ${num(next.left)}점`].filter(Boolean).join('　'));
    this.show('result');
  }
}
