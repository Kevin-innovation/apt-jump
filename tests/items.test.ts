import { describe, expect, it } from 'vitest';
import { Bot } from '../src/bot';
import { COIN_POINTS, COMBO_TIME, FEVER_FILL, FEVER_TIME, Game } from '../src/game';
import { BOOST_RATE, DASH_POINTS, MAX_AIR_BONUS, POWER_KINDS, POWER_POINTS, POWER_TIME, type PowerKind } from '../src/items';
import { buildCourse, PRACTICE, checkMap, parseMap, serializeMap, type GameMap } from '../src/maps';
import { medalFor, MEDALS, MISSIONS, missionText, nextMedal } from '../src/missions';
import { baseSpeed, DEFAULT_PACE, jumpReach, newPlayer, STEP, stepPlayer, type PhysEvent, type Player } from '../src/physics';
import { Recorder, verifyReplay } from '../src/replay';
import { World, type Roof } from '../src/world';

const idle = { pressed: false, held: false };
const flat = (extra: Partial<Roof> = {}): Roof => ({
  id: 1, kind: 'building', x: -100, w: 90000, y: 0, style: 0, seed: 1, number: 101, obstacles: [], lines: [], coins: [], powers: [], enemies: [],
  road: null, gap: 0, nextDy: 0, ...extra,
});
function bare(): Game {
  const g = new Game(3);
  for (const r of g.world.roofs) { r.coins = []; r.powers = []; r.obstacles = []; r.lines = []; r.enemies = []; }
  g.step(idle);
  g.drain();
  return g;
}
function give(g: Game, kind: PowerKind): void {
  g.world.roofs[0]!.powers.push({ id: 7000 + g.powers, kind, x: g.player.x + 5, y: g.player.y - 8, taken: false });
  g.step(idle);
}

describe('difficulty', () => {
  it('is much faster much sooner than the first version of the game', () => {
    const before = (m: number) => 118 + 122 * ((m * 16) / (m * 16 + 6000));
    for (const m of [100, 250, 500, 1000]) expect(baseSpeed(m * 16)).toBeGreaterThan(before(m) * 1.2);
    // A brisk start, still climbing, toward the same top pace as before the faster start.
    expect(baseSpeed(0)).toBeGreaterThanOrEqual(200);
    expect(baseSpeed(250 * 16)).toBeGreaterThan(baseSpeed(0) * 1.3);
    expect(DEFAULT_PACE.base + DEFAULT_PACE.gain).toBe(140 + 180);
  });
  it('puts something to dodge early', () => {
    let early = 0;
    for (let s = 1; s <= 40; s++) {
      const w = new World(s);
      w.ensure(0, 4000);
      early += Number(w.roofs.some((r) => [...r.obstacles, ...r.enemies].some((o) => o.x < 2000)));
    }
    expect(early).toBeGreaterThan(30);
  });
  it('keeps increasing in late 250m stages instead of plateauing', () => {
    const speeds = [250, 500, 1000, 1500, 2000].map(m => baseSpeed(60 + m * 16));
    expect(speeds[2]!).toBeGreaterThan(380);
    expect(speeds[4]!).toBeGreaterThan(480);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]! - speeds[i - 1]!).toBeGreaterThan(40);
  });
});

describe('items in the city', () => {
  it('are about a third as frequent, never on the first roof, and cycle six kinds', () => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = new World(seed); w.ensure(0, 16000);
      const all = w.roofs.flatMap(r => r.powers).filter(p => p.x < 16000);
      total += all.length;
      expect(w.roofs[0]!.powers).toHaveLength(0);
      expect(all.length).toBeGreaterThanOrEqual(4);
      expect(all.length).toBeLessThanOrEqual(9);
      expect(all.every(p => p.kind !== ('slow' as string))).toBe(true);
      for (let i = 0; i + 6 <= all.length; i += 6) expect(new Set(all.slice(i, i + 6).map(p => p.kind)).size).toBe(6);
    }
    expect(total / 40).toBeGreaterThan(4);
    expect(total / 40).toBeLessThan(20.175 / 2.5);
  });
  it('stand on their own roof, within reach, clear of obstacles and before the edge', () => {
    for (let s = 1; s <= 40; s++) {
      const w = new World(s);
      w.ensure(0, 16000);
      for (const r of w.roofs) for (const p of r.powers) {
        expect(p.x).toBeGreaterThan(r.x);
        expect(p.x).toBeLessThan(r.x + r.w - 20);
        expect(r.y - p.y).toBeLessThanOrEqual(38);
        for (const o of r.obstacles) expect(p.x < o.x - 4 || p.x > o.x + o.w + 4).toBe(true);
      }
    }
  });
});

