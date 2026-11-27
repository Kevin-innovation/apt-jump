import { PASSWORD_MAX, PASSWORD_MIN } from '../username';
import { costumeById } from '../shop';
import { errorText, type AdminMember, type AdminShop, type Online } from './types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const num = (n: number) => n.toLocaleString('ko-KR');
const when = (t: number | null) => t === null ? '-' : new Date(t).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const ACTIONS: Record<string, string> = { resetPassword: '비밀번호 재설정', suspend: '정지', unsuspend: '정지 해제', revokeSessions: '모든 기기 로그아웃', coins: '코인 조정', revokeCostume: '코스튬 회수' };
const el = (tag: string, cls: string, text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };

/**
 * The admin page. It only shows what the server answers and sends what the admin asks: the server checks, on every
 * call, that the session is the admin's.
 */
export class AdminScreen {
  private search = '';
  private selected: AdminMember | null = null;
  private ticket = 0;
  private detailTicket = 0;
  /** What waits for the confirm button, always about the member now selected. */
  private pending: (() => Promise<void>) | null = null;

  constructor(private online: () => Online | null) {
    ($('admin-search') as HTMLFormElement).addEventListener('submit', (e) => {
      e.preventDefault();
      this.search = ($('admin-q') as HTMLInputElement).value.trim();
      void this.members(null, true);
    });
    ($('admin-reset') as HTMLFormElement).addEventListener('submit', (e) => { e.preventDefault(); this.reset(); });
    $('admin-suspend').addEventListener('click', () => {
      const m = this.selected;
      if (m) this.ask(m.suspended ? '정지를 풀까요?' : '정지하고 로그아웃할까요?', () => this.suspend(m));
    });
    $('admin-revoke').addEventListener('click', () => {
      const m = this.selected;
      if (m) this.ask('모든 기기에서 로그아웃할까요?', () => this.revoke(m));
    });
    ($('admin-coins') as HTMLFormElement).addEventListener('submit', (e) => { e.preventDefault(); this.coins(); });
    $('admin-yes').addEventListener('click', () => { const f = this.pending; this.cancel(); void f?.(); });
    $('admin-no').addEventListener('click', () => this.cancel());
  }

  /** Shows what is about to happen and to whom; only the confirm button does it. */
  private ask(question: string, run: () => Promise<void>): void {
    const m = this.selected!;
    this.pending = run;
    $('admin-confirm-who').textContent = `대상: ${m.nickname ?? m.username ?? '(닉네임 없음)'}`;
    $('admin-confirm-what').textContent = question;
    $('admin-confirm').hidden = false;
    $('admin-no').focus();
  }

  private cancel(): void {
    this.pending = null;
    $('admin-confirm').hidden = true;
  }

  /** Forgets the selected member, with anything typed or waiting for them. */
  private deselect(): void {
    this.cancel();
    this.detailTicket++;
    this.selected = null;
    ($('admin-pass') as HTMLInputElement).value = '';
    $('admin-detail').hidden = true;
  }

  private say(text: string): void { $('admin-msg').textContent = text; }

  /** Takes everything off the page, and drops answers still on their way: for when the account is gone or changed. */
  clear(): void {
    this.ticket++;
    this.deselect();
    this.say('');
    this.search = '';
    ($('admin-q') as HTMLInputElement).value = '';
    for (const id of ['admin-stats', 'admin-members', 'admin-logs', 'admin-detail-name', 'admin-detail-info', 'admin-confirm-who']) $(id).replaceChildren();
  }

  async open(): Promise<void> {
    const online = this.online();
    this.clear();
    if (!online) { this.say('온라인에 연결되지 않았어요.'); return; }
    const ticket = ++this.ticket;
    try {
      const s = await online.admin.stats();
      if (ticket !== this.ticket) return;
      const capped = (n: number) => n >= s.cap ? `${num(n)}+` : num(n);
      $('admin-stats').replaceChildren(...([
        ['전체 회원', capped(s.members)], ['7일 가입', capped(s.signups7d)], ['7일 활동', capped(s.active7d)],
        ['7일 플레이', num(s.plays7d)], ['오늘 플레이', num(s.playsToday)], ['이번 주 기록', capped(s.weeklyRecords)],
        ['공유 맵', capped(s.maps)], ['정지 계정', capped(s.suspended)],
      ] as const).map(([label, value]) => { const d = el('div', ''); d.append(el('span', '', label), el('b', '', value)); return d; }));
    } catch (e) {
      $('admin-stats').replaceChildren();
      this.say(errorText(e));
      return;
    }
    await Promise.all([this.members(null, true), this.logs(null, true)]);
  }

