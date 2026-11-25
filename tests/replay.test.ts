import { describe, expect, it } from 'vitest';
import { Bot } from '../src/bot';
import { Game } from '../src/game';
import { cleanNickname, nicknameKey } from '../src/nickname';
import { MAX_REPLAY, Recorder, verifyReplay } from '../src/replay';
import { isWeekKey, weekEnd, weekKey } from '../src/week';

function play(seed: number, seconds: number) {
  const g = new Game(seed), b = new Bot(), r = new Recorder();
  b.want.add('stomp');
  b.wantDiamond = true;
  while (!g.dead) {
    const j = g.time < seconds ? b.next(g) : { pressed: false, held: false };
    r.add(j);
    g.step(j);
    g.drain();
  }
  return { g, text: r.text() };
}

describe('replay', () => {
  it('gives exactly the run that was played', () => {
    for (let s = 1; s <= 6; s++) {
      const { g, text } = play(s, 60);
      expect(verifyReplay(s, text)).toEqual({ ok: true, score: g.score, distance: Math.floor(g.distance), steps: Math.round(g.time * 120) });
      expect(text.length).toBeLessThan(6000);
    }
  });
  it('fits ten minutes well inside the limit', () => {
    const { text } = play(2, 600);
    expect(text.length).toBeLessThan(MAX_REPLAY / 3);
  }, 15_000); // Ten minutes of planning also evaluates moving traffic on copied players.
  const { text } = play(1, 10);
  it.each([
    ['empty', ''], ['junk', 'hello'], ['zero count', 'A0'], ['unknown code', 'E5'], ['split runs', 'A5A5'],
    ['held press', 'A9B9'], ['too long', 'A'.repeat(MAX_REPLAY + 1)], ['years of it', Array(40).fill('AzzzzCzzzz').join('')],
    ['cut short', text.slice(0, text.length - 2)], ['carried on after the fall', text + 'D1'], ['spaces', ` ${text}`],
  ])('refuses %s', (_n, t) => { expect(verifyReplay(1, t).ok).toBe(false); });
  it('refuses more presses than a person makes', () => {
    expect(verifyReplay(1, 'A1B1'.repeat(3000))).toEqual({ ok: false, reason: 'input' });
  });
  it('does not fit another seed', () => {
    // Fixed seeds, so this can't vary from run to run.
    const { text } = play(1, 30);
    expect(verifyReplay(1, text).ok).toBe(true);
    expect(verifyReplay(2, text)).not.toEqual(verifyReplay(1, text));
  });
});

describe('week', () => {
  it('turns over on Monday 00:00 in Korea', () => {
    const turn = Date.UTC(2026, 10, 22, 15); // Mon 23 Nov 00:00 KST
    expect(weekKey(turn - 1)).toBe('2026-11-16');
    expect(weekKey(turn)).toBe('2026-11-23');
    expect(weekEnd(turn - 1)).toBe(turn);
    expect(weekEnd(turn)).toBe(turn + 7 * 86_400_000);
  });
  it('crosses the year, and every moment lies inside its week', () => {
    expect(weekKey(Date.UTC(2027, 0, 1))).toBe('2026-12-28');
    for (let i = 0; i < 500; i++) {
      const t = Date.UTC(2026, 0, 1) + i * 5_000_011;
      expect(weekEnd(t)).toBeGreaterThan(t);
      expect(weekEnd(t) - t).toBeLessThanOrEqual(7 * 86_400_000);
      expect(isWeekKey(weekKey(t))).toBe(true);
    }
  });
});

it('nicknames', () => {
  expect(cleanNickname(' 옥상   왕 ')).toBe('옥상 왕');
  expect(cleanNickname('Runner_7')).toBe('Runner_7');
  for (const bad of ['', '한', 'a'.repeat(17), 'a@b.com', '<i>x</i>', 'tab\u0000x', '.점', '😀😀']) expect(cleanNickname(bad)).toBeNull();
  expect(nicknameKey('Ａbc')).toBe(nicknameKey('a.b c'));
});
