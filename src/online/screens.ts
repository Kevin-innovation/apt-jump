import { cleanNickname } from '../nickname';
import { parseMap, serializeMap, type GameMap } from '../maps';
import { downloadMap, mapCard, type MapActions } from '../mapscreen';
import type { MapStore } from '../mapstore';
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

  constructor(private store: MapStore, private maps: MapActions) {
    $('rank-login').addEventListener('click', () => void this.login());
    $('rank-logout').addEventListener('click', () => void this.online?.signOut().catch((e) => this.say(errorText(e))));
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

  get signedIn(): boolean { return this.online?.account().status === 'in'; }
  private say(text: string): void { $('rank-msg').textContent = text; }

  private async login(): Promise<void> {
    ($('rank-login') as HTMLButtonElement).disabled = true;
    try { await this.online?.signIn(); } catch (e) { this.say(errorText(e)); }
    ($('rank-login') as HTMLButtonElement).disabled = false;
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
    $('rank-off').textContent = this.connecting ? '온라인에 연결하는 중입니다.' : '온라인 연결을 준비하고 있습니다. 혼자 달리기, 맵 만들기, 맵 파일 주고받기는 지금도 됩니다.';
    $('rank-login').hidden = a?.status !== 'out';
    $('rank-account').hidden = a?.status !== 'in';
    $('rank-wait').hidden = a?.status !== 'loading';
    if (a?.status === 'in') {
      const box = $('nick') as HTMLInputElement;
      if (document.activeElement !== box) box.value = a.nickname ?? '';
    }
    if (a?.error) this.say(a.error);
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
        for (const t of [String(r.rank), r.nickname, `${num(r.score)}점`, `${num(r.distance)}m`]) {
          const s = document.createElement('span');
          s.textContent = t;
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
      ['플레이', () => void this.open(m.id, (map) => this.maps.play(map, null)), true],
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
    return mapCard(m.title, `${m.author} · 구간 ${m.segments}개${m.mine ? ' · 내 맵' : ''}`, buttons);
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
