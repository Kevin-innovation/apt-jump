import { cleanUsername, PASSWORD_MAX, PASSWORD_MIN } from '../username';
import { cleanNickname } from '../nickname';
import { titleClasses } from '../title-style';
import { parseMap, serializeMap, type GameMap } from '../maps';
import { downloadMap, mapCard, type MapActions } from '../mapscreen';
import type { MapStore } from '../mapstore';
import { timeText } from '../mapreplay';
import { weekEnd, weekKey } from '../week';
import { errorText, type Online, type SharedMapInfo } from './types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const num = (n: number) => n.toLocaleString('ko-KR');
const note = (text: string) => { const p = document.createElement('p'); p.className = 'keys'; p.textContent = text; return p; };

/** Account, weekly ranking and shared maps. Works, with a plain notice, when nothing is connected. */
export class OnlineScreens {
  online: Online | null = null;
  /** A service exists but hasn't answered yet. */
  connecting = false;
  private ticket = 0;
  private order: 'new' | 'old' = 'new';
  private mapTicket = 0;
  private adminTicket = 0;
  private timesTicket = 0;
  /** The map whose ranking is open. */
  private timesOf = '';
  private joining = false;

  constructor(private store: MapStore, private maps: MapActions) {
    ($('auth-form') as HTMLFormElement).addEventListener('submit', (e) => { e.preventDefault(); void this.enter(); });
    $('auth-switch').addEventListener('click', () => { this.setJoining(!this.joining); this.say(''); $('auth-id').focus(); });
    this.setJoining(false);
    $('rank-logout').addEventListener('click', () => this.signOut());
    const form = $('nick-form') as HTMLFormElement;
    form.addEventListener('submit', (e) => { e.preventDefault(); void this.rename(); });
    $('shared-order').addEventListener('click', () => { this.order = this.order === 'new' ? 'old' : 'new'; void this.refreshMaps(); });
    setInterval(() => { if (!$('ranking').hidden) this.countdown(); }, 1000);
    this.refresh();
  }

  attach(online: Online): void {
    this.online = online;
    this.connecting = false;
    online.onAccount(() => this.refresh());
    this.refresh();
  }

  /** Signed in, with the nickname that ranking and maps show. */
  get signedIn(): boolean { const a = this.online?.account(); return a?.status === 'in' && a.nickname !== null; }
  private say(text: string): void { $('rank-msg').textContent = text; }

  setJoining(on: boolean): void {
    this.joining = on;
    this.title();
    $('auth-go').textContent = on ? '가입하고 시작' : '로그인';
    $('auth-switch').textContent = on ? '이미 계정이 있어요' : '처음이에요 · 회원가입';
    $('auth-nick-row').hidden = !on;
    document.querySelectorAll<HTMLElement>('#auth-form .join-only').forEach((e) => { e.hidden = !on; });
    ($('auth-nick') as HTMLInputElement).required = on;
    const pass = $('auth-pass') as HTMLInputElement;
    pass.setAttribute('autocomplete', on ? 'new-password' : 'current-password');
    pass.setAttribute('aria-describedby', on ? 'auth-pass-help rank-msg' : 'rank-msg');
  }

  private title(): void {
    const a = this.online?.account();
    $('account-title').textContent = a?.status === 'in' ? '내 계정' : this.joining ? '회원가입' : '로그인';
  }

  /** The account screen: sign-up (true), log-in (false), or as it is (null). */
  openAccount(joining: boolean | null): void {
    this.say('');
    if (joining !== null) this.setJoining(joining);
    this.refresh();
  }

  signOut(): void {
    void this.online?.signOut().catch((e) => this.say(errorText(e)));
  }

