import { Game } from './game';
import { STEP, type JumpInput } from './physics';

/** Raise whenever a change makes an old replay play differently. */
export const SIM_VERSION = 1;
export const MAX_STEPS = Math.round((30 * 60) / STEP);
export const MAX_REPLAY = 120_000;
/** More presses a second than a person makes, averaged over a run. */
const MAX_PRESS_RATE = 14;

// Runs of the same input: a letter for the input, then the count in base 36.
//   a nothing, b press only, c held, d press and held
const CODES = 'ABCD';
const codeOf = (j: JumpInput) => (j.pressed ? 1 : 0) + (j.held ? 2 : 0);

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
  | { ok: true; score: number; distance: number; steps: number }
  | { ok: false; reason: 'format' | 'too-long' | 'unfinished' | 'input' };

/** Plays a recorded run again and says what it really scored. */
export function verifyReplay(seed: number, text: string): Verdict {
  if (text.length === 0 || text.length > MAX_REPLAY) return { ok: false, reason: text ? 'too-long' : 'format' };
  if (!/^(?:[ABCD][1-9a-z][0-9a-z]{0,3})+$/.test(text)) return { ok: false, reason: 'format' };
  const runs: [code: number, count: number][] = [];
  let steps = 0, presses = 0, last = -1;
  for (const m of text.matchAll(/([ABCD])([0-9a-z]+)/g)) {
    const code = CODES.indexOf(m[1]!), count = parseInt(m[2]!, 36);
    if (code === last) return { ok: false, reason: 'format' };
    last = code;
    steps += count;
    if (steps > MAX_STEPS) return { ok: false, reason: 'too-long' };
    if (code & 1) { presses += count; if (count > 2) return { ok: false, reason: 'input' }; }
    runs.push([code, count]);
  }
  if (presses > 20 + steps * STEP * MAX_PRESS_RATE) return { ok: false, reason: 'input' };
  const g = new Game(seed);
  for (const [code, count] of runs) {
    const j: JumpInput = { pressed: (code & 1) !== 0, held: (code & 2) !== 0 };
    for (let i = 0; i < count; i++) {
      if (g.dead) return { ok: false, reason: 'format' };
      g.step(j);
      g.drain();
    }
  }
  if (!g.dead) return { ok: false, reason: 'unfinished' };
  return { ok: true, score: g.score, distance: Math.floor(g.distance), steps };
}
