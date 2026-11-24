import { expect, it } from 'vitest';
import { DEFAULTS, parseSave, SaveFile } from '../src/storage';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

it('keeps the best score across sessions', () => {
  const m = memory();
  const a = new SaveFile(() => m);
  expect(a.record(120, 80.7)).toBe(true);
  expect(a.record(90, 100)).toBe(false);
  expect(new SaveFile(() => m).data).toMatchObject({ best: 120, bestDistance: 100, runs: 2 });
});
it('works in memory when storage access throws', () => {
  const s = new SaveFile(() => { throw new Error('denied'); });
  expect(s.available).toBe(false);
  expect(s.record(10, 5)).toBe(true);
  expect(s.data.best).toBe(10);
});
it('works in memory when writing throws', () => {
  const s = new SaveFile(() => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
  expect(s.available).toBe(false);
  expect(() => s.record(10, 5)).not.toThrow();
});
it.each(['{oops', 'null', '[]', '{"best":-4,"music":99,"muted":"yes"}'])('ignores a damaged save: %s', (raw) => {
  expect(parseSave(raw)).toEqual(DEFAULTS);
});
