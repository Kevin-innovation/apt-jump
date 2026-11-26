// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Bot } from '../src/bot';
import { BREAKIN_POINTS, Game, SLIDE_POINTS } from '../src/game';
import { Input } from '../src/input';
import {
  enemyBox, newPlayer, ROAD_GRACE, SLIDE_COOLDOWN, SLIDE_TIME, STEP, stepPlayer, type JumpInput, type PhysEvent, type Player,
} from '../src/physics';
import { Recorder, verifyReplay } from '../src/replay';
import { roadCars } from '../src/traffic';
import { BAR_GAP, OBSTACLE_SIZE, World, type Enemy, type Obstacle, type Road, type Roof } from '../src/world';

const idle: JumpInput = { pressed: false, held: false };
const down: JumpInput = { pressed: false, held: false, slide: true };
const roof = (x: number, w: number, y: number, extra: Partial<Roof> = {}): Roof => ({
  id: x + 1000, kind: 'building', x, w, y, style: 0, seed: 1, number: 101, obstacles: [], lines: [], coins: [], powers: [], enemies: [],
  road: null, gap: 0, nextDy: 0, ...extra,
});
function grounded(roofs: Roof[], x = 0): Player {
  const p = newPlayer(x, 0);
  for (let i = 0; i < 30; i++) stepPlayer(p, idle, roofs, () => {});
  expect(p.ground).not.toBeNull();
  return p;
}
/** Runs `seconds`, pressing what `at` says; returns the events' types. */
function run(p: Player, roofs: Roof[], seconds: number, at: (p: Player, i: number) => JumpInput = () => idle): PhysEvent[] {
  const ev: PhysEvent[] = [];
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepPlayer(p, at(p, i), roofs, (e) => ev.push(e));
  return ev;
}
const types = (ev: PhysEvent[]) => ev.map((e) => e.type);
const bar = (x: number): Obstacle => ({ id: 7, kind: 'bar', x, w: 24, h: 150, y: -BAR_GAP - 150 });
const box = (x: number): Obstacle => ({ id: 8, kind: 'box', x, y: -12, ...OBSTACLE_SIZE.box });

describe('slide input', () => {
  it('is one pulse for a fresh ArrowDown, and for the on-screen button', () => {
    const input = new Input(document.body);
    dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
    dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', repeat: true }));
    expect([input.takeSlide(), input.takeSlide(), input.takePress()]).toEqual([true, false, false]);
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(input.takeSlide()).toBe(false);
    input.pressSlide();
    expect(input.takeSlide()).toBe(true);
  });
});

describe('slide', () => {
  it('lasts, ends, and rests before the next; a jump in the same step wins', () => {
    const roofs = [roof(-100, 5000, 0)];
    const p = grounded(roofs);
    expect(types(run(p, roofs, STEP, () => down))).toEqual(['slide']);
    run(p, roofs, SLIDE_TIME + STEP);
    expect(p.slide).toBe(0);
    expect(types(run(p, roofs, STEP, () => down))).toEqual([]);
    expect(types(run(p, roofs, SLIDE_COOLDOWN))).toEqual([]); // the early press has run out
    expect(types(run(p, roofs, STEP, () => down))).toEqual(['slide']);
    const q = grounded(roofs);
    expect(types(run(q, roofs, STEP, () => ({ pressed: true, held: true, slide: true })))).toEqual(['jump']);
    expect(q.slide).toBe(0);
  });
  it('goes under what hangs overhead, paid once, while standing runs into it', () => {
    const roofs = [roof(-100, 5000, 0, { obstacles: [bar(100)] })];
    const p = grounded(roofs);
    let sent = false;
    const ev = run(p, roofs, 2, (q) => (!sent && q.x > 70 ? ((sent = true), down) : idle));
    expect(types(ev)).toEqual(['slide', 'dodge']);
    expect(types(run(grounded(roofs), roofs, 2))).toEqual(['stumble']);
  });
  it('stays low until clear of what is overhead', () => {
    const roofs = [roof(-100, 5000, 0, { obstacles: [{ ...bar(60), w: 200 }] })];
    const p = grounded(roofs);
    const ev = run(p, roofs, 3, (_q, i) => (i === 0 ? down : idle));
    expect(types(ev)).toEqual(['slide', 'dodge']);
  });
  it('breaks a crate once, scoring it, and counts only real successes', () => {
    const g = new Game(3);
    g.world = { roofs: [roof(-100, 5000, 0, { obstacles: [box(g.player.x + 60)] })], goalX: null, ensure() {} };
    g.player = grounded(g.world.roofs, g.player.x);
    g.step(down);
    for (let i = 0; i < 200; i++) g.step(idle);
    const paid = g.drain().filter((e) => e.type === 'slideBonus');
    expect([g.slides, paid.length, paid[0]!.points]).toEqual([1, 1, SLIDE_POINTS]);
  });
});

