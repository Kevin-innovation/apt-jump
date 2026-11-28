import type { Course } from './game';
import { POWER_KINDS, POWER_NAMES, type PowerKind } from './items';
import { paceSpeed, type Pace } from './physics';
import { BAR_GAP, OBSTACLE_SIZE, passage, RAMP_RUN, ROAD_DEPTH, VENT_HEIGHT, type City, type Roof } from './world';

/** Map files measure everything in units of 8 pixels. */
export const UNIT = 8;
export const MAP_FORMAT = 'apt-jump-map';
export const MAP_VERSION = 1;
export const LIMITS = {
  bytes: 64 * 1024, title: 24, segments: 120, items: 600, length: 4000,
  w: [10, 250], h: [-12, 12], gap: [0, 40], itemY: [1, 24], base: [90, 200], gain: [0, 140],
} as const;
/** The narrowest gap that still leaves a column of rising air in it (it stops 4px short of both roofs). */
export const VENT_MIN_GAP = 2;
export const ITEM_TYPES = ['coin', 'gold', 'diamond', 'ac', 'tank', 'box', 'bar', 'puddle', 'line', 'drone', 'pigeon', ...POWER_KINDS] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_NAMES: Record<ItemType, string> = {
  coin: '동전', gold: '분홍 동전', diamond: '다이아', ac: '실외기', tank: '물탱크', box: '상자', bar: '배관', puddle: '물웅덩이',
  line: '빨랫줄', drone: '드론', pigeon: '비둘기',
  ...POWER_NAMES,
};
export const isPower = (t: ItemType): t is PowerKind => (POWER_KINDS as readonly string[]).includes(t);
/** A puddle's width in units. */
export const PUDDLE_W = 5;
export const LINE_W = 5;
/** These stand on the roof; everything else has a height above it. */
export const onFloor = (t: ItemType) => t === 'ac' || t === 'tank' || t === 'pigeon' || t === 'box' || t === 'bar' || t === 'puddle';

export interface MapItem { t: ItemType; x: number; y: number }
/**
 * `route`: a marked building with a passage under its glass roof; `vent`: rising air in the gap after it;
 * `cracked`: a roof that gives way under a runner who stays; `golden`: a golden rush, points ×3 over the segment
 * and its gap. All optional, so older maps read as they were.
 */
export interface Segment { kind: 'building' | 'scaffold'; w: number; h: number; gap: number; road: boolean; items: MapItem[]; route?: boolean; vent?: boolean; cracked?: boolean; golden?: boolean }
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
      // Removed pickup in older saved/shared maps: retain the course, discard this item.
      if (isObj(it) && it.t === 'slow') continue;
      if (!isObj(it) || !ITEM_TYPES.includes(it.t as ItemType)) { bad(i, '알 수 없는 물체가 있습니다.'); continue; }
      const t = it.t as ItemType;
      if (!whole(it.x, [0, s.w + s.gap]) || !whole(it.y, onFloor(t) ? [0, 0] : LIMITS.itemY)) { bad(i, `${ITEM_NAMES[t]}의 위치가 범위를 벗어났습니다.`); continue; }
      list.push({ t, x: it.x, y: it.y });
    }
    for (const flag of ['route', 'vent', 'cracked', 'golden'] as const) if (s[flag] !== undefined && typeof s[flag] !== 'boolean') bad(i, '구간 설정 값이 잘못되었습니다.');
    segments.push({ kind: s.kind, w: s.w, h: s.h, gap: s.gap, road: s.road, items: list,
      ...(s.route === true ? { route: true } : {}), ...(s.vent === true ? { vent: true } : {}), ...(s.cracked === true ? { cracked: true } : {}),
      ...(s.golden === true ? { golden: true } : {}) });
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

/**
 * Only what the game needs to build a course: the map's size, and segment settings that can actually be built.
 * Where things stand is the author's choice; whether a map can be finished isn't checked.
 */
