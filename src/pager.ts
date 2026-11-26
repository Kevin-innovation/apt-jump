/**
 * Shows a list a page at a time, each page as much as fits the space the list is given, with previous and next
 * buttons under it: on a landscape screen nothing needs scrolling, so the screen's own buttons are always in view.
 */
export class Pager {
  private items: HTMLElement[] = [];
  /** Where each page begins. */
  private starts = [0];
  private page = 0;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private label: HTMLElement;

  /** `max` caps a page however much room there is: a ranking reads 1 to 10, then 11 on. */
  constructor(private list: HTMLElement, nav: HTMLElement, private max = Infinity) {
    const button = (text: string, step: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'small';
      b.textContent = text;
      b.addEventListener('click', () => this.go(step));
      return b;
    };
    this.prev = button('◀ 이전', -1);
    this.next = button('다음 ▶', 1);
    this.label = document.createElement('span');
    this.label.className = 'pager-label';
    this.label.setAttribute('aria-live', 'polite');
    nav.classList.add('pager');
    nav.append(this.prev, this.label, this.next);
    list.closest('.screen')?.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === 'ArrowLeft' || key === 'ArrowRight') { e.preventDefault(); this.go(key === 'ArrowLeft' ? -1 : 1); }
    });
    // Shown, hidden or resized: the pages are worked out again for the space there is.
    new ResizeObserver(() => this.fit()).observe(list);
  }

  /** New contents; `keep` stays on the page that showed the same first item, where it still exists. */
  set(items: HTMLElement[], keep = false): void {
    this.items = items;
    if (!keep) { this.page = 0; this.starts = [0]; }
    this.fit();
  }

  /** Splits the items into pages that fit, keeping the first item now in view on screen. Only while visible. */
  fit(): void {
    const list = this.list;
    if (!list.clientHeight) { list.replaceChildren(...this.items); return; }
    const first = this.starts[this.page] ?? 0, starts = [0];
    for (const item of this.items) { item.style.maxHeight = ''; item.style.overflowY = ''; }
    list.replaceChildren();
    this.items.forEach((item, i) => {
      list.append(item);
      // Headings (data-extra) don't count toward the cap.
      const counted = [...list.children].filter((c) => !(c as HTMLElement).dataset.extra).length;
      if (counted > this.max || (list.children.length > 1 && list.scrollHeight > list.clientHeight + 1)) { starts.push(i); list.replaceChildren(item); }
    });
    this.starts = starts;
    let page = 0;
    while (page + 1 < starts.length && starts[page + 1]! <= first) page++;
    this.page = page;
    this.show();
  }

  private go(step: number): void {
    const page = Math.max(0, Math.min(this.starts.length - 1, this.page + step));
    if (page === this.page) return;
    this.page = page;
    this.show();
  }

  private show(): void {
    const from = this.starts[this.page]!, to = this.starts[this.page + 1] ?? this.items.length, pages = this.starts.length;
    this.list.replaceChildren(...this.items.slice(from, to));
    // One item taller than the whole space scrolls inside itself; the buttons stay where they are.
    const only = to - from === 1 ? this.items[from]! : null;
    if (only && this.list.scrollHeight > this.list.clientHeight + 1) { only.style.maxHeight = `${this.list.clientHeight}px`; only.style.overflowY = 'auto'; }
    this.label.textContent = `${this.page + 1} / ${pages}`;
    this.prev.disabled = this.page === 0;
    this.next.disabled = this.page === pages - 1;
    for (const el of [this.prev, this.label, this.next]) el.hidden = pages < 2;
  }
}
