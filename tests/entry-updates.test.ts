// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { FirstVisit } from '../src/entry';
import { ReleaseWatcher } from '../src/updates';

afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });
it('invites first visitors, skips signed-in players and remembers guest choice', () => {
  const store = new Map<string, string>();
  const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
  const first = new FirstVisit(storage);
  expect(first.shouldShow('loading')).toBe(false);
  expect(first.shouldShow('out')).toBe(true);
  first.dismiss();
  expect(new FirstVisit(storage).shouldShow('out')).toBe(false);
  const signedIn = new FirstVisit(() => localStorage);
  expect(signedIn.shouldShow('in')).toBe(false);
});
it('guest dismissal works in memory when storage is denied', () => {
  const first = new FirstVisit(() => { throw Error('denied'); });
  expect(first.shouldShow('out')).toBe(true); first.dismiss(); expect(first.shouldShow('out')).toBe(false);
});
it('detects a new release relative to the loaded bundle and avoids reload loops', async () => {
  const changed = vi.fn();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'release-new' })));
  const opts = { current: 'release-old', fetch: fetcher as typeof fetch, storage: () => sessionStorage, onUpdate: changed };
  const watcher = new ReleaseWatcher(opts);
  await watcher.check(); await watcher.check();
  expect(changed).toHaveBeenCalledExactlyOnceWith('release-new');
  expect(fetcher.mock.calls).toHaveLength(1);
  await new ReleaseWatcher(opts).check();
  expect(changed).toHaveBeenCalledTimes(1);
});
it('ignores current, malformed and offline responses without marking a reload', async () => {
  const changed = vi.fn();
  for (const response of [new Response('{'), new Response('{}'), new Response('{"id":"old"}'), new Response('', { status: 503 })]) {
    await new ReleaseWatcher({ current: 'old', fetch: vi.fn(async () => response) as typeof fetch, storage: () => sessionStorage, onUpdate: changed }).check();
  }
  await new ReleaseWatcher({ current: 'old', fetch: vi.fn(async () => { throw Error('offline'); }) as typeof fetch, storage: () => sessionStorage, onUpdate: changed }).check();
  expect(changed).not.toHaveBeenCalled(); expect(sessionStorage.getItem('apt-jump.reloaded')).toBeNull();
});
