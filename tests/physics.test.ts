import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { baseSpeed, jumpReach, newPlayer, PERFECT_WINDOW, STEP, stepPlayer, type PhysEvent, type Player } from '../src/physics';
import type { Roof } from '../src/world';

const idle = { pressed: false, held: false };
const roof = (x: number, w: number, y: number, extra: Partial<Roof> = {}): Roof => ({
  id: x + 1000, x, w, y, style: 0, seed: 1, number: 101, kind: 'building', obstacles: [], lines: [], coins: [], enemies: [], road: null, gap: 0, nextDy: 0, ...extra,
});
function grounded(roofs: Roof[]): Player {
  const p = newPlayer(0, 0);
  for (let i = 0; i < 60; i++) stepPlayer(p, idle, roofs, () => {});
  expect(p.ground).not.toBeNull();
  return p;
}
function apex(hold: number): number {
  const roofs = [roof(-100, 5000, 0)];
  const p = grounded(roofs);
  let top = 0;
  for (let i = 0; i < 200; i++) {
    stepPlayer(p, { pressed: i === 0, held: i * STEP < hold }, roofs, () => {});
    top = Math.max(top, -p.y);
  }
  return top;
}

describe('jump', () => {
  it('rises higher the longer it is held, up to a limit', () => {
    const h = [0.01, 0.08, 0.16, 0.25].map(apex);
    for (let i = 1; i < h.length; i++) expect(h[i]!).toBeGreaterThan(h[i - 1]! + 4);
    expect(h[0]!).toBeGreaterThan(12);
    expect(h[3]!).toBeGreaterThan(60);
    expect(Math.abs(apex(2) - apex(0.27))).toBeLessThan(1);
  });

  it('cannot jump again in mid air', () => {
    const roofs = [roof(-100, 5000, 0)];
    const p = grounded(roofs);
    const ev: PhysEvent[] = [];
    for (let i = 0; i < 60; i++) stepPlayer(p, { pressed: i === 0 || i === 30, held: true }, roofs, (e) => ev.push(e));
    expect(ev.filter((e) => e.type === 'jump')).toHaveLength(1);
  });

  it.each([[0.05, true], [0.15, false]])('press %ss past the edge jumps: %s', (delay, ok) => {
    const roofs = [roof(-100, 300, 0)];
    const p = grounded(roofs);
    while (p.ground) stepPlayer(p, idle, roofs, () => {});
    let jumped = false;
    const n = Math.round(delay / STEP);
    for (let i = 0; i <= n; i++) stepPlayer(p, { pressed: i === n, held: true }, roofs, (e) => { jumped ||= e.type === 'jump'; });
    expect(jumped).toBe(ok);
  });
});

describe('landing boost', () => {
  function secondJump(wait: number) {
    const roofs = [roof(-100, 50000, 0)];
    const p = grounded(roofs);
    stepPlayer(p, { pressed: true, held: false }, roofs, () => {});
    while (!p.ground) stepPlayer(p, idle, roofs, () => {});
    for (let i = 0; i < Math.round(wait / STEP); i++) stepPlayer(p, idle, roofs, () => {});
    let perfect = false;
    stepPlayer(p, { pressed: true, held: true }, roofs, (e) => { if (e.type === 'jump') perfect = e.perfect; });
    return { perfect, p };
  }
  it('speeds up right after touchdown only', () => {
    const a = secondJump(0.08);
    expect(a.perfect).toBe(true);
    expect(a.p.vx).toBeGreaterThan(baseSpeed(a.p.x) + 5);
    const b = secondJump(PERFECT_WINDOW + 0.1);
    expect(b.perfect).toBe(false);
    expect(b.p.vx).toBeCloseTo(baseSpeed(b.p.x), 0);
  });
  it('jumps from a press made just before touchdown, without the boost', () => {
    const roofs = [roof(-100, 50000, 0)];
    const p = grounded(roofs);
    stepPlayer(p, { pressed: true, held: false }, roofs, () => {});
    const jumps: boolean[] = [];
    let pressed = false;
    for (let i = 0; i < 120 && !jumps.length; i++) {
      const press: boolean = !pressed && p.vy > 0 && -p.y < p.vy * 0.06;
      pressed ||= press;
      stepPlayer(p, { pressed: press, held: true }, roofs, (e) => { if (e.type === 'jump') jumps.push(e.perfect); });
    }
    expect(jumps).toEqual([false]);
  });
});

describe('hazards', () => {
  it('trips once on an obstacle, loses speed and recovers', () => {
    const roofs = [roof(-100, 5000, 0, { obstacles: [{ id: 7, kind: 'ac', x: 120, y: -11, w: 16, h: 11 }] })];
    const p = grounded(roofs);
    const ev: string[] = [];
    let slow = Infinity;
    for (let i = 0; i < 240; i++) {
      stepPlayer(p, idle, roofs, (e) => ev.push(e.type));
      slow = Math.min(slow, p.vx);
    }
    expect(ev.filter((e) => e === 'stumble')).toHaveLength(1);
    expect(slow).toBeLessThan(baseSpeed(0) * 0.7);
    expect(p.vx).toBeCloseTo(baseSpeed(p.x), 0);
  });
  it('passes up through a laundry line and lands on top', () => {
    const roofs = [roof(-100, 5000, 0, { lines: [{ id: 9, x: 60, w: 400, y: -30, style: 0 }] })];
    const p = grounded(roofs);
    let on = '';
    for (let i = 0; i < 120 && !on; i++)
      stepPlayer(p, { pressed: i === 0, held: true }, roofs, (e) => { if (e.type === 'land') on = e.surface.kind; });
    expect(on).toBe('line');
    expect(p.y).toBe(-30);
  });
  it('hits a wall when too low, falls, and reports the fall', () => {
    const roofs = [roof(-100, 250, 0), roof(190, 400, -10)];
    const p = grounded(roofs);
    const ev: string[] = [];
    for (let i = 0; i < 400 && !ev.includes('fell'); i++) stepPlayer(p, idle, roofs, (e) => ev.push(e.type));
    expect(ev).toContain('wall');
    expect(ev).toContain('fell');
    expect(p.x).toBeLessThan(190);
  });
  it('lifts a near miss onto the ledge', () => {
    const roofs = [roof(-100, 250, 0), roof(165, 400, 0)];
    const p = grounded(roofs);
    const ev: string[] = [];
    for (let i = 0; i < 240; i++) stepPlayer(p, idle, roofs, (e) => ev.push(e.type));
    expect(ev).not.toContain('wall');
    expect(ev).toContain('land');
    expect(p.y).toBe(0);
  });
});

it('the reach formula matches a simulated jump', () => {
  const roofs = [roof(-100, 5000, 0)];
  const p = grounded(roofs);
  const x0 = p.x;
  stepPlayer(p, { pressed: true, held: true }, roofs, () => {});
  while (!p.ground) stepPlayer(p, { pressed: false, held: true }, roofs, () => {});
  expect(Math.abs(p.x - x0 - jumpReach(baseSpeed(x0), 0))).toBeLessThan(5);
});

it('an idle runner falls at the first gap and the run stays over', () => {
  const g = new Game(1);
  for (let i = 0; i < 120 * 15 && !g.dead; i++) g.step(idle);
  expect(g.dead).toBe(true);
  const x = g.player.x;
  g.step({ pressed: true, held: true });
  expect(g.player.x).toBe(x);
});
