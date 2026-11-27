import { drawAc, drawBar, drawBox, drawDiamond, drawDrone, drawFlag, drawPigeon, drawPower, drawQuilt, drawRoad, drawRoute, drawScaffold, drawTank } from './art';
import { POWER_KINDS, POWER_TEXT, type PowerKind } from './items';
import {
  buildCourse, checkMap, cleanTitle, ITEM_NAMES, ITEM_TYPES, LIMITS, LINE_W, onFloor, segmentStarts, UNIT,
  type GameMap, type ItemType, type MapProblem, type Segment,
} from './maps';
import { makeSprites, type Sprites } from './sprites';
import { ROAD_DEPTH } from './world';

type Tool = 'select' | 'erase' | ItemType;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const clamp = (v: number, [a, b]: readonly [number, number]) => Math.max(a, Math.min(b, v));
const TOOLS: Tool[] = ['select', 'erase', ...ITEM_TYPES];
const HELP: Record<Tool, string> = {
  ...POWER_TEXT,
  select: '구간을 눌러 선택, 끌어서 이동', erase: '지울 물체를 누르세요',
  coin: '놓을 자리를 누르세요', gold: '놓을 자리를 누르세요', diamond: '높이 120px(15칸)쯤이면 2단 점프로 닿습니다',
  ac: '옥상 위를 누르세요', tank: '옥상 위를 누르세요', line: '건물 사이 간격을 누르세요',
  box: '옥상 위를 누르세요 · ↓ 슬라이드로 부수고 지나가요', bar: '옥상 위를 누르세요 · ↓ 슬라이드로 밑을 지나가요',
  puddle: '옥상 위를 누르세요 · ↓ 슬라이드로 지나가면 물보라 가속',
  drone: '옥상 위 3~6칸 높이를 누르세요', pigeon: '옥상 위를 누르세요',
};