describe('effects', () => {
  it('are taken once, score, and add to the combo', () => {
    const g = bare();
    give(g, 'magnet');
    for (let i = 0; i < 5; i++) g.step(idle);
    expect(g.powers).toBe(1);
    expect(g.combo).toBe(1);
    expect(g.bonus).toBe(POWER_POINTS);
  });
  it('boost lasts five real seconds', () => {
    const p = { ...newPlayer(0, 0), boostTime: POWER_TIME.boost };
    let n = 0;
    while (p.boostTime > 0) { stepPlayer(p, idle, [flat()], () => {}); n++; }
    expect(n * STEP).toBeCloseTo(POWER_TIME.boost, 1);
  });
  it('speed the runner up', () => {
    const run = (set: Partial<Player>) => {
      const p: Player = { ...newPlayer(0, 0), ...set };
      for (let i = 0; i < 120; i++) stepPlayer(p, idle, [flat()], () => {});
      return p.x;
    };
    const plain = run({});
    expect(run({ boostTime: 5 }) / plain).toBeCloseTo(BOOST_RATE, 1);
  });

  it.each<[string, Partial<Player>]>([['plain', {}], ['fast', { boostTime: 99 }], ['fast ending mid-jump', { boostTime: 0.3 }]])(
    'leave every gap of the city crossable: %s', (_n, set) => {
      let tried = 0;
      const missed: string[] = [];
      for (let s = 1; s <= 12; s++) {
        const w = new World(s);
        w.ensure(0, 20000);
        w.roofs.forEach((a, i) => {
          const b = w.roofs[i + 1];
          if (!b || a.gap <= 0) return;
          tried++;
          const roofs = [{ ...a, obstacles: [], lines: [], enemies: [], road: null }, { ...b, obstacles: [], lines: [], enemies: [], road: null }];
          const edge = a.x + a.w;
          let ok = false;
          for (const hold of [0.5, 0.2, 0.1]) {
            for (const lead of [6, 14, 24]) {
              const p = newPlayer(edge - lead - 12, a.y);
              stepPlayer(p, idle, roofs, () => {});
              p.vx = baseSpeed(p.x);
              Object.assign(p, set);
              let at = -1, landed = false, bad = false;
              for (let k = 0; k < 400 && !landed && !bad; k++) {
                if (at < 0 && p.x >= edge - lead) at = k;
                stepPlayer(p, { pressed: at === k, held: at >= 0 && (k - at) * STEP < hold }, roofs, (e) => {
                  if (e.type === 'land' && e.surface.id === b.id) landed = true;
                  if (e.type === 'wall' || e.type === 'fell') bad = true;
                });
              }
              ok ||= landed;
            }
          }
          if (!ok) missed.push(`seed ${s} at ${Math.round(edge / 16)}m, gap ${a.gap} of ${Math.round(jumpReach(baseSpeed(edge), a.nextDy))}`);
        });
      }
      expect(tried).toBeGreaterThan(300);
      expect(missed).toEqual([]);
    }, 30_000);
  it('cover the same ground in a jump at any speed of time', () => {
    const reach = (set: Partial<Player>) => {
      const p: Player = { ...newPlayer(0, 0), vx: baseSpeed(0) };
      for (let i = 0; i < 30; i++) stepPlayer(p, idle, [flat()], () => {});
      Object.assign(p, set);
      const x = p.x;
      stepPlayer(p, { pressed: true, held: true }, [flat()], () => {});
      while (!p.ground) stepPlayer(p, { pressed: false, held: true }, [flat()], () => {});
      return p.x - x;
    };
    const plain = reach({});
    expect(Math.abs(reach({ boostTime: 99 }) - plain)).toBeLessThan(plain * 0.02);
  });

  it('magnet draws in coins but not diamonds', () => {
    const go = (magnet: boolean) => {
      const g = bare();
      if (magnet) give(g, 'magnet');
      const x = g.player.x;
      for (const [dx, kind] of [[40, 'coin'], [70, 'gold'], [60, 'diamond']] as const) g.world.roofs[0]!.coins.push({ x: x + dx, y: -70, kind, taken: false });
      for (let i = 0; i < 60; i++) g.step(idle);
      return [g.coins, g.diamonds];
    };
    expect(go(false)).toEqual([0, 0]);
    expect(go(true)).toEqual([6, 0]);
  });
  it('shield takes one collision and no more', () => {
    const g = bare();
    give(g, 'shield');
    g.combo = 4; g.comboTimer = 4;
    g.world.roofs[0]!.obstacles.push({ id: 9001, kind: 'tank', x: g.player.x + 20, y: -31, w: 36, h: 31 }, { id: 9002, kind: 'ac', x: g.player.x + 130, y: -11, w: 16, h: 11 });
    const seen: string[] = [];
    for (let i = 0; i < 150; i++) { g.step(idle); for (const e of g.drain()) if (e.type === 'shielded' || e.type === 'stumble') seen.push(`${e.type} ${e.id}`); }
    expect(seen).toEqual(['shielded 9001', 'stumble 9002']);
    expect(g.effect('shield')).toBe(0);
  });
  it('score doubles bonuses, not distance or missions', () => {
    const g = bare();
    give(g, 'double');
    expect(g.bonus).toBe(POWER_POINTS * 2);
    const before = g.bonus;
    g.world.roofs[0]!.coins.push({ x: g.player.x + 5, y: -8, kind: 'coin', taken: false });
    g.step(idle);
    expect(g.bonus - before).toBe(COIN_POINTS * 2);
    const d = g.distance, s = g.score;
    for (let i = 0; i < 60; i++) g.step(idle);
    expect(g.score - s).toBeLessThanOrEqual(Math.ceil(g.distance - d));
  });
  it('charge gives an air jump at once, then extra ones up to a limit', () => {
    const g = bare();
    g.player.airCooldown = 2;
    give(g, 'recharge'); give(g, 'recharge'); give(g, 'recharge');
    expect(g.player.airCooldown).toBe(0);
    expect(g.effect('recharge')).toBe(MAX_AIR_BONUS);
    let jumps = 0;
    for (let i = 0; i < 130; i++) { g.step({ pressed: i % 25 === 0, held: true }); jumps += g.drain().filter((e) => e.type === 'airjump').length; }
    expect(jumps).toBe(1 + MAX_AIR_BONUS);
  });
  it('combo keeper stops the combo clock', () => {
    const left = (kind: PowerKind | null) => {
      const g = bare();
      if (kind) give(g, kind);
      g.combo = 5; g.comboTimer = COMBO_TIME;
      for (let i = 0; i < 120; i++) g.step(idle);
      return g.comboTimer;
    };
    expect(left('keep')).toBe(COMBO_TIME);
    expect(left(null)).toBeLessThan(COMBO_TIME - 0.9);
  });
  it('fast time pays for each new roof', () => {
    const dashes = (fast: boolean) => {
      const g = new Game(5), b = new Bot();
      let n = 0;
      while (!g.dead && g.time < 12) {
        if (fast) g.player.boostTime = 5; else g.player.boostTime = 0;
        g.step(b.next(g));
        for (const e of g.drain()) if (e.type === 'dash') { n++; expect(e.points).toBeGreaterThanOrEqual(DASH_POINTS); }
      }
      return n;
    };
    expect(dashes(false)).toBe(0);
    expect(dashes(true)).toBeGreaterThan(5);
  });
});

