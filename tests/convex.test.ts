// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { Bot } from '../src/bot';
import { Game } from '../src/game';
import { PRACTICE, serializeMap } from '../src/maps';
import { pauseAllowanceMs, Recorder, releasedSeeds, SIM_VERSION, verifyReplay } from '../src/replay';
import { achievementReward, WELCOME_COINS } from '../src/achievements';
import { costumeById } from '../src/shop';
import { dailyMissions, dayKey, streakReward } from '../src/daily';
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
    return { id, as: t.withIdentity({ subject: id }), t };
  };
  return { t, player, a: await player('에이'), b: await player('비이') };
}
/** A real run: someone who plays a while, then lets go. */
function play(seed: number | readonly number[], seconds: number) {
  const g = new Game(typeof seed === 'number' ? seed : (k) => seed[k] ?? null), bot = new Bot(), rec = new Recorder();
  while (!g.dead) {
    const j = g.time < seconds ? bot.next(g) : { pressed: false, held: false };
    rec.add(j);
    g.step(j);
    g.drain();
  }
  return { text: rec.text(), score: g.score, coins: g.coins, ms: rec.steps * STEP * 1000 };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

type Player = Awaited<ReturnType<typeof setup>>['a'];
/** Starts a run; `seed` is the whole city the server holds for it, as a player would get it stretch by stretch. */
const start = async (p: Player) => {
  const issued = await p.as.mutation(api.ranking.start, { version: SIM_VERSION });
  const run = await p.t.run((ctx) => ctx.db.get(issued.runId));
  return { ...issued, first: issued.seed, seed: run!.seeds! };
};

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
  it('keeps the week’s board across releases, and takes a run begun before one', async () => {
    const { t, a } = await setup();
    await t.run((ctx) => ctx.db.insert('scores', { week: '2026-11-23', version: SIM_VERSION, release: 'initial', userId: a.id, score: 100000, distance: 1000, achievedAt: NOW }));
    const before = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    const old = await start(a), run = play(old.seed, 5);
    await t.mutation(internal.ranking.activateRelease, { id: 'new-release', builtAt: NOW });
    expect(await a.as.query(api.ranking.board, { week: '2026-11-23' })).toEqual(before);
    vi.setSystemTime(NOW + run.ms + 1000);
    expect(await a.as.action(api.ranking.finish, { runId: old.runId, replay: run.text })).toMatchObject({ score: run.score, best: false });
    // An older deployment answering late doesn't replace the newer one.
    expect(await t.mutation(internal.ranking.activateRelease, { id: 'stale-release', builtAt: NOW - 1000 })).toEqual({ id: 'new-release', builtAt: NOW });
  });
  it('starts one week afresh when the operator asks, keeping the rows and later records', async () => {
    const { t, a } = await setup();
    await t.run((ctx) => ctx.db.insert('scores', { week: '2026-11-23', userId: a.id, score: 100000, distance: 1000, achievedAt: NOW }));
    const before = await start(a);
    vi.setSystemTime(NOW + 1000);
    await expect(t.mutation(internal.ranking.resetCurrentWeek, { week: '2026-11-16' })).rejects.toThrow('이번 주');
    expect(await t.mutation(internal.ranking.resetCurrentWeek, { week: '2026-11-23' })).toEqual({ week: '2026-11-23', resetAt: NOW + 1000, applied: true });
    expect(await a.as.query(api.ranking.board, { week: '2026-11-23' })).toEqual({ top: [], mine: null });
    await expect(a.as.action(api.ranking.finish, { runId: before.runId, replay: play(before.seed, 3).text })).rejects.toThrow('새로 시작');
    const { runId, seed } = await start(a), run = play(seed, 5);
    vi.setSystemTime(NOW + run.ms + 3000);
    expect(await a.as.action(api.ranking.finish, { runId, replay: run.text })).toMatchObject({ score: run.score, best: true });
    // A later release, and asking again, change nothing.
    await t.mutation(internal.ranking.activateRelease, { id: 'new-release', builtAt: NOW + 2000 });
    expect(await t.mutation(internal.ranking.resetCurrentWeek, { week: '2026-11-23' })).toEqual({ week: '2026-11-23', resetAt: NOW + 1000, applied: false });
    const board = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    expect(board.top.map((r) => r.score)).toEqual([run.score]);
    expect(board.mine).toMatchObject({ rank: 1, score: run.score });
    expect(await t.run((ctx) => ctx.db.query('scores').collect())).toHaveLength(2);
  });
  it('counts a verified run toward achievements once, best or not', async () => {
    const { t, a } = await setup();
    const { runId, seed } = await start(a), run = play(seed, 5);
    vi.setSystemTime(NOW + run.ms + 3000);
    await a.as.action(api.ranking.finish, { runId, replay: run.text });
    // A second settle of the same run changes nothing.
    const stats = { score: 999999, distance: 1, slides: 1, stomps: 1, maxCombo: 1, perfects: 1 };
    expect(await t.mutation(internal.ranking.settle, { runId, result: { score: 999999, distance: 1, stats } })).toMatchObject({ best: false });
    const rows = await t.run((ctx) => ctx.db.query('achievementProgress').collect());
    expect(rows.map((r) => [r.runs, r.maxScore])).toEqual([[1, run.score]]);
  });
  it('takes its release only from the canonical production manifest, never from player arguments', async () => {
    const { t } = await setup();
    const id = `abcdef123456-${NOW.toString(36)}`;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id })));
    vi.stubGlobal('fetch', fetcher);
    expect(await t.action(api.ranking.syncRelease, {})).toEqual({ id, builtAt: NOW });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://apt-jump-wine.vercel.app/version.json');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"bad"}')));
    await expect(t.action(api.ranking.syncRelease, {})).rejects.toThrow('버전 정보');
  });
  it('saves a new record on the release the page synced first, and the weekly board shows it at once', async () => {
    const { a, b } = await setup();
    // The page's order: take up the production release, then ask for a run.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: `b1dc2b850c8e-${NOW.toString(36)}` }))));
    await a.as.action(api.ranking.syncRelease, {});
    const first = await start(a);
    const one = play(first.seed, 10);
    vi.setSystemTime(NOW + one.ms + 1000);
    expect(await a.as.action(api.ranking.finish, { runId: first.runId, replay: one.text })).toMatchObject({ score: one.score, best: true });
    expect((await b.as.query(api.ranking.board, { week: '2026-11-23' })).top).toEqual([{ rank: 1, nickname: '에이', title: null, badge: null, score: one.score, distance: expect.any(Number), mine: false }]);
    // Syncing again changes nothing; a better run replaces the record on the same board.
    await a.as.action(api.ranking.syncRelease, {});
    const second = await start(a);
    const two = play(second.seed, 40);
    expect(two.score).toBeGreaterThan(one.score);
    vi.setSystemTime(NOW + one.ms + two.ms + 2000);
    expect(await a.as.action(api.ranking.finish, { runId: second.runId, replay: two.text })).toMatchObject({ score: two.score, best: true });
    const board = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    expect(board.top).toEqual([{ rank: 1, nickname: '에이', title: null, badge: null, score: two.score, distance: expect.any(Number), mine: true }]);
    expect(board.mine).toMatchObject({ rank: 1, score: two.score });
  });
  it('score what the replay really did', async () => {
    const { a } = await setup();
    const { runId, seed } = await start(a);
    const run = play(seed, 20);
    vi.setSystemTime(NOW + run.ms + 1000);
    expect(await a.as.action(api.ranking.finish, { runId, replay: run.text })).toMatchObject({ score: run.score, best: true });
    const board = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    expect(board.top).toEqual([{ rank: 1, nickname: '에이', title: null, badge: null, score: run.score, distance: expect.any(Number), mine: true }]);
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
  it('hands the city out stretch by stretch, and refuses a run stopped far longer than it lasted', async () => {
    const { a } = await setup();
    const r = await start(a);
    expect(r.seeds).toEqual(r.seed.slice(0, releasedSeeds(0)));
    vi.setSystemTime(NOW + 30_000);
    expect(await a.as.mutation(api.ranking.seeds, { runId: r.runId })).toEqual(r.seed.slice(0, releasedSeeds(30_000)));
    expect(releasedSeeds(30_000)).toBeGreaterThan(r.seeds.length);
    const run = play(r.seed, 5);
    vi.setSystemTime(NOW + run.ms + pauseAllowanceMs(run.ms) + 10_000);
    await expect(a.as.action(api.ranking.finish, { runId: r.runId, replay: run.text })).rejects.toThrow('일시정지');
  });
  it('inputs from another city earn only what they do in this one', async () => {
    const { a } = await setup();
    const { runId, seed } = await start(a);
    const other = play(seed.map((s) => s + 1), 20);
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
  it('shows each player once, by their best of any version or release, and deletes no row', async () => {
    const { t, a, b } = await setup();
    const c = await t.run((ctx) => ctx.db.insert('users', { nickname: '씨이', nickKey: '씨이' }));
    await t.run(async (ctx) => {
      const add = (userId: typeof c, score: number, extra: { version?: number; release?: string }, week = '2026-11-23') =>
        ctx.db.insert('scores', { week, userId, score, distance: 1, achievedAt: NOW, ...extra });
      await add(a.id, 2, {});
      await add(a.id, 3, { version: SIM_VERSION - 1, release: 'initial' });
      await add(a.id, 1, { version: SIM_VERSION, release: 'new-release' });
      await add(b.id, 3, { release: 'other' });
      await add(c, 1, { version: 1 });
      await add(c, 1e9, {}, '2026-11-16');
    });
    const board = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    expect(board.top.map((r) => [r.rank, r.score])).toEqual([[1, 3], [1, 3], [3, 1]]);
    expect(board.mine).toMatchObject({ rank: 1, score: 3 });
    // A better run raises the player's highest row only.
    const { runId, seed } = await start(a);
    const run = play(seed, 20);
    expect(run.score).toBeGreaterThan(3);
    vi.setSystemTime(NOW + run.ms + 1000);
    expect(await a.as.action(api.ranking.finish, { runId, replay: run.text })).toMatchObject({ score: run.score, best: true });
    const after = await a.as.query(api.ranking.board, { week: '2026-11-23' });
    expect(after.top.map((r) => [r.rank, r.score, r.mine])).toEqual([[1, run.score, true], [2, 3, false], [3, 1, false]]);
    const rows = await t.run((ctx) => ctx.db.query('scores').collect());
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.userId === a.id).map((r) => r.score).sort((x, y) => x - y)).toEqual([1, 2, run.score]);
    expect((await a.as.query(api.ranking.board, { week: '2026-11-16' })).top).toHaveLength(1);
    expect((await a.as.query(api.ranking.board, { week: '2026-11-30' })).top).toEqual([]);
  });
  it('a run begun under other rules can’t be handed in, and says why', async () => {
    const { t, a } = await setup();
    const { runId, seed } = await start(a);
    await t.run((ctx) => ctx.db.patch(runId, { version: SIM_VERSION - 1 }));
    const run = play(seed, 3);
    vi.setSystemTime(NOW + run.ms + 1000);
    await expect(a.as.action(api.ranking.finish, { runId, replay: run.text })).rejects.toThrow('게임 규칙이 업데이트');
    expect((await a.as.query(api.ranking.board, { week: '2026-11-23' })).top).toEqual([]);
  });
  it('the board shows fifty, best first, and where the caller stands below them', async () => {
    const { t, a } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        const userId = await ctx.db.insert('users', { nickname: `p${i}`, nickKey: `p${i}` });
        await ctx.db.insert('scores', { week: '2026-11-23', version: SIM_VERSION, release: 'initial', userId, score: 1000 + i, distance: 1, achievedAt: NOW });
      }
      await ctx.db.insert('scores', { week: '2026-11-23', version: SIM_VERSION, release: 'initial', userId: a.id, score: 5, distance: 1, achievedAt: NOW });
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
    expect(list.page).toEqual([{ id, title: '연습 옥상', segments: PRACTICE.segments.length, updatedAt: expect.closeTo(NOW, -2), createdAt: expect.any(Number), mine: false, author: '에이', best: null, bestBy: null, bestTied: 0 }]);
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
    // Only the content that was replaced stays, for the times made on it.
    expect(await t.run((ctx) => ctx.db.query('mapBodies').collect())).toHaveLength(1);
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

describe('shop', () => {
  it('pays a verified run its coins, sells only what is affordable and not owned, and wears only what is owned', async () => {
    const { t, a } = await setup();
    expect(await a.as.query(api.shop.mine, {})).toEqual({ coins: 0, owned: ['courier'], costume: 'courier' });
    const r = await start(a), run = play(r.seed, 20);
    vi.setSystemTime(NOW + run.ms + 1000);
    expect(run.coins).toBeGreaterThan(0);
    expect(await a.as.action(api.ranking.finish, { runId: r.runId, replay: run.text })).toMatchObject({ coins: run.coins });
    // The run's coins, and the reward of every achievement the run earned.
    const earned = (await a.as.query(api.achievements.catalog, {})).achievements.filter((x) => x.unlocked).map((x) => x.id);
    expect(earned.length).toBeGreaterThan(0);
    expect((await a.as.query(api.shop.mine, {}))!.coins).toBe(run.coins + earned.reduce((n, id) => n + achievementReward(id), 0));
    // An earned achievement can be worn as a badge by the title; one not earned can't.
    await expect(a.as.mutation(api.achievements.equipBadge, { achievementId: 'score-500000' })).rejects.toThrow('아직');
    await a.as.mutation(api.achievements.equipBadge, { achievementId: earned[0]! });
    expect((await a.as.query(api.ranking.board, { week: '2026-11-23' })).top[0]).toMatchObject({ badge: earned[0] });
    await expect(a.as.mutation(api.shop.buy, { id: 'gold' })).rejects.toThrow('코인이 모자라요');
    await expect(a.as.mutation(api.shop.wear, { id: 'neon' })).rejects.toThrow('가지고 있지 않은');
    const neon = costumeById('neon').price;
    await t.run((ctx) => ctx.db.patch(a.id, { coins: neon + 1000 }));
    expect(await a.as.mutation(api.shop.buy, { id: 'neon' })).toEqual({ coins: 1000, owned: ['courier', 'neon'], costume: 'neon' });
    await expect(a.as.mutation(api.shop.buy, { id: 'neon' })).rejects.toThrow('이미');
    await expect(a.as.mutation(api.shop.buy, { id: 'nothing' })).rejects.toThrow('없는 상품');
    expect(await a.as.mutation(api.shop.wear, { id: 'courier' })).toMatchObject({ costume: 'courier', coins: 1000 });
  });
  it('pays older accounts their welcome coins and the rewards of achievements already earned, once', async () => {
    const { t, a } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('achievementUnlocks', { userId: a.id, achievementId: 'first-run' });
      await ctx.db.insert('achievementUnlocks', { userId: a.id, achievementId: 'perfects-750' });
    });
    const owed = WELCOME_COINS + achievementReward('first-run') + achievementReward('perfects-750');
    expect(await t.mutation(internal.shop.backfill, {})).toMatchObject({ rewards: 2 });
    expect((await a.as.query(api.shop.mine, {}))!.coins).toBe(owed);
    expect(await t.mutation(internal.shop.backfill, {})).toEqual({ welcomed: 0, rewards: 0, coins: 0 });
    expect((await a.as.query(api.shop.mine, {}))!.coins).toBe(owed);
  });
  it('pays attendance once a day, more for each day in a row, from one again after a gap', async () => {
    const { a } = await setup();
    const coins = async () => (await a.as.query(api.shop.mine, {}))!.coins;
    const before = await coins();
    expect(await a.as.mutation(api.daily.checkIn, {})).toEqual({ streak: 1, reward: streakReward(1) });
    await expect(a.as.mutation(api.daily.checkIn, {})).rejects.toThrow('이미');
    vi.setSystemTime(NOW + 86_400_000);
    expect(await a.as.mutation(api.daily.checkIn, {})).toEqual({ streak: 2, reward: streakReward(2) });
    vi.setSystemTime(NOW + 3 * 86_400_000);
    expect(await a.as.query(api.daily.mine, {})).toMatchObject({ checkedIn: false, streak: 1 });
    expect(await a.as.mutation(api.daily.checkIn, {})).toEqual({ streak: 1, reward: streakReward(1) });
    expect(await coins()).toBe(before + 2 * streakReward(1) + streakReward(2));
  });
  it('adds verified runs to the day\'s missions', async () => {
    const { a } = await setup();
    const r = await start(a), run = play(r.seed, 20);
    vi.setSystemTime(NOW + run.ms + 1000);
    const done = await a.as.action(api.ranking.finish, { runId: r.runId, replay: run.text });
    const today = await a.as.query(api.daily.mine, {});
    const expected: Record<string, number> = { runs: 1, coins: run.coins, bestScore: run.score };
    for (const [m, plan] of today!.missions.map((m, i) => [m, dailyMissions(dayKey(Date.now()))[i]!] as const)) {
      if (plan.stat in expected) expect(m.progress).toBe(Math.min(m.goal, expected[plan.stat]!));
      expect(m.done).toBe(done.daily.some((d) => d.text === m.text));
    }
  });
});

describe('weekly rewards', () => {
  it('pay a finished week once: its top three, ties sharing, and everyone who ran often', async () => {
    const { t, player, a, b } = await setup();
    const c = await player('씨이'), d = await player('디이');
    const week = '2026-11-16';
    const score = (userId: typeof a.id, s: number) => t.run((ctx) => ctx.db.insert('scores', { week, userId, score: s, distance: 1000, achievedAt: Date.parse(week) + 3_600_000 }));
    await score(a.id, 9000); await score(b.id, 7000); await score(c.id, 7000); await score(d.id, 100);
    // d ran often that week; a ran a little.
    for (const [userId, runs] of [[d.id, 6], [d.id, 5], [a.id, 3]] as const) {
      const day = runs === 5 ? '2026-11-18' : '2026-11-17';
      await t.run((ctx) => ctx.db.insert('dailyProgress', { userId, day, runs, distance: 0, perfects: 0, stomps: 0, slides: 0, coins: 0, bestScore: 0, paid: [] }));
    }
    const coins = async (p: typeof a) => (await p.as.query(api.shop.mine, {}))!.coins;
    const before = await Promise.all([a, b, c, d].map(coins));
    await t.mutation(internal.rewards.payLastWeek, { week });
    await t.mutation(internal.rewards.payLastWeek, { week }); // a second run pays nothing more
    await expect(t.mutation(internal.rewards.payLastWeek, { week: '2026-11-23' })).rejects.toThrow(); // under way
    const after = await Promise.all([a, b, c, d].map(coins));
    expect(after.map((x, i) => x - before[i]!)).toEqual([5000, 3000, 3000, 300]);
    expect(await b.as.query(api.rewards.unseen, {})).toEqual([{ week, rank: 2, steady: false, coins: 3000 }]);
    await b.as.mutation(api.rewards.markSeen, {});
    expect(await b.as.query(api.rewards.unseen, {})).toEqual([]);
    expect(await d.as.query(api.rewards.unseen, {})).toEqual([{ week, rank: null, steady: true, coins: 300 }]);
  });
});