  private more(box: HTMLElement, next: () => void): void {
    const b = el('button', 'small', '더 보기') as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', () => { b.remove(); next(); });
    box.append(b);
  }

  private async members(cursor: string | null, fresh: boolean): Promise<void> {
    const online = this.online(), box = $('admin-members');
    if (!online) return;
    const ticket = this.ticket;
    try {
      const r = await online.admin.members(this.search, cursor);
      if (ticket !== this.ticket) return;
      if (fresh) box.replaceChildren();
      for (const m of r.page) {
        const row = el('button', 'admin-member') as HTMLButtonElement;
        row.type = 'button';
        row.append(el('span', '', m.nickname ?? '(닉네임 없음)'), el('small', '', `${m.username ?? '-'}${m.admin ? ' · 관리자' : ''}${m.suspended ? ' · 정지' : ''}`));
        row.addEventListener('click', () => void this.detail(m.id));
        box.append(row);
      }
      if (!box.childElementCount) box.append(el('p', 'keys', '회원이 없어요.'));
      if (!r.isDone) this.more(box, () => void this.members(r.continueCursor, false));
    } catch (e) { if (ticket === this.ticket) this.say(errorText(e)); }
  }

  private async logs(cursor: string | null, fresh: boolean): Promise<void> {
    const online = this.online(), box = $('admin-logs');
    if (!online) return;
    const ticket = this.ticket;
    try {
      const r = await online.admin.logs(cursor);
      if (ticket !== this.ticket) return;
      if (fresh) box.replaceChildren();
      for (const l of r.page) {
        const row = el('div', 'admin-log');
        // Coins moved, or the costume taken back and what was refunded.
        const what = l.action === 'coins' && l.amount !== undefined ? ` ${l.amount > 0 ? '+' : ''}${num(l.amount)}`
          : l.action === 'revokeCostume' ? ` ${costumeById(l.note).name}${l.amount ? ` (환불 ${num(l.amount)})` : ''}` : '';
        row.append(el('span', '', `${ACTIONS[l.action] ?? l.action}${what} · ${l.target}`), el('small', '', `${when(l.at)}${l.sessions ? ` · 세션 ${l.sessions}개 종료` : ''}`));
        box.append(row);
      }
      if (!box.childElementCount) box.append(el('p', 'keys', '기록이 없어요.'));
      if (!r.isDone) this.more(box, () => void this.logs(r.continueCursor, false));
    } catch (e) { if (ticket === this.ticket) this.say(errorText(e)); }
  }

  private async detail(id: string): Promise<void> {
    const online = this.online();
    if (!online) return;
    this.deselect();
    const ticket = this.detailTicket;
    try {
      const { member: m, sessions, shop } = await online.admin.detail(id);
      // Another member was picked while this answer was on its way.
      if (ticket !== this.detailTicket) return;
      this.selected = m;
      $('admin-detail').hidden = false;
      $('admin-detail-name').textContent = m.nickname ?? '(닉네임 없음)';
      $('admin-detail-info').replaceChildren(...([
        ['아이디', m.username ?? '-'], ['상태', m.suspended ? '정지' : '정상'], ['가입', when(m.joinedAt)],
        ['최근 활동', when(m.lastActiveAt)], ['플레이', num(m.plays)], ['로그인 기기', num(sessions)],
      ] as const).map(([k, v]) => { const d = el('div', ''); d.append(el('dt', '', k), el('dd', '', v)); return d; }));
      this.wallet(shop);
      const suspend = $('admin-suspend') as HTMLButtonElement;
      suspend.textContent = m.suspended ? '정지 해제' : '정지';
      suspend.disabled = m.admin;
      $('admin-detail').scrollIntoView({ block: 'nearest' });
    } catch (e) { if (ticket === this.detailTicket) this.say(errorText(e)); }
  }

