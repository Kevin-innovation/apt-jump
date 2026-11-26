import './achievementview.css';
import { ACHIEVEMENTS, TITLES } from '../achievements';
import { RARITY, titleClasses, titleLook } from '../title-style';

export interface AchievementCatalog {
  participants: number;
  achievements: {
    id: string;
    name: string;
    description: string;
    unlocked: boolean;
    progress: number;
    goal: number;
    earned: number;
    percent: number;
  }[];
  titles: { id: string; name: string; unlocked: boolean }[];
  equipped: string | null;
}

export interface AchievementViewCallbacks {
  catalog: () => Promise<AchievementCatalog>;
  equip: (titleId: string | null) => Promise<unknown>;
  signedIn: () => boolean;
}

type CatalogAchievement = AchievementCatalog['achievements'][number];
type CatalogTitle = AchievementCatalog['titles'][number];
type AchievementFilter = 'all' | 'locked' | 'unlocked';
type AchievementTab = 'achievements' | 'titles';

const el = (tag: string, cls = '', text = ''): HTMLElement => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.textContent = text;
  return node;
};

/** Short units that each stay on one line: a break only ever falls between them. */
const units = (cls: string, parts: readonly string[]): HTMLElement => {
  const node = el('span', cls);
  parts.forEach((part, i) => {
    if (i) node.append(' ');
    node.append(el('span', 'achievement-unit', part));
  });
  return node;
};

const button = (cls: string, text: string): HTMLButtonElement => {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = cls;
  node.textContent = text;
  return node;
};

