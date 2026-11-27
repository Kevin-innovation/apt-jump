import { describe, expect, it } from 'vitest';
import { Bot } from '../src/bot';
import { Game } from '../src/game';
import { blankMap, buildCourse, checkMap, cleanTitle, LIMITS, parseMap, PRACTICE, readMap, serializeMap, type GameMap } from '../src/maps';
import { MapStore, MAX_MAPS } from '../src/mapstore';

const change = (f: (m: GameMap) => void): GameMap => { const m = structuredClone(PRACTICE); f(m); return m; };
const problems = (f: (m: GameMap) => void) => checkMap(change(f)).map((p) => p.text).join('\n');
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('map files', () => {
  it('survive a save and load unchanged', () => {
    for (const m of [PRACTICE, blankMap()]) {
      const r = parseMap(serializeMap(m));
      expect(r.problems).toEqual([]);
      expect(r.map).toEqual(m);
    }
  });
  it.each([
    ['not json', '{nope'], ['array', '[]'], ['null', 'null'], ['other format', '{"format":"x"}'],
    ['future version', JSON.stringify({ ...PRACTICE, version: 2 })],
    ['no title', JSON.stringify({ ...PRACTICE, title: '  ' })],
    ['one segment', JSON.stringify({ ...PRACTICE, segments: PRACTICE.segments.slice(0, 1) })],
    ['speed too high', JSON.stringify({ ...PRACTICE, pace: { base: 9999, gain: 0 } })],
    ['speed not a number', JSON.stringify({ ...PRACTICE, pace: { base: '118', gain: 0 } })],
  ])('reject %s', (_n, text) => {
    const r = parseMap(text);
    expect(r.map).toBeNull();
    expect(r.problems.length).toBeGreaterThan(0);
  });
  it('reject a file that is too large before reading it', () => {
    const r = parseMap(' '.repeat(LIMITS.bytes + 1) + serializeMap(PRACTICE));
    expect(r.map).toBeNull();
    expect(r.problems[0]!.text).toContain('너무 큽니다');
  });
  it.each<[string, (m: GameMap) => void]>([
    ['too many segments', (m) => { m.segments = Array.from({ length: 121 }, () => m.segments[0]!); }],
    ['too many items', (m) => { m.segments[1]!.items = Array.from({ length: 601 }, () => ({ t: 'coin', x: 1, y: 1 })); }],
    ['fractional width', (m) => { m.segments[1]!.w = 20.5; }],
    ['NaN gap', (m) => { m.segments[1]!.gap = NaN; }],
    ['height out of range', (m) => { m.segments[1]!.h = 99; }],
    ['negative item', (m) => { m.segments[1]!.items = [{ t: 'coin', x: -1, y: 2 }]; }],
    ['item past the gap', (m) => { m.segments[1]!.items = [{ t: 'coin', x: 999, y: 2 }]; }],
    ['unknown item', (m) => { m.segments[1]!.items = [{ t: 'bomb' as 'coin', x: 5, y: 2 }]; }],
    ['unknown segment', (m) => { m.segments[1]!.kind = 'hole' as 'building'; }],
  ])('reject %s', (_n, f) => { expect(readMap(change(f)).map).toBeNull(); });

  it('keep only known fields', () => {
    const r = readMap({ ...PRACTICE, evil: 1, segments: PRACTICE.segments.map((s) => ({ ...s, onload: 'x' })) });
    expect(r.map).toEqual(PRACTICE);
  });
  it('clean titles but leave markup as plain text', () => {
    expect(cleanTitle(`a${String.fromCharCode(0x202e, 0)}b${String.fromCharCode(0x200b)}c`)).toBe('abc');
    expect(cleanTitle('<img src=x>')).toBe('<img src=x>');
    expect([...cleanTitle('가'.repeat(99))]).toHaveLength(LIMITS.title);
  });
});