export function checkMap(m: GameMap): MapProblem[] {
  const out: MapProblem[] = [];
  const bad = (segment: number | null, text: string) => { if (out.length < 20) out.push({ segment, text }); };
  const segs = m.segments;
  const last = segs[segs.length - 1];
  if (!last || segs.length < 2) { bad(null, '구간이 2개 이상 필요합니다.'); return out; }
  const starts = segmentStarts(m);
  if (starts[segs.length - 1]! + last.w > LIMITS.length) bad(null, '맵이 너무 깁니다.');
  if (last.road) bad(segs.length - 1, '마지막 구간에는 도로를 놓을 수 없습니다.');

  segs.forEach((s, i) => {
    const next = segs[i + 1];
    if (s.road && s.kind !== 'building') bad(i, '도로는 건물에서만 시작할 수 있습니다.');
    else if (s.road && next) {
      // A street runs to the next building and climbs up to it.
      const e = roadEnd(m, i);
      if (e < 0) bad(i, '도로 뒤에는 도로가 끝날 건물이 필요합니다.');
      else if (starts[e]! - starts[i]! - s.w <= 0) bad(i, '도로를 깔 자리가 없습니다. 간격이나 발판을 더하세요.');
      else if (ROAD_DEPTH + (segs[e]!.h - s.h) * UNIT <= 0) bad(i, '도로 끝 건물이 도로보다 낮습니다. 끝 건물을 높이세요.');
    }

    if ((s.route || s.cracked) && s.kind !== 'building') bad(i, `${s.route ? '실내 통로' : '균열 옥상'}는 건물에만 둘 수 있습니다.`);
    else if (s.route) {
      // The passage and its way back up have to fit inside the building.
      const speed = paceSpeed(m.pace, starts[i]! * UNIT), need = Math.ceil(passage(routeLead(speed), 0, speed, () => 0).route.rampEnd / UNIT);
      if (s.w < need) bad(i, `실내 통로 건물은 길이 ${need} 이상이어야 합니다.`);
    }
    if (s.vent && (!next || s.gap < VENT_MIN_GAP)) bad(i, `상승 기류는 다음 구간이 있고 간격이 ${VENT_MIN_GAP} 이상인 곳에만 둘 수 있습니다.`);
  });
  return out;
}

/** Clear roof before a passage's glass: a landing first, as in the endless city. */
const routeLead = (speed: number) => Math.round(speed * 0.54) + 70;

class FixedCity implements City {
  constructor(public roofs: Roof[], public readonly goalX: number) {}
  ensure(): void { /* a made map is complete from the start */ }
}

/** Builds a course. Call only with a map that passed checkMap, or to preview. */
export function buildCourse(m: GameMap): Course {
  const starts = segmentStarts(m);
  let id = 1;
  const roofs = m.segments.map((s, i): Roof => {
    const lead = i === 0 ? 200 : 0; // roof behind the start line
    const x = starts[i]! * UNIT, y = -s.h * UNIT;
    const next = m.segments[i + 1];
    const r: Roof = {
      id: id++, kind: s.kind, x: x - lead, w: s.w * UNIT + lead, y, style: (i * 3) % 5, seed: 1000 + i * 77, number: 101 + i,
      obstacles: [], lines: [], coins: [], powers: [], enemies: [], road: null,
      gap: next ? s.gap * UNIT : 0, nextDy: next ? (s.h - next.h) * UNIT : 0,
    };
    for (const it of s.items) {
      const ix = x + it.x * UNIT, iy = y - it.y * UNIT;
      if (it.t === 'ac' || it.t === 'tank' || it.t === 'box') { const z = OBSTACLE_SIZE[it.t]; r.obstacles.push({ id: id++, kind: it.t, x: ix, y: y - z.h, ...z }); }
      else if (it.t === 'bar') { const z = OBSTACLE_SIZE.bar; r.obstacles.push({ id: id++, kind: 'bar', x: ix, y: y - BAR_GAP - z.h, ...z }); }
      else if (it.t === 'puddle') (r.puddles ??= []).push({ id: id++, x: ix, w: PUDDLE_W * UNIT });
      else if (it.t === 'line') r.lines.push({ id: id++, x: ix, w: LINE_W * UNIT, y: iy, style: it.x % 4 });
      else if (it.t === 'drone') r.enemies.push({ id: id++, kind: 'drone', x: ix, y: iy, amp: 8, phase: (it.x % 8) / 8 });
      else if (it.t === 'pigeon') r.enemies.push({ id: id++, kind: 'pigeon', x: ix, y: y - 13, amp: 0, phase: 0 });
      else if (isPower(it.t)) r.powers.push({ id: id++, kind: it.t, x: ix, y: iy, taken: false });
      else r.coins.push({ x: ix, y: iy, kind: it.t, taken: false });
    }
    if (s.cracked) r.cracked = true;
    if (s.golden) r.golden = true;
    if (s.vent && next) r.vent = { x: x + s.w * UNIT + 4, w: s.gap * UNIT - 8, top: Math.min(y, -next.h * UNIT) - VENT_HEIGHT };
    if (s.route && s.kind === 'building') {
      const speed = paceSpeed(m.pace, x), p = passage(x + routeLead(speed), y, speed, () => id++);
      r.route = p.route;
      r.obstacles.push(...p.obstacles);
      r.coins.push(...p.coins);
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
    seg(90, 8, [...row('coin', 64, 7, 1), { t: 'double', x: 60, y: 2 }]),
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
