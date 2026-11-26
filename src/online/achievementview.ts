import './achievementview.css';
import { ACHIEVEMENTS, TITLES } from '../achievements';

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

const el = (tag: string, cls = '', text = ''): HTMLElement => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.textContent = text;
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

  constructor(private readonly root: HTMLElement, private readonly callbacks: AchievementViewCallbacks) {
    this.root.classList.add('achievement-view');
  }

  async open(): Promise<void> {
    const ticket = ++this.ticket;
    const signedIn = this.callbacks.signedIn();
    this.catalog = null;
    this.notice = '';
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
    this.root.replaceChildren();
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

  private render(): void {
    this.root.replaceChildren();
    if (this.pending && !this.catalog) {
      this.root.append(el('p', 'achievement-loading', '도전과제를 불러오는 중이에요.'));
      return;
    }
    if (this.notice) this.root.append(el('p', 'achievement-notice', this.notice));
    const data = this.catalog;
    if (!data) return;

    const summary = el('div', 'achievement-summary');
    summary.append(
      el('span', 'achievement-summary-item', `기준 회원 ${num(data.participants)}명`),
      el('span', 'achievement-summary-note', '분모: 일반 모드 기록 제출 회원 · 업데이트 이후부터 집계'),
    );
    this.root.append(summary);
    if (!this.callbacks.signedIn()) {
      this.root.append(el('p', 'achievement-login', '로그인하면 내 진행 상황과 칭호 장착을 볼 수 있어요.'));
    }
    this.root.append(this.titleSection(data), this.achievementSection(data));
  }

  private titleSection(data: AchievementCatalog): HTMLElement {
    const section = el('section', 'achievement-section');
    section.append(el('h3', 'achievement-section-title', '칭호'));
    const list = el('div', 'achievement-titles');
    for (const title of data.titles) list.append(this.titleCard(title, data));
    section.append(list);
    return section;
  }

  private titleCard(title: CatalogTitle, data: AchievementCatalog): HTMLElement {
    const equipped = data.equipped === title.id;
    const card = el('article', `achievement-title-card${equipped ? ' is-equipped' : title.unlocked ? ' is-unlocked' : ''}`);
    const head = el('div', 'achievement-title-head');
    head.append(
      el('span', 'achievement-title-name', title.name),
      el('span', 'achievement-title-state', equipped ? '장착됨' : title.unlocked ? '장착 가능' : '미해금'),
    );
    card.append(head);

    const needs = el('div', 'achievement-requirements');
    const pure = TITLE_BY_ID.get(title.id);
    const unlocked = new Set(data.achievements.filter((a) => a.unlocked).map((a) => a.id));
    for (const id of pure?.requires ?? []) {
      const source = ACHIEVEMENT_BY_ID.get(id);
      const met = unlocked.has(id);
      const label = source ? `${source.name} · 목표 ${num(source.goal)}` : id;
      needs.append(el('span', `achievement-requirement${met ? ' is-met' : ''}`, label));
    }
    card.append(needs);

    const signedIn = this.callbacks.signedIn();
    const control = button('achievement-equip', !signedIn ? '로그인 필요' : !title.unlocked ? '미해금' : equipped ? '장착 해제' : '장착');
    control.disabled = !signedIn || !title.unlocked || this.pending;
    control.addEventListener('click', () => { void this.equip(equipped ? null : title.id); });
    card.append(control);
    return card;
  }

  private achievementSection(data: AchievementCatalog): HTMLElement {
    const section = el('section', 'achievement-section');
    section.append(el('h3', 'achievement-section-title', '도전과제'));

    const filters = el('div', 'achievement-filters');
    const choices: { key: AchievementFilter; label: string }[] = [
      { key: 'all', label: '전체' },
      { key: 'locked', label: '진행 중' },
      { key: 'unlocked', label: '획득 완료' },
    ];
    for (const choice of choices) {
      const control = button('achievement-filter', choice.label);
      control.setAttribute('aria-pressed', String(this.filter === choice.key));
      control.disabled = this.pending;
      control.addEventListener('click', () => { this.filter = choice.key; this.render(); });
      filters.append(control);
    }
    section.append(filters);

    const list = el('div', 'achievement-cards');
    const shown = data.achievements.filter((a) =>
      this.filter === 'all' || (this.filter === 'unlocked' ? a.unlocked : !a.unlocked));
    if (shown.length === 0) list.append(el('p', 'achievement-empty', '해당하는 도전과제가 없어요.'));
    for (const a of shown) list.append(this.achievementCard(a, data.participants));
    section.append(list);
    return section;
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
      ? `획득률 ${percentText(a.percent)}% · ${num(a.earned)}/${num(participants)}명`
      : '집계 시작 전';
    card.append(el('span', 'achievement-rate', rate));
    return card;
  }
}
