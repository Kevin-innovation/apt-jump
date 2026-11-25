import { describe, expect, it } from 'vitest';
import { Bot } from '../src/bot';
import { Game } from '../src/game';
import { baseSpeed, jumpReach } from '../src/physics';
import { landingZone, MAX_DROP, MAX_RISE, runupZone, World } from '../src/world';

const gather = (seed: number, to: number) => {
  const w = new World(seed);
  w.ensure(0, to);
  return w.roofs;
};

describe('generation', () => {
  it('is the same for the same seed and differs between seeds', () => {
    expect(gather(5, 8000)).toEqual(gather(5, 8000));
    expect(gather(5, 8000)).not.toEqual(gather(6, 8000));
  });

  it('keeps every gap crossable without boost, over 200 seeds', () => {
    let worst = 0, bad = 0, n = 0;
    for (let s = 1; s <= 200; s++) {
      const roofs = gather(s, 60000);
      for (let i = 0; i + 1 < roofs.length; i++) {
        const a = roofs[i]!, b = roofs[i + 1]!;
        const dy = b.y - a.y;
        const reach = jumpReach(baseSpeed(a.x + a.w), dy);
        if (b.x - (a.x + a.w) !== a.gap || dy < -MAX_RISE || dy > MAX_DROP || reach <= 0) bad++;
        worst = Math.max(worst, a.gap / reach);
        n++;
      }
    }
    expect(n).toBeGreaterThan(20000);
    expect(bad).toBe(0);
    expect(worst).toBeLessThanOrEqual(0.82);
  });

  it('leaves clear landing and run-up space around obstacles', () => {
    let count = 0;
    for (let s = 1; s <= 60; s++) for (const r of gather(s, 30000)) for (const o of r.obstacles) {
      count++;
      expect(o.x - r.x).toBeGreaterThanOrEqual(landingZone(r.x));
      expect(r.x + r.w - (o.x + o.w)).toBeGreaterThanOrEqual(runupZone(r.x + r.w) - 1);
    }
    expect(count).toBeGreaterThan(200);
  });

  it('gets harder: later gaps are wider on average', () => {
    let early = 0, late = 0, ne = 0, nl = 0;
    for (let s = 1; s <= 60; s++) for (const r of gather(s, 50000)) {
      if (r.x < 4000) { early += r.gap; ne++; } else if (r.x > 35000) { late += r.gap; nl++; }
    }
    expect(late / nl).toBeGreaterThan((early / ne) * 1.5);
  });

  it('offers coins and both kinds of risky route', () => {
    let tanks = 0, lines = 0, coins = 0;
    for (let s = 1; s <= 20; s++) for (const r of gather(s, 20000)) {
      tanks += r.obstacles.filter((o) => o.kind === 'tank').length;
      lines += r.lines.length;
      coins += r.coins.length;
    }
    expect(tanks).toBeGreaterThan(20);
    expect(lines).toBeGreaterThan(20);
    expect(coins).toBeGreaterThan(200);
  });
});

it('a planning player survives four minutes, up to near top speed, on 25 seeds', () => {
  const died: string[] = [];
  for (let s = 1; s <= 25; s++) {
    const g = new Game(s);
    const b = new Bot();
    while (!g.dead && g.time < 240) { g.step(b.next(g)); g.drain(); }
    if (g.dead) died.push(`seed ${s} at ${Math.round(g.distance)}m`);
  }
  expect(died).toEqual([]);
}, 60000);