  /** Signs in, or makes an account: what the form shows. */
  private async enter(): Promise<void> {
    const online = this.online, go = $('auth-go') as HTMLButtonElement, swap = $('auth-switch') as HTMLButtonElement;
    if (!online || go.disabled) return;
    const id = $('auth-id') as HTMLInputElement, pass = $('auth-pass') as HTMLInputElement, nick = $('auth-nick') as HTMLInputElement;
    const joining = this.joining;
    const refuse = (box: HTMLInputElement, text: string) => { this.say(text); box.focus(); };
    const nickname = cleanNickname(nick.value);
    if (joining) {
      if (!cleanUsername(id.value)) return refuse(id, '아이디는 영문으로 시작하는 4~20자의 영문·숫자·밑줄로 정해 주세요.');
      const n = [...pass.value].length;
      if (n < PASSWORD_MIN || n > PASSWORD_MAX) return refuse(pass, `비밀번호는 ${PASSWORD_MIN}자 이상 ${PASSWORD_MAX}자 이하로 정해 주세요.`);
      if (!nickname) return refuse(nick, '닉네임은 2~16자의 글자·숫자로 정해 주세요.');
    } else if (!id.value || !pass.value) return refuse(id.value ? pass : id, '아이디와 비밀번호를 입력해 주세요.');
    go.disabled = swap.disabled = true;
    this.say(joining ? '가입하는 중입니다.' : '로그인하는 중입니다.');
    try {
      if (joining) await online.signUp(id.value, pass.value, nickname!);
      else await online.signIn(id.value, pass.value);
      this.say(joining ? '가입했습니다. 이제 달리면 순위에 오릅니다!' : '로그인했습니다.');
      pass.value = nick.value = '';
      this.setJoining(false);
      (document.activeElement as HTMLElement | null)?.blur();
    } catch (e) {
      this.say(errorText(e));
      if (!joining) pass.value = '';
    }
    go.disabled = swap.disabled = false;
  }

  private async rename(): Promise<void> {
    const box = $('nick') as HTMLInputElement;
    const v = cleanNickname(box.value);
    if (!v) { this.say('닉네임은 2~16자의 글자·숫자로 정해 주세요.'); return; }
    try {
      box.value = (await this.online?.setNickname(v)) ?? v;
      box.blur();
      this.say('닉네임을 바꿨습니다.');
      void this.refreshBoard();
    } catch (e) { this.say(errorText(e)); }
  }

  /** Account parts, and whatever screen is open. */
  refresh(): void {
    const a = this.online?.account();
    $('rank-off').hidden = !!this.online;
    $('rank-off').textContent = this.connecting ? '온라인에 연결하는 중이에요.' : '순위는 온라인 연결 뒤에 보여요.';
    $('account-off').hidden = !!this.online;
    $('account-off').textContent = this.connecting ? '온라인에 연결하는 중이에요.' : '온라인 연결을 준비하고 있어요.';
    $('auth-form').hidden = a?.status !== 'out';
    $('rank-account').hidden = a?.status !== 'in';
    $('rank-wait').hidden = a?.status !== 'loading';
    this.title();
    if (a?.status === 'in') {
      const box = $('nick') as HTMLInputElement;
      if (document.activeElement !== box) box.value = a.nickname ?? '';
    }
    if (a?.status === 'in' && a.nickname === null) this.say('순위에 보일 닉네임을 정해 주세요.');
    // Only decides whether the button shows: every admin call is checked by the server.
    const admin = $('admin-open'), asked = ++this.adminTicket;
    admin.hidden = true;
    // A late answer, from before a log-out or another account, changes nothing.
    if (a?.status === 'in') void this.online?.admin.amI().then((yes) => { if (asked === this.adminTicket) admin.hidden = !yes; }, () => {});
    if (!$('ranking').hidden) void this.refreshBoard();
    if (!$('maps').hidden) void this.refreshMaps();
  }

  openRanking(): void {
    this.say('');
    this.refresh();
  }

  private countdown(): void {
    const el = $('rank-reset');
    if (!this.online) { el.textContent = ''; return; }
    const now = this.online.now();
    const left = Math.max(0, Math.floor((weekEnd(now) - now) / 1000));
    el.textContent = `${weekKey(now)} 주간 · 초기화까지 ${Math.floor(left / 86400)}일 ${Math.floor(left / 3600) % 24}시간 ${Math.floor(left / 60) % 60}분 ${left % 60}초`;
    // Recorded first: refreshing comes back through here.
    const week = weekKey(now), before = el.dataset.week;
    el.dataset.week = week;
    if (before && before !== week) void this.refreshBoard();
  }

