import { cleanUsername, PASSWORD_MAX, PASSWORD_MIN } from '../username';
import { cleanNickname } from '../nickname';
import { titleClasses } from '../title-style';
import { achievementById, achievementRank } from '../achievements';
import { statIcon } from '../badges';
import { costumeById } from '../shop';
import { makeSprites } from '../sprites';
import { cleanTitle, LIMITS, parseMap, type GameMap } from '../maps';
import { mapCard, type MapActions } from '../mapscreen';
import type { MapStore } from '../mapstore';
import { timeText } from '../mapreplay';
import { weekEnd, weekKey } from '../week';
import { errorText, type MapOrder, type MapVersion, type Online, type SharedMapInfo } from './types';
import { Pager } from '../pager';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const num = (n: number) => n.toLocaleString('ko-KR');
/** A still of the runner in a costume, made once per costume and reused on every row. */
const runners = new Map<string, string>();
function runnerPicture(id: string | undefined): HTMLImageElement {
  const c = costumeById(id);
  let src = runners.get(c.id);
  if (!src) { src = makeSprites(c.pal).run[1]!.toDataURL(); runners.set(c.id, src); }
  const img = document.createElement('img');
  img.className = 'rank-runner';
  img.src = src;
  img.alt = '';
  img.title = c.name;
  return img;
}
/** How many maps the latest view opens with, how many each press adds, and cards asked for per call. */
const FEED_FIRST = 3;
const FEED_MORE = 5;
const CARD_BATCH = 20;
const emptyLatest = () => ({
  loaded: [] as SharedMapInfo[], featured: [] as SharedMapInfo[], best: new Set<string>(), hot: new Set<string>(),
  cursor: null as string | null, done: false, shown: FEED_FIRST,
});
/** A section's name in the latest view. */
function heading(text: string): HTMLElement {
  const h = document.createElement('h3');
  h.className = 'feed-head';
  h.textContent = text;
  return h;
}
/** The shared list's orders: each press of the button moves to the next. */
const ORDER_NAMES: Record<MapOrder, string> = { new: '최신순', old: '오래된순', popular: '인기순' };
const NEXT_ORDER: Record<MapOrder, MapOrder> = { new: 'old', old: 'popular', popular: 'new' };
/** How long a newly shared map wears its NEW tag. */
const NEW_FOR = 24 * 3_600_000;
/** How often the title looks for a newly shared map. */
const NEW_CHECK = 60_000;
const note = (text: string) => { const p = document.createElement('p'); p.className = 'keys'; p.textContent = text; return p; };

/** A scoreboard over a ranking whose first place is shared, naming everyone on it. Null otherwise. */
function tieBoard(top: readonly { rank: number; nickname: string }[], record: string): HTMLElement | null {
  const firsts = top.filter((r) => r.rank === 1);
  if (firsts.length < 2) return null;
  const board = document.createElement('div');
  board.className = 'tie-board';
  board.dataset.extra = '1';
  for (const [cls, text] of [['tie-head', `공동 1위 · ${firsts.length}명`], ['tie-names', firsts.map((r) => r.nickname).join(' · ')], ['tie-record', record]]) {
    const s = document.createElement('span');
    s.className = cls!;
    s.textContent = text!;
    board.append(s);
  }
  return board;
}

const KOREA = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** When a record was set, in Korean time to the second: YYYY.MM.DD HH:mm:ss. Empty when unknown. */
function recordedAt(at: number | undefined): HTMLTimeElement {
  const el = document.createElement('time');
  el.className = 'rank-date';
  if (at === undefined) return el;
  const p = Object.fromEntries(KOREA.formatToParts(at).map((x) => [x.type, x.value]));
  el.textContent = `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}:${p.second}`;
  el.dateTime = new Date(at).toISOString();
  el.title = `${el.textContent} (한국 시간)`;
  return el;
}

/** A shared map's counts in one row: starts, then completions, and at the far right the share that finished. */
function playStats(m: SharedMapInfo): HTMLElement {
  // One period for all three, so the rate means something (the lifetime count has no record of old failed runs).
  const started = m.rateAttempts ?? 0, done = m.rateCompletions ?? 0;
  const row = document.createElement('div');
  row.className = 'map-stats';
  row.title = '3.7.1부터 센 값이에요';
  for (const [cls, text] of [['starts', `누적 플레이 ${num(started)}회`], ['done', `누적 완주 ${num(done)}회`], ['rate', `완주율 ${started ? `${Math.floor((done / started) * 100)}%` : '-'}`]] as const) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    row.append(s);
  }
  return row;
}

