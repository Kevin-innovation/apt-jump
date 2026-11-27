import { track } from '@vercel/analytics';
import { Pager } from '../pager';
import { COSTUMES, DEFAULT_COSTUME, type Costume } from '../shop';
import { makeSprites } from '../sprites';
import { errorText, type Online, type ShopState } from './types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const num = (n: number) => n.toLocaleString('ko-KR');

/**
 * The shop: costumes for now, each with the runner running in it. Coins and what is owned come from the server,
 * which alone takes payment; the page only asks.
 */
export class ShopView {
  private state: ShopState | null = null;
  private pages = new Pager($('shop-list'), $('shop-pager'));
  /** The costume whose buy button was pressed once: a second press buys. */
  private sure: string | null = null;
  private frame = 0;
  private timer = 0;
  private previews: { canvas: HTMLCanvasElement; frames: HTMLCanvasElement[] }[] = [];
  private ticket = 0;

  constructor(private online: () => Online | null, private signedIn: () => boolean, private dress: (id: string) => void) {}

  async open(): Promise<void> {
    const ticket = ++this.ticket;
    this.sure = null;
    this.say('');
    this.render();
    this.animate(true);
    const online = this.online();
    if (!online || !this.signedIn()) { this.state = null; this.render(); return; }
    try {
      const s = await online.shop();
      if (ticket !== this.ticket) return;
      this.state = s;
      if (s) this.dress(s.costume);
    } catch (e) {
      if (ticket === this.ticket) this.say(errorText(e));
    }
    this.render();
  }

  close(): void { this.animate(false); }
  /** Another account: nothing of the last one stays. */
  clear(): void { this.state = null; this.ticket++; }

  private say(text: string): void { $('shop-msg').textContent = text; }

  /** The previews run while the shop is open, a frame every tenth of a second. */
  private animate(on: boolean): void {
    clearInterval(this.timer);
    if (!on) return;
    this.timer = window.setInterval(() => {
      if ($('shop').hidden) { this.animate(false); return; }
      this.frame = (this.frame + 1) % 4;
      for (const p of this.previews) {
        const g = p.canvas.getContext('2d');
        if (!g) continue;
        g.clearRect(0, 0, p.canvas.width, p.canvas.height);
        g.drawImage(p.frames[this.frame]!, 3, 2);
      }
    }, 110);
  }

  private render(): void {
    const s = this.state, guest = !this.signedIn() || !this.online();
    $('shop-coins').textContent = s ? num(s.coins) : '-';
    $('shop-wallet').title = guest ? '로그인하면 순위 판에서 모은 동전이 코인으로 쌓여요' : '순위 판에서 모은 동전이 코인으로 쌓여요';
    if (guest && !$('shop-msg').textContent) this.say('로그인하고 달리면 모은 동전이 코인으로 쌓여요.');
    this.previews = [];
    this.pages.set(COSTUMES.map((c) => this.card(c, s, guest)), true);
  }

  private card(c: Costume, s: ShopState | null, guest: boolean): HTMLElement {
    const owned = c.id === DEFAULT_COSTUME || !!s?.owned.includes(c.id), worn = (s?.costume ?? DEFAULT_COSTUME) === c.id;
    const card = document.createElement('article');
    card.className = `shop-card${worn ? ' is-worn' : owned ? ' is-owned' : ''}`;
    const canvas = document.createElement('canvas');
    canvas.className = 'shop-pic';
    canvas.width = 20; canvas.height = 20;
    const frames = makeSprites(c.pal).run;
    canvas.getContext('2d')?.drawImage(frames[this.frame]!, 3, 2);
    this.previews.push({ canvas, frames });
    const name = document.createElement('b');
    name.textContent = c.name;
    const text = document.createElement('p');
    text.textContent = c.text;
    const price = document.createElement('span');
    price.className = 'shop-price';
    if (owned) price.textContent = c.price ? '보유' : '기본';
    else { const coin = document.createElement('i'); coin.className = 'coin'; price.append(coin, num(c.price)); }
    const b = document.createElement('button');
    b.type = 'button';
    const short = s !== null && !owned && s.coins < c.price;
    b.textContent = guest ? (owned ? '기본 착용' : '로그인 필요') : worn ? '착용 중' : owned ? '착용' : short ? '코인 부족' : this.sure === c.id ? `${num(c.price)} 코인으로 구매` : '구매';
    b.disabled = guest || worn || short;
    if (!owned && !short && !guest) b.className = this.sure === c.id ? 'buy sure' : 'buy';
    b.addEventListener('click', () => { void (owned ? this.wear(c) : this.buy(c)); });
    card.append(canvas, name, text, price, b);
    return card;
  }

  private async buy(c: Costume): Promise<void> {
    const online = this.online();
    if (!online) return;
    // A purchase takes two presses: the first only asks.
    if (this.sure !== c.id) { this.sure = c.id; this.say(`${c.name}: 한 번 더 누르면 ${num(c.price)} 코인으로 구매해요.`); this.render(); return; }
    this.sure = null;
    try {
      this.state = await online.buy(c.id);
      track('costume_buy', { costume: c.id, price: c.price });
      this.dress(this.state.costume);
      this.say(`${c.name}을(를) 샀어요! 바로 입었어요.`);
    } catch (e) { this.say(errorText(e)); }
    this.render();
  }

  private async wear(c: Costume): Promise<void> {
    const online = this.online();
    if (!online) return;
    this.sure = null;
    try {
      this.state = await online.wear(c.id);
      this.dress(this.state.costume);
      this.say(`${c.name} 착용!`);
    } catch (e) { this.say(errorText(e)); }
    this.render();
  }
}