describe('map rules', () => {
  it('accept the built-in maps', () => {
    expect(checkMap(PRACTICE)).toEqual([]);
    expect(checkMap(blankMap())).toEqual([]);
  });
  it.each<[string, (m: GameMap) => void, string]>([
    ['a gap too wide', (m) => { m.segments[0]!.gap = 30; }, '간격이 너무 넓습니다'],
    ['a roof too high', (m) => { m.segments[1]!.h = 12; }, '너무 높습니다'],
    ['a touching roof far too high', (m) => { m.segments[0]!.gap = 0; m.segments[0]!.h = -12; m.segments[1]!.h = 12; }, '너무 높습니다'],
    ['a short start', (m) => { m.segments[0]!.w = 12; m.segments[0]!.items = []; }, '시작은'],
    ['a short finish', (m) => { m.segments.at(-1)!.w = 12; m.segments.at(-1)!.items = []; }, '도착은'],
    ['a hazard at the start', (m) => { m.segments[0]!.items = [{ t: 'ac', x: 12, y: 0 }]; }, '출발점'],
    ['a hazard at an edge', (m) => { m.segments[1]!.items = [{ t: 'tank', x: 1, y: 0 }]; }, '양끝'],
    ['hazards too close', (m) => { m.segments[1]!.items = [{ t: 'ac', x: 20, y: 0 }, { t: 'pigeon', x: 24, y: 0 }]; }, '띄우세요'],
    ['overlapping items', (m) => { m.segments[1]!.items = [{ t: 'coin', x: 20, y: 2 }, { t: 'diamond', x: 20, y: 2 }]; }, '겹칩니다'],
    ['a drone out of reach', (m) => { m.segments[1]!.items = [{ t: 'drone', x: 30, y: 12 }]; }, '드론 높이'],
    ['laundry on a roof', (m) => { m.segments[1]!.items = [{ t: 'line', x: 10, y: 4 }]; }, '빨랫줄'],
    ['a street with no room for its ramp', (m) => { m.segments.splice(6, 3); }, '도로가 짧습니다'],
    ['a street at the finish', (m) => { m.segments.at(-1)!.road = true; }, '마지막 구간'],
    ['a street from a scaffold', (m) => { m.segments[6]!.road = true; }, '건물에서만'],
    ['a map too long', (m) => { m.segments = [...m.segments, ...Array.from({ length: 30 }, () => ({ ...m.segments.at(-1)!, w: 150, items: [] }))]; }, '너무 깁니다'],
  ])('refuse %s', (_n, f, text) => { expect(problems(f)).toContain(text); });
});

describe('made maps play', () => {
  const run = (b: Bot, m: GameMap = PRACTICE) => {
    const g = new Game(buildCourse(m));
    const seen: string[] = [];
    while (!g.over && g.time < 90) { g.step(b.next(g)); for (const e of g.drain()) seen.push(e.type); }
    return { g, seen };
  };
  it('reach the goal and end there', () => {
    const { g, seen } = run(new Bot());
    expect(g.finished).toBe(true);
    expect(g.dead).toBe(false);
    expect(g.progress).toBeCloseTo(1, 1);
    expect(seen.filter((e) => e === 'goal')).toHaveLength(1);
    const x = g.player.x;
    g.step({ pressed: true, held: true });
    expect(g.player.x).toBe(x);
  });
  it('lead from a fall to the street and back', () => {
    const b = new Bot();
    b.wantRoad = true;
    const { g, seen } = run(b);
    expect(seen).toContain('road');
    expect(seen.indexOf('roadExit')).toBeGreaterThan(seen.indexOf('road'));
    expect(g.finished).toBe(true);
  });
  it('end in a fall elsewhere', () => {
    const g = new Game(buildCourse(PRACTICE));
    while (!g.over && g.time < 30) g.step({ pressed: false, held: false });
    expect(g.dead).toBe(true);
  });
  it('start at the first roof, whatever its height', () => {
    const m = change((x) => { x.segments[0]!.h = 3; });
    const g = new Game(buildCourse(m));
    for (let i = 0; i < 60; i++) g.step({ pressed: false, held: false });
    expect(g.player.y).toBe(-24);
    expect(g.player.ground?.kind).toBe('roof');
  });
  it('a step up with no gap is a wall unless jumped', () => {
    const m = change((x) => { x.segments[0]!.gap = 0; x.segments[1]!.h = 4; });
    expect(checkMap(m)).toEqual([]);
    const g = new Game(buildCourse(m));
    const seen: string[] = [];
    while (!g.over && g.time < 20) { g.step({ pressed: false, held: false }); for (const e of g.drain()) seen.push(e.type); }
    expect(seen).toContain('wall');
    expect(g.dead).toBe(true);
    expect(run(new Bot(), m).g.finished).toBe(true);
  });
});

