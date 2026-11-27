import type { Road } from './world';

export interface Car { x: number; y: number; w: number; h: number; color: number }

/** A number from 0 to 1 that only depends on its inputs: the same in the game, the planner and the server. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b + 1) | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Same simulation clock in the game, planner and server replay. Cars travel toward the runner, all at the street's
 * speed so they never run into each other; each street has its own speed, start and uneven spacing, so no two look
 * alike. A car is never closer than CAR_ROOM to the one before it, room enough to land between.
 */
const CAR_ROOM = 0.82;
export function roadCars(road: Road, time: number): Car[] {
  if (road.traffic === false) return [];
  const left = road.x + 65, span = road.rampStart - left - 34;
  if (span < 100) return [];
  const step = road.spacing ?? 245;
  const count = Math.max(1, Math.floor(span / step));
  const speed = 70 + hash(road.id, 0) * 36;
  const phase = hash(road.id, 1) * span;
  // Uneven gaps: each car's share of the loop, at least CAR_ROOM of an even one, scaled to fill the loop.
  const shares = Array.from({ length: count }, (_, i) => CAR_ROOM + hash(road.id, i + 2) * (2 - 2 * CAR_ROOM));
  const total = shares.reduce((a, b) => a + b, 0);
  let at = 0;
  return shares.map((share, i) => {
    const offset = at + phase - time * speed;
    at += (share / total) * span;
    return { x: left + ((offset % span) + span) % span, y: road.y - 15, w: 32, h: 15, color: Math.floor(hash(road.id, i + 50) * 4) };
  });
}