  async refreshBoard(): Promise<void> {
    const list = $('rank-list'), mine = $('rank-mine');
    this.countdown();
    if (!this.online) { list.replaceChildren(); mine.textContent = ''; return; }
    const ticket = ++this.ticket;
    try {
      const b = await this.online.board(weekKey(this.online.now()));
      if (ticket !== this.ticket) return;
      list.replaceChildren(...b.top.map((r) => {
        const row = document.createElement('div');
        row.className = r.mine ? 'rank me' : 'rank';
        const cells: [string, string][] = [
          ['rank-place', String(r.rank)], ['rank-nick', r.nickname], ['rank-title', r.title ?? ''],
          ['rank-score', `${num(r.score)}점`], ['rank-distance', `${num(r.distance)}m`],
        ];
        for (const [cls, t] of cells) {
          const s = document.createElement('span');
          s.className = cls;
          s.textContent = t;
          // The whole text on hover, where a column cuts it short.
          if (cls === 'rank-nick' || cls === 'rank-title') s.title = t;
          if (cls === 'rank-title' && t) s.classList.add(...titleClasses(t));
          row.append(s);
        }
        return row;
      }));
      if (!b.top.length) list.append(note('이번 주 기록이 아직 없습니다. 첫 주자가 되어 보세요!'));
      mine.textContent = b.mine ? `내 순위 ${b.mine.rank === null ? '1000위 밖' : `${b.mine.rank}위`} · ${num(b.mine.score)}점`
        : this.signedIn ? '이번 주 내 기록이 없습니다.' : '로그인하고 달리면 순위에 오릅니다.';
    } catch (e) {
      if (ticket !== this.ticket) return;
      list.replaceChildren(note(errorText(e)));
      mine.textContent = '';
    }
  }

  // ---- A map's times -----------------------------------------------------

  openTimes(id: string): void {
    this.timesOf = id;
    $('mt-title').textContent = '';
    $('mt-list').replaceChildren(note('불러오는 중입니다.'));
    $('mt-mine').textContent = '';
    void this.refreshTimes();
  }

  async refreshTimes(): Promise<void> {
    const list = $('mt-list'), mine = $('mt-mine'), ticket = ++this.timesTicket;
    if (!this.online || !this.timesOf) { list.replaceChildren(note('기록은 온라인 연결 뒤에 보여요.')); return; }
    try {
      const b = await this.online.mapBoard(this.timesOf);
      if (ticket !== this.timesTicket) return;
      if (!b) { list.replaceChildren(note('내려간 맵입니다.')); mine.textContent = ''; return; }
      $('mt-title').textContent = b.title;
      list.replaceChildren(...b.top.map((r) => {
        const row = document.createElement('div');
        row.className = r.mine ? 'rank time me' : 'rank time';
        for (const t of [String(r.rank), r.nickname, timeText(r.timeMs)]) {
          const s = document.createElement('span');
          s.textContent = t;
          row.append(s);
        }
        return row;
      }));
      if (!b.top.length) list.append(note('아직 완주 기록이 없어요.'));
      mine.textContent = b.mine ? `내 기록 ${b.mine.rank === null ? '1000위 밖' : `${b.mine.rank}위`} · ${timeText(b.mine.timeMs)}`
        : this.signedIn ? '내 완주 기록이 없어요.' : '로그인하면 기록이 등록돼요.';
    } catch (e) {
      if (ticket !== this.timesTicket) return;
      list.replaceChildren(note(errorText(e)));
      mine.textContent = '';
    }
  }

  // ---- Shared maps -------------------------------------------------------