describe('missions and medals', () => {
  it('follow one another and pay once each, in endless runs', () => {
    const g = bare();
    expect(g.mission).toBe(MISSIONS[0]);
    g.coins = MISSIONS[0]!.goal;
    const before = g.bonus;
    for (let i = 0; i < 10; i++) g.step(idle);
    expect(g.bonus - before).toBe(MISSIONS[0]!.reward);
    expect(g.mission).toBe(MISSIONS[1]);
    expect(g.drain().filter((e) => e.type === 'mission')).toHaveLength(1);
  });
  it('are not part of made maps', () => { expect(new Game(buildCourse(PRACTICE)).mission).toBeNull(); });
  it('go on for ever after the list, each counted from where the run stands', () => {
    const g = bare();
    g.missionsDone = MISSIONS.length;
    g.step(idle);
    const m = g.mission!;
    expect(m.from).toBe(g.tally[m.what]);
    expect(m.goal).toBeGreaterThan(g.tally[m.what]);
    expect(missionText(m)).toBe('동전 150개');
  });
  it('medals rise with the score', () => {
    expect(medalFor(0)).toBeNull();
    expect(nextMedal(0)).toEqual({ name: '동메달', left: 1500 });
    for (const m of MEDALS) expect(medalFor(m.score)).toBe(m.name);
    expect(nextMedal(1e9)).toBeNull();
  });
});

