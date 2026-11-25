import { expect, it } from 'vitest';
import { Game } from '../src/game';
import { buildCourse, PRACTICE, parseMap } from '../src/maps';
import { newPlayer, STEP, stepPlayer } from '../src/physics';
import { roadCars } from '../src/traffic';
import type { Road, Roof } from '../src/world';

const road: Road = { id: 5, x: 0, y: 120, rampStart: 800, rampEnd: 1000, rampY: 0 };
const roof: Roof = { id: 1, x: -200, w: 200, y: 0, kind: 'building', style: 0, seed: 1, number: 101, obstacles: [], lines: [], coins: [], powers: [], enemies: [], road, gap: 0, nextDy: 0 };
it('traffic moves deterministically on the flat street and stops with simulation time', () => {
  expect(roadCars(road, 3)).toEqual(roadCars(road, 3));
  expect(roadCars(road, 3)).not.toEqual(roadCars(road, 4));
  for (const car of roadCars(road, 123)) { expect(car.x).toBeGreaterThan(road.x); expect(car.x + car.w).toBeLessThan(road.rampStart); }
});
it('a collision is lethal immediately even with a helmet; a jump clears the car', () => {
  const car = roadCars(road, STEP)[0]!;
  const p = newPlayer(car.x + 8, road.y); p.shield = true;
  const seen: string[] = [];
  stepPlayer(p, { pressed: false, held: false }, [roof], e => seen.push(e.type));
  expect(seen).toContain('trafficHit'); expect(p.crashed).toBe(true);
  const high = newPlayer(car.x + 8, road.y - 45);
  stepPlayer(high, { pressed: false, held: false }, [roof], e => expect(e.type).not.toBe('trafficHit'));
});
it('the real game ends on a road collision', () => {
  const g = new Game(buildCourse(PRACTICE));
  g.world = { roofs: [roof], goalX: null, ensure() {} };
  const car = roadCars(road, STEP)[0]!;
  g.player = newPlayer(car.x + 8, road.y); g.step({ pressed: false, held: false });
  expect(g.dead).toBe(true); expect(g.deathCause).toBe('traffic'); expect(g.drain().some(e => e.type === 'trafficHit')).toBe(true);
});
it('an old map containing the removed slow pickup retains the course', () => {
  const old = structuredClone(PRACTICE) as unknown as { segments: { items: unknown[] }[] };
  old.segments[1]!.items.push({ t: 'slow', x: 30, y: 2 });
  const parsed = parseMap(JSON.stringify(old));
  expect(parsed.map).not.toBeNull(); expect(parsed.problems).toEqual([]);
  expect(JSON.stringify(parsed.map)).not.toContain('"slow"');
});