/** Deterministic grouping, independent of the browser's locale data. */
const num = (n: number): string => {
  const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const growth = (n: number): number => Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
const percentText = (n: number): string => String(Math.round(growth(n) * 100) / 100);

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
const TITLE_BY_ID = new Map(TITLES.map((t) => [t.id, t]));

const LOAD_FAIL = '도전과제 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const EQUIP_FAIL = '칭호를 변경하지 못했어요. 다시 시도해 주세요.';

/** Cards and title list only. The host app owns the screen title, home button and main element. */
export class AchievementView {
  private ticket = 0;
  private catalog: AchievementCatalog | null = null;
  private notice = '';
  private pending = false;
  private filter: AchievementFilter = 'all';
  private titleFilter: AchievementFilter = 'all';
  /** 0 is every rarity, 1 to 6 one of them. */
  private rarity = 0;
  private tab: AchievementTab = 'achievements';
  private page = 0;
  /** Which way the last page turn went, for its short slide in. */
  private turn = 0;
  /** The title whose conditions are open, and the list page to return to. */
  private detail: string | null = null;
  private listPage = 0;

  constructor(private readonly root: HTMLElement, private readonly callbacks: AchievementViewCallbacks) {
    this.root.classList.add('achievement-view');
    // Another size holds another number of cards.
    window.addEventListener('resize', () => { if (this.catalog && this.root.checkVisibility?.()) this.render(); });
  }

  async open(): Promise<void> {
    const ticket = ++this.ticket;
    const signedIn = this.callbacks.signedIn();
    this.catalog = null;
    this.notice = '';
    this.page = 0;
    this.detail = null;
    this.pending = true;
    this.render();
    try {
      const data = await this.callbacks.catalog();
      if (ticket !== this.ticket || this.callbacks.signedIn() !== signedIn) return;
      this.catalog = data;
    } catch {
      if (ticket !== this.ticket || this.callbacks.signedIn() !== signedIn) return;
      this.notice = LOAD_FAIL;
    } finally {
      if (ticket === this.ticket) {
        this.pending = false;
        this.render();
      }
    }
  }

  clear(): void {
    this.ticket++;
    this.catalog = null;
    this.notice = '';
    this.pending = false;
    this.filter = 'all';
    this.titleFilter = 'all';
    this.rarity = 0;
    this.tab = 'achievements';
    this.page = 0;
    this.detail = null;
    this.root.replaceChildren();
  }

  private setTab(tab: AchievementTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.page = 0;
    this.render();
    // render() replaces children; refocus the new tab without scrolling the page.
    this.root.querySelector<HTMLButtonElement>(`.achievement-tab[data-achievement-tab="${tab}"]`)
      ?.focus({ preventScroll: true });
  }

  private async equip(titleId: string | null): Promise<void> {
    if (!this.catalog || this.pending || !this.callbacks.signedIn()) return;
    const ticket = ++this.ticket;
    this.pending = true;
    this.notice = titleId === null ? '칭호 장착을 해제하고 있어요…' : '칭호를 장착하고 있어요…';
    this.render();
    try {
      await this.callbacks.equip(titleId);
      if (ticket !== this.ticket) return;
      if (this.catalog) this.catalog = { ...this.catalog, equipped: titleId };
      this.notice = titleId === null ? '칭호 장착을 해제했어요.' : '칭호를 장착했어요.';
    } catch {
      if (ticket !== this.ticket) return;
      this.notice = EQUIP_FAIL;
    } finally {
      if (ticket === this.ticket) {
        this.pending = false;
        this.render();
      }
    }
  }

  /** How many cards a page holds: what fits the first screen at this size. */
  private layout(cardHeight: number): { cols: number; rows: number } {
    const w = window.innerWidth, h = window.innerHeight;
    const cols = w >= 960 ? 3 : w >= 620 ? 2 : 1;
    // Everything on the screen that isn't a card; on a phone the titles' rarity picker takes a line of its own.
    const around = w >= 620 ? 200 : this.tab === 'titles' ? 306 : 262;
    const rows = Math.max(1, Math.min(3, Math.floor((h - around + 8) / (cardHeight + 8))));
    return { cols, rows };
  }

  private render(): void {
    this.root.replaceChildren();
    if (this.pending && !this.catalog) {
      this.root.append(el('p', 'achievement-loading', '도전과제를 불러오는 중이에요.'));
      return;
    }
    const data = this.catalog;
    if (!data) {
      if (this.notice) this.root.append(el('p', 'achievement-notice', this.notice));
      return;
    }
    const open = this.detail === null ? undefined : data.titles.find((t) => t.id === this.detail);
    if (open) { this.root.append(...this.requirementPages(open, data)); return; }

    const summary = el('div', 'achievement-summary');
    summary.append(
      el('span', 'achievement-summary-item', `기준 회원 ${num(data.participants)}명`),
      units('achievement-summary-note', ['일반 모드 기록 제출 회원 ·', '업데이트 이후 집계']),
    );
    // One line, whatever it has to say, so the cards never move down.
    const equippedName = data.equipped === null ? '없음' : (TITLE_BY_ID.get(data.equipped)?.name ?? data.equipped);
    const status = this.notice ? el('p', 'achievement-notice', this.notice)
      : !this.callbacks.signedIn() ? el('p', 'achievement-login', '로그인하면 진행 상황이 보여요.')
        : el('p', 'achievement-equipped', `장착 칭호: ${equippedName}`);
    status.setAttribute('role', 'status');
    const bar = el('div', 'achievement-bar');
    bar.append(this.tabBar(data));
    bar.append(this.filterBar());
    if (this.tab === 'titles') bar.append(this.rarityPicker(data));
    this.root.append(summary, status, bar);

    if (this.tab === 'achievements') {
      const shown = data.achievements.filter((a) =>
        this.filter === 'all' || (this.filter === 'unlocked' ? a.unlocked : !a.unlocked));
      this.root.append(...this.paged('achievement-cards', 118, shown, (a) => this.achievementCard(a, data.participants), '해당하는 도전과제가 없어요.'));
    } else {
      const shown = data.titles.filter((t) =>
        (this.titleFilter === 'all' || (this.titleFilter === 'unlocked' ? t.unlocked : !t.unlocked))
        && (!this.rarity || titleLook(t.id)?.rank === this.rarity));
      this.root.append(...this.paged('achievement-titles', 146, shown, (t) => this.titleCard(t, data), '해당하는 칭호가 없어요.'));
    }
  }

  /** One page of cards and the way to the others. */
  private paged<T>(cls: string, cardHeight: number, items: readonly T[], card: (item: T) => HTMLElement, none: string): HTMLElement[] {
    const { cols, rows } = this.layout(cardHeight);
    const per = cols * rows, pages = Math.max(1, Math.ceil(items.length / per));
    this.page = Math.max(0, Math.min(pages - 1, this.page));
    const list = el('div', `${cls} achievement-page${this.turn ? (this.turn > 0 ? ' from-right' : ' from-left') : ''}`);
    this.turn = 0;
    list.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    list.style.gridAutoRows = `${cardHeight}px`;
    // A short last page keeps the pager where it was.
    list.style.minHeight = `${Math.min(rows, Math.ceil(items.length / cols) || 1) * (cardHeight + 8) - 8}px`;
    if (!items.length) list.append(el('p', 'achievement-empty', none));
    for (const item of items.slice(this.page * per, (this.page + 1) * per)) list.append(card(item));
    return [list, this.pager(this.page, pages)];
  }

  private pager(page: number, pages: number): HTMLElement {
    const nav = el('div', 'achievement-pager');
    const step = (by: -1 | 1, text: string) => {
      const control = button('achievement-step', text);
      control.dataset.step = String(by);
      control.disabled = by < 0 ? page <= 0 : page >= pages - 1;
      control.addEventListener('click', () => {
        this.page += by;
        this.turn = by;
        this.render();
        const same = this.root.querySelector<HTMLButtonElement>(`[data-step="${by}"]:not(:disabled)`)
          ?? this.root.querySelector<HTMLButtonElement>('.achievement-step:not(:disabled)');
        same?.focus({ preventScroll: true });
      });
      return control;
    };
    const number = el('span', 'achievement-page-number', `${page + 1} / ${pages}`);
    number.setAttribute('aria-live', 'polite');
    nav.append(step(-1, '◀ 이전'), number, step(1, '다음 ▶'));
    return nav;
  }

  private tabBar(data: AchievementCatalog): HTMLElement {
    const bar = el('div', 'achievement-tabs');
    bar.setAttribute('role', 'tablist');
    const tabs: { key: AchievementTab; label: string }[] = [
      { key: 'achievements', label: `도전과제 ${data.achievements.length}` },
      { key: 'titles', label: `칭호 ${data.titles.filter((t) => t.unlocked).length}/${data.titles.length}` },
    ];
    for (const tab of tabs) {
      const control = button('achievement-tab', tab.label);
      control.dataset.achievementTab = tab.key;
      control.setAttribute('role', 'tab');
      control.setAttribute('aria-selected', String(this.tab === tab.key));
      control.disabled = this.pending;
      control.addEventListener('click', () => this.setTab(tab.key));
      bar.append(control);
    }
    return bar;
  }

  /** All, in progress or earned: the open tab keeps its own choice. */
  private filterBar(): HTMLElement {
    const titles = this.tab === 'titles';
    const current = titles ? this.titleFilter : this.filter;
    const filters = el('div', 'achievement-filters');
    const choices: { key: AchievementFilter; label: string }[] = [
      { key: 'all', label: '전체' },
      { key: 'locked', label: titles ? '미해금' : '진행 중' },
      { key: 'unlocked', label: titles ? '획득' : '획득 완료' },
    ];
    for (const choice of choices) {
      const control = button('achievement-filter', choice.label);
      control.setAttribute('aria-pressed', String(current === choice.key));
      control.disabled = this.pending;
      control.addEventListener('click', () => {
        if (titles) this.titleFilter = choice.key; else this.filter = choice.key;
        this.page = 0;
        this.render();
      });
      filters.append(control);
    }
    return filters;
  }

  /** One rarity at a time, each with how many of it are earned. */
  private rarityPicker(data: AchievementCatalog): HTMLElement {
    const label = el('label', 'achievement-rarity-pick');
    const select = document.createElement('select');
    select.setAttribute('aria-label', '칭호 등급');
    select.disabled = this.pending;
    const count = (rank: number) => {
      const of = data.titles.filter((t) => titleLook(t.id)?.rank === rank);
      return `${of.filter((t) => t.unlocked).length}/${of.length}`;
    };
    select.append(new Option('모든 등급', '0'), ...RARITY.map((name, i) => new Option(`${name} ${count(i + 1)}`, String(i + 1))));
    select.value = String(this.rarity);
    select.addEventListener('change', () => {
      this.rarity = Number(select.value);
      this.page = 0;
      this.render();
      this.root.querySelector<HTMLSelectElement>('.achievement-rarity-pick select')?.focus({ preventScroll: true });
    });
    label.append(select);
    return label;
  }

  private plaque(id: string, name: string): HTMLElement {
    const plaque = el('div', 'achievement-title-plaque');
    plaque.classList.add(...titleClasses(id));
    plaque.title = name;
    plaque.append(el('span', 'achievement-title-name', name));
    return plaque;
  }

  private titleCard(title: CatalogTitle, data: AchievementCatalog): HTMLElement {
    const equipped = data.equipped === title.id;
    const look = titleLook(title.id);
    const card = el('article', `achievement-title-card${equipped ? ' is-equipped' : title.unlocked ? ' is-unlocked' : ''}${look ? ` is-rank-${look.rank}` : ''}`);
    const head = el('div', 'achievement-title-head');
    head.append(
      el('span', `achievement-title-rarity${look ? ` rarity-${look.rank}` : ''}`, look ? `${'◆'.repeat(look.rank)} ${RARITY[look.rank - 1]}` : ''),
      el('span', 'achievement-title-state', equipped ? '장착됨' : title.unlocked ? '장착 가능' : '미해금'),
    );
    const wanted = TITLE_BY_ID.get(title.id)?.requires ?? [];
    const met = new Set(data.achievements.filter((a) => a.unlocked).map((a) => a.id));
    const needs = button('achievement-needs', `조건 ${wanted.filter((id) => met.has(id)).length}/${wanted.length} 보기`);
    needs.addEventListener('click', () => {
      this.detail = title.id;
      this.listPage = this.page;
      this.page = 0;
      this.render();
      this.root.querySelector<HTMLButtonElement>('.achievement-close')?.focus({ preventScroll: true });
    });
    const signedIn = this.callbacks.signedIn();
    const control = button('achievement-equip', !signedIn ? '로그인 필요' : !title.unlocked ? '미해금' : equipped ? '장착 해제' : '장착');
    control.disabled = !signedIn || !title.unlocked || this.pending;
    control.addEventListener('click', () => { void this.equip(equipped ? null : title.id); });
    const actions = el('div', 'achievement-actions');
    actions.append(needs, control);
    card.append(this.plaque(title.id, title.name), head, actions);
    return card;
  }

  /** What a title asks for, a page at a time. */
  private requirementPages(title: CatalogTitle, data: AchievementCatalog): HTMLElement[] {
    const close = button('achievement-close', '◀ 칭호 목록');
    close.addEventListener('click', () => { this.back(); });
    const byId = new Map(data.achievements.map((a) => [a.id, a]));
    const wanted = TITLE_BY_ID.get(title.id)?.requires ?? [];
    return [
      this.plaque(title.id, title.name),
      close,
      ...this.paged('achievement-requirements', 76, wanted, (id) => {
        const source = ACHIEVEMENT_BY_ID.get(id), own = byId.get(id);
        const row = el('div', `achievement-requirement${own?.unlocked ? ' is-met' : ''}`);
        row.append(
          el('span', 'achievement-requirement-name', source?.name ?? id),
          units('achievement-requirement-goal', source
            ? [`목표 ${num(source.goal)} ·`, own?.unlocked ? '✔ 달성' : `현재 ${num(own?.progress ?? 0)}`] : []),
        );
        return row;
      }, '조건이 없어요.'),
    ];
  }

  /** Leaves a title's conditions for the list. False when there was nothing to leave. */
  back(): boolean {
    if (this.detail === null) return false;
    const id = this.detail;
    this.detail = null;
    this.page = this.listPage;
    this.render();
    const at = [...this.root.querySelectorAll<HTMLElement>('.achievement-title-plaque')]
      .find((p) => p.title === TITLE_BY_ID.get(id)?.name);
    at?.parentElement?.querySelector<HTMLButtonElement>('.achievement-needs')?.focus({ preventScroll: true });
    return true;
  }

  private achievementCard(a: CatalogAchievement, participants: number): HTMLElement {
    const card = el('article', `achievement-card${a.unlocked ? ' is-unlocked' : ''}`);
    const head = el('div', 'achievement-card-head');
    head.append(
      el('span', 'achievement-card-name', a.name),
      el('span', 'achievement-card-badge', a.unlocked ? '획득 완료' : '진행 중'),
      el('span', 'achievement-card-progress', `${num(a.progress)}/${num(a.goal)}`),
    );
    card.append(head, el('p', 'achievement-card-description', a.description));

    const meter = el('div', 'achievement-meter');
    const fill = el('div', 'achievement-meter-fill');
    fill.style.width = `${growth(a.goal > 0 ? (a.progress / a.goal) * 100 : 0)}%`;
    meter.append(fill);
    card.append(meter);

    const rate = participants > 0
      ? [`획득률 ${percentText(a.percent)}% ·`, `${num(a.earned)}/${num(participants)}명`]
      : ['집계 시작 전'];
    card.append(units('achievement-rate', rate));
    return card;
  }
}