describe('stomp', () => {
  const drone: Enemy = { id: 9, kind: 'drone', x: 100, y: -40, amp: 0, phase: 0 };
  const fall = (x: number, y: number, vy: number) => {
    const p = newPlayer(x, y);
    p.vy = vy;
    const ev: PhysEvent[] = [];
    stepPlayer(p, idle, [roof(-100, 900, 0, { enemies: [drone] })], (e) => ev.push(e));
    return types(ev);
  };
  it('counts feet that crossed the top within the step, with a slightly wider top', () => {
    const top = enemyBox(drone, 100).y;
    expect(fall(100, top - 1, 520)).toEqual(['stomp']);
    // Just past the body's edge, inside the widened top.
    expect(fall(100 - 13, top - 1, 520)).toEqual(['stomp']);
  });
  it('does not turn a hit from the side or below into a stomp', () => {
    const top = enemyBox(drone, 100).y;
    expect(fall(94, top + 8, 100)).toEqual(['stumble']);
    expect(fall(100, top + 9, -200)).toEqual(['stumble']);
  });
});

describe('dropping to a street', () => {
  const road: Road = { id: 5, x: 0, y: 120, rampStart: 800, rampEnd: 1000, rampY: 0 };
  const street = [roof(-200, 200, 0, { road })];
  it('spares the runner on arrival, not afterwards', () => {
    const car = roadCars(road, STEP)[0]!;
    const p = newPlayer(car.x + 8, road.y);
    expect(types(run(p, street, STEP))).not.toContain('trafficHit');
    expect(p.grace).toBeGreaterThan(ROAD_GRACE - 0.05);
    const q = newPlayer(car.x + 8, road.y);
    q.road = road.id;
    expect(types(run(q, street, STEP))).toContain('trafficHit');
  });
});

describe('marked buildings', () => {
  const find = (seed: number) => {
    const w = new World(seed);
    w.ensure(0, 30000);
    return w.roofs.find((r) => r.route)!;
  };
  it('are the same for a seed, with a clear roof and the way back before the next gap', () => {
    const r = find(1), w = r.route!;
    expect(find(1)).toEqual(r);
    expect(w.rampEnd).toBeLessThan(r.x + r.w);
    expect(r.obstacles.every((o) => o.y >= r.y)).toBe(true);
    expect(r.road).toBeNull();
  });
  it('are entered only by a slide on the glass, and lead back to the roof', () => {
    const r = find(1), w = r.route!;
    const start = () => { const p = newPlayer(w.x - 60, r.y); run(p, [r], STEP); return p; };
    const walk = start();
    expect(types(run(walk, [r], 6))).not.toContain('breakin');
    const p = start(), bot = new Bot(), g = new Game(1);
    g.world = { roofs: [r], goalX: null, ensure() {} };
    g.player = p;
    const seen: string[] = [];
    let entered = false, points = 0;
    for (let i = 0; i < 1500 && !seen.includes('breakout'); i++) {
      const press = !entered && p.ground && p.x + 5 >= w.x + 2;
      g.step(press ? down : p.inside ? bot.next(g) : idle);
      for (const e of g.drain()) { seen.push(e.type); if (e.type === 'breakin') entered = true; if (e.type === 'risk') points = e.points; }
    }
    expect(points).toBeGreaterThanOrEqual(BREAKIN_POINTS);
    expect(seen).toContain('breakout');
    expect(seen.filter((t) => t === 'stumble')).toEqual([]);
    expect(g.slides).toBe(3);
    expect([g.player.inside, g.player.y]).toEqual([0, r.y]);
  });
});

it('replays a run with slides exactly, with the numbers achievements use', () => {
  let slid = 0;
  for (const seed of [2, 5, 8, 11]) {
    const g = new Game(seed), bot = new Bot(), rec = new Recorder();
    while (!g.dead) { const j = g.time < 45 ? bot.next(g) : idle; rec.add(j); g.step(j); g.drain(); }
    slid += g.slides;
    const stats = { score: g.score, distance: Math.floor(g.distance), slides: g.slides, stomps: g.stomps, maxCombo: g.maxCombo, perfects: g.perfects };
    expect(verifyReplay(seed, rec.text())).toEqual({ ok: true, score: g.score, distance: stats.distance, steps: Math.round(g.time * 120), stats });
  }
  expect(slid).toBeGreaterThan(0);
});