  /** The member's coins, and each costume they bought with a way to take it back (with or without a refund). */
  private wallet(shop: AdminShop): void {
    $('admin-coin-now').textContent = `지금 ${num(shop.coins)}코인 · 지금까지 받은 ${num(shop.coinsEarned)}코인`;
    const box = $('admin-costumes');
    if (!shop.owned.length) { box.replaceChildren(el('p', 'help', '산 코스튬이 없어요.')); return; }
    box.replaceChildren(...shop.owned.map((id) => {
      const c = costumeById(id), row = el('div', 'admin-costume');
      const take = (refund: boolean) => {
        const b = el('button', 'small', refund ? `회수 + ${num(c.price)} 환불` : '회수만') as HTMLButtonElement;
        b.type = 'button';
        b.addEventListener('click', () => this.ask(`${c.name}을(를) ${refund ? `회수하고 ${num(c.price)}코인을 돌려줄까요?` : '회수할까요? (환불 없음)'}`, () => this.revokeCostume(id, refund)));
        return b;
      };
      row.append(el('span', '', `${c.name}${shop.costume === id ? ' · 착용 중' : ''}`), take(true), take(false));
      return row;
    }));
  }

  private coins(): void {
    const m = this.selected, box = $('admin-coin-delta') as HTMLInputElement;
    if (!m) return;
    const delta = Number(box.value);
    if (!Number.isInteger(delta) || delta === 0) { this.say('조정할 코인을 0이 아닌 정수로 적어 주세요.'); box.focus(); return; }
    this.say('');
    this.ask(delta > 0 ? `${num(delta)}코인을 줄까요?` : `${num(-delta)}코인을 뺄까요? (0 아래로는 안 내려가요)`, async () => {
      const online = this.online();
      if (!online) return;
      try {
        const shop = await online.admin.adjustCoins(m.id, delta);
        if (this.selected?.id === m.id) box.value = '';
        await this.after(`코인을 조정했어요. 지금 ${num(shop.coins)}코인이에요.`, m.id);
      } catch (e) { this.say(errorText(e)); }
    });
  }

  private async revokeCostume(id: string, refund: boolean): Promise<void> {
    const m = this.selected, online = this.online();
    if (!m || !online) return;
    try {
      const shop = await online.admin.revokeCostume(m.id, id, refund);
      await this.after(`${costumeById(id).name}을(를) 회수했어요. 지금 ${num(shop.coins)}코인이에요.`, m.id);
    } catch (e) { this.say(errorText(e)); }
  }

  /** Reloads after a change to `id`, keeping whoever is selected by then. */
  private async after(text: string, id: string): Promise<void> {
    // The page was cleared since this was asked for.
    if (!this.selected) return;
    this.say(text);
    const ticket = this.detailTicket;
    await this.logs(null, true);
    await this.members(null, true);
    if (ticket === this.detailTicket && this.selected?.id === id) await this.detail(id);
  }

  private reset(): void {
    const m = this.selected, box = $('admin-pass') as HTMLInputElement;
    if (!m) return;
    const password = box.value, n = [...password].length;
    if (n < PASSWORD_MIN || n > PASSWORD_MAX) { this.say(`비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 정해 주세요.`); box.focus(); return; }
    this.say('');
    this.ask('비밀번호를 바꿀까요?', async () => {
      const online = this.online();
      if (!online) return;
      try {
        const r = await online.admin.resetPassword(m.id, password);
        if (this.selected?.id === m.id) box.value = '';
        await this.after(`비밀번호를 바꿨어요. 로그인 기기 ${r.sessions}개를 로그아웃했어요.`, m.id);
      } catch (e) { this.say(errorText(e)); }
    });
  }

  private async suspend(m: AdminMember): Promise<void> {
    const online = this.online();
    if (!online) return;
    try {
      const r = await online.admin.setSuspended(m.id, !m.suspended);
      await this.after(m.suspended ? '정지를 풀었어요.' : `정지했어요. 로그인 기기 ${r.sessions}개를 로그아웃했어요.`, m.id);
    } catch (e) { this.say(errorText(e)); }
  }

  private async revoke(m: AdminMember): Promise<void> {
    const online = this.online();
    if (!online) return;
    try {
      const r = await online.admin.revokeSessions(m.id);
      await this.after(`로그인 기기 ${r.sessions}개를 로그아웃했어요.`, m.id);
    } catch (e) { this.say(errorText(e)); }
  }
}
