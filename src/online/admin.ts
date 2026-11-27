import { PASSWORD_MAX, PASSWORD_MIN } from '../username';
import { costumeById } from '../shop';
import { errorText, type AdminDay, type AdminMember, type AdminShop, type Online } from './types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const num = (n: number) => n.toLocaleString('ko-KR');
const when = (t: number | null) => t === null ? '-' : new Date(t).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
/** How long ago, short: 방금, 5분 전, 3시간 전, 2일 전, or the date past a month. */
function ago(t: number | null, now = Date.now()): string {
  if (t === null) return '-';
  const m = Math.floor((now - t) / 60_000);
  if (m < 2) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}시간 전`;
  if (m < 60 * 24 * 30) return `${Math.floor(m / 1440)}일 전`;
  return new Date(t).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' });
}
const STATUS: Record<string, string> = { done: '등록', rejected: '무효', open: '진행 중', claimed: '확인 중' };
type SortKey = 'nickname' | 'lastActiveAt' | 'lastLoginAt' | 'lastPlayAt' | 'runs7d' | 'plays' | 'weekBest' | 'coins' | 'joinedAt';
const sortValue = (m: AdminMember, k: SortKey): number | string => k === 'nickname' ? (m.nickname ?? m.username ?? '') : k === 'weekBest' ? (m.weekBest?.score ?? -1) : (m[k] ?? -1);
/** Drops the items of a list that would show only in part, so it ends on a whole row. */
function fit(list: HTMLElement): void {
  const bottom = list.getBoundingClientRect().bottom;
  for (const li of [...list.children].reverse()) { if (li.getBoundingClientRect().bottom <= bottom + 0.5) break; li.remove(); }
}
/** The one chart colour: validated on the dark admin surface. */
const BAR = '#3987e5';

/** A single-series bar chart of 14 days: bars from the baseline, the latest and the highest labelled, a tooltip on each. */
function dayChart(days: readonly AdminDay[], value: (d: AdminDay) => number, unit: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg', W = 300, H = 96, L = 4, R = 4, T = 14, B = 14;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  const vals = days.map(value), max = Math.max(1, ...vals), step = (W - L - R) / days.length, bw = Math.max(2, step - 2);
  svg.setAttribute('aria-label', `최근 ${days.length}일: ${days.map((d, i) => `${d.day.slice(5)} ${vals[i]}${unit}`).join(', ')}`);
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  add('line', { x1: L, x2: W - R, y1: H - B + 0.5, y2: H - B + 0.5, class: 'axis' });
  add('line', { x1: L, x2: W - R, y1: y(max) + 0.5, y2: y(max) + 0.5, class: 'grid' });
  const top = vals.indexOf(max), last = vals.length - 1;
  days.forEach((d, i) => {
    const x = L + i * step + 1, v = vals[i]!, h = H - B - y(v);
    // Rounded at the data end only, square on the baseline.
    if (v > 0) {
      const r = Math.min(3, h, bw / 2), x0 = x, x1 = x + bw, y0 = y(v), yb = H - B;
      add('path', { d: `M${x0},${yb}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x1 - r}Q${x1},${y0} ${x1},${y0 + r}V${yb}Z`, fill: BAR });
    }
    // A hit area the full height of the day, bigger than the bar.
    const hit = add('rect', { x: L + i * step, y: T, width: step, height: H - T - B, class: 'hit' });
    const tip = document.createElementNS(NS, 'title'); tip.textContent = `${d.day.slice(5).replace('-', '/')} · ${num(v)}${unit}`; hit.append(tip);
    if (i % 3 === last % 3) add('text', { x: x + bw / 2, y: H - 3, class: 'tick' }, d.day.slice(5).replace('-', '/'));
    if ((i === top || i === last) && v > 0) add('text', { x: x + bw / 2, y: y(v) - 3, class: 'val' }, num(v));
  });
  return svg;
}
const ACTIONS: Record<string, string> = { resetPassword: '비밀번호 재설정', suspend: '정지', unsuspend: '정지 해제', revokeSessions: '모든 기기 로그아웃', coins: '코인 조정', revokeCostume: '코스튬 회수' };
const el = (tag: string, cls: string, text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };

/**
 * The admin page. It only shows what the server answers and sends what the admin asks: the server checks, on every
 * call, that the session is the admin's.
 */
export class AdminScreen {
  private search = '';
  private list: AdminMember[] = [];
  private sort: { key: SortKey; desc: boolean } = { key: 'lastActiveAt', desc: true };
  private page = 0;
  private selected: AdminMember | null = null;
  private ticket = 0;
  private detailTicket = 0;
  /** What waits for the confirm button, always about the member now selected. */
  private pending: (() => Promise<void>) | null = null;

  constructor(private online: () => Online | null) {
    ($('admin-search') as HTMLFormElement).addEventListener('submit', (e) => {
      e.preventDefault();
      this.search = ($('admin-q') as HTMLInputElement).value.trim();
      void this.members();
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
    $('admin-detail-close').addEventListener('click', () => this.deselect());
    $('admin-refresh').addEventListener('click', () => void this.open());
    $('admin-prev').addEventListener('click', () => { this.page--; this.table(); });
    $('admin-next').addEventListener('click', () => { this.page++; this.table(); });
    document.querySelectorAll<HTMLElement>('#admin-table th[data-sort]').forEach((th) => {
      th.tabIndex = 0;
      const go = () => {
        const key = th.dataset.sort as SortKey;
        this.sort = { key, desc: this.sort.key === key ? !this.sort.desc : key !== 'nickname' };
        this.page = 0;
        this.table();
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    // The table shows as many rows as fit, page by page.
    window.addEventListener('resize', () => { if (!$('admin').hidden) this.table(); });
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
    document.querySelectorAll('#admin-members tr.on').forEach((tr) => tr.classList.remove('on'));
  }

  private say(text: string): void { $('admin-msg').textContent = text; }

  /** Takes everything off the page, and drops answers still on their way: for when the account is gone or changed. */
  clear(): void {
    this.ticket++;
    this.deselect();
    this.say('');
    this.search = '';
    ($('admin-q') as HTMLInputElement).value = '';
    this.list = [];
    for (const id of ['admin-stats', 'admin-members', 'admin-logs', 'admin-recent', 'admin-chart-plays', 'admin-chart-players', 'admin-chart-signups', 'admin-detail-name', 'admin-detail-info', 'admin-confirm-who']) $(id).replaceChildren();
  }

  async open(): Promise<void> {
    const online = this.online();
    this.clear();
    if (!online) { this.say('온라인에 연결되지 않았어요.'); return; }
    const ticket = ++this.ticket;
    try {
      const [s, t] = await Promise.all([online.admin.stats(), online.admin.trends()]);
      if (ticket !== this.ticket) return;
      const capped = (n: number) => n >= s.cap ? `${num(n)}+` : num(n);
      const today = t.days[t.days.length - 1];
      $('admin-stats').replaceChildren(...([
        ['전체 회원', capped(s.members)], ['7일 가입', capped(s.signups7d)], ['오늘 접속', num(t.activeToday)], ['7일 접속', capped(s.active7d)],
        ['오늘 플레이', num(s.playsToday)], ['7일 플레이', num(s.plays7d)], ['오늘 플레이어', num(today?.players ?? 0)], ['이번 주 기록자', capped(s.weeklyRecords)],
        ['오늘 최고 점수', num(today?.best ?? 0)], ['보유 코인 합계', num(t.coins)], ['판매 코스튬', num(t.costumes)], ['공유 맵', capped(s.maps)], ['정지 계정', capped(s.suspended)],
      ] as const).map(([label, value]) => { const d = el('div', ''); d.append(el('span', '', label), el('b', '', value)); return d; }));
      $('admin-chart-plays').replaceChildren(dayChart(t.days, (d) => d.plays, '판'));
      $('admin-chart-players').replaceChildren(dayChart(t.days, (d) => d.players, '명'));
      $('admin-chart-signups').replaceChildren(dayChart(t.days, (d) => d.signups, '명'));
      $('admin-recent').replaceChildren(...t.recent.map((r) => {
        const li = el('li', `st-${r.status}`);
        const who = el('button', 'linkish', r.nickname ?? '(닉네임 없음)') as HTMLButtonElement;
        who.type = 'button';
        who.addEventListener('click', () => void this.detail(r.userId));
        li.append(who, el('span', 'tag', STATUS[r.status] ?? r.status), el('small', '', ago(r.at)));
        return li;
      }));
      if (!t.recent.length) $('admin-recent').append(el('li', 'admin-muted', '아직 없어요.'));
      requestAnimationFrame(() => fit($('admin-recent')));
    } catch (e) {
      $('admin-stats').replaceChildren();
      this.say(errorText(e));
      return;
    }
    await Promise.all([this.members(), this.logs()]);
  }

  /** Everyone (or who the search finds), loaded once; sorted and paged here. */
  private async members(): Promise<void> {
    const online = this.online();
    if (!online) return;
    const ticket = this.ticket;
    try {
      const all: AdminMember[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const r = await online.admin.members(this.search, cursor);
        if (ticket !== this.ticket) return;
        all.push(...r.page);
        if (r.isDone) break;
        cursor = r.continueCursor;
      }
      this.list = all;
      this.page = 0;
      $('admin-count').textContent = this.search ? `검색 ${num(all.length)}명` : `${num(all.length)}명`;
      this.table();
    } catch (e) { if (ticket === this.ticket) this.say(errorText(e)); }
  }

  /** The members' table: sorted by the chosen column, as many rows as the panel holds, a page at a time. */
  private table(): void {
    const body = $('admin-members'), { key, desc } = this.sort;
    document.querySelectorAll<HTMLElement>('#admin-table th[data-sort]').forEach((th) =>
      th.setAttribute('aria-sort', th.dataset.sort === key ? (desc ? 'descending' : 'ascending') : 'none'));
    const rows = [...this.list].sort((a, b) => {
      const x = sortValue(a, key), y = sortValue(b, key);
      const c = typeof x === 'string' ? x.localeCompare(String(y), 'ko') : x - (y as number);
      return desc ? -c : c;
    });
    // Rows that fit: the wrapper's height over one row's.
    const wrap = body.closest('.admin-table-wrap') as HTMLElement, head = wrap.querySelector('thead') as HTMLElement;
    const per = Math.max(3, Math.floor((wrap.clientHeight - head.offsetHeight) / 30));
    const pages = Math.max(1, Math.ceil(rows.length / per));
    this.page = Math.max(0, Math.min(pages - 1, this.page));
    const now = Date.now();
    body.replaceChildren(...rows.slice(this.page * per, (this.page + 1) * per).map((m) => {
      const tr = el('tr', this.selected?.id === m.id ? 'on' : '') as HTMLTableRowElement;
      tr.tabIndex = 0;
      const name = el('td', 'who');
      name.append(el('b', '', m.nickname ?? '(닉네임 없음)'), el('small', '', `${m.username ?? '-'}${m.admin ? ' · 관리자' : ''}`));
      if (m.suspended) name.append(el('span', 'tag bad', '정지'));
      const fresh = (t: number | null) => { const td = el('td', t !== null && now - t < 86_400_000 ? 'fresh' : '', ago(t, now)); td.title = when(t); return td; };
      tr.append(name, fresh(m.lastActiveAt), fresh(m.lastLoginAt), fresh(m.lastPlayAt),
        el('td', 'num', num(m.runs7d)), el('td', 'num', num(m.plays)),
        el('td', 'num', m.weekBest ? `${num(m.weekBest.score)} · ${num(m.weekBest.distance)}m` : '-'),
        el('td', 'num', num(m.coins)), el('td', '', when(m.joinedAt).split(' ').slice(0, 3).join(' ')));
      tr.addEventListener('click', () => void this.detail(m.id));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') void this.detail(m.id); });
      return tr;
    }));
    if (!rows.length) { const tr = el('tr', ''), td = el('td', 'admin-muted', '회원이 없어요.') as HTMLTableCellElement; td.colSpan = 9; tr.append(td); body.append(tr); }
    $('admin-page').textContent = `${this.page + 1} / ${pages}`;
    ($('admin-prev') as HTMLButtonElement).disabled = this.page <= 0;
    ($('admin-next') as HTMLButtonElement).disabled = this.page >= pages - 1;
  }

  private async logs(): Promise<void> {
    const online = this.online(), box = $('admin-logs');
    if (!online) return;
    const ticket = this.ticket;
    try {
      const r = await online.admin.logs(null);
      if (ticket !== this.ticket) return;
      box.replaceChildren(...r.page.map((l) => {
        // Coins moved, or the costume taken back and what was refunded.
        const what = l.action === 'coins' && l.amount !== undefined ? ` ${l.amount > 0 ? '+' : ''}${num(l.amount)}`
          : l.action === 'revokeCostume' ? ` ${costumeById(l.note).name}${l.amount ? ` (환불 ${num(l.amount)})` : ''}` : '';
        const li = el('li', '');
        li.append(el('span', '', `${ACTIONS[l.action] ?? l.action}${what} · ${l.target}`), el('small', '', `${ago(l.at)}${l.sessions ? ` · 세션 ${l.sessions}개 종료` : ''}`));
        li.title = when(l.at);
        return li;
      }));
      if (!box.childElementCount) box.append(el('li', 'admin-muted', '기록이 없어요.'));
      requestAnimationFrame(() => fit(box));
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
        ['최근 접속', `${ago(m.lastActiveAt)} (${when(m.lastActiveAt)})`], ['최근 로그인', `${ago(m.lastLoginAt)} (${when(m.lastLoginAt)})`],
        ['최근 플레이', `${ago(m.lastPlayAt)} (${when(m.lastPlayAt)})`], ['전체 판', num(m.plays)], ['7일 판', num(m.runs7d)],
        ['주간 최고', m.weekBest ? `${num(m.weekBest.score)}점 · ${num(m.weekBest.distance)}m` : '-'], ['로그인 기기', num(sessions)],
      ] as const).map(([k, v]) => { const d = el('div', ''); d.append(el('dt', '', k), el('dd', '', v)); return d; }));
      this.wallet(shop);
      const suspend = $('admin-suspend') as HTMLButtonElement;
      suspend.textContent = m.suspended ? '정지 해제' : '정지';
      suspend.disabled = m.admin;
      this.table();
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
    await this.logs();
    await this.members();
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
