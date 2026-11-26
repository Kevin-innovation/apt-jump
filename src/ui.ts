import { drawPower, powerColor } from './art';
import { COMBO_TIME, type Game } from './game';
import { POWER_KINDS, POWER_NAMES, POWER_TEXT, POWER_TIME, type PowerKind } from './items';
import { medalFor, missionText, nextMedal } from './missions';
import { AIR_COOLDOWN, canAirJump, HOLD_MAX } from './physics';
import type { Device, MenuAction } from './input';
import type { SaveFile } from './storage';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
export type ScreenName = 'title' | 'pause' | 'result' | 'settings' | 'credits' | 'maps' | 'editor' | 'ranking' | 'account' | 'admin' | 'maptimes' | 'items' | 'welcome';
export type Act = 'start' | 'resume' | 'restart' | 'home' | 'settings' | 'credits' | 'back' | 'mute' | 'music' | 'sfx' | 'shake'
  | 'maps' | 'ranking' | 'account' | 'admin' | 'logout' | 'items' | 'signup' | 'login' | 'guest' | 'newmap' | 'import' | 'ed-back' | 'ed-save' | 'ed-export' | 'ed-test';
const SCREENS: ScreenName[] = ['title', 'pause', 'result', 'settings', 'credits', 'maps', 'editor', 'ranking', 'account', 'admin', 'maptimes', 'items', 'welcome'];
const GOAL_NAMES = { coins: '동전', perfects: '퍼펙트', stomps: '밟기', risks: '위험' } as const;
const VOLUME = ['끔', '작게', '보통', '크게'];
const KEYS: Record<Device, string> = {
  key: '점프 Space · ↑ · 클릭　　일시정지 P　　음소거 M',
  touch: '화면을 눌러 점프, 오래 누르면 더 높이',
  pad: '점프 아래 버튼　　일시정지 스타트　　뒤로 오른쪽 버튼',
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

  constructor(private save: SaveFile) {
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-act]'))
      b.addEventListener('click', () => this.onAct(b.dataset.act as Act));
    $('btn-mute').addEventListener('click', () => { this.onAct('mute'); $('btn-mute').blur(); });
    this.buildPowers();
    this.refresh();
  }

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
      $('item-list').append(row);
    }
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
    this.refresh();
    if (name) this.buttons().find((b) => b.classList.contains('primary'))?.focus({ preventScroll: true });
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
      if (this.screen === 'settings' || this.screen === 'credits' || this.screen === 'items') this.onAct('back');
      else if (this.screen === 'pause') this.onAct('resume');
      else if (this.screen === 'welcome') this.onAct('guest');
      else if (this.screen === 'result' || this.screen === 'maps' || this.screen === 'ranking' || this.screen === 'account') this.onAct('home');
      else if (this.screen === 'admin') this.onAct('account');
      else if (this.screen === 'maptimes') this.onAct('maps');
      else if (this.screen === 'editor') this.onAct('ed-back');
    } else (list[i] ?? list.find((b) => b.classList.contains('primary')))?.click();
    return true;
  }

  setDevice(d: Device): void { this.device = d; this.refresh(); }

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
    document.querySelectorAll('[data-keys]').forEach((k) => { k.textContent = KEYS[this.device]; });
    document.querySelectorAll<HTMLElement>('[data-nosave]').forEach((e) => { e.hidden = this.save.available; });
    this.text('hint', HINTS[this.device]);
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
    const m = g.mission;
    this.hidden('mission', !m);
    if (m) this.text('mission-text', `미션 ${missionText(m)} (${Math.min(m.goal, g.tally[m.what])}/${m.goal}) +${m.reward}`);
    this.hidden('combo', g.combo < 2);
    if (g.combo >= 2) {
      this.text('combo-n', String(g.combo));
      this.text('combo-x', `x${g.mult}`);
      this.style('combo-bar', 'transform', `scaleX(${Math.max(0, g.comboTimer / COMBO_TIME)})`);
    }
    this.pips.forEach((p, i) => p.classList.toggle('on', g.player.boost >= i + 0.5));
  }

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
  }

  onlineNote(t: string): void { this.text('r-online', t); }
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
    this.text('r-stomp', String(g.stomps));
    this.text('r-diamond', String(g.diamonds));
    this.text('r-risk', String(g.risks));
    this.text('r-power', String(g.powers));
    this.text('r-mission', String(g.missionsDone));
    const medal = g.progress === null ? medalFor(g.score) : null, next = g.progress === null ? nextMedal(g.score) : null;
    this.text('r-medal', [medal && `${medal} 획득!`, next && `${next.name}까지 ${num(next.left)}점`].filter(Boolean).join('　'));
    this.show('result');
  }
}
