import { describe, expect, it } from 'vitest';
import { COIN_POINTS, COMBO_TIME, Game, multiplier, RISK_POINTS } from '../src/game';
import { baseSpeed, jumpReach } from '../src/physics';
import type { Roof } from '../src/world';

const idle = { pressed: false, held: false };
function bare(): Game {
  const g = new Game(3);
  for (const r of g.world.roofs) { r.coins = []; r.obstacles = []; r.lines = []; }
  g.step(idle);
  g.drain();
  return g;
}

describe('score', () => {
  it('steps the multiplier every five combos, capped at x5', () => {
    expect([0, 4, 5, 10, 19, 20, 99].map(multiplier)).toEqual([1, 1, 2, 3, 4, 5, 5]);
  });
  it('counts a coin once, multiplies by combo and refreshes the timer', () => {
    const g = bare();
    g.combo = 4; g.comboTimer = 1;
    g.world.roofs[0]!.coins.push({ x: g.player.x + 5, y: g.player.y - 8, value: 5, taken: false });
    for (let i = 0; i < 3; i++) g.step(idle);
    expect(g.coins).toBe(5);
    expect(g.bonus).toBe(COIN_POINTS * 5 * 2);
    expect(g.comboTimer).toBeGreaterThan(COMBO_TIME - 0.1);
  });
  it('builds the combo and multiplier from a run of coins, then times out', () => {
    const g = bare();
    for (let i = 0; i < 6; i++) g.world.roofs[0]!.coins.push({ x: g.player.x + 20 + i * 12, y: -8, value: 1, taken: false });
    for (let i = 0; i < 120; i++) g.step(idle);
    expect(g.combo).toBe(6);
    expect(g.mult).toBe(2);
    expect(g.bonus).toBe(4 * COIN_POINTS + 2 * COIN_POINTS * 2);
    for (let i = 0; i < COMBO_TIME * 120 && g.combo && !g.dead; i++) g.step(idle);
    expect(g.combo).toBe(0);
    expect(g.mult).toBe(1);
  });
  it('a crash resets a combo built from coins', () => {
    const g = bare();
    for (let i = 0; i < 5; i++) g.world.roofs[0]!.coins.push({ x: g.player.x + 10 + i * 8, y: -8, value: 1, taken: false });
    g.world.roofs[0]!.obstacles.push({ id: 9998, kind: 'ac', x: g.player.x + 90, y: -11, w: 16, h: 11 });
    let top = 0;
    for (let i = 0; i < 100; i++) { g.step(idle); top = Math.max(top, g.combo); }
    expect(top).toBe(5);
    expect(g.combo).toBe(0);
    expect(g.maxCombo).toBe(5);
  });
  it.each([[0.6, 1], [0.35, 0]])('a gap of %s reach pays %s far bonuses, never twice', (ratio, paid) => {
    const g = bare();
    const [a, b] = g.world.roofs as [Roof, Roof];
    a.gap = Math.round(jumpReach(baseSpeed(a.x + a.w), 0) * ratio);
    a.nextDy = 0;
    b.x = a.x + a.w + a.gap; b.y = a.y; b.w = 900;
    g.player.x = a.x + a.w - 30;
    let n = 0;
    for (let i = 0; i < 300; i++) {
      g.step({ pressed: i === 10 || i === 150, held: i % 140 < 60 });
      n += g.drain().filter((e) => e.type === 'risk' && e.kind === 'far').length;
    }
    expect(g.player.lastRoofY).toBe(b.y);
    expect(g.player.x).toBeGreaterThan(b.x);
    expect(n).toBe(paid);
  });
  it('drops the combo after the time limit', () => {
    const g = bare();
    g.combo = 4; g.comboTimer = 0.05;
    for (let i = 0; i < 10; i++) g.step(idle);
    expect(g.combo).toBe(0);
    expect(g.drain().some((e) => e.type === 'comboLost')).toBe(true);
  });
  it('drops the combo on a stumble', () => {
    const g = bare();
    g.combo = 4; g.comboTimer = 4;
    g.world.roofs[0]!.obstacles.push({ id: 9999, kind: 'ac', x: g.player.x + 14, y: -11, w: 16, h: 11 });
    for (let i = 0; i < 30; i++) g.step(idle);
    expect(g.combo).toBe(0);
  });
  it('pays a risky landing once per spot', () => {
    const g = bare();
    g.world.roofs[0]!.lines.push({ id: 8888, x: g.player.x, w: 420, y: -30, style: 0 });
    let landings = 0;
    for (let i = 0; i < 300; i++) {
      g.step({ pressed: i % 130 === 0, held: i % 130 < 60 });
      landings += g.drain().filter((e) => e.type === 'land' && e.surface.kind === 'line').length;
    }
    expect(landings).toBeGreaterThan(1);
    expect(g.risks).toBe(1);
    expect(g.bonus).toBeGreaterThanOrEqual(RISK_POINTS);
  });
  it('adds one point per metre', () => {
    const g = bare();
    const s0 = g.score;
    for (let i = 0; i < 240; i++) g.step(idle);
    expect(g.score - s0).toBeGreaterThan(10);
    expect(g.score).toBe(Math.floor(g.distance));
  });
});
