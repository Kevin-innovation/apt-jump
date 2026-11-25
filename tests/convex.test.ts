// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import { Bot } from '../src/bot';
import { Game } from '../src/game';
import { PRACTICE, serializeMap } from '../src/maps';
import { Recorder, SIM_VERSION, verifyReplay } from '../src/replay';
import { STEP } from '../src/physics';

// Real sign-in is in auth.test.ts. Here the caller's identity names the user row directly, without password
// hashing for every player; everything after that is the real code.
vi.mock('@convex-dev/auth/server', async (original) => ({
  ...(await original<object>()),
  getAuthUserId: async (ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) => (await ctx.auth.getUserIdentity())?.subject ?? null,
}));

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const NOW = Date.UTC(2026, 10, 25, 3); // a Wednesday

async function setup() {
  const t = convexTest(schema, modules);
  const player = async (nickname: string) => {
    const id = await t.run((ctx) => ctx.db.insert('users', { nickname, nickKey: nickname }));
    return { id, as: t.withIdentity({ subject: id }) };
  };
  return { t, player, a: await player('에이'), b: await player('비이') };
}
/** A real run: someone who plays a while, then lets go. */
function play(seed: number, seconds: number) {
  const g = new Game(seed), bot = new Bot(), rec = new Recorder();
  while (!g.dead) {
    const j = g.time < seconds ? bot.next(g) : { pressed: false, held: false };
    rec.add(j);
    g.step(j);
    g.drain();
  }
  return { text: rec.text(), score: g.score, ms: rec.steps * STEP * 1000 };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const start = async (p: { as: Awaited<ReturnType<typeof setup>>['a']['as'] }) => p.as.mutation(api.ranking.start, { version: SIM_VERSION });

describe('accounts', () => {
  it('guests can look but not act', async () => {
    const { t } = await setup();
    expect(await t.query(api.users.me)).toBeNull();
    expect(await t.query(api.ranking.board, { week: '2026-11-23' })).toEqual({ top: [], mine: null });
    await expect(t.mutation(api.ranking.start, { version: SIM_VERSION })).rejects.toThrow('로그인');
    await expect(t.mutation(api.users.setNickname, { nickname: '손님입니다' })).rejects.toThrow('로그인');
    await expect(t.mutation(api.maps.publish, { json: serializeMap(PRACTICE) })).rejects.toThrow('로그인');
  });
});

describe('ranked runs', () => {
  it('score what the replay really did', async () => {
    const { a } = await setup();
    const { runId, seed } = await start(a);
    const run = play(seed, 20);
    vi.setSystemTime(NOW + run.ms + 1000);
    expect(await a.as.action(api.ranking.finish, { runId, replay: run.text })).toEqual({ score: run.score, best: true });
    const board = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    expect(board.top).toEqual([{ rank: 1, nickname: '에이', score: run.score, distance: expect.any(Number), mine: true }]);
    expect(board.mine).toMatchObject({ rank: 1, score: run.score });
  });
  it('count once, only for their player', async () => {
    const { a, b, t } = await setup();
    const { runId, seed } = await start(a);
    const run = play(seed, 5);
    vi.setSystemTime(NOW + run.ms + 1000);
    await expect(t.action(api.ranking.finish, { runId, replay: run.text })).rejects.toThrow('로그인');
    await expect(b.as.action(api.ranking.finish, { runId, replay: run.text })).rejects.toThrow('찾을 수 없');
    await a.as.action(api.ranking.finish, { runId, replay: run.text });
    await expect(a.as.action(api.ranking.finish, { runId, replay: run.text })).rejects.toThrow('이미 제출');
  });
  it('a forged run burns its ticket and leaves no score', async () => {
    const { a } = await setup();
    const { runId, seed } = await start(a);
    const run = play(seed, 5);
    vi.setSystemTime(NOW + run.ms + 1000);
    // Cut off while still running: unfinished whatever the city.
    await expect(a.as.action(api.ranking.finish, { runId, replay: 'A9' })).rejects.toThrow('확인되지 않는');
    await expect(a.as.action(api.ranking.finish, { runId, replay: play(seed, 5).text })).rejects.toThrow('이미 제출');
    expect((await a.as.query(api.ranking.board, { week: '2026-11-23' })).top).toEqual([]);
  });
  it('inputs from another city earn only what they do in this one', async () => {
    const { a } = await setup();
    const { runId, seed } = await start(a);
    const other = play(seed + 1, 20);
    const verdict = verifyReplay(seed, other.text);
    vi.setSystemTime(NOW + other.ms + 1000);
    const sent = a.as.action(api.ranking.finish, { runId, replay: other.text });
    if (verdict.ok) expect((await sent).score).toBe(verdict.score);
    else await expect(sent).rejects.toThrow('확인되지 않는');
  });
  it('refuse a run handed in sooner than it takes to play', async () => {
    const { a } = await setup();
    const { runId, seed } = await start(a);
    const run = play(seed, 40);
    vi.setSystemTime(NOW + run.ms / 2);
    await expect(a.as.action(api.ranking.finish, { runId, replay: run.text })).rejects.toThrow('확인되지 않는');
  });
  it('refuse old runs, replaced runs and old versions', async () => {
    const { a } = await setup();
    const one = await start(a);
    const two = await start(a);
    const r1 = play(one.seed, 3), r2 = play(two.seed, 3);
    vi.setSystemTime(NOW + 60_000);
    await expect(a.as.action(api.ranking.finish, { runId: one.runId, replay: r1.text })).rejects.toThrow('무효');
    vi.setSystemTime(NOW + 3 * 3_600_000);
    await expect(a.as.action(api.ranking.finish, { runId: two.runId, replay: r2.text })).rejects.toThrow('오래된');
    await expect(a.as.mutation(api.ranking.start, { version: SIM_VERSION + 1 })).rejects.toThrow('새로고침');
  });
  it('limit how often runs start', async () => {
    const { a, b } = await setup();
    for (let i = 0; i < 60; i++) await start(a);
    await expect(start(a)).rejects.toThrow('너무 자주');
    await start(b);
    vi.setSystemTime(NOW + 11 * 60_000);
    await start(a);
  });
  it('a worse run never replaces a better one; a new week starts empty and keeps the old', async () => {
    const { a } = await setup();
    let now = NOW;
    const go = async (seconds: number) => {
      const { runId, seed } = await start(a);
      const run = play(seed, seconds);
      now += run.ms + 1000;
      vi.setSystemTime(now);
      return { ...(await a.as.action(api.ranking.finish, { runId, replay: run.text })), ms: run.ms };
    };
    const good = await go(40);
    const poor = await go(1);
    expect(poor.best).toBe(false);
    now = Date.UTC(2026, 10, 29, 15); // Monday 00:00 in Korea
    vi.setSystemTime(now);
    expect((await a.as.query(api.ranking.board, { week: '2026-11-30' })).top).toEqual([]);
    const next = await go(2);
    expect(next.best).toBe(true);
    expect((await a.as.query(api.ranking.board, { week: '2026-11-30' })).mine!.score).toBe(next.score);
    expect((await a.as.query(api.ranking.board, { week: '2026-11-23' })).mine!.score).toBe(good.score);
  });
  it('scores made under other rules are on no current board, and never block a new one', async () => {
    const { t, a, b } = await setup();
    await t.run(async (ctx) => {
      for (const version of [undefined, SIM_VERSION - 1, SIM_VERSION + 1]) for (const p of [a, b])
        await ctx.db.insert('scores', { week: '2026-11-23', version, userId: p.id, score: 1e9, distance: 1, achievedAt: NOW });
    });
    expect(await a.as.query(api.ranking.board, { week: '2026-11-23' })).toEqual({ top: [], mine: null });
    const { runId, seed } = await start(a);
    const run = play(seed, 5);
    vi.setSystemTime(NOW + run.ms + 1000);
    expect(await a.as.action(api.ranking.finish, { runId, replay: run.text })).toEqual({ score: run.score, best: true });
    const board = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    expect(board.top).toHaveLength(1);
    expect(board.mine).toMatchObject({ rank: 1, score: run.score });
    expect(await t.run((ctx) => ctx.db.query('scores').collect())).toHaveLength(7);
  });
  it('a run begun under other rules can’t be handed in', async () => {
    const { t, a } = await setup();
    const { runId, seed } = await start(a);
    await t.run((ctx) => ctx.db.patch(runId, { version: SIM_VERSION - 1 }));
    const run = play(seed, 3);
    vi.setSystemTime(NOW + run.ms + 1000);
    await expect(a.as.action(api.ranking.finish, { runId, replay: run.text })).rejects.toThrow('오래된');
    expect((await a.as.query(api.ranking.board, { week: '2026-11-23' })).top).toEqual([]);
  });
  it('the board shows fifty, best first, and where the caller stands below them', async () => {
    const { t, a } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        const userId = await ctx.db.insert('users', { nickname: `p${i}`, nickKey: `p${i}` });
        await ctx.db.insert('scores', { week: '2026-11-23', version: SIM_VERSION, userId, score: 1000 + i, distance: 1, achievedAt: NOW });
      }
      await ctx.db.insert('scores', { week: '2026-11-23', version: SIM_VERSION, userId: a.id, score: 5, distance: 1, achievedAt: NOW });
    });
    const { top, mine } = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    expect(top).toHaveLength(50);
    expect(top[0]).toMatchObject({ rank: 1, score: 1059 });
    expect(top.every((r, i) => i === 0 || r.score < top[i - 1]!.score)).toBe(true);
    expect(mine).toMatchObject({ rank: 61, score: 5 });
  });
});

