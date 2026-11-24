import type { Course } from './game';
import { jumpReach, paceSpeed, type Pace } from './physics';
import { OBSTACLE_SIZE, RAMP_RUN, ROAD_DEPTH, type City, type Roof } from './world';

/** Map files measure everything in units of 8 pixels. */
export const UNIT = 8;
export const MAP_FORMAT = 'apt-jump-map';
export const MAP_VERSION = 1;
export const LIMITS = {
  bytes: 64 * 1024, title: 24, segments: 120, items: 600, length: 4000,
  w: [10, 150], h: [-12, 12], gap: [0, 40], itemY: [1, 24], base: [90, 200], gain: [0, 140],
  firstW: 40, lastW: 20, spawnClear: 30, edgeClear: 8, hazardGap: 8,
} as const;
export const ITEM_TYPES = ['coin', 'gold', 'diamond', 'ac', 'tank', 'line', 'drone', 'pigeon'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_NAMES: Record<ItemType, string> = {
  coin: '동전', gold: '분홍 동전', diamond: '다이아', ac: '실외기', tank: '물탱크', line: '빨랫줄', drone: '드론', pigeon: '비둘기',
};
/** Widths in units of things that can hurt. */
const HAZARD_W: Partial<Record<ItemType, number>> = { ac: OBSTACLE_SIZE.ac.w / UNIT, tank: OBSTACLE_SIZE.tank.w / UNIT, drone: 2, pigeon: 2 };
export const LINE_W = 5;
/** These stand on the roof; everything else has a height above it. */
export const onFloor = (t: ItemType) => t === 'ac' || t === 'tank' || t === 'pigeon';

export interface MapItem { t: ItemType; x: number; y: number }
export interface Segment { kind: 'building' | 'scaffold'; w: number; h: number; gap: number; road: boolean; items: MapItem[] }
export interface GameMap { format: typeof MAP_FORMAT; version: typeof MAP_VERSION; title: string; pace: Pace; segments: Segment[] }
export interface MapProblem { segment: number | null; text: string }
export type MapResult = { map: GameMap; problems: MapProblem[] } | { map: null; problems: MapProblem[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown, [a, b]: readonly [number, number]): v is number => typeof v === 'number' && Number.isInteger(v) && v >= a && v <= b;

/** Drops control and direction-override characters; the text is only ever shown as text. */
export function cleanTitle(v: string): string {
  const hidden = (c: number) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f)
    || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff;
  return [...v].filter((ch) => !hidden(ch.codePointAt(0)!)).join('').trim().slice(0, LIMITS.title);
}

/** Checks the shape of untrusted data and copies only what is known. Null with problems when it can't be a map. */
export function readMap(v: unknown): MapResult {
  const problems: MapProblem[] = [];
  const bad = (segment: number | null, text: string) => { if (problems.length < 20) problems.push({ segment, text }); };
  const fail = (text: string): MapResult => ({ map: null, problems: [...problems, { segment: null, text }] });
  if (!isObj(v)) return fail('맵 파일이 아닙니다.');
  if (v.format !== MAP_FORMAT) return fail('아파트 점프 맵 파일이 아닙니다.');
  if (v.version !== MAP_VERSION) return fail('지원하지 않는 맵 버전입니다.');
  if (typeof v.title !== 'string' || v.title.length > 200 || !cleanTitle(v.title)) return fail('맵 이름이 없거나 너무 깁니다.');
  const pace = v.pace;
  if (!isObj(pace) || !whole(pace.base, LIMITS.base) || !whole(pace.gain, LIMITS.gain)) return fail('속도 값이 범위를 벗어났습니다.');
  if (!Array.isArray(v.segments) || v.segments.length < 2) return fail('구간이 2개 이상 필요합니다.');
  if (v.segments.length > LIMITS.segments) return fail(`구간은 ${LIMITS.segments}개까지입니다.`);
  const segments: Segment[] = [];
  let items = 0;
  v.segments.forEach((s: unknown, i) => {
    if (!isObj(s) || (s.kind !== 'building' && s.kind !== 'scaffold')) return bad(i, '구간 종류가 잘못되었습니다.');
    if (!whole(s.w, LIMITS.w) || !whole(s.h, LIMITS.h) || !whole(s.gap, LIMITS.gap) || typeof s.road !== 'boolean') return bad(i, '구간의 길이·높이·간격 값이 잘못되었습니다.');
    if (!Array.isArray(s.items)) return bad(i, '물체 목록이 없습니다.');
    items += s.items.length;
    if (items > LIMITS.items) return bad(i, `물체는 ${LIMITS.items}개까지입니다.`);
    const list: MapItem[] = [];
    for (const it of s.items as unknown[]) {
      if (!isObj(it) || !ITEM_TYPES.includes(it.t as ItemType)) { bad(i, '알 수 없는 물체가 있습니다.'); continue; }
      const t = it.t as ItemType;
      if (!whole(it.x, [0, s.w + s.gap]) || !whole(it.y, onFloor(t) ? [0, 0] : LIMITS.itemY)) { bad(i, `${ITEM_NAMES[t]}의 위치가 범위를 벗어났습니다.`); continue; }
      list.push({ t, x: it.x, y: it.y });
    }
    segments.push({ kind: s.kind, w: s.w, h: s.h, gap: s.gap, road: s.road, items: list });
    return undefined;
  });
  if (problems.length) return { map: null, problems };
  const map: GameMap = { format: MAP_FORMAT, version: MAP_VERSION, title: cleanTitle(v.title), pace: { base: pace.base, gain: pace.gain }, segments };
  return { map, problems: checkMap(map) };
}

export function parseMap(text: string): MapResult {
  if (new TextEncoder().encode(text).length > LIMITS.bytes) return { map: null, problems: [{ segment: null, text: `파일이 너무 큽니다(최대 ${LIMITS.bytes / 1024}KB).` }] };
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { map: null, problems: [{ segment: null, text: 'JSON을 읽을 수 없습니다.' }] }; }
  return readMap(v);
}
export const serializeMap = (m: GameMap) => JSON.stringify(m, null, 1);