  async refreshMaps(): Promise<void> {
    const box = $('shared-list');
    $('shared-order').hidden = !this.online;
    $('shared-order').textContent = this.order === 'new' ? '최신순' : '오래된순';
    this.shelf();
    if (!this.online) {
      box.replaceChildren(note(this.connecting ? '온라인에 연결하는 중입니다.' : '온라인 공유는 준비하고 있습니다. 맵 파일을 내려받아 주고받을 수 있어요.'));
      return;
    }
    const ticket = ++this.mapTicket;
    box.replaceChildren(note('불러오는 중입니다.'));
    await this.page(null, ticket);
  }

  private async page(cursor: string | null, ticket: number): Promise<void> {
    const box = $('shared-list');
    try {
      const r = await this.online!.listMaps(this.order, cursor);
      if (ticket !== this.mapTicket) return;
      if (cursor === null) box.replaceChildren();
      else box.lastElementChild?.remove();
      box.append(...r.page.map((m) => this.card(m)));
      if (!r.isDone) {
        const more = document.createElement('button');
        more.type = 'button';
        more.textContent = '더 보기';
        more.addEventListener('click', () => { more.disabled = true; void this.page(r.continueCursor, ticket); });
        box.append(more);
      } else if (!box.childElementCount) box.append(note('아직 공유된 맵이 없습니다.'));
    } catch (e) {
      if (ticket === this.mapTicket) box.replaceChildren(note(errorText(e)));
    }
  }

  private tell(text: string): void { $('maps-msg').textContent = text; }

  /** Runs f with the map, checked again here: nothing from the network is trusted as it is. */
  private async open(id: string, f: (m: GameMap) => void): Promise<void> {
    try {
      const json = await this.online!.getMap(id);
      const r = json ? parseMap(json) : null;
      if (!r?.map || r.problems.length) { this.tell('이 맵을 열 수 없습니다.'); return; }
      if (!$('maps').hidden) f(r.map);
    } catch (e) { this.tell(errorText(e)); }
  }

  private card(m: SharedMapInfo): HTMLElement {
    const buttons: Parameters<typeof mapCard>[2] = [
      ['플레이', () => void this.open(m.id, (map) => this.maps.playShared ? this.maps.playShared(map, m.id) : this.maps.play(map, null)), true],
      ['기록', () => this.maps.times?.(m.id)],
      ['파일로', () => void this.open(m.id, downloadMap)],
    ];
    if (m.mine) {
      buttons.push(['게시 취소', (b) => {
        if (!b.dataset.sure) {
          b.dataset.sure = '1';
          b.textContent = '정말 취소';
          setTimeout(() => { delete b.dataset.sure; b.textContent = '게시 취소'; }, 3000);
          return;
        }
        this.online!.removeMap(m.id).then(() => {
          this.store.unlink(m.id);
          this.tell('게시를 취소했습니다.');
          return this.refreshMaps();
        }, (e) => this.tell(errorText(e)));
      }]);
    }
    return mapCard(m.title, `${m.author} · 구간 ${m.segments}개${m.mine ? ' · 내 맵' : ''}${m.best === null ? '' : ` · 최단 ${timeText(m.best)}`}`, buttons);
  }

  /** Adds publish buttons to the player's own maps when signed in. */
  private shelf(): void {
    document.querySelectorAll<HTMLElement>('#map-list .card[data-id]').forEach((card) => {
      card.querySelector('.publish')?.remove();
      const saved = this.store.get(card.dataset.id!);
      if (!this.signedIn || !saved || card.dataset.ok !== '1') return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'publish';
      b.textContent = saved.sharedId ? '게시본 갱신' : '온라인 게시';
      b.addEventListener('click', () => {
        b.disabled = true;
        const json = serializeMap(saved.map);
        const done = saved.sharedId
          ? this.online!.updateMap(saved.sharedId, json)
          : this.online!.publishMap(json).then((id) => this.store.link(saved.id, id));
        done.then(() => { this.tell('온라인에 게시했습니다.'); return this.refreshMaps(); }, (e) => { this.tell(errorText(e)); b.disabled = false; });
      });
      card.append(b);
    });
  }
}
