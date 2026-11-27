import type { Road } from './world';

export interface Car { x: number; y: number; w: number; h: number; color: number }

/** Same simulation clock in the game, planner and server replay. Cars travel toward the runner. */
export function roadCars(road: Road, time: number): Car[] {
  if (road.traffic === false) return [];
  const left = road.x + 65, span = road.rampStart - left - 34;
  if (span < 100) return [];
  const count = Math.max(1, Math.floor(span / (road.spacing ?? 245)));
  const speed = 75 + (road.id % 4) * 9;
  return Array.from({ length: count }, (_, i) => {
    const offset = (i + 0.6) * span / count + (road.id % 7) * 13 - time * speed;
    return { x: left + ((offset % span) + span) % span, y: road.y - 15, w: 32, h: 15, color: (road.id + i) % 4 };
  });
}
