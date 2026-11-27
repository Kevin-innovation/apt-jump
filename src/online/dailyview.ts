import { track } from '@vercel/analytics';
import { STREAK_REWARDS } from '../daily';
import { errorText, type DailyState, type Online } from './types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const num = (n: number) => n.toLocaleString('ko-KR');
const el = (tag: string, cls: string, text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e; };

/**
 * Today's attendance and missions: a week of check-in rewards, and the three missions with their progress. The
 * server says what counts and pays; this only shows it and asks to check in.
 */
export class DailyView {
  private state: DailyState | null = null;
  private ticket = 0;

  constructor(private online: () => Online | null, private signedIn: () => boolean, private onChange: () => void) {
    $('attend-go').addEventListener('click', () => void this.checkIn());
  }

  /** The chip on the title: today's missions done, and a dot while attendance waits. */
  async refreshChip(): Promise<void> {
    const chip = $('daily-chip'), online = this.online();
    if (!online || !this.signedIn()) { chip.hidden = true; this.state = null; return; }
    const ticket = ++this.ticket;
    try {
      const s = await online.daily();
      if (ticket !== this.ticket) return;
      this.state = s;
      chip.hidden = !s;
      if (!s) return;
      chip.textContent = `오늘의 미션 ${s.missions.filter((m) => m.done).length}/${s.missions.length}`;
      chip.classList.toggle('alert', !s.checkedIn);
      chip.title = s.checkedIn ? `출석 ${s.streak}일째` : `출석 보상 ${num(s.reward)}코인을 받을 수 있어요`;
      if (!$('daily').hidden) this.render();
    } catch { chip.hidden = true; }
  }

  async open(): Promise<void> {
    $('daily-msg').textContent = '';
    this.render();
    await this.refreshChip();
    this.render();
  }

  private render(): void {
    const s = this.state;
    const go = $('attend-go') as HTMLButtonElement;
    if (!s) {
      $('attend-days').replaceChildren();
      $('daily-list').replaceChildren(el('p', 'keys', this.signedIn() ? '불러오는 중이에요.' : '로그인하면 출석 보상과 오늘의 미션을 받을 수 있어요.'));
      go.hidden = true;
      return;
    }
    // Where today stands in the week's round of rewards.
    const at = (s.streak - 1) % STREAK_REWARDS.length;
    $('attend-days').replaceChildren(...STREAK_REWARDS.map((reward, i) => {
      const got = i < at || (i === at && s.checkedIn), today = i === at;
      const box = el('div', `attend-day${got ? ' got' : ''}${today ? ' today' : ''}`);
      box.append(el('small', '', `${i + 1}일`), el('b', '', got ? '✔' : num(reward)));
      return box;
    }));
    go.hidden = false;
    go.disabled = s.checkedIn;
    go.textContent = s.checkedIn ? `출석 완료 · ${s.streak}일째` : `출석 보상 받기 +${num(s.reward)}`;
    $('daily-list').replaceChildren(...s.missions.map((m, i) => {
      const card = el('article', `daily-card level-${i + 1}${m.done ? ' done' : ''}`);
      const bar = el('div', 'daily-bar'), fill = el('i', '');
      fill.style.transform = `scaleX(${m.goal ? m.progress / m.goal : 0})`;
      bar.append(fill);
      card.append(el('small', '', ['쉬움', '보통', '어려움'][i] ?? ''), el('b', '', m.text), bar,
        el('span', 'daily-progress', m.done ? `완료! +${num(m.reward)}코인 받음` : `${num(m.progress)} / ${num(m.goal)} · 보상 ${num(m.reward)}코인`));
      return card;
    }));
  }

  private async checkIn(): Promise<void> {
    const online = this.online();
    if (!online || !this.state || this.state.checkedIn) return;
    ($('attend-go') as HTMLButtonElement).disabled = true;
    try {
      const r = await online.checkIn();
      track('check_in', { streak: r.streak });
      $('daily-msg').textContent = `출석 ${r.streak}일째! ${num(r.reward)}코인을 받았어요.`;
      this.onChange();
    } catch (e) { $('daily-msg').textContent = errorText(e); }
    await this.refreshChip();
    this.render();
  }
}