/** Pixel colours for the form's little icons. */
const INK: Record<string, string> = { '#': '#fff6e0', o: '#1a1230', y: '#ffd85a', c: '#7dfff0', r: '#ff7a7a', g: '#57b86a', b: '#5fb7e6' };
/** A 9×9 picture for each control of the form, keyed by its command (or a stepper's data-icon). */
const FORM_ICONS: Record<string, string[]> = {
  w: ['.........', '.........', '.c.....c.', 'cc.....cc', 'ccccccccc', 'cc.....cc', '.c.....c.', '.........', '.........'],
  gap: ['##.....##', '##.....##', '##.....##', '##.c.c.##', '##ccccc##', '##.c.c.##', '##.....##', '##.....##', '##.....##'],
  h: ['....c....', '...ccc...', '..c.c.c..', '....c....', '....c....', '....c....', '..c.c.c..', '...ccc...', '....c....'],
  kind: ['ggggggggg', '#########', '#y#y#y#y#', '#########', '#y#y#y#y#', '#########', '#y#y#y#y#', '####o####', '####o####'],
  road: ['.........', '..rrrr...', '.rcrrcr..', 'rrrrrrrrr', 'rorrrrorr', '.o....o..', '.........', 'y.y.y.y.y', '.........'],
  route: ['cccc.cccc', '#...y...#', '#...y...#', '#.y.y.y.#', '#..yyy..#', '#...y...#', '#.......#', '#.##.##.#', '#########'],
  vent: ['..c...c..', '.ccc.ccc.', 'c.c.c.c.c', '..c...c..', '.c...c...', '..c...c..', '...c...c.', '..c...c..', '#########'],
  golden: ['....y....', '...yyy...', 'yyyy#yyyy', '.yyy#yyy.', '..yy#yy..', '.yyyyyyy.', '.yy...yy.', 'yy.....yy', '.........'],
  cracked: ['ggggggggg', '####r####', '###r#####', '####r#r##', '###r###r#', '##r######', '#########', '#.#.#.#.#', '#########'],
  add: ['.........', '....y....', '....y....', '....y....', '.yyyyyyy.', '....y....', '....y....', '....y....', '.........'],
  copy: ['#####....', '#...#....', '#..cccccc', '#..c....c', '####c....', '...c....c', '...c....c', '...cccccc', '.........'],
  left: ['.........', '...c.....', '..cc.....', '.cccccccc', 'ccccccccc', '.cccccccc', '..cc.....', '...c.....', '.........'],
  right: ['.........', '.....c...', '.....cc..', 'cccccccc.', 'ccccccccc', 'cccccccc.', '.....cc..', '.....c...', '.........'],
  clear: ['.......y.', '......y..', '.....y...', '....y....', '...#.....', '..###....', '.#####...', '#######..', '.........'],
  del: ['...rrr...', 'rrrrrrrrr', '.r#####r.', '.r#r#r#r.', '.r#r#r#r.', '.r#r#r#r.', '.r#r#r#r.', '.rrrrrrr.', '.........'],
  base: ['.........', 'y...y....', '.y...y...', '..y...y..', '...y...y.', '..y...y..', '.y...y...', 'y...y....', '.........'],
  gain: ['.........', '.......y.', '.......y.', '.....y.y.', '.....y.y.', '...y.y.y.', '...y.y.y.', '.y.y.y.y.', '#########'],
};
function pixels(rows: string[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = rows[0]!.length; c.height = rows.length;
  c.className = 'form-pic';
  c.setAttribute('aria-hidden', 'true');
  const g = c.getContext('2d');
  if (g) rows.forEach((r, y) => [...r].forEach((ch, x) => { const k = INK[ch]; if (k) { g.fillStyle = k; g.fillRect(x, y, 1, 1); } }));
  return c;
}
const problemKey = (p: MapProblem) => `${p.segment}:${p.text}`;

export class Editor {
  map!: GameMap;
  id: string | null = null;
  dirty = false;
  private selected = 0;
  private tool: Tool = 'select';
  private problems: MapProblem[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private camX = 0;
  private scale = 1;
  private t = 0;
  private el = $('ed-canvas') as HTMLCanvasElement;
  private g = this.el.getContext('2d')!;
  private sprites: Sprites = makeSprites();
  private drag: { id: number; x: number; cam: number; moved: boolean } | null = null;
  private course!: ReturnType<typeof buildCourse>;
  private toastTimer = 0;
  private known = new Set<string>();

  /** The thing itself, as the game draws it, for a tool's button. */
  private icon(tool: Tool): HTMLCanvasElement {
    const sizes: Partial<Record<Tool, [number, number]>> = {
      coin: [9, 9], gold: [9, 9], diamond: [13, 11], ac: [18, 13], tank: [38, 33], line: [24, 22], drone: [26, 12], pigeon: [18, 15],
      box: [16, 14], bar: [26, 20], puddle: [22, 6],
    };
    const [w, h] = sizes[tool] ?? (POWER_KINDS.includes(tool as PowerKind) ? [19, 19] : [11, 11]);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.className = 'tool-pic';
    const g = c.getContext('2d');
    if (!g) return c;
    const ink = (rows: string[]) => rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') { g.fillStyle = ch === '#' ? '#fff6e0' : '#1a1230'; g.fillRect(x, y, 1, 1); } }));
    switch (tool) {
      case 'select': ink(['#..........', '##.........', '#o#........', '#oo#.......', '#ooo#......', '#oooo#.....', '#ooooo#....', '#ooo###....', '#o#o#......', '##.#o#.....', '....##.....']); break;
      case 'erase': ink(['...........', '#.......#..', '.#.....#...', '..#...#....', '...#.#.....', '....#......', '...#.#.....', '..#...#....', '.#.....#...', '#.......#..', '...........']); break;
      case 'coin': g.drawImage(this.sprites.coin[0]!, 1, 1); break;
      case 'gold': g.drawImage(this.sprites.gold[0]!, 1, 1); break;
      case 'diamond': drawDiamond(g, 1, 2, 1); break;
      case 'ac': drawAc(g, 1, 1, 0); break;
      case 'tank': drawTank(g, 1, 1); break;
      case 'line': g.fillStyle = '#f5ead8'; g.fillRect(0, 1, w, 1); drawQuilt(g, 3, 2, 18, 0, 0); break;
      case 'drone': drawDrone(g, 5, 1, 0); break;
      case 'pigeon': drawPigeon(g, 3, 6, 0.1); break;
      case 'box': drawBox(g, 1, 1); break;
      case 'bar': drawBar(g, 1, 0, 24, 18, 0); break;
      case 'puddle': g.fillStyle = '#2d5f8a'; g.fillRect(1, 2, 20, 3); g.fillStyle = '#5fb7e6'; g.fillRect(2, 2, 18, 1); g.fillStyle = '#bff6ff'; g.fillRect(6, 2, 3, 1); break;
      default: drawPower(g, tool as PowerKind, 9, 9, 0.5);
    }
    return c;
  }

  constructor() {
    for (const tool of TOOLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tool = tool;
      const name = document.createElement('span');
      name.textContent = tool === 'select' ? '선택' : tool === 'erase' ? '지우개' : ITEM_NAMES[tool];
      b.title = name.textContent;
      b.append(this.icon(tool), name);
      b.addEventListener('click', () => { this.tool = tool; this.refresh(); });
      $('ed-tools').append(b);
    }
    document.querySelectorAll<HTMLButtonElement>('[data-ed]').forEach((b) => b.addEventListener('click', () => this.command(b.dataset.ed!)));
    // A little picture for each control of the form; its label goes in a span, so it can change without losing it.
    document.querySelectorAll<HTMLElement>('.ed-form > button[data-ed], .ed-form .step[data-icon]').forEach((el) => {
      const rows = FORM_ICONS[el.dataset.icon ?? el.dataset.ed ?? ''];
      if (!rows) return;
      if (el.tagName === 'BUTTON') { const label = document.createElement('span'); label.textContent = el.textContent; el.replaceChildren(pixels(rows), label); }
      else el.prepend(pixels(rows));
    });
    // What a control does, in the help line, while it is pointed at or focused (a tap on a phone focuses it).
    const help = () => { $('ed-help').textContent = HELP[this.tool]; };
    document.querySelectorAll<HTMLElement>('#editor [data-tip]').forEach((el) => {
      const tip = () => { $('ed-help').textContent = `ⓘ ${el.dataset.tip}`; };
      el.addEventListener('pointerenter', tip); el.addEventListener('focusin', tip);
      el.addEventListener('pointerleave', help); el.addEventListener('focusout', help);
    });
    $('ed-issues').addEventListener('click', () => this.showProblems($('ed-problems').hidden === true));
    $('ed-toast').addEventListener('click', () => this.message(''));
    // On a short screen the tools and the segment's settings share one side panel, a tab each.
    document.querySelectorAll<HTMLButtonElement>('[data-edtab]').forEach((b) => b.addEventListener('click', () => {
      $('editor').classList.toggle('tab-form', b.dataset.edtab === 'form');
      document.querySelectorAll('[data-edtab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    const title = $('ed-title') as HTMLInputElement;
    title.maxLength = LIMITS.title;
    title.addEventListener('change', () => this.edit((m) => { m.title = cleanTitle(title.value) || '이름 없는 맵'; }));
    const scroll = $('ed-scroll') as HTMLInputElement;
    scroll.addEventListener('input', () => { this.camX = Number(scroll.value); });

    this.el.addEventListener('pointerdown', (e) => {
      if (this.drag) return;
      this.drag = { id: e.pointerId, x: e.clientX, cam: this.camX, moved: false };
      try { this.el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    });
    this.el.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 8) d.moved = true;
      if (d.moved) this.look(d.cam - dx / this.scale);
    });
    this.el.addEventListener('pointerup', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      if (!d.moved) {
        const b = this.el.getBoundingClientRect();
        this.tap((e.clientX - b.left) / this.scale + this.camX, (e.clientY - b.top) / this.scale + this.camY());
      }
    });
    this.el.addEventListener('pointercancel', () => { this.drag = null; });
    this.el.addEventListener('wheel', (e) => { e.preventDefault(); this.look(this.camX + (e.deltaX + e.deltaY) / this.scale); }, { passive: false });
  }

  open(map: GameMap, id: string | null): void {
    this.map = structuredClone(map);
    this.id = id;
    this.dirty = false;
    this.selected = 0;
    this.tool = 'select';
    this.undoStack = [];
    this.redoStack = [];
    this.camX = -20;
    this.message('');
    this.known = new Set(checkMap(this.map).map(problemKey));
    this.refresh();
    this.showProblems(false);
  }

  get valid(): boolean { return this.problems.length === 0; }
  /** A short note that shows for a moment over the editor and goes away by itself (or on a tap). */
  message(text: string, warn = false): void {
    const t = $('ed-toast');
    clearTimeout(this.toastTimer);
    if (text) t.textContent = text;
    t.classList.toggle('warn', warn);
    t.classList.toggle('show', !!text);
    if (text) this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 2800 + text.length * 40);
  }
  /** The list of problems, opened over the map from the ⚠ button; each one takes you to its segment. */
  showProblems(open = true): void {
    const list = $('ed-problems');
    list.hidden = !open || !this.problems.length;
    $('ed-issues').setAttribute('aria-expanded', String(!list.hidden));
  }
  /** Commits a title still being typed, before saving or testing. */
  flush(): void { ($('ed-title') as HTMLInputElement).blur(); }

  // ---- Changes -----------------------------------------------------------

  private edit(f: (m: GameMap) => void): void {
    const before = JSON.stringify(this.map);
    f(this.map);
    if (JSON.stringify(this.map) === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.message('');
    this.refresh();
  }

  private get seg(): Segment { return this.map.segments[this.selected]!; }
  /** Items that no longer fit after a size change are removed with it. */
  private trim(s: Segment): void { s.items = s.items.filter((it) => it.x <= s.w + s.gap && !(it.t === 'line' && (it.x < s.w || it.x + LINE_W > s.w + s.gap))); }

  private command(c: string): void {
    const segs = this.map.segments;
    const i = this.selected;
    const [name, amount] = c.split(':') as [string, string | undefined];
    const by = Number(amount ?? 0);
    switch (name) {
      case 'prev': this.select(i - 1, true); return;
      case 'next': this.select(i + 1, true); return;
      case 'undo': this.travel(this.undoStack, this.redoStack); return;
      case 'redo': this.travel(this.redoStack, this.undoStack); return;
      case 'w': this.edit(() => { this.seg.w = clamp(this.seg.w + by, LIMITS.w); this.trim(this.seg); }); return;
      case 'gap': this.edit(() => { this.seg.gap = clamp(this.seg.gap + by, LIMITS.gap); this.trim(this.seg); }); return;
      case 'h': this.edit(() => { this.seg.h = clamp(this.seg.h + by, LIMITS.h); }); return;
      case 'base': this.edit((m) => { m.pace.base = clamp(m.pace.base + by, LIMITS.base); }); return;
      case 'gain': this.edit((m) => { m.pace.gain = clamp(m.pace.gain + by, LIMITS.gain); }); return;
      case 'kind': this.edit(() => { this.seg.kind = this.seg.kind === 'building' ? 'scaffold' : 'building'; if (this.seg.kind === 'scaffold') this.seg.road = false; }); return;
      case 'road': this.edit(() => { this.seg.road = !this.seg.road; }); return;
      case 'route': case 'vent': case 'cracked': case 'golden': {
        const key = c as 'route' | 'vent' | 'cracked' | 'golden';
        this.edit(() => { if (this.seg[key]) delete this.seg[key]; else this.seg[key] = true; });
        if (key === 'route' && this.seg.route) this.message('유리 지붕에서 ↓ 를 누르면 건물 안 통로로 들어가요. 상자·배관·상자는 자동으로 놓여요.');
        return;
      }
      case 'clear': this.edit(() => { this.seg.items = []; }); return;
      case 'add': case 'copy':
        if (segs.length >= LIMITS.segments) { this.message(`구간은 ${LIMITS.segments}개까지입니다.`); return; }
        this.edit((m) => {
          const s = this.seg;
          m.segments.splice(i + 1, 0, name === 'copy' ? structuredClone(s) : { kind: 'building', w: 40, h: s.h, gap: 8, road: false, items: [] });
          if (s.gap === 0 && i === segs.length - 2) s.gap = 8;
        });
        this.select(i + 1, true);
        return;
      case 'del':
        if (segs.length <= 2) { this.message('구간은 2개 이상 필요합니다.'); return; }
        this.edit((m) => { m.segments.splice(i, 1); this.selected = Math.min(i, m.segments.length - 1); });
        return;
      case 'left': case 'right': {
        const to = i + (name === 'left' ? -1 : 1);
        if (to < 0 || to >= segs.length) return;
        this.edit((m) => { const [s] = m.segments.splice(i, 1); m.segments.splice(to, 0, s!); this.selected = to; });
        return;
      }
    }
  }

  private travel(from: string[], to: string[]): void {
    const s = from.pop();
    if (s === undefined) return;
    to.push(JSON.stringify(this.map));
    this.map = JSON.parse(s) as GameMap;
    this.selected = Math.min(this.selected, this.map.segments.length - 1);
    this.dirty = true;
    this.refresh();
  }

  private select(i: number, center: boolean): void {
    this.selected = clamp(i, [0, this.map.segments.length - 1]);
    if (center) {
      const s = this.seg, x = segmentStarts(this.map)[this.selected]! * UNIT;
      this.look(x + (s.w * UNIT) / 2 - this.el.clientWidth / this.scale / 2);
    }
    this.refresh();
  }

  private tap(px: number, py: number): void {
    const starts = segmentStarts(this.map);
    const ux = px / UNIT;
    let i = starts.findIndex((x, k) => ux >= x && ux < x + this.map.segments[k]!.w + this.map.segments[k]!.gap);
    if (i < 0) i = ux < 0 ? 0 : this.map.segments.length - 1;
    if (this.tool === 'select') { this.select(i, false); return; }
    const s = this.map.segments[i]!;
    const x0 = starts[i]! * UNIT, y0 = -s.h * UNIT;
    if (this.tool === 'erase') {
      let best = -1, near = 26;
      s.items.forEach((it, k) => {
        const wide = it.t === 'tank' ? 18 : it.t === 'line' ? 20 : it.t === 'coin' || it.t === 'gold' || it.t === 'diamond' ? 0 : 8;
        const d = Math.hypot(Math.max(0, Math.abs(x0 + it.x * UNIT + wide - px) - wide), y0 - (onFloor(it.t) ? 10 : it.y * UNIT) - py);
        if (d < near) { near = d; best = k; }
      });
      if (best >= 0) this.edit(() => { s.items.splice(best, 1); this.selected = i; });
      return;
    }
    const t = this.tool;
    if (this.map.segments.reduce((n, q) => n + q.items.length, 0) >= LIMITS.items) { this.message(`물체는 ${LIMITS.items}개까지입니다.`); return; }
    let x = Math.round(ux - starts[i]! - (t === 'tank' ? 2 : t === 'line' ? LINE_W / 2 : t === 'ac' || t === 'drone' || t === 'pigeon' ? 1 : 0));
    let y = onFloor(t) ? 0 : clamp(Math.round((y0 - py) / UNIT), LIMITS.itemY);
    if (t === 'drone') y = clamp(y, [3, 6]);
    if (t === 'line') {
      if (s.gap < LINE_W + 1) { this.message('빨랫줄을 놓으려면 간격이 6 이상이어야 합니다.'); return; }
      x = clamp(x, [s.w, s.w + s.gap - LINE_W]);
      y = clamp(y, [2, 8]);
    } else x = clamp(x, [0, s.w + s.gap]);
    this.edit(() => { s.items.push({ t, x, y }); this.selected = i; });
  }

  // ---- View --------------------------------------------------------------

  private refresh(): void {
    this.problems = checkMap(this.map);
    this.course = buildCourse(this.map);
    const s = this.seg, n = this.map.segments.length;
    const text = (id: string, v: string) => { $(id).textContent = v; };
    const title = $('ed-title') as HTMLInputElement;
    if (document.activeElement !== title) title.value = this.map.title;
    text('ed-seg', `구간 ${this.selected + 1}/${n}`);
    text('ed-w', String(s.w)); text('ed-gap', String(s.gap)); text('ed-h', String(s.h));
    text('ed-base', String(this.map.pace.base)); text('ed-gain', String(this.map.pace.gain));
    const kind = document.querySelector('[data-ed=kind]')!, road = document.querySelector<HTMLButtonElement>('[data-ed=road]')!;
    const label = (b: Element, v: string) => { (b.querySelector('span') ?? b).textContent = v; };
    label(kind, s.kind === 'building' ? '종류: 건물' : '종류: 발판');
    label(road, s.road ? '뒤에 도로: 있음' : '뒤에 도로: 없음');
    road.setAttribute('aria-pressed', String(s.road));
    road.disabled = s.kind !== 'building';
    const flag = (key: 'route' | 'vent' | 'cracked' | 'golden', name: string, off: boolean) => {
      const b = document.querySelector<HTMLButtonElement>(`[data-ed=${key}]`)!;
      label(b, `${name}: ${s[key] ? '있음' : '없음'}`);
      b.setAttribute('aria-pressed', String(!!s[key]));
      b.disabled = off && !s[key];
    };
    const last = this.selected === n - 1;
    flag('route', '실내 통로', s.kind !== 'building' || this.selected === 0 || last);
    flag('vent', '뒤에 상승 기류', last);
    flag('cracked', '균열 옥상', s.kind !== 'building');
    flag('golden', '골든 러시', false);
    document.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === this.tool)));
    if (!document.querySelector('#editor [data-tip]:hover, #editor [data-tip]:focus-within')) text('ed-help', HELP[this.tool]);
    (document.querySelector('[data-ed=undo]') as HTMLButtonElement).disabled = !this.undoStack.length;
    (document.querySelector('[data-ed=redo]') as HTMLButtonElement).disabled = !this.redoStack.length;
    const list = $('ed-problems');
    list.replaceChildren(...this.problems.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = (p.segment === null ? '' : `구간 ${p.segment + 1}: `) + p.text;
      b.addEventListener('click', () => { this.showProblems(false); if (p.segment !== null) this.select(p.segment, true); });
      return b;
    }));
    const issues = $('ed-issues') as HTMLButtonElement;
    // Its place stays taken, so the bar never wraps differently when problems come and go.
    issues.style.visibility = this.problems.length ? 'visible' : 'hidden';
    issues.disabled = !this.problems.length;
    issues.textContent = `⚠ 문제 ${this.problems.length}`;
    if (!this.problems.length) this.showProblems(false);
    // A problem the last change made shows for a moment by itself, instead of a list to scroll to.
    const fresh = this.problems.find((p) => !this.known.has(problemKey(p)));
    this.known = new Set(this.problems.map(problemKey));
    if (fresh) this.message(`⚠ ${fresh.segment === null ? '' : `구간 ${fresh.segment + 1}: `}${fresh.text}`, true);
    const starts = segmentStarts(this.map);
    const scroll = $('ed-scroll') as HTMLInputElement;
    scroll.min = '-40';
    scroll.max = String(Math.max(0, (starts[n - 1]! + this.map.segments[n - 1]!.w) * UNIT - 120));
    this.look(this.camX);
  }

  private look(x: number): void {
    const scroll = $('ed-scroll') as HTMLInputElement;
    this.camX = clamp(x, [-40, Number(scroll.max)]);
    scroll.value = String(Math.round(this.camX));
  }

  private viewH(): number { return this.el.clientHeight / this.scale; }
  private camY(): number { return -this.viewH() * 0.5 - this.seg.h * UNIT * 0.3; }

  draw(dt: number): void {
    this.t += dt;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (this.el.width !== Math.round(w * dpr) || this.el.height !== Math.round(h * dpr)) {
      this.el.width = Math.round(w * dpr);
      this.el.height = Math.round(h * dpr);
    }
    this.scale = Math.max(0.6, h / 330);
    const g = this.g, k = this.scale * dpr;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.imageSmoothingEnabled = false;
    const vw = w / this.scale, vh = h / this.scale;
    g.fillStyle = '#4b2f75'; g.fillRect(0, 0, vw, vh);
    const cx = Math.round(this.camX), cy = Math.round(this.camY());
    // Unit grid, a line every five.
    g.fillStyle = '#5b3f86';
    for (let x = Math.ceil(cx / 40) * 40; x < cx + vw; x += 40) g.fillRect(x - cx, 0, 1, vh);
    for (let y = Math.ceil(cy / 40) * 40; y < cy + vh; y += 40) g.fillRect(0, y - cy, vw, 1);
    const roofs = this.course.city.roofs;
    roofs.forEach((r, i) => {
      const x = r.x - cx, y = r.y - cy;
      if (x > vw || x + r.w < 0) return;
      if (r.kind === 'scaffold') drawScaffold(g, x, y, r.w, ROAD_DEPTH + 40);
      else {
        g.fillStyle = ['#d9b49a', '#c7c3cf', '#e0c48c', '#a9c0c4', '#cf8f7e'][r.style]!; g.fillRect(x, y, r.w, vh - y + 10);
        g.fillStyle = '#57b86a'; g.fillRect(x, y, r.w, 6);
      }
      if (i === this.selected) {
        g.fillStyle = 'rgba(125,255,240,.28)'; g.fillRect(x, y, r.w, 60);
        g.fillStyle = '#7dfff0'; g.fillRect(x, y - 2, r.w, 2); g.fillRect(x, y, 2, 60); g.fillRect(x + r.w - 2, y, 2, 60);
      }
      g.fillStyle = '#1a1230'; g.font = '11px Galmuri11, sans-serif'; g.textBaseline = 'top';
      g.fillText(String(i + 1), Math.max(x, 0) + 6, y + 12);
    });
    for (const r of roofs) if (r.road) drawRoad(g, r.road, cx, cy, vh, 0);
    for (const r of roofs) {
      for (const l of r.lines) { g.fillStyle = '#f5ead8'; g.fillRect(r.x + r.w - cx, l.y - cy, r.gap, 1); drawQuilt(g, l.x - cx, l.y - cy, l.w, l.style, this.t); }
      const w = r.route;
      if (w) drawRoute(g, Math.round(w.x - cx), Math.round(r.y - cy), w.rampStart - w.x, w.rampEnd - w.rampStart, w.y - r.y, w.hatch, false, this.t);
      for (const o of r.obstacles) {
        if (o.kind === 'ac') drawAc(g, o.x - cx, o.y - cy, this.t);
        else if (o.kind === 'tank') drawTank(g, o.x - cx, o.y - cy);
        else if (o.kind === 'box') drawBox(g, o.x - cx, o.y - cy);
        else drawBar(g, o.x - cx, o.y - cy, o.w, o.h, this.t);
      }
      for (const p of r.puddles ?? []) { g.fillStyle = '#2d5f8a'; g.fillRect(p.x - cx, r.y - cy - 1, p.w, 3); g.fillStyle = '#5fb7e6'; g.fillRect(p.x - cx + 2, r.y - cy - 1, p.w - 4, 1); }
      // Rising air in the gap: streaks up to where it carries.
      if (r.vent) {
        g.fillStyle = 'rgba(220,245,255,.55)';
        for (let k = 0; k < 5; k++) { const sx = r.vent.x - cx + ((k + 0.5) * r.vent.w) / 5; for (let yy = r.vent.top - cy; yy < r.y - cy + 80; yy += 14) g.fillRect(sx, yy + ((this.t * 40 + k * 5) % 14), 1, 6); }
        g.fillStyle = '#bff6ff'; g.fillRect(r.vent.x - cx, r.vent.top - cy, r.vent.w, 1);
      }
      // A golden rush: a gold band along the roof and a glow over its gap.
      if (r.golden) {
        g.fillStyle = 'rgba(255,200,70,.18)'; g.fillRect(r.x - cx, r.y - cy - 60, r.w + r.gap, 60);
        g.fillStyle = '#f5c440'; g.fillRect(r.x - cx, r.y - cy - 1, r.w, 3);
      }
      // Cracks across a roof that gives way.
      if (r.cracked) { g.fillStyle = '#2a1c40'; for (let k = r.x + 18; k < r.x + r.w - 12; k += 34) { g.fillRect(k - cx, r.y - cy, 1, 3); g.fillRect(k - cx + 1, r.y - cy + 2, 2, 1); g.fillRect(k - cx - 2, r.y - cy + 3, 2, 1); } }
      for (const c of r.coins) {
        if (c.kind === 'diamond') drawDiamond(g, c.x - cx - 5, c.y - cy - 4, this.t);
        else g.drawImage(this.sprites[c.kind === 'gold' ? 'gold' : 'coin'][0]!, c.x - cx - 3, c.y - cy - 3);
      }
      for (const w of r.powers) drawPower(g, w.kind, w.x - cx, w.y - cy, this.t);
      for (const e of r.enemies) (e.kind === 'drone' ? drawDrone : drawPigeon)(g, e.x - cx, e.y - cy, this.t);
    }
    const last = roofs[roofs.length - 1]!;
    drawFlag(g, (this.course.city.goalX ?? 0) - cx, last.y - cy, this.t);
    g.drawImage(this.sprites.run[0]!, 60 - cx - 2, roofs[0]!.y - cy - 15);
  }
}