/** Start of each segment in units, from the runner's side. */
export function segmentStarts(m: GameMap): number[] {
  let x = 0;
  return m.segments.map((s) => { const at = x; x += s.w + s.gap; return at; });
}
/** First building after i, where a street that starts at i has to end. */
function roadEnd(m: GameMap, i: number): number { return m.segments.findIndex((s, k) => k > i && s.kind === 'building'); }

/** Rules about play: everything that would make a map impossible or unfair. */
export function checkMap(m: GameMap): MapProblem[] {
  const out: MapProblem[] = [];
  const bad = (segment: number | null, text: string) => { if (out.length < 20) out.push({ segment, text }); };
  const segs = m.segments;
  const first = segs[0], last = segs[segs.length - 1];
  if (!first || !last || segs.length < 2) { bad(null, '구간이 2개 이상 필요합니다.'); return out; }
  const starts = segmentStarts(m);
  if (starts[segs.length - 1]! + last.w > LIMITS.length) bad(null, '맵이 너무 깁니다.');
  if (first.kind !== 'building' || first.w < LIMITS.firstW) bad(0, `시작은 길이 ${LIMITS.firstW} 이상의 건물이어야 합니다.`);
  if (last.kind !== 'building' || last.w < LIMITS.lastW) bad(segs.length - 1, `도착은 길이 ${LIMITS.lastW} 이상의 건물이어야 합니다.`);
  if (last.road) bad(segs.length - 1, '마지막 구간에는 도로를 놓을 수 없습니다.');

  let streetUntil = -1;
  segs.forEach((s, i) => {
    const next = segs[i + 1];
    if (s.road && s.kind !== 'building') bad(i, '도로는 건물에서만 시작할 수 있습니다.');
    else if (s.road) {
      const e = roadEnd(m, i);
      if (e > 0) {
        streetUntil = e;
        const length = (starts[e]! - starts[i]! - s.w) * UNIT;
        const rise = ROAD_DEPTH + (segs[e]!.h - s.h) * UNIT;
        if (rise < 40 || rise > 240) bad(i, '도로 끝 건물의 높이 차가 너무 큽니다.');
        else if (length < rise * RAMP_RUN + 96) bad(i, `도로가 짧습니다. 간격과 발판을 더해 ${Math.ceil((rise * RAMP_RUN + 96) / UNIT)} 이상으로 늘리세요.`);
        for (let k = i + 1; k < e; k++) if (ROAD_DEPTH + (segs[k]!.h - s.h) * UNIT < 48) bad(k, '발판이 도로에 너무 가깝습니다.');
      }
    }
    if (next && i >= streetUntil && !s.road) {
      const reach = jumpReach(paceSpeed(m.pace, (starts[i]! + s.w) * UNIT), (s.h - next.h) * UNIT);
      if (reach <= 0 || s.gap * UNIT > reach * 0.9) bad(i, reach <= 0 ? '다음 구간이 너무 높습니다.' : `간격이 너무 넓습니다(최대 ${Math.floor((reach * 0.9) / UNIT)}).`);
    }

    const seen = new Set<string>();
    const hazards: { x: number; w: number; t: ItemType }[] = [];
    for (const it of s.items) {
      const key = `${it.x},${it.y},${onFloor(it.t)}`;
      if (seen.has(key)) bad(i, `${ITEM_NAMES[it.t]}이(가) 다른 물체와 겹칩니다.`);
      seen.add(key);
      const hw = HAZARD_W[it.t];
      if (it.t === 'line' && (it.x < s.w || it.x + LINE_W > s.w + s.gap)) bad(i, '빨랫줄은 간격 안에 두어야 합니다.');
      if (hw === undefined) continue;
      hazards.push({ x: it.x, w: hw, t: it.t });
      if (i === 0 && it.x < LIMITS.spawnClear) bad(i, `출발점 근처(${LIMITS.spawnClear} 이내)에는 장애물을 둘 수 없습니다.`);
      if (it.x < LIMITS.edgeClear || it.x + hw > s.w - LIMITS.edgeClear) bad(i, `${ITEM_NAMES[it.t]}은(는) 구간 양끝에서 ${LIMITS.edgeClear} 이상 떨어져야 합니다.`);
      if (it.t === 'drone' && (it.y < 3 || it.y > 6)) bad(i, '드론 높이는 3~6이어야 합니다.');
    }
    hazards.sort((a, b) => a.x - b.x);
    for (let k = 1; k < hazards.length; k++) {
      const a = hazards[k - 1]!, b = hazards[k]!;
      if (b.x - (a.x + a.w) < LIMITS.hazardGap) bad(i, `${ITEM_NAMES[a.t]}와(과) ${ITEM_NAMES[b.t]} 사이를 ${LIMITS.hazardGap} 이상 띄우세요.`);
    }
  });
  return out;
}