describe('the shelf', () => {
  it('keeps maps and their own scores across sessions', () => {
    const m = memory();
    const a = new MapStore(() => m);
    const s = a.put(PRACTICE, null)!;
    expect(a.record(s.id, 500, true)).toBe(true);
    expect(a.record(s.id, 400, false)).toBe(false);
    const b = new MapStore(() => m);
    expect(b.maps).toHaveLength(1);
    expect(b.get(s.id)).toMatchObject({ best: 500, cleared: true, map: PRACTICE });
  });
  it('forgets the score when the course changes, not when only renamed', () => {
    const a = new MapStore(memory);
    const s = a.put(PRACTICE, null)!;
    a.record(s.id, 500, true);
    a.put(change((x) => { x.title = '다른 이름'; }), s.id);
    expect(a.get(s.id)!.best).toBe(500);
    a.put(change((x) => { x.segments[0]!.gap = 7; }), s.id);
    expect(a.get(s.id)!.best).toBe(0);
  });
  it('drops damaged entries and keeps the rest', () => {
    const m = memory();
    const a = new MapStore(() => m);
    a.put(PRACTICE, null);
    const raw = JSON.parse(m.getItem('apt-jump.maps.v1')!);
    m.setItem('apt-jump.maps.v1', JSON.stringify([{ id: 'x', map: { format: 'no' } }, null, ...raw]));
    expect(new MapStore(() => m).maps).toHaveLength(1);
  });
  it('has a limit, and works when storage is blocked', () => {
    const a = new MapStore(() => { throw new Error('denied'); });
    expect(a.available).toBe(false);
    for (let i = 0; i < MAX_MAPS; i++) expect(a.put(PRACTICE, null)).not.toBeNull();
    expect(a.put(PRACTICE, null)).toBeNull();
    a.remove(a.maps[0]!.id);
    expect(a.put(PRACTICE, null)).not.toBeNull();
  });
});

describe('newer pieces in made maps', () => {
  it('build a passage, rising air, a cracked roof, puddles and things to slide past', () => {
    const m = change((m) => {
      m.segments.splice(1, 0, { kind: 'building', w: 160, h: 0, gap: 10, road: false, items: [], route: true, vent: true });
      m.segments.splice(2, 0, { kind: 'building', w: 120, h: 0, gap: 10, road: false, cracked: true,
        items: [{ t: 'box', x: 20, y: 0 }, { t: 'bar', x: 70, y: 0 }, { t: 'puddle', x: 100, y: 0 }] });
    });
    expect(checkMap(m)).toEqual([]);
    const roofs = buildCourse(m).city.roofs;
    expect(roofs[1]!.route).toBeTruthy();
    expect(roofs[1]!.vent).toBeTruthy();
    expect(roofs[2]!.cracked).toBe(true);
    expect(roofs[2]!.puddles).toHaveLength(1);
    expect(roofs[2]!.obstacles.map((o) => o.kind)).toEqual(['box', 'bar']);
    expect(parseMap(JSON.stringify(m)).map).toEqual(m);
    expect(problems((m) => { m.segments[1]!.route = true; m.segments[1]!.w = 30; })).toMatch('실내 통로 건물은 길이');
  });
});
