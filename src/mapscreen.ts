import { checkMap, LIMITS, parseMap, PRACTICE, serializeMap, type GameMap, type MapProblem } from './maps';
import { MAX_MAPS, type MapStore } from './mapstore';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export function downloadMap(map: GameMap): void {
  const url = URL.createObjectURL(new Blob([serializeMap(map)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  // Letters and digits of any script; everything else could trouble a file system.
  a.download = `${map.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'map'}.aptmap.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export interface MapActions {
  play(map: GameMap, id: string | null): void;
  edit(map: GameMap, id: string | null): void;
  /** A published map, whose completion times are ranked. */
  playShared?(map: GameMap, sharedId: string): void;
  /** Opens a published map's ranking. */
  times?(sharedId: string): void;
}

/** One card; every title goes in as text. */
export function mapCard(title: string, detail: string, buttons: [label: string, run: (b: HTMLButtonElement) => void, primary?: boolean, off?: boolean][]): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';
  const info = document.createElement('div');
  const name = document.createElement('span');
  name.textContent = title;
  const small = document.createElement('small');
  small.textContent = detail;
  info.append(name, small);
  card.append(info);
  for (const [label, run, primary, off] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.disabled = !!off;
    if (primary) b.className = 'primary';
    b.addEventListener('click', () => run(b));
    card.append(b);
  }
  return card;
}

/** The player's own shelf: play, edit, share as a file, delete. */
export class MapScreen {
  /** Lets the online side add its buttons. */
  onRefresh: () => void = () => {};

  constructor(private store: MapStore, private act: MapActions) {
    const file = $('map-file') as HTMLInputElement;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) void this.load(f);
    });
  }

  message(text: string): void { $('maps-msg').textContent = text; }
  pickFile(): void { ($('map-file') as HTMLInputElement).click(); }

  private async load(f: File): Promise<void> {
    if (f.size > LIMITS.bytes) { this.message(`파일이 너무 큽니다(최대 ${LIMITS.bytes / 1024}KB).`); return; }
    let text = '';
    try { text = await f.text(); } catch { this.message('파일을 읽지 못했습니다.'); return; }
    const { map, problems } = parseMap(text);
    if (!map) { this.message(problems.map((p: MapProblem) => (p.segment === null ? '' : `구간 ${p.segment + 1}: `) + p.text).slice(0, 3).join(' ')); return; }
    if (!this.store.put(map, null)) { this.message(`맵은 ${MAX_MAPS}개까지 보관할 수 있습니다.`); return; }
    this.refresh();
    this.message(problems.length ? `불러왔지만 고칠 점이 ${problems.length}개 있습니다. 편집에서 확인하세요.` : '맵을 불러왔습니다.');
  }

  refresh(): void {
    const cards = [mapCard(PRACTICE.title, '기본 제공', [
      ['플레이', () => this.act.play(PRACTICE, null), true],
      ['복사해 편집', () => this.act.edit({ ...PRACTICE, title: '연습 옥상 사본' }, null)],
      ['파일로', () => downloadMap(PRACTICE)],
    ])];
    for (const m of this.store.maps) {
      const ok = checkMap(m.map).length === 0;
      const detail = ok ? `${m.cleared ? '완주 · ' : ''}최고 ${m.best.toLocaleString('ko-KR')}점 · 구간 ${m.map.segments.length}개` : '고칠 점이 있어 아직 플레이할 수 없습니다';
      const card = mapCard(m.map.title, detail, [
        ['플레이', () => this.act.play(m.map, m.id), true, !ok],
        ['편집', () => this.act.edit(m.map, m.id)],
        ['파일로', () => downloadMap(m.map)],
        ['삭제', (b) => {
          if (b.dataset.sure) { this.store.remove(m.id); this.refresh(); this.message('삭제했습니다.'); return; }
          b.dataset.sure = '1';
          b.textContent = '정말 삭제';
          setTimeout(() => { delete b.dataset.sure; b.textContent = '삭제'; }, 3000);
        }],
      ]);
      card.dataset.id = m.id;
      card.dataset.ok = ok ? '1' : '0';
      cards.push(card);
    }
    $('map-list').replaceChildren(...cards);
    this.onRefresh();
    if (!this.store.available) this.message('이 브라우저에서는 저장할 수 없습니다. 맵을 파일로 내려받아 두세요.');
  }
}