class FixedCity implements City {
  constructor(public roofs: Roof[], public readonly goalX: number) {}
  ensure(): void { /* a made map is complete from the start */ }
}

/** Builds a playable course. Call only with a map that passed checkMap, or to preview. */
export function buildCourse(m: GameMap): Course {
  const starts = segmentStarts(m);
  let id = 1;
  const roofs = m.segments.map((s, i): Roof => {
    const lead = i === 0 ? 200 : 0; // roof behind the start line
    const x = starts[i]! * UNIT, y = -s.h * UNIT;
    const next = m.segments[i + 1];
    const r: Roof = {
      id: id++, kind: s.kind, x: x - lead, w: s.w * UNIT + lead, y, style: (i * 3) % 5, seed: 1000 + i * 77, number: 101 + i,
      obstacles: [], lines: [], coins: [], enemies: [], road: null,
      gap: next ? s.gap * UNIT : 0, nextDy: next ? (s.h - next.h) * UNIT : 0,
    };
    for (const it of s.items) {
      const ix = x + it.x * UNIT, iy = y - it.y * UNIT;
      if (it.t === 'ac' || it.t === 'tank') { const z = OBSTACLE_SIZE[it.t]; r.obstacles.push({ id: id++, kind: it.t, x: ix, y: y - z.h, ...z }); }
      else if (it.t === 'line') r.lines.push({ id: id++, x: ix, w: LINE_W * UNIT, y: iy, style: it.x % 4 });
      else if (it.t === 'drone') r.enemies.push({ id: id++, kind: 'drone', x: ix, y: iy, amp: 8, phase: (it.x % 8) / 8 });
      else if (it.t === 'pigeon') r.enemies.push({ id: id++, kind: 'pigeon', x: ix, y: y - 13, amp: 0, phase: 0 });
      else r.coins.push({ x: ix, y: iy, kind: it.t, taken: false });
    }
    return r;
  });
  m.segments.forEach((s, i) => {
    const e = s.road ? roadEnd(m, i) : -1;
    if (e < 0) return;
    const r = roofs[i]!, end = roofs[e]!;
    const x = r.x + r.w, y = r.y + ROAD_DEPTH;
    r.road = { id: id++, x, y, rampEnd: end.x, rampY: end.y, rampStart: Math.max(x, Math.round(end.x - (y - end.y) * RAMP_RUN)) };
  });
  const last = roofs[roofs.length - 1]!;
  return { city: new FixedCity(roofs, last.x + last.w - 56), pace: m.pace, startY: roofs[0]!.y };
}