it('a combo save keeps a long combo through a stumble, and a full gauge starts a fever that doubles points', () => {
  const g = bare(), inner = g as unknown as { onPhys(e: PhysEvent): void; award(base: number): number };
  g.combo = 30; g.comboTimer = 2; g.comboSaves = 1;
  inner.onPhys({ type: 'stumble', id: 1, by: 'ac' });
  expect([g.combo, g.comboSaves]).toEqual([30, 0]);
  inner.onPhys({ type: 'stumble', id: 2, by: 'ac' });
  expect(g.combo).toBe(0);
  g.combo = 25;
  inner.award(FEVER_FILL);
  expect(g.feverTime).toBe(FEVER_TIME);
  expect(g.drain().map((e) => e.type)).toEqual(expect.arrayContaining(['comboSaved', 'comboLost', 'fever']));
  expect(inner.award(10)).toBe(10 * g.mult * 2);
});

it('a replay reproduces every item, effect and mission exactly', () => {
  const kinds = new Set<string>();
  let missions = 0, shields = 0, dashes = 0;
  for (let s = 1; s <= 24; s++) {
    const g = new Game(s), b = new Bot(), rec = new Recorder();
    b.wantPerfect = s % 2 === 0;
    b.want.add('stomp');
    while (!g.dead) {
      // Plays well, then carelessly, so that shields are used too.
      const j = g.time < 50 ? b.next(g) : { pressed: Math.floor(g.time * 120) % 70 === 0, held: true };
      rec.add(j);
      g.step(j);
      for (const e of g.drain()) {
        if (e.type === 'power') kinds.add(e.kind);
        if (e.type === 'mission') missions++;
        if (e.type === 'shielded') shields++;
        if (e.type === 'dash') dashes++;
      }
    }
    expect(verifyReplay(s, rec.text())).toMatchObject({ ok: true, score: g.score, distance: Math.floor(g.distance) });
  }
  expect(kinds.size).toBe(POWER_KINDS.length);
  expect(missions).toBeGreaterThan(20);
  expect(dashes).toBeGreaterThan(10);
  expect(shields).toBeGreaterThan(0);
}, 60_000);

it('made maps can hold every item, and older maps still load', () => {
  const m: GameMap = structuredClone(PRACTICE);
  m.segments[2]!.items.push(...POWER_KINDS.map((t, i) => ({ t, x: 10 + i * 4, y: 2 })));
  expect(checkMap(m)).toEqual([]);
  const back = parseMap(serializeMap(m)).map!;
  expect(back).toEqual(m);
  expect(new Game(buildCourse(back)).world.roofs[2]!.powers.map((p) => p.kind)).toEqual([...POWER_KINDS]);
});