/** The row of labels on a card's top left corner; the card's lines move down to make room for it. */
function cardTags(card: HTMLElement): HTMLElement {
  let row = card.querySelector<HTMLElement>(':scope > .card-tags');
  if (!row) {
    row = document.createElement('span');
    row.className = 'card-tags';
    card.prepend(row);
  }
  return row;
}

/** The badges by tracked starts: what each says on hover. */
const BADGES = { best: ['BEST!', '플레이가 가장 많은 맵'], hot: ['HOT', '플레이가 두 번째로 많은 맵'] } as const;

/** Puts a card's badge on, after NEW or UPDATE where there is one, changes it, or (null) takes it off. */
function markBadge(card: HTMLElement, badge: keyof typeof BADGES | null): void {
  const had = card.querySelector('.best-tag, .hot-tag');
  if (had && had.className !== `${badge}-tag`) {
    const row = had.parentElement!;
    had.remove();
    if (!row.childElementCount) row.remove();
  }
  card.classList.toggle('is-best', badge === 'best');
  card.classList.toggle('is-hot', badge === 'hot');
  if (!badge || card.querySelector(`.${badge}-tag`)) return;
  const tag = document.createElement('span');
  tag.className = `${badge}-tag`;
  [tag.textContent, tag.title] = BADGES[badge];
  cardTags(card).append(tag);
}

/** Account, weekly ranking and shared maps. Works, with a plain notice, when nothing is connected. */
export class OnlineScreens {
  online: Online | null = null;
  /** A service exists but hasn't answered yet. */
  connecting = false;
  private ticket = 0;
  private order: MapOrder = 'new';
  /** The map times screen shows an earlier content: which of them, and the list once fetched. */
  private older = false;
  private versionAt = 0;
  private versions: MapVersion[] | null = null;
  private mapTicket = 0;
  private adminTicket = 0;
  private timesTicket = 0;
  /** The map whose ranking is open. */
  private timesOf = '';
  private joining = false;
  /** The weekly board and a map's times, a page at a time. */
  private rankPages = new Pager($('rank-list'), $('rank-pager'), 10);
  private timePages = new Pager($('mt-list'), $('mt-pager'), 10);
  private sharedPages = new Pager($('shared-list'), $('shared-pager'));
  private sharedItems: HTMLElement[] = [];
  /** The latest view: every map read so far in list order, the badge holders' cards, and how far the feed is open. */
  private latest = emptyLatest();
  /** The player's own map cards, from the shelf: each has a share button to bring to life. */
  myCards: () => HTMLElement[] = () => [];