describe('shared maps', () => {
  const page = { numItems: 10, cursor: null };
  it('are published by players and read by anyone', async () => {
    const { t, a } = await setup();
    const id = await a.as.mutation(api.maps.publish, { json: serializeMap(PRACTICE) });
    const list = await t.query(api.maps.list, { paginationOpts: page, order: 'new' });
    expect(list.page).toEqual([{ id, title: '연습 옥상', segments: PRACTICE.segments.length, updatedAt: expect.closeTo(NOW, -2), mine: false, author: '에이' }]);
    expect(JSON.parse((await t.query(api.maps.get, { id }))!)).toEqual(PRACTICE);
    expect((await a.as.query(api.maps.list, { paginationOpts: page, order: 'new' })).page[0]!.mine).toBe(true);
  });
  it('can be changed or removed only by their owner', async () => {
    const { t, a, b } = await setup();
    const id = await a.as.mutation(api.maps.publish, { json: serializeMap(PRACTICE) });
    const json = serializeMap({ ...PRACTICE, title: '바꾼 이름' });
    vi.setSystemTime(NOW + 10_000);
    await expect(b.as.mutation(api.maps.update, { id, json })).rejects.toThrow('내가 올린');
    await expect(b.as.mutation(api.maps.remove, { id })).rejects.toThrow('내가 올린');
    await expect(t.mutation(api.maps.remove, { id })).rejects.toThrow('로그인');
    await a.as.mutation(api.maps.update, { id, json });
    expect(JSON.parse((await t.query(api.maps.get, { id }))!).title).toBe('바꾼 이름');
    await a.as.mutation(api.maps.remove, { id });
    expect(await t.query(api.maps.get, { id })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query('mapBodies').collect())).toEqual([]);
  });
  it('must be valid, playable and small', async () => {
    const { a } = await setup();
    const broken = structuredClone(PRACTICE);
    broken.segments[0]!.gap = 39;
    for (const json of ['{', '[]', serializeMap(broken), ' '.repeat(70_000), serializeMap({ ...PRACTICE, title: '' })])
      await expect(a.as.mutation(api.maps.publish, { json })).rejects.toThrow();
    const id = await a.as.mutation(api.maps.publish, { json: JSON.stringify({ ...PRACTICE, extra: '<script>' }) });
    expect(await a.as.query(api.maps.get, { id })).not.toContain('script');
  });
  it('come in small pages, in either order, up to a limit per player', async () => {
    const { t, a } = await setup();
    let now = NOW;
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime((now += 10_000));
      await a.as.mutation(api.maps.publish, { json: serializeMap({ ...PRACTICE, title: `맵 ${i}` }) });
    }
    vi.setSystemTime((now += 10_000));
    await expect(a.as.mutation(api.maps.publish, { json: serializeMap(PRACTICE) })).rejects.toThrow('20개까지');
    const huge = await t.query(api.maps.list, { paginationOpts: { numItems: 9999, cursor: null }, order: 'new' });
    expect(huge.page.length).toBeLessThanOrEqual(20);
    const first = await t.query(api.maps.list, { paginationOpts: { numItems: 5, cursor: null }, order: 'new' });
    expect(first.page.map((m) => m.title)).toEqual(['맵 19', '맵 18', '맵 17', '맵 16', '맵 15']);
    const second = await t.query(api.maps.list, { paginationOpts: { numItems: 5, cursor: first.continueCursor }, order: 'new' });
    expect(second.page[0]!.title).toBe('맵 14');
    expect((await t.query(api.maps.list, { paginationOpts: page, order: 'old' })).page[0]!.title).toBe('맵 0');
  });
});
