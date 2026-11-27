import type { VerifiedRunStats } from './achievements';
import { Game } from './game';
import { SEGMENT, World } from './world';
import { STEP, type JumpInput } from './physics';

/** Raise whenever a change makes an old replay play differently. */
export const SIM_VERSION = 11;
export const MAX_STEPS = Math.round((30 * 60) / STEP);
export const MAX_REPLAY = 120_000;
/**
 * A ranked city's stretch seeds come from the server as the run goes: each one some seconds before even the fastest
 * possible runner could need it. Released seeds after `elapsedMs` of a run.
 */
export const SEGMENT_SEEDS = 330;
export const RELEASE_LEAD = 15;
/** Faster than any runner moves on screen: top pace, full boost and the speed item together. */
export const RELEASE_SPEED = 1100;
export function releasedSeeds(elapsedMs: number): number {
  return Math.max(1, Math.min(SEGMENT_SEEDS, Math.floor((Math.max(0, elapsedMs) / 1000 + RELEASE_LEAD) * RELEASE_SPEED / SEGMENT) + 1));
}
/** How much longer than the run itself it may take to hand it in: pauses and waits, not time to plan ahead. */
export const PAUSE_ALLOWANCE_MS = 60_000;
export const PAUSE_SHARE = 0.05;
export function pauseAllowanceMs(gameMs: number): number { return PAUSE_ALLOWANCE_MS + gameMs * PAUSE_SHARE; }

/** More presses a second than a person makes, averaged over a run. */
const MAX_PRESS_RATE = 14;

// Runs of the same input: a letter for the input, then the count in base 36.
//   A nothing, B press only, C held, D press and held; E to H the same with a slide press
const CODES = 'ABCDEFGH';
const codeOf = (j: JumpInput) => (j.pressed ? 1 : 0) + (j.held ? 2 : 0) + (j.slide ? 4 : 0);
/** The input one letter's index stands for. */
export const inputOf = (code: number): JumpInput => ({ pressed: (code & 1) !== 0, held: (code & 2) !== 0, slide: (code & 4) !== 0 });

export class Recorder {
  private out: string[] = [];
  private last = -1;
  private count = 0;
  steps = 0;
  add(j: JumpInput): void {
    const c = codeOf(j);
    this.steps++;
    if (c === this.last) { this.count++; return; }
    this.flush();
    this.last = c;
    this.count = 1;
  }
  private flush(): void { if (this.count) this.out.push(CODES[this.last]! + this.count.toString(36)); }
  /** The whole run so far. */
  text(): string { return this.out.join('') + (this.count ? CODES[this.last]! + this.count.toString(36) : ''); }
}

export type Verdict =
  | { ok: true; score: number; distance: number; steps: number; stats: VerifiedRunStats; coins: number }
  | { ok: false; reason: 'format' | 'too-long' | 'unfinished' | 'input' };

type Runs = [code: number, count: number][];

/** The inputs a recording holds, refused if the page couldn't have written it. */
export function readReplay(text: string): { ok: true; runs: Runs; steps: number } | { ok: false; reason: 'format' | 'too-long' | 'input' } {
  if (text.length === 0 || text.length > MAX_REPLAY) return { ok: false, reason: text ? 'too-long' : 'format' };
  if (!/^(?:[A-H][1-9a-z][0-9a-z]{0,3})+$/.test(text)) return { ok: false, reason: 'format' };
  const runs: Runs = [];
  let steps = 0, presses = 0, last = -1;
  for (const m of text.matchAll(/([A-H])([0-9a-z]+)/g)) {
    const code = CODES.indexOf(m[1]!), count = parseInt(m[2]!, 36);
    if (code === last) return { ok: false, reason: 'format' };
    last = code;
    steps += count;
    if (steps > MAX_STEPS) return { ok: false, reason: 'too-long' };
    // A press of either button lasts a step: longer runs of one aren't something the page writes.
    if (code & 5) { presses += count * ((code & 1) + (code >> 2 & 1)); if (count > 2) return { ok: false, reason: 'input' }; }
    runs.push([code, count]);
  }
  if (presses > 20 + steps * STEP * MAX_PRESS_RATE) return { ok: false, reason: 'input' };
  return { ok: true, runs, steps };
}

/** Plays a recorded run again and says what it really scored: on one seed's city, or on the server's stretch seeds. */
export function verifyReplay(seed: number | readonly number[], text: string): Verdict {
  const read = readReplay(text);
  if (!read.ok) return read;
  const { runs, steps } = read;
  const g = new Game(typeof seed === 'number' ? seed : (k) => seed[k] ?? null);
  for (const [code, count] of runs) {
    const j = inputOf(code);
    for (let i = 0; i < count; i++) {
      if (g.dead) return { ok: false, reason: 'format' };
      g.step(j);
      g.drain();
    }
  }
  if (!g.dead) return { ok: false, reason: 'unfinished' };
  // A city that ran past the seeds it was given isn't the one that was issued.
  if (g.world instanceof World && g.world.fallback) return { ok: false, reason: 'format' };
  const score = g.score, distance = Math.floor(g.distance);
  const stats: VerifiedRunStats = { score, distance, slides: g.slides, stomps: g.stomps, maxCombo: g.maxCombo, perfects: g.perfects };
  return { ok: true, score, distance, steps, stats, coins: g.coins };
}