  constructor(private store: MapStore, private maps: MapActions) {
    ($('auth-form') as HTMLFormElement).addEventListener('submit', (e) => { e.preventDefault(); void this.enter(); });
    $('auth-switch').addEventListener('click', () => { this.setJoining(!this.joining); this.say(''); $('auth-id').focus(); });
    this.setJoining(false);
    $('rank-logout').addEventListener('click', () => this.signOut());
    const form = $('nick-form') as HTMLFormElement;
    form.addEventListener('submit', (e) => { e.preventDefault(); void this.rename(); });
    ($('map-rename-title') as HTMLInputElement).maxLength = LIMITS.title;
    $('map-rename').addEventListener('submit', (e) => { e.preventDefault(); void this.saveName(); });
    $('map-rename-cancel').addEventListener('click', () => this.closeName());
    // Keys typed in the box are its own: not the pager's arrows, and Esc only closes the box.
    $('map-rename').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); this.closeName(); } });
    $('shared-order').addEventListener('click', () => { this.order = NEXT_ORDER[this.order]; void this.refreshMaps(); });
    $('mt-now').addEventListener('click', () => this.showVersions(false));
    $('mt-old').addEventListener('click', () => this.showVersions(true));
    $('mt-newer').addEventListener('click', () => this.showVersions(true, this.versionAt - 1));
    $('mt-older').addEventListener('click', () => this.showVersions(true, this.versionAt + 1));
    setInterval(() => { if (!$('ranking').hidden) this.countdown(); }, 1000);
    // Someone else may share a map while the title waits: ask again now and then, only while it can be seen.
    setInterval(() => { if (!$('title').hidden && !document.hidden) void this.refreshNewMaps(); }, NEW_CHECK);
    this.refresh();
  }

  attach(online: Online): void {
    this.online = online;
    this.connecting = false;
    online.onAccount(() => this.refresh());
    this.refresh();
    void this.refreshNewMaps();
  }

  private newTicket = 0;
  private newTimer = 0;
  /** The title's NEW on the user maps button: up while some map is as new as the cards' own NEW tag. */
  async refreshNewMaps(): Promise<void> {
    const online = this.online, ticket = ++this.newTicket;
    if (!online) return;
    try {
      const at = await online.newestMap();
      if (ticket === this.newTicket) this.showNewMaps(at === null ? 0 : at + NEW_FOR - online.now());
    } catch { /* no answer: what shows stays, until its time is up */ }
  }
  /** Shows the label for `left` more milliseconds. */
  private showNewMaps(left: number): void {
    clearTimeout(this.newTimer);
    const on = left > 0;
    $('maps-new').hidden = !on;
    if (on) $('title-maps').setAttribute('aria-label', '유저 맵, 새 공유 맵 있음');
    else $('title-maps').removeAttribute('aria-label');
    // A page left open takes it down when the day is over.
    if (on) this.newTimer = window.setTimeout(() => this.showNewMaps(0), Math.min(left, NEW_FOR));
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
    const mine = $('rank-mine');
    this.countdown();
    if (!this.online) { this.rankPages.set([]); mine.textContent = ''; return; }
    const ticket = ++this.ticket;
    try {
      const b = await this.online.board(weekKey(this.online.now()));
      if (ticket !== this.ticket) return;
      const tied = tieBoard(b.top, `${num(b.top[0]?.score ?? 0)}점`);
      const rows = b.top.map((r) => {
        const row = document.createElement('div');
        row.className = r.mine ? 'rank me' : 'rank';
        if (tied && r.rank === 1) row.classList.add('tied');
        // Gold, silver and bronze for the first three places.
        if (r.rank <= 3) row.dataset.top = String(r.rank);
        const cells: [string, string][] = [
          ['rank-place', String(r.rank)], ['rank-nick', r.nickname], ['rank-badge', ''], ['rank-title', r.title ?? ''],
          ['rank-score', `${num(r.score)}점`], ['rank-distance', `${num(r.distance)}m`],
        ];
        for (const [cls, t] of cells) {
          const s = document.createElement('span');
          s.className = cls;
          s.textContent = t;
          // The whole text on hover, where a column cuts it short.
          if (cls === 'rank-nick' || cls === 'rank-title') s.title = t;
          if (cls === 'rank-title' && t) s.classList.add(...titleClasses(t));
          // The runner in the costume they wear, before their name.
          if (cls === 'rank-nick') s.prepend(runnerPicture(r.costume));
          // The badge, left of the title: the achievement's stat on its rarity's colour.
          const badge = cls === 'rank-badge' ? achievementById(r.badge) : null;
          if (badge) {
            s.classList.add('ach-badge', `r${achievementRank(badge.id)}`);
            s.replaceChildren(statIcon(badge.stat));
            s.title = `대표 도전과제: ${badge.name}`;
          }
          row.append(s);
        }
        return row;
      });
      this.rankPages.set(b.top.length ? [...(tied ? [tied] : []), ...rows] : [note('이번 주 기록이 아직 없습니다. 첫 주자가 되어 보세요!')], true);
      mine.textContent = b.mine ? `내 순위 ${b.mine.rank === null ? '1000위 밖' : `${b.mine.rank}위`} · ${num(b.mine.score)}점`
        : this.signedIn ? '이번 주 내 기록이 없습니다.' : '로그인하고 달리면 순위에 오릅니다.';
    } catch (e) {
      if (ticket !== this.ticket) return;
      this.rankPages.set([note(errorText(e))]);
      mine.textContent = '';
    }
  }

  // ---- A map's times -----------------------------------------------------

  /** Switches the map times between the current content and the earlier ones. */
  private showVersions(older: boolean, at = 0): void {
    // Coming to the earlier ones asks for the list afresh: an update may have added one.
    if (older && !this.older) this.versions = null;
    this.older = older;
    this.versionAt = at;
    this.timePages.set([note('불러오는 중입니다.')]);
    $('mt-mine').textContent = '';
    void this.refreshTimes();
  }

  openTimes(id: string): void {
    this.timesOf = id;
    this.older = false;
    this.versions = null;
    this.versionAt = 0;
    $('mt-title').textContent = '';
    this.timePages.set([note('불러오는 중입니다.')]);
    $('mt-mine').textContent = '';
    void this.refreshTimes();
  }

  async refreshTimes(): Promise<void> {
    const mine = $('mt-mine'), ticket = ++this.timesTicket;
    const older = this.older;
    $('mt-now').setAttribute('aria-selected', String(!older));
    $('mt-old').setAttribute('aria-selected', String(older));
    if (!older) $('mt-version').hidden = true;
    if (!this.online || !this.timesOf) { this.timePages.set([note('기록은 온라인 연결 뒤에 보여요.')]); return; }
    try {
      let version: MapVersion | undefined;
      if (older) {
        const list = this.versions ?? await this.online.mapVersions(this.timesOf);
        if (ticket !== this.timesTicket) return;
        this.versions = list;
        this.versionAt = Math.max(0, Math.min(list.length - 1, this.versionAt));
        version = list[this.versionAt];
        $('mt-version').hidden = !version;
        $('mt-title').textContent = '';
        if (!version) { this.timePages.set([note('기록이 남은 이전 버전이 없어요.')]); mine.textContent = ''; return; }
        $('mt-version-label').replaceChildren(`${version.title} · ${this.versionAt + 1}/${list.length}`, recordedAt(version.sharedAt));
        ($('mt-newer') as HTMLButtonElement).disabled = this.versionAt === 0;
        ($('mt-older') as HTMLButtonElement).disabled = this.versionAt === list.length - 1;
      }
      const b = await this.online.mapBoard(this.timesOf, version?.bodyId);
      if (ticket !== this.timesTicket) return;
      if (!b) { this.timePages.set([note('내려간 맵입니다.')]); mine.textContent = ''; return; }
      if (!older) $('mt-title').textContent = b.title;
      const tied = tieBoard(b.top, b.top[0] ? timeText(b.top[0].timeMs) : '');
      const rows = b.top.map((r) => {
        const row = document.createElement('div');
        row.className = r.mine ? 'rank time me' : 'rank time';
        if (tied && r.rank === 1) row.classList.add('tied');
        // Gold, silver and bronze for the first three places.
        if (r.rank <= 3) row.dataset.top = String(r.rank);
        for (const [cls, t] of [['rank-place', String(r.rank)], ['rank-nick', r.nickname], ['rank-record', timeText(r.timeMs)]] as const) {
          const s = document.createElement('span');
          s.className = cls;
          s.textContent = t;
          if (cls === 'rank-nick') s.title = t;
          row.append(s);
        }
        row.append(recordedAt(r.achievedAt));
        return row;
      });
      this.timePages.set(b.top.length ? [...(tied ? [tied] : []), ...rows] : [note('아직 완주 기록이 없어요.')], true);
      mine.textContent = b.mine ? `내 기록 ${b.mine.rank === null ? '1000위 밖' : `${b.mine.rank}위`} · ${timeText(b.mine.timeMs)}`
        : older ? '이 버전에는 내 기록이 없어요.' : this.signedIn ? '내 완주 기록이 없어요.' : '로그인하면 기록이 등록돼요.';
      // Its date has a line of its own.
      if (b.mine?.achievedAt !== undefined) mine.append(recordedAt(b.mine.achievedAt));
    } catch (e) {
      if (ticket !== this.timesTicket) return;
      this.timePages.set([note(errorText(e))]);
      mine.textContent = '';
    }
  }

  // ---- Shared maps -------------------------------------------------------

  async refreshMaps(): Promise<void> {
    this.closeName();
    $('shared-order').hidden = !this.online;
    $('shared-order').textContent = ORDER_NAMES[this.order];
    this.shelf();
    if (!this.online) {
      this.sharedPages.set([note(this.connecting ? '온라인에 연결하는 중입니다.' : '온라인 공유는 준비하고 있습니다. 맵 파일을 내려받아 주고받을 수 있어요.')]);
      return;
    }
    const ticket = ++this.mapTicket;
    // The latest view has the badge holders over the newest maps; every view is shown a page at a time.
    const latest = this.order === 'new';
    this.sharedPages.set([note('불러오는 중입니다.')]);
    if (!latest) { await this.page(null, ticket); return; }
    this.latest = emptyLatest();
    try {
      await this.fill(ticket);
      if (ticket === this.mapTicket) this.showLatest(false);
    } catch (e) {
      if (ticket === this.mapTicket) this.sharedPages.set([note(errorText(e))]);
    }
  }

  /** The feed: every map read that holds no badge, in the order read. */
  private feed(): SharedMapInfo[] {
    const s = this.latest;
    return s.loaded.filter((m) => !s.best.has(m.id) && !s.hot.has(m.id));
  }

  /** Reads pages until the feed has as many maps as are open (or there are no more), then the badge holders' cards. */
  private async fill(ticket: number): Promise<void> {
    const s = this.latest, online = this.online!;
    let read = false;
    while (!s.done && (!read || this.feed().length < s.shown)) {
      const r = await online.listMaps('new', s.cursor);
      if (ticket !== this.mapTicket) return;
      read = true;
      const had = new Set(s.loaded.map((m) => m.id));
      s.loaded.push(...r.page.filter((m) => !had.has(m.id)));
      // Counts move: the latest answer says who holds the badges now. One who lost it is back in the feed by itself.
      s.best = new Set(r.bestIds ?? []);
      s.hot = new Set(r.hotIds ?? []);
      s.cursor = r.continueCursor;
      s.done = r.isDone;
    }
    // Every holder is shown, however many tie, wherever in the list they are; asked for in small batches.
    const ids = [...s.best, ...s.hot], cards: SharedMapInfo[] = [];
    for (let i = 0; i < ids.length; i += CARD_BATCH) {
      cards.push(...await online.mapCards(ids.slice(i, i + CARD_BATCH)));
      if (ticket !== this.mapTicket) return;
    }
    s.featured = cards;
  }

  /** The badge holders (BEST! first, then HOT, the latest changed first), then the newest maps and the way to more. */
  private showLatest(keep: boolean): void {
    const s = this.latest;
    const card = (m: SharedMapInfo) => {
      const el = this.card(m);
      markBadge(el, s.best.has(m.id) ? 'best' : s.hot.has(m.id) ? 'hot' : null);
      return el;
    };
    const rank = (m: SharedMapInfo) => (s.best.has(m.id) ? 0 : 1);
    const top = [...s.featured].sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map(card);
    const all = this.feed(), feed = all.slice(0, s.shown).map(card);
    const items = [...(top.length ? [heading('인기 맵'), ...top, ...(feed.length ? [heading('최신 맵')] : [])] : []), ...feed];
    if (all.length > s.shown || !s.done) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more';
      more.textContent = `${FEED_MORE}개 더 보기`;
      more.addEventListener('click', () => { more.disabled = true; void this.openMore(more); });
      items.push(more);
    }
    this.sharedItems = items;
    this.sharedPages.set(items.length ? items : [note('아직 공유된 맵이 없습니다.')], keep);
  }

  private async openMore(button: HTMLButtonElement): Promise<void> {
    const ticket = this.mapTicket, s = this.latest, before = s.shown;
    s.shown += FEED_MORE;
    try {
      // What is already read is enough unless the feed runs short of it.
      if (this.feed().length < s.shown && !s.done) await this.fill(ticket);
      if (ticket === this.mapTicket) this.showLatest(true);
    } catch (e) {
      if (ticket !== this.mapTicket) return;
      s.shown = before;
      button.disabled = false;
      this.tell(errorText(e));
    }
  }

  private async page(cursor: string | null, ticket: number): Promise<void> {
    try {
      const r = await this.online!.listMaps(this.order, cursor);
      if (ticket !== this.mapTicket) return;
      // More maps replace the button that fetched them, at the end of the last page.
      const items = cursor === null ? [] : this.sharedItems.slice(0, -1);
      items.push(...r.page.map((m) => this.card(m)));
      // Each answer carries the leaders as they are now: cards already loaded follow it too.
      const best = new Set(r.bestIds ?? []), hot = new Set(r.hotIds ?? []);
      for (const item of items) {
        const id = item.dataset.mapId;
        if (id) markBadge(item, best.has(id) ? 'best' : hot.has(id) ? 'hot' : null);
      }
      if (!r.isDone) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'more';
        more.textContent = '공유 맵 더 불러오기';
        more.addEventListener('click', () => { more.disabled = true; void this.page(r.continueCursor, ticket); });
        items.push(more);
      }
      this.sharedItems = items;
      this.sharedPages.set(items.length ? items : [note('아직 공유된 맵이 없습니다.')], cursor !== null);
    } catch (e) {
      if (ticket === this.mapTicket) this.sharedPages.set([note(errorText(e))]);
    }
  }

  private tell(text: string): void { $('maps-msg').textContent = text; }

  /** The shared map being renamed. */
  private naming = '';
  private openName(id: string, title: string): void {
    this.naming = id;
    const box = $('map-rename-title') as HTMLInputElement;
    box.value = title;
    ($('map-rename-save') as HTMLButtonElement).disabled = false;
    $('map-rename-msg').textContent = '';
    $('map-rename').hidden = false;
    box.focus();
  }
  private closeName(): void { this.naming = ''; $('map-rename').hidden = true; }
  private async saveName(): Promise<void> {
    const id = this.naming, online = this.online, save = $('map-rename-save') as HTMLButtonElement;
    if (!id || !online || save.disabled) return;
    const title = cleanTitle(($('map-rename-title') as HTMLInputElement).value);
    if (!title) { $('map-rename-msg').textContent = '맵 이름을 입력해 주세요.'; return; }
    save.disabled = true;
    try {
      const stored = await online.renameMap(id, title);
      this.store.rename(id, stored);
      // Rebuilds the shelf's cards too, then the shared list.
      if (this.maps.renamed) this.maps.renamed(); else void this.refreshMaps();
      this.tell('맵 이름을 바꿨어요.');
    } catch (e) {
      if (this.naming !== id) return;
      $('map-rename-msg').textContent = errorText(e);
      save.disabled = false;
    }
  }

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
    // Play and records at the right end of every card; one's own map has taking it down left of them.
    const play: Parameters<typeof mapCard>[2] = [
      ['플레이', () => void this.open(m.id, (map) => this.maps.playShared ? this.maps.playShared(map, m.id) : this.maps.play(map, null)), true],
      ['기록', () => this.maps.times?.(m.id)],
    ];
    const buttons: Parameters<typeof mapCard>[2] = [null, null];
    if (m.mine) {
      buttons[0] = ['이름 변경', () => this.openName(m.id, m.title)];
      buttons[1] = ['공유 취소', (b) => {
        if (!b.dataset.sure) {
          b.dataset.sure = '1';
          b.textContent = '정말 취소';
          setTimeout(() => { delete b.dataset.sure; b.textContent = '공유 취소'; }, 3000);
          return;
        }
        this.online!.removeMap(m.id).then(() => {
          this.store.unlink(m.id);
          this.tell('공유를 취소했습니다.');
          return this.refreshMaps();
        }, (e) => this.tell(errorText(e)));
      }];
    }
    buttons.push(...play);
    // Who made it, and apart from that, who holds its record: never read as one person.
    const holder = m.bestBy ? ` ${m.bestBy}${(m.bestTied ?? 1) > 1 ? ` 외 ${(m.bestTied ?? 1) - 1}명` : ''}` : '';
    // Two short lines, never cut: who made it, then the record and who holds it.
    const card = mapCard(m.title, `제작 ${m.author} · 구간 ${m.segments}개${m.mine ? ' · 내 맵' : ''}\n${m.best === null ? '아직 완주 기록 없음' : `최단 ${timeText(m.best)} ·${holder}`}`, buttons);
    card.dataset.mapId = m.id;
    card.firstElementChild!.append(playStats(m));
    // For a day: UPDATE after its content changed (so its times began again with the maker's), else NEW after it was
    // first shared.
    const now = this.online?.now() ?? Date.now();
    const updated = m.contentUpdatedAt !== undefined && now - m.contentUpdatedAt < NEW_FOR;
    if (updated || (m.createdAt !== undefined && now - m.createdAt < NEW_FOR)) {
      const tag = document.createElement('span');
      tag.className = updated ? 'update-tag' : 'new-tag';
      tag.textContent = updated ? 'UPDATE' : 'NEW';
      if (updated) tag.title = '맵 내용이 바뀌어 기록이 새로 시작됐어요';
      card.classList.add('is-new');
      cardTags(card).prepend(tag);
    }
    return card;
  }

  /** Brings the share button of each of the player's own maps to life when signed in. */
  private shelf(): void {
    for (const card of this.myCards()) {
      const old = card.querySelector<HTMLButtonElement>('[data-role=share]');
      const saved = card.dataset.id ? this.store.get(card.dataset.id) : undefined;
      if (!old || !saved || !this.signedIn || card.dataset.ok !== '1') continue;
      // A fresh button, so no handler from an earlier pass is left on it.
      const b = old.cloneNode() as HTMLButtonElement;
      b.className = 'publish';
      b.disabled = false;
      b.textContent = saved.sharedId ? '공유 갱신' : '공유';
      old.replaceWith(b);
      b.addEventListener('click', () => this.maps.share?.(saved.id));
    }
  }
}