const seg = (w: number, gap: number, items: MapItem[] = [], more: Partial<Segment> = {}): Segment =>
  ({ kind: 'building', w, h: 0, gap, road: false, items, ...more });
const row = (t: ItemType, from: number, n: number, y: number, step = 2): MapItem[] =>
  Array.from({ length: n }, (_, i) => ({ t, x: from + i * step, y }));

export function blankMap(): GameMap {
  return {
    format: MAP_FORMAT, version: MAP_VERSION, title: '새 맵', pace: { base: 118, gain: 60 },
    segments: [seg(60, 8, row('coin', 36, 4, 1)), seg(50, 8), seg(40, 0)],
  };
}

/** Comes with the game, and is the course Patch's test plays. */
export const PRACTICE: GameMap = {
  format: MAP_FORMAT, version: MAP_VERSION, title: '연습 옥상', pace: { base: 118, gain: 60 },
  segments: [
    seg(90, 8, row('coin', 64, 7, 1)),
    seg(62, 8, [{ t: 'ac', x: 34, y: 0 }]),
    seg(70, 8, [{ t: 'diamond', x: 40, y: 15 }], { h: 2 }),
    seg(60, 9, [{ t: 'pigeon', x: 34, y: 0 }]),
    seg(56, 9, [{ t: 'drone', x: 30, y: 4 }], { h: 1 }),
    seg(44, 10, [], { road: true }),
    seg(24, 10, row('coin', 6, 4, 1), { kind: 'scaffold' }),
    seg(24, 10, [], { kind: 'scaffold', h: 1 }),
    seg(20, 10, row('coin', 4, 3, 1), { kind: 'scaffold' }),
    seg(56, 10, [{ t: 'tank', x: 24, y: 0 }, { t: 'gold', x: 25, y: 5 }, { t: 'gold', x: 27, y: 5 }]),
    seg(50, 11, [{ t: 'line', x: 53, y: 3 }, { t: 'gold', x: 54, y: 5 }, { t: 'gold', x: 56, y: 5 }]),
    seg(50, 0, row('coin', 12, 6, 1)),
  ],
};
