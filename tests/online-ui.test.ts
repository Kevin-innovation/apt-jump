// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import html from '../index.html?raw';
import { MapStore } from '../src/mapstore';
import { OnlineScreens } from '../src/online/screens';
import { onlineUrl, type Online } from '../src/online/types';

const TURN = Date.UTC(2026, 10, 29, 15); // Monday 00:00 in Korea
const el = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TURN - 3000);
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
});
afterEach(() => { vi.useRealTimers(); });

const screens = () => new OnlineScreens(new MapStore(() => { throw new Error('none'); }), { play() {}, edit() {} });
function fakeOnline() {
  const weeks: string[] = [];
  const online = {
    account: () => ({ status: 'in', nickname: '나', error: null }), onAccount() {}, now: () => Date.now(),
    board: async (week: string) => { weeks.push(week); return { top: [], mine: null }; },
  } as unknown as Online;
  return { weeks, online };
}

it('turns to the new week at Monday 00:00 in Korea, asking once', async () => {
  const s = screens(), { weeks, online } = fakeOnline();
  el('ranking').hidden = false;
  s.attach(online);
  s.openRanking();
  await vi.advanceTimersByTimeAsync(2000);
  expect(new Set(weeks)).toEqual(new Set(['2026-11-23']));
  expect(el('rank-reset').textContent).toContain('0일 0시간 0분 1초');
  weeks.length = 0;
  await vi.advanceTimersByTimeAsync(5000);
  expect(weeks).toEqual(['2026-11-30']);
  expect(el('rank-reset').textContent).toContain('2026-11-30');
  expect(el('rank-reset').textContent).toContain('6일 23시간');
});

it('catches up when the page slept through the turn', async () => {
  const s = screens(), { weeks, online } = fakeOnline();
  s.attach(online);
  el('ranking').hidden = false;
  s.openRanking();
  await vi.advanceTimersByTimeAsync(0);
  weeks.length = 0;
  vi.setSystemTime(TURN + 8 * 86_400_000);
  s.openRanking();
  await vi.advanceTimersByTimeAsync(1500);
  expect(weeks.length).toBeGreaterThan(0);
  expect(weeks.every((w) => w === '2026-12-07')).toBe(true);
});

it('says so, and shows no ranking, when nothing is connected', async () => {
  const s = screens();
  el('ranking').hidden = false;
  el('maps').hidden = false;
  s.openRanking();
  await vi.advanceTimersByTimeAsync(3000);
  expect(el('rank-off').hidden).toBe(false);
  expect(el('rank-login').hidden).toBe(true);
  expect(el('rank-list').childElementCount).toBe(0);
  expect(el('rank-reset').textContent).toBe('');
  expect(el('shared-list').textContent).toContain('준비');
  expect(document.body.textContent).not.toContain('VITE_');
});

it('never connects a real build to a local address', () => {
  expect(onlineUrl('http://127.0.0.1:3210', false)).toBeNull();
  expect(onlineUrl('http://127.0.0.1:3210', true)).not.toBeNull();
  expect(onlineUrl('https://x.convex.cloud', false)).toBe('https://x.convex.cloud');
  for (const bad of [undefined, '', 'nope', 'javascript:alert(1)']) expect(onlineUrl(bad, true)).toBeNull();
});
