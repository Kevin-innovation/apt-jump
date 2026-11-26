import { Game } from './game';
import { buildCourse, type GameMap } from './maps';
import { STEP } from './physics';
import { readReplay } from './replay';

/** A run's time on a made map: the game time played, pauses excluded. */
export const timeOf = (steps: number) => Math.round(steps * STEP * 1000);
export const timeText = (ms: number) => `${(ms / 1000).toFixed(3)}초`;

/** Plays a recorded run of a made map again. Only a run that ends exactly at the goal counts. */
export function verifyMapReplay(map: GameMap, text: string): { ok: true; steps: number } | { ok: false } {
  const read = readReplay(text);
  if (!read.ok) return { ok: false };
  const g = new Game(buildCourse(map));
  for (const [code, count] of read.runs) {
    const j = { pressed: (code & 1) !== 0, held: (code & 2) !== 0 };
    for (let i = 0; i < count; i++) {
      // Input after the end isn't something the page records.
      if (g.over) return { ok: false };
      g.step(j);
      g.drain();
    }
  }
  return g.finished && !g.dead ? { ok: true, steps: read.steps } : { ok: false };
}
